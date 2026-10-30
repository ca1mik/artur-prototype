import { OrderRepository } from "../repositories/orderRepository";
import { OrderOfferRepository } from "../repositories/orderOfferRepository";
import { CarrierRepository } from "../repositories/carrierRepository";
import { CustomerRepository } from "../repositories/customerRepository";
import { OrderEventRepository } from "../repositories/orderEventRepository";
import { VehicleRepository } from "../repositories/vehicleRepository";
import { config } from "../config";
import { prisma } from "../database/prisma";
import { NotificationService } from "./notificationService";
import { PricingService } from "./pricingService";
import type { OrderDto } from "../types";
import type { Telegraf } from "telegraf";
import { PASSENGER_VEHICLE_TYPES } from "../utils/transport";
import { normalizeAddressInput } from "../utils/orderInput";
import {
  calculateDepositAmount,
  DEFAULT_ORDER_DEPOSIT_PAYER_ROLE,
  DEFAULT_ORDER_DEPOSIT_PERCENT,
  ORDER_DEPOSIT_STATUS,
  ORDER_STATUS_AWAITING_DEPOSIT,
} from "../utils/orderDeal";
import { validatePassengerTripRules } from "../utils/orderRules";

export class OrderService {
  private orderRepository = new OrderRepository();
  private orderOfferRepository = new OrderOfferRepository();
  private carrierRepository = new CarrierRepository();
  private customerRepository = new CustomerRepository();
  private orderEventRepository = new OrderEventRepository();
  private vehicleRepository = new VehicleRepository();
  private notificationService = new NotificationService();
  private pricingService = new PricingService();

  async createOrder(customerId: number, payload: OrderDto, bot: Telegraf) {
    const isPassengerOrder = PASSENGER_VEHICLE_TYPES.includes(payload.vehicleType);
    const passengersCount = isPassengerOrder
      ? validatePassengerTripRules({
          departureAt: new Date(payload.date),
          durationHours: payload.estimatedDurationHours,
          adultsCount: payload.adultsCount,
          childrenCount: payload.childrenCount,
          leadHours: config.childTripLeadHours,
          nightStartHour: config.childTripNightStartHour,
          nightEndHour: config.childTripNightEndHour,
        })
      : payload.passengersCount;

    const order = await this.orderRepository.create({
      customerId,
      regionId: payload.regionId,
      categoryId: payload.categoryId,
      vehicleType: payload.vehicleType,
      routeFrom: payload.routeFrom,
      routeFromLat: payload.routeFromLat,
      routeFromLng: payload.routeFromLng,
      routeTo: payload.routeTo,
      routeToLat: payload.routeToLat,
      routeToLng: payload.routeToLng,
      date: new Date(payload.date),
      price: payload.price,
      suggestedPrice: payload.suggestedPrice,
      estimatedDistanceKm: payload.estimatedDistanceKm,
      estimatedDurationHours: payload.estimatedDurationHours,
      pickupEtaText: payload.pickupEtaText,
      comment: payload.comment,
      adultsCount: payload.adultsCount,
      childrenCount: payload.childrenCount,
      passengersCount,
      cargoDescription: payload.cargoDescription,
      weight: payload.weight,
      volume: payload.volume,
    });

    await this.notifyMatchingCarriers(bot, order.id, order.regionId, order.vehicleType, order.passengersCount ?? 1);
    return order;
  }

  async acceptOrder(bot: Telegraf, orderId: number, carrierId: number, pickupEtaText?: string, acceptedPrice?: number) {
    const order = await this.orderRepository.findById(orderId);
    if (!order || order.status !== "NEW") {
      throw new Error("Заявка недоступна для принятия");
    }
    const carrier = await this.carrierRepository.findById(carrierId);
    if (!carrier || carrier.status !== "APPROVED") {
      throw new Error("Профиль перевозчика не одобрен");
    }

    const minimumCapacity = order.passengersCount ?? 1;
    const selectedVehicle = await this.vehicleRepository.findBestMatch(carrierId, order.vehicleType, minimumCapacity);
    const confirmationMoment = new Date();
    const finalPrice = acceptedPrice ?? order.price;
    const depositAmount = calculateDepositAmount(finalPrice, DEFAULT_ORDER_DEPOSIT_PERCENT);

    const updated = await prisma.$transaction(async (tx) => {
      const savedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          status: ORDER_STATUS_AWAITING_DEPOSIT,
          carrierId,
          vehicleId: selectedVehicle?.id,
          price: finalPrice,
          pickupEtaText,
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
          customerNameSnapshot: order.customerNameSnapshot ?? order.customer?.name ?? null,
          customerContactSnapshot: order.customerContactSnapshot ?? order.customer?.user?.phone ?? null,
          carrierNameSnapshot: carrier.fullName ?? null,
          carrierContactSnapshot: carrier.user.phone ?? null,
          vehicleBrandSnapshot: selectedVehicle?.brand ?? null,
          vehiclePlateSnapshot: selectedVehicle?.plateNumber ?? null,
        },
      });

      await tx.orderEvent.createMany({
        data: [
          {
            orderId,
            actorRole: "CARRIER",
            actorLabel: carrier.fullName ?? `Carrier #${carrier.id}`,
            eventType: "DIRECT_ACCEPTED",
            message: "Перевозчик закрепил заявку по цене заказчика.",
            payload: JSON.stringify({
              carrierId,
              finalPrice,
              pickupEtaText: pickupEtaText ?? null,
            }),
          },
          {
            orderId,
            actorRole: "SYSTEM",
            actorLabel: "ARTUR PRO",
            eventType: "DEPOSIT_REQUESTED",
            message: `Для перевозчика открыт резерв ${depositAmount} ₽ (${DEFAULT_ORDER_DEPOSIT_PERCENT}%).`,
            payload: JSON.stringify({
              depositAmount,
              depositPercent: DEFAULT_ORDER_DEPOSIT_PERCENT,
              depositPayerRole: DEFAULT_ORDER_DEPOSIT_PAYER_ROLE,
            }),
          },
        ],
      });

      return savedOrder;
    });

    await this.orderOfferRepository.rejectOthers(orderId, carrierId);
    await this.notificationService.notifyOrderAwaitingCarrierDeposit(bot, orderId);
    await this.notificationService.notifyOtherCarriersOrderClosed(bot, orderId, carrierId);
    return updated;
  }

  async createCarrierOffer(bot: Telegraf, orderId: number, carrierId: number, proposedPrice: number, pickupEtaText?: string, note?: string) {
    const order = await this.orderRepository.findById(orderId);
    if (!order || order.status !== "NEW") {
      throw new Error("Order is no longer available for offers");
    }

    const carrier = await this.carrierRepository.findById(carrierId);
    if (!carrier || carrier.status !== "APPROVED") {
      throw new Error("Carrier is not approved");
    }

    const offer = await this.orderOfferRepository.upsert({
      orderId,
      carrierId,
      customerId: order.customerId,
      proposedPrice,
      pickupEtaText,
      note,
      status: "ACTIVE",
      lastActor: "CARRIER",
    });

    await this.notificationService.notifyCustomerOrderOffer(bot, offer.id);
    return offer;
  }

  async acceptOffer(bot: Telegraf, offerId: number, customerId: number) {
    const offer = await this.orderOfferRepository.findById(offerId);
    if (!offer || offer.customerId !== customerId) {
      throw new Error("Предложение не найдено");
    }

    if (!["ACTIVE", "COUNTERED"].includes(offer.status)) {
      throw new Error("Предложение уже неактуально");
    }

    const updatedOrder = await this.reserveOrderFromOffer(bot, offerId, offer, {
      actorRole: "CUSTOMER",
      actorLabel: offer.customer.name,
      eventType: "OFFER_CONFIRMED",
      message: "Заказчик подтвердил выбранный оффер.",
      finalOfferStatus: "ACCEPTED",
    });
    await this.notificationService.notifyCarrierOfferAccepted(bot, offerId);
    return updatedOrder;
  }

  async rejectOffer(bot: Telegraf, offerId: number, customerId: number) {
    const offer = await this.orderOfferRepository.findById(offerId);
    if (!offer || offer.customerId !== customerId) {
      throw new Error("Предложение не найдено");
    }

    if (!["ACTIVE", "COUNTERED"].includes(offer.status)) {
      throw new Error("Предложение уже неактуально");
    }

    const updated = await this.orderOfferRepository.update(offerId, {
      status: "REJECTED",
      lastActor: "CUSTOMER",
    });
    await this.notificationService.notifyCarrierOfferRejected(bot, offerId);
    return updated;
  }

  async counterOfferByCustomer(bot: Telegraf, offerId: number, customerId: number, proposedPrice: number) {
    const offer = await this.orderOfferRepository.findById(offerId);
    if (!offer || offer.customerId !== customerId) {
      throw new Error("Предложение не найдено");
    }

    if (!["ACTIVE", "COUNTERED"].includes(offer.status)) {
      throw new Error("Предложение уже неактуально");
    }

    const updated = await this.orderOfferRepository.update(offerId, {
      proposedPrice,
      status: "COUNTERED",
      lastActor: "CUSTOMER",
    });

    await this.notificationService.notifyCarrierOrderCounterOffer(bot, updated.id);
    return updated;
  }

  async counterOfferByCarrier(bot: Telegraf, offerId: number, carrierId: number, proposedPrice: number, pickupEtaText?: string) {
    const offer = await this.orderOfferRepository.findById(offerId);
    if (!offer || offer.carrierId !== carrierId) {
      throw new Error("Предложение не найдено");
    }

    if (!["ACTIVE", "COUNTERED"].includes(offer.status)) {
      throw new Error("Предложение уже неактуально");
    }

    const updated = await this.orderOfferRepository.update(offerId, {
      proposedPrice,
      pickupEtaText,
      status: "ACTIVE",
      lastActor: "CARRIER",
    });

    await this.notificationService.notifyCustomerOrderOffer(bot, updated.id);
    return updated;
  }

  async acceptOfferByCarrier(bot: Telegraf, offerId: number, carrierId: number) {
    const offer = await this.orderOfferRepository.findById(offerId);
    if (!offer || offer.carrierId !== carrierId) {
      throw new Error("Предложение не найдено");
    }

    if (!["ACTIVE", "COUNTERED"].includes(offer.status)) {
      throw new Error("Предложение уже неактуально");
    }

    return this.reserveOrderFromOffer(bot, offerId, offer, {
      actorRole: "CARRIER",
      actorLabel: offer.carrier.fullName ?? `Carrier #${offer.carrierId}`,
      eventType: "COUNTER_OFFER_ACCEPTED",
      message: "Перевозчик принял встречную цену заказчика.",
      finalOfferStatus: "ACCEPTED",
    });
  }

  async rejectOfferByCarrier(bot: Telegraf, offerId: number, carrierId: number) {
    const offer = await this.orderOfferRepository.findById(offerId);
    if (!offer || offer.carrierId !== carrierId) {
      throw new Error("Предложение не найдено");
    }

    if (!["ACTIVE", "COUNTERED"].includes(offer.status)) {
      throw new Error("Предложение уже неактуально");
    }

    const updated = await this.orderOfferRepository.update(offerId, {
      status: "REJECTED",
      lastActor: "CARRIER",
    });

    await this.notificationService.notifyCustomerOfferRejected(bot, updated.id);
    return updated;
  }

  async calculateSuggestedPrice(vehicleType: string, distanceKm?: number, durationHours?: number) {
    return this.pricingService.calculateSuggestedPrice(vehicleType, distanceKm, durationHours);
  }

  async updateCarrierOrderStatus(bot: Telegraf, orderId: number, carrierId: number, status: "IN_PROGRESS" | "COMPLETED" | "CANCELLED") {
    const order = await this.orderRepository.findCarrierOrder(orderId, carrierId);
    if (!order) {
      throw new Error("Заявка не найдена");
    }

    const allowedTransitions: Record<string, string[]> = {
      ACCEPTED: ["IN_PROGRESS", "CANCELLED"],
      IN_PROGRESS: ["COMPLETED", "CANCELLED"],
    };

    if (!allowedTransitions[order.status]?.includes(status)) {
      throw new Error("Недопустимый переход статуса");
    }

    const updated = await this.orderRepository.updateCarrierOrderStatus(orderId, carrierId, status);
    await this.notificationService.notifyCustomerOrderStatusChanged(bot, updated);
    return updated;
  }

  async assignCarrierDispatch(
    bot: Telegraf,
    orderId: number,
    carrierId: number,
    payload: {
      vehicleId?: number;
      driverName: string;
      driverPhone: string;
    }
  ) {
    const order = await this.orderRepository.findCarrierOrder(orderId, carrierId);
    if (!order) {
      throw new Error("Заявка не найдена");
    }

    if (!["AWAITING_DEPOSIT", "ACCEPTED", "IN_PROGRESS"].includes(order.status)) {
      throw new Error("Экипаж можно назначить только для активной заявки");
    }

    const carrier = await this.carrierRepository.findById(carrierId);
    if (!carrier) {
      throw new Error("Профиль перевозчика не найден");
    }

    const selectedVehicle =
      typeof payload.vehicleId === "number"
        ? await this.vehicleRepository.findByCarrierAndId(carrierId, payload.vehicleId)
        : order.vehicleId
          ? await this.vehicleRepository.findByCarrierAndId(carrierId, order.vehicleId)
          : await this.vehicleRepository.findBestMatch(carrierId, order.vehicleType, order.passengersCount ?? 1);

    if (payload.vehicleId && !selectedVehicle) {
      throw new Error("Машина не найдена в вашем парке");
    }

    const updatedAt = new Date();
    const driverName = payload.driverName.trim();
    const driverPhone = payload.driverPhone.trim();

    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: orderId },
        data: {
          vehicleId: selectedVehicle?.id ?? order.vehicleId ?? null,
          driverNameSnapshot: driverName,
          driverPhoneSnapshot: driverPhone,
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
          message: `Экипаж назначен: ${driverName}${selectedVehicle?.brand ? `, ${selectedVehicle.brand}` : ""}.`,
          payload: JSON.stringify({
            driverName,
            driverPhone,
            vehicleId: selectedVehicle?.id ?? null,
            vehicleBrand: selectedVehicle?.brand ?? null,
            vehiclePlate: selectedVehicle?.plateNumber ?? null,
            updatedAt: updatedAt.toISOString(),
          }),
        },
      });
    });

    await this.notificationService.notifyCustomerDispatchAssigned(bot, orderId);
    return this.orderRepository.findById(orderId);
  }

  async submitCarrierDeposit(bot: Telegraf, orderId: number, carrierId: number, paymentReference: string, note?: string | null) {
    const order = await this.orderRepository.findCarrierOrder(orderId, carrierId);
    if (!order) {
      throw new Error("Заявка не найдена");
    }

    if (order.status !== ORDER_STATUS_AWAITING_DEPOSIT) {
      throw new Error("Депозит можно отправить только по закрепленной заявке");
    }

    if (order.depositStatus !== ORDER_DEPOSIT_STATUS.PENDING_PAYMENT && order.depositStatus !== ORDER_DEPOSIT_STATUS.REJECTED) {
      throw new Error("По этой заявке сейчас нельзя отправить новую платежку");
    }

    const carrier = await this.carrierRepository.findById(carrierId);
    const submittedAt = new Date();
    const cleanReference = paymentReference.trim();
    const cleanNote = note?.trim() || null;

    const updated = await prisma.$transaction(async (tx) => {
      const savedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          depositStatus: ORDER_DEPOSIT_STATUS.PENDING_VERIFICATION,
          depositReference: cleanReference,
          depositVerificationNote: cleanNote,
          depositSubmittedAt: submittedAt,
          depositRejectedAt: null,
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId,
          actorRole: "CARRIER",
          actorLabel: carrier?.fullName ?? `Carrier #${carrierId}`,
          eventType: "DEPOSIT_SUBMITTED",
          message: "Перевозчик отправил платежку на проверку.",
          payload: JSON.stringify({
            paymentReference: cleanReference,
            note: cleanNote,
            submittedAt: submittedAt.toISOString(),
          }),
        },
      });

      return savedOrder;
    });

    await this.notificationService.notifyAdminDepositPending(bot, orderId);
    return updated;
  }

  async approveDeposit(bot: Telegraf, orderId: number, adminLabel = "Admin bot", note?: string | null) {
    const order = await this.orderRepository.findById(orderId);
    if (!order) {
      throw new Error("Заказ не найден");
    }

    if (order.status !== ORDER_STATUS_AWAITING_DEPOSIT || order.depositStatus !== ORDER_DEPOSIT_STATUS.PENDING_VERIFICATION) {
      throw new Error("Заказ не ожидает подтверждения депозита");
    }

    const verifiedAt = new Date();
    const cleanNote = note?.trim() || null;

    const updated = await prisma.$transaction(async (tx) => {
      const savedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          status: "ACCEPTED",
          depositStatus: ORDER_DEPOSIT_STATUS.PAID,
          depositVerifiedAt: verifiedAt,
          contactsUnlockedAt: verifiedAt,
          depositVerificationNote: cleanNote,
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId,
          actorRole: "ADMIN",
          actorLabel: adminLabel,
          eventType: "DEPOSIT_VERIFIED",
          message: "Депозит подтвержден, контакты раскрыты обеим сторонам.",
          payload: JSON.stringify({
            note: cleanNote,
            verifiedAt: verifiedAt.toISOString(),
          }),
        },
      });

      return savedOrder;
    });

    await this.notificationService.notifyCustomerOrderAccepted(bot, orderId);
    await this.notificationService.notifyCarrierOrderReady(bot, orderId);
    return updated;
  }

  async rejectDeposit(bot: Telegraf, orderId: number, adminLabel = "Admin bot", note?: string | null) {
    const order = await this.orderRepository.findById(orderId);
    if (!order) {
      throw new Error("Заказ не найден");
    }

    if (order.status !== ORDER_STATUS_AWAITING_DEPOSIT || order.depositStatus !== ORDER_DEPOSIT_STATUS.PENDING_VERIFICATION) {
      throw new Error("Заказ не ожидает подтверждения депозита");
    }

    const rejectedAt = new Date();
    const cleanNote = note?.trim() || null;

    const updated = await prisma.$transaction(async (tx) => {
      const savedOrder = await tx.order.update({
        where: { id: orderId },
        data: {
          depositStatus: ORDER_DEPOSIT_STATUS.REJECTED,
          depositRejectedAt: rejectedAt,
          depositVerificationNote: cleanNote,
        },
      });

      await tx.orderEvent.create({
        data: {
          orderId,
          actorRole: "ADMIN",
          actorLabel: adminLabel,
          eventType: "DEPOSIT_REJECTED",
          message: "Платежка отклонена, ожидается новая отправка.",
          payload: JSON.stringify({
            note: cleanNote,
            rejectedAt: rejectedAt.toISOString(),
          }),
        },
      });

      return savedOrder;
    });

    await this.notificationService.notifyCarrierDepositRejected(bot, orderId);
    return updated;
  }

  async requestReturnTrip(
    bot: Telegraf,
    sourceOrderId: number,
    customerId: number,
    payload: {
      date: string;
      comment?: string | null;
      routeTo?: string | null;
      routeToLat?: number;
      routeToLng?: number;
    }
  ) {
    const sourceOrder = await prisma.order.findFirst({
      where: {
        id: sourceOrderId,
        customerId,
      },
      include: {
        customer: { include: { user: true } },
        carrier: { include: { user: true } },
        vehicle: true,
        returnOrders: {
          select: {
            id: true,
            status: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!sourceOrder) {
      throw new Error("Исходный заказ не найден");
    }

    if (!sourceOrder.carrierId) {
      throw new Error("Перевозчик по заказу еще не назначен");
    }

    if (!["ACCEPTED", "IN_PROGRESS", "COMPLETED"].includes(sourceOrder.status)) {
      throw new Error("Обратный рейс доступен только после подтвержденного основного заказа");
    }

    const activeReturnOrder = sourceOrder.returnOrders.find((order) =>
      [ORDER_STATUS_AWAITING_DEPOSIT, "ACCEPTED", "IN_PROGRESS"].includes(order.status)
    );
    if (activeReturnOrder) {
      throw new Error(`По этому заказу уже создан обратный рейс #${activeReturnOrder.id}`);
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
          comment: payload.comment?.trim() || `Обратный рейс для заказа #${sourceOrder.id}`,
          returnSourceOrderId: sourceOrder.id,
          carrierId: sourceOrder.carrierId,
          vehicleId: sourceOrder.vehicleId,
        },
      });

      await tx.orderEvent.createMany({
        data: [
          {
            orderId: sourceOrder.id,
            actorRole: "CUSTOMER",
            actorLabel: sourceOrder.customerNameSnapshot ?? sourceOrder.customer?.name ?? `Customer #${sourceOrder.customerId}`,
            eventType: "RETURN_REQUESTED",
            message: `Заказчик запросил обратный рейс #${createdOrder.id}.`,
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
            message: `Обратный рейс создан из заказа #${sourceOrder.id}.`,
            payload: JSON.stringify({
              sourceOrderId: sourceOrder.id,
              depositAmount,
              depositPercent: DEFAULT_ORDER_DEPOSIT_PERCENT,
            }),
          },
        ],
      });

      return createdOrder;
    });

    await this.notificationService.notifyOrderAwaitingCarrierDeposit(bot, returnOrder.id);
    return returnOrder;
  }

  private async reserveOrderFromOffer(
    bot: Telegraf,
    offerId: number,
    offer: NonNullable<Awaited<ReturnType<OrderOfferRepository["findById"]>>>,
    options: {
      actorRole: "CUSTOMER" | "CARRIER";
      actorLabel: string;
      eventType: string;
      message: string;
      finalOfferStatus: "ACCEPTED";
    }
  ) {
    if (offer.order.status !== "NEW") {
      throw new Error("Заказ уже не доступен для подтверждения");
    }

    const minimumCapacity = offer.order.passengersCount ?? 1;
    const selectedVehicle = await this.vehicleRepository.findBestMatch(offer.carrierId, offer.order.vehicleType, minimumCapacity);
    const depositAmount = calculateDepositAmount(offer.proposedPrice, DEFAULT_ORDER_DEPOSIT_PERCENT);
    const confirmationMoment = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.orderOffer.update({
        where: { id: offerId },
        data: {
          status: options.finalOfferStatus,
          lastActor: options.actorRole,
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
            actorRole: options.actorRole,
            actorLabel: options.actorLabel,
            eventType: options.eventType,
            message: options.message,
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

    await this.notificationService.notifyOrderAwaitingCarrierDeposit(bot, offer.orderId);
    await this.notificationService.notifyOtherCarriersOrderClosed(bot, offer.orderId, offer.carrierId);
    return this.orderRepository.findById(offer.orderId);
  }

  private async notifyMatchingCarriers(bot: Telegraf, orderId: number, regionId: number, vehicleType: string, minimumCapacity: number) {
    const carriers = await this.carrierRepository.findApprovedByCriteria(regionId, vehicleType, minimumCapacity);
    const payload = { orderId, carrierIds: carriers.map((carrier) => carrier.id) };
    await this.notificationService.enqueueOrderNotification(bot, payload);
  }
}
