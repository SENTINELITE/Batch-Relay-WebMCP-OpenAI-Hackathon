import assert from "node:assert/strict";
import test from "node:test";

import { browserPreviewCanvas } from "../src/lib/storefront/browser-preview.ts";
import {
  deriveImageSlotAliases,
  imageSlotBoxesFromCanvases,
  resolveSlotPatchTarget,
  slotBoxFromLabel,
} from "../src/lib/storefront/slot-aliases.ts";

const memoryMateSlots = [
  { key: "image_122qlv9", suggested_label: "Athlete portrait (5x7)" },
  { key: "image_12rkfks", suggested_label: "athlete.portrait" },
];

test("names the landscape box team and the portrait box individual", () => {
  const aliases = deriveImageSlotAliases(
    [{ key: "image_team" }, { key: "image_solo" }],
    { image_team: { width: 7, height: 5 }, image_solo: { width: 5, height: 7 } },
  );
  assert.deepEqual(aliases, {
    image_team: ["team", "group"],
    image_solo: ["individual", "athlete", "portrait"],
  });
});

test("breaks a two-portrait Memory Mate tie by box area", () => {
  const aliases = deriveImageSlotAliases(memoryMateSlots, {
    image_122qlv9: { width: 3.5, height: 4.5 },
    image_12rkfks: { width: 5, height: 7 },
  });
  assert.deepEqual(aliases, {
    image_12rkfks: ["team", "group"],
    image_122qlv9: ["individual", "athlete"],
  });
});

test("assigns no aliases when two slots cannot be told apart", () => {
  assert.deepEqual(deriveImageSlotAliases(
    [{ key: "image_a" }, { key: "image_b" }],
    { image_a: { width: 5, height: 7 }, image_b: { width: 5, height: 7 } },
  ), {});
});

test("assigns no aliases when no slot has any geometry signal", () => {
  assert.deepEqual(deriveImageSlotAliases([{ key: "image_a" }, { key: "image_b" }]), {});
});

test("emits an alias only when exactly one slot earns it", () => {
  const aliases = deriveImageSlotAliases(
    [{ key: "image_a" }, { key: "image_b" }, { key: "image_c" }],
    {
      image_a: { width: 9, height: 5 },
      image_b: { width: 5, height: 7 },
      image_c: { width: 5, height: 7 },
    },
  );
  // One landscape slot is unambiguously the team image; the two identical
  // portraits would both claim "individual", so neither may speak for it.
  assert.deepEqual(aliases, { image_a: ["team", "group"] });
  const spoken = Object.values(aliases).flat();
  assert.equal(spoken.length, new Set(spoken).size);
});

test("gives a single image slot the minimal photo vocabulary", () => {
  assert.deepEqual(deriveImageSlotAliases([{ key: "image_only" }]), { image_only: ["photo", "main"] });
  assert.deepEqual(deriveImageSlotAliases([]), {});
});

test("reads slot dimensions embedded in a published label", () => {
  assert.deepEqual(slotBoxFromLabel("Athlete portrait (5x7)"), { width: 5, height: 7 });
  assert.deepEqual(slotBoxFromLabel("Team banner 10x8"), { width: 10, height: 8 });
  assert.deepEqual(slotBoxFromLabel("Team 7 by 5"), { width: 7, height: 5 });
  assert.equal(slotBoxFromLabel("athlete.portrait"), null);
  assert.equal(slotBoxFromLabel(undefined), null);
});

test("falls back to label dimensions when the preview has no geometry", () => {
  assert.deepEqual(deriveImageSlotAliases([
    { key: "image_122qlv9", suggested_label: "Athlete portrait (5x7)" },
    { key: "image_team", suggested_label: "Team photo (10x8)" },
  ]), {
    image_team: ["team", "group"],
    image_122qlv9: ["individual", "athlete", "portrait"],
  });
});

test("prefers preview geometry over a label that disagrees", () => {
  const aliases = deriveImageSlotAliases(memoryMateSlots, {
    image_122qlv9: { width: 8, height: 4 },
    image_12rkfks: { width: 3, height: 4 },
  });
  assert.deepEqual(aliases[memoryMateSlots[0].key], ["team", "group"]);
});

test("reads image slot boxes only from exact published node mappings", () => {
  const document = {
    template: {
      id: "memory-mate",
      revision_id: "rev_1",
      browser_document: {
        surfaces: [{
          id: "surface_front",
          widthIn: 8,
          heightIn: 10,
          variants: [{
            id: "variant_portrait",
            nodes: [
              { id: "node_team", kind: "image", role: "photo", insetIn: { x: 0, y: 0 }, sizeIn: { width: 7, height: 5 }, imageSource: { kind: "binding" } },
              { id: "node_solo", kind: "image", role: "photo", insetIn: { x: 0, y: 5 }, sizeIn: { width: 3, height: 4 }, imageSource: { kind: "binding" } },
              { id: "node_logo", kind: "image", role: "art", insetIn: { x: 0, y: 9 }, sizeIn: { width: 1, height: 1 }, imageSource: { kind: "templateAsset", assetRef: "logo" } },
            ],
          }],
        }],
      },
    },
    output: { id: "output_portrait", surfaces: [{ id: "surface_front", variant_id: "variant_portrait", width_in: 8, height_in: 10, fulfillment_role: "artwork", ordinal: 1 }] },
    input_slots: [
      { surface_id: "surface_front", variant_id: "variant_portrait", node_id: "node_team", slot_key: "image_team" },
      { surface_id: "surface_front", variant_id: "variant_portrait", node_id: "node_solo", slot_key: "image_solo" },
    ],
    assets: [],
  };
  const canvases = document.output.surfaces.flatMap((surface) => {
    const canvas = browserPreviewCanvas(
      JSON.stringify(document.template.browser_document),
      surface.id,
      surface.variant_id,
      document.input_slots,
    );
    return canvas ? [canvas] : [];
  });
  const boxes = imageSlotBoxesFromCanvases(canvases);
  assert.deepEqual(boxes, {
    image_team: { width: 7, height: 5 },
    image_solo: { width: 3, height: 4 },
  });
  assert.deepEqual(deriveImageSlotAliases([{ key: "image_team" }, { key: "image_solo" }], boxes), {
    image_team: ["team", "group"],
    image_solo: ["individual", "athlete", "portrait"],
  });
  assert.deepEqual(imageSlotBoxesFromCanvases([]), {});
});

const resolutionSlots = [
  { key: "image_122qlv9", suggested_label: "Athlete portrait (5x7)" },
  { key: "team", suggested_label: "athlete.portrait" },
];
const resolutionAliases = { image_122qlv9: ["individual", "athlete"], team: ["team", "group"] };

test("an exact slot key outranks every published label and alias", () => {
  const resolved = resolveSlotPatchTarget(resolutionSlots, { slotKey: "image_122qlv9", label: "team" }, resolutionAliases);
  assert.equal(resolved.kind, "resolved");
  assert.equal(resolved.slot.key, "image_122qlv9");
  assert.equal(resolved.matchedBy, "key");
});

test("a label that is an exact slot key outranks a derived alias of another slot", () => {
  const resolved = resolveSlotPatchTarget(resolutionSlots, { label: "team" }, resolutionAliases);
  assert.equal(resolved.kind, "resolved");
  assert.equal(resolved.slot.key, "team");
  assert.equal(resolved.matchedBy, "key");
});

test("an exact published label outranks a derived alias", () => {
  const slots = [
    { key: "image_a", suggested_label: "team" },
    { key: "image_b", suggested_label: "Team photo (10x8)" },
  ];
  const resolved = resolveSlotPatchTarget(slots, { label: "team" }, { image_b: ["team", "group"] });
  assert.equal(resolved.kind, "resolved");
  assert.equal(resolved.slot.key, "image_a");
  assert.equal(resolved.matchedBy, "label");
});

test("resolves a case-insensitive alias when exactly one slot owns it", () => {
  const slots = [{ key: "image_122qlv9" }, { key: "image_12rkfks" }];
  const aliases = { image_12rkfks: ["team", "group"], image_122qlv9: ["individual", "athlete"] };
  const resolved = resolveSlotPatchTarget(slots, { label: " Team " }, aliases);
  assert.equal(resolved.kind, "resolved");
  assert.equal(resolved.slot.key, "image_12rkfks");
  assert.equal(resolved.matchedBy, "alias");
});

test("refuses an alias claimed by more than one slot", () => {
  const slots = [{ key: "image_a" }, { key: "image_b" }];
  const ambiguous = resolveSlotPatchTarget(slots, { label: "team" }, { image_a: ["team"], image_b: ["team"] });
  assert.deepEqual(ambiguous, { kind: "unresolved", reason: "ambiguous_alias" });
});

test("refuses a reference that names nothing visible", () => {
  assert.deepEqual(
    resolveSlotPatchTarget(resolutionSlots, { label: "coach" }, resolutionAliases),
    { kind: "unresolved", reason: "no_match" },
  );
  assert.deepEqual(
    resolveSlotPatchTarget(resolutionSlots, { slotKey: "image_missing" }, resolutionAliases),
    { kind: "unresolved", reason: "no_match" },
  );
  assert.deepEqual(resolveSlotPatchTarget(resolutionSlots, {}), { kind: "unresolved", reason: "no_match" });
});
