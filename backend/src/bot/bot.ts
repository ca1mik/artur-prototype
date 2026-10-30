import { Telegraf } from "telegraf";
import LocalSession from "telegraf-session-local";
import { HttpsProxyAgent } from "https-proxy-agent";
import { config } from "../config";
import { logger } from "../utils/logger";
import {
  buildAdminDepositActionMarkup,
  buildCarrierOrderActionMarkup,
  buildCustomerOrderActionMarkup,
  buildOrderCardText,
  buildOrderTimelineText,
} from "./orderUi";
import {
  validateCarrierFullName,
  validateCarrierPhone,
  validateCarrierRegionIds,
  validatePlateNumber,
  validateVehicleBrand,
  validateVehicleCapacity,
  validateVehicleDescription,
  validateVehicleFeatures,
} from "../utils/carrierValidation";
import { buildMapLinkLine, buildMapPointLabel } from "../utils/location";
import { BotState, CarrierProfileUpdateDto, CarrierRegistrationDto, OrderDto, VehicleDto, VehicleUpdateDto } from "../types";
import { RegionRepository } from "../repositories/regionRepository";
import { CategoryRepository } from "../repositories/categoryRepository";
import { CustomerRepository } from "../repositories/customerRepository";
import { CarrierRepository } from "../repositories/carrierRepository";
import { UserRepository } from "../repositories/userRepository";
import { OrderRepository } from "../repositories/orderRepository";
import { OrderEventRepository } from "../repositories/orderEventRepository";
import { UserService } from "../services/userService";
import { OrderService } from "../services/orderService";
import { CarrierService } from "../services/carrierService";
import { NotificationService } from "../services/notificationService";
import { PricingService } from "../services/pricingService";
import { RouteEstimationError, RouteService } from "../services/routeService";
import { parseFlexibleDepartureDate, parseRoutePointInput } from "../utils/orderInput";
import { validatePassengerTripRules } from "../utils/orderRules";
import {
  CARGO_VEHICLE_TYPES,
  PASSENGER_VEHICLE_TYPES,
  VEHICLE_TYPES,
  formatVehicleSummary,
  parsePhotoIds,
  toVehicleLabel,
} from "../utils/transport";

const regionRepository = new RegionRepository();
const categoryRepository = new CategoryRepository();
const customerRepository = new CustomerRepository();
const carrierRepository = new CarrierRepository();
const userRepository = new UserRepository();
const orderRepository = new OrderRepository();
const orderEventRepository = new OrderEventRepository();
const userService = new UserService();
const orderService = new OrderService();
const carrierService = new CarrierService();
const notificationService = new NotificationService();
const pricingService = new PricingService();
const routeService = new RouteService();

const telegramAgent = config.telegramProxyUrl ? new HttpsProxyAgent(config.telegramProxyUrl) : undefined;

if (config.telegramProxyUrl) {
  logger.info({ proxyUrl: config.telegramProxyUrl }, "Telegram proxy enabled");
}

export const bot = new Telegraf(config.botToken, {
  telegram: {
    apiRoot: config.telegramApiRoot,
    agent: telegramAgent,
    attachmentAgent: telegramAgent,
  },
});

const session = new LocalSession({ database: "./sessions_db.json" });
bot.use(session.middleware());

const ADMIN_PANEL_TEXT = "Админ-панель";
const CARRIER_TRANSPORT_TEXT = "Мой транспорт";
const ADD_TRANSPORT_TEXT = "Добавить транспорт";
const EDIT_TRANSPORT_TEXT = "Редактировать транспорт";
const CARRIER_REGION_TEXT = "Мои регионы";
const CARRIER_CABINET_TEXT = "Личный кабинет";
const OPEN_ORDERS_TEXT = "Новые заказы";
const SHARE_CONTACT_TEXT = "Отправить мой телефон";
const SKIP_TEXT = "Пропустить";
const DONE_TEXT = "Готово";

const CANCEL_TEXT = "Отменить";
const BACK_TEXT = "Назад";
const ORDER_FLOW_BACK = "order-flow:back";

const isAdminTelegramId = (telegramId?: number) => Boolean(telegramId && config.adminTelegramId && telegramId === config.adminTelegramId);

const buildCustomerMenu = (isAdmin = false) => ({
  reply_markup: {
    keyboard: [
      [{ text: "Создать заявку" }],
      [{ text: "Мои заявки" }],
      [{ text: "История" }, { text: "Поддержка" }],
      ...(isAdmin ? [[{ text: ADMIN_PANEL_TEXT }]] : []),
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  },
});

const buildCarrierMenu = (isAdmin = false) => ({
  reply_markup: {
    keyboard: [
      [{ text: OPEN_ORDERS_TEXT }],
      [{ text: "Мои заявки" }, { text: "История" }],
      [{ text: CARRIER_CABINET_TEXT }],
      [{ text: CARRIER_TRANSPORT_TEXT }, { text: ADD_TRANSPORT_TEXT }],
      [{ text: EDIT_TRANSPORT_TEXT }, { text: CARRIER_REGION_TEXT }],
      [{ text: "Регистрация" }],
      [{ text: "Поддержка" }],
      ...(isAdmin ? [[{ text: ADMIN_PANEL_TEXT }]] : []),
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  },
});

const buildRoleKeyboard = () => ({
  reply_markup: {
    inline_keyboard: [
      [{ text: "Я заказчик", callback_data: "role:CUSTOMER" }],
      [{ text: "Я перевозчик", callback_data: "role:CARRIER" }],
    ],
  },
});

const buildVehicleTypeKeyboard = (prefix: string) => ({
  reply_markup: {
    inline_keyboard: VEHICLE_TYPES.map((vehicleType) => [{ text: toVehicleLabel(vehicleType), callback_data: `${prefix}:${vehicleType}` }]),
  },
});

const buildAdminKeyboard = () => ({
  reply_markup: {
    inline_keyboard: [
      [{ text: "Тарифы", callback_data: "admin:pricing" }],
      [{ text: "Перевозчики на модерации", callback_data: "admin:pending-carriers" }],
    ],
  },
});

const buildAdminOpsKeyboard = () => ({
  reply_markup: {
    inline_keyboard: [
      [{ text: "Тарифы", callback_data: "admin:pricing" }],
      [{ text: "Депозиты на проверке", callback_data: "admin:deposits" }],
      [{ text: "Перевозчики на модерации", callback_data: "admin:pending-carriers" }],
    ],
  },
});

const buildRegionKeyboard = (prefix: string, regions: Array<{ id: number; name: string }>) => ({
  reply_markup: {
    inline_keyboard: regions.map((region) => [{ text: region.name, callback_data: `${prefix}:${region.id}` }]),
  },
});

const buildCarrierRegionPicker = (prefix: string, regions: Array<{ id: number; name: string }>, selectedRegionIds: number[], confirmCallback: string) => ({
  reply_markup: {
    inline_keyboard: [
      ...regions.map((region) => [
        {
          text: `${selectedRegionIds.includes(region.id) ? "✅ " : ""}${region.name}`,
          callback_data: `${prefix}:${region.id}`,
        },
      ]),
      [{ text: "Сохранить регионы", callback_data: confirmCallback }],
    ],
  },
});

const buildLocationKeyboard = () => ({
  reply_markup: {
    keyboard: [[{ text: "Отправить точку", request_location: true }], [{ text: BACK_TEXT }, { text: CANCEL_TEXT }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  },
});

const removeKeyboardMarkup = {
  reply_markup: {
    remove_keyboard: true as const,
  },
};

const buildFlowCancelKeyboard = () => ({
  reply_markup: {
    keyboard: [[{ text: BACK_TEXT }, { text: CANCEL_TEXT }]],
    resize_keyboard: true,
    one_time_keyboard: false,
  },
});

const buildPassengerCountKeyboard = () => ({
  reply_markup: {
    keyboard: [
      [{ text: "0" }, { text: "1" }, { text: "2" }, { text: "3" }],
      [{ text: "4" }, { text: "5" }, { text: "10" }],
      [{ text: BACK_TEXT }, { text: CANCEL_TEXT }],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  },
});

const buildCommentKeyboard = () => ({
  reply_markup: {
    keyboard: [[{ text: "Нет" }], [{ text: BACK_TEXT }, { text: CANCEL_TEXT }]],
    resize_keyboard: true,
    one_time_keyboard: false,
  },
});

const buildWeightKeyboard = () => ({
  reply_markup: {
    keyboard: [[{ text: "0" }], [{ text: BACK_TEXT }, { text: CANCEL_TEXT }]],
    resize_keyboard: true,
    one_time_keyboard: false,
  },
});

const buildEtaKeyboard = () => ({
  reply_markup: {
    keyboard: [
      [{ text: "15 мин" }, { text: "30 мин" }, { text: "45 мин" }],
      [{ text: "1 час" }, { text: "1.5 часа" }, { text: "2 часа" }],
      [{ text: BACK_TEXT }, { text: CANCEL_TEXT }],
    ],
    resize_keyboard: true,
    one_time_keyboard: false,
  },
});

const buildContactKeyboard = () => ({
  reply_markup: {
    keyboard: [[{ text: SHARE_CONTACT_TEXT, request_contact: true }], [{ text: BACK_TEXT }, { text: CANCEL_TEXT }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  },
});

const buildPhotoStepKeyboard = () => ({
  reply_markup: {
    keyboard: [[{ text: DONE_TEXT }, { text: SKIP_TEXT }], [{ text: BACK_TEXT }, { text: CANCEL_TEXT }]],
    resize_keyboard: true,
    one_time_keyboard: false,
  },
});

const buildAddMoreVehiclesKeyboard = () => ({
  reply_markup: {
    inline_keyboard: [
      [{ text: "Добавить еще транспорт", callback_data: "carrier-more-vehicles" }],
      [{ text: "Завершить", callback_data: "carrier-finish-setup" }],
    ],
  },
});

const buildCarrierCabinetKeyboard = () => ({
  reply_markup: {
    inline_keyboard: [
      [{ text: "Редактировать профиль", callback_data: "carrier-cabinet:edit-profile" }],
      [{ text: "Управление регионами", callback_data: "carrier-cabinet:regions" }],
      [{ text: "Управление транспортом", callback_data: "carrier-cabinet:vehicles" }],
    ],
  },
});

const buildCarrierOrderActions = (order: any) => {
  if (order.status === "ACCEPTED") {
    return {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "В работу", callback_data: `carrier-order-status:${order.id}:IN_PROGRESS` },
            { text: "Отменить", callback_data: `carrier-order-status:${order.id}:CANCELLED` },
          ],
        ],
      },
    };
  }

  if (order.status === "IN_PROGRESS") {
    return {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Завершить", callback_data: `carrier-order-status:${order.id}:COMPLETED` },
            { text: "Отменить", callback_data: `carrier-order-status:${order.id}:CANCELLED` },
          ],
        ],
      },
    };
  }

  return undefined;
};

const buildVehicleManageKeyboard = (vehicle: any) => ({
  reply_markup: {
    inline_keyboard: [
      [{ text: "Редактировать", callback_data: `carrier-vehicle-manage:${vehicle.id}` }],
      [{ text: vehicle.isActive ? "Скрыть машину" : "Активировать машину", callback_data: `carrier-vehicle-toggle:${vehicle.id}:${vehicle.isActive ? 0 : 1}` }],
    ],
  },
});

const buildVehicleFieldKeyboard = (vehicleId: number) => ({
  reply_markup: {
    inline_keyboard: [
      [{ text: "Тип транспорта", callback_data: `carrier-vehicle-edit:${vehicleId}:type` }],
      [{ text: "Марка / модель", callback_data: `carrier-vehicle-edit:${vehicleId}:brand` }],
      [{ text: "Вместимость", callback_data: `carrier-vehicle-edit:${vehicleId}:capacity` }],
      [{ text: "Госномер", callback_data: `carrier-vehicle-edit:${vehicleId}:plateNumber` }],
      [{ text: "Описание", callback_data: `carrier-vehicle-edit:${vehicleId}:description` }],
      [{ text: "Характеристики", callback_data: `carrier-vehicle-edit:${vehicleId}:features` }],
      [{ text: "Фото", callback_data: `carrier-vehicle-edit:${vehicleId}:photos` }],
    ],
  },
});

const buildCarrierDispatchVehicleKeyboard = (orderId: number, vehicles: Array<{ id: number; brand?: string | null; plateNumber?: string | null }>) => ({
  reply_markup: {
    inline_keyboard: [
      [{ text: "Подобрать автоматически", callback_data: `carrier-order-dispatch:vehicle:${orderId}:0` }],
      ...vehicles.map((vehicle) => [
        {
          text: `${vehicle.brand ?? "Машина"}${vehicle.plateNumber ? ` • ${vehicle.plateNumber}` : ""}`,
          callback_data: `carrier-order-dispatch:vehicle:${orderId}:${vehicle.id}`,
        },
      ]),
      [{ text: CANCEL_TEXT, callback_data: "dispatch:cancel" }],
    ],
  },
});

const getTransientMessageIds = (ctx: any): number[] =>
  Array.isArray(ctx.session.transientMessageIds)
    ? ctx.session.transientMessageIds.filter(
        (messageId: unknown): messageId is number => typeof messageId === "number" && Number.isInteger(messageId) && messageId > 0
      )
    : [];

const setTransientMessageIds = (ctx: any, messageIds: number[]) => {
  ctx.session.transientMessageIds = Array.from(new Set(messageIds.filter((messageId) => Number.isInteger(messageId) && messageId > 0))).slice(-12);
};

const getOpenOrderMessageIds = (ctx: any): number[] =>
  Array.isArray(ctx.session.openOrderMessageIds)
    ? ctx.session.openOrderMessageIds.filter(
        (messageId: unknown): messageId is number => typeof messageId === "number" && Number.isInteger(messageId) && messageId > 0
      )
    : [];

const setOpenOrderMessageIds = (ctx: any, messageIds: number[]) => {
  ctx.session.openOrderMessageIds = Array.from(new Set(messageIds.filter((messageId) => Number.isInteger(messageId) && messageId > 0))).slice(-20);
};

const CUSTOMER_ORDER_CARD_MESSAGES_KEY = "customerOrderCardMessageIds";
const CARRIER_ORDER_CARD_MESSAGES_KEY = "carrierOrderCardMessageIds";
const CUSTOMER_OFFER_CARD_MESSAGES_KEY = "customerOfferCardMessageIds";

const getTrackedMessageMap = (ctx: any, key: string): Record<string, number> => {
  const source = ctx.session?.[key];
  if (!source || typeof source !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(source).filter(
      ([entityId, messageId]) => entityId.length > 0 && typeof messageId === "number" && Number.isInteger(messageId) && messageId > 0
    )
  ) as Record<string, number>;
};

const setTrackedMessageMap = (ctx: any, key: string, value: Record<string, number>) => {
  ctx.session[key] = Object.fromEntries(
    Object.entries(value).filter(
      ([entityId, messageId]) => entityId.length > 0 && typeof messageId === "number" && Number.isInteger(messageId) && messageId > 0
    )
  );
};

const getTrackedMessageId = (ctx: any, key: string, entityId: number | string) => getTrackedMessageMap(ctx, key)[String(entityId)];

const trackMessageId = (ctx: any, key: string, entityId: number | string, messageId: number) => {
  const map = getTrackedMessageMap(ctx, key);
  map[String(entityId)] = messageId;
  setTrackedMessageMap(ctx, key, map);
};

const forgetTrackedMessageId = (ctx: any, key: string, entityId: number | string) => {
  const map = getTrackedMessageMap(ctx, key);
  delete map[String(entityId)];
  setTrackedMessageMap(ctx, key, map);
};

const getCallbackMessageId = (ctx: any) => {
  const messageId = (ctx.callbackQuery as any)?.message?.message_id;
  return typeof messageId === "number" && Number.isInteger(messageId) && messageId > 0 ? messageId : undefined;
};

const safeDeleteMessage = async (ctx: any, messageId?: number) => {
  if (!ctx.chat?.id || !messageId) {
    return;
  }

  try {
    await bot.telegram.deleteMessage(ctx.chat.id, messageId);
  } catch {
    // Telegram can refuse deletion for old or already removed messages. This is safe to ignore.
  }
};

const clearTransientMessages = async (ctx: any) => {
  const messageIds = getTransientMessageIds(ctx);
  setTransientMessageIds(ctx, []);
  await Promise.all(messageIds.map((messageId) => safeDeleteMessage(ctx, messageId)));
};

const clearOpenOrderMessages = async (ctx: any) => {
  const messageIds = getOpenOrderMessageIds(ctx);
  setOpenOrderMessageIds(ctx, []);
  await Promise.all(messageIds.map((messageId) => safeDeleteMessage(ctx, messageId)));
};

const clearTrackedMessagesByKey = async (ctx: any, key: string) => {
  const messageIds = Object.values(getTrackedMessageMap(ctx, key));
  setTrackedMessageMap(ctx, key, {});
  await Promise.all(messageIds.map((messageId) => safeDeleteMessage(ctx, messageId)));
};

const clearFlowMessages = async (ctx: any) => {
  const stepData = (ctx.session.stepData ?? {}) as Record<string, unknown>;
  const draftMessageId = typeof stepData.draftMessageId === "number" ? stepData.draftMessageId : undefined;
  const messageIds = draftMessageId ? [...getTransientMessageIds(ctx), draftMessageId] : getTransientMessageIds(ctx);

  setTransientMessageIds(ctx, []);
  await Promise.all(Array.from(new Set(messageIds)).map((messageId) => safeDeleteMessage(ctx, messageId)));
};

const replyTransient = async (
  ctx: any,
  text: string,
  extra?: Record<string, unknown>,
  options?: {
    replace?: boolean;
  }
) => {
  const shouldReplace = options?.replace !== false;
  if (shouldReplace) {
    await clearTransientMessages(ctx);
  }

  const message = extra ? await ctx.reply(text, extra) : await ctx.reply(text);
  const nextMessageIds = shouldReplace ? [message.message_id] : [...getTransientMessageIds(ctx), message.message_id];
  setTransientMessageIds(ctx, nextMessageIds);
  return message;
};

const replyReplacingCurrentMessage = async (ctx: any, text: string, extra?: Record<string, unknown>) => {
  const callbackMessageId = getCallbackMessageId(ctx);
  if (callbackMessageId) {
    try {
      if (extra) {
        await ctx.editMessageText(text, extra);
      } else {
        await ctx.editMessageText(text);
      }
      return callbackMessageId;
    } catch {
      await safeDeleteMessage(ctx, callbackMessageId);
    }
  }

  const message = extra ? await ctx.reply(text, extra) : await ctx.reply(text);
  return message.message_id;
};

const appendPromptLead = (lead: string | undefined, prompt: string) => (lead ? `${lead}\n\n${prompt}` : prompt);

const resetSession = (ctx: any) => {
  void clearFlowMessages(ctx);
  ctx.session.state = BotState.NONE;
  ctx.session.stepData = {};
  ctx.session.transientMessageIds = [];
};

const getTelegramId = (ctx: any) => Number(ctx.from?.id ?? 0);

const normalizeControlText = (value: string) => value.trim().toLowerCase();

const isDoneInput = (value: string) => ["готово", "done"].includes(normalizeControlText(value));

const isSkipInput = (value: string) => ["пропустить", "skip"].includes(normalizeControlText(value));

const isNoInput = (value: string) => ["нет", "no"].includes(normalizeControlText(value));

const parseDecimalInput = (value: string) => Number(value.replace(/\s+/g, "").replace(",", "."));

const parseIntegerInput = (value: string) => Number(value.replace(/\s+/g, ""));

const parseEtaInput = (value: string) => {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }

  if (/^\d+$/.test(normalized)) {
    return `${normalized} мин`;
  }

  if (/^\d+[.,]?\d*\s*(мин|минута|минут|час|часа|часов)$/i.test(normalized)) {
    return normalized.replace(",", ".");
  }

  return normalized.length <= 30 ? normalized : null;
};

const CALENDAR_MONTH_NAMES = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const CALENDAR_WEEKDAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const TIME_PICKER_HOURS = Array.from({ length: 24 }, (_, index) => index);
const TIME_PICKER_MINUTES = [0, 15, 30, 45];
const DATE_PICKER_IGNORE = "order-date:ignore";
const DATE_PICKER_MANUAL = "order-date:manual";
const PRICE_USE_SUGGESTED = "order-price:use-suggested";
const PRICE_ENTER_MANUAL = "order-price:enter-manual";

bot.use(async (ctx, next) => {
  const previousState = (ctx.session?.state as BotState | undefined) ?? BotState.NONE;
  await next();

  if (previousState !== BotState.NONE && typeof ctx.message?.message_id === "number") {
    await safeDeleteMessage(ctx, ctx.message.message_id);
  }
});

const pad2 = (value: number) => value.toString().padStart(2, "0");

const chunkArray = <T>(items: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const formatDateKey = (year: number, month: number, day: number) => `${year}-${pad2(month)}-${pad2(day)}`;

const buildDateFromKey = (dateKey: string, hour = 12, minute = 0) => {
  const [yearText, monthText, dayText] = dateKey.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (![year, month, day].every((value) => Number.isInteger(value))) {
    return null;
  }

  const parsed = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
    return null;
  }

  return parsed;
};

const getMonthViewDate = (baseDate?: Date) => {
  const source = baseDate ?? new Date();
  return new Date(source.getFullYear(), source.getMonth(), 1);
};

const buildDatePickerKeyboard = (baseDate?: Date) => {
  const viewDate = getMonthViewDate(baseDate);
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const dayOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const calendarCells: Array<{ text: string; callback_data: string }> = [];

  for (let index = 0; index < dayOffset; index += 1) {
    calendarCells.push({ text: " ", callback_data: DATE_PICKER_IGNORE });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const cellDate = new Date(year, month, day);
    const isPastDay = cellDate.getTime() < todayStart;
    const isToday = cellDate.getTime() === todayStart;
    calendarCells.push({
      text: isToday ? `•${day}•` : String(day),
      callback_data: isPastDay ? DATE_PICKER_IGNORE : `order-date:day:${formatDateKey(year, month + 1, day)}`,
    });
  }

  while (calendarCells.length % 7 !== 0) {
    calendarCells.push({ text: " ", callback_data: DATE_PICKER_IGNORE });
  }

  const previousMonth = new Date(year, month - 1, 1);
  const nextMonth = new Date(year, month + 1, 1);

  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "←", callback_data: `order-date:month:${previousMonth.getFullYear()}:${previousMonth.getMonth() + 1}` },
          { text: `${CALENDAR_MONTH_NAMES[month]} ${year}`, callback_data: DATE_PICKER_IGNORE },
          { text: "→", callback_data: `order-date:month:${nextMonth.getFullYear()}:${nextMonth.getMonth() + 1}` },
        ],
        CALENDAR_WEEKDAY_NAMES.map((label) => ({ text: label, callback_data: DATE_PICKER_IGNORE })),
        ...chunkArray(calendarCells, 7),
        [{ text: "Ввести вручную", callback_data: DATE_PICKER_MANUAL }],
        [{ text: BACK_TEXT, callback_data: ORDER_FLOW_BACK }],
      ],
    },
  };
};

const buildTimeHourKeyboard = (dateKey: string) => ({
  reply_markup: {
    inline_keyboard: [
      ...chunkArray(
        TIME_PICKER_HOURS.map((hour) => ({
          text: pad2(hour),
          callback_data: `order-time:hour:${dateKey}:${pad2(hour)}`,
        })),
        6
      ),
      [{ text: "Ввести вручную", callback_data: DATE_PICKER_MANUAL }],
      [{ text: BACK_TEXT, callback_data: ORDER_FLOW_BACK }],
    ],
  },
});

const buildTimeMinuteKeyboard = (dateKey: string, hour: number) => ({
  reply_markup: {
    inline_keyboard: [
      TIME_PICKER_MINUTES.map((minute) => ({
        text: pad2(minute),
        callback_data: `order-time:minute:${dateKey}:${pad2(hour)}:${pad2(minute)}`,
      })),
      [{ text: "Изменить час", callback_data: `order-time:back:${dateKey}` }],
      [{ text: "Ввести вручную", callback_data: DATE_PICKER_MANUAL }],
      [{ text: BACK_TEXT, callback_data: ORDER_FLOW_BACK }],
    ],
  },
});

const buildSuggestedPriceKeyboard = (suggestedPrice: number) => ({
  reply_markup: {
    inline_keyboard: [
      [{ text: `Оставить ${suggestedPrice} ₽`, callback_data: PRICE_USE_SUGGESTED }],
      [{ text: "Ввести свою цену", callback_data: PRICE_ENTER_MANUAL }],
      [{ text: BACK_TEXT, callback_data: ORDER_FLOW_BACK }],
    ],
  },
});

const buildOrderEditKeyboard = (vehicleType?: string) => {
  const isPassengerOrder = PASSENGER_VEHICLE_TYPES.includes(String(vehicleType ?? ""));

  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Маршрут", callback_data: "edit_order_field:route" }],
        [{ text: "Дата и время", callback_data: "edit_order_field:date" }],
        [{ text: "Цена", callback_data: "edit_order_field:price" }],
        [{ text: isPassengerOrder ? "Пассажиры" : "Данные груза", callback_data: "edit_order_field:details" }],
        [{ text: "Комментарий", callback_data: "edit_order_field:comment" }],
        [{ text: "Начать заново", callback_data: "edit_order_field:restart" }],
        [{ text: CANCEL_TEXT, callback_data: "edit_order_field:cancel" }],
      ],
    },
  };
};

const buildRouteEditKeyboard = () => ({
  reply_markup: {
    inline_keyboard: [
      [{ text: "Изменить откуда", callback_data: "edit_order_route:from" }],
      [{ text: "Изменить куда", callback_data: "edit_order_route:to" }],
      [{ text: "Поменять местами", callback_data: "edit_order_route:swap" }],
      [{ text: BACK_TEXT, callback_data: "edit_order_route:back" }],
    ],
  },
});

const buildCustomerCategoryKeyboard = (categories: Array<{ id: number; name: string }>) => ({
  reply_markup: {
    inline_keyboard: categories.map((category) => [{ text: category.name, callback_data: `category:${category.id}` }]),
  },
});

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

const resetPassengerPlanningStep = (stepData: Record<string, unknown>) => ({
  ...stepData,
  date: undefined,
  estimatedDistanceKm: undefined,
  estimatedDurationHours: undefined,
  suggestedPrice: undefined,
  price: undefined,
  adultsCount: undefined,
  childrenCount: undefined,
  passengersCount: undefined,
});

const validatePassengerOrderStepData = (stepData: Record<string, unknown>) =>
  validatePassengerTripRules({
    departureAt: new Date(String(stepData.date)),
    durationHours: Number(stepData.estimatedDurationHours),
    adultsCount: typeof stepData.adultsCount === "number" ? stepData.adultsCount : Number(stepData.adultsCount),
    childrenCount: typeof stepData.childrenCount === "number" ? stepData.childrenCount : Number(stepData.childrenCount),
    leadHours: config.childTripLeadHours,
  nightStartHour: config.childTripNightStartHour,
  nightEndHour: config.childTripNightEndHour,
  });

const resetRouteEstimationStep = (
  stepData: Record<string, unknown>,
  target: "routeFrom" | "routeTo" | "date" = "date"
) => {
  const nextStepData: Record<string, unknown> = {
    ...stepData,
    date: undefined,
    estimatedDistanceKm: undefined,
    estimatedDurationHours: undefined,
    suggestedPrice: undefined,
    price: undefined,
    adultsCount: undefined,
    childrenCount: undefined,
    passengersCount: undefined,
    comment: undefined,
    cargoDescription: undefined,
    weight: undefined,
    volume: undefined,
  };

  if (target === "routeFrom") {
    nextStepData.routeFrom = undefined;
    nextStepData.routeFromLat = undefined;
    nextStepData.routeFromLng = undefined;
    nextStepData.routeTo = undefined;
    nextStepData.routeToLat = undefined;
    nextStepData.routeToLng = undefined;
  }

  if (target === "routeTo") {
    nextStepData.routeTo = undefined;
    nextStepData.routeToLat = undefined;
    nextStepData.routeToLng = undefined;
  }

  return nextStepData;
};

const estimateRouteForStepData = async (stepData: Record<string, unknown>) =>
  routeService.estimateRoute({
    routeFrom: String(stepData.routeFrom ?? ""),
    routeFromLat: typeof stepData.routeFromLat === "number" ? stepData.routeFromLat : undefined,
    routeFromLng: typeof stepData.routeFromLng === "number" ? stepData.routeFromLng : undefined,
    routeTo: String(stepData.routeTo ?? ""),
    routeToLat: typeof stepData.routeToLat === "number" ? stepData.routeToLat : undefined,
    routeToLng: typeof stepData.routeToLng === "number" ? stepData.routeToLng : undefined,
    regionName: typeof stepData.regionName === "string" ? stepData.regionName : undefined,
  });

const handleRouteEstimationError = async (ctx: any, stepData: Record<string, unknown>, error: unknown) => {
  if (!(error instanceof RouteEstimationError)) {
    throw error;
  }

  if (error.code === "ROUTE_FROM_NOT_FOUND") {
    ctx.session.stepData = resetRouteEstimationStep(stepData, "routeFrom");
    await promptRouteFrom(ctx, error.message);
    return;
  }

  if (error.code === "ROUTE_TO_NOT_FOUND") {
    ctx.session.stepData = resetRouteEstimationStep(stepData, "routeTo");
    await promptRouteTo(ctx, error.message);
    return;
  }

  if (error.code === "ROUTE_NOT_FOUND") {
    ctx.session.stepData = resetRouteEstimationStep(stepData, "routeTo");
    await promptRouteTo(ctx, error.message);
    return;
  }

  ctx.session.stepData = resetRouteEstimationStep(stepData, "date");
  await promptDepartureDate(ctx, `${error.message}\nПовторите дату отправления, и я попробую пересчитать маршрут автоматически.`);
};

const buildDepartureDatePromptText = () =>
  "Шаг 3 из 5. Когда подать транспорт?\nВыберите дату в календаре. Если удобнее, можно нажать «Ввести вручную».";

const buildDepartureTimePromptText = (dateKey: string) => {
  const selectedDate = buildDateFromKey(dateKey);
  const formattedDate = selectedDate ? selectedDate.toLocaleDateString("ru-RU") : dateKey;
  return `Шаг 3 из 5. Выберите час отправления для ${formattedDate}.`;
};

const buildDepartureMinutePromptText = (dateKey: string, hour: number) => {
  const selectedDate = buildDateFromKey(dateKey);
  const formattedDate = selectedDate ? selectedDate.toLocaleDateString("ru-RU") : dateKey;
  return `Шаг 3 из 5. Выберите минуты для ${formattedDate}, ${pad2(hour)}:00.`;
};

const promptManualPrice = async (ctx: any) => {
  await replyTransient(ctx, "Шаг 4 из 5. Введите вашу цену в рублях:", buildFlowCancelKeyboard());
};

const promptAdultsCount = async (ctx: any) => {
  await replyTransient(ctx, "Шаг 5 из 5. Укажите количество взрослых пассажиров:", buildPassengerCountKeyboard());
};

const promptChildrenCount = async (ctx: any) => {
  await replyTransient(ctx, "Шаг 5 из 5. Укажите количество детей:", buildPassengerCountKeyboard());
};

const promptOrderComment = async (ctx: any) => {
  await replyTransient(ctx, "Почти готово. Добавьте комментарий или нажмите «Нет».", buildCommentKeyboard());
};

const promptCargoDescription = async (ctx: any) => {
  await replyTransient(ctx, "Шаг 5 из 5. Опишите груз:", buildFlowCancelKeyboard());
};

const promptCargoWeight = async (ctx: any) => {
  await replyTransient(ctx, "Шаг 5 из 5. Введите вес груза в килограммах или 0, если неизвестен:", buildWeightKeyboard());
};

const promptCargoVolume = async (ctx: any) => {
  await replyTransient(ctx, "Шаг 5 из 5. Введите объем груза в кубометрах или 0, если неизвестен:", buildWeightKeyboard());
};

const promptCarrierOfferPrice = async (ctx: any) => {
  await replyTransient(ctx, "Введите свою цену для заказа в рублях:", buildFlowCancelKeyboard());
};

const promptCarrierEta = async (ctx: any, title = "Укажите ориентировочное время подачи:") => {
  await replyTransient(ctx, title, buildEtaKeyboard());
};

const promptCustomerCounterPrice = async (ctx: any) => {
  await replyTransient(ctx, "Введите встречную цену в рублях:", buildFlowCancelKeyboard());
};

const promptSuggestedPriceChoice = async (ctx: any, stepData: Record<string, unknown>) => {
  const suggestedPrice = Number(stepData.suggestedPrice ?? 0);
  if (suggestedPrice > 0) {
    await replyTransient(
      ctx,
      `Шаг 4 из 5. Маршрут рассчитан: ${stepData.estimatedDistanceKm} км, примерно ${stepData.estimatedDurationHours} ч в пути.\nРекомендованная цена по тарифу: ${suggestedPrice} ₽.`,
      buildSuggestedPriceKeyboard(suggestedPrice)
    );
    return;
  }

  await replyTransient(
    ctx,
    `Шаг 4 из 5. Маршрут рассчитан: ${stepData.estimatedDistanceKm} км, примерно ${stepData.estimatedDurationHours} ч в пути.\nДля этого маршрута нет готовой рекомендации, введите вашу цену в рублях.`,
    buildFlowCancelKeyboard()
  );
};

const continueCustomerOrderAfterPrice = async (ctx: any, stepData: Record<string, unknown>) => {
  const vehicleType = String(stepData.vehicleType ?? "");
  const isPassengerOrder = PASSENGER_VEHICLE_TYPES.includes(vehicleType);
  const isCargoOrder = CARGO_VEHICLE_TYPES.includes(vehicleType);

  ctx.session.stepData = stepData;

  if (isPassengerOrder) {
    if (stepData.adultsCount === undefined) {
      await promptAdultsCount(ctx);
      return;
    }

    if (stepData.childrenCount === undefined) {
      await promptChildrenCount(ctx);
      return;
    }

    try {
      const passengersCount = validatePassengerOrderStepData(stepData);
      ctx.session.stepData = { ...stepData, passengersCount };
    } catch (error) {
      ctx.session.stepData = resetPassengerPlanningStep(stepData);
      await promptDepartureDate(
        ctx,
        `${(error as Error).message}\nУкажите новую дату и время отправления. Подойдут варианты: 2026-05-14 15:30, 14.05.2026 15:30 или 14.05.2026.`
      );
      return;
    }

    await promptOrderComment(ctx);
    return;
  }

  if (isCargoOrder) {
    await promptCargoDescription(ctx);
    return;
  }

  await promptOrderComment(ctx);
  return;

  if (isPassengerOrder) {
    if (stepData.adultsCount === undefined) {
      await ctx.reply("Введите количество взрослых пассажиров:");
      return;
    }

    if (stepData.childrenCount === undefined) {
      await ctx.reply("Введите количество детей:");
      return;
    }

    try {
      const passengersCount = validatePassengerOrderStepData(stepData);
      ctx.session.stepData = { ...stepData, passengersCount };
    } catch (error) {
      ctx.session.stepData = resetPassengerPlanningStep(stepData);
      await ctx.reply(
        `${(error as Error).message}\nУкажите новую дату и время отправления. Подойдут варианты: 2026-05-14 15:30, 14.05.2026 15:30 или просто 14.05.2026.`,
        removeKeyboardMarkup
      );
      return;
    }

    await ctx.reply("Введите комментарий к заявке или напишите 'Нет':");
    return;
  }

  if (isCargoOrder) {
    await ctx.reply("Опишите груз:");
    return;
  }

  await ctx.reply("Введите комментарий к заявке или напишите 'Нет':");
};

const showDepartureDatePicker = async (ctx: any, baseDate?: Date, edit = false) => {
  const text = buildDepartureDatePromptText();
  const keyboard = buildDatePickerKeyboard(baseDate);

  if (edit) {
    await ctx.editMessageText(text, keyboard);
    return;
  }

  await replyTransient(ctx, text, keyboard);
};

const showDepartureHourPicker = async (ctx: any, dateKey: string, edit = true) => {
  const text = buildDepartureTimePromptText(dateKey);
  const keyboard = buildTimeHourKeyboard(dateKey);

  if (edit) {
    await ctx.editMessageText(text, keyboard);
    return;
  }

  await replyTransient(ctx, text, keyboard);
};

const showDepartureMinutePicker = async (ctx: any, dateKey: string, hour: number, edit = true) => {
  const text = buildDepartureMinutePromptText(dateKey, hour);
  const keyboard = buildTimeMinuteKeyboard(dateKey, hour);

  if (edit) {
    await ctx.editMessageText(text, keyboard);
    return;
  }

  await replyTransient(ctx, text, keyboard);
};

const completeOrderDateSelection = async (ctx: any, stepData: Record<string, unknown>, selectedDate: Date, timeWasInferred = false) => {
  if (selectedDate.getTime() <= Date.now()) {
    ctx.session.stepData = resetRouteEstimationStep(stepData, "date");
    await ctx.reply("Дата поездки должна быть в будущем. Выберите другую дату или время.");
    await showDepartureDatePicker(ctx, selectedDate, false);
    return;
  }

  const updatedStepData: Record<string, unknown> = { ...stepData, date: selectedDate.toISOString() };
  ctx.session.stepData = updatedStepData;

  if (timeWasInferred) {
    await replyTransient(
      ctx,
      `Время не указано, поставил ${selectedDate.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}. Это можно поправить через редактирование заявки.`,
      undefined,
      { replace: false }
    );
  }

  await replyTransient(ctx, "Считаю маршрут и время в пути...", removeKeyboardMarkup, { replace: false });

  try {
    const routeEstimate = await estimateRouteForStepData(updatedStepData);
    const suggestedPrice = await pricingService.calculateSuggestedPrice(
      String(updatedStepData.vehicleType ?? ""),
      routeEstimate.estimatedDistanceKm,
      routeEstimate.estimatedDurationHours
    );

    ctx.session.stepData = await syncOrderDraftMessage(ctx, {
      ...updatedStepData,
      routeFromLat: routeEstimate.routeFromLat,
      routeFromLng: routeEstimate.routeFromLng,
      routeToLat: routeEstimate.routeToLat,
      routeToLng: routeEstimate.routeToLng,
      estimatedDistanceKm: routeEstimate.estimatedDistanceKm,
      estimatedDurationHours: routeEstimate.estimatedDurationHours,
      suggestedPrice: suggestedPrice ?? undefined,
    });

    await promptSuggestedPriceChoice(ctx, ctx.session.stepData);
  } catch (error) {
    await handleRouteEstimationError(ctx, updatedStepData, error);
  }
};

const buildOrderDraftText = (stepData: Record<string, any>) =>
  [
    "Черновик заявки",
    `Регион: ${stepData.regionName ?? "—"}`,
    `Транспорт: ${stepData.vehicleLabel ?? (stepData.vehicleType ? toVehicleLabel(stepData.vehicleType) : "—")}`,
    `Категория: ${stepData.categoryName ?? "—"}`,
    `Откуда: ${stepData.routeFrom ?? "—"}`,
    `Куда: ${stepData.routeTo ?? "—"}`,
    `Дата: ${stepData.date ? new Date(stepData.date).toLocaleString("ru-RU") : "—"}`,
    stepData.estimatedDistanceKm ? `Километраж: ${stepData.estimatedDistanceKm} км` : null,
    stepData.estimatedDurationHours ? `Время в пути: ${stepData.estimatedDurationHours} ч` : null,
    stepData.price ? `Цена: ${stepData.price} ₽` : null,
    ...buildPassengerSummaryLines(stepData),
    stepData.cargoDescription ? `Груз: ${stepData.cargoDescription}` : null,
  ]
    .filter(Boolean)
    .join("\n");

const syncOrderDraftMessage = async (ctx: any, stepData: Record<string, any>) => {
  if (!ctx.chat?.id) {
    return stepData;
  }

  const sessionStepData = (ctx.session.stepData ?? {}) as Record<string, any>;
  const nextStepData =
    typeof stepData.draftMessageId === "number" || typeof sessionStepData.draftMessageId !== "number"
      ? stepData
      : { ...stepData, draftMessageId: sessionStepData.draftMessageId };

  const text = buildOrderDraftText(nextStepData);
  const draftMessageId = typeof nextStepData.draftMessageId === "number" ? nextStepData.draftMessageId : undefined;

  if (draftMessageId) {
    try {
      await bot.telegram.editMessageText(ctx.chat.id, draftMessageId, undefined, text);
      return nextStepData;
    } catch {
      await safeDeleteMessage(ctx, draftMessageId);
    }
  }

  const message = await ctx.reply(text, removeKeyboardMarkup);
  return { ...nextStepData, draftMessageId: message.message_id };
};

const buildOrderPreviewText = (stepData: Record<string, any>) =>
  [
    `Регион: ${stepData.regionName ?? stepData.regionId}`,
    `Тип транспорта: ${stepData.vehicleLabel ?? toVehicleLabel(stepData.vehicleType)}`,
    `Категория: ${stepData.categoryName ?? stepData.categoryId}`,
    `Маршрут: ${stepData.routeFrom} → ${stepData.routeTo}`,
    buildMapLinkLine("Отправление на карте", stepData.routeFromLat, stepData.routeFromLng),
    buildMapLinkLine("Назначение на карте", stepData.routeToLat, stepData.routeToLng),
    `Дата: ${new Date(stepData.date).toLocaleString("ru-RU")}`,
    `Километраж: ${stepData.estimatedDistanceKm} км`,
    `Время в пути: ${stepData.estimatedDurationHours} ч`,
    `Цена заказчика: ${stepData.price} ₽`,
    stepData.suggestedPrice ? `Рекомендованная цена: ${stepData.suggestedPrice} ₽` : null,
    ...buildPassengerSummaryLines(stepData),
    stepData.cargoDescription ? `Груз: ${stepData.cargoDescription}` : null,
    stepData.comment ? `Комментарий: ${stepData.comment}` : null,
  ]
    .filter(Boolean)
    .join("\n");

const showOrderConfirmation = async (ctx: any, stepData: Record<string, any>) => {
  ctx.session.stepData = stepData;
  ctx.session.state = BotState.CUSTOMER_ORDER_CONFIRM;
  await replyTransient(ctx, buildOrderPreviewText(stepData), {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Подтвердить", callback_data: "confirm_order" }],
        [{ text: "Редактировать", callback_data: "edit_order" }],
      ],
    },
  });
};

const getCarrierRegionIds = (carrier: any) => {
  const relationIds = (carrier?.carrierRegions ?? []).map((item: any) => item.regionId);
  const fallbackIds = carrier?.regionId ? [carrier.regionId] : [];
  return Array.from(new Set([...relationIds, ...fallbackIds]));
};

const formatCarrierRegionNames = (carrier: any) => {
  const relationNames = (carrier?.carrierRegions ?? []).map((item: any) => item.region?.name).filter(Boolean);
  if (relationNames.length > 0) {
    return Array.from(new Set(relationNames)).join(", ");
  }

  return carrier?.region?.name ?? "не указаны";
};

const showCustomerRegionPicker = async (ctx: any, message = "Выберите регион:") => {
  const regions = await regionRepository.listAll();
  await replyTransient(ctx, message, buildRegionKeyboard("region", regions));
};

const showCustomerVehiclePicker = async (ctx: any, message = "Выберите тип транспорта:") => {
  await replyTransient(ctx, message, buildVehicleTypeKeyboard("vehicle"));
};

const showCustomerCategoryPicker = async (ctx: any, message = "Выберите категорию перевозки:") => {
  const categories = await categoryRepository.listAll();
  await replyTransient(ctx, message, buildCustomerCategoryKeyboard(categories));
};

const beginCustomerOrderFlow = async (
  ctx: any,
  message = "\u0428\u0430\u0433 1. \u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0440\u0435\u0433\u0438\u043e\u043d \u043f\u043e\u0434\u0430\u0447\u0438 \u0437\u0430\u043a\u0430\u0437\u0430:"
) => {
  await clearFlowMessages(ctx);
  ctx.session.state = BotState.CUSTOMER_ORDER_REGION;
  ctx.session.stepData = {};
  ctx.session.stepData = await syncOrderDraftMessage(ctx, {});
  await showCustomerRegionPicker(ctx, message);
};

const showCarrierRegistrationRegionPicker = async (ctx: any, selectedRegionIds: number[] = []) => {
  const regions = await regionRepository.listAll();
  await replyTransient(
    ctx,
    "Выберите один или несколько регионов работы. Можно отметить несколько кнопок, затем нажмите «Сохранить регионы».",
    buildCarrierRegionPicker("carrier-region-toggle", regions, selectedRegionIds, "carrier-region-confirm")
  );
};

const promptRouteFrom = async (ctx: any, lead?: string) => {
  await replyTransient(
    ctx,
    appendPromptLead(
      lead,
      "Шаг 1 из 5. Откуда поедем?\nВведите адрес текстом, координаты в виде 55.796127, 49.106414, вставьте ссылку из Google/Yandex или отправьте точку кнопкой ниже.\nНапример: Кремль Казань, Декабристов 12."
    ),
    buildLocationKeyboard()
  );
};

const promptRouteTo = async (ctx: any, lead?: string) => {
  await replyTransient(
    ctx,
    appendPromptLead(
      lead,
      "Шаг 2 из 5. Куда едем?\nВведите адрес текстом, координаты в виде 55.796127, 49.106414, вставьте ссылку из Google/Yandex или отправьте точку кнопкой ниже.\nНапример: Декабристов 55 или адрес в свободной форме."
    ),
    buildLocationKeyboard()
  );
};

const showRouteEditMenu = async (ctx: any, stepData: Record<string, any>, lead?: string) => {
  const routeSummary =
    stepData.routeFrom && stepData.routeTo ? `Текущий маршрут: ${stepData.routeFrom} → ${stepData.routeTo}` : "Маршрут пока заполнен не полностью.";
  const text = [lead ?? "Что изменить в маршруте?", routeSummary].filter(Boolean).join("\n");
  await replyTransient(ctx, text, buildRouteEditKeyboard());
};

const promptDepartureDate = async (ctx: any, lead?: string) => {
  await replyTransient(
    ctx,
    appendPromptLead(
      lead,
      "Введите дату отправления.\nПодойдут форматы: 2026-05-14 15:30, 14.05.2026 15:30, 14-05-2026 или просто 14.05.2026.\nЕсли время не указано, поставлю 12:00."
    ),
    removeKeyboardMarkup
  );
};

const promptCarrierPhone = async (ctx: any) => {
  await replyTransient(ctx, "Отправьте номер телефона кнопкой ниже или введите вручную в формате +7 999 123-45-67.", buildContactKeyboard());
};

const beginCarrierVehicleWizard = async (ctx: any, userId: number) => {
  ctx.session.state = BotState.CARRIER_VEHICLE_REGISTRATION;
  ctx.session.stepData = { userId, mode: "vehicle", step: "vehicleType", photos: [] };
  await replyTransient(ctx, "Выберите тип транспорта:", buildVehicleTypeKeyboard("carrier-vehicle"));
};

const formatOrderCard = (order: any) => {
  const lines = [
    `#${order.id} [${order.status}]`,
    `${order.routeFrom} → ${order.routeTo}`,
    buildMapLinkLine("Отправление на карте", order.routeFromLat, order.routeFromLng),
    buildMapLinkLine("Назначение на карте", order.routeToLat, order.routeToLng),
    `Регион: ${order.region?.name ?? order.regionId}`,
    `Категория: ${order.category?.name ?? order.categoryId}`,
    `Транспорт: ${toVehicleLabel(order.vehicleType)}`,
    `Дата: ${new Date(order.date).toLocaleString("ru-RU")}`,
    `Цена: ${order.price} ₽`,
    order.estimatedDistanceKm ? `Километраж: ${order.estimatedDistanceKm} км` : null,
    order.estimatedDurationHours ? `Часы: ${order.estimatedDurationHours}` : null,
    ...buildPassengerSummaryLines(order),
    order.cargoDescription ? `Груз: ${order.cargoDescription}` : null,
    order.comment ? `Комментарий: ${order.comment}` : null,
    order.vehicle ? formatVehicleSummary(order.vehicle) : null,
  ];

  return lines.filter(Boolean).join("\n");
};

const promptCarrierVehiclePhotos = async (ctx: any) => {
  await replyTransient(
    ctx,
    `Отправьте фото транспорта. Можно отправить несколько фото по одному. Когда закончите, нажмите "${DONE_TEXT}" или "${SKIP_TEXT}".`,
    buildPhotoStepKeyboard()
  );
};

const showCustomerMenu = async (ctx: any) => {
  await ctx.reply("Главное меню заказчика", buildCustomerMenu(isAdminTelegramId(getTelegramId(ctx))));
};

const showCarrierMenu = async (ctx: any) => {
  await ctx.reply("Главное меню перевозчика", buildCarrierMenu(isAdminTelegramId(getTelegramId(ctx))));
};

const showMenuForCurrentUser = async (ctx: any) => {
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);

  if (!user) {
    await ctx.reply("Сначала выполните /start.");
    return;
  }

  if (user.role === "CUSTOMER") {
    await showCustomerMenu(ctx);
    return;
  }

  if (user.role === "CARRIER") {
    await showCarrierMenu(ctx);
    return;
  }

  await ctx.reply("Выберите роль в системе:", buildRoleKeyboard());
};

const showHelp = async (ctx: any) => {
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);

  const commonLines = [
    "Полезные команды:",
    "/start — открыть бота заново",
    "/menu — показать главное меню",
    "/orders — открыть заявки",
    "/history — открыть историю",
    "/open — показать новые открытые заказы для перевозчика",
    "/cancel — отменить текущий сценарий",
    "/back — вернуться на шаг назад",
  ];

  if (!user) {
    await ctx.reply([...commonLines, "", "Если вы здесь впервые, начните с /start."].join("\n"));
    return;
  }

  if (user.role === "CUSTOMER") {
    await ctx.reply(
      [
        ...commonLines,
        "",
        "Для заказчика:",
        "1. Создайте заявку.",
        "2. Откройте «Мои заявки» и смотрите отклики.",
        "3. Примите цену или торгуйтесь.",
        "4. После подтверждения депозита контакты откроются автоматически.",
        "5. После поездки можно заказать обратный рейс из карточки.",
      ].join("\n")
    );
    return;
  }

  await ctx.reply(
    [
      ...commonLines,
      "",
        "Для перевозчика:",
        "1. Завершите регистрацию и дождитесь модерации.",
        "2. Откройте /open или кнопку «Новые заказы», чтобы посмотреть свежие лиды.",
        "3. Берите заявки по цене заказчика или предлагайте свою.",
        "4. В карточке можно обновить ленту и свою активную заявку.",
        "5. После выбора вас заказчиком отправьте платежку через кнопку в карточке.",
        "6. После подтверждения депозита переведите заказ в работу и завершите его.",
      ].join("\n")
    );
  };

const showCustomerOffersForOrder = async (ctx: any, customerId: number, orderId: number) => {
  await clearTrackedMessagesByKey(ctx, CUSTOMER_OFFER_CARD_MESSAGES_KEY);
  const order = await orderRepository.findCustomerOrder(orderId, customerId);
  if (!order) {
    await ctx.reply("Заявка не найдена.");
    return;
  }

  const activeOffers = Array.isArray(order.offers)
    ? order.offers.filter((offer: any) => ["ACTIVE", "COUNTERED"].includes(String(offer.status ?? "")))
    : [];

  if (activeOffers.length === 0) {
    await ctx.reply(`По заявке #${order.id} активных откликов пока нет.`);
    return;
  }

  await sendCustomerOfferCards(ctx, order);
};

const showOrdersForCurrentUser = async (ctx: any) => {
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);
  if (!user) {
    await ctx.reply("Сначала выполните /start.");
    return;
  }

  if (user.role === "CUSTOMER") {
    await clearTrackedMessagesByKey(ctx, CUSTOMER_ORDER_CARD_MESSAGES_KEY);
    await clearTrackedMessagesByKey(ctx, CUSTOMER_OFFER_CARD_MESSAGES_KEY);

    const customer = await customerRepository.findByUserId(user.id);
    if (!customer) {
      await ctx.reply("Профиль заказчика пока не завершен.");
      return;
    }

    const orders = await customerRepository.findOrders(customer.id);
    if (orders.length === 0) {
      await ctx.reply("У вас пока нет заявок.");
      return;
    }

    await ctx.reply(`Ваши заявки: ${Math.min(orders.length, 10)} из ${orders.length}`);

    for (const order of orders.slice(0, 10)) {
      await sendCustomerOrderCard(ctx, order);
    }
    return;
  }

  const carrier = await carrierService.findCarrierByUserId(user.id);
  if (!carrier) {
    await ctx.reply("Сначала завершите регистрацию перевозчика.");
    return;
  }

  await clearTrackedMessagesByKey(ctx, CARRIER_ORDER_CARD_MESSAGES_KEY);
  await clearOpenOrderMessages(ctx);
  const orders = await orderRepository.listActiveByCarrierId(carrier.id);
  if (orders.length === 0) {
    await ctx.reply("У вас пока нет активных заявок.");
    return;
  }

  await ctx.reply(`Активные заявки: ${Math.min(orders.length, 10)} из ${orders.length}`);

  for (const order of orders.slice(0, 10)) {
    await sendCarrierOrderCard(ctx, order);
  }
};

const showHistoryForCurrentUser = async (ctx: any) => {
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);
  if (!user) {
    await ctx.reply("Сначала выполните /start.");
    return;
  }

  if (user.role === "CARRIER") {
    const carrier = await carrierService.findCarrierByUserId(user.id);
    if (!carrier) {
      await ctx.reply("Сначала завершите регистрацию перевозчика.");
      return;
    }

    await clearTrackedMessagesByKey(ctx, CARRIER_ORDER_CARD_MESSAGES_KEY);
    await clearOpenOrderMessages(ctx);
    const history = await orderRepository.listHistoryByCarrierId(carrier.id);
    if (history.length === 0) {
      await ctx.reply("История перевозчика пока пуста.");
      return;
    }

    await ctx.reply(`История перевозчика: ${Math.min(history.length, 10)} из ${history.length}`);

    for (const order of history.slice(0, 10)) {
      await sendCarrierOrderCard(ctx, order);
    }
    return;
  }

  if (user.role !== "CUSTOMER") {
    await ctx.reply("История доступна только зарегистрированным пользователям.");
    return;
  }

  const customer = await customerRepository.findByUserId(user.id);
  if (!customer) {
    await ctx.reply("Профиль заказчика пока не завершен.");
    return;
  }

  await clearTrackedMessagesByKey(ctx, CUSTOMER_ORDER_CARD_MESSAGES_KEY);
  await clearTrackedMessagesByKey(ctx, CUSTOMER_OFFER_CARD_MESSAGES_KEY);
  const orders = await customerRepository.findOrders(customer.id);
  const history = orders.filter((order) => order.status !== "NEW");
  if (history.length === 0) {
    await ctx.reply("История пока пуста.");
    return;
  }

  await ctx.reply(`История заказчика: ${Math.min(history.length, 10)} из ${history.length}`);

  for (const order of history.slice(0, 10)) {
    await sendCustomerOrderCard(ctx, order);
  }
};

const sendCarrierLeadCard = async (ctx: any, order: any, options?: { replaceCurrent?: boolean }) => {
  const replaceCurrent = options?.replaceCurrent === true;
  const ownOffer = Array.isArray(order.offers) ? order.offers[0] : null;
  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Взять по цене заказчика", callback_data: `accept_order:${order.id}` }],
        [{ text: ownOffer ? "Обновить свою цену" : "Предложить цену", callback_data: `offer_order:${order.id}` }],
        [{ text: "Обновить ленту", callback_data: "carrier-open-orders:refresh" }],
      ],
    },
  };

  if (replaceCurrent) {
    return replyReplacingCurrentMessage(ctx, buildOrderCardText(order, "CARRIER"), keyboard);
  }

  const message = await ctx.reply(buildOrderCardText(order, "CARRIER"), keyboard);
  return message.message_id;
};

const showOpenOrdersForCurrentCarrier = async (ctx: any) => {
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);
  if (!user) {
    await ctx.reply("Сначала выполните /start.");
    return;
  }

  if (user.role !== "CARRIER") {
    await ctx.reply("Лента новых заказов доступна только перевозчику.");
    return;
  }

  const carrier = await carrierService.findCarrierByUserId(user.id);
  if (!carrier) {
    await ctx.reply("Сначала завершите регистрацию перевозчика.");
    return;
  }

  if (carrier.status !== "APPROVED") {
    await ctx.reply("Профиль еще не одобрен. После модерации здесь появятся новые заказы.");
    return;
  }

  const currentCallbackMessageId = getCallbackMessageId(ctx);
  await clearOpenOrderMessages(ctx);
  if (currentCallbackMessageId) {
    await safeDeleteMessage(ctx, currentCallbackMessageId);
  }

  const orders = await orderRepository.listOpenForCarrier(carrier.id, 10);
  if (orders.length === 0) {
    await ctx.reply("Сейчас нет новых заказов под ваши регионы и транспорт.");
    return;
  }

  await ctx.reply(`Новые заказы: ${orders.length}`);

  const messageIds: number[] = [];
  for (const order of orders) {
    const messageId = await sendCarrierLeadCard(ctx, order);
    if (typeof messageId === "number") {
      messageIds.push(messageId);
    }
  }
  setOpenOrderMessageIds(ctx, messageIds);
};

const cancelActiveFlow = async (ctx: any) => {
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);
  const hadActiveFlow = ctx.session.state && ctx.session.state !== BotState.NONE;

  resetSession(ctx);

  if (!hadActiveFlow) {
    if (!user) {
      await ctx.reply("Сейчас нет активного сценария.");
      return;
    }

    if (user.role === "CUSTOMER") {
      await showCustomerMenu(ctx);
      return;
    }

    if (user.role === "CARRIER") {
      await showCarrierMenu(ctx);
      return;
    }
  }

  await ctx.reply("Текущий сценарий отменен.", removeKeyboardMarkup);

  if (!user) {
    await ctx.reply("Выберите роль в системе:", buildRoleKeyboard());
    return;
  }

  if (user.role === "CUSTOMER") {
    await showCustomerMenu(ctx);
    return;
  }

  if (user.role === "CARRIER") {
    await showCarrierMenu(ctx);
    return;
  }

  await ctx.reply("Выберите роль в системе:", buildRoleKeyboard());
};

const restoreCustomerOrderCard = async (ctx: any, userId: number, orderId: number) => {
  const customer = await customerRepository.findByUserId(userId);
  if (!customer) {
    resetSession(ctx);
    await showCustomerMenu(ctx);
    return;
  }

  const order = await orderRepository.findCustomerOrder(orderId, customer.id);
  resetSession(ctx);
  if (!order) {
    await showCustomerMenu(ctx);
    return;
  }

  await sendCustomerOrderCard(ctx, order, { preferTracked: true });
};

const restoreCarrierOrderCard = async (ctx: any, userId: number, orderId: number) => {
  const carrier = await carrierService.findCarrierByUserId(userId);
  if (!carrier) {
    resetSession(ctx);
    await showCarrierMenu(ctx);
    return;
  }

  const order = await orderRepository.findCarrierOrder(orderId, carrier.id);
  resetSession(ctx);
  if (!order) {
    await showCarrierMenu(ctx);
    return;
  }

  await sendCarrierOrderCard(ctx, order, { preferTracked: true });
};

const goBackInOrderActionFlow = async (ctx: any, user: any) => {
  const stepData = (ctx.session.stepData ?? {}) as Record<string, any>;
  const action = String(stepData.action ?? "");

  switch (action) {
    case "carrierDispatchDriverPhone":
      ctx.session.stepData = { ...stepData, action: "carrierDispatchDriverName", driverName: undefined };
      await replyTransient(ctx, "Введите имя водителя для этого заказа:", buildFlowCancelKeyboard());
      return;
    case "carrierDispatchDriverName":
    case "carrierDispatchVehicle":
      if (user?.role === "CARRIER" && stepData.orderId) {
        await startCarrierDispatchFlow(ctx, user.id, Number(stepData.orderId));
        return;
      }
      break;
    case "customerReturnComment":
      ctx.session.stepData = { ...stepData, action: "customerReturnDate", date: undefined };
      await replyTransient(
        ctx,
        "Введите дату и время обратного рейса. Подойдут форматы: 2026-05-24 18:30, 24.05.2026 18:30 или просто 24.05.2026.",
        buildFlowCancelKeyboard()
      );
      return;
    case "customerReturnDate":
      if (user?.role === "CUSTOMER" && stepData.sourceOrderId) {
        await restoreCustomerOrderCard(ctx, user.id, Number(stepData.sourceOrderId));
        return;
      }
      break;
    case "carrierDepositReference":
      if (user?.role === "CARRIER" && stepData.orderId) {
        await restoreCarrierOrderCard(ctx, user.id, Number(stepData.orderId));
        return;
      }
      break;
    case "carrierOfferEta":
      ctx.session.stepData = { ...stepData, action: "carrierOfferPrice", proposedPrice: undefined };
      await replyTransient(ctx, "Введите вашу цену для заказа в рублях:", buildFlowCancelKeyboard());
      return;
    case "carrierCounterEta":
      ctx.session.stepData = { ...stepData, action: "carrierCounterPrice", proposedPrice: undefined };
      await replyTransient(ctx, "Введите вашу новую цену в рублях:", buildFlowCancelKeyboard());
      return;
    default:
      break;
  }

  resetSession(ctx);

  if (user?.role === "CUSTOMER") {
    await showCustomerMenu(ctx);
    return;
  }

  if (user?.role === "CARRIER") {
    await showCarrierMenu(ctx);
    return;
  }
};

const goBackInCustomerOrderFlow = async (ctx: any) => {
  const state = ctx.session.state as BotState;
  const stepData = (ctx.session.stepData ?? {}) as Record<string, any>;
  const vehicleType = String(stepData.vehicleType ?? "");
  const isPassengerOrder = PASSENGER_VEHICLE_TYPES.includes(vehicleType);
  const isCargoOrder = CARGO_VEHICLE_TYPES.includes(vehicleType);

  if (state === BotState.CUSTOMER_ORDER_REGION) {
    resetSession(ctx);
    await showCustomerMenu(ctx);
    return;
  }

  if (state === BotState.CUSTOMER_ORDER_VEHICLE) {
    ctx.session.state = BotState.CUSTOMER_ORDER_REGION;
    ctx.session.stepData = {};
    await showCustomerRegionPicker(ctx, "Вернулись к выбору региона:");
    return;
  }

  if (state === BotState.CUSTOMER_ORDER_CATEGORY) {
    ctx.session.state = BotState.CUSTOMER_ORDER_VEHICLE;
    ctx.session.stepData = { regionId: stepData.regionId, regionName: stepData.regionName };
    await showCustomerVehiclePicker(ctx, "Вернулись к выбору типа транспорта:");
    return;
  }

  if (state === BotState.CUSTOMER_ORDER_CONFIRM) {
    ctx.session.state = BotState.CUSTOMER_ORDER_DETAILS;
    await replyTransient(ctx, "Что нужно изменить?", buildOrderEditKeyboard(vehicleType));
    return;
  }

  if (state !== BotState.CUSTOMER_ORDER_DETAILS) {
    await cancelActiveFlow(ctx);
    return;
  }

  if (!stepData.routeFrom) {
    ctx.session.state = BotState.CUSTOMER_ORDER_CATEGORY;
    await showCustomerCategoryPicker(ctx, "Вернулись к выбору категории:");
    return;
  }

  if (!stepData.routeTo) {
    ctx.session.stepData = await syncOrderDraftMessage(ctx, {
      ...stepData,
      routeFrom: undefined,
      routeFromLat: undefined,
      routeFromLng: undefined,
    });
    await promptRouteFrom(ctx);
    return;
  }

  if (!stepData.date) {
    ctx.session.stepData = resetRouteEstimationStep(stepData, "routeTo");
    await promptRouteTo(ctx);
    return;
  }

  if (stepData.price === undefined) {
    ctx.session.stepData = resetRouteEstimationStep(stepData, "date");
    await showDepartureDatePicker(ctx);
    return;
  }

  if (isPassengerOrder) {
    if (stepData.comment === undefined && stepData.childrenCount !== undefined) {
      ctx.session.stepData = { ...stepData, childrenCount: undefined, passengersCount: undefined };
      await promptChildrenCount(ctx);
      return;
    }

    if (stepData.childrenCount === undefined && stepData.adultsCount !== undefined) {
      ctx.session.stepData = { ...stepData, adultsCount: undefined, childrenCount: undefined, passengersCount: undefined };
      await promptAdultsCount(ctx);
      return;
    }

    ctx.session.stepData = { ...stepData, price: undefined, adultsCount: undefined, childrenCount: undefined, passengersCount: undefined, comment: undefined };
    if (Number(stepData.suggestedPrice ?? 0) > 0) {
      await promptSuggestedPriceChoice(ctx, ctx.session.stepData);
      return;
    }

    await promptManualPrice(ctx);
    return;
  }

  if (isCargoOrder) {
    if (stepData.comment === undefined && stepData.volume !== undefined) {
      ctx.session.stepData = { ...stepData, volume: undefined, comment: undefined };
      await promptCargoVolume(ctx);
      return;
    }

    if (stepData.volume === undefined && stepData.weight !== undefined) {
      ctx.session.stepData = { ...stepData, weight: undefined, volume: undefined, comment: undefined };
      await promptCargoWeight(ctx);
      return;
    }

    if (stepData.weight === undefined && stepData.cargoDescription) {
      ctx.session.stepData = { ...stepData, cargoDescription: undefined, weight: undefined, volume: undefined, comment: undefined };
      await promptCargoDescription(ctx);
      return;
    }

    ctx.session.stepData = { ...stepData, price: undefined, cargoDescription: undefined, weight: undefined, volume: undefined, comment: undefined };
    if (Number(stepData.suggestedPrice ?? 0) > 0) {
      await promptSuggestedPriceChoice(ctx, ctx.session.stepData);
      return;
    }

    await promptManualPrice(ctx);
    return;
  }

  ctx.session.stepData = { ...stepData, price: undefined, comment: undefined };
  if (Number(stepData.suggestedPrice ?? 0) > 0) {
    await promptSuggestedPriceChoice(ctx, ctx.session.stepData);
    return;
  }

  await promptManualPrice(ctx);
};

const goBackInCarrierFlow = async (ctx: any) => {
  const stepData = (ctx.session.stepData ?? {}) as Record<string, any>;
  const mode = (stepData.mode ?? "registration") as "registration" | "vehicle";

  switch (stepData.step) {
    case "fullName":
      await cancelActiveFlow(ctx);
      return;
    case "phone":
      ctx.session.stepData = { ...stepData, fullName: undefined, phone: undefined, step: "fullName" };
      await replyTransient(ctx, "Вернулись к ФИО. Введите имя перевозчика:", buildFlowCancelKeyboard());
      return;
    case "regionSelection":
      ctx.session.stepData = { ...stepData, phone: undefined, regionIds: [], step: "phone" };
      await promptCarrierPhone(ctx);
      return;
    case "vehicleType":
      if (mode === "vehicle") {
        resetSession(ctx);
        await showCarrierMenu(ctx);
        return;
      }
      ctx.session.stepData = { ...stepData, vehicleType: undefined, step: "regionSelection" };
      await showCarrierRegistrationRegionPicker(ctx, Array.isArray(stepData.regionIds) ? stepData.regionIds : []);
      return;
    case "brand":
      ctx.session.stepData = { ...stepData, vehicleType: undefined, step: "vehicleType" };
      await replyTransient(ctx, "Выберите тип транспорта:", buildVehicleTypeKeyboard("carrier-vehicle"));
      return;
    case "capacity":
      ctx.session.stepData = { ...stepData, brand: undefined, step: "brand" };
      await replyTransient(ctx, "Введите марку и модель транспорта:", buildFlowCancelKeyboard());
      return;
    case "plateNumber":
      ctx.session.stepData = { ...stepData, capacity: undefined, step: "capacity" };
      await replyTransient(ctx, "Введите вместимость / грузоподъемность:", buildFlowCancelKeyboard());
      return;
    case "description":
      ctx.session.stepData = { ...stepData, plateNumber: undefined, step: "plateNumber" };
      await replyTransient(ctx, "Введите госномер:", buildFlowCancelKeyboard());
      return;
    case "features":
      ctx.session.stepData = { ...stepData, description: undefined, step: "description" };
      await replyTransient(ctx, "Введите описание транспорта:", buildFlowCancelKeyboard());
      return;
    case "photos":
      ctx.session.stepData = { ...stepData, features: undefined, photos: [], step: "features" };
      await replyTransient(ctx, "Введите характеристики транспорта или «Нет»:", buildCommentKeyboard());
      return;
    default:
      await cancelActiveFlow(ctx);
  }
};

const goBackInActiveFlow = async (ctx: any) => {
  const state = ctx.session.state as BotState;

  if (
    [
      BotState.CUSTOMER_ORDER_REGION,
      BotState.CUSTOMER_ORDER_VEHICLE,
      BotState.CUSTOMER_ORDER_CATEGORY,
      BotState.CUSTOMER_ORDER_DETAILS,
      BotState.CUSTOMER_ORDER_CONFIRM,
    ].includes(state)
  ) {
    await goBackInCustomerOrderFlow(ctx);
    return;
  }

  if ([BotState.CARRIER_REGISTRATION, BotState.CARRIER_VEHICLE_REGISTRATION].includes(state)) {
    await goBackInCarrierFlow(ctx);
    return;
  }

  if (state === BotState.ORDER_ACTION) {
    const telegramId = getTelegramId(ctx);
    const user = await userRepository.findByTelegramId(telegramId);
    await goBackInOrderActionFlow(ctx, user);
    return;
  }

  if (state === BotState.CARRIER_MANAGEMENT) {
    resetSession(ctx);
    await showCarrierMenu(ctx);
    return;
  }

  if (state === BotState.ADMIN_PRICING_EDIT) {
    resetSession(ctx);
    await showAdminPanel(ctx);
    return;
  }

  await cancelActiveFlow(ctx);
};

const showCarrierCabinet = async (ctx: any, userId: number) => {
  const carrier = await carrierService.findCarrierByUserId(userId);
  if (!carrier) {
    await ctx.reply("Сначала завершите регистрацию перевозчика.");
    return;
  }

  const vehicles = await carrierService.listVehiclesByUserId(userId, true);
  const activeOrders = await orderRepository.listActiveByCarrierId(carrier.id);
  const historyOrders = await orderRepository.listHistoryByCarrierId(carrier.id);

  const text = [
    "Личный кабинет перевозчика",
    `ФИО: ${carrier.fullName ?? "не указано"}`,
    `Телефон: ${carrier.user.phone ?? "не указан"}`,
    `Статус: ${carrier.status}`,
    `Регионы: ${formatCarrierRegionNames(carrier)}`,
    `Транспорт: ${vehicles.length}`,
    `Активные заявки: ${activeOrders.length}`,
    `История: ${historyOrders.length}`,
  ].join("\n");

  await ctx.reply(text, buildCarrierCabinetKeyboard());
};

const sendCarrierOrderCard = async (ctx: any, order: any, options?: { replaceCurrent?: boolean; preferTracked?: boolean }) => {
  const replaceCurrent = options?.replaceCurrent === true;
  const preferTracked = options?.preferTracked === true;
  const trackedMessageId = getTrackedMessageId(ctx, CARRIER_ORDER_CARD_MESSAGES_KEY, order.id);
  const text = buildOrderCardText(order, "CARRIER");
  const actions = buildCarrierOrderActionMarkup(order);

  if (preferTracked && trackedMessageId) {
    try {
      await bot.telegram.editMessageText(ctx.chat.id, trackedMessageId, undefined, text, actions);
      trackMessageId(ctx, CARRIER_ORDER_CARD_MESSAGES_KEY, order.id, trackedMessageId);
      return trackedMessageId;
    } catch {
      await safeDeleteMessage(ctx, trackedMessageId);
      forgetTrackedMessageId(ctx, CARRIER_ORDER_CARD_MESSAGES_KEY, order.id);
    }
  }

  if (actions) {
    if (replaceCurrent) {
      const messageId = await replyReplacingCurrentMessage(ctx, text, actions);
      trackMessageId(ctx, CARRIER_ORDER_CARD_MESSAGES_KEY, order.id, messageId);
      return messageId;
    }

    const message = await ctx.reply(text, actions);
    trackMessageId(ctx, CARRIER_ORDER_CARD_MESSAGES_KEY, order.id, message.message_id);
    return message.message_id;
  }

  if (replaceCurrent) {
    const messageId = await replyReplacingCurrentMessage(ctx, text);
    trackMessageId(ctx, CARRIER_ORDER_CARD_MESSAGES_KEY, order.id, messageId);
    return messageId;
  }

  const message = await ctx.reply(text);
  trackMessageId(ctx, CARRIER_ORDER_CARD_MESSAGES_KEY, order.id, message.message_id);
  return message.message_id;
};

const sendCustomerOrderCard = async (ctx: any, order: any, options?: { replaceCurrent?: boolean; preferTracked?: boolean }) => {
  const replaceCurrent = options?.replaceCurrent === true;
  const preferTracked = options?.preferTracked === true;
  const trackedMessageId = getTrackedMessageId(ctx, CUSTOMER_ORDER_CARD_MESSAGES_KEY, order.id);
  const text = buildOrderCardText(order, "CUSTOMER");
  const actions = buildCustomerOrderActionMarkup(order);

  if (preferTracked && trackedMessageId) {
    try {
      await bot.telegram.editMessageText(ctx.chat.id, trackedMessageId, undefined, text, actions);
      trackMessageId(ctx, CUSTOMER_ORDER_CARD_MESSAGES_KEY, order.id, trackedMessageId);
      return trackedMessageId;
    } catch {
      await safeDeleteMessage(ctx, trackedMessageId);
      forgetTrackedMessageId(ctx, CUSTOMER_ORDER_CARD_MESSAGES_KEY, order.id);
    }
  }

  if (actions) {
    if (replaceCurrent) {
      const messageId = await replyReplacingCurrentMessage(ctx, text, actions);
      trackMessageId(ctx, CUSTOMER_ORDER_CARD_MESSAGES_KEY, order.id, messageId);
      return messageId;
    }

    const message = await ctx.reply(text, actions);
    trackMessageId(ctx, CUSTOMER_ORDER_CARD_MESSAGES_KEY, order.id, message.message_id);
    return message.message_id;
  }

  if (replaceCurrent) {
    const messageId = await replyReplacingCurrentMessage(ctx, text);
    trackMessageId(ctx, CUSTOMER_ORDER_CARD_MESSAGES_KEY, order.id, messageId);
    return messageId;
  }

  const message = await ctx.reply(text);
  trackMessageId(ctx, CUSTOMER_ORDER_CARD_MESSAGES_KEY, order.id, message.message_id);
  return message.message_id;
};

const showOrderTimeline = async (ctx: any, order: any) => {
  const events = await orderEventRepository.listByOrderId(order.id, 12);
  await replyTransient(ctx, buildOrderTimelineText(order, events));
};

const startCarrierDispatchFlow = async (ctx: any, userId: number, orderId: number) => {
  const vehicles = await carrierService.listVehiclesByUserId(userId);
  if (vehicles.length === 0) {
    await replyTransient(ctx, "Сначала добавьте хотя бы одну активную машину в разделе транспорта.");
    return;
  }

  ctx.session.state = BotState.ORDER_ACTION;
  ctx.session.stepData = { action: "carrierDispatchVehicle", orderId };
  await replyTransient(
    ctx,
    "Выберите машину для этого заказа. Можно доверить подбор автоматически или выбрать конкретный транспорт.",
    buildCarrierDispatchVehicleKeyboard(orderId, vehicles)
  );
};

const buildRepeatOrderStepData = (order: any) => ({
  regionId: order.regionId,
  regionName: order.region?.name ?? undefined,
  vehicleType: order.vehicleType,
  vehicleLabel: toVehicleLabel(order.vehicleType),
  categoryId: order.categoryId,
  categoryName: order.category?.name ?? undefined,
  routeFrom: order.routeFrom,
  routeFromLat: order.routeFromLat ?? undefined,
  routeFromLng: order.routeFromLng ?? undefined,
  routeTo: order.routeTo,
  routeToLat: order.routeToLat ?? undefined,
  routeToLng: order.routeToLng ?? undefined,
  comment: order.comment ?? undefined,
  adultsCount: order.adultsCount ?? undefined,
  childrenCount: order.childrenCount ?? undefined,
  passengersCount: undefined,
  cargoDescription: order.cargoDescription ?? undefined,
  weight: order.weight ?? undefined,
  volume: order.volume ?? undefined,
  date: undefined,
  price: undefined,
  suggestedPrice: undefined,
  estimatedDistanceKm: undefined,
  estimatedDurationHours: undefined,
});

const beginRepeatOrderFlow = async (ctx: any, order: any) => {
  await clearFlowMessages(ctx);

  ctx.session.state = BotState.CUSTOMER_ORDER_DETAILS;
  ctx.session.stepData = buildRepeatOrderStepData(order);
  ctx.session.stepData = await syncOrderDraftMessage(ctx, ctx.session.stepData);

  await replyTransient(
    ctx,
    appendPromptLead(`Маршрут из заявки #${order.id} уже подставил. Осталось выбрать новую дату и время.`, buildDepartureDatePromptText()),
    buildDatePickerKeyboard()
  );
};

const completeCarrierDispatchFlow = async (
  ctx: any,
  payload: {
    orderId: number;
    carrierId: number;
    vehicleId?: number;
    driverName: string;
    driverPhone: string;
  }
) => {
  const updatedOrder = await orderService.assignCarrierDispatch(bot, payload.orderId, payload.carrierId, {
    vehicleId: payload.vehicleId,
    driverName: payload.driverName,
    driverPhone: payload.driverPhone,
  });

  resetSession(ctx);
  await ctx.reply("Экипаж назначен. Карточка заказа обновлена.", buildCarrierMenu(isAdminTelegramId(getTelegramId(ctx))));
  await sendCarrierOrderCard(ctx, updatedOrder, { preferTracked: true });
};

const buildCustomerOfferText = (offer: any) => {
  const primaryVehicle = Array.isArray(offer.carrier?.vehicles) ? offer.carrier.vehicles.find((vehicle: any) => vehicle.isActive) ?? offer.carrier.vehicles[0] : null;

  return [
    `Отклик #${offer.id} по заявке #${offer.orderId}`,
    `Перевозчик: ${offer.carrier?.fullName ?? "не указан"}`,
    `Цена: ${offer.proposedPrice} ₽`,
    offer.pickupEtaText ? `Подача: ${offer.pickupEtaText}` : null,
    offer.note ? `Комментарий: ${offer.note}` : null,
    primaryVehicle ? formatVehicleSummary(primaryVehicle) : null,
  ]
    .filter(Boolean)
    .join("\n");
};

const sendCustomerOfferCards = async (ctx: any, order: any) => {
  const offers = Array.isArray(order.offers)
    ? order.offers.filter((offer: any) => ["ACTIVE", "COUNTERED"].includes(String(offer.status ?? ""))).slice(0, 5)
    : [];

  const messageMap: Record<string, number> = {};
  for (const offer of offers) {
    const message = await ctx.reply(buildCustomerOfferText(offer), {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Принять цену", callback_data: `offer_customer:accept:${offer.id}` }],
          [{ text: "Торговаться", callback_data: `offer_customer:counter:${offer.id}` }],
          [{ text: "Отклонить", callback_data: `offer_customer:reject:${offer.id}` }],
        ],
      },
    });

    messageMap[String(offer.id)] = message.message_id;
  }

  setTrackedMessageMap(ctx, CUSTOMER_OFFER_CARD_MESSAGES_KEY, messageMap);
};

const sendAdminDepositOrderCard = async (ctx: any, order: any) => {
  const actions = buildAdminDepositActionMarkup(order);
  if (actions) {
    await ctx.reply(buildOrderCardText(order, "ADMIN"), actions);
    return;
  }

  await ctx.reply(buildOrderCardText(order, "ADMIN"));
};

const showAdminPanel = async (ctx: any) => {
  if (!isAdminTelegramId(getTelegramId(ctx))) {
    await ctx.reply("У вас нет доступа к админ-панели.");
    return;
  }

  await ctx.reply("Админ-панель", buildAdminOpsKeyboard());
};

const showPricingRules = async (ctx: any, edit = false) => {
  const rules = await pricingService.ensureDefaults();
  const text = [
    "Тарифы:",
    ...rules.map(
      (rule) =>
        `${toVehicleLabel(rule.vehicleType)}\nБаза: ${rule.basePrice} ₽ | Км: ${rule.pricePerKm} ₽ | Час: ${rule.pricePerHour} ₽ | Минимум: ${rule.minPrice} ₽`
    ),
  ].join("\n\n");

  const keyboard = {
    inline_keyboard: rules.map((rule) => [{ text: toVehicleLabel(rule.vehicleType), callback_data: `admin-rate:${rule.vehicleType}` }]),
  };

  if (edit) {
    await ctx.editMessageText(text, { reply_markup: keyboard });
    return;
  }

  await ctx.reply(text, { reply_markup: keyboard });
};

const showPricingRuleDetails = async (ctx: any, vehicleType: string, edit = true) => {
  const rule = await pricingService.getRule(vehicleType);
  if (!rule) {
    await ctx.reply("Тариф не найден.");
    return;
  }

  const text = [
    `Тариф: ${toVehicleLabel(vehicleType)}`,
    `База: ${rule.basePrice} ₽`,
    `За км: ${rule.pricePerKm} ₽`,
    `За час: ${rule.pricePerHour} ₽`,
    `Минимум: ${rule.minPrice} ₽`,
  ].join("\n");

  const reply_markup = {
    inline_keyboard: [
      [{ text: "База", callback_data: `admin-rate-field:${vehicleType}:basePrice` }],
      [{ text: "Километр", callback_data: `admin-rate-field:${vehicleType}:pricePerKm` }],
      [{ text: "Час", callback_data: `admin-rate-field:${vehicleType}:pricePerHour` }],
      [{ text: "Минимум", callback_data: `admin-rate-field:${vehicleType}:minPrice` }],
      [{ text: "Назад к тарифам", callback_data: "admin:pricing" }],
    ],
  };

  if (edit) {
    await ctx.editMessageText(text, { reply_markup });
    return;
  }

  await ctx.reply(text, { reply_markup });
};

const showPendingCarriers = async (ctx: any, edit = false) => {
  const carriers = await carrierService.listPendingApproval();
  const header = carriers.length === 0 ? "Нет перевозчиков на модерации." : `На модерации: ${carriers.length}`;

  if (edit) {
    await ctx.editMessageText(header, buildAdminOpsKeyboard());
  } else {
    await ctx.reply(header);
  }

  for (const carrier of carriers) {
    const firstVehicle = carrier.vehicles[0];
    const text = [
      `Перевозчик #${carrier.id}`,
      `ФИО: ${carrier.fullName ?? "не указано"}`,
      `Телефон: ${carrier.user.phone ?? "не указан"}`,
      `Регионы: ${formatCarrierRegionNames(carrier)}`,
      `Статус: ${carrier.status}`,
      `Транспорта: ${carrier.vehicles.length}`,
      firstVehicle ? formatVehicleSummary(firstVehicle) : "Транспорт пока не добавлен",
    ].join("\n");

    const keyboard = {
      inline_keyboard: [
        [
          { text: "Одобрить", callback_data: `admin-carrier:approve:${carrier.id}` },
          { text: "Отклонить", callback_data: `admin-carrier:reject:${carrier.id}` },
        ],
      ],
    };

    const photos = firstVehicle ? parsePhotoIds(firstVehicle.photos) : [];
    if (photos.length > 0) {
      await ctx.replyWithPhoto(photos[0], { caption: text, reply_markup: keyboard });
    } else {
      await ctx.reply(text, { reply_markup: keyboard });
    }
  }
};

const showPendingDeposits = async (ctx: any, edit = false) => {
  const orders = await orderRepository.listDepositPendingVerification(12);
  const header = orders.length === 0 ? "Нет платежек на проверке." : `Платежек на проверке: ${orders.length}`;

  if (edit) {
    await ctx.editMessageText(header, buildAdminOpsKeyboard());
  } else {
    await ctx.reply(header);
  }

  for (const order of orders) {
    await sendAdminDepositOrderCard(ctx, order);
  }
};

const finalizeCarrierFlow = async (ctx: any, mode: "registration" | "vehicle") => {
  const stepData = ctx.session.stepData as any;
  const photos = stepData.photos ?? [];
  const telegramId = getTelegramId(ctx);

  if (mode === "registration") {
    const payload: CarrierRegistrationDto = {
      fullName: stepData.fullName,
      phone: stepData.phone,
      regionIds: stepData.regionIds,
      vehicleType: stepData.vehicleType,
      brand: stepData.brand,
      capacity: stepData.capacity,
      plateNumber: stepData.plateNumber,
      description: stepData.description,
      features: stepData.features,
      photos,
    };

    await carrierService.registerCarrier(stepData.userId, payload);
    resetSession(ctx);
    await ctx.reply("Профиль перевозчика сохранен. Первая машина добавлена, ожидайте модерации.", buildCarrierMenu(isAdminTelegramId(telegramId)));
    await ctx.reply("Если хотите, можно сразу добавить еще транспорт.", buildAddMoreVehiclesKeyboard());
    return;
  }

  const payload: VehicleDto = {
    vehicleType: stepData.vehicleType,
    brand: stepData.brand,
    capacity: stepData.capacity,
    plateNumber: stepData.plateNumber,
    description: stepData.description,
    features: stepData.features,
    photos,
  };

  await carrierService.addVehicle(stepData.userId, payload);
  resetSession(ctx);
  await ctx.reply("Транспорт добавлен в профиль перевозчика.", buildCarrierMenu(isAdminTelegramId(telegramId)));
  await ctx.reply("Добавить еще транспорт?", buildAddMoreVehiclesKeyboard());
};

bot.command("cancel", async (ctx) => {
  await cancelActiveFlow(ctx);
});

bot.command("back", async (ctx) => {
  await goBackInActiveFlow(ctx);
});

bot.command("menu", async (ctx) => {
  await showMenuForCurrentUser(ctx);
});

bot.command("help", async (ctx) => {
  await showHelp(ctx);
});

bot.command("orders", async (ctx) => {
  await showOrdersForCurrentUser(ctx);
});

bot.command("history", async (ctx) => {
  await showHistoryForCurrentUser(ctx);
});

bot.command("open", async (ctx) => {
  await showOpenOrdersForCurrentCarrier(ctx);
});

bot.command("market", async (ctx) => {
  await showOpenOrdersForCurrentCarrier(ctx);
});

bot.hears(BACK_TEXT, async (ctx) => {
  await goBackInActiveFlow(ctx);
});

bot.hears(CANCEL_TEXT, async (ctx) => {
  await cancelActiveFlow(ctx);
});

bot.start(async (ctx) => {
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);
  if (!user) {
    resetSession(ctx);
    await ctx.reply("Выберите роль в системе:", buildRoleKeyboard());
    return;
  }

  if (user.role === "CUSTOMER") {
    const customer = await customerRepository.findByUserId(user.id);
    if (!customer) {
      ctx.session.state = BotState.CUSTOMER_REGISTRATION;
      await ctx.reply("Добро пожаловать! Пришлите ваше имя для регистрации заказчика.");
      return;
    }
    resetSession(ctx);
    await showCustomerMenu(ctx);
    return;
  }

  if (user.role === "CARRIER") {
    resetSession(ctx);
    const carrier = await carrierService.findCarrierByUserId(user.id);
    if (!carrier) {
      await ctx.reply("Профиль перевозчика еще не заполнен. Нажмите «Регистрация».", buildCarrierMenu(isAdminTelegramId(telegramId)));
      return;
    }
    await showCarrierMenu(ctx);
    return;
  }

  resetSession(ctx);
  await ctx.reply("Выберите роль в системе:", buildRoleKeyboard());
});

bot.command("admin", async (ctx) => {
  await showAdminPanel(ctx);
});

bot.hears(ADMIN_PANEL_TEXT, async (ctx) => {
  await showAdminPanel(ctx);
});

bot.action("admin:pricing", async (ctx) => {
  if (!isAdminTelegramId(getTelegramId(ctx))) {
    await ctx.answerCbQuery("Нет доступа");
    return;
  }
  await ctx.answerCbQuery();
  await showPricingRules(ctx, true);
});

bot.action("admin:pending-carriers", async (ctx) => {
  if (!isAdminTelegramId(getTelegramId(ctx))) {
    await ctx.answerCbQuery("Нет доступа");
    return;
  }
  await ctx.answerCbQuery();
  await showPendingCarriers(ctx, true);
});

bot.action("admin:deposits", async (ctx) => {
  if (!isAdminTelegramId(getTelegramId(ctx))) {
    await ctx.answerCbQuery("Нет доступа");
    return;
  }
  await ctx.answerCbQuery();
  await showPendingDeposits(ctx, true);
});

bot.action(/^admin-rate:([A-Z_]+)$/, async (ctx) => {
  if (!isAdminTelegramId(getTelegramId(ctx))) {
    await ctx.answerCbQuery("Нет доступа");
    return;
  }
  await ctx.answerCbQuery();
  await showPricingRuleDetails(ctx, ctx.match[1], true);
});

bot.action(/^admin-rate-field:([A-Z_]+):(basePrice|pricePerKm|pricePerHour|minPrice)$/, async (ctx) => {
  if (!isAdminTelegramId(getTelegramId(ctx))) {
    await ctx.answerCbQuery("Нет доступа");
    return;
  }

  ctx.session.state = BotState.ADMIN_PRICING_EDIT;
  ctx.session.stepData = { vehicleType: ctx.match[1], field: ctx.match[2] };
  await ctx.answerCbQuery();
  await replyTransient(ctx, `Введите новое значение для ${toVehicleLabel(ctx.match[1])} / ${ctx.match[2]}.`, buildFlowCancelKeyboard());
});

bot.action(/^admin-carrier:(approve|reject):(\d+)$/, async (ctx) => {
  if (!isAdminTelegramId(getTelegramId(ctx))) {
    await ctx.answerCbQuery("Нет доступа");
    return;
  }

  const action = ctx.match[1];
  const carrierId = Number(ctx.match[2]);
  const carrier = action === "approve" ? await carrierService.approveCarrier(carrierId) : await carrierService.rejectCarrier(carrierId);

  await ctx.answerCbQuery(action === "approve" ? "Перевозчик одобрен" : "Перевозчик отклонен");
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

  if (carrier?.user?.telegramId) {
    const message =
      action === "approve"
        ? "Ваш профиль перевозчика одобрен. Теперь вы будете получать подходящие заявки."
        : "Ваш профиль перевозчика отклонен. Обратитесь в поддержку для уточнения деталей.";
    await bot.telegram.sendMessage(carrier.user.telegramId.toString(), message);
  }
});

bot.action(/^admin-deposit:(verify|reject):(\d+)$/, async (ctx) => {
  if (!isAdminTelegramId(getTelegramId(ctx))) {
    await ctx.answerCbQuery("Нет доступа");
    return;
  }

  const action = ctx.match[1];
  const orderId = Number(ctx.match[2]);

  try {
    if (action === "verify") {
      await orderService.approveDeposit(bot, orderId, "Admin bot");
      await ctx.answerCbQuery("Депозит подтвержден");
    } else {
      await orderService.rejectDeposit(bot, orderId, "Admin bot");
      await ctx.answerCbQuery("Платежка отклонена");
    }

    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  } catch (error) {
    await ctx.answerCbQuery((error as Error).message);
  }
});

bot.action(/^role:(CUSTOMER|CARRIER)$/, async (ctx) => {
  const role = ctx.match[1] as "CUSTOMER" | "CARRIER";
  const telegramId = getTelegramId(ctx);
  let user = await userRepository.findByTelegramId(telegramId);
  if (!user) {
    user = role === "CUSTOMER" ? await userService.findOrCreateCustomer(telegramId, null) : await userService.findOrCreateCarrier(telegramId, null);
  } else if (user.role !== role) {
    user = await userRepository.updateRole(user.id, role);
  }

  await ctx.answerCbQuery();

  if (role === "CUSTOMER") {
    ctx.session.state = BotState.CUSTOMER_REGISTRATION;
    await ctx.reply("Отлично! Пришлите ваше имя для регистрации заказчика.");
    return;
  }

  const carrier = await carrierService.findCarrierByUserId(user.id);
  if (carrier) {
    resetSession(ctx);
    await ctx.reply("Профиль перевозчика уже создан. Используйте «Мой транспорт», чтобы добавить еще машины.", buildCarrierMenu(isAdminTelegramId(telegramId)));
    return;
  }

  ctx.session.state = BotState.CARRIER_REGISTRATION;
  ctx.session.stepData = { userId: user.id, mode: "registration", step: "fullName", photos: [] };
  await replyTransient(ctx, "Пришлите ФИО перевозчика.", buildFlowCancelKeyboard());
});

bot.hears("Создать заявку", async (ctx) => {
  await beginCustomerOrderFlow(ctx);
});

bot.hears("Мои заявки", async (ctx) => {
  await showOrdersForCurrentUser(ctx);
});

bot.hears(OPEN_ORDERS_TEXT, async (ctx) => {
  await showOpenOrdersForCurrentCarrier(ctx);
});

bot.hears("История", async (ctx) => {
  await showHistoryForCurrentUser(ctx);
});

bot.hears("Поддержка", async (ctx) => {
  await showHelp(ctx);
});

bot.hears("Регистрация", async (ctx) => {
  const telegramId = getTelegramId(ctx);
  let user = await userService.findOrCreateCarrier(telegramId, null);
  if (user.role !== "CARRIER") {
    user = await userRepository.updateRole(user.id, "CARRIER");
  }
  const carrier = await carrierService.findCarrierByUserId(user.id);
  if (carrier) {
    await ctx.reply("Профиль перевозчика уже создан. Используйте «Мой транспорт», чтобы добавить еще машины.", buildCarrierMenu(isAdminTelegramId(telegramId)));
    return;
  }

  ctx.session.state = BotState.CARRIER_REGISTRATION;
  ctx.session.stepData = { userId: user.id, mode: "registration", step: "fullName", photos: [] };
  await replyTransient(ctx, "Введите ФИО перевозчика:", buildFlowCancelKeyboard());
});

bot.hears(CARRIER_CABINET_TEXT, async (ctx) => {
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);
  if (!user) {
    await ctx.reply("Сначала выполните /start.");
    return;
  }

  await showCarrierCabinet(ctx, user.id);
});

bot.hears(CARRIER_REGION_TEXT, async (ctx) => {
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);
  if (!user) {
    await ctx.reply("Сначала выполните /start.");
    return;
  }

  const carrier = await carrierService.findCarrierByUserId(user.id);
  if (!carrier) {
    await ctx.reply("Сначала завершите регистрацию перевозчика.");
    return;
  }

  const regions = await regionRepository.listAll();
  const selectedRegionIds = getCarrierRegionIds(carrier);
  ctx.session.state = BotState.CARRIER_MANAGEMENT;
  ctx.session.stepData = { mode: "regionsUpdate", regionIds: selectedRegionIds };
  await ctx.reply(
    `Текущие регионы: ${formatCarrierRegionNames(carrier)}. Выберите один или несколько регионов работы:`,
    buildCarrierRegionPicker("carrier-region-update-toggle", regions, selectedRegionIds, "carrier-region-update-confirm")
  );
});

bot.hears(CARRIER_TRANSPORT_TEXT, async (ctx) => {
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);
  if (!user) {
    await ctx.reply("Сначала выполните /start.");
    return;
  }

  const carrier = await carrierService.findCarrierByUserId(user.id);
  if (!carrier) {
    await ctx.reply("Сначала завершите регистрацию перевозчика.");
    return;
  }

  const vehicles = await carrierService.listVehiclesByUserId(user.id, true);
  if (vehicles.length === 0) {
    await ctx.reply("В профиле пока нет транспорта. Используйте «Добавить транспорт».");
    return;
  }

  for (const [index, vehicle] of vehicles.entries()) {
    const text = `Транспорт #${index + 1}${vehicle.isActive ? "" : " [скрыт]"}\n${formatVehicleSummary(vehicle)}`;
    const photos = parsePhotoIds(vehicle.photos);
    if (photos.length > 0) {
      await ctx.replyWithPhoto(photos[0], { caption: text });
    } else {
      await ctx.reply(text);
    }
  }

  await ctx.reply("Чтобы добавить еще транспорт, нажмите «Добавить транспорт».", buildCarrierMenu(isAdminTelegramId(telegramId)));
});

bot.hears(EDIT_TRANSPORT_TEXT, async (ctx) => {
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);
  if (!user) {
    await ctx.reply("Сначала выполните /start.");
    return;
  }

  const carrier = await carrierService.findCarrierByUserId(user.id);
  if (!carrier) {
    await ctx.reply("Сначала завершите регистрацию перевозчика.");
    return;
  }

  const vehicles = await carrierService.listVehiclesByUserId(user.id, true);
  if (vehicles.length === 0) {
    await ctx.reply("У вас пока нет транспорта для редактирования.");
    return;
  }

  for (const [index, vehicle] of vehicles.entries()) {
    const text = `Управление транспортом #${index + 1}${vehicle.isActive ? "" : " [скрыт]"}\n${formatVehicleSummary(vehicle)}`;
    const photos = parsePhotoIds(vehicle.photos);
    if (photos.length > 0) {
      await ctx.replyWithPhoto(photos[0], { caption: text, ...buildVehicleManageKeyboard(vehicle) });
    } else {
      await ctx.reply(text, buildVehicleManageKeyboard(vehicle));
    }
  }
});

bot.hears(ADD_TRANSPORT_TEXT, async (ctx) => {
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);
  if (!user) {
    await ctx.reply("Сначала выполните /start.");
    return;
  }

  const carrier = await carrierService.findCarrierByUserId(user.id);
  if (!carrier) {
    await ctx.reply("Сначала завершите регистрацию перевозчика.");
    return;
  }

  ctx.session.state = BotState.CARRIER_VEHICLE_REGISTRATION;
  ctx.session.stepData = { userId: user.id, mode: "vehicle", step: "vehicleType", photos: [] };
  await replyTransient(ctx, "Выберите тип транспорта:", buildVehicleTypeKeyboard("carrier-vehicle"));
});

bot.action(/^region:(\d+)$/, async (ctx) => {
  const regionId = Number(ctx.match[1]);
  const regions = await regionRepository.listAll();
  const region = regions.find((item) => item.id === regionId);
  ctx.session.stepData = await syncOrderDraftMessage(ctx, { ...ctx.session.stepData, regionId, regionName: region?.name });
  ctx.session.state = BotState.CUSTOMER_ORDER_VEHICLE;
  await ctx.answerCbQuery();
  await ctx.editMessageText("Выбран регион. Выберите тип транспорта:", buildVehicleTypeKeyboard("vehicle"));
});

bot.action(/^vehicle:(.+)$/, async (ctx) => {
  const vehicleType = ctx.match[1];
  ctx.session.stepData = await syncOrderDraftMessage(ctx, {
    ...ctx.session.stepData,
    vehicleType,
    vehicleLabel: toVehicleLabel(vehicleType),
  });
  ctx.session.state = BotState.CUSTOMER_ORDER_CATEGORY;
  await ctx.answerCbQuery();
  const categories = await categoryRepository.listAll();
  const buttons = categories.map((category) => [{ text: category.name, callback_data: `category:${category.id}` }]);
  await ctx.editMessageText("Выберите категорию перевозки:", { reply_markup: { inline_keyboard: buttons } });
});

bot.action(/^category:(\d+)$/, async (ctx) => {
  const categoryId = Number(ctx.match[1]);
  const categories = await categoryRepository.listAll();
  const category = categories.find((item) => item.id === categoryId);
  ctx.session.stepData = await syncOrderDraftMessage(ctx, { ...ctx.session.stepData, categoryId, categoryName: category?.name });
  ctx.session.state = BotState.CUSTOMER_ORDER_DETAILS;
  await ctx.answerCbQuery();
  await ctx.editMessageText("Категория выбрана. Переходим к маршруту.");
  await promptRouteFrom(ctx);
});

bot.action(DATE_PICKER_IGNORE, async (ctx) => {
  await ctx.answerCbQuery();
});

bot.action(ORDER_FLOW_BACK, async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  await goBackInActiveFlow(ctx);
});

bot.action(DATE_PICKER_MANUAL, async (ctx) => {
  if (ctx.session.state !== BotState.CUSTOMER_ORDER_DETAILS) {
    await ctx.answerCbQuery("Сейчас это недоступно.");
    return;
  }

  const stepData = (ctx.session.stepData ?? {}) as Record<string, unknown>;
  if (stepData.date !== undefined) {
    await ctx.answerCbQuery("Дата уже выбрана.");
    return;
  }

  await ctx.answerCbQuery();
  await replyTransient(ctx, "Введите дату вручную. Подойдут форматы: 2026-05-14 15:30, 14.05.2026 15:30 или просто 14.05.2026.", buildFlowCancelKeyboard());
});

bot.action(/^order-date:month:(\d{4}):(\d{1,2})$/, async (ctx) => {
  if (ctx.session.state !== BotState.CUSTOMER_ORDER_DETAILS) {
    await ctx.answerCbQuery("Сначала создайте новую заявку.");
    return;
  }

  const stepData = (ctx.session.stepData ?? {}) as Record<string, unknown>;
  if (stepData.date !== undefined) {
    await ctx.answerCbQuery("Дата уже выбрана.");
    return;
  }

  const year = Number(ctx.match[1]);
  const month = Number(ctx.match[2]);
  await ctx.answerCbQuery();
  await showDepartureDatePicker(ctx, new Date(year, month - 1, 1), true);
});

bot.action(/^order-date:day:(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
  if (ctx.session.state !== BotState.CUSTOMER_ORDER_DETAILS) {
    await ctx.answerCbQuery("Сначала создайте новую заявку.");
    return;
  }

  const stepData = (ctx.session.stepData ?? {}) as Record<string, unknown>;
  if (stepData.date !== undefined) {
    await ctx.answerCbQuery("Дата уже выбрана.");
    return;
  }

  await ctx.answerCbQuery();
  await showDepartureHourPicker(ctx, ctx.match[1], true);
});

bot.action(/^order-time:back:(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
  if (ctx.session.state !== BotState.CUSTOMER_ORDER_DETAILS) {
    await ctx.answerCbQuery("Сначала создайте новую заявку.");
    return;
  }

  const stepData = (ctx.session.stepData ?? {}) as Record<string, unknown>;
  if (stepData.date !== undefined) {
    await ctx.answerCbQuery("Дата уже выбрана.");
    return;
  }

  await ctx.answerCbQuery();
  await showDepartureHourPicker(ctx, ctx.match[1], true);
});

bot.action(/^order-time:hour:(\d{4}-\d{2}-\d{2}):(\d{2})$/, async (ctx) => {
  if (ctx.session.state !== BotState.CUSTOMER_ORDER_DETAILS) {
    await ctx.answerCbQuery("Сначала создайте новую заявку.");
    return;
  }

  const stepData = (ctx.session.stepData ?? {}) as Record<string, unknown>;
  if (stepData.date !== undefined) {
    await ctx.answerCbQuery("Дата уже выбрана.");
    return;
  }

  await ctx.answerCbQuery();
  await showDepartureMinutePicker(ctx, ctx.match[1], Number(ctx.match[2]), true);
});

bot.action(/^order-time:minute:(\d{4}-\d{2}-\d{2}):(\d{2}):(\d{2})$/, async (ctx) => {
  if (ctx.session.state !== BotState.CUSTOMER_ORDER_DETAILS) {
    await ctx.answerCbQuery("Сначала создайте новую заявку.");
    return;
  }

  const stepData = (ctx.session.stepData ?? {}) as Record<string, unknown>;
  const selectedDate = buildDateFromKey(ctx.match[1], Number(ctx.match[2]), Number(ctx.match[3]));

  if (!selectedDate) {
    await ctx.answerCbQuery("Не удалось распознать дату.");
    return;
  }

  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  await completeOrderDateSelection(ctx, stepData, selectedDate);
});

bot.action(PRICE_ENTER_MANUAL, async (ctx) => {
  if (ctx.session.state !== BotState.CUSTOMER_ORDER_DETAILS) {
    await ctx.answerCbQuery("Сначала создайте новую заявку.");
    return;
  }

  const stepData = (ctx.session.stepData ?? {}) as Record<string, unknown>;
  if (stepData.price !== undefined) {
    await ctx.answerCbQuery("Цена уже выбрана.");
    return;
  }

  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  await promptManualPrice(ctx);
});

bot.action(PRICE_USE_SUGGESTED, async (ctx) => {
  if (ctx.session.state !== BotState.CUSTOMER_ORDER_DETAILS) {
    await ctx.answerCbQuery("Сначала создайте новую заявку.");
    return;
  }

  const stepData = (ctx.session.stepData ?? {}) as Record<string, unknown>;
  if (stepData.price !== undefined) {
    await ctx.answerCbQuery("Цена уже выбрана.");
    return;
  }

  const suggestedPrice = Number(stepData.suggestedPrice ?? 0);
  if (suggestedPrice <= 0) {
    await ctx.answerCbQuery("Рекомендованная цена недоступна.");
    return;
  }

  await ctx.answerCbQuery("Рекомендованная цена выбрана");
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  await continueCustomerOrderAfterPrice(ctx, { ...stepData, price: suggestedPrice });
});

bot.action(/^carrier-region-toggle:(\d+)$/, async (ctx) => {
  const regionId = Number(ctx.match[1]);
  const stepData = (ctx.session.stepData ?? {}) as any;
  const currentIds = Array.isArray(stepData.regionIds) ? stepData.regionIds : [];
  const selectedIds = currentIds.includes(regionId) ? currentIds.filter((item: number) => item !== regionId) : [...currentIds, regionId];
  ctx.session.stepData = { ...stepData, regionIds: selectedIds, step: "regionSelection" };
  await ctx.answerCbQuery();
  const regions = await regionRepository.listAll();
  await ctx.editMessageReplyMarkup(buildCarrierRegionPicker("carrier-region-toggle", regions, selectedIds, "carrier-region-confirm").reply_markup);
});

bot.action(/^carrier-region-confirm$/, async (ctx) => {
  const stepData = (ctx.session.stepData ?? {}) as any;
  let regionIds: number[];

  try {
    regionIds = validateCarrierRegionIds(Array.isArray(stepData.regionIds) ? stepData.regionIds : []);
  } catch (error) {
    await ctx.answerCbQuery((error as Error).message);
    return;
  }

  ctx.session.stepData = { ...stepData, regionIds, step: "vehicleType" };
  await ctx.answerCbQuery("Регионы сохранены");
  await ctx.editMessageText("Теперь выберите тип первого транспорта:", buildVehicleTypeKeyboard("carrier-vehicle"));
});

bot.action(/^carrier-region-update-toggle:(\d+)$/, async (ctx) => {
  const regionId = Number(ctx.match[1]);
  const stepData = (ctx.session.stepData ?? {}) as any;
  const currentIds = Array.isArray(stepData.regionIds) ? stepData.regionIds : [];
  const selectedIds = currentIds.includes(regionId) ? currentIds.filter((item: number) => item !== regionId) : [...currentIds, regionId];
  ctx.session.stepData = { ...stepData, regionIds: selectedIds, mode: "regionsUpdate" };
  await ctx.answerCbQuery();
  const regions = await regionRepository.listAll();
  await ctx.editMessageReplyMarkup(buildCarrierRegionPicker("carrier-region-update-toggle", regions, selectedIds, "carrier-region-update-confirm").reply_markup);
});

bot.action(/^carrier-region-update-confirm$/, async (ctx) => {
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);
  if (!user) {
    await ctx.answerCbQuery("Сначала выполните /start.");
    return;
  }

  const stepData = (ctx.session.stepData ?? {}) as any;
  let regionIds: number[];

  try {
    regionIds = validateCarrierRegionIds(Array.isArray(stepData.regionIds) ? stepData.regionIds : []);
  } catch (error) {
    await ctx.answerCbQuery((error as Error).message);
    return;
  }

  try {
    const carrier = await carrierService.updateRegionsByUserId(user.id, regionIds);
    resetSession(ctx);
    await ctx.answerCbQuery("Регионы обновлены");
    await ctx.editMessageText(`Рабочие регионы обновлены: ${formatCarrierRegionNames(carrier)}.`);
    await showCarrierCabinet(ctx, user.id);
  } catch (error) {
    await ctx.answerCbQuery((error as Error).message);
  }
});

bot.action(/^carrier-vehicle:(.+)$/, async (ctx) => {
  const vehicleType = ctx.match[1];
  ctx.session.stepData = {
    ...ctx.session.stepData,
    vehicleType,
    step: "brand",
  };
  await ctx.answerCbQuery();
  await ctx.editMessageText(`Тип транспорта выбран: ${toVehicleLabel(vehicleType)}.`);
  await replyTransient(ctx, "Введите марку транспорта:", buildFlowCancelKeyboard());
});

bot.action(/^carrier-more-vehicles$/, async (ctx) => {
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);
  if (!user) {
    await ctx.answerCbQuery("Сначала выполните /start.");
    return;
  }

  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  await beginCarrierVehicleWizard(ctx, user.id);
});

bot.action(/^carrier-finish-setup$/, async (ctx) => {
  await ctx.answerCbQuery("Готово");
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  await showCarrierMenu(ctx);
});

bot.action(/^carrier-cabinet:(edit-profile|regions|vehicles)$/, async (ctx) => {
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);
  if (!user) {
    await ctx.answerCbQuery("Сначала выполните /start.");
    return;
  }

  await ctx.answerCbQuery();

  if (ctx.match[1] === "regions") {
    const carrier = await carrierService.findCarrierByUserId(user.id);
    if (!carrier) {
      await ctx.reply("Сначала завершите регистрацию перевозчика.");
      return;
    }

    const regions = await regionRepository.listAll();
    const selectedRegionIds = getCarrierRegionIds(carrier);
    ctx.session.state = BotState.CARRIER_MANAGEMENT;
    ctx.session.stepData = { mode: "regionsUpdate", regionIds: selectedRegionIds };
    await replyTransient(
      ctx,
      `Текущие регионы: ${formatCarrierRegionNames(carrier)}. Выберите один или несколько регионов работы:`,
      buildCarrierRegionPicker("carrier-region-update-toggle", regions, selectedRegionIds, "carrier-region-update-confirm")
    );
    return;
  }

  if (ctx.match[1] === "vehicles") {
    const vehicles = await carrierService.listVehiclesByUserId(user.id, true);
    if (vehicles.length === 0) {
      await ctx.reply("У вас пока нет транспорта для редактирования.");
      return;
    }

    for (const vehicle of vehicles) {
      await ctx.reply(formatVehicleSummary(vehicle), buildVehicleManageKeyboard(vehicle));
    }
    return;
  }

  ctx.session.state = BotState.CARRIER_MANAGEMENT;
  ctx.session.stepData = { mode: "profileEdit", step: "chooseField" };
  await replyTransient(ctx, "Что хотите изменить в профиле?", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "ФИО", callback_data: "carrier-profile-edit:fullName" }],
        [{ text: "Телефон", callback_data: "carrier-profile-edit:phone" }],
      ],
    },
  });
});

bot.action(/^carrier-profile-edit:(fullName|phone)$/, async (ctx) => {
  ctx.session.state = BotState.CARRIER_MANAGEMENT;
  ctx.session.stepData = { mode: "profileFieldEdit", field: ctx.match[1] };
  await ctx.answerCbQuery();
  if (ctx.match[1] === "phone") {
    await promptCarrierPhone(ctx);
    return;
  }

  await replyTransient(ctx, "Введите новое ФИО перевозчика:", buildFlowCancelKeyboard());
});

bot.action(/^carrier-vehicle-manage:(\d+)$/, async (ctx) => {
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);
  if (!user) {
    await ctx.answerCbQuery("Сначала выполните /start.");
    return;
  }

  const vehicles = await carrierService.listVehiclesByUserId(user.id, true);
  const vehicle = vehicles.find((item) => item.id === Number(ctx.match[1]));
  if (!vehicle) {
    await ctx.answerCbQuery("Транспорт не найден.");
    return;
  }

  await ctx.answerCbQuery();
  await replyTransient(ctx, `Редактирование транспорта\n${formatVehicleSummary(vehicle)}`, buildVehicleFieldKeyboard(vehicle.id));
});

bot.action(/^carrier-vehicle-toggle:(\d+):(0|1)$/, async (ctx) => {
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);
  if (!user) {
    await ctx.answerCbQuery("Сначала выполните /start.");
    return;
  }

  const vehicleId = Number(ctx.match[1]);
  const isActive = ctx.match[2] === "1";

  try {
    await carrierService.toggleVehicle(user.id, vehicleId, isActive);
    await ctx.answerCbQuery(isActive ? "Машина активирована" : "Машина скрыта");
    await ctx.editMessageReplyMarkup(buildVehicleManageKeyboard({ id: vehicleId, isActive }).reply_markup);
  } catch (error) {
    await ctx.answerCbQuery((error as Error).message);
  }
});

bot.action(/^carrier-vehicle-edit:(\d+):(type|brand|capacity|plateNumber|description|features|photos)$/, async (ctx) => {
  const vehicleId = Number(ctx.match[1]);
  const field = ctx.match[2];

  ctx.session.state = BotState.CARRIER_MANAGEMENT;
  await ctx.answerCbQuery();

  if (field === "type") {
    ctx.session.stepData = { mode: "vehicleTypeEdit", vehicleId };
    await replyTransient(ctx, "Выберите новый тип транспорта:", buildVehicleTypeKeyboard(`carrier-vehicle-edit-type:${vehicleId}`));
    return;
  }

  if (field === "photos") {
    ctx.session.stepData = { mode: "vehiclePhotosEdit", vehicleId, photos: [] };
    await promptCarrierVehiclePhotos(ctx);
    return;
  }

  ctx.session.stepData = { mode: "vehicleFieldEdit", vehicleId, field };
  const prompts: Record<string, string> = {
    brand: "Введите новую марку / модель транспорта:",
    capacity: "Введите новую вместимость или грузоподъемность:",
    plateNumber: "Введите новый госномер:",
    description: "Введите новое описание транспорта:",
    features: "Введите новые характеристики или напишите 'Нет':",
  };
  await replyTransient(ctx, prompts[field], field === "features" ? buildCommentKeyboard() : buildFlowCancelKeyboard());
});

bot.action(/^carrier-vehicle-edit-type:(\d+):(.+)$/, async (ctx) => {
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);
  if (!user) {
    await ctx.answerCbQuery("Сначала выполните /start.");
    return;
  }

  try {
    await carrierService.updateVehicle(user.id, Number(ctx.match[1]), { vehicleType: ctx.match[2] });
    resetSession(ctx);
    await ctx.answerCbQuery("Тип транспорта обновлен");
    await ctx.editMessageText("Тип транспорта обновлен.");
  } catch (error) {
    await ctx.answerCbQuery((error as Error).message);
  }
});

bot.action(/^carrier-order-status:(\d+):(IN_PROGRESS|COMPLETED|CANCELLED)$/, async (ctx) => {
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);
  if (!user || user.role !== "CARRIER") {
    await ctx.answerCbQuery("Только перевозчик может менять статус.");
    return;
  }

  const carrier = await carrierService.findCarrierByUserId(user.id);
  if (!carrier) {
    await ctx.answerCbQuery("Сначала завершите регистрацию перевозчика.");
    return;
  }

  try {
    await orderService.updateCarrierOrderStatus(bot, Number(ctx.match[1]), carrier.id, ctx.match[2] as "IN_PROGRESS" | "COMPLETED" | "CANCELLED");
    await ctx.answerCbQuery("Статус обновлен");
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  } catch (error) {
    await ctx.answerCbQuery((error as Error).message);
  }
});

bot.action(/^confirm_order$/, async (ctx) => {
  const stepData = ctx.session.stepData as OrderDto & { categoryId: number; regionId: number };
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);
  if (!user || user.role !== "CUSTOMER") {
    await ctx.reply("Только зарегистрированный заказчик может создать заявку.");
    resetSession(ctx);
    return;
  }

  const customer = await customerRepository.findByUserId(user.id);
  if (!customer) {
    await ctx.reply("Не удалось определить заказчика. Начните создание заявки заново.");
    resetSession(ctx);
    return;
  }

  const result = await orderService.createOrder(
    customer.id,
    {
      regionId: stepData.regionId,
      categoryId: stepData.categoryId,
      vehicleType: stepData.vehicleType,
      routeFrom: stepData.routeFrom,
      routeFromLat: stepData.routeFromLat,
      routeFromLng: stepData.routeFromLng,
      routeTo: stepData.routeTo,
      routeToLat: stepData.routeToLat,
      routeToLng: stepData.routeToLng,
      date: stepData.date,
      price: stepData.price,
      suggestedPrice: stepData.suggestedPrice,
      estimatedDistanceKm: stepData.estimatedDistanceKm,
      estimatedDurationHours: stepData.estimatedDurationHours,
      comment: stepData.comment,
      adultsCount: stepData.adultsCount,
      childrenCount: stepData.childrenCount,
      passengersCount: stepData.passengersCount,
      cargoDescription: stepData.cargoDescription,
      weight: stepData.weight,
      volume: stepData.volume,
    },
    bot
  );

  resetSession(ctx);
  await ctx.reply(`Заявка #${result.id} создана и отправлена подходящим перевозчикам.`, buildCustomerMenu(isAdminTelegramId(telegramId)));
});

bot.action(/^edit_order$/, async (ctx) => {
  const stepData = (ctx.session.stepData ?? {}) as Record<string, unknown>;
  if (stepData.regionId) {
    await ctx.answerCbQuery();
    await replyTransient(ctx, "Что нужно изменить?", buildOrderEditKeyboard(String(stepData.vehicleType ?? "")));
    return;
  }

  await ctx.answerCbQuery();
  await beginCustomerOrderFlow(
    ctx,
    "\u041d\u0430\u0447\u043d\u0435\u043c \u0437\u0430\u043d\u043e\u0432\u043e. \u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0440\u0435\u0433\u0438\u043e\u043d:"
  );
});

bot.action(/^edit_order_field:(route|date|price|details|comment|restart|cancel)$/, async (ctx) => {
  const action = ctx.match[1];
  const stepData = (ctx.session.stepData ?? {}) as Record<string, any>;

  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });

  if (action === "cancel") {
    await cancelActiveFlow(ctx);
    return;
  }

  if (action === "restart") {
    await beginCustomerOrderFlow(
      ctx,
      "\u041d\u0430\u0447\u043d\u0435\u043c \u0437\u0430\u043d\u043e\u0432\u043e. \u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u0440\u0435\u0433\u0438\u043e\u043d:"
    );
    return;
  }

  ctx.session.state = BotState.CUSTOMER_ORDER_DETAILS;

  if (action === "route") {
    await showRouteEditMenu(ctx, stepData);
    return;
  }

  if (action === "date") {
    ctx.session.stepData = resetRouteEstimationStep(stepData, "date");
    await showDepartureDatePicker(ctx);
    return;
  }

  if (action === "price") {
    ctx.session.stepData = { ...stepData, price: undefined, comment: undefined };
    if (stepData.suggestedPrice) {
      await promptSuggestedPriceChoice(ctx, ctx.session.stepData);
      return;
    }

    await promptManualPrice(ctx);
    return;
  }

  if (action === "details") {
    if (PASSENGER_VEHICLE_TYPES.includes(String(stepData.vehicleType ?? ""))) {
      ctx.session.stepData = {
        ...stepData,
        adultsCount: undefined,
        childrenCount: undefined,
        passengersCount: undefined,
        comment: undefined,
      };
      await promptAdultsCount(ctx);
      return;
    }

    ctx.session.stepData = {
      ...stepData,
      cargoDescription: undefined,
      weight: undefined,
      volume: undefined,
      comment: undefined,
    };
    await promptCargoDescription(ctx);
    return;
  }

  ctx.session.stepData = { ...stepData, comment: undefined };
  await promptOrderComment(ctx);
});

bot.action(/^edit_order_route:(from|to|swap|back)$/, async (ctx) => {
  const action = ctx.match[1];
  const stepData = (ctx.session.stepData ?? {}) as Record<string, any>;

  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  ctx.session.state = BotState.CUSTOMER_ORDER_DETAILS;

  if (action === "back") {
    await replyTransient(ctx, "Что нужно изменить?", buildOrderEditKeyboard(String(stepData.vehicleType ?? "")));
    return;
  }

  if (action === "from") {
    ctx.session.stepData = {
      ...resetRouteEstimationStep(stepData, "date"),
      routeFrom: undefined,
      routeFromLat: undefined,
      routeFromLng: undefined,
    };
    await promptRouteFrom(ctx, "Введите новую точку отправления. Точку назначения оставил как есть.");
    return;
  }

  if (action === "to") {
    ctx.session.stepData = resetRouteEstimationStep(stepData, "routeTo");
    await promptRouteTo(ctx, "Введите новую точку назначения.");
    return;
  }

  if (!stepData.routeFrom || !stepData.routeTo) {
    await showRouteEditMenu(ctx, stepData, "Сначала заполните обе точки маршрута.");
    return;
  }

  ctx.session.stepData = await syncOrderDraftMessage(ctx, {
    ...resetRouteEstimationStep(stepData, "date"),
    routeFrom: stepData.routeTo,
    routeFromLat: stepData.routeToLat,
    routeFromLng: stepData.routeToLng,
    routeTo: stepData.routeFrom,
    routeToLat: stepData.routeFromLat,
    routeToLng: stepData.routeFromLng,
  });
  await showDepartureDatePicker(ctx);
  await replyTransient(ctx, "Маршрут поменял местами. Выберите дату и время заново, и я пересчитаю поездку.", undefined, {
    replace: false,
  });
});

bot.action(/^skip_order:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery("Пропущено");
  await safeDeleteMessage(ctx, getCallbackMessageId(ctx));
});

bot.action(/^offer_order:(\d+)$/, async (ctx) => {
  const orderId = Number(ctx.match[1]);
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);
  if (!user || user.role !== "CARRIER") {
    await ctx.answerCbQuery("Только перевозчик может откликнуться на заказ.");
    return;
  }

  const carrier = await carrierRepository.findByUserId(user.id);
  if (!carrier || carrier.status !== "APPROVED") {
    await ctx.answerCbQuery("Ваш профиль не одобрен для откликов.");
    return;
  }

  ctx.session.state = BotState.ORDER_ACTION;
  ctx.session.stepData = { action: "carrierOfferPrice", orderId };
  await ctx.answerCbQuery();
  await promptCarrierOfferPrice(ctx);
});

bot.action(/^accept_order:(\d+)$/, async (ctx) => {
  const orderId = Number(ctx.match[1]);
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);
  if (!user || user.role !== "CARRIER") {
    await ctx.answerCbQuery("Только перевозчик может принять заказ.");
    return;
  }

  const carrier = await carrierRepository.findByUserId(user.id);
  if (!carrier || carrier.status !== "APPROVED") {
    await ctx.answerCbQuery("Ваш профиль не одобрен для приема заявок.");
    return;
  }

  ctx.session.state = BotState.ORDER_ACTION;
  ctx.session.stepData = { action: "acceptEta", orderId };
  await ctx.answerCbQuery();
  await promptCarrierEta(ctx, "Укажите ориентировочное время подачи для заказчика:");
});

bot.action(/^offer_customer:(accept|reject|counter):(\d+)$/, async (ctx) => {
  const action = ctx.match[1];
  const offerId = Number(ctx.match[2]);
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);
  if (!user || user.role !== "CUSTOMER") {
    await ctx.answerCbQuery("Только заказчик может управлять этим откликом.");
    return;
  }

  const customer = await customerRepository.findByUserId(user.id);
  if (!customer) {
    await ctx.answerCbQuery("Профиль заказчика не найден.");
    return;
  }

  if (action === "counter") {
    ctx.session.state = BotState.ORDER_ACTION;
    ctx.session.stepData = { action: "customerCounterPrice", offerId };
    await ctx.answerCbQuery();
    await promptCustomerCounterPrice(ctx);
    return;
  }

  try {
    if (action === "accept") {
      await orderService.acceptOffer(bot, offerId, customer.id);
      await ctx.answerCbQuery("Предложение принято");
    } else {
      await orderService.rejectOffer(bot, offerId, customer.id);
      await ctx.answerCbQuery("Предложение отклонено");
    }

    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  } catch (error) {
    await ctx.answerCbQuery((error as Error).message);
  }
});

bot.action(/^offer_carrier:(accept|counter|reject):(\d+)$/, async (ctx) => {
  const action = ctx.match[1];
  const offerId = Number(ctx.match[2]);
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);
  if (!user || user.role !== "CARRIER") {
    await ctx.answerCbQuery("Только перевозчик может управлять своим откликом.");
    return;
  }

  const carrier = await carrierRepository.findByUserId(user.id);
  if (!carrier) {
    await ctx.answerCbQuery("Профиль перевозчика не найден.");
    return;
  }

  if (action === "counter") {
    ctx.session.state = BotState.ORDER_ACTION;
    ctx.session.stepData = { action: "carrierCounterPrice", offerId };
    await ctx.answerCbQuery();
    await replyTransient(ctx, "Введите вашу новую цену в рублях:", buildFlowCancelKeyboard());
    return;
  }

  try {
    if (action === "accept") {
      await orderService.acceptOfferByCarrier(bot, offerId, carrier.id);
      await ctx.answerCbQuery("Встречная цена принята");
    } else {
      await orderService.rejectOfferByCarrier(bot, offerId, carrier.id);
      await ctx.answerCbQuery("Торг завершен");
    }

    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  } catch (error) {
    await ctx.answerCbQuery((error as Error).message);
  }
});

bot.action(/^carrier-order-deposit:submit:(\d+)$/, async (ctx) => {
  const orderId = Number(ctx.match[1]);
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);
  if (!user || user.role !== "CARRIER") {
    await ctx.answerCbQuery("Только перевозчик может отправить платежку.");
    return;
  }

  const carrier = await carrierRepository.findByUserId(user.id);
  if (!carrier) {
    await ctx.answerCbQuery("Профиль перевозчика не найден.");
    return;
  }

  ctx.session.state = BotState.ORDER_ACTION;
  ctx.session.stepData = { action: "carrierDepositReference", orderId };
  await ctx.answerCbQuery();
  await replyTransient(
    ctx,
    "Введите номер платежки, референс перевода или короткий комментарий к оплате. После этого заявка уйдет администратору на проверку.",
    buildFlowCancelKeyboard()
  );
});

bot.action(/^customer-order:return:(\d+)$/, async (ctx) => {
  const sourceOrderId = Number(ctx.match[1]);
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);
  if (!user || user.role !== "CUSTOMER") {
    await ctx.answerCbQuery("Только заказчик может запросить обратный рейс.");
    return;
  }

  const customer = await customerRepository.findByUserId(user.id);
  if (!customer) {
    await ctx.answerCbQuery("Профиль заказчика не найден.");
    return;
  }

  ctx.session.state = BotState.ORDER_ACTION;
  ctx.session.stepData = { action: "customerReturnDate", sourceOrderId, customerId: customer.id };
  await ctx.answerCbQuery();
  await replyTransient(
    ctx,
    "Введите дату и время обратного рейса. Подойдут форматы: 2026-05-24 18:30, 24.05.2026 18:30 или просто 24.05.2026.",
    buildFlowCancelKeyboard()
  );
});

bot.action(/^customer-order:(offers|refresh):(\d+)$/, async (ctx) => {
  const action = ctx.match[1];
  const orderId = Number(ctx.match[2]);
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);
  if (!user || user.role !== "CUSTOMER") {
    await ctx.answerCbQuery("Только заказчик может управлять этой заявкой.");
    return;
  }

  const customer = await customerRepository.findByUserId(user.id);
  if (!customer) {
    await ctx.answerCbQuery("Профиль заказчика не найден.");
    return;
  }

  await ctx.answerCbQuery(action === "offers" ? "Показываю отклики" : "Обновляю карточку");

  if (action === "offers") {
    await showCustomerOffersForOrder(ctx, customer.id, orderId);
    return;
  }

  const order = await orderRepository.findCustomerOrder(orderId, customer.id);
  if (!order) {
    await ctx.reply("Заявка не найдена.");
    return;
  }

  await sendCustomerOrderCard(ctx, order, { replaceCurrent: true });
});

bot.action(/^customer-order:(timeline|repeat):(\d+)$/, async (ctx) => {
  const action = ctx.match[1];
  const orderId = Number(ctx.match[2]);
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);
  if (!user || user.role !== "CUSTOMER") {
    await ctx.answerCbQuery("Только заказчик может управлять этой заявкой.");
    return;
  }

  const customer = await customerRepository.findByUserId(user.id);
  if (!customer) {
    await ctx.answerCbQuery("Профиль заказчика не найден.");
    return;
  }

  const order = await orderRepository.findCustomerOrder(orderId, customer.id);
  if (!order) {
    await ctx.answerCbQuery("Заявка не найдена.");
    return;
  }

  if (action === "timeline") {
    await ctx.answerCbQuery("Открываю историю");
    await showOrderTimeline(ctx, order);
    return;
  }

  await ctx.answerCbQuery("Готовлю повтор заказа");
  await beginRepeatOrderFlow(ctx, order);
});

bot.action(/^carrier-order-dispatch:start:(\d+)$/, async (ctx) => {
  const orderId = Number(ctx.match[1]);
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);
  if (!user || user.role !== "CARRIER") {
    await ctx.answerCbQuery("Только перевозчик может назначить экипаж.");
    return;
  }

  const carrier = await carrierService.findCarrierByUserId(user.id);
  if (!carrier) {
    await ctx.answerCbQuery("Профиль перевозчика не найден.");
    return;
  }

  const order = await orderRepository.findCarrierOrder(orderId, carrier.id);
  if (!order) {
    await ctx.answerCbQuery("Заявка не найдена.");
    return;
  }

  await ctx.answerCbQuery("Открываю назначение экипажа");
  await startCarrierDispatchFlow(ctx, user.id, order.id);
});

bot.action(/^carrier-order-dispatch:vehicle:(\d+):(\d+)$/, async (ctx) => {
  const orderId = Number(ctx.match[1]);
  const vehicleIdValue = Number(ctx.match[2]);
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);
  if (!user || user.role !== "CARRIER") {
    await ctx.answerCbQuery("Только перевозчик может назначить экипаж.");
    return;
  }

  const carrier = await carrierService.findCarrierByUserId(user.id);
  if (!carrier) {
    await ctx.answerCbQuery("Профиль перевозчика не найден.");
    return;
  }

  const order = await orderRepository.findCarrierOrder(orderId, carrier.id);
  if (!order) {
    await ctx.answerCbQuery("Заявка не найдена.");
    return;
  }

  ctx.session.state = BotState.ORDER_ACTION;
  ctx.session.stepData = {
    action: "carrierDispatchDriverName",
    orderId,
    vehicleId: vehicleIdValue > 0 ? vehicleIdValue : undefined,
    carrierId: carrier.id,
  };

  await ctx.answerCbQuery(vehicleIdValue > 0 ? "Машина выбрана" : "Подберу машину автоматически");
  await replyTransient(ctx, "Введите имя водителя для этого заказа:", buildFlowCancelKeyboard());
});

bot.action("dispatch:cancel", async (ctx) => {
  resetSession(ctx);
  await ctx.answerCbQuery("Назначение экипажа отменено");
  await showCarrierMenu(ctx);
});

bot.action(/^carrier-order:refresh:(\d+)$/, async (ctx) => {
  const orderId = Number(ctx.match[1]);
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);
  if (!user || user.role !== "CARRIER") {
    await ctx.answerCbQuery("Только перевозчик может обновить эту карточку.");
    return;
  }

  const carrier = await carrierService.findCarrierByUserId(user.id);
  if (!carrier) {
    await ctx.answerCbQuery("Профиль перевозчика не найден.");
    return;
  }

  const order = await orderRepository.findCarrierOrder(orderId, carrier.id);
  if (!order) {
    await ctx.answerCbQuery("Заявка не найдена");
    return;
  }

  await ctx.answerCbQuery("Карточка обновлена");
  await sendCarrierOrderCard(ctx, order, { replaceCurrent: true });
});

bot.action(/^carrier-order:timeline:(\d+)$/, async (ctx) => {
  const orderId = Number(ctx.match[1]);
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);
  if (!user || user.role !== "CARRIER") {
    await ctx.answerCbQuery("Только перевозчик может открыть историю этой заявки.");
    return;
  }

  const carrier = await carrierService.findCarrierByUserId(user.id);
  if (!carrier) {
    await ctx.answerCbQuery("Профиль перевозчика не найден.");
    return;
  }

  const order = await orderRepository.findCarrierOrder(orderId, carrier.id);
  if (!order) {
    await ctx.answerCbQuery("Заявка не найдена.");
    return;
  }

  await ctx.answerCbQuery("Открываю историю");
  await showOrderTimeline(ctx, order);
});

bot.action("carrier-open-orders:refresh", async (ctx) => {
  await ctx.answerCbQuery("Обновляю ленту");
  await showOpenOrdersForCurrentCarrier(ctx);
});

bot.on("location", async (ctx) => {
  const state = ctx.session.state as BotState;
  if (state !== BotState.CUSTOMER_ORDER_DETAILS) {
    await ctx.reply("Геолокацию можно отправлять во время создания заявки на этапе маршрута.");
    return;
  }

  const stepData = (ctx.session.stepData ?? {}) as Record<string, unknown>;
  const { latitude, longitude } = ctx.message.location;

  if (!stepData.routeFrom) {
    ctx.session.stepData = await syncOrderDraftMessage(ctx, {
      ...stepData,
      routeFrom: buildMapPointLabel("Точка отправления", latitude, longitude),
      routeFromLat: latitude,
      routeFromLng: longitude,
    });
    await promptRouteTo(ctx);
    return;
  }

  if (!stepData.routeTo) {
    ctx.session.stepData = await syncOrderDraftMessage(ctx, {
      ...ctx.session.stepData,
      routeTo: buildMapPointLabel("Точка назначения", latitude, longitude),
      routeToLat: latitude,
      routeToLng: longitude,
    });
    await showDepartureDatePicker(ctx);
    return;
  }

  await ctx.reply("Маршрут уже заполнен. Продолжайте оформление заявки.");
});

bot.on("contact", async (ctx) => {
  const state = ctx.session.state as BotState;
  const stepData = (ctx.session.stepData ?? {}) as any;
  const contact = ctx.message.contact;
  const telegramId = getTelegramId(ctx);
  const user = await userRepository.findByTelegramId(telegramId);

  if (![BotState.CARRIER_REGISTRATION, BotState.CARRIER_MANAGEMENT].includes(state)) {
    await ctx.reply("Контакт сейчас не ожидается.");
    return;
  }

  if (contact.user_id && Number(contact.user_id) !== telegramId) {
    await ctx.reply("Отправьте, пожалуйста, свой собственный номер телефона.");
    return;
  }

  let phone: string;
  try {
    phone = validateCarrierPhone(contact.phone_number);
  } catch (error) {
    await ctx.reply((error as Error).message);
    return;
  }

  if (state === BotState.CARRIER_MANAGEMENT && stepData.mode === "profileFieldEdit" && stepData.field === "phone") {
    if (!user) {
      await ctx.reply("Сначала выполните /start.");
      return;
    }

    await carrierService.updateProfileByUserId(user.id, { phone } as CarrierProfileUpdateDto);
    resetSession(ctx);
    await ctx.reply(`Телефон обновлен: ${phone}.`, buildCarrierMenu(isAdminTelegramId(telegramId)));
    return;
  }

  if (stepData.step !== "phone") {
    await ctx.reply("Контакт сейчас не ожидается.");
    return;
  }

  ctx.session.stepData = { ...stepData, phone, step: "regionSelection", regionIds: [] };
  const regions = await regionRepository.listAll();
  await replyTransient(
    ctx,
    "Выберите один или несколько регионов работы. Можно отметить несколько кнопок, затем нажмите «Сохранить регионы».",
    buildCarrierRegionPicker("carrier-region-toggle", regions, [], "carrier-region-confirm")
  );
});

bot.on("photo", async (ctx) => {
  const state = ctx.session.state as BotState;
  const stepData = ctx.session.stepData as any;

  if (state === BotState.CARRIER_MANAGEMENT && stepData?.mode === "vehiclePhotosEdit") {
    const photo = ctx.message.photo.at(-1);
    if (!photo) {
      await ctx.reply("Не удалось прочитать фото. Попробуйте еще раз.");
      return;
    }

    const nextPhotos = [...(Array.isArray(stepData.photos) ? stepData.photos : []), photo.file_id];
    ctx.session.stepData = { ...stepData, photos: nextPhotos };
    await replyTransient(ctx, `Фото сохранено (${nextPhotos.length}). Отправьте еще фото или нажмите "${DONE_TEXT}".`, buildPhotoStepKeyboard());
    return;
  }

  if (![BotState.CARRIER_REGISTRATION, BotState.CARRIER_VEHICLE_REGISTRATION].includes(state) || stepData?.step !== "photos") {
    await ctx.reply("Фото можно отправлять только в шаге добавления транспорта.");
    return;
  }

  const photo = ctx.message.photo.at(-1);
  if (!photo) {
    await ctx.reply("Не удалось прочитать фото. Попробуйте еще раз.");
    return;
  }

  const nextPhotos = [...(Array.isArray(stepData.photos) ? stepData.photos : []), photo.file_id];
  ctx.session.stepData = { ...stepData, photos: nextPhotos };
  await replyTransient(ctx, `Фото сохранено (${nextPhotos.length}). Отправьте еще фото или нажмите "${DONE_TEXT}".`, buildPhotoStepKeyboard());
});

bot.on("text", async (ctx) => {
  const state = ctx.session.state as BotState;
  const text = ctx.message.text.trim();

  if (state === BotState.ORDER_ACTION) {
    const stepData = (ctx.session.stepData ?? {}) as Record<string, any>;
    const telegramId = getTelegramId(ctx);
    const user = await userRepository.findByTelegramId(telegramId);

    if (!user) {
      resetSession(ctx);
      await ctx.reply("Сначала выполните /start.");
      return;
    }

    try {
      switch (stepData.action) {
        case "carrierDispatchDriverName": {
          if (user.role !== "CARRIER") {
            await ctx.reply("Это действие доступно только перевозчику.");
            return;
          }

          const driverName = text.trim().replace(/\s+/g, " ");
          if (driverName.length < 2) {
            await ctx.reply("Введите имя водителя хотя бы из 2 символов.");
            return;
          }

          ctx.session.stepData = { ...stepData, action: "carrierDispatchDriverPhone", driverName };
          await replyTransient(ctx, "Теперь введите телефон водителя в формате +7 999 123-45-67.", buildFlowCancelKeyboard());
          return;
        }
        case "carrierDispatchDriverPhone": {
          if (user.role !== "CARRIER") {
            await ctx.reply("Это действие доступно только перевозчику.");
            return;
          }

          const carrier = await carrierRepository.findByUserId(user.id);
          if (!carrier) {
            await ctx.reply("Профиль перевозчика не найден.");
            return;
          }

          const driverPhone = validateCarrierPhone(text);
          await completeCarrierDispatchFlow(ctx, {
            orderId: Number(stepData.orderId),
            carrierId: carrier.id,
            vehicleId: typeof stepData.vehicleId === "number" ? Number(stepData.vehicleId) : undefined,
            driverName: String(stepData.driverName ?? ""),
            driverPhone,
          });
          return;
        }
        case "acceptEta": {
          if (user.role !== "CARRIER") {
            await ctx.reply("Это действие доступно только перевозчику.");
            return;
          }

          const carrier = await carrierRepository.findByUserId(user.id);
          if (!carrier) {
            await ctx.reply("Профиль перевозчика не найден.");
            return;
          }

          const pickupEtaText = parseEtaInput(text);
          if (!pickupEtaText) {
            await ctx.reply("Укажите корректное время подачи. Например: 30 мин, 1 час или 1.5 часа.");
            return;
          }

          const sourceOrder = await orderRepository.findById(Number(stepData.orderId));
          if (!sourceOrder || sourceOrder.status !== "NEW") {
            await ctx.reply("Заявка уже недоступна для отклика.");
            return;
          }

          const offer = await orderService.createCarrierOffer(bot, Number(stepData.orderId), carrier.id, Number(sourceOrder.price), pickupEtaText);
          resetSession(ctx);
          await ctx.reply(`Отклик по цене заказчика ${offer.proposedPrice} ₽ отправлен. Ждем подтверждение заказчика.`, buildCarrierMenu(isAdminTelegramId(telegramId)));
          return;
        }
        case "carrierOfferPrice": {
          if (user.role !== "CARRIER") {
            await ctx.reply("Это действие доступно только перевозчику.");
            return;
          }

          const proposedPrice = parseDecimalInput(text);
          if (Number.isNaN(proposedPrice) || proposedPrice <= 0) {
            await ctx.reply("Введите корректную цену в рублях.");
            return;
          }

          ctx.session.stepData = { ...stepData, action: "carrierOfferEta", proposedPrice };
          await promptCarrierEta(ctx, "Укажите ориентировочное время подачи для этого предложения:");
          return;
        }
        case "carrierOfferEta": {
          if (user.role !== "CARRIER") {
            await ctx.reply("Это действие доступно только перевозчику.");
            return;
          }

          const carrier = await carrierRepository.findByUserId(user.id);
          if (!carrier) {
            await ctx.reply("Профиль перевозчика не найден.");
            return;
          }

          const pickupEtaText = parseEtaInput(text);
          if (!pickupEtaText) {
            await ctx.reply("Укажите корректное время подачи. Например: 30 мин, 1 час или 1.5 часа.");
            return;
          }

          const offer = await orderService.createCarrierOffer(bot, Number(stepData.orderId), carrier.id, Number(stepData.proposedPrice), pickupEtaText);
          resetSession(ctx);
          await ctx.reply(`Предложение ${offer.proposedPrice} ₽ отправлено заказчику.`, buildCarrierMenu(isAdminTelegramId(telegramId)));
          return;
        }
        case "customerCounterPrice": {
          if (user.role !== "CUSTOMER") {
            await ctx.reply("Это действие доступно только заказчику.");
            return;
          }

          const customer = await customerRepository.findByUserId(user.id);
          if (!customer) {
            await ctx.reply("Профиль заказчика не найден.");
            return;
          }

          const proposedPrice = parseDecimalInput(text);
          if (Number.isNaN(proposedPrice) || proposedPrice <= 0) {
            await ctx.reply("Введите корректную цену в рублях.");
            return;
          }

          await orderService.counterOfferByCustomer(bot, Number(stepData.offerId), customer.id, proposedPrice);
          resetSession(ctx);
          await ctx.reply("Встречная цена отправлена перевозчику.", buildCustomerMenu(isAdminTelegramId(telegramId)));
          return;
        }
        case "carrierCounterPrice": {
          if (user.role !== "CARRIER") {
            await ctx.reply("Это действие доступно только перевозчику.");
            return;
          }

          const proposedPrice = parseDecimalInput(text);
          if (Number.isNaN(proposedPrice) || proposedPrice <= 0) {
            await ctx.reply("Введите корректную цену в рублях.");
            return;
          }

          ctx.session.stepData = { ...stepData, action: "carrierCounterEta", proposedPrice };
          await promptCarrierEta(ctx, "Укажите время подачи для новой цены:");
          return;
        }
        case "carrierCounterEta": {
          if (user.role !== "CARRIER") {
            await ctx.reply("Это действие доступно только перевозчику.");
            return;
          }

          const carrier = await carrierRepository.findByUserId(user.id);
          if (!carrier) {
            await ctx.reply("Профиль перевозчика не найден.");
            return;
          }

          const pickupEtaText = parseEtaInput(text);
          if (!pickupEtaText) {
            await ctx.reply("Укажите корректное время подачи. Например: 30 мин, 1 час или 1.5 часа.");
            return;
          }

          await orderService.counterOfferByCarrier(bot, Number(stepData.offerId), carrier.id, Number(stepData.proposedPrice), pickupEtaText);
          resetSession(ctx);
          await ctx.reply("Новое предложение отправлено заказчику.", buildCarrierMenu(isAdminTelegramId(telegramId)));
          return;
        }
        case "carrierDepositReference": {
          if (user.role !== "CARRIER") {
            await ctx.reply("Это действие доступно только перевозчику.");
            return;
          }

          const carrier = await carrierRepository.findByUserId(user.id);
          if (!carrier) {
            await ctx.reply("Профиль перевозчика не найден.");
            return;
          }

          if (!text || text.length < 3) {
            await ctx.reply("Укажите номер платежки или понятный референс перевода.");
            return;
          }

          await orderService.submitCarrierDeposit(bot, Number(stepData.orderId), carrier.id, text);
          resetSession(ctx);
          await ctx.reply(
            "Платежка отправлена на проверку админу. После подтверждения контакты откроются автоматически.",
            buildCarrierMenu(isAdminTelegramId(telegramId))
          );
          return;
        }
        case "customerReturnDate": {
          if (user.role !== "CUSTOMER") {
            await ctx.reply("Это действие доступно только заказчику.");
            return;
          }

          const parsedDate = parseFlexibleDepartureDate(text);
          if (!parsedDate) {
            await ctx.reply("Не смог понять дату. Подойдут форматы: 2026-05-24 18:30, 24.05.2026 18:30 или 24.05.2026.");
            return;
          }

          ctx.session.stepData = { ...stepData, action: "customerReturnComment", date: parsedDate.date.toISOString() };
          await ctx.reply("Добавить комментарий к обратному рейсу? Если не нужно, напишите «Нет».", buildCommentKeyboard());
          return;
        }
        case "customerReturnComment": {
          if (user.role !== "CUSTOMER") {
            await ctx.reply("Это действие доступно только заказчику.");
            return;
          }

          const customer = await customerRepository.findByUserId(user.id);
          if (!customer) {
            await ctx.reply("Профиль заказчика не найден.");
            return;
          }

          const returnOrder = await orderService.requestReturnTrip(bot, Number(stepData.sourceOrderId), customer.id, {
            date: String(stepData.date),
            comment: isNoInput(text) ? null : text,
          });

          resetSession(ctx);
          await ctx.reply(
            `Обратный рейс #${returnOrder.id} создан. Теперь ждем платежку от перевозчика и подтверждение депозита.`,
            buildCustomerMenu(isAdminTelegramId(telegramId))
          );
          return;
        }
        default:
          resetSession(ctx);
          await ctx.reply("Этот сценарий уже завершен. Начните действие заново.");
          return;
      }
    } catch (error) {
      await ctx.reply((error as Error).message);
      return;
    }
  }

  if (state === BotState.ADMIN_PRICING_EDIT) {
    const stepData = ctx.session.stepData as { vehicleType: string; field: "basePrice" | "pricePerKm" | "pricePerHour" | "minPrice" };
    const value = Number(text.replace(",", "."));
    if (Number.isNaN(value) || value < 0) {
      await ctx.reply("Введите корректное неотрицательное число.");
      return;
    }

    await pricingService.updateRuleField(stepData.vehicleType, stepData.field, value);
    resetSession(ctx);
    await ctx.reply("Тариф обновлен.");
    await showPricingRuleDetails(ctx, stepData.vehicleType, false);
    return;
  }

  if (state === BotState.CUSTOMER_REGISTRATION) {
    const telegramId = getTelegramId(ctx);
    let user = await userService.findOrCreateCustomer(telegramId, null);
    if (user.role !== "CUSTOMER") {
      user = await userRepository.updateRole(user.id, "CUSTOMER");
    }
    const existingCustomer = await customerRepository.findByUserId(user.id);
    if (!existingCustomer) {
      await customerRepository.create(user.id, text);
    }
    resetSession(ctx);
    await ctx.reply("Регистрация заказчика завершена.", buildCustomerMenu(isAdminTelegramId(telegramId)));
    return;
  }

  if (state === BotState.CARRIER_MANAGEMENT) {
    const stepData = (ctx.session.stepData ?? {}) as any;
    const telegramId = getTelegramId(ctx);
    const user = await userRepository.findByTelegramId(telegramId);
    if (!user) {
      await ctx.reply("Сначала выполните /start.");
      return;
    }

    if (stepData.mode === "profileFieldEdit") {
      try {
        const payload: CarrierProfileUpdateDto =
          stepData.field === "fullName"
            ? { fullName: validateCarrierFullName(text) }
            : { phone: validateCarrierPhone(text) };

        await carrierService.updateProfileByUserId(user.id, payload);
        resetSession(ctx);
        await ctx.reply("Профиль перевозчика обновлен.", buildCarrierMenu(isAdminTelegramId(telegramId)));
        await showCarrierCabinet(ctx, user.id);
      } catch (error) {
        await replyTransient(
          ctx,
          (error as Error).message,
          stepData.field === "phone" ? buildContactKeyboard() : buildFlowCancelKeyboard(),
          { replace: false }
        );
      }
      return;
    }

    if (stepData.mode === "vehicleFieldEdit") {
      try {
        const payload: VehicleUpdateDto = {};
        switch (stepData.field) {
          case "brand":
            payload.brand = validateVehicleBrand(text);
            break;
          case "capacity":
            payload.capacity = validateVehicleCapacity(text);
            break;
          case "plateNumber":
            payload.plateNumber = validatePlateNumber(text);
            break;
          case "description":
            payload.description = validateVehicleDescription(text);
            break;
          case "features":
            payload.features = validateVehicleFeatures(text);
            break;
          default:
            await replyTransient(ctx, "Поле для редактирования не распознано.");
            return;
        }

        await carrierService.updateVehicle(user.id, Number(stepData.vehicleId), payload);
        resetSession(ctx);
        await ctx.reply("Транспорт обновлен.", buildCarrierMenu(isAdminTelegramId(telegramId)));
      } catch (error) {
        await replyTransient(
          ctx,
          (error as Error).message,
          stepData.field === "features" ? buildCommentKeyboard() : buildFlowCancelKeyboard(),
          { replace: false }
        );
      }
      return;
    }

    if (stepData.mode === "vehiclePhotosEdit") {
      if (isSkipInput(text)) {
        resetSession(ctx);
        await ctx.reply("Обновление фото отменено.", buildCarrierMenu(isAdminTelegramId(telegramId)));
        return;
      }

      if (isDoneInput(text)) {
        if (!Array.isArray(stepData.photos) || stepData.photos.length === 0) {
          await replyTransient(ctx, "Сначала отправьте хотя бы одно фото или нажмите «Пропустить».", buildPhotoStepKeyboard());
          return;
        }

        await carrierService.updateVehicle(user.id, Number(stepData.vehicleId), { photos: stepData.photos });
        resetSession(ctx);
        await ctx.reply("Фото транспорта обновлены.", buildCarrierMenu(isAdminTelegramId(telegramId)));
        return;
      }

      await replyTransient(ctx, `Сейчас ожидаются фотографии. Отправьте фото или нажмите "${DONE_TEXT}" / "${SKIP_TEXT}".`, buildPhotoStepKeyboard());
      return;
    }
  }

  if (state === BotState.CUSTOMER_ORDER_DETAILS) {
    const stepData = ctx.session.stepData ?? {};
    const vehicleType = String(stepData.vehicleType ?? "");
    const isPassengerOrder = PASSENGER_VEHICLE_TYPES.includes(vehicleType);
    const isCargoOrder = CARGO_VEHICLE_TYPES.includes(vehicleType);

    if (!stepData.routeFrom) {
      try {
        const routeFrom = parseRoutePointInput(text, "адреса отправления", "Точка отправления");
        ctx.session.stepData = await syncOrderDraftMessage(ctx, {
          ...stepData,
          routeFrom: routeFrom.routeLabel,
          routeFromLat: routeFrom.lat,
          routeFromLng: routeFrom.lng,
        });
      } catch (error) {
        await replyTransient(ctx, (error as Error).message, buildLocationKeyboard());
        return;
      }
      await promptRouteTo(ctx);
      return;
    }

    if (!stepData.routeTo) {
      try {
        const routeTo = parseRoutePointInput(text, "адреса назначения", "Точка назначения");
        ctx.session.stepData = await syncOrderDraftMessage(ctx, {
          ...stepData,
          routeTo: routeTo.routeLabel,
          routeToLat: routeTo.lat,
          routeToLng: routeTo.lng,
        });
      } catch (error) {
        await replyTransient(ctx, (error as Error).message, buildLocationKeyboard());
        return;
      }
      await showDepartureDatePicker(ctx);
      return;
    }

    if (!stepData.date) {
      const parsedDatePayload = parseFlexibleDepartureDate(text);
      if (!parsedDatePayload) {
        await replyTransient(
          ctx,
          "Дата не распознана. Подойдут варианты: 2026-05-14 15:30, 14.05.2026 15:30, 14-05-2026 или 14.05.2026.",
          buildFlowCancelKeyboard()
        );
        return;
      }
      const parsedDate = parsedDatePayload.date;
      if (parsedDate.getTime() <= Date.now()) {
        await replyTransient(ctx, "Дата поездки должна быть в будущем. Например: 2026-05-14 15:30 или 14.05.2026.", buildFlowCancelKeyboard());
        return;
      }
      await completeOrderDateSelection(ctx, stepData, parsedDatePayload.date, parsedDatePayload.timeWasInferred);
      return;
    }

    if (stepData.price === undefined) {
      const enteredPrice = parseDecimalInput(text);
      if (Number.isNaN(enteredPrice) || enteredPrice <= 0) {
        await replyTransient(ctx, "Введите корректную цену.", buildFlowCancelKeyboard());
        return;
      }

      const updatedStepData = await syncOrderDraftMessage(ctx, { ...stepData, price: enteredPrice });
      await continueCustomerOrderAfterPrice(ctx, updatedStepData);
      return;
      ctx.session.stepData = updatedStepData;
      if (isPassengerOrder) {
        if (updatedStepData.adultsCount === undefined) {
          await ctx.reply("Введите количество взрослых пассажиров:");
          return;
        }

        if (updatedStepData.childrenCount === undefined) {
          await ctx.reply("Введите количество детей:");
          return;
        }

        try {
          const passengersCount = validatePassengerOrderStepData(updatedStepData);
          ctx.session.stepData = { ...updatedStepData, passengersCount };
        } catch (error) {
          ctx.session.stepData = resetPassengerPlanningStep(updatedStepData);
          await ctx.reply(
            `${(error as Error).message}\nУкажите новую дату и время отправления. Подойдут варианты: 2026-05-14 15:30, 14.05.2026 15:30 или просто 14.05.2026.`,
            removeKeyboardMarkup
          );
          return;
        }

        await ctx.reply("Введите комментарий к заявке или напишите 'Нет':");
      } else if (isCargoOrder) {
        await ctx.reply("Опишите груз:");
      } else {
        await ctx.reply("Введите комментарий к заявке или напишите 'Нет':");
      }
      return;
    }

    if (isPassengerOrder && stepData.adultsCount === undefined) {
      const adultsCount = parseIntegerInput(text);
      if (!Number.isInteger(adultsCount) || adultsCount < 0) {
        await replyTransient(ctx, "Укажите корректное количество взрослых пассажиров.", buildPassengerCountKeyboard(), { replace: false });
        return;
      }
      ctx.session.stepData = await syncOrderDraftMessage(ctx, { ...stepData, adultsCount });
      await promptChildrenCount(ctx);
      return;
      await ctx.reply("Введите количество детей:");
      return;
    }

    if (isPassengerOrder && stepData.childrenCount === undefined) {
      const childrenCount = parseIntegerInput(text);
      if (!Number.isInteger(childrenCount) || childrenCount < 0) {
        await replyTransient(ctx, "Укажите корректное количество детей.", buildPassengerCountKeyboard(), { replace: false });
        return;
      }

      const adultsCount = Number(stepData.adultsCount ?? 0);
      if (adultsCount + childrenCount <= 0) {
        await replyTransient(ctx, "Укажите хотя бы одного пассажира.", buildPassengerCountKeyboard(), { replace: false });
        return;
      }

      const updatedStepData = await syncOrderDraftMessage(ctx, { ...stepData, childrenCount });
      try {
        const passengersCount = validatePassengerOrderStepData(updatedStepData);
        ctx.session.stepData = await syncOrderDraftMessage(ctx, { ...updatedStepData, passengersCount });
        await promptOrderComment(ctx);
        return;
      } catch (error) {
        ctx.session.stepData = resetPassengerPlanningStep(updatedStepData);
        await promptDepartureDate(
          ctx,
          `${(error as Error).message}\nУкажите новую дату и время отправления. Подойдут варианты: 2026-05-14 15:30, 14.05.2026 15:30 или просто 14.05.2026.`
        );
        return;
      }

      await ctx.reply("Введите комментарий к заявке или напишите 'Нет':");
      return;
    }

    if (isCargoOrder && !stepData.cargoDescription) {
      ctx.session.stepData = await syncOrderDraftMessage(ctx, { ...stepData, cargoDescription: text });
      await promptCargoWeight(ctx);
      return;
      await ctx.reply("Введите вес груза в килограммах или 0, если неизвестен:");
      return;
    }

    if (isCargoOrder && stepData.weight === undefined) {
      const weight = parseDecimalInput(text);
      if (Number.isNaN(weight) || weight < 0) {
        await replyTransient(ctx, "Введите корректный вес.", buildWeightKeyboard(), { replace: false });
        return;
      }
      ctx.session.stepData = await syncOrderDraftMessage(ctx, { ...stepData, weight });
      await promptCargoVolume(ctx);
      return;
      await ctx.reply("Введите объем груза в кубометрах или 0, если неизвестен:");
      return;
    }

    if (isCargoOrder && stepData.volume === undefined) {
      const volume = parseDecimalInput(text);
      if (Number.isNaN(volume) || volume < 0) {
        await replyTransient(ctx, "Введите корректный объем.", buildWeightKeyboard(), { replace: false });
        return;
      }
      ctx.session.stepData = await syncOrderDraftMessage(ctx, { ...stepData, volume });
      await promptOrderComment(ctx);
      return;
      await ctx.reply("Введите комментарий к заявке или напишите 'Нет':");
      return;
    }

    const comment = isNoInput(text) ? null : text;
    const nextStepData = await syncOrderDraftMessage(ctx, { ...stepData, comment });

    if (isPassengerOrder) {
      try {
        const passengersCount = validatePassengerOrderStepData(nextStepData);
        nextStepData.passengersCount = passengersCount;
      } catch (error) {
        ctx.session.stepData = resetPassengerPlanningStep(nextStepData);
        await promptDepartureDate(
          ctx,
          `${(error as Error).message}\nУкажите новую дату и время отправления. Подойдут варианты: 2026-05-14 15:30, 14.05.2026 15:30 или просто 14.05.2026.`
        );
        return;
      }
    }

    await showOrderConfirmation(ctx, nextStepData);
    return;
  }

  if ([BotState.CARRIER_REGISTRATION, BotState.CARRIER_VEHICLE_REGISTRATION].includes(state)) {
    const stepData = ctx.session.stepData as any;
    const mode = (stepData.mode ?? "registration") as "registration" | "vehicle";

    switch (stepData.step) {
      case "fullName":
        try {
          ctx.session.stepData = { ...stepData, fullName: validateCarrierFullName(text), step: "phone" };
        } catch (error) {
          await replyTransient(ctx, (error as Error).message, buildFlowCancelKeyboard(), { replace: false });
          return;
        }
        await promptCarrierPhone(ctx);
        return;
      case "phone": {
        try {
          ctx.session.stepData = { ...stepData, phone: validateCarrierPhone(text), step: "regionSelection", regionIds: [] };
        } catch (error) {
          await replyTransient(ctx, (error as Error).message, buildContactKeyboard(), { replace: false });
          return;
        }
        const regions = await regionRepository.listAll();
        await replyTransient(
          ctx,
          "Выберите один или несколько регионов работы. Можно отметить несколько кнопок, затем нажмите «Сохранить регионы».",
          buildCarrierRegionPicker("carrier-region-toggle", regions, [], "carrier-region-confirm")
        );
        return;
      }
      case "brand":
        try {
          ctx.session.stepData = { ...stepData, brand: validateVehicleBrand(text), step: "capacity" };
        } catch (error) {
          await replyTransient(ctx, (error as Error).message, buildFlowCancelKeyboard(), { replace: false });
          return;
        }
        await replyTransient(ctx, "Введите вместимость / грузоподъемность:", buildFlowCancelKeyboard());
        return;
      case "capacity":
        try {
          ctx.session.stepData = { ...stepData, capacity: validateVehicleCapacity(text), step: "plateNumber" };
        } catch (error) {
          await replyTransient(ctx, (error as Error).message, buildFlowCancelKeyboard(), { replace: false });
          return;
        }
        await replyTransient(ctx, "Введите госномер:", buildFlowCancelKeyboard());
        return;
      case "plateNumber":
        try {
          ctx.session.stepData = { ...stepData, plateNumber: validatePlateNumber(text), step: "description" };
        } catch (error) {
          await replyTransient(ctx, (error as Error).message, buildFlowCancelKeyboard(), { replace: false });
          return;
        }
        await replyTransient(ctx, "Введите описание транспорта:", buildFlowCancelKeyboard());
        return;
      case "description":
        try {
          ctx.session.stepData = { ...stepData, description: validateVehicleDescription(text), step: "features" };
        } catch (error) {
          await replyTransient(ctx, (error as Error).message, buildFlowCancelKeyboard(), { replace: false });
          return;
        }
        await replyTransient(
          ctx,
          "Введите характеристики транспорта: год, кузов, кондиционер, гидроборт и т.д. Если нечего добавить, напишите 'Нет'.",
          buildCommentKeyboard()
        );
        return;
      case "features":
        try {
          ctx.session.stepData = { ...stepData, features: validateVehicleFeatures(text), step: "photos" };
        } catch (error) {
          await replyTransient(ctx, (error as Error).message, buildCommentKeyboard(), { replace: false });
          return;
        }
        await promptCarrierVehiclePhotos(ctx);
        return;
      case "photos":
        if (isSkipInput(text) || isDoneInput(text)) {
          await finalizeCarrierFlow(ctx, mode);
          return;
        }
        await replyTransient(ctx, `Сейчас ожидается фото транспорта. Отправьте фото или нажмите "${DONE_TEXT}" / "${SKIP_TEXT}".`, buildPhotoStepKeyboard());
        return;
      case "vehicleType":
        await replyTransient(ctx, "Выберите тип транспорта кнопкой выше.");
        return;
      case "regionSelection":
        await replyTransient(ctx, "Выберите один или несколько регионов кнопками выше и затем нажмите «Сохранить регионы».");
        return;
      default:
        return;
    }
  }
});

bot.catch((err) => {
  logger.error(err, "Bot error");
});

export const initializeBot = async () => {
  await pricingService.ensureDefaults();
  await notificationService.processQueue(bot);
  return bot;
};
