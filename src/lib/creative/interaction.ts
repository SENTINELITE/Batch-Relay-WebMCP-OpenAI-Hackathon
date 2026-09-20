import {
  CREATIVE_FORMAT_DIMENSIONS,
  type CreativeFormatLayout,
  type CreativeLayerTransform,
  type CreativeTextLayer,
} from "./types.ts";

export type CreativeInteractionLayer = "background" | "athlete" | "logo" | `text:${string}`;

export type CreativeImageDimensions = {
  width: number;
  height: number;
};

export type CreativePixelRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type CreativeInteractionPoint = {
  x: number;
  y: number;
};

export const INTERACTION_LAYER_LABELS: Record<CreativeInteractionLayer, string> = {
  background: "Background",
  athlete: "Athlete",
  logo: "Logo",
};

export function layerLabel(layer: CreativeInteractionLayer): string {
  if (layer.startsWith("text:")) {
    const id = layer.slice("text:".length);
    return ({
      "event-name": "Event name",
      "event-date": "Date",
      "event-location": "Location",
      "event-cta": "Call to action",
    } as Record<string, string>)[id] ?? id;
  }
  return INTERACTION_LAYER_LABELS[layer];
}

export function layerTransform(layout: CreativeFormatLayout, layer: CreativeInteractionLayer): CreativeLayerTransform | CreativeTextLayer | null {
  if (layer === "background" || layer === "athlete" || layer === "logo") return layout[layer];
  return layout.text.find((candidate) => candidate.id === layer.slice("text:".length)) ?? null;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Keep enough of a layer on the surface to make it selectable again. */
export function clampLayerPosition(transform: CreativeLayerTransform, x: number, y: number): CreativeInteractionPoint {
  const minX = -Math.min(0.8, Math.max(0, transform.width * 0.8));
  const minY = -Math.min(0.8, Math.max(0, transform.height * 0.8));
  const maxX = Math.max(minX, 1 - Math.min(0.2, Math.max(0, transform.width * 0.2)));
  const maxY = Math.max(minY, 1 - Math.min(0.2, Math.max(0, transform.height * 0.2)));
  return {
    x: clamp(finite(x, transform.x), minX, maxX),
    y: clamp(finite(y, transform.y), minY, maxY),
  };
}

export function moveLayer(transform: CreativeLayerTransform, delta: CreativeInteractionPoint): CreativeLayerTransform {
  const position = clampLayerPosition(transform, transform.x + finite(delta.x, 0), transform.y + finite(delta.y, 0));
  return { ...transform, ...position };
}

/** Resize an image by output-surface width while retaining its transform aspect ratio. */
export function resizeImageProportionally(transform: CreativeLayerTransform, widthRatio: number): CreativeLayerTransform {
  const requestedScale = finite(widthRatio, transform.width) / Math.max(transform.width, 0.0001);
  const minScale = Math.max(0.04 / Math.max(transform.width, 0.0001), 0.04 / Math.max(transform.height, 0.0001));
  const maxScale = Math.min(1.8 / Math.max(transform.width, 0.0001), 1.8 / Math.max(transform.height, 0.0001));
  const scale = clamp(requestedScale, minScale, maxScale);
  const width = transform.width * scale;
  const height = transform.height * scale;
  const position = clampLayerPosition({ ...transform, width, height }, transform.x, transform.y);
  return { ...transform, width, height, ...position };
}

/** Text needs a taller box as its requested size grows, otherwise the renderer's fit pass would shrink it back down. */
export function setTextFontSize(
  layer: CreativeTextLayer,
  fontSizePixels: number,
  outputWidth: number,
  outputHeight: number,
): CreativeTextLayer {
  const safePixels = clamp(finite(fontSizePixels, 10), 10, Math.max(10, outputWidth * 0.25));
  const fontSizeRatio = safePixels / outputWidth;
  const maxLines = Math.max(1, Math.floor(layer.maxLines ?? 2));
  const minimumHeight = (fontSizeRatio * 1.12 * maxLines * outputWidth) / outputHeight;
  const height = Math.max(layer.transform.height, minimumHeight);
  const position = clampLayerPosition({ ...layer.transform, height }, layer.transform.x, layer.transform.y);
  return { ...layer, fontSizeRatio, transform: { ...layer.transform, height, ...position } };
}

export function textFontSizePixels(layer: CreativeTextLayer, outputWidth: number): number {
  return Math.round(Math.max(10, (layer.fontSizeRatio ?? 0.05) * outputWidth));
}

function rectForTransform(transform: CreativeLayerTransform, width: number, height: number): CreativePixelRect {
  return {
    x: transform.x * width,
    y: transform.y * height,
    width: Math.max(0, transform.width * width),
    height: Math.max(0, transform.height * height),
  };
}

/**
 * Returns the pixels actually occupied by an image after the renderer's
 * contain/cover fit. Cover is clipped to its transform box; contain leaves
 * transparent margins that should not select the image.
 */
export function imageInteractionRect(
  transform: CreativeLayerTransform,
  outputWidth: number,
  outputHeight: number,
  source: CreativeImageDimensions | undefined,
): CreativePixelRect {
  const rect = rectForTransform(transform, outputWidth, outputHeight);
  if (!source || source.width <= 0 || source.height <= 0 || transform.fit !== "contain") return rect;
  const scale = Math.min(rect.width / source.width, rect.height / source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  return { x: rect.x + (rect.width - width) / 2, y: rect.y + (rect.height - height) / 2, width, height };
}

function contains(rect: CreativePixelRect, point: CreativeInteractionPoint): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function containsRotated(transform: CreativeLayerTransform, rect: CreativePixelRect, point: CreativeInteractionPoint): boolean {
  const rotation = ((transform.rotationDeg ?? 0) * Math.PI) / 180;
  if (!rotation) return contains(rect, point);
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const local = { x: center.x + (point.x - center.x) * cos - (point.y - center.y) * sin, y: center.y + (point.x - center.x) * sin + (point.y - center.y) * cos };
  return contains(rect, local);
}

/** Hit testing follows the same paint order as drawCreative, with later layers on top. */
export function hitTestCreativeLayer(
  point: CreativeInteractionPoint,
  layout: CreativeFormatLayout,
  format: "card" | "banner",
  assets: Partial<Record<"background" | "athlete" | "logo", CreativeImageDimensions>> = {},
  availableAssets?: Partial<Record<"background" | "athlete" | "logo", boolean>>,
): CreativeInteractionLayer | null {
  const { width, height } = CREATIVE_FORMAT_DIMENSIONS[format];
  for (let index = layout.text.length - 1; index >= 0; index -= 1) {
    const layer = layout.text[index];
    const rect = rectForTransform(layer.transform, width, height);
    if (containsRotated(layer.transform, rect, point)) return `text:${layer.id}`;
  }
  for (const slot of ["logo", "athlete"] as const) {
    if (availableAssets && !availableAssets[slot]) continue;
    const transform = layout[slot];
    if (containsRotated(transform, imageInteractionRect(transform, width, height, assets[slot]), point)) return slot;
  }
  const background = layout.background;
  if (availableAssets && !availableAssets.background) return null;
  if (containsRotated(background, imageInteractionRect(background, width, height, assets.background), point)) return "background";
  return null;
}

export function interactionRectForLayer(
  layout: CreativeFormatLayout,
  format: "card" | "banner",
  layer: CreativeInteractionLayer,
  assets: Partial<Record<"background" | "athlete" | "logo", CreativeImageDimensions>> = {},
): CreativePixelRect | null {
  const { width, height } = CREATIVE_FORMAT_DIMENSIONS[format];
  const selected = layerTransform(layout, layer);
  const transform = selected && "transform" in selected ? selected.transform : selected;
  if (!transform || !("width" in transform)) return null;
  if (layer === "background" || layer === "athlete" || layer === "logo") return imageInteractionRect(transform, width, height, assets[layer]);
  return rectForTransform(transform, width, height);
}
