import { opaquePathSegment, configuredStudioID, forwardUpstream, errorResponse } from "@/lib/batch-relay/server";
import { route } from "@/lib/batch-relay/route";

export async function GET(_: Request, { params }: { params: Promise<{ templateId: string }> }) {
  return route(async () => {
    const templateID = opaquePathSegment((await params).templateId);
    return templateID ? forwardUpstream(`/v1/studios/${encodeURIComponent(configuredStudioID())}/templates/${templateID}`, { authorization: "studio" }) : errorResponse(400, "invalid_template_id", "template_id must be a non-empty opaque identifier.");
  });
}
