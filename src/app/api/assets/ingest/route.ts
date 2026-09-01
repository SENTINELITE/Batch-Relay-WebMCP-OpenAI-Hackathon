import { route } from "@/lib/batch-relay/route";
import { forwardUpstream, hasStudioTokenConfiguration, managedAssetJSON, idempotencyKey } from "@/lib/batch-relay/server";

export async function POST(request: Request) {
  return route(async () => {
    const body = await managedAssetJSON(request);
    return forwardUpstream("/v1/assets/ingest", {
      // A configured studio Test account owns managed assets used by the
      // studio/template workflow. In an unconfigured public-only setup, the
      // anonymous cookie is the sole available owner for either source form.
      authorization: hasStudioTokenConfiguration() ? "studio" : "anonymous",
      method: "POST",
      body,
      headers: { "Idempotency-Key": idempotencyKey(request, body) },
    });
  });
}
