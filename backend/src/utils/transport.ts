export const VEHICLE_LABELS: Record<string, string> = {
  CAR: "Легковой автомобиль",
  MINIVAN: "Минивэн",
  MINIBUS: "Микроавтобус",
  BUS: "Автобус",
  GAZELLE: "Газель",
  TRUCK: "Грузовик",
  TRAILER: "Фура",
  SPECIAL: "Спецтехника",
};

export const VEHICLE_TYPES = Object.keys(VEHICLE_LABELS);
export const PASSENGER_VEHICLE_TYPES = ["CAR", "MINIVAN", "MINIBUS", "BUS"];
export const CARGO_VEHICLE_TYPES = ["GAZELLE", "TRUCK", "TRAILER", "SPECIAL"];

export const toVehicleLabel = (vehicleType: string) => VEHICLE_LABELS[vehicleType] ?? vehicleType;

export const parsePhotoIds = (value?: string | null): string[] => {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? Array.from(new Set(parsed.filter((item) => typeof item === "string"))) : [];
  } catch {
    return Array.from(
      new Set(
        value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      )
    );
  }
};

export const stringifyPhotoIds = (photos?: string[]) => JSON.stringify(Array.from(new Set((photos ?? []).filter(Boolean))));

export const formatVehicleSummary = (vehicle: {
  type?: string | null;
  brand?: string | null;
  plateNumber?: string | null;
  capacity?: number | null;
  description?: string | null;
  features?: string | null;
}) => {
  const parts = [
    toVehicleLabel(vehicle.type ?? "UNKNOWN"),
    vehicle.brand ? `Марка: ${vehicle.brand}` : null,
    vehicle.plateNumber ? `Номер: ${vehicle.plateNumber}` : null,
    vehicle.capacity ? `Вместимость: ${vehicle.capacity}` : null,
    vehicle.features ? `Характеристики: ${vehicle.features}` : null,
    vehicle.description ? `Описание: ${vehicle.description}` : null,
  ];

  return parts.filter(Boolean).join("\n");
};
