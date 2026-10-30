import { formatPhoneNumber, normalizePhoneNumber } from "./phone";

const collapseSpaces = (value: string) => value.trim().replace(/\s+/g, " ");

export const validateCarrierFullName = (value: string) => {
  const normalized = collapseSpaces(value);
  if (normalized.length < 5) {
    throw new Error("Укажите ФИО полностью: имя и фамилию, минимум 5 символов.");
  }

  if (!/^[A-Za-zА-Яа-яЁё\s'-]+$/.test(normalized)) {
    throw new Error("ФИО должно содержать только буквы, пробелы, дефис или апостроф.");
  }

  if (normalized.split(" ").length < 2) {
    throw new Error("Укажите минимум имя и фамилию.");
  }

  return normalized;
};

export const validateCarrierPhone = (value: string) => {
  const normalized = normalizePhoneNumber(value);
  if (!normalized) {
    throw new Error("Телефон не распознан. Отправьте контакт или номер в формате +7 999 123-45-67.");
  }

  return formatPhoneNumber(normalized)!;
};

export const validateVehicleBrand = (value: string) => {
  const normalized = collapseSpaces(value);
  if (normalized.length < 2) {
    throw new Error("Укажите марку или модель транспорта минимум из 2 символов.");
  }

  if (normalized.length > 80) {
    throw new Error("Марка транспорта слишком длинная. Сократите до 80 символов.");
  }

  return normalized;
};

export const validateVehicleCapacity = (value: string) => {
  const capacity = Number(value.replace(",", "."));
  if (!Number.isFinite(capacity) || capacity <= 0) {
    throw new Error("Укажите корректную вместимость или грузоподъемность числом больше 0.");
  }

  if (capacity > 100000) {
    throw new Error("Слишком большое значение вместимости. Проверьте ввод.");
  }

  return Math.round(capacity);
};

export const validatePlateNumber = (value: string) => {
  const normalized = collapseSpaces(value.toUpperCase());
  if (normalized.length < 5 || normalized.length > 16) {
    throw new Error("Госномер должен быть длиной от 5 до 16 символов.");
  }

  if (!/^[A-ZА-Я0-9\s-]+$/.test(normalized)) {
    throw new Error("Госномер может содержать только буквы, цифры, пробелы и дефис.");
  }

  return normalized;
};

export const validateVehicleDescription = (value: string) => {
  const normalized = collapseSpaces(value);
  if (normalized.length < 10) {
    throw new Error("Описание транспорта должно быть не короче 10 символов.");
  }

  if (normalized.length > 500) {
    throw new Error("Описание транспорта слишком длинное. Сократите до 500 символов.");
  }

  return normalized;
};

export const validateVehicleFeatures = (value: string) => {
  const normalized = collapseSpaces(value);
  if (!normalized || /^нет$/i.test(normalized)) {
    return null;
  }

  if (normalized.length > 500) {
    throw new Error("Характеристики слишком длинные. Сократите до 500 символов.");
  }

  return normalized;
};

export const validateCarrierRegionIds = (regionIds: number[]) => {
  const normalized = Array.from(new Set(regionIds.filter((item) => Number.isInteger(item) && item > 0)));
  if (normalized.length === 0) {
    throw new Error("Выберите хотя бы один регион работы.");
  }

  return normalized;
};
