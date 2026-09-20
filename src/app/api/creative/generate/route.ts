import { requireCreativeSession } from "@/lib/livepeer/auth";
import { assert, errorResponse, jsonBody } from "@/lib/livepeer/errors";
import { executeEstimate } from "@/lib/livepeer/service";

export const runtime = "nodejs";

function input(body: Record<string, unknown>) {
  const estimateId = body.estimateId;
  const requestId = body.requestId;
  const projectId = body.projectId;
  const revision = body.revision;
  assert(typeof estimateId === "string" && /^est_[A-Za-z0-9]+$/.test(estimateId), 400, "creative_estimate_invalid", "A valid estimate ID is required.");
  assert(typeof requestId === "string" && requestId.trim().length > 0 && requestId.length <= 200, 400, "creative_request_id_invalid", "A valid request ID is required.");
  assert(typeof projectId === "string" && projectId.trim().length > 0 && projectId.length <= 200, 400, "creative_project_id_invalid", "A valid project ID is required.");
  assert(typeof revision === "number" && Number.isInteger(revision) && revision >= 0, 400, "creative_revision_invalid", "A valid project revision is required.");
  return { estimateId, requestId, projectId, revision };
}

export async function POST(request: Request) {
  try {
    await requireCreativeSession();
    const job = await executeEstimate(input(await jsonBody(request)));
    return Response.json(job, { status: 202, headers: { "Cache-Control": "no-store", Location: `/api/creative/jobs/${encodeURIComponent(job.id)}` } });
  } catch (error) {
    return errorResponse(error);
  }
}
