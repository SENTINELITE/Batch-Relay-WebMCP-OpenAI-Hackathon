import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { cookies } from "next/headers";

import type { AnonymousSessionView, BatchRelayError } from "./types";

const ANONYMOUS_COOKIE = "batch_relay_anonymous_session";
const EDGE_SESSION_PATH = "/v1/anonymous-sessions";

type UpstreamOptions = {
  authorization?: "anonymous" | "studio";
  body?: BodyInit;
  headers?: HeadersInit;
  method?: "GET" | "POST" | "PUT";
  search?: URLSearchParams;
};

export class StorefrontAPIError extends Error {
  constructor(
    readonly status: number,
    readonly body: BatchRelayError,
  ) {
    super(body.message);
  }
}

export function errorBody(code: string, message: string): BatchRelayError {
  return {
    error: message,
    code,
    message,
    docs_url: `https://docs.batchrelay.com/errors#${code}`,
    request_id: randomUUID(),
  };
}

export function errorResponse(status: number, code: string, message: string): Response {
  return Response.json(errorBody(code, message), { status, headers: { "Cache-Control": "no-store" } });
}

function configuredBaseURL(): URL {
  const raw = process.env.BATCH_RELAY_API_BASE_URL ?? "https://api.batchrelay.com";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new StorefrontAPIError(503, errorBody("batch_relay_api_unconfigured", "Batch Relay API configuration is unavailable."));
  }
  const production = process.env.NODE_ENV === "production";
  const allowedHost = url.hostname === "api.batchrelay.com" || (!production && url.hostname === "localhost");
  if (!allowedHost || (url.protocol !== "https:" && url.hostname !== "localhost") || url.username || url.password || url.search || url.hash) {
    throw new StorefrontAPIError(503, errorBody("batch_relay_api_unconfigured", "Batch Relay API configuration is unavailable."));
  }
  return url;
}

function studioBaseURL(): URL {
  return configuredBaseURL();
}

function configuredStudioToken(): string {
  const token = process.env.BATCH_RELAY_API_TOKEN?.trim();
  if (!token?.startsWith("br_test_")) throw new StorefrontAPIError(503, errorBody("studio_api_unconfigured", "Sandbox studio API access is not configured."));
  return token;
}

export function hasStudioTokenConfiguration(): boolean {
  return Boolean(process.env.BATCH_RELAY_API_TOKEN?.trim());
}

export function configuredStudioID(): string {
  const studioID = process.env.BATCH_RELAY_STUDIO_ID?.trim();
  if (!studioID) throw new StorefrontAPIError(503, errorBody("studio_api_unconfigured", "Studio API access is not configured."));
  return studioID;
}

export function configuredEventID(): string {
  const eventID = process.env.BATCH_RELAY_EVENT_ID?.trim();
  if (!eventID) throw new StorefrontAPIError(503, errorBody("studio_asset_upload_unconfigured", "Studio asset uploads are not configured."));
  return eventID;
}

function upstreamURL(path: string, search?: URLSearchParams): URL {
  const base = configuredBaseURL();
  const url = new URL(path, base);
  if (search) url.search = search.toString();
  return url;
}

function studioUpstreamURL(path: string, search?: URLSearchParams): URL {
  const base = studioBaseURL();
  const url = new URL(path, base);
  if (search) url.search = search.toString();
  return url;
}

async function anonymousToken(): Promise<string> {
  const token = (await cookies()).get(ANONYMOUS_COOKIE)?.value;
  if (!token) throw new StorefrontAPIError(401, errorBody("anonymous_session_required", "Create an anonymous sandbox session before continuing."));
  return token;
}

export async function upstream(path: string, options: UpstreamOptions = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.authorization === "studio") headers.set("Authorization", `Bearer ${configuredStudioToken()}`);
  if (options.authorization === "anonymous") headers.set("Authorization", `Bearer ${await anonymousToken()}`);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  try {
    return await fetch(options.authorization === "studio" ? studioUpstreamURL(path, options.search) : upstreamURL(path, options.search), {
      method: options.method ?? "GET",
      headers,
      body: options.body,
      cache: "no-store",
    });
  } catch {
    throw new StorefrontAPIError(503, errorBody("batch_relay_api_unavailable", "The Batch Relay API is temporarily unavailable."));
  }
}

export async function forwardUpstream(path: string, options: UpstreamOptions = {}): Promise<Response> {
  const response = await upstream(path, options);
  const headers = new Headers();
  for (const name of ["content-type", "cache-control", "etag", "retry-after", "x-request-id"]) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, headers });
}

export async function createAnonymousSession(request: Request): Promise<AnonymousSessionView> {
  // The public gateway owns the edge assertion. This storefront sends the
  // documented public request and never needs its private signing secret.
  void request;
  const response = await upstream(EDGE_SESSION_PATH, { method: "POST" });
  const body = (await response.json()) as { session_token?: unknown } & Partial<AnonymousSessionView> & BatchRelayError;
  if (!response.ok) throw new StorefrontAPIError(response.status, asError(body, response.status));
  if (typeof body.session_token !== "string" || body.environment !== "sandbox" || typeof body.expires_at !== "string" || !Array.isArray(body.scopes)) {
    throw new StorefrontAPIError(502, errorBody("anonymous_session_invalid_response", "Batch Relay could not create an anonymous session."));
  }
  const expiresAt = new Date(body.expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    throw new StorefrontAPIError(502, errorBody("anonymous_session_invalid_response", "Batch Relay could not create an anonymous session."));
  }
  (await cookies()).set(ANONYMOUS_COOKIE, body.session_token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return { environment: "sandbox", expires_at: body.expires_at, scopes: body.scopes as AnonymousSessionView["scopes"] };
}

export function requestIdempotencyKey(request: Request): string | null {
  const value = request.headers.get("Idempotency-Key")?.trim();
  return value && value.length <= 200 ? value : null;
}

/**
 * The public API requires idempotency for each state-changing operation. A
 * caller-provided key wins; otherwise this stable digest covers the exact
 * already-validated JSON bytes without adding or changing business fields.
 */
export function idempotencyKey(request: Request, json: string): string {
  return requestIdempotencyKey(request) ?? `webmcp-${createHash("sha256").update(json).digest("hex")}`;
}

export async function requestJSON(request: Request): Promise<string> {
  const text = await request.text();
  if (!text) throw new StorefrontAPIError(400, errorBody("invalid_request_json", "Request JSON is required."));
  try {
    JSON.parse(text);
  } catch {
    throw new StorefrontAPIError(400, errorBody("invalid_request_json", "Request JSON is invalid."));
  }
  return text;
}

export async function managedAssetJSON(request: Request): Promise<string> {
  const text = await requestJSON(request);
  const body = JSON.parse(text) as unknown;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new StorefrontAPIError(400, errorBody("invalid_asset_ingestion_request", "Provide exactly one of url or asset_id."));
  }
  const candidate = body as { url?: unknown; asset_id?: unknown; original_filename?: unknown };
  if (Object.keys(candidate).some((key) => key !== "url" && key !== "asset_id" && key !== "original_filename")) {
    throw new StorefrontAPIError(400, errorBody("invalid_asset_ingestion_request", "Provide exactly one of url or asset_id."));
  }
  const hasURL = typeof candidate.url === "string" && Boolean(candidate.url.trim());
  const hasAssetID = typeof candidate.asset_id === "string" && Boolean(candidate.asset_id.trim());
  const validFilename = candidate.original_filename === undefined || (typeof candidate.original_filename === "string" && candidate.original_filename.length <= 255);
  if (hasURL === hasAssetID || !validFilename) throw new StorefrontAPIError(400, errorBody("invalid_asset_ingestion_request", "Provide exactly one of url or asset_id."));
  return text;
}

export function asError(value: unknown, status: number): BatchRelayError {
  if (value && typeof value === "object" && "error" in value && "code" in value && "message" in value && "docs_url" in value && "request_id" in value) {
    return value as BatchRelayError;
  }
  return errorBody("batch_relay_api_error", `The Batch Relay API returned HTTP ${status}.`);
}

export function opaquePathSegment(value: string): string | null {
  const trimmed = value.trim();
  return trimmed && !trimmed.includes("/") ? encodeURIComponent(trimmed) : null;
}
