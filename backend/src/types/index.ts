export enum BotState {
  NONE = "NONE",
  CUSTOMER_REGISTRATION = "CUSTOMER_REGISTRATION",
  CUSTOMER_ORDER_REGION = "CUSTOMER_ORDER_REGION",
  CUSTOMER_ORDER_VEHICLE = "CUSTOMER_ORDER_VEHICLE",
  CUSTOMER_ORDER_CATEGORY = "CUSTOMER_ORDER_CATEGORY",
  CUSTOMER_ORDER_DETAILS = "CUSTOMER_ORDER_DETAILS",
  CUSTOMER_ORDER_CONFIRM = "CUSTOMER_ORDER_CONFIRM",
  ORDER_ACTION = "ORDER_ACTION",
  CARRIER_REGISTRATION = "CARRIER_REGISTRATION",
  CARRIER_VEHICLE_REGISTRATION = "CARRIER_VEHICLE_REGISTRATION",
  CARRIER_MANAGEMENT = "CARRIER_MANAGEMENT",
  ADMIN_PRICING_EDIT = "ADMIN_PRICING_EDIT",
}

export type SessionData = {
  state: BotState;
  stepData?: Record<string, unknown>;
  transientMessageIds?: number[];
};

export type OrderDto = {
  regionId: number;
  categoryId: number;
  vehicleType: string;
  routeFrom: string;
  routeFromLat?: number;
  routeFromLng?: number;
  routeTo: string;
  routeToLat?: number;
  routeToLng?: number;
  date: string;
  price: number;
  suggestedPrice?: number;
  estimatedDistanceKm?: number;
  estimatedDurationHours?: number;
  comment?: string;
  adultsCount?: number;
  childrenCount?: number;
  passengersCount?: number;
  cargoDescription?: string;
  weight?: number;
  volume?: number;
  pickupEtaText?: string;
};

export type OrderOfferDto = {
  orderId: number;
  carrierId: number;
  customerId: number;
  proposedPrice: number;
  pickupEtaText?: string;
  note?: string;
  status?: string;
  lastActor: string;
};

export type CarrierRegistrationDto = {
  fullName: string;
  phone: string;
  regionIds: number[];
  vehicleType: string;
  brand: string;
  capacity: number;
  plateNumber: string;
  description: string;
  features?: string;
  photos?: string[];
};

export type VehicleDto = {
  vehicleType: string;
  brand: string;
  capacity: number;
  plateNumber: string;
  description: string;
  features?: string;
  photos?: string[];
};

export type CarrierProfileUpdateDto = {
  fullName?: string;
  phone?: string;
  regionIds?: number[];
};

export type VehicleUpdateDto = {
  vehicleType?: string;
  brand?: string;
  capacity?: number;
  plateNumber?: string;
  description?: string;
  features?: string | null;
  photos?: string[];
  isActive?: boolean;
};

export type PricingRuleDto = {
  vehicleType: string;
  basePrice: number;
  pricePerKm: number;
  pricePerHour: number;
  minPrice: number;
};
