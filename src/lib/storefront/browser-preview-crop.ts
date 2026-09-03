import { clampBrowserPreviewTransform, type BrowserPreviewTransform } from "./browser-preview.ts";

export type BrowserPreviewCrop = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/**
 * Matches the browser proof convention: centered cover fit followed by
 * `translate(offsetX%, offsetY%) scale(zoom)`. The resulting source rect is
 * what gets baked into the uploaded managed asset for server proofing.
 */
export function browserPreviewCropRect(
  source: { width: number; height: number },
  targetAspectRatio: number,
  transform: BrowserPreviewTransform,
): BrowserPreviewCrop {
  if (!Number.isFinite(source.width) || !Number.isFinite(source.height) || source.width <= 0 || source.height <= 0 || !Number.isFinite(targetAspectRatio) || targetAspectRatio <= 0) {
    throw new Error("The selected image cannot be framed for this preview surface.");
  }
  const baseWidth = source.width / source.height > targetAspectRatio ? source.height * targetAspectRatio : source.width;
  const baseHeight = source.width / source.height > targetAspectRatio ? source.height : source.width / targetAspectRatio;
  const normalized = clampBrowserPreviewTransform(transform, source, targetAspectRatio);
  const width = baseWidth / normalized.zoom;
  const height = baseHeight / normalized.zoom;
  // CSS translates the cover-fitted source image by a percentage of its own
  // dimensions. Convert that exact movement back into source coordinates so
  // proofing and the browser mask agree at every pan limit.
  const unclampedLeft = (source.width - width) / 2 - (normalized.offsetX / 100) * source.width;
  const unclampedTop = (source.height - height) / 2 - (normalized.offsetY / 100) * source.height;
  return {
    left: Math.min(source.width - width, Math.max(0, unclampedLeft)),
    top: Math.min(source.height - height, Math.max(0, unclampedTop)),
    width,
    height,
  };
}

export async function rasterizeBrowserPreviewCrop(
  file: File,
  targetAspectRatio: number,
  transform: BrowserPreviewTransform,
): Promise<{ file: File; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  try {
    const crop = browserPreviewCropRect({ width: bitmap.width, height: bitmap.height }, targetAspectRatio, transform);
    const width = Math.max(1, Math.round(crop.width));
    const height = Math.max(1, Math.round(crop.height));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot prepare the selected template framing.");
    context.drawImage(bitmap, crop.left, crop.top, crop.width, crop.height, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("The template framing could not be encoded.")), "image/jpeg", 0.94));
    const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";
    return {
      file: new File([blob], `${baseName}-template-preview.jpg`, { type: "image/jpeg" }),
      width,
      height,
    };
  } finally {
    bitmap.close();
  }
}
