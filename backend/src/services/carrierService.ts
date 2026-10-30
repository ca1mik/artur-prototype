import { CarrierRepository } from "../repositories/carrierRepository";
import { CarrierRegionRepository } from "../repositories/carrierRegionRepository";
import { VehicleRepository } from "../repositories/vehicleRepository";
import { UserRepository } from "../repositories/userRepository";
import { CarrierProfileUpdateDto, CarrierRegistrationDto, VehicleDto, VehicleUpdateDto } from "../types";
import { stringifyPhotoIds } from "../utils/transport";

export class CarrierService {
  private carrierRepository = new CarrierRepository();
  private carrierRegionRepository = new CarrierRegionRepository();
  private vehicleRepository = new VehicleRepository();
  private userRepository = new UserRepository();

  async registerCarrier(userId: number, payload: CarrierRegistrationDto) {
    const primaryRegionId = payload.regionIds[0];
    const existingCarrier = await this.carrierRepository.findByUserId(userId);
    const carrier = existingCarrier
      ? await this.carrierRepository.updateProfile(existingCarrier.id, {
          fullName: payload.fullName,
          regionId: primaryRegionId,
          vehicleType: payload.vehicleType,
          brand: payload.brand,
          capacity: payload.capacity,
          plateNumber: payload.plateNumber,
          description: payload.description,
          photos: stringifyPhotoIds(payload.photos),
        })
      : await this.carrierRepository.create({
          userId,
          fullName: payload.fullName,
          regionId: primaryRegionId,
          vehicleType: payload.vehicleType,
          brand: payload.brand,
          capacity: payload.capacity,
          plateNumber: payload.plateNumber,
          description: payload.description,
          photos: stringifyPhotoIds(payload.photos),
          documents: "",
        });

    await this.carrierRegionRepository.replaceForCarrier(carrier.id, payload.regionIds);
    await this.userRepository.updatePhone(userId, payload.phone);

    const matchingVehicle = existingCarrier?.vehicles.find((vehicle) => vehicle.plateNumber === payload.plateNumber);
    if (matchingVehicle) {
      await this.vehicleRepository.update(matchingVehicle.id, {
        type: payload.vehicleType,
        brand: payload.brand,
        plateNumber: payload.plateNumber,
        capacity: payload.capacity,
        description: payload.description,
        features: payload.features ?? null,
        photos: stringifyPhotoIds(payload.photos),
        isActive: true,
      });
    } else if (!existingCarrier || existingCarrier.vehicles.length === 0) {
      await this.vehicleRepository.create({
        carrierId: carrier.id,
        type: payload.vehicleType,
        brand: payload.brand,
        plateNumber: payload.plateNumber,
        capacity: payload.capacity,
        description: payload.description,
        features: payload.features,
        photos: stringifyPhotoIds(payload.photos),
      });
    }

    return carrier;
  }

  async addVehicle(userId: number, payload: VehicleDto) {
    const carrier = await this.carrierRepository.findByUserId(userId);
    if (!carrier) {
      throw new Error("Carrier profile not found");
    }

    const vehicle = await this.vehicleRepository.create({
      carrierId: carrier.id,
      type: payload.vehicleType,
      brand: payload.brand,
      plateNumber: payload.plateNumber,
      capacity: payload.capacity,
      description: payload.description,
      features: payload.features,
      photos: stringifyPhotoIds(payload.photos),
    });

    return vehicle;
  }

  async listPendingApproval() {
    return this.carrierRepository.listPendingApproval();
  }

  async approveCarrier(id: number) {
    return this.carrierRepository.approve(id);
  }

  async rejectCarrier(id: number) {
    return this.carrierRepository.reject(id);
  }

  async findCarrierByUserId(userId: number) {
    return this.carrierRepository.findByUserId(userId);
  }

  async listVehiclesByUserId(userId: number, includeInactive = false) {
    const carrier = await this.carrierRepository.findByUserId(userId);
    if (!carrier) {
      return [];
    }

    return includeInactive ? this.vehicleRepository.listAllByCarrierId(carrier.id) : this.vehicleRepository.listByCarrierId(carrier.id);
  }

  async updateRegionByUserId(userId: number, regionId: number) {
    return this.updateRegionsByUserId(userId, [regionId]);
  }

  async updateRegionsByUserId(userId: number, regionIds: number[]) {
    const carrier = await this.carrierRepository.findByUserId(userId);
    if (!carrier) {
      throw new Error("Carrier profile not found");
    }

    const primaryRegionId = regionIds[0];
    await this.carrierRepository.updateRegion(carrier.id, primaryRegionId);
    await this.carrierRegionRepository.replaceForCarrier(carrier.id, regionIds);
    return this.carrierRepository.findByUserId(userId);
  }

  async updateProfileByUserId(userId: number, payload: CarrierProfileUpdateDto) {
    const carrier = await this.carrierRepository.findByUserId(userId);
    if (!carrier) {
      throw new Error("Carrier profile not found");
    }

    await this.carrierRepository.updateProfile(carrier.id, {
      fullName: payload.fullName,
      regionId: payload.regionIds?.[0] ?? carrier.regionId ?? undefined,
    });

    if (payload.phone) {
      await this.userRepository.updatePhone(userId, payload.phone);
    }

    if (payload.regionIds) {
      await this.carrierRegionRepository.replaceForCarrier(carrier.id, payload.regionIds);
    }

    return this.carrierRepository.findByUserId(userId);
  }

  async updateVehicle(userId: number, vehicleId: number, payload: VehicleUpdateDto) {
    const carrier = await this.carrierRepository.findByUserId(userId);
    if (!carrier) {
      throw new Error("Carrier profile not found");
    }

    const vehicle = await this.vehicleRepository.findByCarrierAndId(carrier.id, vehicleId);
    if (!vehicle) {
      throw new Error("Vehicle not found");
    }

    return this.vehicleRepository.update(vehicleId, {
      type: payload.vehicleType,
      brand: payload.brand,
      capacity: payload.capacity,
      plateNumber: payload.plateNumber,
      description: payload.description,
      features: payload.features,
      photos: payload.photos ? stringifyPhotoIds(payload.photos) : undefined,
      isActive: payload.isActive,
    });
  }

  async toggleVehicle(userId: number, vehicleId: number, isActive: boolean) {
    const carrier = await this.carrierRepository.findByUserId(userId);
    if (!carrier) {
      throw new Error("Carrier profile not found");
    }

    const vehicle = await this.vehicleRepository.findByCarrierAndId(carrier.id, vehicleId);
    if (!vehicle) {
      throw new Error("Vehicle not found");
    }

    return this.vehicleRepository.toggleActive(vehicleId, isActive);
  }
}
