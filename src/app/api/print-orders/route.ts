import { route } from "@/lib/batch-relay/route";
import { forwardUpstream, idempotencyKey, orderAuthorization, requestJSON } from "@/lib/batch-relay/server";

export async function POST(request: Request) {
  return route(async () => {
    const body = await requestJSON(request);
    return forwardUpstream("/v1/print-orders", {
      authorization: orderAuthorization(body),
      method: "POST",
      body,
      headers: { "Idempotency-Key": idempotencyKey(request, body) },
    });
  });
}
