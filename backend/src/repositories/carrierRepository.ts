import { prisma } from "../database/prisma";

export class CarrierRepository {
  async findById(id: number) {
    return prisma.carrier.findUnique({
      where: { id },
      include: { user: true, region: true, carrierRegions: { include: { region: true } }, vehicles: true },
    });
  }

  async findByUserId(userId: number) {
    return prisma.carrier.findUnique({
      where: { userId },
      include: { user: true, region: true, carrierRegions: { include: { region: true } }, vehicles: true },
    });
  }

  async create(data: {
    userId: number;
    fullName: string;
    regionId: number;
    vehicleType: string;
    brand: string;
    capacity: number;
    plateNumber: string;
    description: string;
    photos?: string;
    documents?: string;
  }) {
    return prisma.carrier.create({
      data,
      include: { user: true, region: true, carrierRegions: { include: { region: true } }, vehicles: true },
    });
  }

  async updateProfile(id: number, data: {
    fullName?: string;
    regionId?: number;
    vehicleType?: string;
    brand?: string;
    capacity?: number;
    plateNumber?: string;
    description?: string;
    photos?: string;
    documents?: string;
  }) {
    return prisma.carrier.update({
      where: { id },
      data,
      include: { user: true, region: true, carrierRegions: { include: { region: true } }, vehicles: true },
    });
  }

  async updateRegion(id: number, regionId: number) {
    return prisma.carrier.update({
      where: { id },
      data: { regionId },
      include: { user: true, region: true, carrierRegions: { include: { region: true } }, vehicles: true },
    });
  }

  async approve(id: number) {
    return prisma.carrier.update({
      where: { id },
      data: { status: "APPROVED" },
      include: { user: true, region: true, carrierRegions: { include: { region: true } }, vehicles: true },
    });
  }

  async reject(id: number) {
    return prisma.carrier.update({
      where: { id },
      data: { status: "REJECTED" },
      include: { user: true, region: true, carrierRegions: { include: { region: true } }, vehicles: true },
    });
  }

  async ban(id: number) {
    return prisma.carrier.update({
      where: { id },
      data: { status: "BANNED" },
      include: { user: true, region: true, carrierRegions: { include: { region: true } }, vehicles: true },
    });
  }

  async findApprovedByCriteria(regionId: number, vehicleType: string, minimumCapacity: number) {
    return prisma.carrier.findMany({
      where: {
        status: "APPROVED",
        OR: [{ regionId }, { carrierRegions: { some: { regionId } } }],
        vehicles: {
          some: {
            type: vehicleType,
            isActive: true,
            OR: [{ capacity: null }, { capacity: { gte: minimumCapacity } }],
          },
        },
      },
      include: { user: true, region: true, carrierRegions: { include: { region: true } }, vehicles: true },
    });
  }

  async listPendingApproval(limit?: number) {
    return prisma.carrier.findMany({
      where: { status: "PENDING_APPROVAL" },
      include: { user: true, region: true, carrierRegions: { include: { region: true } }, vehicles: true },
      orderBy: { id: "desc" },
      ...(limit ? { take: limit } : {}),
    });
  }

  async listAll() {
    return prisma.carrier.findMany({
      include: { user: true, region: true, carrierRegions: { include: { region: true } }, vehicles: true },
    });
  }
}
