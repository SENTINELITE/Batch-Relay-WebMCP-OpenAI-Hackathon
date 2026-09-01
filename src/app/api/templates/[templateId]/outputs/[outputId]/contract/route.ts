import { boundedQuery, route } from "@/lib/batch-relay/route";
import { opaquePathSegment, forwardUpstream, errorResponse } from "@/lib/batch-relay/server";

export async function GET(request: Request, { params }: { params: Promise<{ templateId: string; outputId: string }> }) {
  return route(async () => {
    const { templateId, outputId } = await params;
    const templateID = opaquePathSegment(templateId);
    const outputID = opaquePathSegment(outputId);
    return templateID && outputID ? forwardUpstream(`/v1/templates/${templateID}/outputs/${outputID}/contract`, { authorization: "studio", search: boundedQuery(new URL(request.url).searchParams, ["revision_id"]) }) : errorResponse(400, "invalid_template_contract_request", "template_id and output_id must be non-empty opaque identifiers.");
  });
}
