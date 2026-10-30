import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

type CliOptions = {
  baseUrl: string;
};

type RequestResult<T = any> = {
  ok: boolean;
  status: number;
  json: T | null;
};

type ReportEntry = {
  name: string;
  status: number;
  ok: boolean;
  expectOk: boolean;
  error: string | null;
};

const backendDir = process.cwd();
const rootDir = path.resolve(backendDir, "..");
const qaLogsDir = path.resolve(rootDir, "sales", "logs", "qa");

const loadEnv = () => {
  for (const candidate of [path.resolve(backendDir, ".env"), path.resolve(rootDir, ".env")]) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate, override: false });
    }
  }
};

const ensureDir = (dirPath: string) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const nowStamp = () => {
  const now = new Date();
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
};

const buildFutureLocalDate = (daysAhead: number, hour: number, minute = 0) => {
  const target = new Date();
  target.setDate(target.getDate() + daysAhead);
  target.setHours(hour, minute, 0, 0);
  return target.toISOString();
};

const parseArgs = (argv: string[]): CliOptions => {
  const port = process.env.PORT?.trim() || "3000";
  const options: CliOptions = {
    baseUrl: `http://127.0.0.1:${port}`,
  };

  for (const arg of argv) {
    if (arg.startsWith("--base-url=")) {
      const value = arg.slice("--base-url=".length).trim();
      if (value) {
        options.baseUrl = value.replace(/\/$/, "");
      }
    }
  }

  return options;
};

const request = async <T>(url: string, options?: RequestInit): Promise<RequestResult<T>> => {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });

  const text = await response.text();
  let json: T | null = null;

  try {
    json = text ? (JSON.parse(text) as T) : null;
  } catch {
    json = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    json,
  };
};

const getErrorMessage = (result: RequestResult<any>) => {
  if (result.json && typeof result.json === "object" && "error" in result.json) {
    const payload = result.json as { error?: unknown };
    return typeof payload.error === "string" ? payload.error : null;
  }

  return null;
};

const main = async () => {
  loadEnv();
  ensureDir(qaLogsDir);

  const options = parseArgs(process.argv.slice(2));
  const mobileBase = `${options.baseUrl}/mobile`;
  const adminBase = `${options.baseUrl}/admin`;
  const adminSecret = process.env.ADMIN_SECRET ?? "localsecret";
  const stamp = Date.now().toString().slice(-6);
  const phoneSuffix = `${Date.now().toString().slice(-4)}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
  const customerPhone = `+7999${phoneSuffix}`;
  const carrierPhone = `+7998${phoneSuffix}`;
  const report: ReportEntry[] = [];
  const reportPath = path.resolve(qaLogsDir, `hard-qa-${nowStamp()}.json`);

  const record = (name: string, result: RequestResult<any>, expectOk: boolean, expectedStatus: number) => {
    const entry: ReportEntry = {
      name,
      status: result.status,
      ok: result.ok,
      expectOk,
      error: getErrorMessage(result),
    };
    report.push(entry);

    if (result.status !== expectedStatus) {
      throw new Error(`${name}: expected status ${expectedStatus}, got ${result.status}${entry.error ? ` (${entry.error})` : ""}`);
    }

    if (expectOk && !result.ok) {
      throw new Error(`${name}: expected success, got ${result.status}${entry.error ? ` (${entry.error})` : ""}`);
    }

    if (!expectOk && result.ok) {
      throw new Error(`${name}: expected failure, but request succeeded`);
    }
  };

  const finalize = (status: "passed" | "failed", extra?: Record<string, unknown>) => {
    const payload = {
      status,
      generatedAt: new Date().toISOString(),
      baseUrl: options.baseUrl,
      customerPhone,
      carrierPhone,
      report,
      ...extra,
    };
    fs.writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return reportPath;
  };

  try {
    const bootstrap = await request<any>(`${mobileBase}/bootstrap`);
    record("bootstrap", bootstrap, true, 200);
    const regionId = bootstrap.json?.regions?.[0]?.id;
    const categoryId = bootstrap.json?.categories?.[0]?.id;
    const vehicleType = "MINIVAN";

    if (!regionId || !categoryId) {
      throw new Error("Bootstrap did not return regions or categories");
    }

    const customerChallenge = await request<any>(`${mobileBase}/auth/challenge`, {
      method: "POST",
      body: JSON.stringify({
        role: "CUSTOMER",
        name: `QA Customer ${stamp}`,
        phone: customerPhone,
      }),
    });
    record("customer challenge", customerChallenge, true, 200);

    const customerVerify = await request<any>(`${mobileBase}/auth/verify`, {
      method: "POST",
      body: JSON.stringify({
        challengeId: customerChallenge.json?.challengeId,
        code: customerChallenge.json?.debugCode,
        deviceId: `cust-${stamp}`,
        deviceName: "QA Customer Device",
        platform: "qa",
      }),
    });
    record("customer verify", customerVerify, true, 200);
    const customerToken = customerVerify.json?.accessToken as string;

    const carrierChallenge = await request<any>(`${mobileBase}/auth/challenge`, {
      method: "POST",
      body: JSON.stringify({
        role: "CARRIER",
        name: `QA Carrier ${stamp}`,
        phone: carrierPhone,
      }),
    });
    record("carrier challenge", carrierChallenge, true, 200);

    const carrierVerify = await request<any>(`${mobileBase}/auth/verify`, {
      method: "POST",
      body: JSON.stringify({
        challengeId: carrierChallenge.json?.challengeId,
        code: carrierChallenge.json?.debugCode,
        deviceId: `carrier-${stamp}`,
        deviceName: "QA Carrier Device",
        platform: "qa",
      }),
    });
    record("carrier verify", carrierVerify, true, 200);
    const carrierToken = carrierVerify.json?.accessToken as string;

    record(
      "carrier open orders before register rejected",
      await request(`${mobileBase}/carrier/orders/open`, {
        headers: { Authorization: `Bearer ${carrierToken}` },
      }),
      false,
      403
    );

    const carrierRegister = await request<any>(`${mobileBase}/carrier/register`, {
      method: "POST",
      headers: { Authorization: `Bearer ${carrierToken}` },
      body: JSON.stringify({
        fullName: `QA Carrier ${stamp}`,
        phone: carrierPhone,
        regionIds: [regionId],
        vehicleType,
        brand: "QA Sprinter",
        capacity: 8,
        plateNumber: `QA${stamp}`,
        description: "QA fleet vehicle",
        features: "AC, seat belts",
      }),
    });
    record("carrier register", carrierRegister, true, 200);
    const carrierId = carrierRegister.json?.id as number;
    const vehicleId = carrierRegister.json?.vehicles?.[0]?.id as number | undefined;

    record(
      "carrier open orders before approve rejected",
      await request(`${mobileBase}/carrier/orders/open`, {
        headers: { Authorization: `Bearer ${carrierToken}` },
      }),
      false,
      403
    );

    record(
      "admin approve carrier",
      await request(`${adminBase}/carriers/${carrierId}/approve`, {
        method: "POST",
        headers: { "x-admin-secret": adminSecret },
      }),
      true,
      200
    );

    const validOrderPayload = {
      regionId,
      categoryId,
      vehicleType,
      routeFrom: "Kazan Kremlin",
      routeFromLat: 55.798551,
      routeFromLng: 49.106324,
      routeTo: "Innopolis University",
      routeToLat: 55.7522,
      routeToLng: 48.7446,
      date: buildFutureLocalDate(4, 14),
      adultsCount: 2,
      childrenCount: 1,
      passengersCount: 3,
      comment: "QA hard flow main trip",
    };

    record(
      "customer quote",
      await request(`${mobileBase}/customer/orders/quote`, {
        method: "POST",
        headers: { Authorization: `Bearer ${customerToken}` },
        body: JSON.stringify(validOrderPayload),
      }),
      true,
      200
    );

    record(
      "child trip short lead rejected",
      await request(`${mobileBase}/customer/orders/quote`, {
        method: "POST",
        headers: { Authorization: `Bearer ${customerToken}` },
        body: JSON.stringify({
          ...validOrderPayload,
          date: buildFutureLocalDate(0, 14),
          adultsCount: 1,
          childrenCount: 1,
          passengersCount: 2,
        }),
      }),
      false,
      400
    );

    const createdOrder = await request<any>(`${mobileBase}/customer/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${customerToken}` },
      body: JSON.stringify(validOrderPayload),
    });
    record("customer create order", createdOrder, true, 200);
    const orderId = createdOrder.json?.id as number;

    record(
      "carrier open orders after approve",
      await request(`${mobileBase}/carrier/orders/open`, {
        headers: { Authorization: `Bearer ${carrierToken}` },
      }),
      true,
      200
    );

    const createdOffer = await request<any>(`${mobileBase}/carrier/orders/${orderId}/offer`, {
      method: "POST",
      headers: { Authorization: `Bearer ${carrierToken}` },
      body: JSON.stringify({
        proposedPrice: Math.max(1000, Math.round((createdOrder.json?.price ?? 12000) * 0.97)),
        pickupEtaText: "20 min",
        note: "QA offer",
      }),
    });
    record("carrier create offer", createdOffer, true, 200);
    const offerId = createdOffer.json?.id as number;

    record(
      "customer accept offer",
      await request(`${mobileBase}/customer/offers/${offerId}/accept`, {
        method: "POST",
        headers: { Authorization: `Bearer ${customerToken}` },
      }),
      true,
      200
    );

    record(
      "repeat accept rejected",
      await request(`${mobileBase}/customer/offers/${offerId}/accept`, {
        method: "POST",
        headers: { Authorization: `Bearer ${customerToken}` },
      }),
      false,
      409
    );

    record(
      "carrier submit deposit",
      await request(`${mobileBase}/carrier/orders/${orderId}/deposit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${carrierToken}` },
        body: JSON.stringify({
          paymentReference: `QA-PAY-${stamp}`,
          note: "QA deposit note",
        }),
      }),
      true,
      200
    );

    record(
      "resubmit deposit rejected",
      await request(`${mobileBase}/carrier/orders/${orderId}/deposit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${carrierToken}` },
        body: JSON.stringify({
          paymentReference: `QA-PAY-${stamp}-2`,
        }),
      }),
      false,
      409
    );

    record(
      "admin reject deposit",
      await request(`${adminBase}/orders/${orderId}/deposit/reject`, {
        method: "POST",
        headers: { "x-admin-secret": adminSecret },
        body: JSON.stringify({ note: "QA reject once" }),
      }),
      true,
      200
    );

    record(
      "carrier resubmit after reject",
      await request(`${mobileBase}/carrier/orders/${orderId}/deposit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${carrierToken}` },
        body: JSON.stringify({
          paymentReference: `QA-PAY-${stamp}-RETRY`,
          note: "QA retry deposit",
        }),
      }),
      true,
      200
    );

    record(
      "admin verify deposit",
      await request(`${adminBase}/orders/${orderId}/deposit/verify`, {
        method: "POST",
        headers: { "x-admin-secret": adminSecret },
        body: JSON.stringify({ note: "QA verified" }),
      }),
      true,
      200
    );

    record(
      "assign dispatch after verify",
      await request(`${mobileBase}/carrier/orders/${orderId}/dispatch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${carrierToken}` },
        body: JSON.stringify({
          vehicleId,
          driverName: "QA Driver",
          driverPhone: "+79990000001",
        }),
      }),
      true,
      200
    );

    record(
      "set in progress",
      await request(`${mobileBase}/carrier/orders/${orderId}/status`, {
        method: "POST",
        headers: { Authorization: `Bearer ${carrierToken}` },
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      }),
      true,
      200
    );

    const returnOrder = await request<any>(`${mobileBase}/customer/orders/${orderId}/return`, {
      method: "POST",
      headers: { Authorization: `Bearer ${customerToken}` },
      body: JSON.stringify({
        date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        routeTo: "Kazan Kremlin",
        routeToLat: 55.798551,
        routeToLng: 49.106324,
        comment: "QA return trip",
      }),
    });
    record("request return trip", returnOrder, true, 200);

    record(
      "duplicate return rejected",
      await request(`${mobileBase}/customer/orders/${orderId}/return`, {
        method: "POST",
        headers: { Authorization: `Bearer ${customerToken}` },
        body: JSON.stringify({
          date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
          routeTo: "Kazan Kremlin",
        }),
      }),
      false,
      409
    );

    const finalPath = finalize("passed", {
      orderId,
      returnOrderId: returnOrder.json?.id ?? null,
    });
    console.log(`Hard QA passed: ${finalPath}`);
  } catch (error) {
    const finalPath = finalize("failed", {
      failure: error instanceof Error ? error.message : String(error),
    });
    console.error(`Hard QA failed: ${finalPath}`);
    throw error;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
