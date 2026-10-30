const MS_PER_HOUR = 60 * 60 * 1000;

type PassengerTripRuleOptions = {
  departureAt: Date;
  durationHours?: number;
  adultsCount?: number;
  childrenCount?: number;
  leadHours: number;
  nightStartHour: number;
  nightEndHour: number;
};

const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate());

const addDays = (value: Date, days: number) => {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
};

const setTime = (base: Date, hour: number) => {
  const next = new Date(base);
  next.setHours(hour, 0, 0, 0);
  return next;
};

const intersects = (rangeStart: Date, rangeEnd: Date, otherStart: Date, otherEnd: Date) =>
  rangeStart.getTime() < otherEnd.getTime() && otherStart.getTime() < rangeEnd.getTime();

const isHourInsideNightWindow = (hour: number, nightStartHour: number, nightEndHour: number) => {
  if (nightStartHour === nightEndHour) {
    return true;
  }

  if (nightStartHour < nightEndHour) {
    return hour >= nightStartHour && hour < nightEndHour;
  }

  return hour >= nightStartHour || hour < nightEndHour;
};

const overlapsNightWindow = (departureAt: Date, durationHours: number, nightStartHour: number, nightEndHour: number) => {
  if (durationHours <= 0) {
    return isHourInsideNightWindow(departureAt.getHours(), nightStartHour, nightEndHour);
  }

  const tripStart = departureAt;
  const tripEnd = new Date(departureAt.getTime() + durationHours * MS_PER_HOUR);
  let dayCursor = addDays(startOfDay(tripStart), -1);
  const lastDay = startOfDay(tripEnd);

  while (dayCursor.getTime() <= lastDay.getTime()) {
    const nightStart = setTime(dayCursor, nightStartHour);
    const nightEnd =
      nightStartHour < nightEndHour
        ? setTime(dayCursor, nightEndHour)
        : setTime(addDays(dayCursor, 1), nightEndHour);

    if (intersects(tripStart, tripEnd, nightStart, nightEnd)) {
      return true;
    }

    dayCursor = addDays(dayCursor, 1);
  }

  return false;
};

export const validatePassengerManifest = (adultsCount?: number, childrenCount?: number) => {
  const adults = adultsCount ?? 0;
  const children = childrenCount ?? 0;

  if (!Number.isInteger(adults) || adults < 0) {
    throw new Error("Укажите корректное количество взрослых пассажиров.");
  }

  if (!Number.isInteger(children) || children < 0) {
    throw new Error("Укажите корректное количество детей.");
  }

  const total = adults + children;
  if (total <= 0) {
    throw new Error("Укажите хотя бы одного пассажира.");
  }

  return total;
};

export const validatePassengerTripRules = ({
  departureAt,
  durationHours,
  adultsCount,
  childrenCount,
  leadHours,
  nightStartHour,
  nightEndHour,
}: PassengerTripRuleOptions) => {
  const totalPassengers = validatePassengerManifest(adultsCount, childrenCount);
  const children = childrenCount ?? 0;

  if (children <= 0) {
    return totalPassengers;
  }

  if (!durationHours || durationHours <= 0) {
    throw new Error("Для поездки с детьми укажите корректное время в пути.");
  }

  const reasons: string[] = [];
  const leadTimeHours = (departureAt.getTime() - Date.now()) / MS_PER_HOUR;
  const leadDays = Math.ceil(leadHours / 24);

  if (leadTimeHours < leadHours) {
    reasons.push(`Поездки с детьми принимаем минимум за ${leadDays} суток до выезда.`);
  }

  if (overlapsNightWindow(departureAt, durationHours, nightStartHour, nightEndHour)) {
    reasons.push("Ночные поездки с детьми не принимаем.");
  }

  if (reasons.length > 0) {
    throw new Error(reasons.join(" "));
  }

  return totalPassengers;
};

export const hasChildTripRestrictions = (childrenCount?: number) => (childrenCount ?? 0) > 0;
