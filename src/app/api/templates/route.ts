import { boundedQuery, route } from "@/lib/batch-relay/route";
import { configuredStudioID, forwardUpstream } from "@/lib/batch-relay/server";

export async function GET(request: Request) {
  return route(() => forwardUpstream(`/v1/studios/${encodeURIComponent(configuredStudioID())}/templates`, {
    authorization: "studio",
    search: boundedQuery(new URL(request.url).searchParams, ["cursor", "limit", "status"]),
  }));
}
