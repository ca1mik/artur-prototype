import { prisma } from "../database/prisma";

export class CarrierRegionRepository {
  async replaceForCarrier(carrierId: number, regionIds: number[]) {
    const uniqueRegionIds = Array.from(new Set(regionIds.filter((value) => Number.isInteger(value) && value > 0)));

    await prisma.carrierRegion.deleteMany({ where: { carrierId } });

    if (uniqueRegionIds.length === 0) {
      return [];
    }

    await prisma.carrierRegion.createMany({
      data: uniqueRegionIds.map((regionId) => ({ carrierId, regionId })),
    });

    return prisma.carrierRegion.findMany({
      where: { carrierId },
      include: { region: true },
      orderBy: { regionId: "asc" },
    });
  }

  async listByCarrierId(carrierId: number) {
    return prisma.carrierRegion.findMany({
      where: { carrierId },
      include: { region: true },
      orderBy: { regionId: "asc" },
    });
  }
}
