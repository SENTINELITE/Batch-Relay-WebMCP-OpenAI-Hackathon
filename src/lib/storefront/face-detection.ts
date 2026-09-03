/**
 * Optional, entirely-in-browser face detection.
 *
 * The contract this module keeps with the rest of the storefront is short: it
 * either returns face boxes or it returns none, and returning none is never an
 * error anybody has to handle. The print review's geometry heuristics remain the
 * backbone; faces only ever sharpen a finding that would otherwise be a guess.
 * So every failure path here — the package not resolving, `/mediapipe` serving a
 * 404, the wasm runtime throwing, a decode failing, inference throwing — ends in
 * an empty array, and after a couple of those the module stops trying at all
 * rather than paying the load cost once per photograph.
 *
 * Nothing leaves the browser. The model and the wasm fileset are served from
 * this app's own `public/mediapipe`, so a shopper's photograph is never uploaded
 * anywhere to be looked at, and the feature works with the network off.
 *
 * The MediaPipe import is dynamic and lives inside a function, which is what
 * lets `node --test` import this file to exercise the bookkeeping below without
 * a browser anywhere in sight.
 */
import { normalizedFaceBox, type FaceBox } from "./face-geometry.ts";

export type { FaceBox } from "./face-geometry.ts";

/** Where the self-hosted assets live. Both are same-origin, always. */
export const FACE_DETECTION_WASM_PATH = "/mediapipe/wasm";
export const FACE_DETECTION_MODEL_PATH = "/mediapipe/blaze_face_short_range.tflite";

/** BlazeFace's own default. Below this the box is more noise than subject. */
export const MINIMUM_DETECTION_CONFIDENCE = 0.5;

/**
 * How many failures it takes to give up for the rest of the session.
 *
 * One failure can be a transient fetch; two in a row means the assets or the
 * runtime are simply not available here, and retrying per photograph would burn
 * a multi-megabyte download attempt each time for the same answer.
 */
export const FACE_DETECTION_FAILURE_LIMIT = 2;

export type DetectionBudget = {
  /** Whether detection should still be attempted. */
  readonly available: boolean;
  readonly failures: number;
  /** Records a failure and returns whether detection is still available. */
  fail(): boolean;
  /** Clears the failure count after a success. */
  succeed(): void;
  reset(): void;
};

/**
 * The give-up rule, kept pure and separate so it can be tested exactly rather
 * than inferred from whether a browser happened to have the model.
 */
export function createDetectionBudget(limit: number = FACE_DETECTION_FAILURE_LIMIT): DetectionBudget {
  const ceiling = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 1;
  let failures = 0;
  return {
    get available() {
      return failures < ceiling;
    },
    get failures() {
      return failures;
    },
    fail() {
      failures += 1;
      return failures < ceiling;
    },
    succeed() {
      failures = 0;
    },
    reset() {
      failures = 0;
    },
  };
}

type MediaPipeFaceDetector = {
  detect(image: CanvasImageSource): { detections: Array<{ categories: Array<{ score: number }>; boundingBox?: { originX: number; originY: number; width: number; height: number } }> };
};

export type FaceDetectionSource = ImageBitmap | HTMLImageElement | HTMLCanvasElement;

const budget = createDetectionBudget();
const cache = new Map<string, FaceBox[]>();
const inFlight = new Map<string, Promise<FaceBox[]>>();
let detectorPromise: Promise<MediaPipeFaceDetector | null> | null = null;

/** Whether the detector has given up for this session. */
export function faceDetectionAvailable(): boolean {
  return budget.available;
}

/** Test and hot-reload seam: forget the model, the cache and the failures. */
export function resetFaceDetection(): void {
  budget.reset();
  cache.clear();
  inFlight.clear();
  detectorPromise = null;
}

/** The faces already known for a photograph, without triggering a load. */
export function cachedFaces(key: string): FaceBox[] | null {
  return cache.get(key) ?? null;
}

function sourceDimensions(source: FaceDetectionSource): { width: number; height: number } | null {
  const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : null;
}

async function loadDetector(): Promise<MediaPipeFaceDetector | null> {
  if (detectorPromise) return detectorPromise;
  detectorPromise = (async () => {
    const { FilesetResolver, FaceDetector } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(FACE_DETECTION_WASM_PATH);
    const detector = await FaceDetector.createFromOptions(fileset, {
      // CPU, deliberately: the short-range model is 224KB and runs in single
      // digit milliseconds on one image, and the CPU delegate has no WebGL
      // requirement to fail on the machines least likely to have one.
      baseOptions: { modelAssetPath: FACE_DETECTION_MODEL_PATH, delegate: "CPU" },
      runningMode: "IMAGE",
      minDetectionConfidence: MINIMUM_DETECTION_CONFIDENCE,
    });
    return detector as unknown as MediaPipeFaceDetector;
  })().catch(() => {
    // A failed load is not retried on the promise that failed: the next call
    // rebuilds it, and the budget decides whether there is a next call at all.
    detectorPromise = null;
    budget.fail();
    return null;
  });
  return detectorPromise;
}

/**
 * Every face in a photograph, normalised to that photograph, or an empty array.
 *
 * `key` is the caller's own stable id for the image — a photo id — and is what
 * the in-memory cache is keyed on, so the same photograph assigned to four
 * slots is decoded once. Concurrent calls for one key share a single run.
 */
export async function detectFaces(source: FaceDetectionSource, key?: string): Promise<FaceBox[]> {
  if (key) {
    const cached = cache.get(key);
    if (cached) return cached;
    const pending = inFlight.get(key);
    if (pending) return pending;
  }
  if (!budget.available) return [];

  const run = (async (): Promise<FaceBox[]> => {
    try {
      const dimensions = sourceDimensions(source);
      if (!dimensions) return [];
      const detector = await loadDetector();
      if (!detector) return [];
      const result = detector.detect(source as CanvasImageSource);
      const faces: FaceBox[] = [];
      for (const detection of result?.detections ?? []) {
        const box = detection.boundingBox;
        if (!box) continue;
        const normalized = normalizedFaceBox({
          x: box.originX / dimensions.width,
          y: box.originY / dimensions.height,
          width: box.width / dimensions.width,
          height: box.height / dimensions.height,
          confidence: detection.categories?.[0]?.score,
        });
        if (normalized) faces.push(normalized);
      }
      budget.succeed();
      if (key) cache.set(key, faces);
      return faces;
    } catch {
      budget.fail();
      return [];
    } finally {
      if (key) inFlight.delete(key);
    }
  })();

  if (key) inFlight.set(key, run);
  return run;
}
