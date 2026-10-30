const PHONE_DIGITS_RU = 11;

export const normalizePhoneNumber = (value: string) => {
  const digits = value.replace(/\D/g, "");

  if (!digits) {
    return null;
  }

  if (digits.length === 10) {
    return `7${digits}`;
  }

  if (digits.length === PHONE_DIGITS_RU && digits.startsWith("8")) {
    return `7${digits.slice(1)}`;
  }

  if (digits.length === PHONE_DIGITS_RU && digits.startsWith("7")) {
    return digits;
  }

  return null;
};

export const formatPhoneNumber = (value: string) => {
  const normalized = normalizePhoneNumber(value);
  if (!normalized) {
    return null;
  }

  return `+${normalized[0]} ${normalized.slice(1, 4)} ${normalized.slice(4, 7)}-${normalized.slice(7, 9)}-${normalized.slice(9, 11)}`;
};
