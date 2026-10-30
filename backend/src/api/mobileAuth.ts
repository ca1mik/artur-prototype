import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config";
import { prisma } from "../database/prisma";

export type MobileRole = "CUSTOMER" | "CARRIER";

type AccessTokenPayload = {
  v: 2;
  sessionId: string;
  userId: number;
  role: MobileRole;
  exp: number;
};

const base64UrlEncode = (value: string) => Buffer.from(value, "utf8").toString("base64url");
const base64UrlDecode = (value: string) => Buffer.from(value, "base64url").toString("utf8");

const sign = (payloadBase64: string) =>
  crypto.createHmac("sha256", config.mobileAuthSecret).update(payloadBase64).digest("base64url");

const safeEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

export const hashOpaqueToken = (token: string) =>
  crypto.createHmac("sha256", config.mobileAuthSecret).update(token).digest("hex");

export const buildRefreshToken = (sessionId: string) => {
  const secret = crypto.randomBytes(32).toString("hex");
  return {
    refreshToken: `${sessionId}.${secret}`,
    refreshTokenHash: hashOpaqueToken(secret),
  };
};

export const parseRefreshToken = (token: string) => {
  const [sessionId, secret] = token.split(".");
  if (!sessionId || !secret) {
    return null;
  }

  return {
    sessionId,
    secret,
  };
};

export const issueAccessToken = (sessionId: string, userId: number, role: MobileRole) => {
  const payload: AccessTokenPayload = {
    v: 2,
    sessionId,
    userId,
    role,
    exp: Date.now() + config.mobileAccessTokenTtlMinutes * 60 * 1000,
  };

  const payloadBase64 = base64UrlEncode(JSON.stringify(payload));
  return `${payloadBase64}.${sign(payloadBase64)}`;
};

export const verifyAccessToken = (token: string): AccessTokenPayload | null => {
  const [payloadBase64, signature] = token.split(".");
  if (!payloadBase64 || !signature) {
    return null;
  }

  const expectedSignature = sign(payloadBase64);
  if (!safeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(payloadBase64)) as AccessTokenPayload;
    if (
      payload.v !== 2 ||
      payload.exp <= Date.now() ||
      !payload.sessionId ||
      !Number.isInteger(payload.userId) ||
      payload.userId <= 0 ||
      !["CUSTOMER", "CARRIER"].includes(payload.role)
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
};

export type MobileRequestUser = {
  sessionId: string;
  userId: number;
  role: MobileRole;
};

export type MobileAuthedRequest = Request & {
  mobileUser?: MobileRequestUser;
};

const parseBearerToken = (headerValue?: string) => {
  if (!headerValue) {
    return null;
  }

  const [scheme, token] = headerValue.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
};

const maybeTouchSession = async (sessionId: string, lastSeenAt: Date) => {
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  if (lastSeenAt.getTime() >= fiveMinutesAgo) {
    return;
  }

  await prisma.mobileSession.update({
    where: { id: sessionId },
    data: { lastSeenAt: new Date() },
  });
};

export const requireMobileAuth =
  (role?: MobileRole) => async (req: MobileAuthedRequest, res: Response, next: NextFunction) => {
    const token = parseBearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ error: "Authorization token is required" });
    }

    const payload = verifyAccessToken(token);
    if (!payload) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const session = await prisma.mobileSession.findUnique({
      where: { id: payload.sessionId },
      select: {
        id: true,
        userId: true,
        role: true,
        expiresAt: true,
        revokedAt: true,
        lastSeenAt: true,
      },
    });

    if (
      !session ||
      session.userId !== payload.userId ||
      session.role !== payload.role ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      return res.status(401).json({ error: "Session is no longer valid" });
    }

    if (role && payload.role !== role) {
      return res.status(403).json({ error: "This action is not available for the current role" });
    }

    req.mobileUser = {
      sessionId: session.id,
      userId: payload.userId,
      role: payload.role,
    };

    void maybeTouchSession(session.id, session.lastSeenAt).catch(() => undefined);
    next();
  };
