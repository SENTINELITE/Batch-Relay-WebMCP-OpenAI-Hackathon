/**
 * Geometry-only quality review for a print draft.
 *
 * This module deliberately contains no model, no face detection and no network
 * call. Every finding is arithmetic over facts the storefront already holds:
 * the photograph's pixel dimensions, the slot's printed size in inches, the
 * published aspect ratio, and the crop the shopper can see. That is the whole
 * point — an exception the shopper can be shown and argue with, rather than an
 * opaque score.
 *
 * A finding is a *reason to look*, never a refusal: `needs_review` still adds
 * to the cart the moment the shopper says so. The verdict exists so the deck
 * can mark the one card worth a second glance, and so "accept the ready ones"
 * means something precise.
 */

export type PrintReviewCode =
  | "low_resolution"
  | "extreme_zoom"
  | "subject_near_trim"
  | "aspect_mismatch";

export type PrintReviewFinding = {
  code: PrintReviewCode;
  /** Written for the shopper, not the log: it says what to look at and why. */
  message: string;
  slot_key: string | null;
};

export type PrintReviewVerdict = "ready" | "needs_review";

export type PrintReview = {
  verdict: PrintReviewVerdict;
  findings: PrintReviewFinding[];
};

/**
 * The published floor when a template does not name one. 300 PPI is the
 * photographic-print convention the bundled specs themselves declare.
 */
export const DEFAULT_MINIMUM_EFFECTIVE_PPI = 300;

/**
 * Where "punched in hard" starts. The crop schema allows 1–4; past 2.5 a print
 * is showing well under a fifth of the source area, which is where softness and
 * clipped subjects start to be visible rather than theoretical.
 */
export const EXTREME_ZOOM_THRESHOLD = 2.5;

/**
 * The fraction of each edge treated as trim-risk when the published surface
 * geometry does not say. The bundled 8x10 spec declares a 0.25in important-
 * content inset, which is ~3% of that surface; 6% is the deliberately more
 * cautious default for a surface whose geometry was never published.
 */
export const DEFAULT_IMPORTANT_CONTENT_MARGIN = 0.06;

/** How far apart two aspect ratios must be to be called a mismatch. */
export const ASPECT_MISMATCH_RATIO = 2;

/** The widest the zoom-scaled trim margin may grow, so it cannot eat the frame. */
const MAXIMUM_TRIM_MARGIN = 0.4;

export type ReviewCrop = {
  zoom: number;
  /** 0–100 across the frame; 50 is centred. */
  focusX: number;
  focusY: number;
};

export type ReviewSlot = {
  slotKey: string | null;
  /** The role or alias word to use when naming this slot to a shopper. */
  label?: string | null;
  /** The slot's printed size, inches. Absent for an unresolved layout. */
  printedSizeIn?: { width: number; height: number } | null;
  /** The source photograph's pixel dimensions, when they have been decoded. */
  photoPixels?: { width: number; height: number } | null;
  /** The template's published floor for this slot, if one was published. */
  minimumEffectivePpi?: number | null;
  requiredAspectRatio?: { width: number; height: number } | null;
  /**
   * The published important-content inset as a fraction of each axis. Derived
   * from `surfaceGeometry.importantContentArea` where the spec publishes it.
   */
  importantContentMargin?: { x: number; y: number } | null;
  crop: ReviewCrop;
};

function positive(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function slotName(slot: ReviewSlot): string {
  return slot.label?.trim() || (slot.slotKey ? slot.slotKey.replace(/[_-]+/g, " ") : "this print");
}

/**
 * How many source pixels land on each printed inch.
 *
 * The photograph is cover-fitted to the slot, so the limiting axis sets the
 * scale, and zooming in spends those pixels over a larger printed area.
 */
export function effectivePpi(slot: ReviewSlot): number | null {
  const printedWidth = positive(slot.printedSizeIn?.width);
  const printedHeight = positive(slot.printedSizeIn?.height);
  const pixelWidth = positive(slot.photoPixels?.width);
  const pixelHeight = positive(slot.photoPixels?.height);
  if (!printedWidth || !printedHeight || !pixelWidth || !pixelHeight) return null;
  const zoom = positive(slot.crop.zoom) ?? 1;
  return Math.min(pixelWidth / printedWidth, pixelHeight / printedHeight) / zoom;
}

function lowResolution(slot: ReviewSlot): PrintReviewFinding | null {
  const ppi = effectivePpi(slot);
  if (ppi === null) return null;
  const floor = positive(slot.minimumEffectivePpi) ?? DEFAULT_MINIMUM_EFFECTIVE_PPI;
  if (ppi >= floor) return null;
  return {
    code: "low_resolution",
    slot_key: slot.slotKey,
    message: `At this crop the ${slotName(slot)} prints at about ${Math.round(ppi)} PPI, below the ${Math.round(floor)} PPI this size expects — it may look soft.`,
  };
}

function extremeZoom(slot: ReviewSlot): PrintReviewFinding | null {
  const zoom = positive(slot.crop.zoom) ?? 1;
  if (zoom <= EXTREME_ZOOM_THRESHOLD) return null;
  return {
    code: "extreme_zoom",
    slot_key: slot.slotKey,
    message: `The ${slotName(slot)} is cropped in to ${zoom.toFixed(1)}×, so most of the original photograph falls outside the print.`,
  };
}

/**
 * Whether the framing has carried the point the shopper focused on close to the
 * trim edge.
 *
 * This is a geometry heuristic and nothing more: it does not know where a face
 * is. It reads the crop's own focus point as the content of interest, and
 * treats the risk margin as growing with zoom, because the same pan carries
 * that point proportionally nearer the trim once the window is tighter. At
 * zoom 1 there is nothing to pan, so nothing is reported.
 */
function subjectNearTrim(slot: ReviewSlot): PrintReviewFinding | null {
  const zoom = positive(slot.crop.zoom) ?? 1;
  if (zoom <= 1) return null;
  const base = {
    x: positive(slot.importantContentMargin?.x) ?? DEFAULT_IMPORTANT_CONTENT_MARGIN,
    y: positive(slot.importantContentMargin?.y) ?? DEFAULT_IMPORTANT_CONTENT_MARGIN,
  };
  const margin = {
    x: Math.min(base.x * zoom, MAXIMUM_TRIM_MARGIN),
    y: Math.min(base.y * zoom, MAXIMUM_TRIM_MARGIN),
  };
  const focusX = Math.min(Math.max(slot.crop.focusX, 0), 100) / 100;
  const focusY = Math.min(Math.max(slot.crop.focusY, 0), 100) / 100;
  const nearX = Math.min(focusX, 1 - focusX) < margin.x;
  const nearY = Math.min(focusY, 1 - focusY) < margin.y;
  if (!nearX && !nearY) return null;
  return {
    code: "subject_near_trim",
    slot_key: slot.slotKey,
    message: `Subject may sit close to the trim edge of the ${slotName(slot)} — the framing is pushed to the ${nearX ? (focusX < 0.5 ? "left" : "right") : (focusY < 0.5 ? "top" : "bottom")} at this crop.`,
  };
}

function aspectMismatch(slot: ReviewSlot): PrintReviewFinding | null {
  const wantedWidth = positive(slot.requiredAspectRatio?.width);
  const wantedHeight = positive(slot.requiredAspectRatio?.height);
  const pixelWidth = positive(slot.photoPixels?.width);
  const pixelHeight = positive(slot.photoPixels?.height);
  if (!wantedWidth || !wantedHeight || !pixelWidth || !pixelHeight) return null;
  const wanted = wantedWidth / wantedHeight;
  const actual = pixelWidth / pixelHeight;
  const difference = Math.max(wanted / actual, actual / wanted);
  if (difference <= ASPECT_MISMATCH_RATIO) return null;
  return {
    code: "aspect_mismatch",
    slot_key: slot.slotKey,
    message: `The photograph in the ${slotName(slot)} is a very different shape from the ${wantedWidth}:${wantedHeight} the slot prints, so a lot of it is cropped away.`,
  };
}

const checks = [lowResolution, extremeZoom, subjectNearTrim, aspectMismatch];

/** Every finding for one slot, in a stable order. */
export function reviewSlot(slot: ReviewSlot): PrintReviewFinding[] {
  return checks.flatMap((check) => {
    const finding = check(slot);
    return finding ? [finding] : [];
  });
}

/**
 * The verdict for a whole draft: every slot's findings, and `needs_review` when
 * any of them found something. A draft whose geometry cannot be resolved yet
 * reports `ready` with no findings rather than inventing a doubt.
 */
export function reviewPrint(slots: readonly ReviewSlot[]): PrintReview {
  const findings = slots.flatMap((slot) => reviewSlot(slot));
  return { verdict: findings.length > 0 ? "needs_review" : "ready", findings };
}

/** The wire shape every tool response reports a verdict in. */
export function printReviewWire(review: PrintReview) {
  return {
    verdict: review.verdict,
    findings: review.findings.map((finding) => ({
      code: finding.code,
      slot_key: finding.slot_key,
      message: finding.message,
    })),
  };
}

/** The one-line summary a proposal card and an agent both read. */
export function printReviewSummary(review: PrintReview): string {
  return review.verdict === "ready"
    ? "Ready"
    : review.findings[0]?.message ?? "Needs review";
}

/** The counts ask_storefront reports across every pending proposal. */
export function reviewCounts(reviews: readonly PrintReview[]) {
  return {
    proposed: reviews.length,
    ready: reviews.filter((review) => review.verdict === "ready").length,
    needs_review: reviews.filter((review) => review.verdict === "needs_review").length,
  };
}
