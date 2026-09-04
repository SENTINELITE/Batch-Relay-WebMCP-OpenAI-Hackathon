import { boundedQuery, route } from "@/lib/batch-relay/route";
import { opaquePathSegment, forwardUpstream, errorResponse, requestIdempotencyKey, requestJSON } from "@/lib/batch-relay/server";
import { frozenDemoBrowserPreview, frozenDemoRevisionMatches, frozenDemoTemplateForID } from "@/lib/storefront/template-specs/frozen-demo";

export async function GET(request: Request, { params }: { params: Promise<{ templateId: string; outputId: string }> }) {
  return route(async () => {
    const { templateId, outputId } = await params;
    const templateID = opaquePathSegment(templateId);
    const outputID = opaquePathSegment(outputId);
    if (!templateID || !outputID) return errorResponse(400, "invalid_template_browser_preview_request", "template_id and output_id must be non-empty opaque identifiers.");
    const template = frozenDemoTemplateForID(templateID);
    if (!template || outputID !== template.outputID) return errorResponse(404, "frozen_demo_output_not_found", "This template output is not part of the frozen demo.");
    const revisionID = new URL(request.url).searchParams.get("revision_id");
    if (!frozenDemoRevisionMatches(templateID, revisionID)) return errorResponse(409, "frozen_demo_revision_mismatch", "The demo is pinned to a different template revision.");
    return Response.json(frozenDemoBrowserPreview(templateID, outputID, revisionID), { headers: { "Cache-Control": "no-store" } });
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ templateId: string; outputId: string }> }) {
  return route(async () => {
    const { templateId, outputId } = await params;
    const templateID = opaquePathSegment(templateId);
    const outputID = opaquePathSegment(outputId);
    const idempotencyKey = requestIdempotencyKey(request);
    if (!templateID || !outputID) return errorResponse(400, "invalid_template_browser_preview_request", "template_id and output_id must be non-empty opaque identifiers.");
    const revisionID = new URL(request.url).searchParams.get("revision_id");
    const template = frozenDemoTemplateForID(templateID);
    if (!template || outputID !== template.outputID) return errorResponse(404, "frozen_demo_output_not_found", "This template output is not part of the frozen demo.");
    if (!frozenDemoRevisionMatches(templateID, revisionID)) return errorResponse(409, "frozen_demo_revision_mismatch", "The demo is pinned to a different template revision.");
    if (!idempotencyKey) return errorResponse(400, "idempotency_key_required", "Idempotency-Key is required for browser preview rendering.");
    return forwardUpstream(`/v1/templates/${templateID}/outputs/${outputID}/browser-preview`, {
      authorization: "studio",
      method: "POST",
      body: await requestJSON(request),
      headers: { "Idempotency-Key": idempotencyKey },
      search: boundedQuery(new URL(request.url).searchParams, ["revision_id"]),
    });
  });
}
