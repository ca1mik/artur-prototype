import { ZodError, z } from "zod";

export const regionSchema = z.object({
  name: z.string().min(1),
});

export const categorySchema = z.object({
  name: z.string().min(1),
});

export const carrierRegistrationSchema = z.object({
  fullName: z.string().min(2),
  phone: z.string().min(7),
  regionIds: z.array(z.number().int().positive()).min(1),
  vehicleType: z.enum([
    "CAR",
    "MINIVAN",
    "MINIBUS",
    "BUS",
    "GAZELLE",
    "TRUCK",
    "TRAILER",
    "SPECIAL",
  ]),
  brand: z.string().min(1),
  capacity: z.number().int().positive(),
  plateNumber: z.string().min(1),
  description: z.string().min(10),
});

export const orderPayloadSchema = z.object({
  regionId: z.number().int().positive(),
  categoryId: z.number().int().positive(),
  vehicleType: z.enum([
    "CAR",
    "MINIVAN",
    "MINIBUS",
    "BUS",
    "GAZELLE",
    "TRUCK",
    "TRAILER",
    "SPECIAL",
  ]),
  routeFrom: z.string().min(1),
  routeFromLat: z.number().min(-90).max(90).optional(),
  routeFromLng: z.number().min(-180).max(180).optional(),
  routeTo: z.string().min(1),
  routeToLat: z.number().min(-90).max(90).optional(),
  routeToLng: z.number().min(-180).max(180).optional(),
  date: z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Некорректный формат даты",
  }),
  price: z.number().positive(),
  adultsCount: z.number().int().min(0).optional(),
  childrenCount: z.number().int().min(0).optional(),
  passengersCount: z.number().int().positive().optional(),
  cargoDescription: z.string().optional(),
  weight: z.number().positive().optional(),
  volume: z.number().positive().optional(),
});

export const parseValidation = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) {
    const error = result.error as ZodError;
    throw new Error(error.errors.map((issue) => issue.message).join(", "));
  }
  return result.data;
};
