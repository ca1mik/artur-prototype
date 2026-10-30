import { prisma } from "../database/prisma";

export class CategoryRepository {
  async listAll() {
    return prisma.category.findMany({ orderBy: { name: "asc" } });
  }

  async findByName(name: string) {
    return prisma.category.findUnique({ where: { name } });
  }

  async create(name: string) {
    return prisma.category.create({ data: { name } });
  }
}
