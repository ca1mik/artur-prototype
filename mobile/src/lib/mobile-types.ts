export type MobileRole = "CUSTOMER" | "CARRIER";

export type Region = {
  id: number;
  name: string;
};

export type Category = {
  id: number;
  name: string;
};

export type VehicleTypeOption = {
  value: string;
  label: string;
  kind: "PASSENGER" | "CARGO";
};

export type PricingRule = {
  id: number;
  vehicleType: string;
  basePrice: number;
  pricePerKm: number;
  pricePerHour: number;
  minPrice: number;
};

export type Vehicle = {
  id: number;
  carrierId: number;
  type: string;
  brand: string;
  plateNumber: string;
  capacity: number | null;
  description: string | null;
  features: string | null;
  photos: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MobileSessionUser = {
  id: number;
  role: MobileRole;
  phone: string | null;
  customer: {
    id: number;
    name: string;
  } | null;
  carrier: {
    id: number;
    status: string;
    fullName: string | null;
    vehicleType: string | null;
    brand: string | null;
    capacity: number | null;
    plateNumber: string | null;
    description: string | null;
    region: Region | null;
    regions: Region[];
    vehicles: Vehicle[];
  } | null;
};

export type AuthChallenge = {
  challengeId: string;
  expiresAt: string;
  deliveryChannel: string;
  debugCode?: string;
};

export type AuthChallengeRequest = {
  role: MobileRole;
  name: string;
  phone: string;
};

export type AuthVerifyRequest = {
  challengeId: string;
  code: string;
  deviceId?: string;
  deviceName?: string;
  platform?: string;
};

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  user: MobileSessionUser;
};

export type OrderOffer = {
  id: number;
  orderId: number;
  carrierId: number;
  customerId: number;
  proposedPrice: number;
  pickupEtaText: string | null;
  note: string | null;
  status: string;
  lastActor: string;
  createdAt: string;
  updatedAt: string;
  carrier?: {
    id: number;
    fullName?: string | null;
    user?: {
      phone?: string | null;
    };
  };
};

export type OrderTimelineItem = {
  id: number;
  eventType: string;
  actorRole: string;
  actorLabel: string | null;
  message: string;
  createdAt: string;
};

export type OrderDeal = {
  selectedOfferId: number | null;
  depositPercent: number;
  depositAmount: number | null;
  depositPayerRole: string | null;
  depositStatus: string;
  depositReference: string | null;
  depositRequestedAt: string | null;
  depositSubmittedAt: string | null;
  depositVerifiedAt: string | null;
  depositRejectedAt: string | null;
  depositVerificationNote: string | null;
  customerConfirmedAt: string | null;
  contactsUnlockedAt: string | null;
  contactAccess: "LOCKED" | "UNLOCKED";
  sharedContacts: {
    customerName: string | null;
    customerPhone: string | null;
    carrierName: string | null;
    carrierPhone: string | null;
  };
};

export type OrderDispatch = {
  vehicleBrand: string | null;
  vehiclePlate: string | null;
  driverName: string | null;
  driverPhone: string | null;
  assigned: boolean;
};

export type OrderReturnTrip = {
  isReturnOrder: boolean;
  sourceOrderId: number | null;
  linkedReturnOrderId: number | null;
  linkedReturnStatus: string | null;
  linkedReturnDate: string | null;
};

export type OrderClosingDocument = {
  documentNumber: string;
  generatedAt: string;
  status: string;
  viewerRole: MobileRole;
  summary: string;
  route: {
    from: string;
    to: string;
    date: string;
    dateLabel: string | null;
    estimatedDistanceKm: number | null;
    estimatedDurationHours: number | null;
  };
  financials: {
    totalPrice: number;
    suggestedPrice: number | null;
    depositPercent: number;
    depositAmount: number | null;
    depositStatus: string;
    depositReference: string | null;
  };
  participants: {
    customerName: string | null;
    customerPhone: string | null;
    carrierName: string | null;
    carrierPhone: string | null;
    driverName: string | null;
    driverPhone: string | null;
  };
  vehicle: {
    type: string;
    label: string;
    brand: string | null;
    plateNumber: string | null;
  };
  checkpoints: {
    createdAt: string;
    createdAtLabel: string | null;
    customerConfirmedAt: string | null;
    customerConfirmedAtLabel: string | null;
    contactsUnlockedAt: string | null;
    contactsUnlockedAtLabel: string | null;
    depositVerifiedAt: string | null;
    depositVerifiedAtLabel: string | null;
  };
};

export type Order = {
  id: number;
  customerId: number;
  regionId: number;
  categoryId: number;
  vehicleType: string;
  status: string;
  adultsCount: number | null;
  childrenCount: number | null;
  passengersCount: number | null;
  cargoDescription: string | null;
  weight: number | null;
  volume: number | null;
  routeFrom: string;
  routeTo: string;
  date: string;
  price: number;
  suggestedPrice: number | null;
  estimatedDistanceKm: number | null;
  estimatedDurationHours: number | null;
  pickupEtaText: string | null;
  comment: string | null;
  createdAt: string;
  region?: Region;
  category?: Category;
  vehicle?: Vehicle | null;
  offers?: OrderOffer[];
  customer?: {
    id: number;
    name: string;
    phone?: string | null;
  };
  carrier?: {
    id: number;
    fullName?: string | null;
  } | null;
  deal?: OrderDeal;
  dispatch?: OrderDispatch;
  returnTrip?: OrderReturnTrip;
  closingDocument?: OrderClosingDocument;
  timeline?: OrderTimelineItem[];
};

export type BootstrapPayload = {
  regions: Region[];
  categories: Category[];
  pricingRules: PricingRule[];
  vehicleTypes: VehicleTypeOption[];
};

export type CustomerOrderRequest = {
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
  adultsCount?: number;
  childrenCount?: number;
  passengersCount?: number;
  cargoDescription?: string;
  weight?: number;
  volume?: number;
  comment?: string;
};

export type QuotePayload = {
  route: {
    routeFromLat: number;
    routeFromLng: number;
    routeToLat: number;
    routeToLng: number;
    estimatedDistanceKm: number;
    estimatedDurationHours: number;
  };
  suggestedPrice: number;
};

export type CustomerReturnRequest = {
  date: string;
  routeTo?: string;
  routeToLat?: number;
  routeToLng?: number;
  comment?: string;
};

export type CarrierProfile = {
  id?: number;
  status?: string;
  fullName?: string | null;
  brand?: string | null;
  vehicleType?: string | null;
  capacity?: number | null;
  plateNumber?: string | null;
  description?: string | null;
  regionId?: number | null;
  region?: Region | null;
  carrierRegions?: {
    regionId: number;
    region: Region;
  }[];
  vehicles?: Vehicle[];
};

export type CarrierProfileUpdateRequest = {
  fullName: string;
  phone?: string;
  regionIds: number[];
};

export type CarrierRegistrationRequest = CarrierProfileUpdateRequest & {
  phone: string;
  vehicleType: string;
  brand: string;
  capacity: number;
  plateNumber: string;
  description: string;
  features?: string;
  photos?: string[];
};

export type CarrierVehicleUpsertRequest = {
  vehicleType: string;
  brand: string;
  capacity: number;
  plateNumber: string;
  description: string;
  features?: string;
  photos?: string[];
  isActive?: boolean;
};

export type CarrierOfferRequest = {
  proposedPrice: number;
  pickupEtaText?: string;
  note?: string;
};

export type CarrierDepositRequest = {
  paymentReference: string;
  note?: string;
};

export type CarrierDispatchRequest = {
  vehicleId?: number;
  driverName: string;
  driverPhone: string;
};

export type CarrierOrderStatus = "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
