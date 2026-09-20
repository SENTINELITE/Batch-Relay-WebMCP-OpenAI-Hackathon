import { CreativeAPIError, assert } from "./errors";

export const MAX_CUTOUT_IMAGE_BYTES = 900 * 1024;
export const MAX_CUTOUT_REQUEST_BYTES = 1_200 * 1024;

const RASTER_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/heic", "image/heif"]);

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function detectedMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && ascii(bytes, 0, 8) === "\x89PNG\r\n\x1a\n") return "image/png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a")) return "image/gif";
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") {
    const brands = ascii(bytes, 8, Math.min(24, bytes.length - 8));
    if (/avif|avis/i.test(brands)) return "image/avif";
    if (/heic|heix|hevc|hevx/i.test(brands)) return "image/heic";
    if (/mif1/i.test(brands)) return "image/heif";
  }
  return null;
}

export type RasterUpload = { bytes: Uint8Array; mimeType: string; filename: string; contentHash?: string };

export async function validateRasterFile(value: unknown): Promise<RasterUpload> {
  assert(value && typeof value === "object" && typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function", 400, "creative_image_required", "Provide a raster image file.");
  const file = value as { arrayBuffer: () => Promise<ArrayBuffer>; type?: string; name?: string };
  const bytes = new Uint8Array(await file.arrayBuffer());
  assert(bytes.byteLength > 0 && bytes.byteLength <= MAX_CUTOUT_IMAGE_BYTES, 413, "creative_image_too_large", "The athlete image must be a non-empty raster file no larger than 900 KiB.");
  const declared = (file.type ?? "").toLowerCase().trim();
  assert(RASTER_MIME_TYPES.has(declared), 415, "creative_image_type_invalid", "SVG and other non-raster image types are not accepted.");
  const detected = detectedMime(bytes);
  assert(detected && RASTER_MIME_TYPES.has(detected), 415, "creative_image_bytes_invalid", "The uploaded bytes are not a supported raster image.");
  assert(declared === detected || (declared === "image/heif" && detected === "image/heic") || (declared === "image/heic" && detected === "image/heif"), 415, "creative_image_type_mismatch", "The uploaded image type does not match its bytes.");
  const rawFilename = typeof file.name === "string" && file.name.trim() ? file.name.trim() : "athlete-image";
  const filename = rawFilename.split(/[\\/]/).pop()?.slice(0, 255) || "athlete-image";
  return { bytes, mimeType: detected, filename };
}

async function boundedBody(request: Request): Promise<ArrayBuffer> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_CUTOUT_REQUEST_BYTES) throw new CreativeAPIError(413, "creative_request_too_large", "The cutout upload request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new CreativeAPIError(400, "creative_image_required", "Provide a multipart image upload.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > MAX_CUTOUT_REQUEST_BYTES) {
      await reader.cancel();
      throw new CreativeAPIError(413, "creative_request_too_large", "The cutout upload request is too large.");
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const buffer = new ArrayBuffer(total);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export async function parseCutoutMultipart(request: Request): Promise<{ projectId: string; revision: number; requestId: string; sourceAssetId: string; image: RasterUpload }> {
  const contentType = request.headers.get("content-type") ?? "";
  assert(/^multipart\/form-data\s*;/i.test(contentType), 415, "creative_multipart_required", "Cutout estimates require a multipart form upload.");
  const body = await boundedBody(request);
  let form: FormData;
  try {
    form = await new Request(request.url, { method: "POST", headers: { "content-type": contentType }, body }).formData();
  } catch {
    throw new CreativeAPIError(400, "creative_multipart_invalid", "The cutout multipart upload is invalid.");
  }
  const text = (name: string): string => {
    const value = form.get(name);
    assert(typeof value === "string", 400, `creative_${name}_invalid`, `A valid ${name} is required.`);
    return value.trim();
  };
  const revisionText = text("revision");
  assert(/^\d+$/.test(revisionText), 400, "creative_revision_invalid", "A valid project revision is required.");
  const revision = Number(revisionText);
  assert(Number.isInteger(revision) && revision >= 0 && revision <= 1_000_000, 400, "creative_revision_invalid", "A valid project revision is required.");
  const image = await validateRasterFile(form.get("image"));
  return { projectId: text("projectId"), revision, requestId: text("requestId"), sourceAssetId: text("sourceAssetId"), image };
}
