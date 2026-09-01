import { forwardUpstream } from "@/lib/batch-relay/server";
import { route } from "@/lib/batch-relay/route";

export async function GET() {
  return route(() => forwardUpstream("/v1/catalog/products"));
}
