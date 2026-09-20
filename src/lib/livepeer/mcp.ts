import "server-only";

import { assert, CreativeAPIError } from "./errors";
import type { ProviderToolResult } from "./types";

const PROTOCOL_VERSION = "2025-03-26";
const REQUEST_TIMEOUT_MS = 25_000;

type JSONRPCResponse = {
  jsonrpc?: string;
  id?: number | string;
  result?: ProviderToolResult;
  error?: { code?: number; message?: string; data?: unknown };
};

function endpointURL(): URL {
  const raw = process.env.LIVEPEER_MCP_URL?.trim();
  if (!raw) throw new CreativeAPIError(503, "livepeer_unconfigured", "Livepeer Creative is not configured.");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CreativeAPIError(503, "livepeer_unconfigured", "Livepeer Creative is not configured.");
  }
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if ((process.env.NODE_ENV === "production" && (url.protocol !== "https:" || isLocal)) ||
      (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && isLocal)) ||
      url.username || url.password || url.search || url.hash) {
    throw new CreativeAPIError(503, "livepeer_unconfigured", "Livepeer Creative is not configured.");
  }
  return url;
}

export function isLivepeerConfigured(): boolean {
  try {
    endpointURL();
    return true;
  } catch {
    return false;
  }
}

function providerHeaders(sessionID?: string, protocolVersion?: string): Headers {
  const headers = new Headers({
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  });
  const token = process.env.LIVEPEER_API_KEY?.trim();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (sessionID) headers.set("Mcp-Session-Id", sessionID);
  if (protocolVersion) headers.set("MCP-Protocol-Version", protocolVersion);
  return headers;
}

async function parseResponse(response: Response, body?: string): Promise<JSONRPCResponse> {
  const text = body ?? await response.text();
  if (!text) throw new CreativeAPIError(502, "livepeer_empty_response", "Livepeer Creative returned an empty response.");
  if (response.headers.get("content-type")?.includes("text/event-stream") || /^\s*data:/m.test(text)) {
    const events = text.split(/\r?\n\r?\n/).flatMap((event) => event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()));
    const jsonText = [...events].reverse().find((value) => value && value !== "[DONE]");
    if (!jsonText) throw new CreativeAPIError(502, "livepeer_invalid_response", "Livepeer Creative returned no MCP result.");
    try {
      return JSON.parse(jsonText) as JSONRPCResponse;
    } catch {
      throw new CreativeAPIError(502, "livepeer_invalid_response", "Livepeer Creative returned an invalid MCP result.");
    }
  }
  try {
    return JSON.parse(text) as JSONRPCResponse;
  } catch {
    throw new CreativeAPIError(502, "livepeer_invalid_response", "Livepeer Creative returned an invalid MCP result.");
  }
}

async function request(payload: Record<string, unknown>, sessionID?: string, protocolVersion?: string, allowEmpty = false): Promise<{ response?: JSONRPCResponse; sessionID?: string; protocolVersion?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(endpointURL(), {
      method: "POST",
      headers: providerHeaders(sessionID, protocolVersion),
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: controller.signal,
    });
    const responseSessionID = response.headers.get("mcp-session-id") ?? response.headers.get("Mcp-Session-Id") ?? sessionID;
    if (!response.ok) {
      throw new CreativeAPIError(502, "livepeer_provider_error", "Livepeer Creative rejected the MCP request.");
    }
    const responseProtocolVersion = response.headers.get("mcp-protocol-version") ?? protocolVersion;
    const body = await response.text();
    if (allowEmpty && (response.status === 202 || !body.trim())) {
      return { sessionID: responseSessionID ?? undefined, protocolVersion: responseProtocolVersion ?? undefined };
    }
    return { response: await parseResponse(response, body), sessionID: responseSessionID ?? undefined, protocolVersion: responseProtocolVersion ?? undefined };
  } catch (error) {
    if (error instanceof CreativeAPIError) throw error;
    const message = error instanceof DOMException && error.name === "AbortError"
      ? "Livepeer Creative did not respond in time."
      : "Livepeer Creative is temporarily unavailable.";
    throw new CreativeAPIError(503, "livepeer_unavailable", message);
  } finally {
    clearTimeout(timer);
  }
}

function assertRPC(response: JSONRPCResponse): ProviderToolResult {
  if (response.error) {
    throw new CreativeAPIError(502, "livepeer_tool_error", "Livepeer Creative could not complete the MCP operation.");
  }
  if (!response.result || response.result.isError) {
    throw new CreativeAPIError(502, "livepeer_tool_error", "Livepeer Creative could not complete the MCP operation.");
  }
  return response.result;
}

/**
 * Calls an MCP tool over the provider's MCP endpoint. This deliberately uses
 * initialize + notifications/initialized + tools/call rather than guessing at
 * an HTTP vendor API. A fresh protocol session per request also works with
 * stateless MCP gateways and avoids retaining provider credentials in memory.
 */
export async function callLivepeerTool(name: string, arguments_: Record<string, unknown>): Promise<ProviderToolResult> {
  const initialized = await request({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "batch-relay-creative", version: "0.1.0" },
    },
  });
  const sessionID = initialized.sessionID;
  assert(initialized.response, 502, "livepeer_invalid_response", "Livepeer Creative did not complete MCP initialization.");
  assertRPC(initialized.response);
  const protocolVersion = initialized.protocolVersion ?? PROTOCOL_VERSION;
  await request({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }, sessionID, protocolVersion, true);
  const result = await request({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name, arguments: arguments_ },
  }, sessionID, protocolVersion);
  assert(result.response, 502, "livepeer_invalid_response", "Livepeer Creative did not return an MCP result.");
  return assertRPC(result.response);
}

export function providerValue(result: ProviderToolResult): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent;
  for (const item of result.content ?? []) {
    if (item.type === "text" && item.text) {
      try { return JSON.parse(item.text); } catch { /* The provider may return human text alongside structured data. */ }
    }
  }
  return result;
}

export function providerHost(): string {
  return endpointURL().hostname;
}
