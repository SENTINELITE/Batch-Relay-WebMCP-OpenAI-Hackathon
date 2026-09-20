import { requireCreativeSession } from "@/lib/livepeer/auth";
import { errorResponse, jsonBody } from "@/lib/livepeer/errors";
import { proposeEstimate, validateEstimateInput } from "@/lib/livepeer/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await requireCreativeSession();
    const input = validateEstimateInput(await jsonBody(request));
    return Response.json(await proposeEstimate(input), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
