import { route } from "@/lib/batch-relay/route";
import { errorResponse, forwardUpstream, opaquePathSegment } from "@/lib/batch-relay/server";

export async function GET(_: Request, { params }: { params: Promise<{ orderId: string }> }) {
  return route(async () => {
    const orderID = opaquePathSegment((await params).orderId);
    return orderID?.startsWith("bro_")
      ? forwardUpstream(`/v1/print-orders/${orderID}`, { authorization: "anonymous" })
      : errorResponse(400, "invalid_order_id", "order_id must be a non-empty bro_ identifier.");
  });
}
