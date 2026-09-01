import { createHash } from "node:crypto";

import { route } from "@/lib/batch-relay/route";
import { configuredEventID, errorResponse, forwardUpstream } from "@/lib/batch-relay/server";

const acceptedTypes = new Set(["image/jpeg", "image/png", "image/tiff"]);

type StudioSession = {
  id: string;
  assets: Array<{ id: string; content_type: string; byte_size: number; status: string }>;
  reconciled: Array<{ local_id: string; image_asset_id: string; status: string }>;
};

export const runtime = "nodejs";

export async function POST(request: Request) {
  return route(async () => {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.name || !acceptedTypes.has(file.type) || file.size < 1) {
      return errorResponse(422, "invalid_studio_asset", "Provide one JPEG, PNG, or TIFF file.");
    }
    if (file.size > 95 * 1024 * 1024) return errorResponse(413, "studio_asset_too_large", "Studio asset uploads are limited to 95 MiB per file.");

    const bytes = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const localID = `webmcp-${sha256}`;
    const reservation = JSON.stringify({
      event_id: configuredEventID(),
      files: [{
        local_id: localID,
        original_filename: file.name,
        content_type: file.type,
        byte_size: bytes.length,
        expected_sha256: sha256,
      }],
    });
    const sessionResponse = await forwardUpstream("/v1/studio-assets/sessions", {
      authorization: "studio",
      method: "POST",
      body: reservation,
      headers: { "Idempotency-Key": `webmcp-upload-${sha256}` },
    });
    if (!sessionResponse.ok) return sessionResponse;
    const session = await sessionResponse.json() as StudioSession;
    const reconciled = session.reconciled.find((asset) => asset.local_id === localID);
    if (reconciled?.image_asset_id && reconciled.status === "ready") {
      return Response.json({ asset_id: reconciled.image_asset_id }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    const asset = session.assets.find((candidate) => candidate.content_type === file.type && candidate.byte_size === bytes.length);
    if (!session.id || !asset?.id) return errorResponse(502, "studio_asset_invalid_response", "Batch Relay could not reserve the studio asset.");
    const uploadResponse = await forwardUpstream(`/v1/studio-assets/sessions/${encodeURIComponent(session.id)}/assets/${encodeURIComponent(asset.id)}`, {
      authorization: "studio",
      method: "PUT",
      body: bytes,
      headers: { "Content-Type": file.type, "Content-Length": String(bytes.length) },
    });
    if (!uploadResponse.ok) return uploadResponse;
    const uploaded = await uploadResponse.json() as { id?: unknown; status?: unknown };
    if (typeof uploaded.id !== "string" || uploaded.status !== "ready") {
      return errorResponse(502, "studio_asset_invalid_response", "Batch Relay could not finalize the studio asset.");
    }
    return Response.json({ asset_id: uploaded.id }, { status: 201, headers: { "Cache-Control": "no-store" } });
  });
}
