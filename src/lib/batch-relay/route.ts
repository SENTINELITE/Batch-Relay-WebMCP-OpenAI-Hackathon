import { StorefrontAPIError, errorResponse } from "./server";

export async function route(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof StorefrontAPIError) return Response.json(error.body, { status: error.status, headers: { "Cache-Control": "no-store" } });
    return errorResponse(503, "storefront_route_unavailable", "This Batch Relay storefront operation is temporarily unavailable.");
  }
}

export function boundedQuery(searchParams: URLSearchParams, allowed: readonly string[]): URLSearchParams {
  const query = new URLSearchParams();
  for (const key of allowed) {
    const values = searchParams.getAll(key);
    if (values.length === 1 && values[0]) query.set(key, values[0]);
  }
  return query;
}
