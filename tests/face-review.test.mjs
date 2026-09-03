import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  cachedFaces,
  createDetectionBudget,
  detectFaces,
  faceDetectionAvailable,
  resetFaceDetection,
  FACE_DETECTION_FAILURE_LIMIT,
  FACE_DETECTION_MODEL_PATH,
  FACE_DETECTION_WASM_PATH,
} from "../src/lib/storefront/face-detection.ts";
import {
  confidentFaces,
  defaultCropForSubject,
  edgeClearances,
  normalizedFaceBox,
  projectBoxIntoFrame,
  sourceWindowForCrop,
  subjectRegionFromFaces,
  FACE_CONFIDENCE_FLOOR,
} from "../src/lib/storefront/face-geometry.ts";
import { reviewPrint, reviewSlot } from "../src/lib/storefront/print-review.ts";

/**
 * A 5x7 print of a 3000x4200 photograph: the source and the slot are the same
 * shape, so at zoom 1 the printed frame is the whole photograph and a face's
 * normalised coordinates are also its frame coordinates. Every fixture below
 * leans on that so the expected numbers can be read off by hand.
 */
const baseSlot = {
  slotKey: "image_main",
  label: "photo",
  printedSizeIn: { width: 5, height: 7 },
  photoPixels: { width: 3000, height: 4200 },
  crop: { zoom: 1, focusX: 50, focusY: 50 },
};

const face = (x, y, width, height, confidence = 0.95) => ({ x, y, width, height, confidence });
const codes = (slot) => reviewSlot(slot).map((finding) => finding.code);

/**
 * Boxes are derived by subtracting edges, so exact equality would be asserting
 * float noise rather than geometry. Compare to a tolerance far tighter than any
 * margin the review uses and far looser than a rounding error.
 */
function assertBox(actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    assert.ok(
      Math.abs(actual[key] - value) < 1e-9,
      `${key}: expected ${value}, got ${actual[key]}`,
    );
  }
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
}

test("a face sitting comfortably inside the frame is not a finding", () => {
  const slot = { ...baseSlot, faces: [face(0.4, 0.35, 0.2, 0.2)] };
  assert.deepEqual(codes(slot), []);
  assert.equal(reviewPrint([slot]).verdict, "ready");
});

test("a face within the important-content margin of an edge is reported by name", () => {
  const slot = { ...baseSlot, faces: [face(0.01, 0.4, 0.15, 0.15)] };
  assert.deepEqual(codes(slot), ["face_near_trim"]);
  assert.match(reviewSlot(slot)[0].message, /left trim edge/);
  assert.match(reviewSlot(slot)[0].message, /photo/);
  assert.equal(reviewSlot(slot)[0].slot_key, "image_main");

  // The published inset is obeyed over the default when the spec declares one.
  const generous = { ...slot, faces: [face(0.08, 0.4, 0.15, 0.15)] };
  assert.deepEqual(codes(generous), []);
  assert.deepEqual(codes({ ...generous, importantContentMargin: { x: 0.12, y: 0.12 } }), ["face_near_trim"]);
});

test("a face the crop has pushed out of the printed frame is reported as cropped", () => {
  // Zoom 2 focused hard right prints only the right-hand half of the source.
  const slot = {
    ...baseSlot,
    crop: { zoom: 2, focusX: 100, focusY: 50 },
    faces: [face(0.05, 0.4, 0.15, 0.15)],
  };
  assert.deepEqual(codes(slot), ["face_near_trim"]);
  assert.match(reviewSlot(slot)[0].message, /falls outside the printed frame/);
});

test("a clear face signal withdraws the geometry-only subject_near_trim guess", () => {
  const pushed = { ...baseSlot, crop: { zoom: 2, focusX: 100, focusY: 50 } };
  // Without faces the geometry heuristic still speaks, exactly as before.
  assert.deepEqual(codes(pushed), ["subject_near_trim"]);

  // With a face that the same crop keeps safely inside, the guess is dropped
  // and nothing replaces it: the photograph answered the question.
  const withFace = { ...pushed, faces: [face(0.65, 0.4, 0.2, 0.2)] };
  assert.deepEqual(codes(withFace), []);
  assert.equal(reviewPrint([withFace]).verdict, "ready");

  // A low-confidence detection is not a signal, so the guess stands.
  const unsure = { ...pushed, faces: [face(0.65, 0.4, 0.2, 0.2, FACE_CONFIDENCE_FLOOR - 0.01)] };
  assert.deepEqual(codes(unsure), ["subject_near_trim"]);
});

test("findings unrelated to the subject survive the face signal untouched", () => {
  const soft = {
    ...baseSlot,
    photoPixels: { width: 1200, height: 1680 },
    crop: { zoom: 3, focusX: 100, focusY: 50 },
    faces: [face(0.7, 0.4, 0.15, 0.15)],
  };
  assert.deepEqual(codes(soft), ["low_resolution", "extreme_zoom"]);
});

test("absent, empty and unusable face data all review identically to no face data", () => {
  const shapes = [
    baseSlot,
    { ...baseSlot, crop: { zoom: 2, focusX: 100, focusY: 50 } },
    { ...baseSlot, crop: { zoom: 3, focusX: 2, focusY: 98 } },
    { ...baseSlot, photoPixels: { width: 1200, height: 1680 } },
    { ...baseSlot, photoPixels: null },
    { ...baseSlot, printedSizeIn: null, requiredAspectRatio: { width: 5, height: 7 } },
  ];
  for (const shape of shapes) {
    const expected = reviewSlot(shape);
    for (const faces of [undefined, null, [], [face(0.4, 0.35, 0.2, 0.2, 0.2)]]) {
      assert.deepEqual(reviewSlot({ ...shape, faces }), expected);
    }
  }
});

test("a slot whose printed shape or pixels are unknown reports no face finding", () => {
  const edgeFace = [face(0.01, 0.4, 0.15, 0.15)];
  assert.deepEqual(codes({ ...baseSlot, faces: edgeFace, photoPixels: null }), []);
  assert.deepEqual(codes({ ...baseSlot, faces: edgeFace, printedSizeIn: null }), []);
  // A published required aspect stands in for an unresolved printed size.
  assert.deepEqual(
    codes({ ...baseSlot, faces: edgeFace, printedSizeIn: null, requiredAspectRatio: { width: 5, height: 7 } }),
    ["face_near_trim"],
  );
});

test("several faces are counted, and a group wholly outside the frame says so", () => {
  const two = { ...baseSlot, faces: [face(0.01, 0.4, 0.12, 0.12), face(0.5, 0.4, 0.12, 0.12)] };
  assert.deepEqual(codes(two), ["face_near_trim"]);
  assert.match(reviewSlot(two)[0].message, /A face sits close to the left trim edge/);

  const bothGone = {
    ...baseSlot,
    crop: { zoom: 2, focusX: 100, focusY: 50 },
    faces: [face(0.02, 0.3, 0.12, 0.12), face(0.2, 0.6, 0.12, 0.12)],
  };
  assert.match(reviewSlot(bothGone)[0].message, /All 2 faces fall outside/);
});

test("normalizedFaceBox keeps only boxes that describe real image area", () => {
  assertBox(normalizedFaceBox({ x: 0.1, y: 0.2, width: 0.3, height: 0.4, confidence: 0.8 }), {
    x: 0.1,
    y: 0.2,
    width: 0.3,
    height: 0.4,
    confidence: 0.8,
  });
  // A box hanging off the edge is trimmed to the image rather than discarded.
  assertBox(normalizedFaceBox({ x: -0.1, y: 0.5, width: 0.3, height: 0.8 }), {
    x: 0,
    y: 0.5,
    width: 0.2,
    height: 0.5,
    confidence: 1,
  });
  for (const nonsense of [
    { x: 0.1, y: 0.1, width: 0, height: 0.2 },
    { x: 0.1, y: 0.1, width: Number.NaN, height: 0.2 },
    { x: 1.5, y: 0.1, width: 0.2, height: 0.2 },
    { x: 0.1 },
  ]) {
    assert.equal(normalizedFaceBox(nonsense), null);
  }
});

test("subjectRegionFromFaces unions the confident faces and ignores the rest", () => {
  const faces = [face(0.1, 0.2, 0.2, 0.2), face(0.6, 0.5, 0.2, 0.2), face(0.0, 0.0, 0.9, 0.9, 0.1)];
  assertBox(subjectRegionFromFaces(faces), { x: 0.1, y: 0.2, width: 0.7, height: 0.5 });
  assert.equal(confidentFaces(faces).length, 2);
  assert.equal(subjectRegionFromFaces([]), null);
  assert.equal(subjectRegionFromFaces(null), null);
  assert.equal(subjectRegionFromFaces([face(0.1, 0.2, 0.2, 0.2, 0.3)]), null);
  // A single face is its own subject region.
  assertBox(subjectRegionFromFaces([face(0.1, 0.2, 0.2, 0.3)]), { x: 0.1, y: 0.2, width: 0.2, height: 0.3 });
});

test("sourceWindowForCrop reproduces the storefront's cover-fit, zoom, focus order", () => {
  // Same shape either side: the whole photograph prints at zoom 1.
  assert.deepEqual(sourceWindowForCrop({ sourceAspectRatio: 1, targetAspectRatio: 1, zoom: 1, focusX: 50, focusY: 50 }), {
    left: 0,
    top: 0,
    width: 1,
    height: 1,
  });
  // A landscape photograph in a square slot loses its sides, not its top.
  const cover = sourceWindowForCrop({ sourceAspectRatio: 2, targetAspectRatio: 1, zoom: 1, focusX: 0, focusY: 50 });
  assert.deepEqual(cover, { left: 0, top: 0, width: 0.5, height: 1 });
  assert.equal(
    sourceWindowForCrop({ sourceAspectRatio: 2, targetAspectRatio: 1, zoom: 1, focusX: 100, focusY: 50 }).left,
    0.5,
  );
  // Zoom halves the window; focus slides the remaining slack.
  assert.deepEqual(sourceWindowForCrop({ sourceAspectRatio: 1, targetAspectRatio: 1, zoom: 2, focusX: 50, focusY: 0 }), {
    left: 0.25,
    top: 0,
    width: 0.5,
    height: 0.5,
  });
  assert.equal(sourceWindowForCrop({ sourceAspectRatio: 0, targetAspectRatio: 1, zoom: 1, focusX: 50, focusY: 50 }), null);
});

test("projectBoxIntoFrame reports frame position and how much survives the crop", () => {
  const sourceWindow = { left: 0.5, top: 0, width: 0.5, height: 1 };
  const inside = projectBoxIntoFrame({ x: 0.6, y: 0.1, width: 0.2, height: 0.2 }, sourceWindow);
  assertBox(inside, { x: 0.2, y: 0.1, width: 0.4, height: 0.2, visibleFraction: 1 });
  assertBox(edgeClearances({ x: 0.2, y: 0.1, width: 0.4, height: 0.2 }), {
    left: 0.2,
    top: 0.1,
    right: 0.4,
    bottom: 0.7,
  });
  const halfOut = projectBoxIntoFrame({ x: 0.4, y: 0.1, width: 0.2, height: 0.2 }, sourceWindow);
  assert.ok(Math.abs(halfOut.visibleFraction - 0.5) < 1e-9);
  assert.equal(projectBoxIntoFrame({ x: 0.1, y: 0.1, width: 0.1, height: 0.1 }, sourceWindow).visibleFraction, 0);
});

test("defaultCropForSubject centres the subject and leaves it breathing room", () => {
  const subject = { x: 0.4, y: 0.4, width: 0.2, height: 0.2 };
  const crop = defaultCropForSubject(subject, 1, 1);
  assert.ok(crop.zoom > 1 && crop.zoom <= 4);
  assert.ok(Math.abs(crop.focusX - 50) < 1e-9);
  assert.ok(Math.abs(crop.focusY - 50) < 1e-9);

  // The crop it proposes must actually keep the subject clear of the trim.
  const window = sourceWindowForCrop({
    sourceAspectRatio: 1,
    targetAspectRatio: 1,
    zoom: crop.zoom,
    focusX: crop.focusX,
    focusY: crop.focusY,
  });
  const projected = projectBoxIntoFrame(subject, window);
  assert.equal(projected.visibleFraction, 1);
  const clearances = edgeClearances(projected);
  for (const edge of ["left", "right", "top", "bottom"]) {
    assert.ok(clearances[edge] > 0.1, `${edge} clearance ${clearances[edge]} is too tight`);
  }
});

test("defaultCropForSubject stays inside the crop schema's own limits", () => {
  // A subject filling the frame cannot be zoomed into at all.
  assert.deepEqual(defaultCropForSubject({ x: 0, y: 0, width: 1, height: 1 }, 1, 1), {
    zoom: 1,
    focusX: 50,
    focusY: 50,
  });
  // A tiny subject is capped at the schema ceiling rather than zoomed forever.
  assert.equal(defaultCropForSubject({ x: 0.48, y: 0.48, width: 0.02, height: 0.02 }, 1, 1).zoom, 4);
  // A subject in the corner pans as far as it can and no further.
  const corner = defaultCropForSubject({ x: 0, y: 0, width: 0.1, height: 0.1 }, 1, 1);
  assert.equal(corner.focusX, 0);
  assert.equal(corner.focusY, 0);
  assert.equal(defaultCropForSubject(null, 1, 1), null);
  assert.equal(defaultCropForSubject({ x: 0.4, y: 0.4, width: 0.2, height: 0.2 }, 0, 1), null);
});

test("the detection budget gives up after a run of failures and forgives success", () => {
  const budget = createDetectionBudget(2);
  assert.equal(budget.available, true);
  assert.equal(budget.fail(), true);
  assert.equal(budget.available, true);
  assert.equal(budget.fail(), false);
  assert.equal(budget.available, false);
  assert.equal(budget.failures, 2);
  budget.succeed();
  assert.equal(budget.available, true);

  // A nonsense limit still gives up rather than retrying forever.
  const degenerate = createDetectionBudget(0);
  assert.equal(degenerate.fail(), false);
});

test("the model and wasm paths are same-origin, so nothing is fetched from a CDN", () => {
  for (const path of [FACE_DETECTION_WASM_PATH, FACE_DETECTION_MODEL_PATH]) {
    assert.ok(path.startsWith("/"), `${path} is not a same-origin path`);
    assert.doesNotMatch(path, /^https?:|\/\//);
  }
});

test("the self-hosted loader filters only MediaPipe's benign CPU-delegate startup line", async () => {
  const sync = await readFile(new URL("../scripts/sync-mediapipe-assets.mjs", import.meta.url), "utf8");
  assert.match(sync, /Created TensorFlow Lite XNNPACK delegate for CPU\./);
  assert.match(sync, /console\.error\.apply\(console, arguments\)/);
  assert.match(sync, /arguments\.length === 1/);
});

test("detectFaces resolves to no faces where it cannot run, and then stops trying", async () => {
  resetFaceDetection();
  assert.equal(faceDetectionAvailable(), true);
  // Outside a browser there is no image source this can decode, which is the
  // same shape of failure as a missing /mediapipe folder: an empty array.
  for (let attempt = 0; attempt < FACE_DETECTION_FAILURE_LIMIT; attempt += 1) {
    assert.deepEqual(await detectFaces({ width: 10, height: 10 }, `photo_${attempt}`), []);
  }
  assert.equal(faceDetectionAvailable(), false);
  // A failure is never cached as a result, so a later session can try again.
  assert.equal(cachedFaces("photo_0"), null);
  assert.deepEqual(await detectFaces({ width: 10, height: 10 }, "photo_late"), []);
  resetFaceDetection();
  assert.equal(faceDetectionAvailable(), true);
});
