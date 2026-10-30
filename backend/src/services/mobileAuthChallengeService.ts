import crypto from "node:crypto";
import { bot } from "../bot/bot";
import { config } from "../config";
import { prisma } from "../database/prisma";
import { logger } from "../utils/logger";
import { findPreferredUserByRoleAndPhone, sanitizeMobileIdentityInput } from "./mobileIdentityService";
import type { MobileRole } from "../api/mobileAuth";

const buildCodeHash = (challengeId: string, code: string) =>
  crypto.createHmac("sha256", config.mobileAuthSecret).update(`${challengeId}:${code}`).digest("hex");

const generateVerificationCode = () =>
  config.mobileAuthFixedCode ??
  Math.floor(100000 + Math.random() * 900000)
    .toString()
    .slice(0, 6);

export class MobileAuthChallengeService {
  async createChallenge(input: {
    role: MobileRole;
    name: string;
    phone: string;
    requestedByIp?: string | null;
    userAgent?: string | null;
  }) {
    const identity = sanitizeMobileIdentityInput(input);
    const activeChallenge = await prisma.mobileAuthChallenge.findFirst({
      where: {
        phone: identity.normalizedPhone,
        role: identity.role,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (activeChallenge) {
      const earliestRetryAt =
        activeChallenge.createdAt.getTime() + config.mobileChallengeCooldownSeconds * 1000;

      if (earliestRetryAt > Date.now()) {
        throw new Error("Please wait a little before requesting another verification code");
      }
    }

    const recentChallengesCount = await prisma.mobileAuthChallenge.count({
      where: {
        createdAt: {
          gt: new Date(Date.now() - 60 * 60 * 1000),
        },
        OR: [
          { phone: identity.normalizedPhone },
          input.requestedByIp ? { requestedByIp: input.requestedByIp } : undefined,
        ].filter(Boolean) as Array<{ phone?: string; requestedByIp?: string | null }>,
      },
    });

    if (recentChallengesCount >= 8) {
      throw new Error("Too many verification attempts. Please try again later");
    }

    const challengeId = crypto.randomUUID();
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + config.mobileChallengeTtlMinutes * 60 * 1000);

    const created = await prisma.mobileAuthChallenge.create({
      data: {
        id: challengeId,
        phone: identity.normalizedPhone,
        role: identity.role,
        name: identity.name,
        codeHash: buildCodeHash(challengeId, code),
        channel: "PENDING",
        maxAttempts: config.mobileChallengeMaxAttempts,
        requestedByIp: input.requestedByIp ?? undefined,
        userAgent: input.userAgent ?? undefined,
        expiresAt,
      },
    });

    let deliveryChannel = "DEBUG";
    let deliveredViaTelegram = false;
    const existingUser = await findPreferredUserByRoleAndPhone(identity.role, identity.normalizedPhone);

    if (existingUser && existingUser.telegramId > 0n && config.telegramEnabled) {
      try {
        await bot.telegram.sendMessage(
          Number(existingUser.telegramId),
          `Код входа в ARTUR PRO: ${code}\n\nЕсли это были не вы, просто проигнорируйте сообщение.`
        );
        deliveryChannel = "TELEGRAM";
        deliveredViaTelegram = true;
      } catch (error) {
        logger.warn({ error, userId: existingUser.id }, "Failed to deliver mobile auth code via Telegram");
      }
    }

    if (!deliveredViaTelegram && !config.mobileAuthDebug) {
      await prisma.mobileAuthChallenge.update({
        where: { id: created.id },
        data: {
          consumedAt: new Date(),
          channel: "UNDELIVERED",
        },
      });
      throw new Error("Verification delivery channel is not configured for this phone number");
    }

    await prisma.mobileAuthChallenge.update({
      where: { id: created.id },
      data: { channel: deliveryChannel },
    });

    logger.info(
      {
        challengeId: created.id,
        phone: identity.normalizedPhone,
        role: identity.role,
        channel: deliveryChannel,
      },
      "Mobile auth challenge issued"
    );

    return {
      challengeId: created.id,
      expiresAt: created.expiresAt.toISOString(),
      deliveryChannel,
      debugCode: config.mobileAuthDebug ? code : undefined,
    };
  }

  async verifyChallenge(input: { challengeId: string; code: string }) {
    const challenge = await prisma.mobileAuthChallenge.findUnique({
      where: { id: input.challengeId },
    });

    if (!challenge || challenge.consumedAt || challenge.expiresAt.getTime() <= Date.now()) {
      throw new Error("Verification code is invalid or has expired");
    }

    if (challenge.failedAttempts >= challenge.maxAttempts) {
      await prisma.mobileAuthChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      });
      throw new Error("Verification code has been locked after too many attempts");
    }

    const sanitizedCode = input.code.trim();
    if (buildCodeHash(challenge.id, sanitizedCode) !== challenge.codeHash) {
      const updated = await prisma.mobileAuthChallenge.update({
        where: { id: challenge.id },
        data: {
          failedAttempts: { increment: 1 },
        },
      });

      if (updated.failedAttempts >= updated.maxAttempts) {
        await prisma.mobileAuthChallenge.update({
          where: { id: challenge.id },
          data: { consumedAt: new Date() },
        });
      }

      throw new Error("Verification code is invalid or has expired");
    }

    await prisma.mobileAuthChallenge.update({
      where: { id: challenge.id },
      data: {
        consumedAt: new Date(),
      },
    });

    return {
      role: challenge.role as MobileRole,
      name: challenge.name,
      phone: challenge.phone,
    };
  }
}
