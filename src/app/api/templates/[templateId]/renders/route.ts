import { route } from "@/lib/batch-relay/route";
import { opaquePathSegment, forwardUpstream, errorResponse, requestIdempotencyKey, requestJSON } from "@/lib/batch-relay/server";

export async function POST(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  return route(async () => {
    const templateID = opaquePathSegment((await params).templateId);
    const idempotencyKey = requestIdempotencyKey(request);
    if (!templateID) return errorResponse(400, "invalid_template_id", "template_id must be a non-empty opaque identifier.");
    if (!idempotencyKey) return errorResponse(400, "idempotency_key_required", "Idempotency-Key is required for template rendering.");
    return forwardUpstream(`/v1/templates/${templateID}/renders`, { authorization: "studio", method: "POST", body: await requestJSON(request), headers: { "Idempotency-Key": idempotencyKey } });
  });
}
