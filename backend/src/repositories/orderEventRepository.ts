import { prisma } from "../database/prisma";

export class OrderEventRepository {
  async create(data: {
    orderId: number;
    actorRole: string;
    actorLabel?: string | null;
    eventType: string;
    message: string;
    payload?: string | null;
  }) {
    return prisma.orderEvent.create({ data });
  }

  async createMany(
    items: Array<{
      orderId: number;
      actorRole: string;
      actorLabel?: string | null;
      eventType: string;
      message: string;
      payload?: string | null;
    }>
  ) {
    if (items.length === 0) {
      return { count: 0 };
    }

    return prisma.orderEvent.createMany({ data: items });
  }

  async listByOrderId(orderId: number, limit = 10) {
    return prisma.orderEvent.findMany({
      where: { orderId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }
}
