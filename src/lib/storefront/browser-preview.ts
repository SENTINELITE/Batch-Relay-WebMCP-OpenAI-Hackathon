export type BrowserPreviewSurface = {
  id: string;
  variant_id: string;
  width_in: number;
  height_in: number;
  fulfillment_role: "artwork" | "front" | "back";
  ordinal: number;
};

export type BrowserPreviewInputSlot = {
  surface_id: string;
  variant_id: string;
  node_id: string;
  slot_key: string;
};

export type BrowserPreviewDocument = {
  /**
   * Absent on every API response. A locally built stand-in sets either
   * "local_published_copy" (an exact bundled copy of the published document)
   * or "fallback" (a layout synthesized from the contract), so the UI and the
   * agent can say plainly what the shopper is looking at.
   */
  preview_source?: "published" | "local_published_copy" | "fallback";
  template: {
    id: string;
    revision_id: string;
    revision_number: number;
    document_sha256: string;
    browser_document: unknown;
    browser_document_sha256: string;
  };
  output: { id: string; surfaces: BrowserPreviewSurface[] };
  /** Exact API-owned bridge from a browser node to a public input slot. */
  input_slots?: BrowserPreviewInputSlot[];
  assets: Array<{ asset_ref: string; kind: "public_template_asset" | "studio_asset" | "managed_asset"; content_url: string }>;
};

export type BrowserPreviewArtifact = {
  id: string;
  surface_id: string;
  content_type: string;
  byte_size: number;
  sha256: string;
  pixel_width: number;
  pixel_height: number;
  dpi: number;
  expires_at: string;
};

export type BrowserPreviewRender = {
  render_id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  profile: { id: "api_preview_v1"; dpi: 96; format: "jpeg"; jpeg_quality: 78 };
  artifacts?: BrowserPreviewArtifact[];
};

export type BrowserPreviewTransform = {
  zoom: number;
  offsetX: number;
  offsetY: number;
};

export type BrowserPreviewPanLimits = {
  x: number;
  y: number;
};

export const initialBrowserPreviewTransform: BrowserPreviewTransform = {
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
};

/**
 * A zoomed cover image can always move by at least this much on each axis,
 * regardless of its final measured aspect ratio. It keeps framing controls
 * usable while a browser image is still decoding; exact limits take over
 * as soon as its natural dimensions are available.
 */
export function minimumBrowserPreviewPanLimit(zoom: number): number {
  const safeZoom = Math.min(4, Math.max(1, Number.isFinite(zoom) ? zoom : 1));
  return 50 * (1 - 1 / safeZoom);
}

/**
 * The assigned photograph is always cover-fitted behind the published slot's
 * mask. These are the furthest translations that still leave source pixels
 * under every edge of that mask.
 */
export function browserPreviewPanLimits(
  source: { width: number; height: number },
  targetAspectRatio: number,
  zoom: number,
): BrowserPreviewPanLimits {
  const safeZoom = Math.min(4, Math.max(1, Number.isFinite(zoom) ? zoom : 1));
  if (!Number.isFinite(source.width) || !Number.isFinite(source.height) || source.width <= 0 || source.height <= 0 || !Number.isFinite(targetAspectRatio) || targetAspectRatio <= 0) {
    return { x: 0, y: 0 };
  }
  const sourceAspectRatio = source.width / source.height;
  const baseWidth = sourceAspectRatio > targetAspectRatio ? source.height * targetAspectRatio : source.width;
  const baseHeight = sourceAspectRatio > targetAspectRatio ? source.height : source.width / targetAspectRatio;
  return {
    x: Math.max(minimumBrowserPreviewPanLimit(safeZoom), Math.min(50, 50 * (1 - baseWidth / (source.width * safeZoom)))),
    y: Math.max(minimumBrowserPreviewPanLimit(safeZoom), Math.min(50, 50 * (1 - baseHeight / (source.height * safeZoom)))),
  };
}

export function clampBrowserPreviewTransform(
  value: BrowserPreviewTransform,
  source: { width: number; height: number } = { width: 1, height: 1 },
  targetAspectRatio = 1,
): BrowserPreviewTransform {
  const zoom = Math.min(4, Math.max(1, Number.isFinite(value.zoom) ? value.zoom : 1));
  const limits = browserPreviewPanLimits(source, targetAspectRatio, zoom);
  const clampOffset = (offset: number, limit: number) => {
    const clamped = Math.min(limit, Math.max(-limit, Number.isFinite(offset) ? offset : 0));
    return Object.is(clamped, -0) ? 0 : clamped;
  };
  return {
    zoom,
    offsetX: clampOffset(value.offsetX, limits.x),
    offsetY: clampOffset(value.offsetY, limits.y),
  };
}

type UnknownRecord = Record<string, unknown>;

export type BrowserPreviewLayer = {
  id: string;
  kind: "image" | "text" | "shape";
  role: string;
  anchor: "tl" | "tc" | "tr" | "ml" | "mc" | "mr" | "bl" | "bc" | "br";
  offsetIn: { x: number; y: number };
  sizeIn: { width: number; height: number };
  rotationDeg: number;
  opacity: number;
  color?: string;
  sample?: string | null;
  textFragments?: Array<
    | { kind: "literal"; value: string }
    | { kind: "binding"; slotKey: string; placeholder?: string }
  >;
  align?: "left" | "center" | "right";
  typeSizePt?: number;
  fontFamily?: string;
  fontWeight?: number;
  trackingEm?: number;
  verticalAlign?: "top" | "middle" | "bottom";
  fitMode?: "cover" | "contain" | "exact";
  assetRef?: string;
  /**
   * The exact stable template-contract input key that feeds this layer.
   * It is deliberately absent unless the API publishes an exact node mapping;
   * callers must never infer this from browser binding metadata, a role, or a label.
   */
  inputSlotKey?: string;
  /** Published human label for an empty bound image slot. */
  inputSlotLabel?: string;
  cornerRadiusIn?: number;
  cornerRadiiIn?: { tl: number; tr: number; br: number; bl: number };
  fills?: Array<{
    kind: "solid" | "linearGradient";
    color?: string;
    opacity?: number;
    angleDeg?: number;
    stops?: Array<{ offset: number; color: string }>;
  }>;
};

export type BrowserPreviewCanvas = {
  id: string;
  widthIn: number;
  heightIn: number;
  backgroundColor: string;
  backgroundAssetRef: string | null;
  backgroundArt: "none" | "grain" | "lines" | "band";
  layers: BrowserPreviewLayer[];
};

function record(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function color(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function point(value: unknown): { x: number; y: number } | null {
  if (!record(value)) return null;
  const x = finite(value.x);
  const y = finite(value.y);
  return x === null || y === null ? null : { x, y };
}

function size(value: unknown): { width: number; height: number } | null {
  if (!record(value)) return null;
  const width = finite(value.width);
  const height = finite(value.height);
  return width === null || height === null || width <= 0 || height <= 0 ? null : { width, height };
}

function cornerRadii(value: unknown): BrowserPreviewLayer["cornerRadiiIn"] {
  if (!record(value)) return undefined;
  const tl = finite(value.tl);
  const tr = finite(value.tr);
  const br = finite(value.br);
  const bl = finite(value.bl);
  return tl === null || tr === null || br === null || bl === null || [tl, tr, br, bl].some((radius) => radius < 0)
    ? undefined
    : { tl, tr, br, bl };
}

function anchor(value: unknown): BrowserPreviewLayer["anchor"] {
  return value === "tl" || value === "tc" || value === "tr" || value === "ml" || value === "mc" || value === "mr" || value === "bl" || value === "bc" || value === "br"
    ? value
    : "tl";
}

function textFragments(value: unknown): BrowserPreviewLayer["textFragments"] {
  if (!Array.isArray(value)) return undefined;
  const fragments: NonNullable<BrowserPreviewLayer["textFragments"]> = [];
  for (const fragment of value) {
    if (!record(fragment)) continue;
    if (fragment.kind === "literal" && typeof fragment.value === "string") fragments.push({ kind: "literal", value: fragment.value });
    if (fragment.kind === "binding") {
      const slotKey = nonEmpty(fragment.slotKey);
      const placeholder = nonEmpty(fragment.placeholder) ?? undefined;
      if (slotKey) fragments.push({ kind: "binding", slotKey, placeholder });
    }
  }
  return fragments.some((fragment) => fragment.kind === "binding") ? fragments : undefined;
}

function layer(value: unknown, inputSlotKeys: ReadonlyMap<string, string>): BrowserPreviewLayer | null {
  if (!record(value)) return null;
  const id = nonEmpty(value.id);
  const role = nonEmpty(value.role);
  const kind = value.kind;
  const offsetIn = point(value.insetIn);
  const sizeIn = size(value.sizeIn);
  if (!id || !role || !offsetIn || !sizeIn || (kind !== "image" && kind !== "text" && kind !== "shape")) return null;
  const fills: NonNullable<BrowserPreviewLayer["fills"]> = [];
  if (Array.isArray(value.fills)) {
    for (const fill of value.fills) {
      if (!record(fill) || (fill.kind !== "solid" && fill.kind !== "linearGradient")) continue;
      const opacity = Math.min(1, Math.max(0, finite(fill.opacity) ?? 1));
      if (fill.kind === "solid") {
        fills.push({ kind: "solid", color: color(fill.color, "#000000"), opacity });
        continue;
      }
      const stops: Array<{ offset: number; color: string }> = [];
      if (Array.isArray(fill.stops)) {
        for (const stop of fill.stops) {
          if (!record(stop)) continue;
          const offset = finite(stop.offset);
          if (offset !== null) stops.push({ offset: Math.min(1, Math.max(0, offset)), color: color(stop.color, "#000000") });
        }
      }
      if (stops.length > 0) fills.push({ kind: "linearGradient", opacity, angleDeg: finite(fill.angleDeg) ?? 0, stops });
    }
  }
  return {
    id,
    kind,
    role,
    anchor: anchor(value.anchor),
    offsetIn,
    sizeIn,
    rotationDeg: finite(value.rotationDeg) ?? 0,
    opacity: Math.min(1, Math.max(0, finite(value.opacity) ?? 1)),
    color: color(value.color, "#17110c"),
    sample: typeof value.sample === "string" || value.sample === null ? value.sample : undefined,
    textFragments: textFragments(value.textFragments),
    align: value.align === "center" || value.align === "right" ? value.align : "left",
    typeSizePt: finite(value.typeSizePt) ?? 12,
    fontFamily: nonEmpty(value.fontFamily) ?? "system-ui",
    fontWeight: finite(value.fontWeight) ?? 400,
    trackingEm: finite(value.trackingEm) ?? 0,
    verticalAlign: value.verticalAlign === "middle" || value.verticalAlign === "bottom" ? value.verticalAlign : "top",
    fitMode: value.fitMode === "contain" || value.fitMode === "exact" ? value.fitMode : "cover",
    assetRef: record(value.imageSource) && value.imageSource.kind === "templateAsset" ? nonEmpty(value.imageSource.assetRef) ?? undefined : undefined,
    inputSlotKey: kind === "image" && record(value.imageSource) && value.imageSource.kind === "binding" ? inputSlotKeys.get(id) : undefined,
    inputSlotLabel: kind === "image" && record(value.imageSource) && value.imageSource.kind === "binding" ? nonEmpty(value.inputSlotLabel) ?? undefined : undefined,
    cornerRadiusIn: Math.max(0, finite(value.cornerRadiusIn) ?? 0),
    cornerRadiiIn: cornerRadii(value.cornerRadiiIn),
    fills: fills.length > 0 ? fills : undefined,
  };
}

export function browserPreviewLayerPosition(
  layer: BrowserPreviewLayer,
  canvas: Pick<BrowserPreviewCanvas, "widthIn" | "heightIn">,
): { x: number; y: number } {
  const horizontal = layer.anchor[1];
  const vertical = layer.anchor[0];
  const fx = horizontal === "l" ? 0 : horizontal === "c" ? 0.5 : 1;
  const fy = vertical === "t" ? 0 : vertical === "m" ? 0.5 : 1;
  return {
    x: fx * canvas.widthIn + layer.offsetIn.x - fx * layer.sizeIn.width,
    y: fy * canvas.heightIn + layer.offsetIn.y - fy * layer.sizeIn.height,
  };
}

function backgroundArt(value: unknown): BrowserPreviewCanvas["backgroundArt"] {
  return value === "grain" || value === "lines" || value === "band" ? value : "none";
}

function inputSlotKeysForVariant(
  inputSlots: readonly BrowserPreviewInputSlot[],
  surfaceID: string,
  variantID: string,
): ReadonlyMap<string, string> {
  const keys = new Map<string, string>();
  const duplicates = new Set<string>();
  for (const inputSlot of inputSlots) {
    const mappedSurfaceID = nonEmpty(inputSlot.surface_id);
    const mappedVariantID = nonEmpty(inputSlot.variant_id);
    const nodeID = nonEmpty(inputSlot.node_id);
    const slotKey = nonEmpty(inputSlot.slot_key);
    if (mappedSurfaceID !== surfaceID || mappedVariantID !== variantID || !nodeID || !slotKey) continue;
    if (duplicates.has(nodeID)) continue;
    if (keys.has(nodeID)) {
      keys.delete(nodeID);
      duplicates.add(nodeID);
      continue;
    }
    keys.set(nodeID, slotKey);
  }
  return keys;
}

/**
 * The published browser document can contain advanced editor-only constructs.
 * This renderer deliberately accepts only the visual subset needed by the
 * public preview: surface geometry, background color, and image/text/shape
 * layers in the document's paint order.
 */
export function browserPreviewCanvas(
  browserDocumentJSON: string,
  surfaceID: string,
  variantID: string,
  inputSlots: readonly BrowserPreviewInputSlot[] = [],
): BrowserPreviewCanvas | null {
  try {
    const document = JSON.parse(browserDocumentJSON) as unknown;
    if (!record(document) || !Array.isArray(document.surfaces)) return null;
    const surface = document.surfaces.find((candidate) => record(candidate) && candidate.id === surfaceID);
    if (!record(surface)) return null;
    const widthIn = finite(surface.widthIn);
    const heightIn = finite(surface.heightIn);
    if (widthIn === null || heightIn === null || widthIn <= 0 || heightIn <= 0 || !Array.isArray(surface.variants)) return null;
    const variant = surface.variants.find((candidate) => record(candidate) && candidate.id === variantID) ?? surface.variants[0];
    if (!record(variant) || !Array.isArray(variant.nodes)) return null;
    const selectedVariantID = nonEmpty(variant.id);
    if (!selectedVariantID) return null;
    const inputSlotKeys = inputSlotKeysForVariant(inputSlots, surfaceID, selectedVariantID);
    const background = record(variant.background) ? variant.background : record(surface.background) ? surface.background : record(document.background) ? document.background : null;
    return {
      id: nonEmpty(surface.id) ?? surfaceID,
      widthIn,
      heightIn,
      backgroundColor: color(background?.baseColor, "#f4f0e8"),
      backgroundAssetRef: nonEmpty(background?.assetRef),
      backgroundArt: backgroundArt(background?.art),
      layers: variant.nodes.flatMap((node) => {
        const parsed = layer(node, inputSlotKeys);
        return parsed ? [parsed] : [];
      }),
    };
  } catch {
    return null;
  }
}
