import { boundedQuery, route } from "@/lib/batch-relay/route";
import { opaquePathSegment, forwardUpstream, errorResponse, requestIdempotencyKey, requestJSON } from "@/lib/batch-relay/server";

export async function GET(request: Request, { params }: { params: Promise<{ templateId: string; outputId: string }> }) {
  return route(async () => {
    const { templateId, outputId } = await params;
    const templateID = opaquePathSegment(templateId);
    const outputID = opaquePathSegment(outputId);
    return templateID && outputID
      ? forwardUpstream(`/v1/templates/${templateID}/outputs/${outputID}/browser-preview`, { authorization: "studio", search: boundedQuery(new URL(request.url).searchParams, ["revision_id"]) })
      : errorResponse(400, "invalid_template_browser_preview_request", "template_id and output_id must be non-empty opaque identifiers.");
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ templateId: string; outputId: string }> }) {
  return route(async () => {
    const { templateId, outputId } = await params;
    const templateID = opaquePathSegment(templateId);
    const outputID = opaquePathSegment(outputId);
    const idempotencyKey = requestIdempotencyKey(request);
    if (!templateID || !outputID) return errorResponse(400, "invalid_template_browser_preview_request", "template_id and output_id must be non-empty opaque identifiers.");
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
