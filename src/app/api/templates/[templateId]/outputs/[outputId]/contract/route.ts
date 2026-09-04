import { route } from "@/lib/batch-relay/route";
import { opaquePathSegment, errorResponse } from "@/lib/batch-relay/server";
import { frozenDemoRevisionMatches, frozenDemoTemplateForID, frozenDemoTemplateContract } from "@/lib/storefront/template-specs/frozen-demo";

export async function GET(request: Request, { params }: { params: Promise<{ templateId: string; outputId: string }> }) {
  return route(async () => {
    const { templateId, outputId } = await params;
    const templateID = opaquePathSegment(templateId);
    const outputID = opaquePathSegment(outputId);
    if (!templateID || !outputID) return errorResponse(400, "invalid_template_contract_request", "template_id and output_id must be non-empty opaque identifiers.");
    const template = frozenDemoTemplateForID(templateID);
    if (!template || outputID !== template.outputID) return errorResponse(404, "frozen_demo_output_not_found", "This template output is not part of the frozen demo.");
    const revisionID = new URL(request.url).searchParams.get("revision_id");
    if (!frozenDemoRevisionMatches(templateID, revisionID)) return errorResponse(409, "frozen_demo_revision_mismatch", "The demo is pinned to a different template revision.");
    return Response.json(frozenDemoTemplateContract(templateID, outputID, revisionID), { headers: { "Cache-Control": "no-store" } });
  });
}
