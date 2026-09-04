import { route } from "@/lib/batch-relay/route";
import { opaquePathSegment, errorResponse } from "@/lib/batch-relay/server";
import { frozenDemoRevisionMatches, frozenDemoTemplateForID, frozenDemoTemplateOutputs } from "@/lib/storefront/template-specs/frozen-demo";

export async function GET(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  return route(async () => {
    const templateID = opaquePathSegment((await params).templateId);
    if (!templateID) return errorResponse(400, "invalid_template_id", "template_id must be a non-empty opaque identifier.");
    if (!frozenDemoTemplateForID(templateID)) return errorResponse(404, "frozen_demo_template_not_found", "This template is not part of the frozen demo.");
    const revisionID = new URL(request.url).searchParams.get("revision_id");
    if (!frozenDemoRevisionMatches(templateID, revisionID)) return errorResponse(409, "frozen_demo_revision_mismatch", "The demo is pinned to a different template revision.");
    return Response.json(frozenDemoTemplateOutputs(templateID, revisionID), { headers: { "Cache-Control": "no-store" } });
  });
}
