import https from "node:https";
import { URL } from "node:url";
import { HttpsProxyAgent } from "https-proxy-agent";
import { config } from "../config";

type Coordinate = {
  lat: number;
  lng: number;
};

type EstimateRouteInput = {
  routeFrom: string;
  routeFromLat?: number;
  routeFromLng?: number;
  routeTo: string;
  routeToLat?: number;
  routeToLng?: number;
  regionName?: string;
};

type GeocoderSearchResult = {
  lat: string;
  lon: string;
};

type OsrmRouteResponse = {
  code?: string;
  routes?: Array<{
    distance: number;
    duration: number;
  }>;
};

const proxyAgent = config.routingProxyUrl ? new HttpsProxyAgent(config.routingProxyUrl) : undefined;

const roundDistanceKm = (distanceMeters: number) => Math.max(1, Math.round(distanceMeters / 100) / 10);
const roundDurationHours = (durationSeconds: number) => Math.max(0.5, Math.round(durationSeconds / 360) / 10);

const unique = <T>(values: T[]) => Array.from(new Set(values));

export class RouteEstimationError extends Error {
  constructor(public code: "ROUTE_FROM_NOT_FOUND" | "ROUTE_TO_NOT_FOUND" | "ROUTE_NOT_FOUND" | "ROUTE_SERVICE_ERROR", message: string) {
    super(message);
  }
}

export class RouteService {
  async estimateRoute(input: EstimateRouteInput) {
    const from = await this.resolvePoint("from", input.routeFrom, input.regionName, input.routeFromLat, input.routeFromLng);
    const to = await this.resolvePoint("to", input.routeTo, input.regionName, input.routeToLat, input.routeToLng);

    const routeUrl = new URL(`${config.routingApiUrl}/${from.lng},${from.lat};${to.lng},${to.lat}`);
    routeUrl.searchParams.set("overview", "false");
    routeUrl.searchParams.set("steps", "false");
    routeUrl.searchParams.set("alternatives", "false");

    const payload = await this.requestJson<OsrmRouteResponse>(routeUrl);
    const route = payload.routes?.[0];

    if (payload.code !== "Ok" || !route) {
      throw new RouteEstimationError(
        "ROUTE_NOT_FOUND",
        "Не удалось построить маршрут между этими точками. Уточните адреса или отправьте точки с карты."
      );
    }

    return {
      routeFromLat: from.lat,
      routeFromLng: from.lng,
      routeToLat: to.lat,
      routeToLng: to.lng,
      estimatedDistanceKm: roundDistanceKm(route.distance),
      estimatedDurationHours: roundDurationHours(route.duration),
    };
  }

  private async resolvePoint(
    point: "from" | "to",
    address: string,
    regionName?: string,
    lat?: number,
    lng?: number
  ): Promise<Coordinate> {
    if (typeof lat === "number" && typeof lng === "number") {
      return { lat, lng };
    }

    const queries = unique(
      [
        regionName ? `${address}, ${regionName}, Россия` : undefined,
        `${address}, Россия`,
        address,
      ].filter(Boolean) as string[]
    );

    for (const query of queries) {
      const url = new URL(config.routingGeocoderUrl);
      url.searchParams.set("format", "jsonv2");
      url.searchParams.set("limit", "1");
      url.searchParams.set("countrycodes", "ru");
      url.searchParams.set("q", query);

      const results = await this.requestJson<GeocoderSearchResult[]>(url);
      const first = results[0];
      if (first) {
        const resolvedLat = Number(first.lat);
        const resolvedLng = Number(first.lon);
        if (Number.isFinite(resolvedLat) && Number.isFinite(resolvedLng)) {
          return { lat: resolvedLat, lng: resolvedLng };
        }
      }
    }

    if (point === "from") {
      throw new RouteEstimationError(
        "ROUTE_FROM_NOT_FOUND",
        "Не удалось определить точку отправления. Уточните адрес или отправьте точку с карты."
      );
    }

    throw new RouteEstimationError(
      "ROUTE_TO_NOT_FOUND",
      "Не удалось определить точку назначения. Уточните адрес или отправьте точку с карты."
    );
  }

  private async requestJson<T>(url: URL): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const request = https.request(
        url,
        {
          method: "GET",
          agent: proxyAgent,
          headers: {
            Accept: "application/json",
            "Accept-Language": "ru",
            "User-Agent": config.routingUserAgent,
          },
          timeout: 15000,
        },
        (response) => {
          const chunks: Buffer[] = [];

          response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          response.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            const status = response.statusCode ?? 500;

            if (status < 200 || status >= 300) {
              reject(new RouteEstimationError("ROUTE_SERVICE_ERROR", `Сервис маршрутов временно недоступен (${status}). Попробуйте еще раз.`));
              return;
            }

            try {
              resolve(JSON.parse(body) as T);
            } catch {
              reject(new RouteEstimationError("ROUTE_SERVICE_ERROR", "Сервис маршрутов вернул некорректный ответ. Попробуйте еще раз."));
            }
          });
        }
      );

      request.on("timeout", () => request.destroy(new RouteEstimationError("ROUTE_SERVICE_ERROR", "Сервис маршрутов не ответил вовремя. Попробуйте еще раз.")));
      request.on("error", (error) => reject(error instanceof RouteEstimationError ? error : new RouteEstimationError("ROUTE_SERVICE_ERROR", "Не удалось связаться с сервисом маршрутов.")));
      request.end();
    });
  }
}
