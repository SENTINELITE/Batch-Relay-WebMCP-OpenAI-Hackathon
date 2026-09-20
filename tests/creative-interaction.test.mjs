import assert from "node:assert/strict";
import test from "node:test";

import { createProject, updateProject } from "../src/lib/creative/project.ts";
import {
  clampLayerPosition,
  hitTestCreativeLayer,
  imageInteractionRect,
  resizeImageProportionally,
  setTextFontSize,
} from "../src/lib/creative/interaction.ts";

test("hit testing follows topmost paint order and contain image bounds", () => {
  const project = createProject({ id: "interaction-hit" });
  project.assets = {
    background: { id: "background", slot: "background", name: "bg", mimeType: "image/jpeg", source: "sample", blobKey: "bg" },
    athlete: { id: "athlete", slot: "athlete", name: "athlete", mimeType: "image/png", source: "sample", blobKey: "athlete" },
    logo: { id: "logo", slot: "logo", name: "logo", mimeType: "image/svg+xml", source: "sample", blobKey: "logo" },
  };
  const athlete = project.layouts.card.athlete;
  const athleteRect = imageInteractionRect(athlete, 1080, 1350, { width: 100, height: 400 });
  assert.equal(hitTestCreativeLayer({ x: athleteRect.x + athleteRect.width / 2, y: athleteRect.y + athleteRect.height / 2 }, project.layouts.card, "card", { athlete: { width: 100, height: 400 } }, { athlete: true, background: false, logo: false }), "athlete");
  assert.equal(hitTestCreativeLayer({ x: athlete.x * 1080 + 2, y: athlete.y * 1350 + 2 }, project.layouts.card, "card", {}, { athlete: true, background: false, logo: false }), "athlete");
  const title = project.layouts.card.text.find((layer) => layer.id === "event-name");
  assert.equal(hitTestCreativeLayer({ x: title.transform.x * 1080 + 2, y: title.transform.y * 1350 + 2 }, project.layouts.card, "card", {}, { athlete: true, background: false, logo: false }), "text:event-name");
});

test("position clamps preserve a selectable portion and image resizing preserves aspect", () => {
  const position = clampLayerPosition({ x: 0.1, y: 0.1, width: 0.4, height: 0.2 }, -5, 5);
  assert.ok(position.x > -1 && position.x < 1);
  assert.ok(position.y > -1 && position.y < 1);
  const resized = resizeImageProportionally({ x: 0.1, y: 0.1, width: 0.4, height: 0.2 }, 0.8);
  assert.equal(resized.width / resized.height, 2);
  const tall = resizeImageProportionally({ x: 0.1, y: 0.1, width: 0.1, height: 1.2 }, 1.2);
  assert.ok(Math.abs(tall.width / tall.height - (0.1 / 1.2)) < Number.EPSILON * 4);
  const wide = resizeImageProportionally({ x: 0.1, y: 0.1, width: 1.2, height: 0.1 }, 0.2);
  assert.ok(Math.abs(wide.width / wide.height - (1.2 / 0.1)) < Number.EPSILON * 4);
});

test("text size grows its box and format layouts stay independent", () => {
  const project = createProject({ id: "interaction-format" });
  const text = project.layouts.card.text.find((layer) => layer.id === "event-name");
  const nextText = setTextFontSize(text, 150, 1080, 1350);
  assert.equal(Math.round(nextText.fontSizeRatio * 1080), 150);
  assert.ok(nextText.transform.height > text.transform.height);
  const moved = updateProject(project, { layouts: { ...project.layouts, card: { ...project.layouts.card, text: project.layouts.card.text.map((layer) => layer.id === "event-name" ? nextText : layer) } } });
  assert.notEqual(moved.layouts.card.text[0].fontSizeRatio, project.layouts.card.text[0].fontSizeRatio);
  assert.equal(moved.layouts.banner.text[0].fontSizeRatio, project.layouts.banner.text[0].fontSizeRatio);
});
