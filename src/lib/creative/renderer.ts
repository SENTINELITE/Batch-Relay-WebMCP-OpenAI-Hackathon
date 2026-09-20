import {
  CREATIVE_FORMAT_DIMENSIONS,
  type CreativeAssetSlot,
  type CreativeFormat,
  type CreativeLayerTransform,
  type CreativeProject,
  type CreativeRenderTarget,
  type CreativeResolvedAsset,
  type CreativeResolvedAssets,
  type CreativeTextLayer,
} from "./types.ts";

export type CreativeCanvasFactory = (width: number, height: number) => CreativeRenderTarget;

export type CreativeRendererOptions = {
  format?: CreativeFormat;
  canvas?: CreativeRenderTarget;
  createCanvas?: CreativeCanvasFactory;
  backgroundColor?: string;
};

export type CreativeDrawResult = {
  width: number;
  height: number;
  drawnLayers: CreativeAssetSlot[];
  textLines: Record<string, string[]>;
};

type DecodedCreativeAssets = Partial<Record<CreativeAssetSlot, CanvasImageSource>>;

/** One sequence per target prevents a slow URL decode from painting over a newer preview. */
const renderSequences = new WeakMap<CreativeRenderTarget, number>();

const clamp = (value: number, min = 0, max = 1): number => Math.min(max, Math.max(min, value));

export function dimensionsForFormat(format: CreativeFormat): { width: number; height: number } {
  const dimensions = CREATIVE_FORMAT_DIMENSIONS[format];
  return { width: dimensions.width, height: dimensions.height };
}

export function layerRect(transform: CreativeLayerTransform, width: number, height: number): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.round(clamp(transform.x, -1, 2) * width),
    y: Math.round(clamp(transform.y, -1, 2) * height),
    width: Math.max(0, Math.round(clamp(transform.width, 0, 2) * width)),
    height: Math.max(0, Math.round(clamp(transform.height, 0, 2) * height)),
  };
}

function imageDimensions(image: CanvasImageSource): { width: number; height: number } {
  const candidate = image as CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number };
  const width = candidate.naturalWidth ?? candidate.videoWidth ?? ("width" in candidate ? Number(candidate.width) : 0);
  const height = candidate.naturalHeight ?? candidate.videoHeight ?? ("height" in candidate ? Number(candidate.height) : 0);
  return { width: Number.isFinite(width) ? width : 0, height: Number.isFinite(height) ? height : 0 };
}

function drawImageFit(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  rect: { x: number; y: number; width: number; height: number },
  fit: "cover" | "contain",
  rotationDeg = 0,
  opacity = 1,
): void {
  const source = imageDimensions(image);
  if (source.width <= 0 || source.height <= 0 || rect.width <= 0 || rect.height <= 0) return;
  const scale = fit === "cover"
    ? Math.max(rect.width / source.width, rect.height / source.height)
    : Math.min(rect.width / source.width, rect.height / source.height);
  const drawnWidth = source.width * scale;
  const drawnHeight = source.height * scale;
  const drawX = rect.x + (rect.width - drawnWidth) / 2;
  const drawY = rect.y + (rect.height - drawnHeight) / 2;
  context.save();
  context.globalAlpha = clamp(opacity);
  if (rotationDeg) {
    context.translate(rect.x + rect.width / 2, rect.y + rect.height / 2);
    context.rotate((rotationDeg * Math.PI) / 180);
    context.drawImage(image, drawX - rect.x - rect.width / 2, drawY - rect.y - rect.height / 2, drawnWidth, drawnHeight);
  } else {
    // A clipping path makes cover crops exact and prevents an image from
    // painting outside its independently editable layer.
    context.beginPath();
    context.rect(rect.x, rect.y, rect.width, rect.height);
    context.clip();
    context.drawImage(image, drawX, drawY, drawnWidth, drawnHeight);
  }
  context.restore();
}

/**
 * Keeps foreground copy readable over bright generated scenes. The scrim is
 * deliberately behind the athlete and logo, so supplied foreground pixels
 * are never darkened or modified by the contrast treatment.
 */
function drawFormatScrim(context: CanvasRenderingContext2D, format: CreativeFormat, width: number, height: number): void {
  const gradient = format === "banner"
    ? context.createLinearGradient(0, 0, width, 0)
    : context.createLinearGradient(0, 0, 0, height);
  if (format === "banner") {
    gradient.addColorStop(0, "rgba(4, 16, 18, 0.76)");
    gradient.addColorStop(0.3, "rgba(4, 16, 18, 0.38)");
    gradient.addColorStop(0.58, "rgba(4, 16, 18, 0.08)");
    gradient.addColorStop(1, "rgba(4, 16, 18, 0.02)");
  } else {
    gradient.addColorStop(0, "rgba(4, 16, 18, 0.62)");
    gradient.addColorStop(0.22, "rgba(4, 16, 18, 0.18)");
    gradient.addColorStop(0.72, "rgba(4, 16, 18, 0.12)");
    gradient.addColorStop(1, "rgba(4, 16, 18, 0.68)");
  }
  context.save();
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.restore();
}

function textLines(
  context: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
  maxLines: number,
): { lines: string[]; truncated: boolean } {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { lines: [""], truncated: false };
  const lines: string[] = [];
  let current = "";
  let truncated = false;
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || context.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length === maxLines) {
      truncated = true;
      break;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length > maxLines) lines.length = maxLines;
  return { lines, truncated };
}

function ellipsizeLastLine(context: CanvasRenderingContext2D, lines: string[], maxWidth: number): string[] {
  if (lines.length === 0) return lines;
  let last = lines[lines.length - 1] ?? "";
  while (last && context.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1).trimEnd();
  lines[lines.length - 1] = `${last}…`;
  return lines;
}

function drawTextLayer(
  context: CanvasRenderingContext2D,
  layer: CreativeTextLayer,
  width: number,
  height: number,
): string[] {
  const rect = layerRect(layer.transform, width, height);
  if (rect.width <= 0 || rect.height <= 0) return [];
  const maxLines = Math.max(1, Math.floor(layer.maxLines ?? 2));
  const family = layer.fontFamily ?? "General Sans, system-ui, sans-serif";
  const baseSize = Math.max(10, (layer.fontSizeRatio ?? 0.05) * width);
  let fontSize = baseSize;
  let lines: string[] = [];
  let textWasTruncated = false;
  // Reduce size until the text fits its fixed box. This makes long event names
  // deterministic and readable in both preview and downloaded PNG output.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    context.font = `${layer.fontWeight ?? 700} ${fontSize}px ${family}`;
    const wrapped = textLines(context, layer.value, rect.width, maxLines);
    lines = wrapped.lines;
    textWasTruncated = wrapped.truncated;
    const lineHeight = fontSize * 1.12;
    if (!textWasTruncated && lines.length * lineHeight <= rect.height) break;
    if (fontSize <= 10) break;
    fontSize *= 0.9;
  }
  if (textWasTruncated) lines = ellipsizeLastLine(context, lines, rect.width);
  const lineHeight = fontSize * 1.12;
  const totalHeight = lines.length * lineHeight;
  const align = layer.align ?? "left";
  context.save();
  context.globalAlpha = clamp(layer.transform.opacity ?? 1);
  context.fillStyle = layer.color ?? "#fffaf1";
  context.textAlign = align;
  context.textBaseline = "top";
  if (layer.shadow) {
    context.shadowColor = layer.shadow.color;
    context.shadowBlur = layer.shadow.blur;
    context.shadowOffsetX = layer.shadow.offsetX;
    context.shadowOffsetY = layer.shadow.offsetY;
  }
  const x = align === "center" ? rect.x + rect.width / 2 : align === "right" ? rect.x + rect.width : rect.x;
  const y = rect.y + Math.max(0, (rect.height - totalHeight) / 2);
  lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight, rect.width));
  context.restore();
  return lines;
}

/** Draws the project into an exact-size canvas. Preview and export call this same function. */
export function drawCreative(
  project: CreativeProject,
  context: CanvasRenderingContext2D,
  assets: DecodedCreativeAssets = {},
  format = project.format,
  backgroundColor = project.palette.primary,
): CreativeDrawResult {
  const { width, height } = dimensionsForFormat(format);
  context.clearRect(0, 0, width, height);
  context.fillStyle = backgroundColor;
  context.fillRect(0, 0, width, height);
  const layout = project.layouts[format];
  const drawnLayers: CreativeAssetSlot[] = [];
  const background = assets.background;
  if (background) {
    drawImageFit(context, background, layerRect(layout.background, width, height), layout.background.fit ?? "cover", layout.background.rotationDeg, layout.background.opacity);
    drawnLayers.push("background");
  }
  drawFormatScrim(context, format, width, height);
  const athlete = assets.athlete;
  if (athlete) {
    drawImageFit(context, athlete, layerRect(layout.athlete, width, height), layout.athlete.fit ?? "cover", layout.athlete.rotationDeg, layout.athlete.opacity);
    drawnLayers.push("athlete");
  }
  const logo = assets.logo;
  if (logo) {
    drawImageFit(context, logo, layerRect(layout.logo, width, height), layout.logo.fit ?? "contain", layout.logo.rotationDeg, layout.logo.opacity);
    drawnLayers.push("logo");
  }
  const drawnText: Record<string, string[]> = {};
  for (const layer of layout.text) drawnText[layer.id] = drawTextLayer(context, layer, width, height);
  return { width, height, drawnLayers, textLines: drawnText };
}

function isAssetUrl(value: CreativeResolvedAsset): value is string {
  return typeof value === "string";
}

function loadImageSource(url: string): Promise<CanvasImageSource> {
  if (typeof Image === "undefined") throw new Error("Creative image URLs can only be decoded in a browser.");
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Creative image failed to load: ${url}`));
    image.src = url;
  });
}

/** Resolves known asset URLs once so preview and export share identical pixels. */
export async function resolveCreativeAssets(assets: CreativeResolvedAssets = {}): Promise<DecodedCreativeAssets> {
  const result: DecodedCreativeAssets = {};
  for (const slot of ["background", "athlete", "logo"] as const) {
    const asset = assets[slot];
    if (asset === undefined) continue;
    result[slot] = isAssetUrl(asset) ? await loadImageSource(asset) : asset;
  }
  return result;
}

function defaultCanvasFactory(width: number, height: number): CreativeRenderTarget {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height) as unknown as CreativeRenderTarget;
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error("Creative rendering requires a browser canvas or an injected canvas factory.");
}

async function waitForLayoutFonts(project: CreativeProject, format: CreativeFormat): Promise<void> {
  if (typeof document === "undefined" || !document.fonts?.load) return;
  const { width } = dimensionsForFormat(format);
  const descriptors = new Set(
    project.layouts[format].text.map((layer) => {
      const weight = layer.fontWeight ?? 700;
      const size = Math.max(10, (layer.fontSizeRatio ?? 0.05) * width);
      const family = layer.fontFamily ?? "General Sans, system-ui, sans-serif";
      return `${weight} ${size}px ${family}`;
    }),
  );
  await Promise.all([...descriptors].map(async (descriptor) => {
    try {
      await document.fonts.load(descriptor);
    } catch {
      // A missing optional font falls back to the declared system stack.
    }
  }));
  try {
    await document.fonts.ready;
  } catch {
    // Keep rendering with the loaded fallback when a browser rejects readiness.
  }
}

export function createCreativeCanvas(format: CreativeFormat, factory = defaultCanvasFactory): CreativeRenderTarget {
  const { width, height } = dimensionsForFormat(format);
  return factory(width, height);
}

export async function renderCreative(
  project: CreativeProject,
  assets: CreativeResolvedAssets = {},
  options: CreativeRendererOptions = {},
): Promise<CreativeRenderTarget> {
  const format = options.format ?? project.format;
  const canvas = options.canvas ?? createCreativeCanvas(format, options.createCanvas);
  const sequence = (renderSequences.get(canvas) ?? 0) + 1;
  renderSequences.set(canvas, sequence);
  const [resolvedAssets] = await Promise.all([
    resolveCreativeAssets(assets),
    waitForLayoutFonts(project, format),
  ]);
  // Asset decoding and font loading are asynchronous. If another render was
  // requested for this target while either was pending, its result owns the
  // canvas and this render must quietly yield without painting stale pixels.
  if (renderSequences.get(canvas) !== sequence) return canvas;
  const { width, height } = dimensionsForFormat(format);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Creative canvas does not expose a 2D context.");
  drawCreative(project, context, resolvedAssets, format, options.backgroundColor);
  return canvas;
}

export async function exportCreativePng(
  project: CreativeProject,
  assets: CreativeResolvedAssets = {},
  options: CreativeRendererOptions = {},
): Promise<Blob> {
  const canvas = await renderCreative(project, assets, options);
  if (canvas.convertToBlob) return canvas.convertToBlob({ type: "image/png" });
  if (!canvas.toBlob) throw new Error("Creative canvas cannot export PNG data.");
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob?.((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Creative canvas returned no PNG data."));
    }, "image/png");
  });
}
