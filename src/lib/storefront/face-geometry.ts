/**
 * The arithmetic behind the optional face signal — and nothing else.
 *
 * This module has no import of MediaPipe, no DOM and no React, so every rule it
 * encodes is testable under plain `node --test`. `face-detection.ts` is the only
 * place a model is loaded, and it produces exactly the `FaceBox` shape declared
 * here. That split is the point: a person detector, a saliency map or a hand
 * placed box could feed the same functions tomorrow without the review code
 * learning anything new.
 *
 * Every box is NORMALISED to the source photograph — x, y, width and height are
 * fractions of the image, never pixels — because the storefront resizes,
 * rasterises and re-crops the same photograph at several points and only a
 * fraction survives all of them intact.
 */

/** One detected subject, normalised to the source photograph. */
export type FaceBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0–1. Absent detectors may report 1; the review treats it as certainty. */
  confidence: number;
};

/** The union of the faces worth framing around, in the same normalised space. */
export type SubjectRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Below this the detector is guessing. BlazeFace's own default acceptance
 * threshold is 0.5, so a box that only just cleared it is not strong enough to
 * override a geometry finding — it takes a clearly-seen face to do that.
 */
export const FACE_CONFIDENCE_FLOOR = 0.5;

/**
 * How much of a face must survive the crop before the print is called fine.
 * A sliver of cheek at the edge is a cropped face however you count it.
 */
export const FACE_VISIBLE_FRACTION_FLOOR = 0.85;

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * A box the rest of the module can trust: finite, inside the image, and with
 * real extent. Anything else is discarded rather than repaired, because a
 * detector that reports nonsense should be treated as having reported nothing.
 */
export function normalizedFaceBox(value: {
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  confidence?: unknown;
}): FaceBox | null {
  const x = finite(value.x);
  const y = finite(value.y);
  const width = finite(value.width);
  const height = finite(value.height);
  if (x === null || y === null || width === null || height === null) return null;
  if (width <= 0 || height <= 0) return null;
  const left = clamp(x, 0, 1);
  const top = clamp(y, 0, 1);
  const right = clamp(x + width, 0, 1);
  const bottom = clamp(y + height, 0, 1);
  if (right <= left || bottom <= top) return null;
  const confidence = finite(value.confidence);
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    confidence: confidence === null ? 1 : clamp(confidence, 0, 1),
  };
}

/** The faces confident enough to be acted on. */
export function confidentFaces(
  faces: readonly FaceBox[] | null | undefined,
  floor: number = FACE_CONFIDENCE_FLOOR,
): FaceBox[] {
  if (!Array.isArray(faces)) return [];
  return faces.filter((face) => face.confidence >= floor);
}

/**
 * The single region a crop should try to keep: the union of every confident
 * face. A union rather than the largest face, so a group portrait is framed as
 * a group instead of around whoever stood nearest the camera.
 */
export function subjectRegionFromFaces(
  faces: readonly FaceBox[] | null | undefined,
  floor: number = FACE_CONFIDENCE_FLOOR,
): SubjectRegion | null {
  const usable = confidentFaces(faces, floor);
  if (usable.length === 0) return null;
  let left = 1;
  let top = 1;
  let right = 0;
  let bottom = 0;
  for (const face of usable) {
    left = Math.min(left, face.x);
    top = Math.min(top, face.y);
    right = Math.max(right, face.x + face.width);
    bottom = Math.max(bottom, face.y + face.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The window of the source photograph a crop actually prints, normalised. */
export type SourceWindow = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type CropFrame = {
  /** Source photograph width / height. */
  sourceAspectRatio: number;
  /** Printed slot width / height. */
  targetAspectRatio: number;
  zoom: number;
  /** 0–100 across the frame, matching the storefront's crop vocabulary. */
  focusX: number;
  focusY: number;
};

/**
 * Which part of the photograph survives a crop.
 *
 * This mirrors the storefront's one framing convention exactly: cover-fit the
 * photograph to the slot, divide by the zoom, then slide the remaining slack by
 * the focus point — the same arithmetic `browserPreviewCropRect` bakes into an
 * uploaded asset, expressed in fractions instead of pixels so a normalised face
 * box can be compared against it directly.
 */
export function sourceWindowForCrop(frame: CropFrame): SourceWindow | null {
  const sourceAspectRatio = finite(frame.sourceAspectRatio);
  const targetAspectRatio = finite(frame.targetAspectRatio);
  if (!sourceAspectRatio || !targetAspectRatio || sourceAspectRatio <= 0 || targetAspectRatio <= 0) return null;
  const zoom = Math.max(1, finite(frame.zoom) ?? 1);
  const wider = sourceAspectRatio > targetAspectRatio;
  const baseWidth = wider ? targetAspectRatio / sourceAspectRatio : 1;
  const baseHeight = wider ? 1 : sourceAspectRatio / targetAspectRatio;
  const width = clamp(baseWidth / zoom, 0, 1);
  const height = clamp(baseHeight / zoom, 0, 1);
  return {
    left: (1 - width) * clamp(finite(frame.focusX) ?? 50, 0, 100) / 100,
    top: (1 - height) * clamp(finite(frame.focusY) ?? 50, 0, 100) / 100,
    width,
    height,
  };
}

/** Where a normalised source box lands inside the printed frame. */
export type ProjectedBox = {
  /** Frame coordinates: 0 is the left/top trim, 1 the right/bottom trim. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** How much of the box the print still shows, 0–1. */
  visibleFraction: number;
};

export function projectBoxIntoFrame(
  box: { x: number; y: number; width: number; height: number },
  sourceWindow: SourceWindow,
): ProjectedBox | null {
  if (sourceWindow.width <= 0 || sourceWindow.height <= 0) return null;
  const x = (box.x - sourceWindow.left) / sourceWindow.width;
  const y = (box.y - sourceWindow.top) / sourceWindow.height;
  const width = box.width / sourceWindow.width;
  const height = box.height / sourceWindow.height;
  const visibleWidth = Math.max(0, Math.min(x + width, 1) - Math.max(x, 0));
  const visibleHeight = Math.max(0, Math.min(y + height, 1) - Math.max(y, 0));
  const area = width * height;
  return {
    x,
    y,
    width,
    height,
    visibleFraction: area > 0 ? (visibleWidth * visibleHeight) / area : 0,
  };
}

/** How close a projected box comes to each trim edge, in frame fractions. */
export function edgeClearances(box: ProjectedBox) {
  return {
    left: box.x,
    top: box.y,
    right: 1 - (box.x + box.width),
    bottom: 1 - (box.y + box.height),
  };
}

/**
 * The breathing room a face-centred crop leaves around the subject: the printed
 * frame is sized so the subject occupies the middle ~74% of the tighter axis.
 */
export const SUBJECT_BREATHING_ROOM = 0.13;

export type SubjectCrop = {
  zoom: number;
  focusX: number;
  focusY: number;
};

/**
 * Frame a subject so its detected region occupies a requested share of the
 * printed width. The zoom is still constrained to the storefront's 1x-4x
 * contract; callers can compare the resulting width with their request when a
 * very small or already-large face makes the exact percentage impossible.
 */
export function cropForSubjectWidth(
  subject: SubjectRegion | null,
  targetAspectRatio: number,
  sourceAspectRatio: number,
  subjectWidthPercent: number,
): SubjectCrop | null {
  if (!subject) return null;
  const target = finite(targetAspectRatio);
  const source = finite(sourceAspectRatio);
  const requested = finite(subjectWidthPercent);
  if (!target || !source || target <= 0 || source <= 0 || requested === null || requested <= 0 || requested > 100) return null;
  if (subject.width <= 0 || subject.height <= 0) return null;

  const baseWidth = source > target ? target / source : 1;
  const wantedWindowWidth = subject.width / (requested / 100);
  const zoom = clamp(baseWidth / wantedWindowWidth, 1, 4);
  const focus = focusForSubject(subject, target, source, zoom);
  return focus ? { zoom, ...focus } : null;
}

/**
 * The focus point that centres a subject at a zoom somebody else chose.
 *
 * `defaultCropForSubject` picks its own zoom; this is the same arithmetic with
 * the zoom held fixed, which is what a request like "zoom right in on her face"
 * needs — the shopper named the magnification, so only the pan is ours to
 * compute. At a zoom tighter than the subject the point still centres the
 * subject's middle, so the crop lands on the face rather than the torso.
 */
export function focusForSubject(
  subject: SubjectRegion | null,
  targetAspectRatio: number,
  sourceAspectRatio: number,
  zoom: number,
): { focusX: number; focusY: number } | null {
  if (!subject) return null;
  const target = finite(targetAspectRatio);
  const source = finite(sourceAspectRatio);
  if (!target || !source || target <= 0 || source <= 0) return null;
  if (subject.width <= 0 || subject.height <= 0) return null;
  const magnification = clamp(finite(zoom) ?? 1, 1, 4);
  const wider = source > target;
  const baseWidth = wider ? target / source : 1;
  const baseHeight = wider ? 1 : source / target;
  const width = clamp(baseWidth / magnification, 0, 1);
  const height = clamp(baseHeight / magnification, 0, 1);
  const centerX = subject.x + subject.width / 2;
  const centerY = subject.y + subject.height / 2;
  const slackX = 1 - width;
  const slackY = 1 - height;
  return {
    focusX: slackX <= 0 ? 50 : clamp(((centerX - width / 2) / slackX) * 100, 0, 100),
    focusY: slackY <= 0 ? 50 : clamp(((centerY - height / 2) / slackY) * 100, 0, 100),
  };
}

/**
 * A starting crop that centres the detected subject.
 *
 * It never zooms *out* — zoom 1 is already the whole cover-fitted frame — and it
 * never zooms past the schema's ceiling of 4. The focus point is chosen so the
 * subject's centre lands in the middle of the printed frame, then clamped to the
 * range the crop schema allows, which is what stops a subject near an edge from
 * demanding a pan the renderer would refuse.
 */
export function defaultCropForSubject(
  subject: SubjectRegion | null,
  targetAspectRatio: number,
  sourceAspectRatio: number,
  breathingRoom: number = SUBJECT_BREATHING_ROOM,
): SubjectCrop | null {
  if (!subject) return null;
  const target = finite(targetAspectRatio);
  const source = finite(sourceAspectRatio);
  if (!target || !source || target <= 0 || source <= 0) return null;
  if (subject.width <= 0 || subject.height <= 0) return null;

  const wider = source > target;
  const baseWidth = wider ? target / source : 1;
  const baseHeight = wider ? 1 : source / target;

  const room = clamp(finite(breathingRoom) ?? SUBJECT_BREATHING_ROOM, 0, 0.45);
  // The window must be wide enough to hold the subject plus its margins on both
  // sides; the tighter axis decides, so the looser one only ever gains room.
  const wantedWidth = subject.width / (1 - 2 * room);
  const wantedHeight = subject.height / (1 - 2 * room);
  const zoom = clamp(Math.min(baseWidth / wantedWidth, baseHeight / wantedHeight), 1, 4);

  const focus = focusForSubject(subject, target, source, zoom);
  return focus ? { zoom, ...focus } : null;
}
