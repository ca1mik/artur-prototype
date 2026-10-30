import { DEFAULT_ORDER_DEPOSIT_PERCENT, ORDER_DEPOSIT_STATUS, isContactsUnlocked } from "./orderDeal";
import { VEHICLE_LABELS } from "./transport";

const toSafeString = (value?: string | null) => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const formatDocDate = (value?: string | Date | null) => {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toLocaleString("ru-RU");
};

export const buildOrderDispatch = (order: any, options?: { showDriverContacts?: boolean }) => {
  const vehicleBrand = toSafeString(order.vehicleBrandSnapshot ?? order.vehicle?.brand ?? null);
  const vehiclePlate = toSafeString(order.vehiclePlateSnapshot ?? order.vehicle?.plateNumber ?? null);
  const driverName = toSafeString(order.driverNameSnapshot ?? null);
  const driverPhone = toSafeString(order.driverPhoneSnapshot ?? null);
  const showDriverContacts = options?.showDriverContacts ?? false;

  return {
    vehicleBrand,
    vehiclePlate,
    driverName: showDriverContacts ? driverName : null,
    driverPhone: showDriverContacts ? driverPhone : null,
    assigned: Boolean(vehicleBrand || vehiclePlate || driverName || driverPhone),
  };
};

export const buildOrderReturnTrip = (order: any) => {
  const firstReturnOrder = Array.isArray(order.returnOrders) ? order.returnOrders[0] : null;

  return {
    isReturnOrder: Boolean(order.returnSourceOrderId),
    sourceOrderId: order.returnSourceOrderId ?? null,
    linkedReturnOrderId: firstReturnOrder?.id ?? null,
    linkedReturnStatus: firstReturnOrder?.status ?? null,
    linkedReturnDate: firstReturnOrder?.date ?? null,
  };
};

export const buildOrderClosingDocument = (order: any, viewerRole: "CUSTOMER" | "CARRIER") => {
  const contactsUnlocked = isContactsUnlocked(order);
  const customerName = toSafeString(order.customerNameSnapshot ?? order.customer?.name ?? null);
  const customerPhone = toSafeString(order.customerContactSnapshot ?? order.customer?.user?.phone ?? order.customer?.phone ?? null);
  const carrierName = toSafeString(order.carrierNameSnapshot ?? order.carrier?.fullName ?? null);
  const carrierPhone = toSafeString(order.carrierContactSnapshot ?? order.carrier?.user?.phone ?? null);
  const dispatch = buildOrderDispatch(order, { showDriverContacts: contactsUnlocked || viewerRole === "CARRIER" });

  const docDate = new Date();
  const docNumber = `ACT-${order.id}-${docDate.toISOString().slice(0, 10).replace(/-/g, "")}`;

  return {
    documentNumber: docNumber,
    generatedAt: docDate.toISOString(),
    status: order.status,
    viewerRole,
    summary: `${VEHICLE_LABELS[order.vehicleType] ?? order.vehicleType} · ${order.routeFrom} -> ${order.routeTo}`,
    route: {
      from: order.routeFrom,
      to: order.routeTo,
      date: order.date,
      dateLabel: formatDocDate(order.date),
      estimatedDistanceKm: order.estimatedDistanceKm ?? null,
      estimatedDurationHours: order.estimatedDurationHours ?? null,
    },
    financials: {
      totalPrice: order.price,
      suggestedPrice: order.suggestedPrice ?? null,
      depositPercent: order.depositPercent ?? DEFAULT_ORDER_DEPOSIT_PERCENT,
      depositAmount: order.depositAmount ?? null,
      depositStatus: order.depositStatus ?? ORDER_DEPOSIT_STATUS.NOT_REQUIRED,
      depositReference: order.depositReference ?? null,
    },
    participants: {
      customerName,
      customerPhone: contactsUnlocked ? customerPhone : null,
      carrierName: contactsUnlocked ? carrierName : null,
      carrierPhone: contactsUnlocked ? carrierPhone : null,
      driverName: dispatch.driverName,
      driverPhone: dispatch.driverPhone,
    },
    vehicle: {
      type: order.vehicleType,
      label: VEHICLE_LABELS[order.vehicleType] ?? order.vehicleType,
      brand: dispatch.vehicleBrand,
      plateNumber: dispatch.vehiclePlate,
    },
    checkpoints: {
      createdAt: order.createdAt,
      createdAtLabel: formatDocDate(order.createdAt),
      customerConfirmedAt: order.customerConfirmedAt ?? null,
      customerConfirmedAtLabel: formatDocDate(order.customerConfirmedAt),
      contactsUnlockedAt: order.contactsUnlockedAt ?? null,
      contactsUnlockedAtLabel: formatDocDate(order.contactsUnlockedAt),
      depositVerifiedAt: order.depositVerifiedAt ?? null,
      depositVerifiedAtLabel: formatDocDate(order.depositVerifiedAt),
    },
  };
};
