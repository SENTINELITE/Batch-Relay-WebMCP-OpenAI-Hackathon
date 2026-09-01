import { opaquePathSegment, forwardUpstream, errorResponse } from "@/lib/batch-relay/server";
import { route } from "@/lib/batch-relay/route";

export async function GET(_: Request, { params }: { params: Promise<{ productId: string }> }) {
  return route(async () => {
    const productID = opaquePathSegment((await params).productId);
    return productID ? forwardUpstream(`/v1/catalog/products/${productID}/offers`) : errorResponse(400, "invalid_product_id", "product_id must be a non-empty opaque identifier.");
  });
}
