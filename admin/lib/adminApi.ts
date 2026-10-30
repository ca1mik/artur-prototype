import "server-only";

import { readServerEnv } from "./serverEnv";

export type AdminOverview = {
  generatedAt: string;
  health: {
    telegramEnabled: boolean;
    useWebhook: boolean;
    useRedisQueue: boolean;
  };
  security: {
    otpEnabled: boolean;
    accessTokenTtlMinutes: number;
    refreshTokenTtlHours: number;
    activeMobileSessions: number;
    protectedDevices: number;
    challengesLast24h: number;
    revokedSessionsLast24h: number;
  };
  orders: {
    total: number;
    new: number;
    awaitingDeposit: number;
    accepted: number;
    inProgress: number;
    completed: number;
    cancelled: number;
    depositPendingVerification: number;
    averagePrice: number;
    grossVolume: number;
  };
  carriers: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    banned: number;
  };
  catalog: {
    customers: number;
    regions: number;
    categories: number;
    pricingRules: number;
  };
};

export type AdminOrder = {
  id: number;
  status: string;
  routeFrom: string;
  routeTo: string;
  date: string;
  price: number;
  pickupEtaText?: string | null;
  depositAmount?: number | null;
  depositStatus?: string | null;
  depositReference?: string | null;
  contactsUnlockedAt?: string | null;
  vehicleType: string;
  createdAt: string;
  region: { name: string };
  category: { name: string };
  customer: { name: string; user: { telegramId: bigint | number | string } };
  carrier?: { fullName?: string | null; user: { telegramId: bigint | number | string } } | null;
};

export type AdminCarrier = {
  id: number;
  status: string;
  fullName?: string | null;
  brand?: string | null;
  vehicleType?: string | null;
  capacity?: number | null;
  plateNumber?: string | null;
  description?: string | null;
  region?: { name: string } | null;
  carrierRegions: Array<{ region: { name: string } }>;
  vehicles: Array<{ id: number; type: string; isActive: boolean }>;
  user: { telegramId: bigint | number | string; phone?: string | null };
};

export type PricingRule = {
  id: number;
  vehicleType: string;
  basePrice: number;
  pricePerKm: number;
  pricePerHour: number;
  minPrice: number;
};

export type AdminDashboardData = {
  mode: "live" | "fallback";
  baseUrl: string;
  fallbackReason?: string;
  overview: AdminOverview;
  recentOrders: AdminOrder[];
  orderHistory: AdminOrder[];
  depositPendingOrders: AdminOrder[];
  pendingCarriers: AdminCarrier[];
  allCarriers: AdminCarrier[];
  pricingRules: PricingRule[];
};

const demoPricingRules: PricingRule[] = [
  { id: 1, vehicleType: "CAR", basePrice: 450, pricePerKm: 24, pricePerHour: 650, minPrice: 1800 },
  { id: 2, vehicleType: "MINIVAN", basePrice: 650, pricePerKm: 30, pricePerHour: 850, minPrice: 2600 },
  { id: 3, vehicleType: "MINIBUS", basePrice: 980, pricePerKm: 42, pricePerHour: 1200, minPrice: 4200 },
  { id: 4, vehicleType: "BUS", basePrice: 1400, pricePerKm: 58, pricePerHour: 1650, minPrice: 6200 },
  { id: 5, vehicleType: "GAZELLE", basePrice: 720, pricePerKm: 29, pricePerHour: 820, minPrice: 2400 },
  { id: 6, vehicleType: "TRUCK", basePrice: 1100, pricePerKm: 43, pricePerHour: 1280, minPrice: 3900 },
  { id: 7, vehicleType: "TRAILER", basePrice: 1650, pricePerKm: 67, pricePerHour: 1950, minPrice: 6200 },
  { id: 8, vehicleType: "SPECIAL", basePrice: 2400, pricePerKm: 88, pricePerHour: 2550, minPrice: 8400 },
];

const demoRecentOrders: AdminOrder[] = [
  {
    id: 2084,
    status: "NEW",
    routeFrom: "Казань, IT-парк им. Башира Рамеева",
    routeTo: "Иннополис, Университет Иннополис",
    date: "2026-05-17T06:30:00.000Z",
    price: 18500,
    pickupEtaText: "20 мин",
    vehicleType: "MINIBUS",
    createdAt: "2026-05-16T07:40:00.000Z",
    region: { name: "Казань" },
    category: { name: "Корпоративная перевозка" },
    customer: { name: "ООО Волга Софт", user: { telegramId: "7001001" } },
    carrier: null,
  },
  {
    id: 2083,
    status: "ACCEPTED",
    routeFrom: "Самара, Московское шоссе 4",
    routeTo: "Тольятти, Южное шоссе 165",
    date: "2026-05-16T09:00:00.000Z",
    price: 14200,
    pickupEtaText: "35 мин",
    vehicleType: "MINIVAN",
    createdAt: "2026-05-16T07:20:00.000Z",
    region: { name: "Самара" },
    category: { name: "Межгород" },
    customer: { name: "ООО СамараТех", user: { telegramId: "7001002" } },
    carrier: { fullName: "Ильдар Сафин", user: { telegramId: "8002001" } },
  },
  {
    id: 2082,
    status: "IN_PROGRESS",
    routeFrom: "Уфа, аэропорт",
    routeTo: "Стерлитамак, ул. Мира 1",
    date: "2026-05-16T05:30:00.000Z",
    price: 21900,
    pickupEtaText: "на линии",
    vehicleType: "BUS",
    createdAt: "2026-05-16T05:00:00.000Z",
    region: { name: "Уфа" },
    category: { name: "Трансфер" },
    customer: { name: "Event Ufa", user: { telegramId: "7001003" } },
    carrier: { fullName: "Руслан Яппаров", user: { telegramId: "8002002" } },
  },
  {
    id: 2081,
    status: "COMPLETED",
    routeFrom: "Казань, ул. Тэцевская 1",
    routeTo: "Набережные Челны, Промзона 12",
    date: "2026-05-16T04:10:00.000Z",
    price: 24800,
    pickupEtaText: "45 мин",
    vehicleType: "GAZELLE",
    createdAt: "2026-05-16T03:20:00.000Z",
    region: { name: "Казань" },
    category: { name: "Доставка груза" },
    customer: { name: "ООО ТехноПак", user: { telegramId: "7001004" } },
    carrier: { fullName: "Артур Каримов", user: { telegramId: "8002003" } },
  },
  {
    id: 2080,
    status: "NEW",
    routeFrom: "Казань Экспо",
    routeTo: "Казань, отель Ривьера",
    date: "2026-05-17T14:30:00.000Z",
    price: 27600,
    pickupEtaText: "30 мин",
    vehicleType: "BUS",
    createdAt: "2026-05-16T02:40:00.000Z",
    region: { name: "Казань" },
    category: { name: "Туризм" },
    customer: { name: "Travel Point", user: { telegramId: "7001005" } },
    carrier: null,
  },
  {
    id: 2079,
    status: "CANCELLED",
    routeFrom: "Самара, Заводское шоссе 17",
    routeTo: "Самара, Красноглинское шоссе 2",
    date: "2026-05-16T01:00:00.000Z",
    price: 8700,
    pickupEtaText: "15 мин",
    vehicleType: "TRUCK",
    createdAt: "2026-05-15T23:40:00.000Z",
    region: { name: "Самара" },
    category: { name: "Срочный заказ" },
    customer: { name: "ООО РемСнаб", user: { telegramId: "7001006" } },
    carrier: { fullName: "Дамир Нуриев", user: { telegramId: "8002004" } },
  },
];

const demoOrderHistory: AdminOrder[] = [
  {
    id: 2078,
    status: "COMPLETED",
    routeFrom: "Казань, Лаишевский узел",
    routeTo: "Ульяновск, Московское шоссе 15",
    date: "2026-05-15T16:00:00.000Z",
    price: 33800,
    pickupEtaText: "1 час",
    vehicleType: "TRAILER",
    createdAt: "2026-05-15T12:30:00.000Z",
    region: { name: "Казань" },
    category: { name: "Перевозка техники" },
    customer: { name: "ООО ВолгаСтрой", user: { telegramId: "7001007" } },
    carrier: { fullName: "Ильгиз Хисматуллин", user: { telegramId: "8002005" } },
  },
  {
    id: 2077,
    status: "IN_PROGRESS",
    routeFrom: "Самара, Курумоч",
    routeTo: "Самара, Novotel",
    date: "2026-05-16T08:10:00.000Z",
    price: 12400,
    pickupEtaText: "20 мин",
    vehicleType: "MINIVAN",
    createdAt: "2026-05-15T11:10:00.000Z",
    region: { name: "Самара" },
    category: { name: "Трансфер" },
    customer: { name: "Aero Travel", user: { telegramId: "7001008" } },
    carrier: { fullName: "Ильдар Сафин", user: { telegramId: "8002001" } },
  },
  {
    id: 2076,
    status: "ACCEPTED",
    routeFrom: "Уфа, ул. Комсомольская 112",
    routeTo: "Белебей, Промышленная 5",
    date: "2026-05-16T11:00:00.000Z",
    price: 17600,
    pickupEtaText: "50 мин",
    vehicleType: "TRUCK",
    createdAt: "2026-05-15T10:25:00.000Z",
    region: { name: "Уфа" },
    category: { name: "Доставка груза" },
    customer: { name: "ООО БашМетСнаб", user: { telegramId: "7001009" } },
    carrier: { fullName: "Дамир Нуриев", user: { telegramId: "8002004" } },
  },
  {
    id: 2075,
    status: "COMPLETED",
    routeFrom: "Иннополис, Технопарк",
    routeTo: "Казань, ул. Баумана 54",
    date: "2026-05-15T18:30:00.000Z",
    price: 9600,
    pickupEtaText: "15 мин",
    vehicleType: "CAR",
    createdAt: "2026-05-15T09:15:00.000Z",
    region: { name: "Казань" },
    category: { name: "Город" },
    customer: { name: "ООО НейроСистемы", user: { telegramId: "7001010" } },
    carrier: { fullName: "Линар Галеев", user: { telegramId: "8002006" } },
  },
  {
    id: 2074,
    status: "COMPLETED",
    routeFrom: "Самара, ул. Демократическая 57",
    routeTo: "Новокуйбышевск, ул. Миронова 10",
    date: "2026-05-15T14:15:00.000Z",
    price: 15400,
    pickupEtaText: "25 мин",
    vehicleType: "MINIBUS",
    createdAt: "2026-05-15T08:05:00.000Z",
    region: { name: "Самара" },
    category: { name: "Корпоративная перевозка" },
    customer: { name: "ООО ВолгаРесурс", user: { telegramId: "7001011" } },
    carrier: { fullName: "Марат Галиев", user: { telegramId: "8002007" } },
  },
  {
    id: 2073,
    status: "CANCELLED",
    routeFrom: "Уфа, Монумент Дружбы",
    routeTo: "Уфа, ВДНХ-Экспо",
    date: "2026-05-15T07:45:00.000Z",
    price: 11200,
    pickupEtaText: "30 мин",
    vehicleType: "MINIBUS",
    createdAt: "2026-05-15T07:05:00.000Z",
    region: { name: "Уфа" },
    category: { name: "Туризм" },
    customer: { name: "Expo Standart", user: { telegramId: "7001012" } },
    carrier: { fullName: "Руслан Яппаров", user: { telegramId: "8002002" } },
  },
  {
    id: 2072,
    status: "COMPLETED",
    routeFrom: "Казань, склад Озон",
    routeTo: "Йошкар-Ола, склад 9",
    date: "2026-05-15T05:40:00.000Z",
    price: 26800,
    pickupEtaText: "40 мин",
    vehicleType: "GAZELLE",
    createdAt: "2026-05-15T04:30:00.000Z",
    region: { name: "Казань" },
    category: { name: "Доставка груза" },
    customer: { name: "ООО МегаФулфилмент", user: { telegramId: "7001013" } },
    carrier: { fullName: "Артур Каримов", user: { telegramId: "8002003" } },
  },
  {
    id: 2071,
    status: "IN_PROGRESS",
    routeFrom: "Самара, выставочный центр Экспо-Волга",
    routeTo: "Самара, отель Лотте",
    date: "2026-05-16T06:00:00.000Z",
    price: 19600,
    pickupEtaText: "на площадке",
    vehicleType: "BUS",
    createdAt: "2026-05-15T03:55:00.000Z",
    region: { name: "Самара" },
    category: { name: "Корпоративная перевозка" },
    customer: { name: "Forum Event", user: { telegramId: "7001014" } },
    carrier: { fullName: "Марат Галиев", user: { telegramId: "8002007" } },
  },
];

const demoPendingCarriers: AdminCarrier[] = [
  {
    id: 401,
    status: "PENDING_APPROVAL",
    fullName: "Айдар Шакиров",
    brand: "Mercedes Sprinter",
    vehicleType: "MINIBUS",
    capacity: 19,
    plateNumber: "А321ТР116",
    description: "Корпоративные выезды и междугородние поездки",
    region: { name: "Казань" },
    carrierRegions: [{ region: { name: "Казань" } }, { region: { name: "Иннополис" } }],
    vehicles: [
      { id: 9001, type: "MINIBUS", isActive: true },
      { id: 9002, type: "MINIVAN", isActive: true },
    ],
    user: { telegramId: "8103001", phone: "+7 927 420-11-88" },
  },
  {
    id: 402,
    status: "PENDING_APPROVAL",
    fullName: "Роман Фаттахов",
    brand: "Ford Transit",
    vehicleType: "BUS",
    capacity: 28,
    plateNumber: "О541НА163",
    description: "Развозка сотрудников и мероприятия",
    region: { name: "Самара" },
    carrierRegions: [{ region: { name: "Самара" } }, { region: { name: "Тольятти" } }],
    vehicles: [{ id: 9003, type: "BUS", isActive: true }],
    user: { telegramId: "8103002", phone: "+7 927 009-42-18" },
  },
  {
    id: 403,
    status: "PENDING_APPROVAL",
    fullName: "Тимур Хабиров",
    brand: "ГАЗель Next",
    vehicleType: "GAZELLE",
    capacity: 1500,
    plateNumber: "К781ХС102",
    description: "Срочные городские и межгородские доставки",
    region: { name: "Уфа" },
    carrierRegions: [{ region: { name: "Уфа" } }, { region: { name: "Стерлитамак" } }],
    vehicles: [{ id: 9004, type: "GAZELLE", isActive: true }],
    user: { telegramId: "8103003", phone: "+7 927 315-27-04" },
  },
  {
    id: 404,
    status: "PENDING_APPROVAL",
    fullName: "Марат Усманов",
    brand: "Scania R",
    vehicleType: "TRAILER",
    capacity: 20000,
    plateNumber: "Т221РЕ116",
    description: "Федеральные грузовые рейсы по Поволжью",
    region: { name: "Казань" },
    carrierRegions: [{ region: { name: "Казань" } }, { region: { name: "Самара" } }, { region: { name: "Уфа" } }],
    vehicles: [
      { id: 9005, type: "TRAILER", isActive: true },
      { id: 9006, type: "TRUCK", isActive: true },
    ],
    user: { telegramId: "8103004", phone: "+7 903 340-55-21" },
  },
  {
    id: 405,
    status: "PENDING_APPROVAL",
    fullName: "Ирек Миннуллин",
    brand: "Toyota Camry",
    vehicleType: "CAR",
    capacity: 3,
    plateNumber: "М713РУ116",
    description: "VIP-трансферы и аэропортовые подачи",
    region: { name: "Казань" },
    carrierRegions: [{ region: { name: "Казань" } }],
    vehicles: [{ id: 9007, type: "CAR", isActive: true }],
    user: { telegramId: "8103005", phone: "+7 917 262-88-17" },
  },
  {
    id: 406,
    status: "PENDING_APPROVAL",
    fullName: "Азамат Ялалов",
    brand: "Hyundai County",
    vehicleType: "MINIBUS",
    capacity: 18,
    plateNumber: "Е334ТА102",
    description: "Школьные и корпоративные перевозки",
    region: { name: "Уфа" },
    carrierRegions: [{ region: { name: "Уфа" } }, { region: { name: "Салават" } }],
    vehicles: [{ id: 9008, type: "MINIBUS", isActive: true }],
    user: { telegramId: "8103006", phone: "+7 987 100-44-39" },
  },
];

const demoAllCarriers: AdminCarrier[] = [
  {
    id: 301,
    status: "APPROVED",
    fullName: "Ильдар Сафин",
    brand: "Mercedes Vito",
    vehicleType: "MINIVAN",
    capacity: 7,
    plateNumber: "А617МР163",
    description: "Трансферы, деловые поездки и межгород",
    region: { name: "Самара" },
    carrierRegions: [{ region: { name: "Самара" } }, { region: { name: "Тольятти" } }],
    vehicles: [{ id: 8801, type: "MINIVAN", isActive: true }],
    user: { telegramId: "8002001", phone: "+7 927 410-20-01" },
  },
  {
    id: 302,
    status: "APPROVED",
    fullName: "Руслан Яппаров",
    brand: "Yutong",
    vehicleType: "BUS",
    capacity: 45,
    plateNumber: "Е784ОС102",
    description: "Групповые перевозки и аэропортовые подачи",
    region: { name: "Уфа" },
    carrierRegions: [{ region: { name: "Уфа" } }, { region: { name: "Стерлитамак" } }, { region: { name: "Салават" } }],
    vehicles: [
      { id: 8802, type: "BUS", isActive: true },
      { id: 8803, type: "MINIBUS", isActive: true },
    ],
    user: { telegramId: "8002002", phone: "+7 917 555-21-18" },
  },
  {
    id: 303,
    status: "APPROVED",
    fullName: "Артур Каримов",
    brand: "ГАЗель Next",
    vehicleType: "GAZELLE",
    capacity: 1500,
    plateNumber: "М901ТА116",
    description: "Городская доставка и срочные рейсы",
    region: { name: "Казань" },
    carrierRegions: [{ region: { name: "Казань" } }, { region: { name: "Иннополис" } }],
    vehicles: [{ id: 8804, type: "GAZELLE", isActive: true }],
    user: { telegramId: "8002003", phone: "+7 927 310-14-55" },
  },
  {
    id: 304,
    status: "APPROVED",
    fullName: "Дамир Нуриев",
    brand: "MAN TGS",
    vehicleType: "TRUCK",
    capacity: 10000,
    plateNumber: "К541НР163",
    description: "Региональные грузовые рейсы",
    region: { name: "Самара" },
    carrierRegions: [{ region: { name: "Самара" } }, { region: { name: "Ульяновск" } }],
    vehicles: [{ id: 8805, type: "TRUCK", isActive: true }],
    user: { telegramId: "8002004", phone: "+7 927 201-88-10" },
  },
  {
    id: 305,
    status: "APPROVED",
    fullName: "Ильгиз Хисматуллин",
    brand: "Scania R",
    vehicleType: "TRAILER",
    capacity: 20000,
    plateNumber: "Т111ТР116",
    description: "Дальние грузовые маршруты по Поволжью",
    region: { name: "Казань" },
    carrierRegions: [{ region: { name: "Казань" } }, { region: { name: "Самара" } }, { region: { name: "Уфа" } }],
    vehicles: [
      { id: 8806, type: "TRAILER", isActive: true },
      { id: 8807, type: "TRUCK", isActive: true },
    ],
    user: { telegramId: "8002005", phone: "+7 927 661-44-80" },
  },
  {
    id: 306,
    status: "APPROVED",
    fullName: "Линар Галеев",
    brand: "Toyota Camry",
    vehicleType: "CAR",
    capacity: 3,
    plateNumber: "В505СК116",
    description: "VIP-подачи и поездки по городу",
    region: { name: "Казань" },
    carrierRegions: [{ region: { name: "Казань" } }],
    vehicles: [{ id: 8808, type: "CAR", isActive: true }],
    user: { telegramId: "8002006", phone: "+7 927 880-22-16" },
  },
  {
    id: 307,
    status: "APPROVED",
    fullName: "Марат Галиев",
    brand: "Ford Transit",
    vehicleType: "BUS",
    capacity: 22,
    plateNumber: "О441МУ163",
    description: "Корпоративные выезды и экскурсионка",
    region: { name: "Самара" },
    carrierRegions: [{ region: { name: "Самара" } }, { region: { name: "Тольятти" } }],
    vehicles: [{ id: 8809, type: "BUS", isActive: true }],
    user: { telegramId: "8002007", phone: "+7 927 441-00-71" },
  },
  {
    id: 308,
    status: "REJECTED",
    fullName: "Рустем Сафаров",
    brand: "Peugeot Boxer",
    vehicleType: "MINIBUS",
    capacity: 17,
    plateNumber: "Р444АВ116",
    description: "Заявка отклонена по документам",
    region: { name: "Казань" },
    carrierRegions: [{ region: { name: "Казань" } }],
    vehicles: [{ id: 8810, type: "MINIBUS", isActive: false }],
    user: { telegramId: "8103101", phone: "+7 917 444-10-22" },
  },
  {
    id: 309,
    status: "BANNED",
    fullName: "Алексей Мартынов",
    brand: "Hyundai Porter",
    vehicleType: "TRUCK",
    capacity: 1200,
    plateNumber: "Н098МС163",
    description: "Доступ закрыт после жалоб",
    region: { name: "Самара" },
    carrierRegions: [{ region: { name: "Самара" } }],
    vehicles: [{ id: 8811, type: "TRUCK", isActive: false }],
    user: { telegramId: "8103102", phone: "+7 927 098-33-11" },
  },
  ...demoPendingCarriers,
];

const fallbackData: AdminDashboardData = {
  mode: "fallback",
  baseUrl: "http://127.0.0.1:3000/admin",
  overview: {
    generatedAt: "2026-05-16T08:10:00.000Z",
    health: {
      telegramEnabled: true,
      useWebhook: false,
      useRedisQueue: true,
    },
    security: {
      otpEnabled: true,
      accessTokenTtlMinutes: 15,
      refreshTokenTtlHours: 720,
      activeMobileSessions: 18,
      protectedDevices: 14,
      challengesLast24h: 37,
      revokedSessionsLast24h: 5,
    },
    orders: {
      total: 128,
      new: 19,
      awaitingDeposit: 4,
      accepted: 21,
      inProgress: 14,
      completed: 63,
      cancelled: 11,
      depositPendingVerification: 2,
      averagePrice: 18450,
      grossVolume: 2361600,
    },
    carriers: {
      total: 54,
      pending: 6,
      approved: 38,
      rejected: 4,
      banned: 6,
    },
    catalog: {
      customers: 76,
      regions: 7,
      categories: 8,
      pricingRules: demoPricingRules.length,
    },
  },
  recentOrders: demoRecentOrders,
  orderHistory: demoOrderHistory,
  depositPendingOrders: demoRecentOrders
    .filter((order) => order.status === "NEW")
    .slice(0, 2)
    .map((order, index) => ({
      ...order,
      status: "AWAITING_DEPOSIT",
      depositAmount: index === 0 ? 1850 : 2760,
      depositStatus: index === 0 ? "PENDING_VERIFICATION" : "PENDING_PAYMENT",
      depositReference: index === 0 ? "SBP-20260519-4401" : "manual-transfer",
    })),
  pendingCarriers: demoPendingCarriers,
  allCarriers: demoAllCarriers,
  pricingRules: demoPricingRules,
};

const resolveAdminConfig = () => {
  const baseUrl = readServerEnv("ADMIN_API_URL") ?? "http://127.0.0.1:3000/admin";
  const secret = readServerEnv("ADMIN_API_SECRET") ?? readServerEnv("ADMIN_SECRET") ?? "";

  return { baseUrl, secret };
};

const parseAdminPayload = <T>(raw: string): ({ error?: string } & T) | null => {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as { error?: string } & T;
  } catch {
    return null;
  }
};

const fetchAdminJson = async <T>(baseUrl: string, secret: string, endpoint: string): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1800);

  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-admin-secret": secret,
      },
      cache: "no-store",
      signal: controller.signal,
    });

    const text = await response.text();
    const payload = parseAdminPayload<T>(text);

    if (!response.ok) {
      const message = payload?.error ?? (text.trim() || `Admin API responded with ${response.status}`);
      throw new Error(message);
    }

    if (payload) {
      return payload as T;
    }

    throw new Error("Admin API returned an empty response");
  } finally {
    clearTimeout(timeout);
  }
};

export const getAdminDashboardData = async (): Promise<AdminDashboardData> => {
  const { baseUrl, secret } = resolveAdminConfig();

  if (!secret) {
    return {
      ...fallbackData,
      baseUrl,
      fallbackReason: "ADMIN_API_SECRET or ADMIN_SECRET is not configured.",
    };
  }

  try {
    const [overview, recentOrders, orderHistory, depositPendingOrders, pendingCarriers, allCarriers, pricingRules] = await Promise.all([
      fetchAdminJson<AdminOverview>(baseUrl, secret, "/overview"),
      fetchAdminJson<AdminOrder[]>(baseUrl, secret, "/orders/recent?limit=6"),
      fetchAdminJson<AdminOrder[]>(baseUrl, secret, "/orders/history?limit=8"),
      fetchAdminJson<AdminOrder[]>(baseUrl, secret, "/orders/deposit-pending?limit=6"),
      fetchAdminJson<AdminCarrier[]>(baseUrl, secret, "/carriers/pending?limit=6"),
      fetchAdminJson<AdminCarrier[]>(baseUrl, secret, "/carriers"),
      fetchAdminJson<PricingRule[]>(baseUrl, secret, "/pricing"),
    ]);

    return {
      mode: "live",
      baseUrl,
      overview,
      recentOrders,
      orderHistory,
      depositPendingOrders,
      pendingCarriers,
      allCarriers,
      pricingRules,
    };
  } catch (error) {
    return {
      ...fallbackData,
      baseUrl,
      fallbackReason: error instanceof Error ? error.message : "Admin API is unavailable.",
    };
  }
};
