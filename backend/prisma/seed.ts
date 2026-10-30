import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

const envCandidates = [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")];

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

const prisma = new PrismaClient();

const regions = ["Казань", "Самара", "Уфа"];
const categories = [
  "Межгород",
  "Город",
  "Трансфер",
  "Корпоративная перевозка",
  "Туризм",
  "Доставка груза",
  "Перевозка техники",
  "Срочный заказ",
];

const pricingRules = [
  { vehicleType: "CAR", basePrice: 450, pricePerKm: 24, pricePerHour: 650, minPrice: 1800 },
  { vehicleType: "MINIVAN", basePrice: 650, pricePerKm: 30, pricePerHour: 850, minPrice: 2600 },
  { vehicleType: "MINIBUS", basePrice: 980, pricePerKm: 42, pricePerHour: 1200, minPrice: 4200 },
  { vehicleType: "BUS", basePrice: 1400, pricePerKm: 58, pricePerHour: 1650, minPrice: 6200 },
  { vehicleType: "GAZELLE", basePrice: 720, pricePerKm: 29, pricePerHour: 820, minPrice: 2400 },
  { vehicleType: "TRUCK", basePrice: 1100, pricePerKm: 43, pricePerHour: 1280, minPrice: 3900 },
  { vehicleType: "TRAILER", basePrice: 1650, pricePerKm: 67, pricePerHour: 1950, minPrice: 6200 },
  { vehicleType: "SPECIAL", basePrice: 2400, pricePerKm: 88, pricePerHour: 2550, minPrice: 8400 },
];

const demoCustomers = [
  { telegramId: 7001001, phone: "+7 917 100-10-01", name: "ООО Волга Софт" },
  { telegramId: 7001002, phone: "+7 917 100-10-02", name: "ООО СамараТех" },
  { telegramId: 7001003, phone: "+7 917 100-10-03", name: "Event Ufa" },
  { telegramId: 7001004, phone: "+7 917 100-10-04", name: "ООО ТехноПак" },
  { telegramId: 7001005, phone: "+7 917 100-10-05", name: "Travel Point" },
  { telegramId: 7001006, phone: "+7 917 100-10-06", name: "ООО РемСнаб" },
  { telegramId: 7001007, phone: "+7 917 100-10-07", name: "ООО ВолгаСтрой" },
  { telegramId: 7001008, phone: "+7 917 100-10-08", name: "Aero Travel" },
];

const demoCarriers = [
  {
    telegramId: 8002001,
    phone: "+7 927 420-11-88",
    status: "APPROVED",
    fullName: "Ильдар Сафин",
    regionName: "Самара",
    regionNames: ["Самара", "Уфа"],
    vehicleType: "MINIVAN",
    brand: "Mercedes Vito",
    capacity: 6,
    plateNumber: "А777КК163",
    description: "Межгород и деловые трансферы",
    vehicles: [
      { type: "MINIVAN", brand: "Mercedes Vito", plateNumber: "А777КК163", capacity: 6, description: "Комфорт для командировок" },
      { type: "CAR", brand: "Toyota Camry", plateNumber: "Р144МТ163", capacity: 3, description: "Индивидуальные трансферы" },
    ],
  },
  {
    telegramId: 8002002,
    phone: "+7 927 315-27-04",
    status: "APPROVED",
    fullName: "Руслан Яппаров",
    regionName: "Уфа",
    regionNames: ["Уфа", "Самара"],
    vehicleType: "BUS",
    brand: "Yutong ZK6122",
    capacity: 49,
    plateNumber: "В500УР102",
    description: "Экскурсии, трансферы, корпоративные рейсы",
    vehicles: [
      { type: "BUS", brand: "Yutong ZK6122", plateNumber: "В500УР102", capacity: 49, description: "Полноразмерный автобус" },
      { type: "MINIBUS", brand: "Hyundai County", plateNumber: "О331ЕР102", capacity: 18, description: "Небольшие группы" },
    ],
  },
  {
    telegramId: 8002003,
    phone: "+7 903 340-55-21",
    status: "APPROVED",
    fullName: "Артур Каримов",
    regionName: "Казань",
    regionNames: ["Казань", "Самара"],
    vehicleType: "GAZELLE",
    brand: "ГАЗель Next",
    capacity: 1500,
    plateNumber: "М745ОК116",
    description: "Городские и межгородские грузовые заявки",
    vehicles: [{ type: "GAZELLE", brand: "ГАЗель Next", plateNumber: "М745ОК116", capacity: 1500, description: "Тент, до 16 м3" }],
  },
  {
    telegramId: 8002004,
    phone: "+7 917 555-77-44",
    status: "APPROVED",
    fullName: "Дамир Нуриев",
    regionName: "Уфа",
    regionNames: ["Уфа", "Казань"],
    vehicleType: "TRUCK",
    brand: "MAN TGS",
    capacity: 10000,
    plateNumber: "Е900МХ102",
    description: "Региональная доставка и срочные коммерческие рейсы",
    vehicles: [{ type: "TRUCK", brand: "MAN TGS", plateNumber: "Е900МХ102", capacity: 10000, description: "10 тонн, шторный кузов" }],
  },
  {
    telegramId: 8002005,
    phone: "+7 927 100-55-66",
    status: "APPROVED",
    fullName: "Ильгиз Хисматуллин",
    regionName: "Казань",
    regionNames: ["Казань", "Самара", "Уфа"],
    vehicleType: "TRAILER",
    brand: "Scania R",
    capacity: 20000,
    plateNumber: "Т221РЕ116",
    description: "Федеральные грузовые рейсы по Поволжью",
    vehicles: [{ type: "TRAILER", brand: "Scania R", plateNumber: "Т221РЕ116", capacity: 20000, description: "Фура 20 тонн" }],
  },
  {
    telegramId: 8002006,
    phone: "+7 987 222-88-16",
    status: "APPROVED",
    fullName: "Линар Галеев",
    regionName: "Казань",
    regionNames: ["Казань"],
    vehicleType: "CAR",
    brand: "Toyota Camry",
    capacity: 3,
    plateNumber: "М713РУ116",
    description: "VIP-трансферы и сопровождение гостей",
    vehicles: [{ type: "CAR", brand: "Toyota Camry", plateNumber: "М713РУ116", capacity: 3, description: "Комфорт-класс" }],
  },
  {
    telegramId: 8002007,
    phone: "+7 927 009-42-18",
    status: "APPROVED",
    fullName: "Марат Галиев",
    regionName: "Самара",
    regionNames: ["Самара", "Казань"],
    vehicleType: "MINIBUS",
    brand: "Ford Transit",
    capacity: 19,
    plateNumber: "О541НА163",
    description: "Корпоративная развозка и мероприятия",
    vehicles: [
      { type: "MINIBUS", brand: "Ford Transit", plateNumber: "О541НА163", capacity: 19, description: "Трансферы и корпоративные выезды" },
      { type: "BUS", brand: "King Long", plateNumber: "Р411ТХ163", capacity: 35, description: "Групповые поездки" },
    ],
  },
  {
    telegramId: 8103001,
    phone: "+7 987 100-44-39",
    status: "PENDING_APPROVAL",
    fullName: "Азамат Ялалов",
    regionName: "Уфа",
    regionNames: ["Уфа"],
    vehicleType: "MINIBUS",
    brand: "Hyundai County",
    capacity: 18,
    plateNumber: "Е334ТА102",
    description: "Школьные и корпоративные перевозки",
    vehicles: [{ type: "MINIBUS", brand: "Hyundai County", plateNumber: "Е334ТА102", capacity: 18, description: "18 мест" }],
  },
  {
    telegramId: 8103002,
    phone: "+7 927 777-10-10",
    status: "PENDING_APPROVAL",
    fullName: "Тимур Хабиров",
    regionName: "Уфа",
    regionNames: ["Уфа", "Самара"],
    vehicleType: "GAZELLE",
    brand: "ГАЗель Next",
    capacity: 1200,
    plateNumber: "К781ХС102",
    description: "Срочные городские и межгородские доставки",
    vehicles: [{ type: "GAZELLE", brand: "ГАЗель Next", plateNumber: "К781ХС102", capacity: 1200, description: "Тент, 12 м3" }],
  },
  {
    telegramId: 8103003,
    phone: "+7 917 555-12-45",
    status: "PENDING_APPROVAL",
    fullName: "Айдар Шакиров",
    regionName: "Казань",
    regionNames: ["Казань"],
    vehicleType: "MINIBUS",
    brand: "Mercedes Sprinter",
    capacity: 19,
    plateNumber: "А321ТР116",
    description: "Корпоративные выезды и междугородние поездки",
    vehicles: [{ type: "MINIBUS", brand: "Mercedes Sprinter", plateNumber: "А321ТР116", capacity: 19, description: "19 мест" }],
  },
];

const demoOrders = [
  {
    customerTelegramId: 7001001,
    carrierTelegramId: null,
    regionName: "Казань",
    categoryName: "Корпоративная перевозка",
    vehicleType: "MINIBUS",
    status: "NEW",
    routeFrom: "Казань, IT-парк им. Башира Рамеева",
    routeTo: "Иннополис, Университет Иннополис",
    date: "2026-05-17T06:30:00.000Z",
    createdAt: "2026-05-16T07:40:00.000Z",
    price: 18500,
    suggestedPrice: 17800,
    estimatedDistanceKm: 40,
    estimatedDurationHours: 1.1,
    pickupEtaText: "20 мин",
    comment: "Нужна безналичная оплата по счету",
    adultsCount: 18,
    childrenCount: 0,
    passengersCount: 18,
  },
  {
    customerTelegramId: 7001002,
    carrierTelegramId: 8002001,
    regionName: "Самара",
    categoryName: "Межгород",
    vehicleType: "MINIVAN",
    status: "ACCEPTED",
    routeFrom: "Самара, Московское шоссе 4",
    routeTo: "Тольятти, Южное шоссе 165",
    date: "2026-05-16T09:00:00.000Z",
    createdAt: "2026-05-16T07:20:00.000Z",
    price: 14200,
    suggestedPrice: 13750,
    estimatedDistanceKm: 93,
    estimatedDurationHours: 1.7,
    pickupEtaText: "35 мин",
    comment: "Встреча делегации из 5 человек",
    adultsCount: 5,
    childrenCount: 0,
    passengersCount: 5,
  },
  {
    customerTelegramId: 7001003,
    carrierTelegramId: 8002002,
    regionName: "Уфа",
    categoryName: "Трансфер",
    vehicleType: "BUS",
    status: "IN_PROGRESS",
    routeFrom: "Уфа, аэропорт",
    routeTo: "Стерлитамак, ул. Мира 1",
    date: "2026-05-16T05:30:00.000Z",
    createdAt: "2026-05-16T05:00:00.000Z",
    price: 21900,
    suggestedPrice: 21150,
    estimatedDistanceKm: 128,
    estimatedDurationHours: 2.2,
    pickupEtaText: "на линии",
    comment: "Группа после прилета, 24 человека",
    adultsCount: 24,
    childrenCount: 0,
    passengersCount: 24,
  },
  {
    customerTelegramId: 7001004,
    carrierTelegramId: 8002003,
    regionName: "Казань",
    categoryName: "Доставка груза",
    vehicleType: "GAZELLE",
    status: "COMPLETED",
    routeFrom: "Казань, ул. Тэцевская 1",
    routeTo: "Набережные Челны, Промзона 12",
    date: "2026-05-16T04:10:00.000Z",
    createdAt: "2026-05-16T03:20:00.000Z",
    price: 24800,
    suggestedPrice: 23600,
    estimatedDistanceKm: 236,
    estimatedDurationHours: 3.6,
    pickupEtaText: "45 мин",
    comment: "Паллетированный груз, нужна закрытая машина",
    cargoDescription: "Паллетированный груз",
    weight: 760,
    volume: 11,
  },
  {
    customerTelegramId: 7001005,
    carrierTelegramId: null,
    regionName: "Казань",
    categoryName: "Туризм",
    vehicleType: "BUS",
    status: "NEW",
    routeFrom: "Казань Экспо",
    routeTo: "Казань, отель Ривьера",
    date: "2026-05-17T14:30:00.000Z",
    createdAt: "2026-05-16T02:40:00.000Z",
    price: 27600,
    suggestedPrice: 26800,
    estimatedDistanceKm: 32,
    estimatedDurationHours: 1,
    pickupEtaText: "30 мин",
    comment: "Группа 32 человека, нужен автобус туристического класса",
    adultsCount: 32,
    childrenCount: 0,
    passengersCount: 32,
  },
  {
    customerTelegramId: 7001006,
    carrierTelegramId: 8002004,
    regionName: "Самара",
    categoryName: "Срочный заказ",
    vehicleType: "TRUCK",
    status: "CANCELLED",
    routeFrom: "Самара, Заводское шоссе 17",
    routeTo: "Самара, Красноглинское шоссе 2",
    date: "2026-05-16T01:00:00.000Z",
    createdAt: "2026-05-15T23:40:00.000Z",
    price: 8700,
    suggestedPrice: 8400,
    estimatedDistanceKm: 27,
    estimatedDurationHours: 0.9,
    pickupEtaText: "15 мин",
    comment: "Срочная переброска оборудования",
    cargoDescription: "Промышленное оборудование",
    weight: 1800,
    volume: 5,
  },
  {
    customerTelegramId: 7001007,
    carrierTelegramId: 8002005,
    regionName: "Казань",
    categoryName: "Перевозка техники",
    vehicleType: "TRAILER",
    status: "COMPLETED",
    routeFrom: "Казань, Лаишевский узел",
    routeTo: "Ульяновск, Московское шоссе 15",
    date: "2026-05-15T16:00:00.000Z",
    createdAt: "2026-05-15T12:30:00.000Z",
    price: 33800,
    suggestedPrice: 32700,
    estimatedDistanceKm: 230,
    estimatedDurationHours: 4,
    pickupEtaText: "1 час",
    comment: "Нужна фиксация техники и опытный водитель",
    cargoDescription: "Строительная техника",
    weight: 5300,
    volume: 18,
  },
  {
    customerTelegramId: 7001008,
    carrierTelegramId: 8002007,
    regionName: "Самара",
    categoryName: "Корпоративная перевозка",
    vehicleType: "MINIBUS",
    status: "COMPLETED",
    routeFrom: "Самара, ул. Демократическая 57",
    routeTo: "Новокуйбышевск, ул. Миронова 10",
    date: "2026-05-15T14:15:00.000Z",
    createdAt: "2026-05-15T08:05:00.000Z",
    price: 15400,
    suggestedPrice: 14800,
    estimatedDistanceKm: 58,
    estimatedDurationHours: 1.4,
    pickupEtaText: "25 мин",
    comment: "Развозка смены после мероприятия",
    adultsCount: 16,
    childrenCount: 0,
    passengersCount: 16,
  },
];

async function upsertUser(telegramId: number, role: string, phone?: string) {
  return prisma.user.upsert({
    where: { telegramId: BigInt(telegramId) },
    update: { role, phone },
    create: { telegramId: BigInt(telegramId), role, phone },
  });
}

async function main() {
  const regionMap = new Map<string, number>();
  const categoryMap = new Map<string, number>();
  const customerMap = new Map<number, { id: number }>();
  const carrierMap = new Map<number, { id: number; vehicles: Array<{ id: number; type: string }> }>();

  for (const name of regions) {
    const region = await prisma.region.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    regionMap.set(name, region.id);
  }

  for (const name of categories) {
    const category = await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    categoryMap.set(name, category.id);
  }

  for (const rule of pricingRules) {
    await prisma.pricingRule.upsert({
      where: { vehicleType: rule.vehicleType },
      update: rule,
      create: rule,
    });
  }

  for (const customer of demoCustomers) {
    const user = await upsertUser(customer.telegramId, "CUSTOMER", customer.phone);
    const createdCustomer = await prisma.customer.upsert({
      where: { userId: user.id },
      update: { name: customer.name },
      create: { userId: user.id, name: customer.name },
    });
    customerMap.set(customer.telegramId, { id: createdCustomer.id });
  }

  for (const carrier of demoCarriers) {
    const user = await upsertUser(carrier.telegramId, "CARRIER", carrier.phone);
    const primaryRegionId = regionMap.get(carrier.regionName);

    if (!primaryRegionId) {
      throw new Error(`Unknown region: ${carrier.regionName}`);
    }

    const savedCarrier = await prisma.carrier.upsert({
      where: { userId: user.id },
      update: {
        status: carrier.status,
        fullName: carrier.fullName,
        regionId: primaryRegionId,
        vehicleType: carrier.vehicleType,
        brand: carrier.brand,
        capacity: carrier.capacity,
        plateNumber: carrier.plateNumber,
        description: carrier.description,
      },
      create: {
        userId: user.id,
        status: carrier.status,
        fullName: carrier.fullName,
        regionId: primaryRegionId,
        vehicleType: carrier.vehicleType,
        brand: carrier.brand,
        capacity: carrier.capacity,
        plateNumber: carrier.plateNumber,
        description: carrier.description,
      },
    });

    await prisma.carrierRegion.deleteMany({ where: { carrierId: savedCarrier.id } });
    await prisma.carrierRegion.createMany({
      data: carrier.regionNames
        .map((name) => regionMap.get(name))
        .filter((value): value is number => typeof value === "number")
        .map((regionId) => ({ carrierId: savedCarrier.id, regionId })),
    });

    await prisma.vehicle.deleteMany({ where: { carrierId: savedCarrier.id } });
    await prisma.vehicle.createMany({
      data: carrier.vehicles.map((vehicle) => ({
        carrierId: savedCarrier.id,
        type: vehicle.type,
        brand: vehicle.brand,
        plateNumber: vehicle.plateNumber,
        capacity: vehicle.capacity,
        description: vehicle.description,
        isActive: true,
      })),
    });

    const carrierWithVehicles = await prisma.carrier.findUniqueOrThrow({
      where: { id: savedCarrier.id },
      include: { vehicles: { select: { id: true, type: true } } },
    });

    carrierMap.set(carrier.telegramId, {
      id: carrierWithVehicles.id,
      vehicles: carrierWithVehicles.vehicles,
    });
  }

  const demoCustomerIds = Array.from(customerMap.values()).map((item) => item.id);
  await prisma.orderOffer.deleteMany({ where: { customerId: { in: demoCustomerIds } } });
  await prisma.order.deleteMany({ where: { customerId: { in: demoCustomerIds } } });

  for (const order of demoOrders) {
    const customer = customerMap.get(order.customerTelegramId);
    const regionId = regionMap.get(order.regionName);
    const categoryId = categoryMap.get(order.categoryName);

    if (!customer || !regionId || !categoryId) {
      throw new Error(`Unable to resolve order dependencies for customer ${order.customerTelegramId}`);
    }

    const carrier = order.carrierTelegramId ? carrierMap.get(order.carrierTelegramId) : undefined;
    const vehicleId = carrier?.vehicles.find((vehicle) => vehicle.type === order.vehicleType)?.id ?? carrier?.vehicles[0]?.id;

    await prisma.order.create({
      data: {
        customerId: customer.id,
        regionId,
        categoryId,
        vehicleType: order.vehicleType,
        status: order.status,
        routeFrom: order.routeFrom,
        routeTo: order.routeTo,
        date: new Date(order.date),
        price: order.price,
        suggestedPrice: order.suggestedPrice,
        estimatedDistanceKm: order.estimatedDistanceKm,
        estimatedDurationHours: order.estimatedDurationHours,
        pickupEtaText: order.pickupEtaText,
        comment: order.comment,
        adultsCount: "adultsCount" in order ? order.adultsCount ?? null : null,
        childrenCount: "childrenCount" in order ? order.childrenCount ?? null : null,
        passengersCount: "passengersCount" in order ? order.passengersCount ?? null : null,
        cargoDescription: "cargoDescription" in order ? order.cargoDescription ?? null : null,
        weight: "weight" in order ? order.weight ?? null : null,
        volume: "volume" in order ? order.volume ?? null : null,
        carrierId: carrier?.id,
        vehicleId,
        createdAt: new Date(order.createdAt),
      },
    });
  }

  const adminTelegramId = process.env.ADMIN_TELEGRAM_ID ? Number(process.env.ADMIN_TELEGRAM_ID) : null;
  if (adminTelegramId) {
    const user = await prisma.user.findUnique({ where: { telegramId: BigInt(adminTelegramId) } });
    if (user) {
      await prisma.admin.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id },
      });
    }
  }
}

main()
  .then(() => {
    console.log("Seed finished");
    return prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
