import { establishCreativeSession } from "@/lib/livepeer/auth";
import { errorResponse, jsonBody } from "@/lib/livepeer/errors";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await jsonBody(request);
    const session = await establishCreativeSession(body.passcode);
    return Response.json(session, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
