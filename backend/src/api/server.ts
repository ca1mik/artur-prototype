import express from "express";
import type { Server } from "node:http";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { bot, initializeBot } from "../bot/bot";
import { adminRouter } from "./routes/admin";
import { mobileRouter } from "./routes/mobile";
import { config } from "../config";
import { logger } from "../utils/logger";
import { prisma } from "../database/prisma";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

const corsMiddleware = cors({
  origin(origin, callback) {
    if (!origin || config.mobileAllowedOrigins.length === 0 || config.mobileAllowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(null, false);
  },
  methods: ["GET", "POST", "PUT", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-admin-secret"],
  credentials: false,
});

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);
app.use(corsMiddleware);
app.use(express.json({ limit: "64kb" }));
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 180,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.post(config.webhookPath, async (req, res) => {
  try {
    await bot.handleUpdate(req.body, res);
    res.sendStatus(200);
  } catch (error) {
    logger.error(error, "Ошибка webhook");
    res.sendStatus(500);
  }
});

app.get("/health", (req, res) => res.json({ status: "ok" }));
app.use("/mobile", mobileRouter);
app.use("/admin", adminRouter);

const listen = () =>
  new Promise<Server>((resolve, reject) => {
    const server = app.listen(config.port, () => resolve(server));
    server.once("error", reject);
  });

const start = async () => {
  await listen();
  logger.info({ port: config.port }, "Сервер запущен");

  if (!config.telegramEnabled) {
    logger.warn("Запуск Telegram пропущен, потому что TELEGRAM_ENABLED=false");
    return;
  }

  await initializeBot();

  if (config.useWebhook) {
    try {
      await bot.telegram.setWebhook(`${config.appUrl}${config.webhookPath}`);
      logger.info({ webhook: `${config.appUrl}${config.webhookPath}` }, "Webhook настроен");
    } catch (error) {
      logger.error(error, "Не удалось настроить Telegram webhook");
    }
  } else {
    try {
      await bot.launch();
      logger.info("Бот запущен в режиме polling");
    } catch (error) {
      logger.error(error, "Не удалось запустить polling Telegram: проверьте сеть и токен");
    }
  }
};

process.on("SIGINT", async () => {
  logger.info("Завершение работы");
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("Завершение работы");
  await prisma.$disconnect();
  process.exit(0);
});

start().catch((error) => {
  if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
    logger.error({ port: config.port }, "Порт уже занят. Остановите другой процесс или измените PORT.");
  } else {
    logger.error(error, "Не удалось запустить сервер");
  }
  prisma.$disconnect().catch(() => undefined).finally(() => {
    process.exit(1);
  });
});
