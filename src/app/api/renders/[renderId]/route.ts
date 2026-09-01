import { opaquePathSegment, forwardUpstream, errorResponse } from "@/lib/batch-relay/server";
import { route } from "@/lib/batch-relay/route";

export async function GET(_: Request, { params }: { params: Promise<{ renderId: string }> }) {
  return route(async () => {
    const renderID = opaquePathSegment((await params).renderId);
    return renderID ? forwardUpstream(`/v1/renders/${renderID}`, { authorization: "studio" }) : errorResponse(400, "invalid_render_id", "render_id must be a non-empty opaque identifier.");
  });
}
