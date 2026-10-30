import { prisma } from "../database/prisma";

export class RegionRepository {
  async listAll() {
    return prisma.region.findMany({ orderBy: { name: "asc" } });
  }

  async findByName(name: string) {
    return prisma.region.findUnique({ where: { name } });
  }

  async create(name: string) {
    return prisma.region.create({ data: { name } });
  }
}
