import { randomUUID } from "node:crypto";

export class CreativeAPIError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CreativeAPIError";
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof CreativeAPIError) {
    return Response.json(
      { error: error.message, code: error.code, request_id: randomUUID() },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  return Response.json(
    { error: "The creative service is temporarily unavailable.", code: "creative_service_unavailable", request_id: randomUUID() },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

export function assert(condition: unknown, status: number, code: string, message: string): asserts condition {
  if (!condition) throw new CreativeAPIError(status, code, message);
}

export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new CreativeAPIError(400, "invalid_request_json", "Request JSON is invalid.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CreativeAPIError(400, "invalid_request_json", "Request JSON must be an object.");
  }
  return value as Record<string, unknown>;
}
