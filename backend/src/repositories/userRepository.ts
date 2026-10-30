import { prisma } from "../database/prisma";

export class UserRepository {
  async findByTelegramId(telegramId: number) {
    return prisma.user.findUnique({
      where: { telegramId },
      include: { customer: true, carrier: true },
    });
  }

  async createCustomerUser(telegramId: number, phone: string | null) {
    return prisma.user.create({
      data: {
        telegramId,
        role: "CUSTOMER",
        phone,
      },
      include: { customer: true, carrier: true },
    });
  }

  async createCarrierUser(telegramId: number, phone: string | null) {
    return prisma.user.create({
      data: {
        telegramId,
        role: "CARRIER",
        phone,
      },
      include: { customer: true, carrier: true },
    });
  }

  async updatePhone(userId: number, phone: string) {
    return prisma.user.update({ where: { id: userId }, data: { phone }, include: { customer: true, carrier: true } });
  }

  async updateRole(userId: number, role: "CUSTOMER" | "CARRIER" | "ADMIN") {
    return prisma.user.update({ where: { id: userId }, data: { role }, include: { customer: true, carrier: true } });
  }
}
