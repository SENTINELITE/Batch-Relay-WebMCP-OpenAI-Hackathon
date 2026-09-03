import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parsePhotoDragKey,
  parsePhotoDropKey,
  photoDragKey,
  photoDropKey,
} from "../src/lib/storefront/photo-drag.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("a drag key round-trips a photograph id and refuses anything else", () => {
  assert.equal(parsePhotoDragKey(photoDragKey("photo_7")), "photo_7");
  assert.equal(parsePhotoDragKey("photo:"), null);
  assert.equal(parsePhotoDragKey("slot:image_1"), null);
  assert.equal(parsePhotoDragKey("photo_7"), null);
});

test("a drop key carries its own target so a drop never consults stale state", () => {
  assert.deepEqual(parsePhotoDropKey(photoDropKey({ kind: "direct_print" })), { kind: "direct_print" });
  assert.deepEqual(parsePhotoDropKey(photoDropKey({ kind: "template_slot", slotKey: "image_122qlv9" })), {
    kind: "template_slot",
    slotKey: "image_122qlv9",
  });
  // Published slot keys are taken whole, never split a second time.
  assert.deepEqual(parsePhotoDropKey("slot:image:odd"), { kind: "template_slot", slotKey: "image:odd" });
  assert.equal(parsePhotoDropKey("slot:"), null);
  assert.equal(parsePhotoDropKey("photo:abc"), null);
  assert.equal(parsePhotoDropKey(""), null);
});

test("a dropped photograph runs the same assignment the visible controls run", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  const drop = ui.slice(ui.indexOf("function dropPhotoOnPrintTarget("), ui.indexOf("/** Live framing"));
  assert.match(drop, /handlePhotoAction\(\{ type: "select", photoId \}\)/);
  assert.match(drop, /noteShopperLookingAtSelectedDraft\(\);\s*\n\s*assignTemplatePhoto\(target\.slotKey, photoId\)/);
  // A drag must not grow an assignment path of its own beside the dropdown's.
  assert.doesNotMatch(drop, /setTemplateAssignments|rememberPhotoRole|setActiveImageSlotKey|patchDraft/);
});

test("a slot accepts a drop without taking over the pointer gestures it already owns", async () => {
  const preview = await read("src/components/storefront/browser-template-preview.tsx");
  const surface = preview.slice(preview.indexOf("function SlotDropSurface("), preview.indexOf("function transformsFor("));
  // The droppable contributes a connector and nothing else, so pointer-down
  // panning, activation clicks and pointer capture all still reach the slot.
  assert.match(surface, /ref=\{connect\}/);
  assert.doesNotMatch(surface, /onPointer|onClick|onKeyDown|onLostPointerCapture/);
  assert.match(surface, /\{\.\.\.rest\}/);
  // The pan gesture and slot activation are still bound on the slot itself.
  assert.match(preview, /<SlotDropSurface[\s\S]*?onPointerDown=\{isLocalSlot \? \(event\) => \{ event\.stopPropagation\(\); selectLocalSlot\(localSlotKey!\); startDrag\(event, localSlotKey!\); \} : undefined\}/);
  // An unassigned local slot stays visibly marked (dashed drop affordance).
  assert.match(preview, /!source && "border border-dashed/);
});

test("only the live template canvas registers each slot as a drop target", async () => {
  const [preview, assignment, storefront] = await Promise.all([
    read("src/components/storefront/browser-template-preview.tsx"),
    read("src/components/storefront/template-slot-assignment.tsx"),
    read("src/components/storefront/manual-storefront.tsx"),
  ]);
  assert.match(preview, /dropEnabled = true/);
  assert.match(preview, /!dropEnabled \|\| slotKey === null/);
  assert.doesNotMatch(assignment, /usePhotoDropTarget|photoDropTargetClassName/);
  assert.match(storefront, /<BrowserTemplatePreview[\s\S]*?dropEnabled=\{false\}/);
});

test("a tray thumbnail stays clickable, and keyboard dragging gets its own handle", async () => {
  const tray = await read("src/components/storefront/photo-tray.tsx");
  // Pointer activation only on the body: its click still selects the photograph.
  assert.match(tray, /onClick=\{onSelect\}/);
  assert.match(tray, /onPointerDown=\{bodyProps\.onPointerDown\}/);
  assert.doesNotMatch(tray, /onClick=\{onSelect\}[\s\S]{0,400}?\{\.\.\.handleProps\}/);
  // Space on the thumbnail must keep selecting, so keyboard drag lives here.
  assert.match(tray, /aria-label=\{`Drag image \$\{ordinal\}, \$\{photo\.filename\}, onto a print slot`\}/);
  assert.match(tray, /ref=\{connectHandle\}[\s\S]{0,200}?\{\.\.\.handleProps\}/);
  assert.match(tray, /group-hover:opacity-100/);
  assert.match(tray, /group-focus-within:opacity-100/);
});

test("the drag context measures live, announces in words, and lifts an overlay", async () => {
  const drag = await read("src/components/storefront/photo-drag.tsx");
  // Slots repaint and resize as photographs land, so rects cannot be cached.
  assert.match(drag, /collisionDetection=\{pointerWithin\}/);
  assert.match(drag, /measuring=\{\{\s*droppable:\s*\{\s*strategy:\s*MeasuringStrategy\.Always\s*\}\s*\}\}/);
  assert.match(drag, /<DragOverlay dropAnimation=\{null\}>/);
  // A press that never travels is a click, not a drag.
  assert.match(drag, /activationConstraint: \{ distance: DRAG_ACTIVATION_DISTANCE \}/);
  // Announcements name the photograph and the slot, never an opaque key.
  assert.match(drag, /onDragEnd: \(\{ active, over \}\) => over/);
  assert.match(drag, /was assigned to/);
});

test("every drop target is gated on being the frame the shopper can actually see", async () => {
  const prepare = await read("src/components/storefront/prepare-step.tsx");
  assert.match(prepare, /usePhotoDropTarget\(\{ kind: "direct_print" \}, templatePreviewIsPrimary\)/);
});
