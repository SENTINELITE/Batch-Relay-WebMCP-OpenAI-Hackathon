import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { TEMPLATE_CAROUSEL_REACH, ringOffset, ringSlot } from "../src/lib/storefront/template-carousel.ts";

test("the ring measures the shorter way round and resolves a half turn to the right", () => {
  assert.equal(ringOffset(0, 0, 5), 0);
  assert.equal(ringOffset(1, 0, 5), 1);
  assert.equal(ringOffset(4, 0, 5), -1);
  assert.equal(ringOffset(3, 0, 5), -2);
  assert.equal(ringOffset(2, 0, 4), 2);
  assert.equal(ringOffset(1, 0, 2), 1);
  assert.equal(ringOffset(0, 0, 0), 0);
});

test("the chosen card faces forward, neighbours stand to either side, and the rest wait behind", () => {
  const front = ringSlot(0);
  const right = ringSlot(1);
  const left = ringSlot(-1);
  const back = ringSlot(2);
  const gone = ringSlot(TEMPLATE_CAROUSEL_REACH + 1);
  assert.deepEqual([front.x, front.opacity, front.scale, front.blur], [0, 1, 1, 0]);
  assert.ok(right.x > 0 && left.x < 0 && Math.abs(right.x) === Math.abs(left.x));
  assert.ok(right.rotateY < 0 && left.rotateY > 0, "side cards turn to face the centre");
  assert.ok(right.opacity < 0.5 && right.opacity > 0.25, "side cards are softened, not hidden");
  assert.ok(back.scale < right.scale && right.scale < front.scale);
  assert.ok(back.zIndex < right.zIndex && right.zIndex < front.zIndex);
  assert.ok(Math.abs(back.x) < Math.abs(right.x), "the second step curls in behind the front");
  assert.ok(back.blur > right.blur && right.blur > 0);
  assert.equal(gone.visible, false);
  assert.equal(gone.opacity, 0);
});

test("the prepare step picks templates from the ring, which paints every template's own artwork", async () => {
  const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const [prepare, carousel, ui] = await Promise.all([
    read("src/components/storefront/prepare-step.tsx"),
    read("src/components/storefront/template-carousel.tsx"),
    read("src/components/storefront/manual-storefront.tsx"),
  ]);
  assert.match(prepare, /<TemplateCarousel[\s\S]*?previewFor=\{templatePreviewFor\}/);
  assert.match(carousel, /aria-label="Template"/);
  assert.match(carousel, /aria-roledescription="carousel"/);
  assert.match(carousel, /ArrowLeft[\s\S]*ArrowRight/);
  // No arrows and no card chrome: the prints are the controls.
  assert.doesNotMatch(carousel, /Previous template|Next template/);
  assert.doesNotMatch(carousel, /bg-card|border-border/);
  assert.doesNotMatch(carousel, /shadow-warm/);
  assert.match(carousel, /\[&_section>div\]:max-w-full/);
  // The template rail stays mounted while a chosen template's artwork loads.
  assert.match(prepare, /templateLoading/);
  assert.match(ui, /templateLoading=\{templateState === "loading"\}/);
  // Only cards within reach mount a preview tree.
  assert.match(carousel, /const preview = slot\.visible \? previewFor\(template\.id\) : null/);
  // Other templates paint from warmed documents, read-only, with no drop slots.
  assert.match(ui, /function templateCarouselPreviewFor\(templateId: string\): ReactNode \| null/);
  assert.match(ui, /setCarouselOutputs\(\(current\) =>/);
  assert.match(ui, /templatePreviewFor=\{templateCarouselPreviewFor\}/);
});
