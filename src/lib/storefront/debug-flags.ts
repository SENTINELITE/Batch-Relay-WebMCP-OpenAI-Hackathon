/**
 * Development-only display switches, and the one place that decides whether any
 * of them may be on.
 *
 * The rule is deliberately not a build-time one. A production bundle can be
 * served from anywhere — a preview host, a laptop, a colleague's tunnel — and a
 * debug overlay that leaks onto a real storefront because someone typed a query
 * parameter is a worse failure than a debug overlay nobody can reach. So the
 * gate is evaluated at runtime against the host actually serving the page, and
 * only the two loopback names open it. The query parameter alone never does.
 *
 * The location is injected rather than read from `window`, which is what lets
 * `node --test` state the rule as facts instead of trusting a comment.
 */
import type { FaceBox, SubjectRegion } from "./face-geometry.ts";

/** The only hosts on which any debug overlay may render. */
export const DEBUG_HOSTNAMES: readonly string[] = ["localhost", "127.0.0.1"];

/** The `debug` value that turns the face overlay on. */
export const FACE_DEBUG_FLAG = "faces";

/** Just enough of `window.location` to decide, so tests can supply a literal. */
export type DebugLocation = {
  readonly hostname?: string | null;
  readonly search?: string | null;
  readonly hash?: string | null;
};

/** Whether this host is one a developer is looking at directly. */
export function isDebugHost(hostname: string | null | undefined): boolean {
  return typeof hostname === "string" && DEBUG_HOSTNAMES.includes(hostname.toLowerCase());
}

function flagRequested(fragment: string | null | undefined, parameter: string, flag: string): boolean {
  if (typeof fragment !== "string" || fragment.length === 0) return false;
  // A hash reads as a query string once its marker is gone, which is what makes
  // `#debug=faces` work without a second parser.
  const params = new URLSearchParams(fragment.replace(/^[?#]/, ""));
  return params.getAll(parameter).some((value) => value.split(",").some((entry) => entry.trim() === flag));
}

/** The `reset` value that wipes the saved workbench. */
export const WORKBENCH_RESET_FLAG = "workbench";

/**
 * The presenter's panic button, `?reset=workbench`.
 *
 * Deliberately *not* host-gated, unlike the debug overlays above. Those reveal
 * developer chrome, so they are confined to loopback; this one only discards
 * this browser's own scratch workbench, which is a thing its owner is always
 * entitled to do — and the moment it is needed is the moment the demo is being
 * given from somewhere other than localhost.
 */
export function workbenchResetRequested(location: DebugLocation | null | undefined): boolean {
  if (!location) return false;
  return flagRequested(location.search, "reset", WORKBENCH_RESET_FLAG)
    || flagRequested(location.hash, "reset", WORKBENCH_RESET_FLAG);
}

/**
 * Whether `?debug=faces` (or `#debug=faces`) is asking for the overlay. Asking
 * is not the same as getting it — see `faceDebugEnabled`.
 */
export function faceDebugRequested(location: DebugLocation | null | undefined): boolean {
  if (!location) return false;
  return flagRequested(location.search, "debug", FACE_DEBUG_FLAG)
    || flagRequested(location.hash, "debug", FACE_DEBUG_FLAG);
}

/**
 * The whole gate: a loopback host *and* an explicit request. Everything that
 * renders debug chrome asks this function and nothing else.
 */
export function faceDebugEnabled(location: DebugLocation | null | undefined): boolean {
  if (!location) return false;
  return isDebugHost(location.hostname) && faceDebugRequested(location);
}

/**
 * What the detection pipeline currently knows about one photograph.
 *
 * `pending` and `none` are distinct on purpose: the lazy pass publishes faces
 * only when it finds some, so "no boxes drawn" would otherwise be ambiguous
 * between a photograph with nobody in it and one nobody has looked at yet.
 */
export type FaceDebugState = "pending" | "none" | "faces" | "unavailable";

export type FaceDebugEntry = {
  readonly faces: readonly FaceBox[];
  readonly state: FaceDebugState;
  /** The union the crop heuristics would frame around, when there is one. */
  readonly subject?: SubjectRegion | null;
};

/** Face debug data by photo id. Absent entirely when the gate is shut. */
export type FaceDebugMap = Readonly<Record<string, FaceDebugEntry>>;

/** A rectangle in percentages of the thumbnail box, ready for CSS. */
export type OverlayRect = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

/**
 * Where a box normalised to the photograph lands on a thumbnail drawn with
 * `object-fit: cover`.
 *
 * Cover scales the photograph until it covers the frame and centres the
 * overflow, so one axis is stretched relative to the naive 0–1 mapping and
 * shifted by half the spill. Getting this wrong would put every box slightly
 * off on exactly the photographs whose aspect differs most from the frame —
 * which is to say, the ones worth checking. Results may fall outside 0–100:
 * that is a face the crop genuinely cuts off, and the caller clips it.
 */
export function coverOverlayRect(
  box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  sourceAspectRatio: number,
  frameAspectRatio: number,
): OverlayRect | null {
  const source = Number(sourceAspectRatio);
  const frame = Number(frameAspectRatio);
  if (!Number.isFinite(source) || !Number.isFinite(frame) || source <= 0 || frame <= 0) return null;
  if (![box.x, box.y, box.width, box.height].every((value) => Number.isFinite(value))) return null;
  const scale = source / frame;
  if (scale >= 1) {
    // The photograph is wider than the frame: it spills left and right.
    return {
      left: (box.x * scale - (scale - 1) / 2) * 100,
      top: box.y * 100,
      width: box.width * scale * 100,
      height: box.height * 100,
    };
  }
  const vertical = 1 / scale;
  return {
    left: box.x * 100,
    top: (box.y * vertical - (vertical - 1) / 2) * 100,
    width: box.width * 100,
    height: box.height * vertical * 100,
  };
}

/** The short label the overlay badge shows for each state. */
export function faceDebugBadge(entry: FaceDebugEntry | undefined): string {
  if (!entry) return "…";
  if (entry.state === "pending") return "…";
  if (entry.state === "unavailable") return "×";
  return String(entry.faces.length);
}
