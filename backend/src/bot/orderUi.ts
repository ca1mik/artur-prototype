import { buildMapLinkLine } from "../utils/location";
import { buildOrderReturnTrip } from "../utils/orderDocument";
import { ORDER_DEPOSIT_STATUS, ORDER_STATUS_AWAITING_DEPOSIT, isContactsUnlocked } from "../utils/orderDeal";
import { formatVehicleSummary, toVehicleLabel } from "../utils/transport";

type ViewerRole = "CUSTOMER" | "CARRIER" | "ADMIN";

type InlineButton = {
  text: string;
  callback_data: string;
};

type InlineKeyboard = {
  reply_markup: {
    inline_keyboard: InlineButton[][];
  };
};

const buildInlineKeyboard = (rows: InlineButton[][]): InlineKeyboard => ({
  reply_markup: {
    inline_keyboard: rows,
  },
});

const STATUS_LABELS: Record<string, string> = {
  NEW: "Новая",
  AWAITING_DEPOSIT: "Ждет депозит",
  ACCEPTED: "Подтверждена",
  IN_PROGRESS: "В работе",
  COMPLETED: "Завершена",
  CANCELLED: "Отменена",
};

const DEPOSIT_STATUS_LABELS: Record<string, string> = {
  [ORDER_DEPOSIT_STATUS.NOT_REQUIRED]: "не требуется",
  [ORDER_DEPOSIT_STATUS.PENDING_PAYMENT]: "ждем оплату",
  [ORDER_DEPOSIT_STATUS.PENDING_VERIFICATION]: "проверяем платежку",
  [ORDER_DEPOSIT_STATUS.PAID]: "подтвержден",
  [ORDER_DEPOSIT_STATUS.REJECTED]: "нужна повторная платежка",
};

const TIMELINE_ACTOR_LABELS: Record<string, string> = {
  CUSTOMER: "Заказчик",
  CARRIER: "Перевозчик",
  ADMIN: "Админ",
  SYSTEM: "Система",
};

const ACTIVE_RETURN_STATUSES = new Set<string>([ORDER_STATUS_AWAITING_DEPOSIT, "ACCEPTED", "IN_PROGRESS"]);
const ACTIVE_OFFER_STATUSES = new Set<string>(["ACTIVE", "COUNTERED"]);

const toStatusLabel = (status?: string | null) => STATUS_LABELS[status ?? ""] ?? (status || "—");

const toDepositStatusLabel = (status?: string | null) => DEPOSIT_STATUS_LABELS[status ?? ""] ?? (status || "—");

const toTimelineActorLabel = (event: { actorRole?: string | null; actorLabel?: string | null }) => {
  const actorLabel = String(event.actorLabel ?? "").trim();
  if (actorLabel) {
    return actorLabel;
  }

  const actorRole = String(event.actorRole ?? "").trim().toUpperCase();
  return TIMELINE_ACTOR_LABELS[actorRole] ?? actorRole ?? "Событие";
};

const formatDate = (value?: string | Date | null) => {
  if (!value) {
    return "—";
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "—";
  }

  return parsed.toLocaleString("ru-RU");
};

const getActiveOfferCount = (order: any) =>
  Array.isArray(order.offers) ? order.offers.filter((offer: any) => ACTIVE_OFFER_STATUSES.has(String(offer.status ?? ""))).length : 0;

const buildPassengerSummaryLines = (payload: {
  adultsCount?: number | null;
  childrenCount?: number | null;
  passengersCount?: number | null;
}) => {
  const adultsCount = payload.adultsCount;
  const childrenCount = payload.childrenCount;
  const passengersCount = payload.passengersCount ?? (adultsCount ?? 0) + (childrenCount ?? 0);

  if (!passengersCount) {
    return [];
  }

  return [
    adultsCount !== null && adultsCount !== undefined ? `Взрослых: ${adultsCount}` : null,
    childrenCount !== null && childrenCount !== undefined ? `Детей: ${childrenCount}` : null,
    `Всего пассажиров: ${passengersCount}`,
    (childrenCount ?? 0) > 0 ? "Поездка с детьми: только не ночью и минимум за 3 суток." : null,
  ].filter(Boolean);
};

const buildDispatchLines = (order: any, viewerRole: ViewerRole, contactsAreUnlocked: boolean) => {
  if (viewerRole === "CUSTOMER" && !contactsAreUnlocked) {
    return [];
  }

  const canShowContacts = viewerRole === "ADMIN" || viewerRole === "CARRIER" || contactsAreUnlocked;
  const vehicleBrand = order.vehicleBrandSnapshot ?? order.vehicle?.brand ?? null;
  const vehiclePlate = order.vehiclePlateSnapshot ?? order.vehicle?.plateNumber ?? null;
  const driverName = order.driverNameSnapshot ?? null;
  const driverPhone = canShowContacts ? order.driverPhoneSnapshot ?? null : null;

  const vehicleLine = vehicleBrand || vehiclePlate ? `Экипаж: ${[vehicleBrand, vehiclePlate].filter(Boolean).join(" • ")}` : null;
  const driverLine = driverName ? `Водитель: ${driverName}` : null;
  const phoneLine = driverPhone ? `Телефон водителя: ${driverPhone}` : null;

  return [vehicleLine, driverLine, phoneLine].filter(Boolean);
};

const hasActiveReturnOrder = (order: any) =>
  Array.isArray(order.returnOrders)
    ? order.returnOrders.some((returnOrder: any) => ACTIVE_RETURN_STATUSES.has(String(returnOrder.status ?? "")))
    : false;

const buildAdminParticipantLines = (order: any) => [
  order.customerNameSnapshot || order.customer?.name ? `Заказчик: ${order.customerNameSnapshot ?? order.customer?.name}` : null,
  order.customerContactSnapshot || order.customer?.user?.phone
    ? `Телефон заказчика: ${order.customerContactSnapshot ?? order.customer?.user?.phone}`
    : null,
  order.carrierNameSnapshot || order.carrier?.fullName ? `Перевозчик: ${order.carrierNameSnapshot ?? order.carrier?.fullName}` : null,
  order.carrierContactSnapshot || order.carrier?.user?.phone
    ? `Телефон перевозчика: ${order.carrierContactSnapshot ?? order.carrier?.user?.phone}`
    : null,
];

const buildViewerSpecificLines = (order: any, viewerRole: ViewerRole, contactsAreUnlocked: boolean) => {
  if (viewerRole === "ADMIN") {
    return [...buildAdminParticipantLines(order), ...buildDispatchLines(order, viewerRole, contactsAreUnlocked)];
  }

  if (!contactsAreUnlocked) {
    return ["Контакты: откроются после подтверждения депозита"];
  }

  if (viewerRole === "CUSTOMER") {
    return [
      order.carrierNameSnapshot || order.carrier?.fullName ? `Перевозчик: ${order.carrierNameSnapshot ?? order.carrier?.fullName}` : null,
      order.carrierContactSnapshot || order.carrier?.user?.phone
        ? `Телефон перевозчика: ${order.carrierContactSnapshot ?? order.carrier?.user?.phone}`
        : null,
      ...buildDispatchLines(order, viewerRole, contactsAreUnlocked),
      !order.vehicleBrandSnapshot && !order.vehiclePlateSnapshot && order.vehicle ? formatVehicleSummary(order.vehicle) : null,
    ];
  }

  return [
    order.customerNameSnapshot || order.customer?.name ? `Заказчик: ${order.customerNameSnapshot ?? order.customer?.name}` : null,
    order.customerContactSnapshot || order.customer?.user?.phone
      ? `Телефон заказчика: ${order.customerContactSnapshot ?? order.customer?.user?.phone}`
      : null,
    ...buildDispatchLines(order, viewerRole, contactsAreUnlocked),
  ];
};

export const buildOrderCardText = (order: any, viewerRole: ViewerRole) => {
  const contactsAreUnlocked = isContactsUnlocked(order);
  const returnTrip = buildOrderReturnTrip(order);
  const latestEvent = Array.isArray(order.events) && order.events.length > 0 ? order.events[0] : null;
  const activeOfferCount = getActiveOfferCount(order);

  const lines = [
    `#${order.id} • ${toStatusLabel(order.status)}`,
    order.status === ORDER_STATUS_AWAITING_DEPOSIT
      ? `Депозит: ${order.depositAmount ?? 0} ₽ (${order.depositPercent ?? 10}%) • ${toDepositStatusLabel(order.depositStatus)}`
      : null,
    `${order.routeFrom} → ${order.routeTo}`,
    buildMapLinkLine("Отправление на карте", order.routeFromLat, order.routeFromLng),
    buildMapLinkLine("Назначение на карте", order.routeToLat, order.routeToLng),
    `Регион: ${order.region?.name ?? order.regionId ?? "—"}`,
    `Категория: ${order.category?.name ?? order.categoryId ?? "—"}`,
    `Транспорт: ${toVehicleLabel(order.vehicleType)}`,
    `Дата: ${formatDate(order.date)}`,
    `Цена: ${order.price} ₽`,
    order.pickupEtaText ? `Подача: ${order.pickupEtaText}` : null,
    order.estimatedDistanceKm ? `Километраж: ${order.estimatedDistanceKm} км` : null,
    order.estimatedDurationHours ? `Время в пути: ${order.estimatedDurationHours} ч` : null,
    ...buildPassengerSummaryLines(order),
    order.cargoDescription ? `Груз: ${order.cargoDescription}` : null,
    order.comment ? `Комментарий: ${order.comment}` : null,
    viewerRole === "CUSTOMER" && order.status === "NEW" && activeOfferCount > 0 ? `Активные отклики: ${activeOfferCount}` : null,
    viewerRole === "CARRIER" && order.status === "NEW" && Array.isArray(order.offers) && order.offers[0]
      ? `Ваш отклик: ${order.offers[0].proposedPrice} ₽${order.offers[0].pickupEtaText ? ` • ${order.offers[0].pickupEtaText}` : ""}`
      : null,
    returnTrip.isReturnOrder ? `Обратный рейс к заказу #${returnTrip.sourceOrderId}` : null,
    returnTrip.linkedReturnOrderId
      ? `Связанный обратный рейс: #${returnTrip.linkedReturnOrderId} • ${toStatusLabel(returnTrip.linkedReturnStatus)}`
      : null,
    ...buildViewerSpecificLines(order, viewerRole, contactsAreUnlocked),
    latestEvent?.message ? `Последнее событие: ${latestEvent.message}` : null,
  ];

  return lines.filter(Boolean).join("\n");
};

export const buildOrderTimelineText = (
  order: any,
  events: Array<{ createdAt?: string | Date | null; actorRole?: string | null; actorLabel?: string | null; message?: string | null; eventType?: string | null }>
) => {
  const normalizedEvents = Array.isArray(events) ? [...events].reverse() : [];
  const lines = [`История заявки #${order.id}`, `${order.routeFrom} → ${order.routeTo}`];

  if (normalizedEvents.length === 0) {
    lines.push("", "Пока без событий.");
    return lines.join("\n");
  }

  normalizedEvents.forEach((event) => {
    lines.push("");
    lines.push(`${formatDate(event.createdAt)} • ${toTimelineActorLabel(event)}`);
    lines.push(String(event.message ?? event.eventType ?? "Без описания"));
  });

  return lines.join("\n");
};

export const buildCarrierOrderActionMarkup = (order: any): InlineKeyboard | undefined => {
  const rows: InlineButton[][] = [];
  const canAssignDispatch = ["AWAITING_DEPOSIT", "ACCEPTED", "IN_PROGRESS"].includes(String(order.status ?? ""));

  if (order.status === ORDER_STATUS_AWAITING_DEPOSIT) {
    if (new Set<string>([ORDER_DEPOSIT_STATUS.PENDING_PAYMENT, ORDER_DEPOSIT_STATUS.REJECTED]).has(String(order.depositStatus ?? ""))) {
      rows.push([{ text: "Отправить платежку", callback_data: `carrier-order-deposit:submit:${order.id}` }]);
    }
  }

  if (order.status === "ACCEPTED") {
    rows.push([
      { text: "В работу", callback_data: `carrier-order-status:${order.id}:IN_PROGRESS` },
      { text: "Отменить", callback_data: `carrier-order-status:${order.id}:CANCELLED` },
    ]);
  }

  if (order.status === "IN_PROGRESS") {
    rows.push([
      { text: "Завершить", callback_data: `carrier-order-status:${order.id}:COMPLETED` },
      { text: "Отменить", callback_data: `carrier-order-status:${order.id}:CANCELLED` },
    ]);
  }

  if (canAssignDispatch) {
    rows.push([
      {
        text: order.driverNameSnapshot || order.vehicleBrandSnapshot || order.vehiclePlateSnapshot ? "Обновить экипаж" : "Назначить экипаж",
        callback_data: `carrier-order-dispatch:start:${order.id}`,
      },
    ]);
  }

  rows.push([{ text: "История заявки", callback_data: `carrier-order:timeline:${order.id}` }]);
  rows.push([{ text: "Обновить карточку", callback_data: `carrier-order:refresh:${order.id}` }]);

  return buildInlineKeyboard(rows);
};

export const buildCustomerOrderActionMarkup = (order: any): InlineKeyboard | undefined => {
  const rows: InlineButton[][] = [];
  const activeOfferCount = getActiveOfferCount(order);

  if (String(order.status ?? "") === "NEW" && activeOfferCount > 0) {
    rows.push([{ text: `Показать отклики (${activeOfferCount})`, callback_data: `customer-order:offers:${order.id}` }]);
  }

  if (
    !order.returnSourceOrderId &&
    isContactsUnlocked(order) &&
    ["ACCEPTED", "IN_PROGRESS", "COMPLETED"].includes(String(order.status ?? "")) &&
    !hasActiveReturnOrder(order)
  ) {
    rows.push([{ text: "Заказать обратно", callback_data: `customer-order:return:${order.id}` }]);
  }

  rows.push([{ text: "История заявки", callback_data: `customer-order:timeline:${order.id}` }]);

  if (["COMPLETED", "CANCELLED"].includes(String(order.status ?? ""))) {
    rows.push([{ text: "Повторить маршрут", callback_data: `customer-order:repeat:${order.id}` }]);
  }

  rows.push([{ text: "Обновить карточку", callback_data: `customer-order:refresh:${order.id}` }]);

  return buildInlineKeyboard(rows);
};

export const buildAdminDepositActionMarkup = (order: any): InlineKeyboard | undefined => {
  if (order.status !== ORDER_STATUS_AWAITING_DEPOSIT || order.depositStatus !== ORDER_DEPOSIT_STATUS.PENDING_VERIFICATION) {
    return undefined;
  }

  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Подтвердить депозит", callback_data: `admin-deposit:verify:${order.id}` },
          { text: "Отклонить", callback_data: `admin-deposit:reject:${order.id}` },
        ],
      ],
    },
  };
};
