const DEFAULT_HOUR = 12;
const DEFAULT_MINUTE = 0;

const hasLetterOrDigit = (value: string) => /[\p{L}\p{N}]/u.test(value);

const buildDate = (year: number, month: number, day: number, hour = DEFAULT_HOUR, minute = DEFAULT_MINUTE) => {
  const parsed = new Date(year, month - 1, day, hour, minute, 0, 0);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day ||
    parsed.getHours() !== hour ||
    parsed.getMinutes() !== minute
  ) {
    return null;
  }

  return parsed;
};

const parseMatchedDate = (match: RegExpMatchArray, yearIndex: number, monthIndex: number, dayIndex: number) => {
  const year = Number(match[yearIndex]);
  const month = Number(match[monthIndex]);
  const day = Number(match[dayIndex]);
  const hour = match[4] !== undefined ? Number(match[4]) : DEFAULT_HOUR;
  const minute = match[5] !== undefined ? Number(match[5]) : DEFAULT_MINUTE;

  if (![year, month, day, hour, minute].every((value) => Number.isInteger(value))) {
    return null;
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  const date = buildDate(year, month, day, hour, minute);
  if (!date) {
    return null;
  }

  return {
    date,
    timeWasInferred: match[4] === undefined,
  };
};

export const normalizeAddressInput = (value: string) =>
  value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s*-\s*/g, "-");

const isLatitude = (value: number) => Number.isFinite(value) && value >= -90 && value <= 90;
const isLongitude = (value: number) => Number.isFinite(value) && value >= -180 && value <= 180;
const formatCoordinate = (value: number) => value.toFixed(6);

const parseCoordinatePair = (raw: string, order: "lat-lng" | "lng-lat") => {
  const match = raw.match(/(-?\d{1,3}(?:\.\d+)?)[,\s;]+(-?\d{1,3}(?:\.\d+)?)/);
  if (!match) {
    return null;
  }

  const first = Number(match[1]);
  const second = Number(match[2]);
  const lat = order === "lat-lng" ? first : second;
  const lng = order === "lat-lng" ? second : first;

  if (!isLatitude(lat) || !isLongitude(lng)) {
    return null;
  }

  return { lat, lng };
};

const isLikelyMapUrl = (value: string) =>
  /^https?:\/\//i.test(value) ||
  /(google\.[^/\s]+\/maps|maps\.app\.goo\.gl|yandex\.[^/\s]+\/maps|2gis\.[^/\s]+)/i.test(value);

const parseCoordinatesFromUrl = (value: string) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  const decoded = decodeURIComponent(value);
  const directLatLngValues = [
    url.searchParams.get("q"),
    url.searchParams.get("query"),
    url.searchParams.get("daddr"),
    url.searchParams.get("destination"),
    url.searchParams.get("text"),
  ].filter(Boolean) as string[];

  for (const candidate of directLatLngValues) {
    const parsed = parseCoordinatePair(candidate, "lat-lng");
    if (parsed) {
      return parsed;
    }
  }

  const directLngLatValues = [url.searchParams.get("ll"), url.searchParams.get("pt"), url.searchParams.get("sll")].filter(Boolean) as string[];
  for (const candidate of directLngLatValues) {
    const parsed = parseCoordinatePair(candidate, "lng-lat");
    if (parsed) {
      return parsed;
    }
  }

  const atMatch = decoded.match(/@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/);
  if (atMatch) {
    const parsed = parseCoordinatePair(`${atMatch[1]},${atMatch[2]}`, "lat-lng");
    if (parsed) {
      return parsed;
    }
  }

  const geoMatch = decoded.match(/\/geo\/(-?\d{1,3}(?:\.\d+)?),(-?\d{1,2}(?:\.\d+)?)/i);
  if (geoMatch) {
    const parsed = parseCoordinatePair(`${geoMatch[1]},${geoMatch[2]}`, "lng-lat");
    if (parsed) {
      return parsed;
    }
  }

  return null;
};

const buildCoordinatePointLabel = (mapPointLabel: string, lat: number, lng: number) =>
  `${mapPointLabel}: ${formatCoordinate(lat)}, ${formatCoordinate(lng)}`;

export const validateAddressInput = (value: string, fieldLabel: string) => {
  const normalized = normalizeAddressInput(value);

  if (normalized.length < 3 || !hasLetterOrDigit(normalized)) {
    throw new Error(`Укажите корректный ${fieldLabel}. Можно ввести адрес текстом или отправить точку с карты.`);
  }

  return normalized;
};

export const parseRoutePointInput = (value: string, fieldLabel: string, mapPointLabel: string) => {
  const normalized = normalizeAddressInput(value);

  if (isLikelyMapUrl(normalized)) {
    const mapCoordinates = parseCoordinatesFromUrl(normalized);
    if (!mapCoordinates) {
      throw new Error(
        `Ссылка на карту для ${fieldLabel} не распознана. Пришлите обычный адрес, координаты в виде 55.796127, 49.106414, ссылку из Google/Yandex или нажмите кнопку геолокации.`
      );
    }

    return {
      routeLabel: buildCoordinatePointLabel(mapPointLabel, mapCoordinates.lat, mapCoordinates.lng),
      lat: mapCoordinates.lat,
      lng: mapCoordinates.lng,
    };
  }

  const plainCoordinates = parseCoordinatePair(normalized, "lat-lng");
  if (plainCoordinates) {
    return {
      routeLabel: buildCoordinatePointLabel(mapPointLabel, plainCoordinates.lat, plainCoordinates.lng),
      lat: plainCoordinates.lat,
      lng: plainCoordinates.lng,
    };
  }

  return {
    routeLabel: validateAddressInput(normalized, fieldLabel),
    lat: undefined,
    lng: undefined,
  };
};

export const parseFlexibleDepartureDate = (value: string) => {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }

  if (normalized.includes("T")) {
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) {
      return {
        date: parsed,
        timeWasInferred: false,
      };
    }
  }

  const yearFirstMatch = normalized.match(/^(\d{4})[./\- ](\d{1,2})[./\- ](\d{1,2})(?:[ T,]+(\d{1,2})(?:[:. ](\d{1,2}))?)?$/);
  if (yearFirstMatch) {
    return parseMatchedDate(yearFirstMatch, 1, 2, 3);
  }

  const dayFirstMatch = normalized.match(/^(\d{1,2})[./\- ](\d{1,2})[./\- ](\d{4})(?:[ T,]+(\d{1,2})(?:[:. ](\d{1,2}))?)?$/);
  if (dayFirstMatch) {
    return parseMatchedDate(dayFirstMatch, 3, 2, 1);
  }

  return null;
};
