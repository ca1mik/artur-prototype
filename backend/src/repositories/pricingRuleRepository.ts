import { prisma } from "../database/prisma";

export class PricingRuleRepository {
  async listAll() {
    return prisma.pricingRule.findMany({ orderBy: { vehicleType: "asc" } });
  }

  async findByVehicleType(vehicleType: string) {
    return prisma.pricingRule.findUnique({ where: { vehicleType } });
  }

  async upsert(data: {
    vehicleType: string;
    basePrice: number;
    pricePerKm: number;
    pricePerHour: number;
    minPrice: number;
  }) {
    return prisma.pricingRule.upsert({
      where: { vehicleType: data.vehicleType },
      update: data,
      create: data,
    });
  }

  async updateField(vehicleType: string, field: "basePrice" | "pricePerKm" | "pricePerHour" | "minPrice", value: number) {
    return prisma.pricingRule.upsert({
      where: { vehicleType },
      update: { [field]: value },
      create: {
        vehicleType,
        basePrice: field === "basePrice" ? value : 0,
        pricePerKm: field === "pricePerKm" ? value : 0,
        pricePerHour: field === "pricePerHour" ? value : 0,
        minPrice: field === "minPrice" ? value : 0,
      },
    });
  }
}
