import { PricingRuleRepository } from "../repositories/pricingRuleRepository";
import { VEHICLE_TYPES } from "../utils/transport";

export class PricingService {
  private pricingRuleRepository = new PricingRuleRepository();

  async ensureDefaults() {
    const existingRules = await this.pricingRuleRepository.listAll();
    if (existingRules.length > 0) {
      return existingRules;
    }

    const defaults = VEHICLE_TYPES.map((vehicleType) => ({
      vehicleType,
      basePrice: 0,
      pricePerKm: 0,
      pricePerHour: 0,
      minPrice: 0,
    }));

    for (const rule of defaults) {
      await this.pricingRuleRepository.upsert(rule);
    }

    return this.pricingRuleRepository.listAll();
  }

  async listRules() {
    return this.pricingRuleRepository.listAll();
  }

  async getRule(vehicleType: string) {
    return this.pricingRuleRepository.findByVehicleType(vehicleType);
  }

  async updateRuleField(vehicleType: string, field: "basePrice" | "pricePerKm" | "pricePerHour" | "minPrice", value: number) {
    return this.pricingRuleRepository.updateField(vehicleType, field, value);
  }

  async calculateSuggestedPrice(vehicleType: string, distanceKm?: number, durationHours?: number) {
    const rule = await this.pricingRuleRepository.findByVehicleType(vehicleType);
    if (!rule) {
      return null;
    }

    const distance = distanceKm ?? 0;
    const duration = durationHours ?? 0;
    const calculated = rule.basePrice + distance * rule.pricePerKm + duration * rule.pricePerHour;
    return Math.max(rule.minPrice, Math.round(calculated));
  }
}
