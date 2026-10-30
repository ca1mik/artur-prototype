"use server";

import { revalidatePath } from "next/cache";

import { readServerEnv } from "../lib/serverEnv";

const resolveAdminConfig = () => {
  const port = readServerEnv("PORT") ?? "3000";
  const baseUrl = readServerEnv("ADMIN_API_URL") ?? `http://127.0.0.1:${port}/admin`;
  const secret = readServerEnv("ADMIN_API_SECRET") ?? readServerEnv("ADMIN_SECRET") ?? "";

  return { baseUrl, secret };
};

const parseNote = (formData: FormData) => {
  const raw = formData.get("note");
  return typeof raw === "string" ? raw.trim() : "";
};

const extractErrorMessage = async (response: Response) => {
  const text = await response.text();
  if (!text) {
    return `Admin API responded with ${response.status}`;
  }

  try {
    const payload = JSON.parse(text) as { error?: string };
    return payload.error ?? text;
  } catch {
    return text;
  }
};

const postAdminAction = async (endpoint: string, note: string) => {
  const { baseUrl, secret } = resolveAdminConfig();

  if (!secret) {
    throw new Error("Admin secret is not configured.");
  }

  let response: Response;

  try {
    response = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-secret": secret,
      },
      body: JSON.stringify({ note: note || undefined }),
      cache: "no-store",
    });
  } catch {
    throw new Error(`Cannot reach admin API at ${baseUrl}.`);
  }

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response));
  }

  revalidatePath("/");
};

export const verifyDepositAction = async (orderId: number, formData: FormData) => {
  const note = parseNote(formData);
  await postAdminAction(`/orders/${orderId}/deposit/verify`, note);
};

export const rejectDepositAction = async (orderId: number, formData: FormData) => {
  const note = parseNote(formData);
  await postAdminAction(`/orders/${orderId}/deposit/reject`, note);
};
