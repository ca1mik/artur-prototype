import { prisma } from "../database/prisma";

export class CustomerRepository {
  async findByUserId(userId: number) {
    return prisma.customer.findUnique({ where: { userId } });
  }

  async create(userId: number, name: string) {
    return prisma.customer.create({ data: { userId, name } });
  }

  async findOrders(customerId: number) {
    return prisma.order.findMany({
      where: { customerId },
      include: {
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
          orderBy: { createdAt: "desc" },
          take: 3,
        },
        offers: {
          include: {
            carrier: { include: { user: true, vehicles: true } },
            customer: { include: { user: true } },
          },
          orderBy: { updatedAt: "desc" },
        },
        events: {
          orderBy: { createdAt: "desc" },
          take: 6,
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }
}
