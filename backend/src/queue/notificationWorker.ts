import { Worker } from "bullmq";
import Redis from "ioredis";
import { config } from "../config";
import { NotificationService } from "../services/notificationService";
import { bot } from "../bot/bot";

const connection = new Redis(config.redisUrl);
const notificationService = new NotificationService();

export const startNotificationWorker = () => {
  new Worker(
    "notification-queue",
    async (job) => {
      if (job.name === "order-created") {
        await notificationService.sendOrderCreatedNotifications(bot, job.data.orderId, job.data.carrierIds);
      }
    },
    { connection }
  );
};
