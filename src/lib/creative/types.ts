/**
 * The small, browser-safe document model used by Creative.
 *
 * A project stores references to image assets and layout instructions. The
 * bytes for those assets live in IndexedDB, which keeps the document portable
 * and makes replacing a background independent from the supplied athlete and
 * logo pixels.
 */

export type CreativeFormat = "card" | "banner";

export type CreativeDimensions = Readonly<{
  width: number;
  height: number;
}>;

export const CREATIVE_FORMAT_DIMENSIONS: Readonly<Record<CreativeFormat, CreativeDimensions>> = {
  card: { width: 1080, height: 1350 },
  banner: { width: 1920, height: 1080 },
};

export type CreativeAssetSlot = "background" | "athlete" | "logo";

export type CreativeAssetSource = "upload" | "sample" | "generated";

/** A reference is metadata only. Image bytes are kept in IndexedDB. */
export type CreativeAssetReference = {
  id: string;
  slot: CreativeAssetSlot;
  name: string;
  mimeType: string;
  source: CreativeAssetSource;
  blobKey: string;
  width?: number;
  height?: number;
  /** A remote URL is optional and only useful for a known, trusted result. */
  url?: string;
  attribution?: string;
};

export type CreativePoint = {
  x: number;
  y: number;
};

/**
 * Layer geometry uses fractions of the selected output surface. This keeps a
 * single document usable at both exact export sizes without rounding drift.
 */
export type CreativeLayerTransform = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDeg?: number;
  opacity?: number;
  fit?: "cover" | "contain";
};

export type CreativeTextAlign = "left" | "center" | "right";

export type CreativeTextLayer = {
  id: string;
  value: string;
  transform: CreativeLayerTransform;
  color?: string;
  fontFamily?: string;
  fontSizeRatio?: number;
  fontWeight?: number;
  align?: CreativeTextAlign;
  maxLines?: number;
  letterSpacing?: number;
  shadow?: {
    color: string;
    blur: number;
    offsetX: number;
    offsetY: number;
  };
};

export type CreativeFormatLayout = {
  background: CreativeLayerTransform;
  athlete: CreativeLayerTransform;
  logo: CreativeLayerTransform;
  text: CreativeTextLayer[];
};

export type CreativeEvent = {
  name: string;
  date: string;
  location: string;
  callToAction: string;
};

export type CreativePalette = {
  primary: string;
  accent: string;
  text?: string;
};

export type CreativeBackgroundCandidate = {
  id: string;
  asset: CreativeAssetReference;
  prompt: string;
  createdAt: string;
  generationId?: string;
  status?: "pending" | "ready" | "failed";
  warning?: string;
};

/** A reviewed transparent athlete result tied to one exact source asset. */
export type CreativeCutoutCandidate = {
  id: string;
  asset: CreativeAssetReference;
  sourceAssetId: string;
  prompt: string;
  createdAt: string;
  generationId?: string;
  status?: "pending" | "ready" | "failed";
  warning?: string;
};

export type CreativeGenerationReference = {
  id: string;
  candidateId?: string;
  prompt: string;
  model?: string;
  estimatedCostUsd?: number;
  actualCostUsd?: number;
  status: "proposed" | "queued" | "running" | "succeeded" | "failed" | "unknown";
  createdAt: string;
  target?: "athlete" | "background";
  sourceAssetId?: string;
};

export type CreativeProject = {
  id: string;
  revision: number;
  event: CreativeEvent;
  palette: CreativePalette;
  brief: string;
  format: CreativeFormat;
  assets: Partial<Record<CreativeAssetSlot, CreativeAssetReference>>;
  layouts: Record<CreativeFormat, CreativeFormatLayout>;
  backgroundCandidates: CreativeBackgroundCandidate[];
  /** The supplied athlete, retained when a transparent cutout is applied. */
  athleteOriginal?: CreativeAssetReference;
  athleteCutoutCandidates?: CreativeCutoutCandidate[];
  generationRefs: CreativeGenerationReference[];
  createdAt: string;
  updatedAt: string;
};

/**
 * Asset inputs accepted by the renderer. URLs are loaded before the shared
 * draw pass; already decoded CanvasImageSource values are useful for previews
 * and tests that want to avoid another decode.
 */
export type CreativeResolvedAsset = CanvasImageSource | string;
export type CreativeResolvedAssets = Partial<Record<CreativeAssetSlot, CreativeResolvedAsset>>;

export type CreativeRenderTarget = {
  width: number;
  height: number;
  getContext(contextId: "2d"): CanvasRenderingContext2D | null;
  toBlob?: (
    callback: (blob: Blob | null) => void,
    type?: string,
    quality?: number,
  ) => void;
  convertToBlob?: (options?: { type?: string; quality?: number }) => Promise<Blob>;
};

export type CreativeProjectUpdate = Partial<Pick<CreativeProject, "event" | "palette" | "brief" | "format" | "assets" | "layouts" | "backgroundCandidates" | "athleteOriginal" | "athleteCutoutCandidates" | "generationRefs">>;
