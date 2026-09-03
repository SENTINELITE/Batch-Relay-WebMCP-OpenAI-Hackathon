import { boundedQuery, route } from "@/lib/batch-relay/route";
import { opaquePathSegment, forwardUpstream, errorResponse } from "@/lib/batch-relay/server";

export async function GET(request: Request, { params }: { params: Promise<{ templateId: string; outputId: string; assetRef: string }> }) {
  return route(async () => {
    const { templateId, outputId, assetRef } = await params;
    const templateID = opaquePathSegment(templateId);
    const outputID = opaquePathSegment(outputId);
    const assetRefID = opaquePathSegment(assetRef);
    return templateID && outputID && assetRefID
      ? forwardUpstream(`/v1/templates/${templateID}/outputs/${outputID}/browser-preview/assets/${assetRefID}/content`, { authorization: "studio", search: boundedQuery(new URL(request.url).searchParams, ["revision_id"]) })
      : errorResponse(400, "invalid_template_browser_preview_asset_request", "template_id, output_id, and asset_ref must be non-empty opaque identifiers.");
  });
}
