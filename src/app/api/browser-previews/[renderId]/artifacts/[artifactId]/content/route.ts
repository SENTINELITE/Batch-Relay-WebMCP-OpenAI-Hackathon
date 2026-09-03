import { route } from "@/lib/batch-relay/route";
import { opaquePathSegment, forwardUpstream, errorResponse } from "@/lib/batch-relay/server";

export async function GET(_: Request, { params }: { params: Promise<{ renderId: string; artifactId: string }> }) {
  return route(async () => {
    const { renderId, artifactId } = await params;
    const renderID = opaquePathSegment(renderId);
    const artifactID = opaquePathSegment(artifactId);
    return renderID && artifactID
      ? forwardUpstream(`/v1/browser-previews/${renderID}/artifacts/${artifactID}/content`, { authorization: "studio" })
      : errorResponse(400, "invalid_browser_preview_artifact_request", "render_id and artifact_id must be non-empty opaque identifiers.");
  });
}
