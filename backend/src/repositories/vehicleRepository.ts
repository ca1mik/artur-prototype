import { prisma } from "../database/prisma";

export class VehicleRepository {
  async create(data: {
    carrierId: number;
    type: string;
    brand: string;
    plateNumber: string;
    capacity?: number;
    description?: string;
    features?: string;
    photos?: string;
  }) {
    return prisma.vehicle.create({ data });
  }

  async listByCarrierId(carrierId: number) {
    return prisma.vehicle.findMany({
      where: { carrierId, isActive: true },
      orderBy: [{ createdAt: "asc" }],
    });
  }

  async listAllByCarrierId(carrierId: number) {
    return prisma.vehicle.findMany({
      where: { carrierId },
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    });
  }

  async findById(id: number) {
    return prisma.vehicle.findUnique({ where: { id } });
  }

  async findByCarrierAndId(carrierId: number, id: number) {
    return prisma.vehicle.findFirst({ where: { carrierId, id } });
  }

  async update(id: number, data: {
    type?: string;
    brand?: string;
    plateNumber?: string;
    capacity?: number;
    description?: string;
    features?: string | null;
    photos?: string;
    isActive?: boolean;
  }) {
    return prisma.vehicle.update({ where: { id }, data });
  }

  async toggleActive(id: number, isActive: boolean) {
    return prisma.vehicle.update({ where: { id }, data: { isActive } });
  }

  async findBestMatch(carrierId: number, vehicleType: string, minimumCapacity: number) {
    return prisma.vehicle.findFirst({
      where: {
        carrierId,
        type: vehicleType,
        isActive: true,
        OR: [{ capacity: null }, { capacity: { gte: minimumCapacity } }],
      },
      orderBy: [{ capacity: "asc" }, { createdAt: "asc" }],
    });
  }
}
