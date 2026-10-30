import { bot, initializeBot } from "./bot";
import { config } from "../config";
import { prisma } from "../database/prisma";
import { logger } from "../utils/logger";

const shutdown = async (signal: string) => {
  logger.info({ signal }, "Завершение работы Telegram-бота");
  bot.stop(signal);
  await prisma.$disconnect();
  process.exit(0);
};

const start = async () => {
  if (!config.telegramEnabled) {
    logger.warn("Запуск Telegram пропущен, потому что TELEGRAM_ENABLED=false");
    return;
  }

  await initializeBot();

  if (config.useWebhook) {
    logger.warn("В режиме только бота параметр USE_WEBHOOK=true игнорируется. Запускаю polling.");
  }

  await bot.launch();
  logger.info("Telegram-бот запущен в режиме polling");
};

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

start().catch((error) => {
  logger.error(error, "Не удалось запустить Telegram-бота. Проверьте BOT_TOKEN и доступ к api.telegram.org.");
  prisma.$disconnect().catch(() => undefined).finally(() => {
    process.exit(1);
  });
});
