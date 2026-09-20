import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { CreativeAPIError } from "./errors";

export const CREATIVE_SESSION_COOKIE = "batch_relay_creative_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

function secret(): string | null {
  return process.env.LIVEPEER_SESSION_SECRET?.trim() || null;
}

function passcode(): string | null {
  return process.env.LIVEPEER_CREATIVE_PASSCODE?.trim() || null;
}

export function authConfigured(): boolean {
  return Boolean(secret() && passcode());
}

function signature(value: string): string {
  const configured = secret();
  if (!configured) throw new CreativeAPIError(503, "creative_auth_unconfigured", "Creative access is not configured.");
  return createHmac("sha256", configured).update(value).digest("base64url");
}

export async function hasCreativeSession(): Promise<boolean> {
  if (!authConfigured()) return false;
  const value = (await cookies()).get(CREATIVE_SESSION_COOKIE)?.value;
  if (!value) return false;
  const [expires, provided] = value.split(".");
  if (!expires || !provided || Number(expires) < Math.floor(Date.now() / 1000)) return false;
  const expected = signature(expires);
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function requireCreativeSession(): Promise<void> {
  if (!authConfigured()) throw new CreativeAPIError(503, "creative_auth_unconfigured", "Creative access is not configured.");
  if (!(await hasCreativeSession())) throw new CreativeAPIError(401, "creative_session_required", "Start an authorized creative session first.");
}

export async function establishCreativeSession(candidate: unknown): Promise<{ expiresAt: string }> {
  if (!authConfigured()) throw new CreativeAPIError(503, "creative_auth_unconfigured", "Creative access is not configured.");
  if (typeof candidate !== "string" || !candidate || candidate.length > 200) {
    throw new CreativeAPIError(400, "creative_passcode_required", "A creative access passcode is required.");
  }
  const configured = passcode() as string;
  const left = Buffer.from(candidate);
  const right = Buffer.from(configured);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new CreativeAPIError(401, "creative_passcode_invalid", "The creative access passcode is invalid.");
  }
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const value = `${expires}.${signature(String(expires))}`;
  (await cookies()).set(CREATIVE_SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return { expiresAt: new Date(expires * 1000).toISOString() };
}
