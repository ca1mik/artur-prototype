const formatCoordinate = (value: number) => value.toFixed(6);

export const buildMapLink = (lat?: number | null, lng?: number | null) => {
  if (typeof lat !== "number" || typeof lng !== "number") {
    return null;
  }

  return `https://maps.google.com/?q=${formatCoordinate(lat)},${formatCoordinate(lng)}`;
};

export const buildMapPointLabel = (label: string, lat: number, lng: number) =>
  `${label}: ${formatCoordinate(lat)}, ${formatCoordinate(lng)}`;

export const buildMapLinkLine = (label: string, lat?: number | null, lng?: number | null) => {
  const link = buildMapLink(lat, lng);
  return link ? `${label}: ${link}` : null;
};
