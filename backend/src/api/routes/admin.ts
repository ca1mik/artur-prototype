import { Router, type Response } from "express";
import { config } from "../../config";
import { prisma } from "../../database/prisma";
import { CarrierRepository } from "../../repositories/carrierRepository";
import { OrderRepository } from "../../repositories/orderRepository";
import { PricingRuleRepository } from "../../repositories/pricingRuleRepository";
import { UserRepository } from "../../repositories/userRepository";
import { ORDER_DEPOSIT_STATUS, ORDER_STATUS_AWAITING_DEPOSIT } from "../../utils/orderDeal";

const carrierRepository = new CarrierRepository();
const orderRepository = new OrderRepository();
const pricingRuleRepository = new PricingRuleRepository();
const userRepository = new UserRepository();

export const adminRouter = Router();

const parseLimit = (value: unknown, fallback: number, max = 50) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
};

const parseOptionalNote = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
};

const sendJson = (res: Response, payload: unknown) =>
  res.type("application/json").send(
    JSON.stringify(payload, (_key, value) => (typeof value === "bigint" ? value.toString() : value))
  );

adminRouter.use((req, res, next) => {
  if (!config.adminSecret) {
    return res.status(503).json({ error: "ADMIN_SECRET is not configured on backend" });
  }

  const secretHeader = req.headers["x-admin-secret"];
  const secret = Array.isArray(secretHeader) ? secretHeader[0] : secretHeader;
  if (secret !== config.adminSecret) {
    return res.status(401).json({ error: "Доступ запрещен" });
  }
  next();
});

adminRouter.get("/orders", async (req, res) => {
  const limit = parseLimit(req.query.limit, 20);
  const orders = await orderRepository.listNew(limit);
  return sendJson(res, orders);
});

adminRouter.get("/orders/recent", async (req, res) => {
  const limit = parseLimit(req.query.limit, 12);
  const orders = await orderRepository.listRecent(limit);
  return sendJson(res, orders);
});

adminRouter.get("/orders/history", async (req, res) => {
  const limit = parseLimit(req.query.limit, 12);
  const orders = await orderRepository.listAssignedHistory(limit);
  return sendJson(res, orders);
});

adminRouter.get("/orders/deposit-pending", async (req, res) => {
  const limit = parseLimit(req.query.limit, 12);
  const orders = await prisma.order.findMany({
    where: {
      status: ORDER_STATUS_AWAITING_DEPOSIT,
      depositStatus: ORDER_DEPOSIT_STATUS.PENDING_VERIFICATION,
    },
    include: {
      customer: { include: { user: true } },
      region: true,
      category: true,
      carrier: { include: { user: true } },
      vehicle: true,
    },
    orderBy: { depositSubmittedAt: "desc" },
    take: limit,
  });

  return sendJson(res, orders);
});

adminRouter.get("/carriers", async (req, res) => {
  const carriers = await carrierRepository.listAll();
  return sendJson(res, carriers);
});

adminRouter.get("/carriers/pending", async (req, res) => {
  const limit = parseLimit(req.query.limit, 12);
  const carriers = await carrierRepository.listPendingApproval(limit);
  return sendJson(res, carriers);
});

adminRouter.get("/overview", async (_req, res) => {
  const [
    totalOrders,
    newOrders,
    awaitingDepositOrders,
    acceptedOrders,
    inProgressOrders,
    completedOrders,
    cancelledOrders,
    depositPendingVerificationOrders,
    totalCarriers,
    pendingCarriers,
    approvedCarriers,
    rejectedCarriers,
    bannedCarriers,
    totalCustomers,
    totalRegions,
    totalCategories,
    totalPricingRules,
    orderPriceAggregate,
    activeMobileSessions,
    protectedDevices,
    challengesLast24h,
    revokedSessionsLast24h,
  ] = await Promise.all([
    prisma.order.count(),
    prisma.order.count({ where: { status: "NEW" } }),
    prisma.order.count({ where: { status: ORDER_STATUS_AWAITING_DEPOSIT } }),
    prisma.order.count({ where: { status: "ACCEPTED" } }),
    prisma.order.count({ where: { status: "IN_PROGRESS" } }),
    prisma.order.count({ where: { status: "COMPLETED" } }),
    prisma.order.count({ where: { status: "CANCELLED" } }),
    prisma.order.count({ where: { depositStatus: ORDER_DEPOSIT_STATUS.PENDING_VERIFICATION } }),
    prisma.carrier.count(),
    prisma.carrier.count({ where: { status: "PENDING_APPROVAL" } }),
    prisma.carrier.count({ where: { status: "APPROVED" } }),
    prisma.carrier.count({ where: { status: "REJECTED" } }),
    prisma.carrier.count({ where: { status: "BANNED" } }),
    prisma.customer.count(),
    prisma.region.count(),
    prisma.category.count(),
    prisma.pricingRule.count(),
    prisma.order.aggregate({
      _avg: { price: true },
      _sum: { price: true },
    }),
    prisma.mobileSession.count({
      where: {
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    }),
    prisma.mobileSession.count({
      where: {
        revokedAt: null,
        expiresAt: { gt: new Date() },
        deviceId: { not: null },
      },
    }),
    prisma.mobileAuthChallenge.count({
      where: {
        createdAt: {
          gt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
    }),
    prisma.mobileSession.count({
      where: {
        revokedAt: {
          gt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
    }),
  ]);

  return sendJson(res, {
    generatedAt: new Date().toISOString(),
    health: {
      telegramEnabled: config.telegramEnabled,
      useWebhook: config.useWebhook,
      useRedisQueue: config.useRedisQueue,
    },
    security: {
      otpEnabled: true,
      accessTokenTtlMinutes: config.mobileAccessTokenTtlMinutes,
      refreshTokenTtlHours: config.mobileRefreshTokenTtlHours,
      activeMobileSessions,
      protectedDevices,
      challengesLast24h,
      revokedSessionsLast24h,
    },
    orders: {
      total: totalOrders,
      new: newOrders,
      awaitingDeposit: awaitingDepositOrders,
      accepted: acceptedOrders,
      inProgress: inProgressOrders,
      completed: completedOrders,
      cancelled: cancelledOrders,
      depositPendingVerification: depositPendingVerificationOrders,
      averagePrice: Math.round(orderPriceAggregate._avg.price ?? 0),
      grossVolume: Math.round(orderPriceAggregate._sum.price ?? 0),
    },
    carriers: {
      total: totalCarriers,
      pending: pendingCarriers,
      approved: approvedCarriers,
      rejected: rejectedCarriers,
      banned: bannedCarriers,
    },
    catalog: {
      customers: totalCustomers,
      regions: totalRegions,
      categories: totalCategories,
      pricingRules: totalPricingRules,
    },
  });
});

adminRouter.post("/carriers/:id/approve", async (req, res) => {
  const id = Number(req.params.id);
  const carrier = await carrierRepository.approve(id);
  return sendJson(res, carrier);
});

adminRouter.post("/carriers/:id/reject", async (req, res) => {
  const id = Number(req.params.id);
  const carrier = await carrierRepository.reject(id);
  return sendJson(res, carrier);
});

adminRouter.post("/users/:telegramId/block", async (req, res) => {
  const telegramId = Number(req.params.telegramId);
  const user = await userRepository.findByTelegramId(telegramId);
  if (!user) {
    return res.status(404).json({ error: "Пользователь не найден" });
  }
  const carrier = await carrierRepository.findByUserId(user.id);
  if (!carrier) {
    return res.status(400).json({ error: "Через этот метод можно блокировать только перевозчиков" });
  }
  const blockedCarrier = await carrierRepository.ban(carrier.id);
  return sendJson(res, blockedCarrier);
});

adminRouter.get("/pricing", async (req, res) => {
  const rules = await pricingRuleRepository.listAll();
  return sendJson(res, rules);
});

adminRouter.post("/pricing/:vehicleType", async (req, res) => {
  const vehicleType = String(req.params.vehicleType).toUpperCase();
  const { basePrice, pricePerKm, pricePerHour, minPrice } = req.body as Record<string, unknown>;

  const rule = await pricingRuleRepository.upsert({
    vehicleType,
    basePrice: Number(basePrice ?? 0),
    pricePerKm: Number(pricePerKm ?? 0),
    pricePerHour: Number(pricePerHour ?? 0),
    minPrice: Number(minPrice ?? 0),
  });

  return sendJson(res, rule);
});

adminRouter.post("/orders/:id/deposit/verify", async (req, res) => {
  const orderId = Number(req.params.id);
  const note = parseOptionalNote((req.body as Record<string, unknown> | undefined)?.note);
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      customer: { include: { user: true } },
      region: true,
      category: true,
      carrier: { include: { user: true } },
      vehicle: true,
    },
  });

  if (!order) {
    return res.status(404).json({ error: "Заказ не найден" });
  }

  if (order.status !== ORDER_STATUS_AWAITING_DEPOSIT || order.depositStatus !== ORDER_DEPOSIT_STATUS.PENDING_VERIFICATION) {
    return res.status(400).json({ error: "Заказ не ожидает подтверждения депозита" });
  }

  const verifiedAt = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const savedOrder = await tx.order.update({
      where: { id: orderId },
      data: {
        status: "ACCEPTED",
        depositStatus: ORDER_DEPOSIT_STATUS.PAID,
        depositVerifiedAt: verifiedAt,
        contactsUnlockedAt: verifiedAt,
        depositVerificationNote: note,
      },
      include: {
        customer: { include: { user: true } },
        region: true,
        category: true,
        carrier: { include: { user: true } },
        vehicle: true,
      },
    });

    await tx.orderEvent.create({
      data: {
        orderId,
        actorRole: "ADMIN",
        actorLabel: "Admin panel",
        eventType: "DEPOSIT_VERIFIED",
        message: "Депозит подтвержден, контакты раскрыты обеим сторонам.",
        payload: JSON.stringify({
          note,
          verifiedAt: verifiedAt.toISOString(),
        }),
      },
    });

    return savedOrder;
  });

  return sendJson(res, updated);
});

adminRouter.post("/orders/:id/deposit/reject", async (req, res) => {
  const orderId = Number(req.params.id);
  const note = parseOptionalNote((req.body as Record<string, unknown> | undefined)?.note);
  const order = await prisma.order.findUnique({ where: { id: orderId } });

  if (!order) {
    return res.status(404).json({ error: "Заказ не найден" });
  }

  if (order.status !== ORDER_STATUS_AWAITING_DEPOSIT || order.depositStatus !== ORDER_DEPOSIT_STATUS.PENDING_VERIFICATION) {
    return res.status(400).json({ error: "Заказ не ожидает подтверждения депозита" });
  }

  const rejectedAt = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const savedOrder = await tx.order.update({
      where: { id: orderId },
      data: {
        depositStatus: ORDER_DEPOSIT_STATUS.REJECTED,
        depositRejectedAt: rejectedAt,
        depositVerificationNote: note,
      },
      include: {
        customer: { include: { user: true } },
        region: true,
        category: true,
        carrier: { include: { user: true } },
        vehicle: true,
      },
    });

    await tx.orderEvent.create({
      data: {
        orderId,
        actorRole: "ADMIN",
        actorLabel: "Admin panel",
        eventType: "DEPOSIT_REJECTED",
        message: "Платежка отклонена, перевозчику нужен повторный перевод или новая платежка.",
        payload: JSON.stringify({
          note,
          rejectedAt: rejectedAt.toISOString(),
        }),
      },
    });

    return savedOrder;
  });

  return sendJson(res, updated);
});
