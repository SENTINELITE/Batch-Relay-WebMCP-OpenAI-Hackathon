/**
 * `focusOn` — the one place the crop vocabulary is allowed to mean something
 * about the *picture* rather than about coordinates.
 *
 * Every other crop value the storefront accepts is a number the caller already
 * knows: a zoom, a focus point, an offset. `focusOn: "faces"` is different — it
 * is an intention, and the app, not the agent, owns turning it into numbers,
 * because the app is the only party that has the detected face boxes. This
 * module is that translation and nothing else: no DOM, no React, no detector,
 * so the rule can be tested exactly under `node --test`.
 *
 * The invariant worth stating plainly, because a shopper was mis-narrated to
 * before it existed: a caller may ask for face-centring, but only the response
 * may claim it happened. When there are no faces, or detection has not landed,
 * or the geometry is unknown, the patch falls back to whatever explicit values
 * the caller gave — it never silently centres on nothing — and `focusApplied`
 * says which of those it was, so an agent that reads its own response cannot
 * honestly tell the shopper it framed a face it never found.
 */
import {
  confidentFaces,
  defaultCropForSubject,
  focusForSubject,
  subjectRegionFromFaces,
  type FaceBox,
  type SubjectRegion,
} from "./face-geometry.ts";

/** What the caller asked the crop to aim at. */
export type FocusPreset = "faces" | "center";

/**
 * What the app actually did. Only "faces" licenses an agent to say the crop is
 * centred on a face; every other value is a reason it is not.
 */
export type FocusAppliedState =
  | "faces"
  | "center"
  | "no_faces_detected"
  | "faces_not_ready"
  | "detection_unavailable"
  | "no_photo_assigned"
  | "unknown_geometry"
  | "explicit";

/** The crop values a patch may carry, in the storefront's one vocabulary. */
export type CropPatchValues = {
  zoom?: number;
  focusX?: number;
  focusY?: number;
  offsetX?: number;
  offsetY?: number;
};

export type FocusPresetInput = {
  /** The requested preset, or null when the caller named coordinates only. */
  preset: FocusPreset | null;
  /** The explicit crop values from the same patch. These always win. */
  patch: CropPatchValues;
  /**
   * The faces known for the photograph this crop lands on. An empty array means
   * detection finished and found none; `null` means it has not finished, which
   * is a different answer and gets a different report.
   */
  faces: readonly FaceBox[] | null;
  /** False once the detector has given up for the session. */
  detectionAvailable?: boolean;
  /** Printed slot width / height. */
  targetAspectRatio: number | null;
  /** Source photograph width / height. */
  sourceAspectRatio: number | null;
  /** False when the target slot has no photograph to look at yet. */
  hasPhoto?: boolean;
};

export type FocusPresetResult = {
  /** The patch to apply: the caller's values, with computed focus merged in. */
  patch: CropPatchValues;
  focusApplied: FocusAppliedState;
  /** How many confident faces were found, or null when that is not yet known. */
  facesDetected: number | null;
  subjectRegion: SubjectRegion | null;
  /** Values the caller supplied that overrode a computed one. */
  explicitOverrides: Array<"zoom" | "focusX" | "focusY">;
  /** One sentence an agent can narrate without overstating what happened. */
  note: string;
};

const NOTES: Record<FocusAppliedState, string> = {
  faces: "Focus was computed from the faces detected in this photograph; the crop is centred on them.",
  center: "Focus was set to the centre of the frame as requested; no face detection was involved.",
  no_faces_detected:
    "No faces were detected in this photograph, so the crop was NOT face-centred and the explicit values stand. Do not tell the shopper it is centred on a face.",
  faces_not_ready:
    "Face detection for this photograph had not finished in time, so the crop was NOT face-centred and the explicit values stand. Do not claim face-centring; call again shortly if it matters.",
  detection_unavailable:
    "Face detection is unavailable in this browser, so the crop was NOT face-centred and the explicit values stand. Do not claim face-centring.",
  no_photo_assigned:
    "This slot has no photograph assigned, so there was nothing to detect faces in and the crop was NOT face-centred.",
  unknown_geometry:
    "The printed size or the photograph's pixel dimensions are not known yet, so the face position could not be converted into a crop and the explicit values stand.",
  explicit: "The crop used exactly the values given; no focus preset was requested.",
};

/** The `focusOn` value from a patch, accepting the snake_case spelling too. */
export function readFocusPreset(patch: Record<string, unknown> | null | undefined): FocusPreset | null {
  const raw = patch?.focusOn ?? patch?.focus_on;
  return raw === "faces" || raw === "center" ? raw : null;
}

function aspect(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function fallback(
  input: FocusPresetInput,
  focusApplied: FocusAppliedState,
  facesDetected: number | null,
  subjectRegion: SubjectRegion | null = null,
): FocusPresetResult {
  return {
    patch: { ...input.patch },
    focusApplied,
    facesDetected,
    subjectRegion,
    explicitOverrides: [],
    note: NOTES[focusApplied],
  };
}

/**
 * Resolve one crop patch's `focusOn` against what is actually known.
 *
 * When the preset resolves, an explicit zoom is honoured and the focus point is
 * recomputed *for that zoom* — which is the whole fix for "zoom in on her face
 * by quite a lot": a zoom of 3 with no focus used to magnify the middle of the
 * photograph, which on a standing portrait is a torso.
 */
export function resolveFocusPreset(input: FocusPresetInput): FocusPresetResult {
  const known = input.faces === null ? null : confidentFaces(input.faces).length;
  if (!input.preset) return fallback(input, "explicit", known, subjectRegionFromFaces(input.faces ?? []));
  if (input.preset === "center") {
    const explicitOverrides: Array<"zoom" | "focusX" | "focusY"> = [];
    if (typeof input.patch.focusX === "number") explicitOverrides.push("focusX");
    if (typeof input.patch.focusY === "number") explicitOverrides.push("focusY");
    return {
      patch: { ...input.patch, focusX: input.patch.focusX ?? 50, focusY: input.patch.focusY ?? 50 },
      focusApplied: "center",
      facesDetected: known,
      subjectRegion: subjectRegionFromFaces(input.faces ?? []),
      explicitOverrides,
      note: NOTES.center,
    };
  }

  if (input.hasPhoto === false) return fallback(input, "no_photo_assigned", null);
  if (input.detectionAvailable === false) return fallback(input, "detection_unavailable", null);
  if (input.faces === null) return fallback(input, "faces_not_ready", null);

  const subject = subjectRegionFromFaces(input.faces);
  if (!subject) return fallback(input, "no_faces_detected", known ?? 0);

  const target = aspect(input.targetAspectRatio);
  const source = aspect(input.sourceAspectRatio);
  if (!target || !source) return fallback(input, "unknown_geometry", known, subject);

  const explicitZoom = typeof input.patch.zoom === "number" ? input.patch.zoom : null;
  const computed = explicitZoom === null
    ? defaultCropForSubject(subject, target, source)
    : (() => {
      const focus = focusForSubject(subject, target, source, explicitZoom);
      return focus ? { zoom: explicitZoom, ...focus } : null;
    })();
  if (!computed) return fallback(input, "unknown_geometry", known, subject);

  const explicitOverrides: Array<"zoom" | "focusX" | "focusY"> = [];
  if (explicitZoom !== null) explicitOverrides.push("zoom");
  if (typeof input.patch.focusX === "number") explicitOverrides.push("focusX");
  if (typeof input.patch.focusY === "number") explicitOverrides.push("focusY");

  return {
    patch: {
      ...input.patch,
      zoom: computed.zoom,
      focusX: typeof input.patch.focusX === "number" ? input.patch.focusX : computed.focusX,
      focusY: typeof input.patch.focusY === "number" ? input.patch.focusY : computed.focusY,
    },
    focusApplied: "faces",
    facesDetected: known ?? 0,
    subjectRegion: subject,
    explicitOverrides,
    note: explicitOverrides.some((value) => value === "focusX" || value === "focusY")
      ? `${NOTES.faces} An explicit ${explicitOverrides.filter((value) => value !== "zoom").join(" and ")} overrode the computed value on that axis.`
      : NOTES.faces,
  };
}

/**
 * The face facts published beside a slot, small enough to sit in every
 * response: a count and the union box, which is enough for an agent to compute
 * its own focus point if it would rather not use the preset.
 */
export type FaceFacts = {
  faces_detected: number | null;
  subject_region: SubjectRegion | null;
};

export function faceFacts(faces: readonly FaceBox[] | null | undefined): FaceFacts {
  if (faces === null || faces === undefined) return { faces_detected: null, subject_region: null };
  const usable = confidentFaces(faces);
  return {
    faces_detected: usable.length,
    subject_region: subjectRegionFromFaces(faces),
  };
}
