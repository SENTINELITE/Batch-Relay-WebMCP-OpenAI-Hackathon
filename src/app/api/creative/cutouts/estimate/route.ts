import { requireCreativeSession } from "@/lib/livepeer/auth";
import { errorResponse } from "@/lib/livepeer/errors";
import { parseCutoutMultipart } from "@/lib/livepeer/cutout";
import { proposeCutoutEstimate, validateCutoutMetadata } from "@/lib/livepeer/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireCreativeSession();
    const input = await parseCutoutMultipart(request);
    const metadata = validateCutoutMetadata(input);
    const estimate = await proposeCutoutEstimate({
      projectId: metadata.projectId,
      revision: metadata.revision,
      requestId: metadata.requestId,
      sourceAssetId: metadata.sourceAssetId,
      bytes: input.image.bytes,
      mimeType: input.image.mimeType,
      filename: input.image.filename,
    });
    return Response.json(estimate, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
