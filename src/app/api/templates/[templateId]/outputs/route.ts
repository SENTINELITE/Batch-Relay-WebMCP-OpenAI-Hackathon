import { boundedQuery, route } from "@/lib/batch-relay/route";
import { opaquePathSegment, configuredStudioID, forwardUpstream, errorResponse } from "@/lib/batch-relay/server";

export async function GET(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  return route(async () => {
    const templateID = opaquePathSegment((await params).templateId);
    return templateID ? forwardUpstream(`/v1/studios/${encodeURIComponent(configuredStudioID())}/templates/${templateID}/outputs`, { authorization: "studio", search: boundedQuery(new URL(request.url).searchParams, ["revision_id"]) }) : errorResponse(400, "invalid_template_id", "template_id must be a non-empty opaque identifier.");
  });
}
