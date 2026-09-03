import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  faceFacts,
  readFocusPreset,
  resolveFocusPreset,
} from "../src/lib/storefront/focus-preset.ts";
import {
  defaultCropForSubject,
  focusForSubject,
  projectBoxIntoFrame,
  sourceWindowForCrop,
  subjectRegionFromFaces,
} from "../src/lib/storefront/face-geometry.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

/**
 * A standing portrait: a 3:4 photograph with one confident face high in the
 * frame. This is the shape that produced the reported bug — zoom 3 with no
 * focus magnified the middle of the picture, which is the subject's torso.
 */
const PORTRAIT_FACE = { x: 0.38, y: 0.08, width: 0.24, height: 0.18, confidence: 0.94 };
const SOURCE_ASPECT = 3 / 4;
const TARGET_ASPECT = 4 / 5;

const base = {
  preset: "faces",
  patch: {},
  faces: [PORTRAIT_FACE],
  detectionAvailable: true,
  targetAspectRatio: TARGET_ASPECT,
  sourceAspectRatio: SOURCE_ASPECT,
  hasPhoto: true,
};

test("focusOn faces turns a detected face into a crop that is actually centred on it", () => {
  const result = resolveFocusPreset(base);
  assert.equal(result.focusApplied, "faces");
  assert.equal(result.facesDetected, 1);

  // The face sits high in the frame, so the crop must pan UP — a focusY well
  // above the middle. The old behaviour left it at 50 and cut the head off.
  assert.ok(result.patch.focusY < 40, `expected the crop to pan up, got focusY ${result.patch.focusY}`);
  assert.ok(result.patch.zoom > 1, "a face this small in the frame should draw a zoom in");

  // The subject region is published alongside, so an agent can check the claim
  // or compute its own focus instead.
  assert.deepEqual(result.subjectRegion, subjectRegionFromFaces([PORTRAIT_FACE]));
  assert.match(result.note, /centred on them/);
});

test("an explicit zoom is honoured and the focus is recomputed for THAT zoom", () => {
  // "zoom in on the individual picture's face by quite a lot" — the shopper
  // named the magnification, so only the pan is the app's to choose.
  const result = resolveFocusPreset({ ...base, patch: { zoom: 3 } });
  assert.equal(result.focusApplied, "faces");
  assert.equal(result.patch.zoom, 3, "the caller's zoom must survive untouched");
  assert.deepEqual(result.explicitOverrides, ["zoom"]);

  const expected = focusForSubject(subjectRegionFromFaces([PORTRAIT_FACE]), TARGET_ASPECT, SOURCE_ASPECT, 3);
  assert.equal(result.patch.focusX, expected.focusX);
  assert.equal(result.patch.focusY, expected.focusY);

  // And it is a different answer from the zoom the preset would have picked on
  // its own, which is the whole reason the focus is recomputed.
  const auto = defaultCropForSubject(subjectRegionFromFaces([PORTRAIT_FACE]), TARGET_ASPECT, SOURCE_ASPECT);
  assert.notEqual(auto.zoom, 3);
});

test("a requested subject width computes the zoom and reports the achieved frame width", () => {
  const result = resolveFocusPreset({ ...base, subjectWidthPercent: 50 });
  assert.equal(result.focusApplied, "faces");
  assert.equal(result.requestedSubjectWidthPercent, 50);
  assert.equal(result.achievedSubjectWidthPercent, 50);
  assert.equal(result.subjectWidthClamped, false);

  const window = sourceWindowForCrop({
    sourceAspectRatio: SOURCE_ASPECT,
    targetAspectRatio: TARGET_ASPECT,
    zoom: result.patch.zoom,
    focusX: result.patch.focusX,
    focusY: result.patch.focusY,
  });
  const projected = projectBoxIntoFrame(PORTRAIT_FACE, window);
  assert.ok(Math.abs(projected.width - 0.5) < 0.001);
  assert.throws(
    () => resolveFocusPreset({ ...base, patch: { zoom: 2 }, subjectWidthPercent: 50 }),
    /either zoom or subjectWidthPercent/,
  );
});

test("an explicit focus value wins over the computed one, on that axis only", () => {
  const result = resolveFocusPreset({ ...base, patch: { focusX: 12 } });
  assert.equal(result.focusApplied, "faces");
  assert.equal(result.patch.focusX, 12);
  assert.equal(result.patch.focusY, resolveFocusPreset(base).patch.focusY);
  assert.deepEqual(result.explicitOverrides, ["focusX"]);
  // The note has to admit the override, or an agent reading only focus_applied
  // would narrate a framing it did not get.
  assert.match(result.note, /explicit focusX overrode/);
});

test("no faces found is reported as such and never silently centres on nothing", () => {
  const result = resolveFocusPreset({ ...base, faces: [], patch: { zoom: 2.5 } });
  assert.equal(result.focusApplied, "no_faces_detected");
  assert.equal(result.facesDetected, 0);
  // The caller's own values stand, untouched: no invented focus point.
  assert.deepEqual(result.patch, { zoom: 2.5 });
  assert.match(result.note, /Do not tell the shopper it is centred on a face/);
});

test("a face below the confidence floor is not a face worth framing around", () => {
  const result = resolveFocusPreset({ ...base, faces: [{ ...PORTRAIT_FACE, confidence: 0.2 }] });
  assert.equal(result.focusApplied, "no_faces_detected");
  assert.equal(result.facesDetected, 0);
});

test("detection that has not finished is a different answer from detection that found nothing", () => {
  const notReady = resolveFocusPreset({ ...base, faces: null, patch: { zoom: 3 } });
  assert.equal(notReady.focusApplied, "faces_not_ready");
  assert.equal(notReady.facesDetected, null, "an unfinished pass must not report a count");
  assert.deepEqual(notReady.patch, { zoom: 3 });
  assert.match(notReady.note, /call again shortly/);
});

test("a browser with no detector says so rather than pretending", () => {
  const result = resolveFocusPreset({ ...base, detectionAvailable: false, faces: null });
  assert.equal(result.focusApplied, "detection_unavailable");
  assert.match(result.note, /Do not claim face-centring/);
});

test("an empty slot and unknown geometry each get their own honest refusal", () => {
  assert.equal(resolveFocusPreset({ ...base, hasPhoto: false }).focusApplied, "no_photo_assigned");
  assert.equal(
    resolveFocusPreset({ ...base, sourceAspectRatio: null }).focusApplied,
    "unknown_geometry",
  );
  assert.equal(
    resolveFocusPreset({ ...base, targetAspectRatio: 0 }).focusApplied,
    "unknown_geometry",
  );
});

test("a patch with no preset reports explicit and is passed through unchanged", () => {
  const patch = { zoom: 2, focusX: 30, focusY: 70 };
  const result = resolveFocusPreset({ ...base, preset: null, patch });
  assert.equal(result.focusApplied, "explicit");
  assert.deepEqual(result.patch, patch);
  assert.deepEqual(result.explicitOverrides, []);
});

test("focusOn center is the frame's middle and involves no detector at all", () => {
  const result = resolveFocusPreset({ ...base, preset: "center", faces: null, detectionAvailable: false });
  assert.equal(result.focusApplied, "center");
  assert.equal(result.patch.focusX, 50);
  assert.equal(result.patch.focusY, 50);
});

test("focusOn is read under either spelling, and nothing else is honoured", () => {
  assert.equal(readFocusPreset({ focusOn: "faces" }), "faces");
  assert.equal(readFocusPreset({ focus_on: "center" }), "center");
  assert.equal(readFocusPreset({ focusOn: "eyes" }), null);
  assert.equal(readFocusPreset({}), null);
  assert.equal(readFocusPreset(null), null);
});

test("the published face facts distinguish none-found from not-yet-looked", () => {
  assert.deepEqual(faceFacts(undefined), { faces_detected: null, subject_region: null });
  assert.deepEqual(faceFacts(null), { faces_detected: null, subject_region: null });
  assert.deepEqual(faceFacts([]), { faces_detected: 0, subject_region: null });

  const facts = faceFacts([PORTRAIT_FACE]);
  assert.equal(facts.faces_detected, 1);
  assert.deepEqual(facts.subject_region, subjectRegionFromFaces([PORTRAIT_FACE]));
});

test("a group is framed as a group, not around whoever stood nearest", () => {
  const faces = [
    { x: 0.1, y: 0.2, width: 0.15, height: 0.15, confidence: 0.9 },
    { x: 0.7, y: 0.25, width: 0.12, height: 0.12, confidence: 0.9 },
  ];
  const result = resolveFocusPreset({ ...base, faces });
  assert.equal(result.focusApplied, "faces");
  assert.equal(result.facesDetected, 2);
  // The union spans most of the width, so the crop cannot zoom in far.
  assert.ok(result.patch.zoom < 1.5, `a wide group should barely zoom, got ${result.patch.zoom}`);
});

test("every crop entry point resolves focusOn through the one shared helper", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  // set_crop, directCrop and revise_prints all go through resolveCropFocusPreset,
  // so there is exactly one place that decides what "faces" means.
  assert.equal((ui.match(/await resolveCropFocusPreset\(\{/g) ?? []).length, 4);
  assert.match(ui, /function resolveCropFocusPreset\(/);
  // The wait is bounded: a shopper gets an honest "not ready" rather than a
  // hung turn.
  assert.match(ui, /const FACE_WAIT_MS = 2000/);
  assert.match(ui, /Promise\.race\(\[\s*job\.catch/);
  // Readiness is tracked apart from the results, because the results map only
  // ever holds photographs that had faces.
  assert.match(ui, /photoFacesResolvedRef/);
  assert.match(ui, /photoFaceJobsRef\.current\[photo\.id\] = job/);
});

test("the responses publish the face facts and never overstate the framing", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  assert.match(ui, /function publishedFaceFacts\(photoId: string \| null\)/);
  // ask_storefront per-slot facts, configure_print slot_assignments, and the
  // direct-print photograph all carry the same two fields.
  assert.ok((ui.match(/publishedFaceFacts\(/g) ?? []).length >= 6);
  assert.match(ui, /function focusWire\(result: FocusPresetResult\)/);
  assert.match(ui, /focus_applied: result\.focusApplied/);
  assert.match(ui, /focus_note: result\.note/);
  assert.match(ui, /direct_crop_focus: directCropFocusReport \? focusWire\(directCropFocusReport\) : null/);
  assert.match(ui, /focus: slotFocusReports\[slot\.key\] \? focusWire\(slotFocusReports\[slot\.key\]!\) : null/);
});

test("a photograph is framed on its faces when it lands, and never re-cropped afterwards", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  assert.match(ui, /function seededSlotTransform\(/);
  // Additive by construction: a slot that already carries a framing keeps it,
  // which is what stops a late detection from moving a crop the shopper has
  // seen or adjusted.
  assert.match(ui, /if \(next\[slotKey\]\) continue;/);
  assert.match(ui, /function seededSlotTransforms\(/);
  // The hand-drop path, the role-prefill path and the batch path all seed.
  assert.match(ui, /setSlotTransforms\(\(transforms\) => \{\s*if \(transforms\[slotKey\]\) return transforms;/);
  assert.ok((ui.match(/seededSlotTransforms\(/g) ?? []).length >= 4);
  // Nothing re-seeds from the detection effect, so faces arriving later never
  // reach a committed transform.
  const effect = ui.slice(ui.indexOf("const faces = await detectFaces"), ui.indexOf("photoFaceJobsRef.current[photo.id] = job"));
  assert.doesNotMatch(effect, /seededSlotTransform|setSlotTransforms|patchDraft/);
});
