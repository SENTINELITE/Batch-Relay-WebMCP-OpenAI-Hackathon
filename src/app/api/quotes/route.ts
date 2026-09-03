import { route } from "@/lib/batch-relay/route";
import { forwardUpstream, idempotencyKey, requestJSON } from "@/lib/batch-relay/server";

/** Same-origin storefront alias for the published POST /v1/print-orders/quote operation. */
export async function POST(request: Request) {
  return route(async () => {
    const body = await requestJSON(request);
    return forwardUpstream("/v1/print-orders/quote", {
      authorization: "anonymous",
      method: "POST",
      body,
      headers: { "Idempotency-Key": idempotencyKey(request, body) },
    });
  });
}
