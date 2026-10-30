import crypto from "node:crypto";
import { prisma } from "../database/prisma";
import {
  buildRefreshToken,
  hashOpaqueToken,
  issueAccessToken,
  parseRefreshToken,
  type MobileRole,
} from "../api/mobileAuth";
import { config } from "../config";
import { formatPhoneNumber } from "../utils/phone";
import { findPreferredUserByRoleAndPhone, sanitizeMobileIdentityInput } from "./mobileIdentityService";

const buildSyntheticTelegramId = () => {
  const randomSuffix = Math.floor(Math.random() * 1000);
  return BigInt(-1 * (Date.now() * 1000 + randomSuffix));
};

export class MobileSessionService {
  private async ensureUserProfile(input: { role: MobileRole; name: string; phone: string }) {
    const identity = sanitizeMobileIdentityInput(input);
    let user = await findPreferredUserByRoleAndPhone(identity.role, identity.normalizedPhone);

    if (!user) {
      user = await prisma.user.create({
        data: {
          telegramId: buildSyntheticTelegramId(),
          role: identity.role,
          phone: identity.normalizedPhone,
        },
        include: {
          customer: true,
          carrier: {
            include: {
              region: true,
              carrierRegions: { include: { region: true } },
              vehicles: true,
            },
          },
        },
      });
    } else if (user.phone !== identity.normalizedPhone) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { phone: identity.normalizedPhone },
        include: {
          customer: true,
          carrier: {
            include: {
              region: true,
              carrierRegions: { include: { region: true } },
              vehicles: true,
            },
          },
        },
      });
    }

    if (identity.role === "CUSTOMER") {
      await prisma.customer.upsert({
        where: { userId: user.id },
        update: { name: identity.name },
        create: { userId: user.id, name: identity.name },
      });
    } else {
      await prisma.carrier.upsert({
        where: { userId: user.id },
        update: {
          fullName: identity.name,
        },
        create: {
          userId: user.id,
          status: "PENDING_APPROVAL",
          fullName: identity.name,
        },
      });
    }

    return {
      role: identity.role,
      userId: user.id,
      phone: identity.normalizedPhone,
    };
  }

  async createSessionForVerifiedIdentity(
    input: { role: MobileRole; name: string; phone: string },
    context?: {
      deviceId?: string;
      deviceName?: string;
      platform?: string;
      ipAddress?: string | null;
      userAgent?: string | null;
    }
  ) {
    const { userId, role } = await this.ensureUserProfile(input);
    const sessionId = crypto.randomUUID();
    const { refreshToken, refreshTokenHash } = buildRefreshToken(sessionId);

    if (context?.deviceId) {
      await prisma.mobileSession.updateMany({
        where: {
          userId,
          deviceId: context.deviceId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
          revokedReason: "superseded_by_new_login",
        },
      });
    }

    const session = await prisma.mobileSession.create({
      data: {
        id: sessionId,
        userId,
        role,
        refreshTokenHash,
        deviceId: context?.deviceId,
        deviceName: context?.deviceName,
        platform: context?.platform,
        ipAddress: context?.ipAddress ?? undefined,
        userAgent: context?.userAgent ?? undefined,
        expiresAt: new Date(Date.now() + config.mobileRefreshTokenTtlHours * 60 * 60 * 1000),
      },
    });

    return this.buildAuthSession(session.id, userId, role, refreshToken);
  }

  async refreshSession(
    refreshToken: string,
    context?: {
      ipAddress?: string | null;
      userAgent?: string | null;
    }
  ) {
    const parsedRefreshToken = parseRefreshToken(refreshToken);
    if (!parsedRefreshToken) {
      throw new Error("Refresh token is invalid");
    }

    const session = await prisma.mobileSession.findUnique({
      where: { id: parsedRefreshToken.sessionId },
    });

    if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      throw new Error("Session is no longer valid");
    }

    if (hashOpaqueToken(parsedRefreshToken.secret) !== session.refreshTokenHash) {
      await prisma.mobileSession.update({
        where: { id: session.id },
        data: {
          revokedAt: new Date(),
          revokedReason: "refresh_token_mismatch",
        },
      });
      throw new Error("Session is no longer valid");
    }

    const nextRefresh = buildRefreshToken(session.id);
    await prisma.mobileSession.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: nextRefresh.refreshTokenHash,
        ipAddress: context?.ipAddress ?? session.ipAddress,
        userAgent: context?.userAgent ?? session.userAgent,
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + config.mobileRefreshTokenTtlHours * 60 * 60 * 1000),
      },
    });

    return this.buildAuthSession(session.id, session.userId, session.role as MobileRole, nextRefresh.refreshToken);
  }

  async revokeSession(sessionId: string, reason = "user_logout") {
    await prisma.mobileSession.updateMany({
      where: {
        id: sessionId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
        revokedReason: reason,
      },
    });
  }

  private async buildAuthSession(sessionId: string, userId: number, role: MobileRole, refreshToken: string) {
    const profile = await this.getProfile(userId);
    if (!profile) {
      throw new Error("User was not found");
    }

    return {
      accessToken: issueAccessToken(sessionId, userId, role),
      refreshToken,
      expiresAt: new Date(Date.now() + config.mobileAccessTokenTtlMinutes * 60 * 1000).toISOString(),
      user: profile,
    };
  }

  async getProfile(userId: number) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        customer: true,
        carrier: {
          include: {
            region: true,
            carrierRegions: { include: { region: true } },
            vehicles: true,
          },
        },
      },
    });

    if (!user) {
      return null;
    }

    return {
      id: user.id,
      role: user.role,
      phone: user.phone ? formatPhoneNumber(user.phone) ?? user.phone : null,
      customer: user.customer
        ? {
            id: user.customer.id,
            name: user.customer.name,
          }
        : null,
      carrier: user.carrier
        ? {
            id: user.carrier.id,
            status: user.carrier.status,
            fullName: user.carrier.fullName,
            vehicleType: user.carrier.vehicleType,
            brand: user.carrier.brand,
            capacity: user.carrier.capacity,
            plateNumber: user.carrier.plateNumber,
            description: user.carrier.description,
            region: user.carrier.region,
            regions: user.carrier.carrierRegions.map((item) => item.region),
            vehicles: user.carrier.vehicles,
          }
        : null,
    };
  }
}
