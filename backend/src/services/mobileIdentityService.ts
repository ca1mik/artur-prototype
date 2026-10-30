import { prisma } from "../database/prisma";
import type { MobileRole } from "../api/mobileAuth";
import { normalizePhoneNumber } from "../utils/phone";

export type SanitizedMobileIdentityInput = {
  role: MobileRole;
  name: string;
  normalizedPhone: string;
};

export const trimMobileIdentityName = (value: string) => value.trim().replace(/\s+/g, " ");

export const sanitizeMobileIdentityInput = (input: {
  role: MobileRole;
  name: string;
  phone: string;
}): SanitizedMobileIdentityInput => {
  const name = trimMobileIdentityName(input.name);
  const normalizedPhone = normalizePhoneNumber(input.phone);

  if (name.length < 2) {
    throw new Error("Name must contain at least 2 characters");
  }

  if (!normalizedPhone) {
    throw new Error("Phone number must be a valid Russian mobile or landline number");
  }

  return {
    role: input.role,
    name,
    normalizedPhone,
  };
};

export const findPreferredUserByRoleAndPhone = async (role: MobileRole, normalizedPhone: string) => {
  const users = await prisma.user.findMany({
    where: {
      role,
      phone: { not: null },
    },
    include: {
      customer: true,
      carrier: {
        include: {
          region: true,
          carrierRegions: { include: { region: true } },
          vehicles: true,
        },
      },
    },
  });

  const candidates = users.filter((item) => normalizePhoneNumber(item.phone ?? "") === normalizedPhone);
  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    const score = (item: (typeof candidates)[number]) => {
      let value = item.telegramId > 0n ? 5 : 0;
      if (item.customer) {
        value += 10;
      }
      if (item.carrier) {
        value += 10;
        if (item.carrier.status === "APPROVED") {
          value += 100;
        }
        if (item.carrier.vehicles.length > 0) {
          value += 20;
        }
        if (item.carrier.regionId) {
          value += 10;
        }
      }
      return value;
    };

    return score(right) - score(left);
  });

  return candidates[0] ?? null;
};
