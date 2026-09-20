import { requireCreativeSession } from "@/lib/livepeer/auth";
import { errorResponse } from "@/lib/livepeer/errors";
import { getCreativeJob } from "@/lib/livepeer/service";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireCreativeSession();
    return Response.json(await getCreativeJob((await params).id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
