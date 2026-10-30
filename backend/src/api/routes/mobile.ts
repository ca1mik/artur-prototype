import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { requireMobileAuth, type MobileAuthedRequest } from "../mobileAuth";
import { config } from "../../config";
import { prisma } from "../../database/prisma";
import { MobileAuthChallengeService } from "../../services/mobileAuthChallengeService";
import { MobileSessionService } from "../../services/mobileSessionService";
import { RegionRepository } from "../../repositories/regionRepository";
import { CategoryRepository } from "../../repositories/categoryRepository";
import { PricingService } from "../../services/pricingService";
import { OrderRepository } from "../../repositories/orderRepository";
import { OrderOfferRepository } from "../../repositories/orderOfferRepository";
import { CarrierRepository } from "../../repositories/carrierRepository";
import { CarrierService } from "../../services/carrierService";
import { VehicleRepository } from "../../repositories/vehicleRepository";
import { RouteEstimationError, RouteService } from "../../services/routeService";
import { normalizeAddressInput } from "../../utils/orderInput";
import { formatPhoneNumber } from "../../utils/phone";
import {
  calculateDepositAmount,
  DEFAULT_ORDER_DEPOSIT_PAYER_ROLE,
  DEFAULT_ORDER_DEPOSIT_PERCENT,
  isContactsUnlocked,
  ORDER_DEPOSIT_STATUS,
  ORDER_STATUS_AWAITING_DEPOSIT,
} from "../../utils/orderDeal";
import { buildOrderClosingDocument, buildOrderDispatch, buildOrderReturnTrip } from "../../utils/orderDocument";
import { validatePassengerTripRules } from "../../utils/orderRules";
import { CARGO_VEHICLE_TYPES, PASSENGER_VEHICLE_TYPES, VEHICLE_LABELS, VEHICLE_TYPES } from "../../utils/transport";

const router = Router();
const mobileAuthChallengeService = new MobileAuthChallengeService();
const mobileSessionService = new MobileSessionService();
const regionRepository = new RegionRepository();
const categoryRepository = new CategoryRepository();
const pricingService = new PricingService();
const orderRepository = new OrderRepository();
const orderOfferRepository = new OrderOfferRepository();
const carrierRepository = new CarrierRepository();
const carrierService = new CarrierService();
const vehicleRepository = new VehicleRepository();
const routeService = new RouteService();

const authChallengeSchema = z.object({
  role: z.enum(["CUSTOMER", "CARRIER"]),
  name: z.string().min(2),
  phone: z.string().min(7),
});

const authVerifySchema = z.object({
  challengeId: z.string().min(10),
  code: z.string().min(4).max(8),
  deviceId: z.string().min(6).max(120).optional(),
  deviceName: z.string().min(2).max(120).optional(),
  platform: z.string().min(2).max(40).optional(),
});

const authRefreshSchema = z.object({
  refreshToken: z.string().min(20),
});

const orderQuoteSchema = z.object({
  regionId: z.number().int().positive(),
  categoryId: z.number().int().positive(),
  vehicleType: z.enum([
    "CAR",
    "MINIVAN",
    "MINIBUS",
    "BUS",
    "GAZELLE",
    "TRUCK",
    "TRAILER",
    "SPECIAL",
  ]),
  routeFrom: z.string().min(3),
  routeFromLat: z.number().min(-90).max(90).optional(),
  routeFromLng: z.number().min(-180).max(180).optional(),
  routeTo: z.string().min(3),
  routeToLat: z.number().min(-90).max(90).optional(),
  routeToLng: z.number().min(-180).max(180).optional(),
  date: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  adultsCount: z.number().int().min(0).optional(),
  childrenCount: z.number().int().min(0).optional(),
  passengersCount: z.number().int().positive().optional(),
  cargoDescription: z.string().optional(),
  weight: z.number().nonnegative().optional(),
  volume: z.number().nonnegative().optional(),
  comment: z.string().max(500).optional(),
});

const customerCounterSchema = z.object({
  proposedPrice: z.number().positive(),
});

const carrierProfileSchema = z.object({
  fullName: z.string().min(2),
  phone: z.string().min(7).optional(),
  regionIds: z.array(z.number().int().positive()).min(1),
});

const carrierRegistrationSchema = z.object({
  fullName: z.string().min(2),
  phone: z.string().min(7),
  regionIds: z.array(z.number().int().positive()).min(1),
  vehicleType: z.enum([
    "CAR",
    "MINIVAN",
    "MINIBUS",
    "BUS",
    "GAZELLE",
    "TRUCK",
    "TRAILER",
    "SPECIAL",
  ]),
  brand: z.string().min(1),
  capacity: z.number().int().positive(),
  plateNumber: z.string().min(1),
  description: z.string().min(3),
  features: z.string().max(300).optional(),
  photos: z.array(z.string()).max(8).optional(),
});

const carrierOfferSchema = z.object({
  proposedPrice: z.number().positive(),
  pickupEtaText: z.string().max(40).optional(),
  note: z.string().max(500).optional(),
});

const carrierOrderStatusSchema = z.object({
  status: z.enum(["IN_PROGRESS", "COMPLETED", "CANCELLED"]),
});

const carrierDepositSubmissionSchema = z.object({
  paymentReference: z.string().min(3).max(120),
  note: z.string().max(500).optional(),
});

const carrierDispatchSchema = z.object({
  vehicleId: z.number().int().positive().optional(),
  driverName: z.string().min(2).max(120),
  driverPhone: z.string().min(7).max(40),
});

const customerReturnOrderSchema = z.object({
  date: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
  routeTo: z.string().min(3).max(240).optional(),
  routeToLat: z.number().min(-90).max(90).optional(),
  routeToLng: z.number().min(-180).max(180).optional(),
  comment: z.string().max(500).optional(),
});

const vehicleUpdateSchema = z.object({
  vehicleType: z.enum([
    "CAR",
    "MINIVAN",
    "MINIBUS",
    "BUS",
    "GAZELLE",
    "TRUCK",
    "TRAILER",
    "SPECIAL",
  ]),
  brand: z.string().min(1),
  capacity: z.number().int().positive(),
  plateNumber: z.string().min(1),
  description: z.string().min(3),
  features: z.string().max(300).optional(),
  photos: z.array(z.string()).max(8).optional(),
  isActive: z.boolean().optional(),
});

const authChallengeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const authVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
});

const parseBody = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new Error(result.error.errors.map((item) => item.message).join(", "));
  }
  return result.data;
};

const createHttpError = (statusCode: number, message: string) =>
  Object.assign(new Error(message), { statusCode });

const sendJson = (res: any, payload: unknown) =>
  res.type("application/json").send(
    JSON.stringify(payload, (_key, value) => (typeof value === "bigint" ? value.toString() : value))
  );

const asyncHandler =
  (handler: (req: any, res: any) => Promise<any>) =>
  async (req: any, res: any) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof RouteEstimationError) {
        return res.status(422).json({ error: error.message, code: error.code });
      }
      const message = error instanceof Error ? error.message : "Unexpected server error";
      const explicitStatusCode = typeof (error as { statusCode?: unknown })?.statusCode === "number"
        ? Number((error as { statusCode: number }).statusCode)
        : null;
      const statusCode = explicitStatusCode ?? (
        message.includes("not found") || message.includes("was not found")
          ? 404
          : message.includes("not approved") || message.includes("not allowed")
            ? 403
            : message.includes("required") || message.includes("valid") || message.includes("must")
              ? 400
              : 500
      );
      return res.status(statusCode).json({ error: message });
    }
  };

const getAuthedUserId = (req: MobileAuthedRequest) => {
  if (!req.mobileUser?.userId) {
    throw new Error("Authenticated user is required");
  }
  return req.mobileUser.userId;
};

const getAuthedSessionId = (req: MobileAuthedRequest) => {
  if (!req.mobileUser?.sessionId) {
    throw new Error("Authenticated session is required");
  }
  return req.mobileUser.sessionId;
};

const getClientContext = (req: any) => ({
  ipAddress: req.ip ?? req.socket?.remoteAddress ?? null,
  userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null,
});

const getCustomerByUserId = async (userId: number) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { customer: true },
  });
  if (!user?.customer) {
    throw createHttpError(404, "Customer profile not found");
  }
  return user.customer;
};

const getCarrierByUserId = async (userId: number) => {
  const carrier = await carrierRepository.findByUserId(userId);
  if (!carrier) {
    throw createHttpError(404, "Carrier profile not found");
  }
  return carrier;
};

const getVehicleCapacityMinimum = (payload: z.infer<typeof orderQuoteSchema>) => {
  if (PASSENGER_VEHICLE_TYPES.includes(payload.vehicleType)) {
    const adults = payload.adultsCount ?? 0;
    const children = payload.childrenCount ?? 0;
    return payload.passengersCount ?? adults + children;
  }
  return 1;
};

const estimateOrderFinancials = async (payload: z.infer<typeof orderQuoteSchema>) => {
  const region = await prisma.region.findUnique({ where: { id: payload.regionId } });
  if (!region) {
    throw createHttpError(404, "Region not found");
  }

  const route = await routeService.estimateRoute({
    routeFrom: normalizeAddressInput(payload.routeFrom),
    routeFromLat: payload.routeFromLat,
    routeFromLng: payload.routeFromLng,
    routeTo: normalizeAddressInput(payload.routeTo),
    routeToLat: payload.routeToLat,
    routeToLng: payload.routeToLng,
    regionName: region.name,
  });

  const suggestedPrice =
    (await pricingService.calculateSuggestedPrice(
      payload.vehicleType,
      route.estimatedDistanceKm,
      route.estimatedDurationHours
    )) ?? 0;

  return {
    route,
    suggestedPrice,
  };
};

const getValidatedPassengersCount = (
  payload: z.infer<typeof orderQuoteSchema>,
  estimatedDurationHours?: number
) => {
  if (!PASSENGER_VEHICLE_TYPES.includes(payload.vehicleType)) {
    return getVehicleCapacityMinimum(payload);
  }

  try {
    return validatePassengerTripRules({
      departureAt: new Date(payload.date),
      durationHours: estimatedDurationHours,
      adultsCount: payload.adultsCount,
      childrenCount: payload.childrenCount,
      leadHours: config.childTripLeadHours,
      nightStartHour: config.childTripNightStartHour,
      nightEndHour: config.childTripNightEndHour,
    });
  } catch (error) {
    throw createHttpError(400, error instanceof Error ? error.message : "Passenger trip validation failed");
  }
};

const buildCustomerOrderPayload = async (payload: z.infer<typeof orderQuoteSchema>) => {
  const { route, suggestedPrice } = await estimateOrderFinancials(payload);
  const passengersCount = getValidatedPassengersCount(payload, route.estimatedDurationHours);
  return {
    regionId: payload.regionId,
    categoryId: payload.categoryId,
    vehicleType: payload.vehicleType,
    routeFrom: normalizeAddressInput(payload.routeFrom),
    routeFromLat: route.routeFromLat,
    routeFromLng: route.routeFromLng,
    routeTo: normalizeAddressInput(payload.routeTo),
    routeToLat: route.routeToLat,
    routeToLng: route.routeToLng,
    date: new Date(payload.date),
    price: suggestedPrice,
    suggestedPrice,
    estimatedDistanceKm: route.estimatedDistanceKm,
    estimatedDurationHours: route.estimatedDurationHours,
    comment: payload.comment?.trim() || null,
    adultsCount: payload.adultsCount ?? null,
    childrenCount: payload.childrenCount ?? null,
    passengersCount,
    cargoDescription: CARGO_VEHICLE_TYPES.includes(payload.vehicleType) ? payload.cargoDescription?.trim() || null : null,
    weight: payload.weight ?? null,
    volume: payload.volume ?? null,
    pickupEtaText: null,
  };
};

const mobileOrderInclude = {
  customer: { include: { user: true } },
  region: true,
  category: true,
  carrier: { include: { user: true, vehicles: true } },
  vehicle: true,
  returnSourceOrder: {
    select: {
      id: true,
      status: true,
      routeFrom: true,
      routeTo: true,
      date: true,
    },
  },
  returnOrders: {
    select: {
      id: true,
      status: true,
      routeFrom: true,
      routeTo: true,
      date: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" as const },
    take: 3,
  },
  offers: {
    include: {
      carrier: { include: { user: true, vehicles: true } },
      customer: { include: { user: true } },
    },
    orderBy: { updatedAt: "desc" as const },
  },
  events: {
    orderBy: { createdAt: "desc" as const },
    take: 6,
  },
};

const toSafePhone = (value?: string | null) => {
  if (!value) {
    return null;
  }

  return formatPhoneNumber(value) ?? value;
};

const toSafeName = (value?: string | null) => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const serializeOrderOffer = (
  offer: any,
  contactsUnlocked: boolean
) => ({
  ...offer,
  carrier: offer.carrier
    ? {
        id: offer.carrier.id,
        fullName: contactsUnlocked ? toSafeName(offer.carrier.fullName) : null,
        user: {
          phone: contactsUnlocked ? toSafePhone(offer.carrier.user?.phone ?? null) : null,
        },
      }
    : undefined,
});

const serializeOrderForViewer = (
  order: any,
  viewer: { role: "CUSTOMER" | "CARRIER"; customerId?: number; carrierId?: number }
) => {
  const contactsUnlocked = isContactsUnlocked(order);
  const carrierName =
    order.carrierNameSnapshot ??
    order.carrier?.fullName ??
    order.offers?.find((offer: any) => offer.id === order.selectedOfferId)?.carrier?.fullName ??
    null;
  const carrierPhone =
    order.carrierContactSnapshot ??
    order.carrier?.user?.phone ??
    order.offers?.find((offer: any) => offer.id === order.selectedOfferId)?.carrier?.user?.phone ??
    null;
  const customerName = order.customerNameSnapshot ?? order.customer?.name ?? null;
  const customerPhone = order.customerContactSnapshot ?? order.customer?.user?.phone ?? null;
  const contactAccess = contactsUnlocked ? "UNLOCKED" : "LOCKED";
  const dispatch = buildOrderDispatch(order, { showDriverContacts: contactsUnlocked || viewer.role === "CARRIER" });
  const returnTrip = buildOrderReturnTrip(order);
  const closingDocument = buildOrderClosingDocument(order, viewer.role);

  return {
    ...order,
    carrier: order.carrier
      ? {
          id: order.carrier.id,
          fullName: contactsUnlocked ? toSafeName(carrierName) : null,
        }
      : null,
    customer:
      viewer.role === "CUSTOMER"
        ? order.customer
          ? {
              id: order.customer.id,
              name: toSafeName(customerName),
            }
          : null
        : contactsUnlocked
          ? order.customer
            ? {
                id: order.customer.id,
                name: toSafeName(customerName),
                phone: toSafePhone(customerPhone),
              }
            : null
          : null,
    offers: Array.isArray(order.offers) ? order.offers.map((offer: any) => serializeOrderOffer(offer, contactsUnlocked)) : [],
    deal: {
      selectedOfferId: order.selectedOfferId ?? null,
      depositPercent: order.depositPercent ?? DEFAULT_ORDER_DEPOSIT_PERCENT,
      depositAmount: order.depositAmount ?? null,
      depositPayerRole: order.depositPayerRole ?? null,
      depositStatus: order.depositStatus ?? ORDER_DEPOSIT_STATUS.NOT_REQUIRED,
      depositReference: contactsUnlocked ? order.depositReference ?? null : null,
      depositRequestedAt: order.depositRequestedAt ?? null,
      depositSubmittedAt: order.depositSubmittedAt ?? null,
      depositVerifiedAt: order.depositVerifiedAt ?? null,
      depositRejectedAt: order.depositRejectedAt ?? null,
      depositVerificationNote: order.depositVerificationNote ?? null,
      customerConfirmedAt: order.customerConfirmedAt ?? null,
      contactsUnlockedAt: order.contactsUnlockedAt ?? null,
      contactAccess,
      sharedContacts: {
        customerName: contactsUnlocked ? toSafeName(customerName) : null,
        customerPhone: contactsUnlocked ? toSafePhone(customerPhone) : null,
        carrierName: contactsUnlocked ? toSafeName(carrierName) : null,
        carrierPhone: contactsUnlocked ? toSafePhone(carrierPhone) : null,
      },
    },
    dispatch,
    returnTrip,
    closingDocument,
    timeline: Array.isArray(order.events)
      ? order.events.map((event: any) => ({
          id: event.id,
          eventType: event.eventType,
          actorRole: event.actorRole,
          actorLabel: event.actorLabel ?? null,
          message: event.message,
          createdAt: event.createdAt,
        }))
      : [],
  };
};

const listOpenCarrierOrders = async (carrierId: number) => {
  const carrier = await prisma.carrier.findUnique({
    where: { id: carrierId },
    include: {
      vehicles: true,
      carrierRegions: true,
      region: true,
    },
  });

  if (!carrier) {
    throw new Error("Carrier profile not found");
  }

  const activeVehicles = carrier.vehicles.filter((vehicle) => vehicle.isActive);
  const vehicleTypes = Array.from(new Set(activeVehicles.map((vehicle) => vehicle.type)));
  const regionIds = Array.from(
    new Set([carrier.regionId, ...carrier.carrierRegions.map((item) => item.regionId)].filter((value): value is number => typeof value === "number"))
  );

  if (carrier.status !== "APPROVED" || vehicleTypes.length === 0 || regionIds.length === 0) {
    return [];
  }

  const orders = await prisma.order.findMany({
    where: {
      status: "NEW",
      regionId: { in: regionIds },
      vehicleType: { in: vehicleTypes },
    },
    include: {
      customer: { include: { user: true } },
      region: true,
      category: true,
      carrier: { include: { user: true, vehicles: true } },
      vehicle: true,
      offers: {
        where: { carrierId },
        include: {
          carrier: { include: { user: true, vehicles: true } },
          customer: { include: { user: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
      events: {
        orderBy: { createdAt: "desc" },
        take: 6,
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return orders.filter((order) => {
    const minimumCapacity = order.passengersCount ?? 1;
    return activeVehicles.some(
      (vehicle) => vehicle.type === order.vehicleType && (vehicle.capacity == null || vehicle.capacity >= minimumCapacity)
    );
  });
};

router.get(
  "/bootstrap",
  asyncHandler(async (_req, res) => {
    const [regions, categories, pricingRules] = await Promise.all([
      regionRepository.listAll(),
      categoryRepository.listAll(),
      pricingService.listRules(),
    ]);

    return sendJson(res, {
      regions,
      categories,
      pricingRules,
      vehicleTypes: VEHICLE_TYPES.map((value) => ({
        value,
        label: VEHICLE_LABELS[value] ?? value,
        kind: PASSENGER_VEHICLE_TYPES.includes(value) ? "PASSENGER" : "CARGO",
      })),
    });
  })
);

router.post(
  "/auth/challenge",
  authChallengeLimiter,
  asyncHandler(async (req, res) => {
    const payload = parseBody(authChallengeSchema, req.body);
    const challenge = await mobileAuthChallengeService.createChallenge({
      ...payload,
      ...getClientContext(req),
    });
    return sendJson(res, challenge);
  })
);

router.post(
  "/auth/verify",
  authVerifyLimiter,
  asyncHandler(async (req, res) => {
    const payload = parseBody(authVerifySchema, req.body);
    const verifiedIdentity = await mobileAuthChallengeService.verifyChallenge({
      challengeId: payload.challengeId,
      code: payload.code,
    });
    const session = await mobileSessionService.createSessionForVerifiedIdentity(verifiedIdentity, {
      deviceId: payload.deviceId,
      deviceName: payload.deviceName,
      platform: payload.platform,
      ...getClientContext(req),
    });
    return sendJson(res, session);
  })
);

router.post(
  "/auth/refresh",
  authVerifyLimiter,
  asyncHandler(async (req, res) => {
    const payload = parseBody(authRefreshSchema, req.body);
    const session = await mobileSessionService.refreshSession(payload.refreshToken, getClientContext(req));
    return sendJson(res, session);
  })
);

router.post(
  "/auth/logout",
  requireMobileAuth(),
  asyncHandler(async (req: MobileAuthedRequest, res) => {
    await mobileSessionService.revokeSession(getAuthedSessionId(req));
    return res.status(204).send();
  })
);

router.get(
  "/me",
  requireMobileAuth(),
  asyncHandler(async (req: MobileAuthedRequest, res) => {
    const userId = getAuthedUserId(req);
    const profile = await mobileSessionService.getProfile(userId);
    if (!profile) {
      return res.status(404).json({ error: "User was not found" });
    }
    return sendJson(res, profile);
  })
);

router.post(
  "/customer/orders/quote",
  requireMobileAuth("CUSTOMER"),
  asyncHandler(async (req, res) => {
    const payload = parseBody(orderQuoteSchema, req.body);
    const quote = await estimateOrderFinancials(payload);
    getValidatedPassengersCount(payload, quote.route.estimatedDurationHours);
    return sendJson(res, quote);
  })
);

router.post(
  "/customer/orders",
  requireMobileAuth("CUSTOMER"),
  asyncHandler(async (req: MobileAuthedRequest, res) => {
    const userId = getAuthedUserId(req);
    const customer = await getCustomerByUserId(userId);
    const payload = parseBody(orderQuoteSchema, req.body);
    const orderPayload = await buildCustomerOrderPayload(payload);
    const order = await prisma.order.create({
      data: {
        customerId: customer.id,
        ...orderPayload,
      },
      include: mobileOrderInclude,
    });
    return sendJson(res, serializeOrderForViewer(order, { role: "CUSTOMER", customerId: customer.id }));
  })
);

router.get(
  "/customer/orders",
  requireMobileAuth("CUSTOMER"),
  asyncHandler(async (req: MobileAuthedRequest, res) => {
    const userId = getAuthedUserId(req);
    const customer = await getCustomerByUserId(userId);
    const orders = await prisma.order.findMany({
      where: { customerId: customer.id },
      include: mobileOrderInclude,
      orderBy: { createdAt: "desc" },
    });
    return sendJson(
      res,
      orders.map((order) => serializeOrderForViewer(order, { role: "CUSTOMER", customerId: customer.id }))
    );
  })
);

router.get(
  "/customer/orders/:orderId/offers",
  requireMobileAuth("CUSTOMER"),
  asyncHandler(async (req: MobileAuthedRequest, res) => {
    const userId = getAuthedUserId(req);
    const customer = await getCustomerByUserId(userId);
    const orderId = Number(req.params.orderId);
    const order = await prisma.order.findFirst({
      where: { id: orderId, customerId: customer.id },
    });
    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }
    const offers = await orderOfferRepository.listByOrderId(orderId);
    return sendJson(
      res,
      offers.map((offer) => serializeOrderOffer(offer, isContactsUnlocked(order)))
    );
  })
);

router.post(
  "/customer/offers/:offerId/accept",
  requireMobileAuth("CUSTOMER"),
  asyncHandler(async (req: MobileAuthedRequest, res) => {
    const userId = getAuthedUserId(req);
    const customer = await getCustomerByUserId(userId);
    const offerId = Number(req.params.offerId);
    const offer = await orderOfferRepository.findById(offerId);
    if (!offer || offer.customerId !== customer.id) {
      return res.status(404).json({ error: "Offer not found" });
    }
    if (!["ACTIVE", "COUNTERED"].includes(offer.status)) {
      throw createHttpError(409, "Offer is no longer available");
    }

    if (offer.order.status !== "NEW") {
      throw createHttpError(409, "Order is no longer available for confirmation");
    }

    const minimumCapacity = offer.order.passengersCount ?? 1;
    const selectedVehicle = await vehicleRepository.findBestMatch(offer.carrierId, offer.order.vehicleType, minimumCapacity);
    const depositAmount = calculateDepositAmount(offer.proposedPrice, DEFAULT_ORDER_DEPOSIT_PERCENT);
    const confirmationMoment = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.orderOffer.update({
        where: { id: offerId },
        data: {
          status: "ACCEPTED",
          lastActor: "CUSTOMER",
        },
      });

      await tx.orderOffer.updateMany({
        where: {
          orderId: offer.orderId,
          carrierId: { not: offer.carrierId },
          status: { in: ["ACTIVE", "COUNTERED"] },
        },
        data: {
          status: "REJECTED",
        },
      });

      await tx.order.update({
        where: { id: offer.orderId },
        data: {
          status: ORDER_STATUS_AWAITING_DEPOSIT,
          carrierId: offer.carrierId,
          vehicleId: selectedVehicle?.id,
          price: offer.proposedPrice,
          pickupEtaText: offer.pickupEtaText ?? undefined,
          selectedOfferId: offer.id,
          customerConfirmedAt: confirmationMoment,
          depositPercent: DEFAULT_ORDER_DEPOSIT_PERCENT,
          depositAmount,
          depositPayerRole: DEFAULT_ORDER_DEPOSIT_PAYER_ROLE,
          depositStatus: ORDER_DEPOSIT_STATUS.PENDING_PAYMENT,
          depositRequestedAt: confirmationMoment,
          depositSubmittedAt: null,
          depositVerifiedAt: null,
          depositRejectedAt: null,
          depositReference: null,
          depositVerificationNote: null,
          contactsUnlockedAt: null,
          customerNameSnapshot: offer.customer.name,
          customerContactSnapshot: offer.customer.user.phone ?? null,
          carrierNameSnapshot: offer.carrier.fullName ?? null,
          carrierContactSnapshot: offer.carrier.user.phone ?? null,
          vehicleBrandSnapshot: selectedVehicle?.brand ?? null,
          vehiclePlateSnapshot: selectedVehicle?.plateNumber ?? null,
        },
      });

      await tx.orderEvent.createMany({
        data: [
          {
            orderId: offer.orderId,
            actorRole: "CUSTOMER",
            actorLabel: offer.customer.name,
            eventType: "OFFER_CONFIRMED",
            message: "Заказчик подтвердил выбранный оффер.",
            payload: JSON.stringify({
              offerId: offer.id,
              carrierId: offer.carrierId,
              proposedPrice: offer.proposedPrice,
            }),
          },
          {
            orderId: offer.orderId,
            actorRole: "SYSTEM",
            actorLabel: "ARTUR PRO",
            eventType: "DEPOSIT_REQUESTED",
            message: `Для перевозчика открыт резерв ${depositAmount} ₽ (${DEFAULT_ORDER_DEPOSIT_PERCENT}%).`,
            payload: JSON.stringify({
              offerId: offer.id,
              depositAmount,
              depositPercent: DEFAULT_ORDER_DEPOSIT_PERCENT,
              depositPayerRole: DEFAULT_ORDER_DEPOSIT_PAYER_ROLE,
            }),
          },
        ],
      });
    });

    const updatedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: offer.orderId },
      include: mobileOrderInclude,
    });
    return sendJson(res, serializeOrderForViewer(updatedOrder, { role: "CUSTOMER", customerId: customer.id }));
  })
);

router.post(
  "/customer/orders/:orderId/return",
  requireMobileAuth("CUSTOMER"),
  asyncHandler(async (req: MobileAuthedRequest, res) => {
    const userId = getAuthedUserId(req);
    const customer = await getCustomerByUserId(userId);
    const orderId = Number(req.params.orderId);
    const payload = parseBody(customerReturnOrderSchema, req.body);
    const sourceOrder = await prisma.order.findFirst({
      where: {
        id: orderId,
        customerId: customer.id,
      },
      include: mobileOrderInclude,
    });

    if (!sourceOrder) {
      throw createHttpError(404, "Order not found");
    }

    if (!sourceOrder.carrierId) {
      throw createHttpError(409, "Carrier is not assigned yet");
    }

    if (!["ACCEPTED", "IN_PROGRESS", "COMPLETED"].includes(sourceOrder.status)) {
      throw createHttpError(409, "Return trip is available only after the main order is confirmed");
    }

    const existingReturnOrder = await prisma.order.findFirst({
      where: {
        returnSourceOrderId: sourceOrder.id,
        status: { in: [ORDER_STATUS_AWAITING_DEPOSIT, "ACCEPTED", "IN_PROGRESS"] },
      },
      orderBy: { createdAt: "desc" },
    });

    if (existingReturnOrder) {
      throw createHttpError(409, `Return trip already exists for this order (#${existingReturnOrder.id})`);
    }

    const requestedAt = new Date();
    const totalPrice = sourceOrder.price ?? sourceOrder.suggestedPrice ?? 0;
    const depositAmount = calculateDepositAmount(totalPrice, DEFAULT_ORDER_DEPOSIT_PERCENT);
    const returnRouteTo = normalizeAddressInput(payload.routeTo ?? sourceOrder.routeFrom);
    const returnOrder = await prisma.$transaction(async (tx) => {
      const createdOrder = await tx.order.create({
        data: {
          customerId: sourceOrder.customerId,
          regionId: sourceOrder.regionId,
          categoryId: sourceOrder.categoryId,
          vehicleType: sourceOrder.vehicleType,
          status: ORDER_STATUS_AWAITING_DEPOSIT,
          adultsCount: sourceOrder.adultsCount,
          childrenCount: sourceOrder.childrenCount,
          passengersCount: sourceOrder.passengersCount,
          cargoDescription: sourceOrder.cargoDescription,
          weight: sourceOrder.weight,
          volume: sourceOrder.volume,
          routeFrom: normalizeAddressInput(sourceOrder.routeTo),
          routeFromLat: sourceOrder.routeToLat ?? null,
          routeFromLng: sourceOrder.routeToLng ?? null,
          routeTo: returnRouteTo,
          routeToLat: payload.routeToLat ?? sourceOrder.routeFromLat ?? null,
          routeToLng: payload.routeToLng ?? sourceOrder.routeFromLng ?? null,
          date: new Date(payload.date),
          price: totalPrice,
          suggestedPrice: sourceOrder.suggestedPrice ?? sourceOrder.price,
          depositPercent: DEFAULT_ORDER_DEPOSIT_PERCENT,
          depositAmount,
          depositPayerRole: DEFAULT_ORDER_DEPOSIT_PAYER_ROLE,
          depositStatus: ORDER_DEPOSIT_STATUS.PENDING_PAYMENT,
          depositRequestedAt: requestedAt,
          customerConfirmedAt: requestedAt,
          customerNameSnapshot: sourceOrder.customerNameSnapshot ?? sourceOrder.customer?.name ?? null,
          customerContactSnapshot: sourceOrder.customerContactSnapshot ?? sourceOrder.customer?.user?.phone ?? null,
          carrierNameSnapshot: sourceOrder.carrierNameSnapshot ?? sourceOrder.carrier?.fullName ?? null,
          carrierContactSnapshot: sourceOrder.carrierContactSnapshot ?? sourceOrder.carrier?.user?.phone ?? null,
          driverNameSnapshot: sourceOrder.driverNameSnapshot ?? null,
          driverPhoneSnapshot: sourceOrder.driverPhoneSnapshot ?? null,
          vehicleBrandSnapshot: sourceOrder.vehicleBrandSnapshot ?? sourceOrder.vehicle?.brand ?? null,
          vehiclePlateSnapshot: sourceOrder.vehiclePlateSnapshot ?? sourceOrder.vehicle?.plateNumber ?? null,
          estimatedDistanceKm: sourceOrder.estimatedDistanceKm,
          estimatedDurationHours: sourceOrder.estimatedDurationHours,
          pickupEtaText: sourceOrder.pickupEtaText,
          comment: payload.comment?.trim() || `Return trip for order #${sourceOrder.id}`,
          createdAt: requestedAt,
          returnSourceOrderId: sourceOrder.id,
          carrierId: sourceOrder.carrierId,
          vehicleId: sourceOrder.vehicleId,
        },
        include: mobileOrderInclude,
      });

      await tx.orderEvent.createMany({
        data: [
          {
            orderId: sourceOrder.id,
            actorRole: "CUSTOMER",
            actorLabel: sourceOrder.customerNameSnapshot ?? sourceOrder.customer?.name ?? `Customer #${sourceOrder.customerId}`,
            eventType: "RETURN_REQUESTED",
            message: `Customer requested a return trip and created order #${createdOrder.id}.`,
            payload: JSON.stringify({
              returnOrderId: createdOrder.id,
              requestedAt: requestedAt.toISOString(),
            }),
          },
          {
            orderId: createdOrder.id,
            actorRole: "SYSTEM",
            actorLabel: "ARTUR PRO",
            eventType: "RETURN_ORDER_CREATED",
            message: `Return trip created from order #${sourceOrder.id}.`,
            payload: JSON.stringify({
              sourceOrderId: sourceOrder.id,
              depositAmount,
              depositPercent: DEFAULT_ORDER_DEPOSIT_PERCENT,
            }),
          },
          {
            orderId: createdOrder.id,
            actorRole: "SYSTEM",
            actorLabel: "ARTUR PRO",
            eventType: "DEPOSIT_REQUESTED",
            message: `Carrier deposit reopened for the return trip: ${depositAmount} RUB (${DEFAULT_ORDER_DEPOSIT_PERCENT}%).`,
            payload: JSON.stringify({
              depositAmount,
              depositPercent: DEFAULT_ORDER_DEPOSIT_PERCENT,
              depositPayerRole: DEFAULT_ORDER_DEPOSIT_PAYER_ROLE,
            }),
          },
        ],
      });

      return createdOrder;
    });

    return sendJson(res, serializeOrderForViewer(returnOrder, { role: "CUSTOMER", customerId: customer.id }));
  })
);

router.post(
  "/customer/offers/:offerId/reject",
  requireMobileAuth("CUSTOMER"),
  asyncHandler(async (req: MobileAuthedRequest, res) => {
    const userId = getAuthedUserId(req);
    const customer = await getCustomerByUserId(userId);
    const offerId = Number(req.params.offerId);
    const offer = await orderOfferRepository.findById(offerId);
    if (!offer || offer.customerId !== customer.id) {
      return res.status(404).json({ error: "Offer not found" });
    }
    const updated = await orderOfferRepository.update(offerId, {
      status: "REJECTED",
      lastActor: "CUSTOMER",
    });
    return sendJson(res, updated);
  })
);

router.post(
  "/customer/offers/:offerId/counter",
  requireMobileAuth("CUSTOMER"),
  asyncHandler(async (req: MobileAuthedRequest, res) => {
    const userId = getAuthedUserId(req);
    const customer = await getCustomerByUserId(userId);
    const offerId = Number(req.params.offerId);
    const payload = parseBody(customerCounterSchema, req.body);
    const offer = await orderOfferRepository.findById(offerId);
    if (!offer || offer.customerId !== customer.id) {
      return res.status(404).json({ error: "Offer not found" });
    }
    const updated = await orderOfferRepository.update(offerId, {
      proposedPrice: payload.proposedPrice,
      status: "COUNTERED",
      lastActor: "CUSTOMER",
    });
    return sendJson(res, updated);
  })
);

router.get(
  "/carrier/profile",
  requireMobileAuth("CARRIER"),
  asyncHandler(async (req: MobileAuthedRequest, res) => {
    const userId = getAuthedUserId(req);
    const carrier = await getCarrierByUserId(userId);
    return sendJson(res, carrier);
  })
);

router.put(
  "/carrier/profile",
  requireMobileAuth("CARRIER"),
  asyncHandler(async (req: MobileAuthedRequest, res) => {
    const userId = getAuthedUserId(req);
    const payload = parseBody(carrierProfileSchema, req.body);
    const updated = await carrierService.updateProfileByUserId(userId, payload);
    return sendJson(res, updated);
  })
);

router.post(
  "/carrier/register",
  requireMobileAuth("CARRIER"),
  asyncHandler(async (req: MobileAuthedRequest, res) => {
    const userId = getAuthedUserId(req);
    const payload = parseBody(carrierRegistrationSchema, req.body);
    const carrier = await carrierService.registerCarrier(userId, payload);
    return sendJson(res, carrier);
  })
);

router.get(
  "/carrier/vehicles",
  requireMobileAuth("CARRIER"),
  asyncHandler(async (req: MobileAuthedRequest, res) => {
    const userId = getAuthedUserId(req);
    const vehicles = await carrierService.listVehiclesByUserId(userId, true);
    return sendJson(res, vehicles);
  })
);

router.post(
  "/carrier/vehicles",
  requireMobileAuth("CARRIER"),
  asyncHandler(async (req: MobileAuthedRequest, res) => {
    const userId = getAuthedUserId(req);
    const payload = parseBody(vehicleUpdateSchema, req.body);
    const vehicle = await carrierService.addVehicle(userId, {
      vehicleType: payload.vehicleType,
      brand: payload.brand,
      capacity: payload.capacity,
      plateNumber: payload.plateNumber,
      description: payload.description,
      features: payload.features,
      photos: payload.photos,
    });
    return sendJson(res, vehicle);
  })
);

router.put(
  "/carrier/vehicles/:vehicleId",
  requireMobileAuth("CARRIER"),
  asyncHandler(async (req: MobileAuthedRequest, res) => {
    const userId = getAuthedUserId(req);
    const vehicleId = Number(req.params.vehicleId);
    const payload = parseBody(vehicleUpdateSchema, req.body);
    const vehicle = await carrierService.updateVehicle(userId, vehicleId, {
      vehicleType: payload.vehicleType,
      brand: payload.brand,
      capacity: payload.capacity,
      plateNumber: payload.plateNumber,
      description: payload.description,
      features: payload.features ?? null,
      photos: payload.photos,
      isActive: payload.isActive,
    });
    return sendJson(res, vehicle);
  })
);

router.get(
  "/carrier/orders/open",
  requireMobileAuth("CARRIER"),
  asyncHandler(async (req: MobileAuthedRequest, res) => {
    const userId = getAuthedUserId(req);
    const carrier = await getCarrierByUserId(userId);
    if (carrier.status !== "APPROVED") {
      throw createHttpError(403, "Carrier is not approved yet");
    }
    const orders = await listOpenCarrierOrders(carrier.id);
    return sendJson(
      res,
      orders.map((order) => serializeOrderForViewer(order, { role: "CARRIER", carrierId: carrier.id }))
    );
  })
);

router.get(
  "/carrier/orders/active",
  requireMobileAuth("CARRIER"),
  asyncHandler(async (req: MobileAuthedRequest, res) => {
    const userId = getAuthedUserId(req);
    const carrier = await getCarrierByUserId(userId);
    const orders = await orderRepository.listActiveByCarrierId(carrier.id);
    return sendJson(
      res,
      orders.map((order) => serializeOrderForViewer(order, { role: "CARRIER", carrierId: carrier.id }))
    );
  })
);

router.get(
  "/carrier/orders/history",
  requireMobileAuth("CARRIER"),
  asyncHandler(async (req: MobileAuthedRequest, res) => {
    const userId = getAuthedUserId(req);
    const carrier = await getCarrierByUserId(userId);
    const orders = await orderRepository.listHistoryByCarrierId(carrier.id);
    return sendJson(
      res,
      orders.map((order) => serializeOrderForViewer(order, { role: "CARRIER", carrierId: carrier.id }))
    );
  })
);

router.post(
  "/carrier/orders/:orderId/offer",
  requireMobileAuth("CARRIER"),
  asyncHandler(async (req: MobileAuthedRequest, res) => {
    const userId = getAuthedUserId(req);
    const carrier = await getCarrierByUserId(userId);
    if (carrier.status !== "APPROVED") {
      throw createHttpError(403, "Carrier is not approved yet");
    }
    const orderId = Number(req.params.orderId);
    const payload = parseBody(carrierOfferSchema, req.body);
    const order = await orderRepository.findById(orderId);
    if (!order || order.status !== "NEW") {
      throw createHttpError(409, "Order is not available for offers");
    }
    const offer = await orderOfferRepository.upsert({
      orderId,
      carrierId: carrier.id,
      customerId: order.customerId,
      proposedPrice: payload.proposedPrice,
      pickupEtaText: payload.pickupEtaText,
      note: payload.note,
      status: "ACTIVE",
      lastActor: "CARRIER",
    });
    return sendJson(res, offer);
  })
);

router.post(
  "/carrier/orders/:orderId/dispatch",
  requireMobileAuth("CARRIER"),
  asyncHandler(async (req: MobileAuthedRequest, res) => {
    const userId = getAuthedUserId(req);
    const carrier = await getCarrierByUserId(userId);
    const orderId = Number(req.params.orderId);
    const payload = parseBody(carrierDispatchSchema, req.body);
    const order = await orderRepository.findCarrierOrder(orderId, carrier.id);

    if (!order) {
      throw createHttpError(404, "Order not found");
    }

    if (!["AWAITING_DEPOSIT", "ACCEPTED", "IN_PROGRESS"].includes(order.status)) {
      throw createHttpError(409, "Dispatch can be assigned only for active orders");
    }

    const selectedVehicle =
      typeof payload.vehicleId === "number"
        ? await vehicleRepository.findByCarrierAndId(carrier.id, payload.vehicleId)
        : order.vehicleId
          ? await vehicleRepository.findByCarrierAndId(carrier.id, order.vehicleId)
          : await vehicleRepository.findBestMatch(carrier.id, order.vehicleType, order.passengersCount ?? 1);

    if (payload.vehicleId && !selectedVehicle) {
      throw createHttpError(404, "Vehicle was not found in your fleet");
    }

    const updatedAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: {
          vehicleId: selectedVehicle?.id ?? order.vehicleId ?? null,
          driverNameSnapshot: payload.driverName.trim(),
          driverPhoneSnapshot: payload.driverPhone.trim(),
          vehicleBrandSnapshot: selectedVehicle?.brand ?? order.vehicleBrandSnapshot ?? order.vehicle?.brand ?? null,
          vehiclePlateSnapshot: selectedVehicle?.plateNumber ?? order.vehiclePlateSnapshot ?? order.vehicle?.plateNumber ?? null,
          carrierNameSnapshot: carrier.fullName ?? order.carrierNameSnapshot ?? null,
          carrierContactSnapshot: carrier.user?.phone ?? order.carrierContactSnapshot ?? null,
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId,
          actorRole: "CARRIER",
          actorLabel: carrier.fullName ?? `Carrier #${carrier.id}`,
          eventType: "DISPATCH_ASSIGNED",
          message: `Dispatch assigned: ${payload.driverName.trim()}${selectedVehicle?.brand ? `, ${selectedVehicle.brand}` : ""}.`,
          payload: JSON.stringify({
            driverName: payload.driverName.trim(),
            driverPhone: payload.driverPhone.trim(),
            vehicleId: selectedVehicle?.id ?? null,
            vehicleBrand: selectedVehicle?.brand ?? null,
            vehiclePlate: selectedVehicle?.plateNumber ?? null,
            updatedAt: updatedAt.toISOString(),
          }),
        },
      });
    });

    const updatedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: mobileOrderInclude,
    });
    return sendJson(res, serializeOrderForViewer(updatedOrder, { role: "CARRIER", carrierId: carrier.id }));
  })
);

router.post(
  "/carrier/orders/:orderId/status",
  requireMobileAuth("CARRIER"),
  asyncHandler(async (req: MobileAuthedRequest, res) => {
    const userId = getAuthedUserId(req);
    const carrier = await getCarrierByUserId(userId);
    const orderId = Number(req.params.orderId);
    const payload = parseBody(carrierOrderStatusSchema, req.body);
    const order = await orderRepository.findCarrierOrder(orderId, carrier.id);
    if (!order) {
      throw createHttpError(404, "Order not found");
    }

    const allowedTransitions: Record<string, string[]> = {
      ACCEPTED: ["IN_PROGRESS", "CANCELLED"],
      IN_PROGRESS: ["COMPLETED", "CANCELLED"],
    };

    if (!allowedTransitions[order.status]?.includes(payload.status)) {
      throw createHttpError(409, "Status transition is not allowed");
    }

    const updated = await orderRepository.updateCarrierOrderStatus(orderId, carrier.id, payload.status);
    return sendJson(res, serializeOrderForViewer(updated, { role: "CARRIER", carrierId: carrier.id }));
  })
);

router.post(
  "/carrier/orders/:orderId/deposit",
  requireMobileAuth("CARRIER"),
  asyncHandler(async (req: MobileAuthedRequest, res) => {
    const userId = getAuthedUserId(req);
    const carrier = await getCarrierByUserId(userId);
    const orderId = Number(req.params.orderId);
    const payload = parseBody(carrierDepositSubmissionSchema, req.body);
    const order = await prisma.order.findFirst({
      where: { id: orderId, carrierId: carrier.id },
      include: mobileOrderInclude,
    });

    if (!order) {
      throw createHttpError(404, "Order not found");
    }

    if (order.status !== ORDER_STATUS_AWAITING_DEPOSIT) {
      throw createHttpError(409, "Deposit confirmation is not required for this order");
    }

    if (!new Set<string>([ORDER_DEPOSIT_STATUS.PENDING_PAYMENT, ORDER_DEPOSIT_STATUS.REJECTED]).has(order.depositStatus)) {
      throw createHttpError(409, "Deposit is already submitted or verified");
    }

    const submittedAt = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: {
          depositStatus: ORDER_DEPOSIT_STATUS.PENDING_VERIFICATION,
          depositReference: payload.paymentReference,
          depositVerificationNote: payload.note?.trim() || null,
          depositSubmittedAt: submittedAt,
          depositRejectedAt: null,
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId,
          actorRole: "CARRIER",
          actorLabel: carrier.fullName ?? `Carrier #${carrier.id}`,
          eventType: "DEPOSIT_SUBMITTED",
          message: "Перевозчик отправил платеж на проверку.",
          payload: JSON.stringify({
            paymentReference: payload.paymentReference,
            note: payload.note?.trim() || null,
          }),
        },
      });
    });

    const updatedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: mobileOrderInclude,
    });
    return sendJson(res, serializeOrderForViewer(updatedOrder, { role: "CARRIER", carrierId: carrier.id }));
  })
);

export const mobileRouter = router;
