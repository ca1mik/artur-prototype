import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import { config } from "../config";
import { prisma } from "../database/prisma";
import { logger } from "../utils/logger";
import { Telegraf } from "telegraf";
import { buildMapLinkLine } from "../utils/location";
import { ORDER_DEPOSIT_STATUS, isContactsUnlocked } from "../utils/orderDeal";
import { formatVehicleSummary, parsePhotoIds, toVehicleLabel } from "../utils/transport";

const redisConnection = config.useRedisQueue ? new Redis(config.redisUrl) : undefined;

const buildPassengerLines = (order: {
  adultsCount?: number | null;
  childrenCount?: number | null;
  passengersCount?: number | null;
  cargoDescription?: string | null;
}) => {
  if (order.passengersCount) {
    return [
      order.adultsCount !== null && order.adultsCount !== undefined ? `Взрослых: ${order.adultsCount}` : null,
      order.childrenCount !== null && order.childrenCount !== undefined ? `Детей: ${order.childrenCount}` : null,
      `Всего пассажиров: ${order.passengersCount}`,
      (order.childrenCount ?? 0) > 0 ? "Детская поездка: нужна предварительная подача разрешения." : null,
    ].filter(Boolean) as string[];
  }

  return [`Груз: ${order.cargoDescription ?? "не указан"}`];
};

const buildOfferSummary = (offer: {
  proposedPrice: number;
  pickupEtaText?: string | null;
  note?: string | null;
}) =>
  [
    `Предложенная цена: ${offer.proposedPrice} ₽`,
    offer.pickupEtaText ? `Подача: ${offer.pickupEtaText}` : null,
    offer.note ? `Комментарий: ${offer.note}` : null,
  ]
    .filter(Boolean)
    .join("\n");

export class NotificationService {
  private queue = config.useRedisQueue ? new Queue("notification-queue", { connection: redisConnection! }) : undefined;

  private async loadOrderForNotifications(orderId: number) {
    return prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: { include: { user: true } },
        region: true,
        category: true,
        carrier: { include: { user: true } },
        vehicle: true,
      },
    });
  }

  private isSendingEnabled() {
    return config.telegramEnabled;
  }

  async enqueueOrderNotification(bot: Telegraf, payload: { orderId: number; carrierIds: number[] }) {
    if (!this.isSendingEnabled()) {
      return;
    }

    if (!config.useRedisQueue || !this.queue) {
      await this.sendOrderCreatedNotifications(bot, payload.orderId, payload.carrierIds);
      return;
    }

    await this.queue.add("order-created", payload, { removeOnComplete: true, removeOnFail: true });
  }

  async processQueue(bot: Telegraf) {
    if (!this.isSendingEnabled()) {
      return;
    }

    if (!config.useRedisQueue || !redisConnection) {
      return;
    }

    new Worker(
      "notification-queue",
      async (job) => {
        if (job.name === "order-created") {
          await this.sendOrderCreatedNotifications(bot, job.data.orderId, job.data.carrierIds);
        }
      },
      { connection: redisConnection }
    );
  }

  async sendOrderCreatedNotifications(bot: Telegraf, orderId: number, carrierIds: number[]) {
    if (!this.isSendingEnabled()) {
      return;
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { region: true, category: true, customer: { include: { user: true } } },
    });
    if (!order) {
      logger.warn({ orderId }, "Order not found for notification");
      return;
    }

    const text = [
      "Новая заявка:",
      `${order.routeFrom} → ${order.routeTo}`,
      buildMapLinkLine("Точка отправления", order.routeFromLat, order.routeFromLng),
      buildMapLinkLine("Точка назначения", order.routeToLat, order.routeToLng),
      `Регион: ${order.region.name}`,
      `Категория: ${order.category.name}`,
      `Транспорт: ${toVehicleLabel(order.vehicleType)}`,
      `Дата поездки: ${new Date(order.date).toLocaleString("ru-RU")}`,
      ...buildPassengerLines(order),
      order.estimatedDistanceKm ? `Километраж: ${order.estimatedDistanceKm} км` : null,
      order.estimatedDurationHours ? `Время в пути: ${order.estimatedDurationHours} ч` : null,
      `Цена: ${order.price} ₽`,
      order.comment ? `Комментарий: ${order.comment}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    const keyboard = {
      inline_keyboard: [
        [{ text: "Взять по цене заказчика", callback_data: `accept_order:${order.id}` }],
        [{ text: "Предложить цену", callback_data: `offer_order:${order.id}` }],
        [{ text: "Пропустить", callback_data: `skip_order:${order.id}` }],
      ],
    };

    const carriers = await prisma.carrier.findMany({
      where: { id: { in: carrierIds } },
      include: { user: true },
    });

    for (const carrier of carriers) {
      await bot.telegram.sendMessage(carrier.user.telegramId.toString(), text, { reply_markup: keyboard });
    }
  }

  async notifyCustomerOrderAccepted(bot: Telegraf, orderId: number) {
    if (!this.isSendingEnabled()) {
      return;
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: { include: { user: true } },
        carrier: { include: { user: true } },
        vehicle: true,
      },
    });
    if (!order || !order.carrier) {
      logger.warn({ orderId }, "Unable to notify customer because order or carrier is missing");
      return;
    }

    const carrier = order.carrier;
    const vehicleSummary = order.vehicle
      ? formatVehicleSummary(order.vehicle)
      : formatVehicleSummary({
          type: carrier.vehicleType,
          brand: carrier.brand,
          plateNumber: carrier.plateNumber,
          capacity: carrier.capacity,
          description: carrier.description,
        });

    const text = [
      "Депозит подтвержден. Контакты открыты.",
      "",
      `Маршрут: ${order.routeFrom} → ${order.routeTo}`,
      buildMapLinkLine("Точка отправления", order.routeFromLat, order.routeFromLng),
      buildMapLinkLine("Точка назначения", order.routeToLat, order.routeToLng),
      "",
      `Перевозчик: ${carrier.fullName ?? carrier.user.telegramId}`,
      `Телефон: ${carrier.user.phone ?? "не указан"}`,
      "",
      ...buildPassengerLines(order),
      "",
      vehicleSummary,
      "",
      `Запланированное время заказа: ${new Date(order.date).toLocaleString("ru-RU")}`,
      order.pickupEtaText ? `Ориентировочная подача: ${order.pickupEtaText}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const photos = parsePhotoIds(order.vehicle?.photos ?? carrier.photos);
    if (photos.length > 0) {
      await bot.telegram.sendPhoto(order.customer.user.telegramId.toString(), photos[0], { caption: text });
      for (const photo of photos.slice(1, 3)) {
        await bot.telegram.sendPhoto(order.customer.user.telegramId.toString(), photo);
      }
      return;
    }

    await bot.telegram.sendMessage(order.customer.user.telegramId.toString(), text);
  }

  async notifyCustomerOrderStatusChanged(bot: Telegraf, order: {
    id: number;
    status: string;
    routeFrom: string;
    routeTo: string;
    customer: { user: { telegramId: bigint } };
  }) {
    if (!this.isSendingEnabled()) {
      return;
    }

    const statusLabels: Record<string, string> = {
      IN_PROGRESS: "в работе",
      COMPLETED: "завершен",
      CANCELLED: "отменен",
    };

    const statusLabel = statusLabels[order.status] ?? order.status;
    await bot.telegram.sendMessage(
      order.customer.user.telegramId.toString(),
      `Статус заявки #${order.id} обновлен: ${statusLabel}.\nМаршрут: ${order.routeFrom} → ${order.routeTo}`
    );
  }

  async notifyCustomerDispatchAssigned(bot: Telegraf, orderId: number) {
    if (!this.isSendingEnabled()) {
      return;
    }

    const order = await this.loadOrderForNotifications(orderId);
    if (!order?.customer) {
      return;
    }

    const contactsAreUnlocked = isContactsUnlocked(order);
    const text = [
      `По заявке #${order.id} назначен экипаж.`,
      `Маршрут: ${order.routeFrom} → ${order.routeTo}`,
      order.driverNameSnapshot ? `Водитель: ${order.driverNameSnapshot}` : null,
      order.vehicleBrandSnapshot || order.vehiclePlateSnapshot
        ? `Машина: ${[order.vehicleBrandSnapshot, order.vehiclePlateSnapshot].filter(Boolean).join(" • ")}`
        : null,
      contactsAreUnlocked && order.driverPhoneSnapshot ? `Телефон водителя: ${order.driverPhoneSnapshot}` : null,
      !contactsAreUnlocked ? "Контакты откроются после подтверждения депозита." : null,
    ]
      .filter(Boolean)
      .join("\n");

    await bot.telegram.sendMessage(order.customer.user.telegramId.toString(), text);
  }

  async notifyOrderAwaitingCarrierDeposit(bot: Telegraf, orderId: number) {
    if (!this.isSendingEnabled()) {
      return;
    }

    const order = await this.loadOrderForNotifications(orderId);
    if (!order || !order.carrier) {
      return;
    }

    const orderLabel = order.returnSourceOrderId ? `Обратный рейс #${order.id}` : `Заявка #${order.id}`;
    const customerText = [
      `${orderLabel} закреплен за перевозчиком.`,
      `Маршрут: ${order.routeFrom} → ${order.routeTo}`,
      `Перевозчик: ${order.carrier.fullName ?? "назначен"}`,
      `Резерв перевозчика: ${order.depositAmount ?? 0} ₽ (${order.depositPercent ?? 10}%)`,
      "Ждем платежку от перевозчика. Контакты откроются после подтверждения депозита.",
    ].join("\n");

    const carrierText = [
      `${orderLabel} закреплен за вами.`,
      `Маршрут: ${order.routeFrom} → ${order.routeTo}`,
      `Дата: ${new Date(order.date).toLocaleString("ru-RU")}`,
      `Цена: ${order.price} ₽`,
      `Нужно перевести резерв: ${order.depositAmount ?? 0} ₽ (${order.depositPercent ?? 10}%)`,
      "После подтверждения платежки заказчик и контакты откроются автоматически.",
    ].join("\n");

    await bot.telegram.sendMessage(order.customer.user.telegramId.toString(), customerText);
    await bot.telegram.sendMessage(order.carrier.user.telegramId.toString(), carrierText, {
      reply_markup: {
        inline_keyboard: [[{ text: "Отправить платежку", callback_data: `carrier-order-deposit:submit:${order.id}` }]],
      },
    });
  }

  async notifyAdminDepositPending(bot: Telegraf, orderId: number) {
    if (!this.isSendingEnabled() || !config.adminTelegramId) {
      return;
    }

    const order = await this.loadOrderForNotifications(orderId);
    if (!order) {
      return;
    }

    const text = [
      `Платежка на проверку по заказу #${order.id}`,
      `Маршрут: ${order.routeFrom} → ${order.routeTo}`,
      `Заказчик: ${order.customerNameSnapshot ?? order.customer?.name ?? "—"}`,
      `Перевозчик: ${order.carrierNameSnapshot ?? order.carrier?.fullName ?? "—"}`,
      `Сумма резерва: ${order.depositAmount ?? 0} ₽`,
      `Референс: ${order.depositReference ?? "не указан"}`,
      order.depositVerificationNote ? `Комментарий: ${order.depositVerificationNote}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    await bot.telegram.sendMessage(config.adminTelegramId.toString(), text, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Подтвердить депозит", callback_data: `admin-deposit:verify:${order.id}` },
            { text: "Отклонить", callback_data: `admin-deposit:reject:${order.id}` },
          ],
        ],
      },
    });
  }

  async notifyCarrierDepositRejected(bot: Telegraf, orderId: number) {
    if (!this.isSendingEnabled()) {
      return;
    }

    const order = await this.loadOrderForNotifications(orderId);
    if (!order?.carrier) {
      return;
    }

    const text = [
      `Платежка по заказу #${order.id} отклонена.`,
      order.depositVerificationNote ? `Причина: ${order.depositVerificationNote}` : null,
      "Пожалуйста, отправьте новый референс или повторную платежку.",
    ]
      .filter(Boolean)
      .join("\n");

    await bot.telegram.sendMessage(order.carrier.user.telegramId.toString(), text, {
      reply_markup: {
        inline_keyboard: [[{ text: "Отправить платежку заново", callback_data: `carrier-order-deposit:submit:${order.id}` }]],
      },
    });
  }

  async notifyCarrierOrderReady(bot: Telegraf, orderId: number) {
    if (!this.isSendingEnabled()) {
      return;
    }

    const order = await this.loadOrderForNotifications(orderId);
    if (!order?.carrier) {
      return;
    }

    const text = [
      `Депозит по заказу #${order.id} подтвержден.`,
      `Маршрут: ${order.routeFrom} → ${order.routeTo}`,
      `Заказчик: ${order.customerNameSnapshot ?? order.customer?.name ?? "—"}`,
      `Телефон заказчика: ${order.customerContactSnapshot ?? order.customer?.user?.phone ?? "—"}`,
      order.pickupEtaText ? `Подача: ${order.pickupEtaText}` : null,
      order.vehicle ? formatVehicleSummary(order.vehicle) : null,
    ]
      .filter(Boolean)
      .join("\n");

    await bot.telegram.sendMessage(order.carrier.user.telegramId.toString(), text);
  }

  async notifyCustomerOrderOffer(bot: Telegraf, offerId: number) {
    if (!this.isSendingEnabled()) {
      return;
    }

    const offer = await prisma.orderOffer.findUnique({
      where: { id: offerId },
      include: {
        order: { include: { customer: { include: { user: true } }, region: true, category: true } },
        carrier: { include: { user: true } },
      },
    });

    if (!offer) {
      logger.warn({ offerId }, "Offer not found for customer notification");
      return;
    }

    const text = [
      `Новый отклик по заявке #${offer.order.id}`,
      `${offer.order.routeFrom} → ${offer.order.routeTo}`,
      `Перевозчик: ${offer.carrier.fullName ?? offer.carrier.user.telegramId}`,
      buildOfferSummary(offer),
    ]
      .filter(Boolean)
      .join("\n");

    await bot.telegram.sendMessage(offer.order.customer.user.telegramId.toString(), text, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Принять цену", callback_data: `offer_customer:accept:${offer.id}` }],
          [{ text: "Торговаться", callback_data: `offer_customer:counter:${offer.id}` }],
          [{ text: "Отклонить", callback_data: `offer_customer:reject:${offer.id}` }],
        ],
      },
    });
  }

  async notifyCarrierOrderCounterOffer(bot: Telegraf, offerId: number) {
    if (!this.isSendingEnabled()) {
      return;
    }

    const offer = await prisma.orderOffer.findUnique({
      where: { id: offerId },
      include: {
        order: { include: { customer: { include: { user: true } } } },
        carrier: { include: { user: true } },
        customer: { include: { user: true } },
      },
    });

    if (!offer) {
      logger.warn({ offerId }, "Offer not found for carrier counter notification");
      return;
    }

    const text = [
      `Заказчик сделал встречное предложение по заявке #${offer.order.id}`,
      `${offer.order.routeFrom} → ${offer.order.routeTo}`,
      `Новая цена заказчика: ${offer.proposedPrice} ₽`,
    ].join("\n");

    await bot.telegram.sendMessage(offer.carrier.user.telegramId.toString(), text, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Принять встречную цену", callback_data: `offer_carrier:accept:${offer.id}` }],
          [{ text: "Предложить свою снова", callback_data: `offer_carrier:counter:${offer.id}` }],
          [{ text: "Отказаться", callback_data: `offer_carrier:reject:${offer.id}` }],
        ],
      },
    });
  }

  async notifyCarrierOfferAccepted(bot: Telegraf, offerId: number) {
    if (!this.isSendingEnabled()) {
      return;
    }

    const offer = await prisma.orderOffer.findUnique({
      where: { id: offerId },
      include: {
        order: true,
        carrier: { include: { user: true } },
      },
    });

    if (!offer) {
      return;
    }

    await bot.telegram.sendMessage(
      offer.carrier.user.telegramId.toString(),
      `Ваше предложение по заявке #${offer.order.id} принято. Цена: ${offer.proposedPrice} ₽.`
    );
  }

  async notifyCarrierOfferRejected(bot: Telegraf, offerId: number) {
    if (!this.isSendingEnabled()) {
      return;
    }

    const offer = await prisma.orderOffer.findUnique({
      where: { id: offerId },
      include: {
        order: true,
        carrier: { include: { user: true } },
      },
    });

    if (!offer) {
      return;
    }

    await bot.telegram.sendMessage(
      offer.carrier.user.telegramId.toString(),
      `Ваше предложение по заявке #${offer.order.id} отклонено.`
    );
  }

  async notifyCustomerOfferRejected(bot: Telegraf, offerId: number) {
    if (!this.isSendingEnabled()) {
      return;
    }

    const offer = await prisma.orderOffer.findUnique({
      where: { id: offerId },
      include: {
        order: { include: { customer: { include: { user: true } } } },
        carrier: { include: { user: true } },
      },
    });

    if (!offer) {
      return;
    }

    await bot.telegram.sendMessage(
      offer.order.customer.user.telegramId.toString(),
      `Перевозчик отказался от торга по заявке #${offer.order.id}. Можно дождаться других откликов или выбрать другое предложение.`
    );
  }

  async notifyOtherCarriersOrderClosed(bot: Telegraf, orderId: number, acceptedCarrierId: number) {
    if (!this.isSendingEnabled()) {
      return;
    }

    const offers = await prisma.orderOffer.findMany({
      where: {
        orderId,
        carrierId: { not: acceptedCarrierId },
        status: { in: ["ACTIVE", "COUNTERED", "REJECTED"] },
      },
      include: { carrier: { include: { user: true } } },
    });

    for (const offer of offers) {
      await bot.telegram.sendMessage(
        offer.carrier.user.telegramId.toString(),
        `Заявка #${orderId} уже закреплена за другим перевозчиком.`
      );
    }
  }
}

