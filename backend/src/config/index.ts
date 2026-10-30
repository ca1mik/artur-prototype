import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

const getRequired = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const getNumber = (key: string, fallback: number) => {
  const value = process.env[key];
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getBoolean = (key: string, fallback: boolean) => {
  const value = process.env[key];
  if (value == null || value === "") {
    return fallback;
  }

  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(value.toLowerCase())) {
    return false;
  }

  return fallback;
};

const getList = (key: string) =>
  (process.env[key] ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const getTrimmed = (key: string) => process.env[key]?.trim() ?? "";

const telegramEnabled = process.env.TELEGRAM_ENABLED !== "false";
const botToken = process.env.BOT_TOKEN ?? "";

if (telegramEnabled && !botToken) {
  throw new Error("Не задан BOT_TOKEN при включенном Telegram-режиме.");
}

export const config = {
  botToken,
  port: Number(process.env.PORT ?? 3000),
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  webhookPath: process.env.WEBHOOK_PATH ?? "/webhook/telegram",
  telegramEnabled,
  telegramApiRoot: process.env.TELEGRAM_API_ROOT ?? "https://api.telegram.org",
  telegramProxyUrl: process.env.TELEGRAM_PROXY_URL ?? process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY,
  routingProxyUrl: process.env.ROUTING_PROXY_URL ?? process.env.TELEGRAM_PROXY_URL ?? process.env.HTTPS_PROXY ?? process.env.HTTP_PROXY,
  routingGeocoderUrl: process.env.ROUTING_GEOCODER_URL ?? "https://nominatim.openstreetmap.org/search",
  routingApiUrl: process.env.ROUTING_API_URL ?? "https://router.project-osrm.org/route/v1/driving",
  routingUserAgent: process.env.ROUTING_USER_AGENT ?? "transport-aggregator-bot/1.0",
  databaseProvider: process.env.DATABASE_PROVIDER ?? "postgresql",
  databaseUrl: getRequired("DATABASE_URL"),
  redisUrl: process.env.REDIS_URL ?? "",
  useWebhook: process.env.USE_WEBHOOK !== "false",
  useRedisQueue: process.env.USE_REDIS_QUEUE !== "false" && Boolean(process.env.REDIS_URL),
  adminSecret: getTrimmed("ADMIN_SECRET"),
  mobileAuthSecret: getTrimmed("MOBILE_AUTH_SECRET") || getTrimmed("ADMIN_SECRET"),
  mobileAccessTokenTtlMinutes: getNumber("MOBILE_ACCESS_TOKEN_TTL_MINUTES", 15),
  mobileRefreshTokenTtlHours: getNumber("MOBILE_REFRESH_TOKEN_TTL_HOURS", 24 * 30),
  mobileChallengeTtlMinutes: getNumber("MOBILE_CHALLENGE_TTL_MINUTES", 10),
  mobileChallengeCooldownSeconds: getNumber("MOBILE_CHALLENGE_COOLDOWN_SECONDS", 45),
  mobileChallengeMaxAttempts: getNumber("MOBILE_CHALLENGE_MAX_ATTEMPTS", 5),
  mobileAuthDebug: getBoolean("MOBILE_AUTH_DEBUG", false),
  mobileAuthFixedCode: process.env.MOBILE_AUTH_FIXED_CODE?.trim() || undefined,
  mobileAllowedOrigins: getList("MOBILE_ALLOWED_ORIGINS"),
  adminTelegramId: process.env.ADMIN_TELEGRAM_ID ? Number(process.env.ADMIN_TELEGRAM_ID) : undefined,
  childTripLeadHours: getNumber("CHILD_TRIP_LEAD_HOURS", 72),
  childTripNightStartHour: getNumber("CHILD_TRIP_NIGHT_START_HOUR", 22),
  childTripNightEndHour: getNumber("CHILD_TRIP_NIGHT_END_HOUR", 6),
};
