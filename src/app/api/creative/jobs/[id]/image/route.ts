import { requireCreativeSession } from "@/lib/livepeer/auth";
import { CreativeAPIError, errorResponse } from "@/lib/livepeer/errors";
import { getStoredImageURL, isTrustedImageURL } from "@/lib/livepeer/service";

export const runtime = "nodejs";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const RASTER_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif", "image/bmp", "image/tiff"]);

async function boundedImageFetch(startURL: string, signal: AbortSignal, operation?: "background" | "cutout"): Promise<{ bytes: Uint8Array; contentType: string }> {
  let currentURL = new URL(startURL);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    if (!isTrustedImageURL(currentURL)) throw new CreativeAPIError(502, "creative_image_untrusted", "The generated background host is not trusted.");
    const response = await fetch(currentURL, { redirect: "manual", cache: "no-store", signal });
    if (response.status >= 300 && response.status < 400) {
      if (redirect === MAX_REDIRECTS) throw new CreativeAPIError(502, "creative_image_redirect_limit", "The generated background redirected too many times.");
      const location = response.headers.get("location");
      if (!location) throw new CreativeAPIError(502, "creative_image_invalid_redirect", "The generated background returned an invalid redirect.");
      await response.body?.cancel();
      try { currentURL = new URL(location, currentURL); } catch { throw new CreativeAPIError(502, "creative_image_invalid_redirect", "The generated background returned an invalid redirect."); }
      continue;
    }
    if (!response.ok) throw new CreativeAPIError(502, "creative_image_unavailable", "The generated background could not be retrieved.");
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_IMAGE_BYTES) throw new CreativeAPIError(502, "creative_image_too_large", "The generated background is too large.");
    if (!response.body) throw new CreativeAPIError(502, "creative_image_invalid", "The generated background had no body.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new CreativeAPIError(502, "creative_image_too_large", "The generated background is too large.");
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (!contentType || !RASTER_IMAGE_TYPES.has(contentType)) throw new CreativeAPIError(502, "creative_image_invalid", "The generated background is not a supported raster image.");
    if (operation === "cutout" && !new Set(["image/png", "image/webp", "image/avif", "image/gif"]).has(contentType)) {
      throw new CreativeAPIError(502, "creative_cutout_alpha_invalid", "The cutout provider result does not preserve a transparent-capable raster format.");
    }
    return { bytes, contentType };
  }
  throw new CreativeAPIError(502, "creative_image_redirect_limit", "The generated background redirected too many times.");
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireCreativeSession();
    const { url, operation } = await getStoredImageURL((await params).id);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const { bytes, contentType } = await boundedImageFetch(url, controller.signal, operation);
      const responseBody = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(responseBody).set(bytes);
      return new Response(responseBody, {
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(bytes.byteLength),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return errorResponse(error);
  }
}
