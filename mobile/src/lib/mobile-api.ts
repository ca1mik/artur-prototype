import { Platform } from "react-native";
import type {
  AuthChallenge,
  AuthChallengeRequest,
  AuthSession,
  AuthVerifyRequest,
  BootstrapPayload,
  CarrierDepositRequest,
  CarrierDispatchRequest,
  CarrierOfferRequest,
  CarrierOrderStatus,
  CarrierProfile,
  CarrierProfileUpdateRequest,
  CarrierRegistrationRequest,
  CarrierVehicleUpsertRequest,
  CustomerOrderRequest,
  CustomerReturnRequest,
  MobileSessionUser,
  Order,
  OrderOffer,
  QuotePayload,
  Vehicle,
} from "./mobile-types";

const FALLBACK_BASE_URL =
  Platform.OS === "android" ? "http://10.0.2.2:3201" : "http://127.0.0.1:3201";

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL?.trim() || FALLBACK_BASE_URL;

type RequestOptions = {
  method?: "GET" | "POST" | "PUT";
  token?: string | null;
  body?: unknown;
};

const parsePayload = <T>(text: string): ({ error?: string } & T) | null => {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as { error?: string } & T;
  } catch {
    return null;
  }
};

const request = async <T>(path: string, options?: RequestOptions): Promise<T> => {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options?.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options?.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new Error("Не удалось подключиться к серверу. Проверьте адрес API и соединение.");
  }

  const text = await response.text();
  const payload = parsePayload<T>(text);

  if (!response.ok) {
    const fallbackMessage = text.trim() || "Не удалось выполнить запрос к серверу";
    const error = new Error(payload?.error ?? fallbackMessage) as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
  }

  return (payload ?? ({} as T)) as T;
};

export const mobileApi = {
  bootstrap: () => request<BootstrapPayload>("/mobile/bootstrap"),
  requestChallenge: (payload: AuthChallengeRequest) =>
    request<AuthChallenge>("/mobile/auth/challenge", { method: "POST", body: payload }),
  verifyChallenge: (payload: AuthVerifyRequest) =>
    request<AuthSession>("/mobile/auth/verify", { method: "POST", body: payload }),
  refreshSession: (refreshToken: string) =>
    request<AuthSession>("/mobile/auth/refresh", { method: "POST", body: { refreshToken } }),
  logout: (token: string) => request<void>("/mobile/auth/logout", { method: "POST", token }),
  me: (token: string) => request<MobileSessionUser>("/mobile/me", { token }),
  customer: {
    quote: (token: string, payload: CustomerOrderRequest) =>
      request<QuotePayload>("/mobile/customer/orders/quote", { method: "POST", token, body: payload }),
    createOrder: (token: string, payload: CustomerOrderRequest) =>
      request<Order>("/mobile/customer/orders", { method: "POST", token, body: payload }),
    listOrders: (token: string) => request<Order[]>("/mobile/customer/orders", { token }),
    listOffers: (token: string, orderId: number) =>
      request<OrderOffer[]>(`/mobile/customer/orders/${orderId}/offers`, { token }),
    acceptOffer: (token: string, offerId: number) =>
      request<Order>(`/mobile/customer/offers/${offerId}/accept`, { method: "POST", token }),
    rejectOffer: (token: string, offerId: number) =>
      request<OrderOffer>(`/mobile/customer/offers/${offerId}/reject`, { method: "POST", token }),
    counterOffer: (token: string, offerId: number, proposedPrice: number) =>
      request<OrderOffer>(`/mobile/customer/offers/${offerId}/counter`, {
        method: "POST",
        token,
        body: { proposedPrice },
      }),
    requestReturn: (token: string, orderId: number, payload: CustomerReturnRequest) =>
      request<Order>(`/mobile/customer/orders/${orderId}/return`, { method: "POST", token, body: payload }),
  },
  carrier: {
    profile: (token: string) => request<CarrierProfile>("/mobile/carrier/profile", { token }),
    updateProfile: (token: string, payload: CarrierProfileUpdateRequest) =>
      request<CarrierProfile>("/mobile/carrier/profile", { method: "PUT", token, body: payload }),
    register: (token: string, payload: CarrierRegistrationRequest) =>
      request<CarrierProfile>("/mobile/carrier/register", { method: "POST", token, body: payload }),
    vehicles: (token: string) => request<Vehicle[]>("/mobile/carrier/vehicles", { token }),
    addVehicle: (token: string, payload: CarrierVehicleUpsertRequest) =>
      request<Vehicle>("/mobile/carrier/vehicles", { method: "POST", token, body: payload }),
    updateVehicle: (token: string, vehicleId: number, payload: CarrierVehicleUpsertRequest) =>
      request<Vehicle>(`/mobile/carrier/vehicles/${vehicleId}`, { method: "PUT", token, body: payload }),
    openOrders: (token: string) => request<Order[]>("/mobile/carrier/orders/open", { token }),
    activeOrders: (token: string) => request<Order[]>("/mobile/carrier/orders/active", { token }),
    historyOrders: (token: string) => request<Order[]>("/mobile/carrier/orders/history", { token }),
    createOffer: (token: string, orderId: number, payload: CarrierOfferRequest) =>
      request<OrderOffer>(`/mobile/carrier/orders/${orderId}/offer`, { method: "POST", token, body: payload }),
    submitDeposit: (token: string, orderId: number, payload: CarrierDepositRequest) =>
      request<Order>(`/mobile/carrier/orders/${orderId}/deposit`, { method: "POST", token, body: payload }),
    assignDispatch: (token: string, orderId: number, payload: CarrierDispatchRequest) =>
      request<Order>(`/mobile/carrier/orders/${orderId}/dispatch`, { method: "POST", token, body: payload }),
    updateOrderStatus: (token: string, orderId: number, status: CarrierOrderStatus) =>
      request<Order>(`/mobile/carrier/orders/${orderId}/status`, { method: "POST", token, body: { status } }),
  },
};
