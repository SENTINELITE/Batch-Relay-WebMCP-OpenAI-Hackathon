import assert from "node:assert/strict";
import test from "node:test";

import {
  ASPECT_MISMATCH_RATIO,
  DEFAULT_IMPORTANT_CONTENT_MARGIN,
  DEFAULT_MINIMUM_EFFECTIVE_PPI,
  EXTREME_ZOOM_THRESHOLD,
  effectivePpi,
  printReviewSummary,
  reviewCounts,
  reviewPrint,
  reviewSlot,
} from "../src/lib/storefront/print-review.ts";
import {
  specImportantContentMargin,
  specMinimumEffectivePpi,
} from "../src/lib/storefront/preview-spec.ts";

/** A 5x7 print of a comfortably large photograph, framed dead centre. */
const readySlot = {
  slotKey: "image_main",
  label: "photo",
  printedSizeIn: { width: 5, height: 7 },
  photoPixels: { width: 3000, height: 4200 },
  crop: { zoom: 1, focusX: 50, focusY: 50 },
};

const codes = (slot) => reviewSlot(slot).map((finding) => finding.code);

test("a centred, well-resolved print at the published aspect is ready with no findings", () => {
  const review = reviewPrint([readySlot]);
  assert.equal(review.verdict, "ready");
  assert.deepEqual(review.findings, []);
  assert.equal(printReviewSummary(review), "Ready");
});

test("effective PPI is the cover-fit scale spent over the zoom, so zooming in lowers it", () => {
  // 3000px over 5in and 4200px over 7in both give 600 PPI at zoom 1.
  assert.equal(effectivePpi(readySlot), 600);
  assert.equal(effectivePpi({ ...readySlot, crop: { ...readySlot.crop, zoom: 2 } }), 300);
  // Nothing is asserted about a photograph whose pixels were never decoded.
  assert.equal(effectivePpi({ ...readySlot, photoPixels: null }), null);
});

test("low_resolution fires only once the effective PPI falls under the floor", () => {
  // 1200x1680 over 5x7in is exactly 240 PPI, under the 300 default.
  const soft = { ...readySlot, photoPixels: { width: 1200, height: 1680 } };
  assert.deepEqual(codes(soft), ["low_resolution"]);
  assert.match(reviewSlot(soft)[0].message, /240 PPI/);
  assert.match(reviewSlot(soft)[0].message, new RegExp(`${DEFAULT_MINIMUM_EFFECTIVE_PPI} PPI`));

  // Exactly at the floor is not a finding: the floor is a minimum, not a gap.
  const exact = { ...readySlot, photoPixels: { width: 1500, height: 2100 } };
  assert.equal(effectivePpi(exact), DEFAULT_MINIMUM_EFFECTIVE_PPI);
  assert.deepEqual(codes(exact), []);

  // A template that publishes a stricter floor is obeyed over the default.
  assert.deepEqual(codes({ ...exact, minimumEffectivePpi: 400 }), ["low_resolution"]);
});

test("low_resolution is not invented when the geometry is unknown", () => {
  assert.deepEqual(codes({ ...readySlot, photoPixels: null }), []);
  assert.deepEqual(codes({ ...readySlot, printedSizeIn: null }), []);
});

test("extreme_zoom fires past the threshold and never at or below it", () => {
  const at = { ...readySlot, crop: { zoom: EXTREME_ZOOM_THRESHOLD, focusX: 50, focusY: 50 } };
  assert.equal(codes(at).includes("extreme_zoom"), false);
  const past = { ...readySlot, crop: { zoom: 3, focusX: 50, focusY: 50 } };
  assert.equal(codes(past).includes("extreme_zoom"), true);
  assert.match(reviewSlot(past).find((finding) => finding.code === "extreme_zoom").message, /3\.0×/);
});

test("subject_near_trim reads the focus point against a zoom-scaled trim margin", () => {
  // Centred at any zoom is never near the trim.
  assert.deepEqual(codes({ ...readySlot, crop: { zoom: 3, focusX: 50, focusY: 50 } }).filter((code) => code === "subject_near_trim"), []);
  // At zoom 1 there is nothing to pan, so a hard focus is not a trim risk.
  assert.deepEqual(codes({ ...readySlot, crop: { zoom: 1, focusX: 1, focusY: 50 } }), []);

  // Zoom 3 scales the 6% default margin to 18%, so a focus at 10% is inside it.
  const pushed = { ...readySlot, crop: { zoom: 3, focusX: 10, focusY: 50 } };
  const finding = reviewSlot(pushed).find((candidate) => candidate.code === "subject_near_trim");
  assert.ok(finding, "expected a subject_near_trim finding");
  assert.match(finding.message, /Subject may sit close to the trim edge/);
  assert.match(finding.message, /left/);
  // The same pan on the other axis names the other edge.
  const low = { ...readySlot, crop: { zoom: 3, focusX: 50, focusY: 95 } };
  assert.match(reviewSlot(low).find((candidate) => candidate.code === "subject_near_trim").message, /bottom/);

  // A template publishing a tighter important-content inset is honoured.
  const tight = { ...readySlot, importantContentMargin: { x: 0.01, y: 0.01 }, crop: { zoom: 2, focusX: 10, focusY: 50 } };
  assert.equal(codes(tight).includes("subject_near_trim"), false);
  assert.ok(DEFAULT_IMPORTANT_CONTENT_MARGIN > 0.01);
});

test("aspect_mismatch fires only past a doubling of the ratio", () => {
  // A 5:7 slot fed a 5:7 photograph is a match whatever the pixel count.
  assert.deepEqual(codes({ ...readySlot, requiredAspectRatio: { width: 5, height: 7 } }), []);
  // A panorama into a portrait slot is more than 2x apart.
  const panorama = {
    ...readySlot,
    requiredAspectRatio: { width: 5, height: 7 },
    photoPixels: { width: 6000, height: 1500 },
  };
  assert.equal(codes(panorama).includes("aspect_mismatch"), true);
  assert.match(reviewSlot(panorama).find((finding) => finding.code === "aspect_mismatch").message, /5:7/);

  // Just inside the tolerance is deliberately not flagged.
  const slight = {
    ...readySlot,
    requiredAspectRatio: { width: 1, height: 1 },
    photoPixels: { width: 1900, height: 1000 },
  };
  assert.ok(1.9 < ASPECT_MISMATCH_RATIO);
  assert.equal(codes(slight).includes("aspect_mismatch"), false);
});

test("a draft's verdict is needs_review when any slot found anything, and findings carry their slot", () => {
  // Punching a 5x7 in to 3.5x both softens it and crops it hard, so the one
  // flagged slot reports both reasons and the ready slot reports none.
  const review = reviewPrint([
    readySlot,
    { ...readySlot, slotKey: "image_team", label: "team", crop: { zoom: 3.5, focusX: 50, focusY: 50 } },
  ]);
  assert.equal(review.verdict, "needs_review");
  assert.deepEqual(review.findings.map((finding) => finding.code), ["low_resolution", "extreme_zoom"]);
  assert.ok(review.findings.every((finding) => finding.slot_key === "image_team"));
  assert.match(review.findings[0].message, /team/);
  assert.equal(printReviewSummary(review), review.findings[0].message);
});

test("a draft whose geometry has not resolved yet is ready rather than doubted", () => {
  const review = reviewPrint([]);
  assert.equal(review.verdict, "ready");
  assert.deepEqual(review.findings, []);
});

test("the deck summary counts what accept_ready will and will not answer", () => {
  const counts = reviewCounts([
    reviewPrint([readySlot]),
    reviewPrint([readySlot]),
    reviewPrint([{ ...readySlot, crop: { zoom: 4, focusX: 50, focusY: 50 } }]),
  ]);
  assert.deepEqual(counts, { proposed: 3, ready: 2, needs_review: 1 });
});

test("the published template spec supplies the floors the heuristics prefer over their defaults", async () => {
  // Read straight off the bundled published document, because that file is the
  // fact being asserted: the heuristics are only as grounded as it is.
  const { readFile } = await import("node:fs/promises");
  const { renderTemplateSpecFromRequest } = await import("../src/lib/storefront/preview-spec.ts");
  const raw = await readFile(
    new URL("../src/lib/storefront/template-specs/specs/tpl_9ede6ad441b647cdae32e781e16d39f5.render-request.json", import.meta.url),
    "utf8",
  );
  const spec = renderTemplateSpecFromRequest(JSON.parse(raw));
  assert.ok(spec, "expected the bundled memory mate spec to parse");
  // The spec declares 300 PPI per image slot and a 0.25in important-content
  // inset on an 8x10 surface, so both heuristics are grounded in it rather
  // than in a house number.
  assert.equal(specMinimumEffectivePpi(spec), 300);
  const margin = specImportantContentMargin(spec);
  assert.ok(margin, "expected a published important-content margin");
  assert.equal(Number(margin.x.toFixed(4)), Number((0.25 / 8).toFixed(4)));
  assert.equal(Number(margin.y.toFixed(4)), Number((0.25 / 10).toFixed(4)));
});
