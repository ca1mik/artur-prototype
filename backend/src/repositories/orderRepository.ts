import { prisma } from "../database/prisma";

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

export class OrderRepository {
  async create(data: {
    customerId: number;
    regionId: number;
    categoryId: number;
    vehicleType: string;
    routeFrom: string;
    routeFromLat?: number;
    routeFromLng?: number;
    routeTo: string;
    routeToLat?: number;
    routeToLng?: number;
    date: Date;
    price: number;
    suggestedPrice?: number;
    estimatedDistanceKm?: number;
    estimatedDurationHours?: number;
    pickupEtaText?: string;
    comment?: string;
    adultsCount?: number;
    childrenCount?: number;
    passengersCount?: number;
    cargoDescription?: string;
    weight?: number;
    volume?: number;
  }) {
    return prisma.order.create({ data });
  }

  async findById(id: number) {
    return prisma.order.findUnique({
      where: { id },
      include: mobileOrderInclude,
    });
  }

  async listNew(limit?: number) {
    return prisma.order.findMany({
      where: { status: "NEW" },
      include: { customer: { include: { user: true } }, region: true, category: true },
      orderBy: { createdAt: "desc" },
      ...(limit ? { take: limit } : {}),
    });
  }

  async listOpenForCarrier(carrierId: number, limit = 12) {
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
        returnSourceOrder: mobileOrderInclude.returnSourceOrder,
        returnOrders: mobileOrderInclude.returnOrders,
        offers: {
          where: { carrierId },
          include: {
            carrier: { include: { user: true, vehicles: true } },
            customer: { include: { user: true } },
          },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
        events: mobileOrderInclude.events,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return orders.filter((order) => {
      const minimumCapacity = order.passengersCount ?? 1;
      return activeVehicles.some(
        (vehicle) => vehicle.type === order.vehicleType && (vehicle.capacity == null || vehicle.capacity >= minimumCapacity)
      );
    });
  }

  async listRecent(limit = 10) {
    return prisma.order.findMany({
      include: {
        customer: { include: { user: true } },
        region: true,
        category: true,
        carrier: { include: { user: true } },
        vehicle: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  async listAssignedHistory(limit = 20) {
    return prisma.order.findMany({
      where: {
        carrierId: { not: null },
      },
      include: {
        customer: { include: { user: true } },
        region: true,
        category: true,
        carrier: { include: { user: true } },
        vehicle: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  async listDepositPendingVerification(limit = 20) {
    return prisma.order.findMany({
      where: {
        status: "AWAITING_DEPOSIT",
        depositStatus: "PENDING_VERIFICATION",
      },
      include: mobileOrderInclude,
      orderBy: { depositSubmittedAt: "desc" },
      take: limit,
    });
  }

  async listByCarrierId(carrierId: number) {
    return prisma.order.findMany({
      where: { carrierId },
      include: mobileOrderInclude,
      orderBy: { createdAt: "desc" },
    });
  }

  async listActiveByCarrierId(carrierId: number) {
    return prisma.order.findMany({
      where: { carrierId, status: { in: ["AWAITING_DEPOSIT", "ACCEPTED", "IN_PROGRESS"] } },
      include: mobileOrderInclude,
      orderBy: { createdAt: "desc" },
    });
  }

  async listHistoryByCarrierId(carrierId: number) {
    return prisma.order.findMany({
      where: { carrierId, status: { in: ["COMPLETED", "CANCELLED"] } },
      include: mobileOrderInclude,
      orderBy: { createdAt: "desc" },
    });
  }

  async findCarrierOrder(orderId: number, carrierId: number) {
    return prisma.order.findFirst({
      where: { id: orderId, carrierId },
      include: mobileOrderInclude,
    });
  }

  async findCustomerOrder(orderId: number, customerId: number) {
    return prisma.order.findFirst({
      where: { id: orderId, customerId },
      include: mobileOrderInclude,
    });
  }

  async accept(
    orderId: number,
    carrierId: number,
    vehicleId?: number,
    options?: {
      price?: number;
      pickupEtaText?: string;
      vehicleBrandSnapshot?: string | null;
      vehiclePlateSnapshot?: string | null;
    }
  ) {
    return prisma.order.update({
      where: { id: orderId },
      data: {
        status: "ACCEPTED",
        carrierId,
        vehicleId,
        price: options?.price,
        pickupEtaText: options?.pickupEtaText,
        vehicleBrandSnapshot: options?.vehicleBrandSnapshot,
        vehiclePlateSnapshot: options?.vehiclePlateSnapshot,
      },
      include: mobileOrderInclude,
    });
  }

  async updateStatus(orderId: number, status: string) {
    return prisma.order.update({ where: { id: orderId }, data: { status } });
  }

  async updateCarrierOrderStatus(orderId: number, carrierId: number, status: string) {
    await prisma.order.updateMany({
      where: { id: orderId, carrierId },
      data: { status },
    });

    return prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: mobileOrderInclude,
    });
  }
}
