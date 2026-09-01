import { createAnonymousSession } from "@/lib/batch-relay/server";
import { route } from "@/lib/batch-relay/route";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return route(async () => Response.json(await createAnonymousSession(request), { status: 201, headers: { "Cache-Control": "no-store" } }));
}
