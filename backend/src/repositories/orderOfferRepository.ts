import { prisma } from "../database/prisma";

export class OrderOfferRepository {
  async upsert(data: {
    orderId: number;
    carrierId: number;
    customerId: number;
    proposedPrice: number;
    pickupEtaText?: string;
    note?: string;
    status?: string;
    lastActor: string;
  }) {
    return prisma.orderOffer.upsert({
      where: {
        orderId_carrierId: {
          orderId: data.orderId,
          carrierId: data.carrierId,
        },
      },
      create: data,
      update: {
        proposedPrice: data.proposedPrice,
        pickupEtaText: data.pickupEtaText,
        note: data.note,
        status: data.status ?? "ACTIVE",
        lastActor: data.lastActor,
      },
      include: {
        order: { include: { customer: { include: { user: true } }, region: true, category: true } },
        carrier: { include: { user: true } },
        customer: { include: { user: true } },
      },
    });
  }

  async findById(id: number) {
    return prisma.orderOffer.findUnique({
      where: { id },
      include: {
        order: {
          include: {
            customer: { include: { user: true } },
            region: true,
            category: true,
            vehicle: true,
          },
        },
        carrier: { include: { user: true, vehicles: true } },
        customer: { include: { user: true } },
      },
    });
  }

  async update(id: number, data: { proposedPrice?: number; pickupEtaText?: string | null; note?: string | null; status?: string; lastActor?: string }) {
    return prisma.orderOffer.update({
      where: { id },
      data,
      include: {
        order: {
          include: {
            customer: { include: { user: true } },
            region: true,
            category: true,
            vehicle: true,
          },
        },
        carrier: { include: { user: true, vehicles: true } },
        customer: { include: { user: true } },
      },
    });
  }

  async rejectOthers(orderId: number, exceptCarrierId: number) {
    await prisma.orderOffer.updateMany({
      where: {
        orderId,
        carrierId: { not: exceptCarrierId },
        status: { in: ["ACTIVE", "COUNTERED"] },
      },
      data: {
        status: "REJECTED",
      },
    });
  }

  async listByOrderId(orderId: number) {
    return prisma.orderOffer.findMany({
      where: { orderId },
      include: {
        carrier: { include: { user: true } },
        customer: { include: { user: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
  }
}
