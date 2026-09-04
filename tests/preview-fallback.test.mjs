import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import { browserPreviewCanvas, browserPreviewLayerPosition } from "../src/lib/storefront/browser-preview.ts";
import { fallbackBrowserPreviewDocument } from "../src/lib/storefront/preview-fallback.ts";
import {
  contractSlotKeysForSpec,
  publicTemplateAssetURL,
  renderTemplateSpecFromRequest,
  specBrowserPreviewDocument,
} from "../src/lib/storefront/preview-spec.ts";

const specsDirectory = new URL("../src/lib/storefront/template-specs/specs/", import.meta.url);

/** Loads a bundled spec exactly as the registry does, from the real file. */
function bundledSpec(templateID) {
  const file = new URL(`${templateID}.render-request.json`, specsDirectory);
  return renderTemplateSpecFromRequest(JSON.parse(readFileSync(file, "utf8")));
}

const modernVintageSpec = bundledSpec("tpl_9ede6ad441b647cdae32e781e16d39f5");
const neonLightsSpec = bundledSpec("tpl_aeb0232b10d34460bc8d8672513db126");

function contract(slots, { revisionId = "rev_test", revisionNumber = 1 } = {}) {
  return {
    template: { id: "tpl_test", revision_id: revisionId, revision_number: revisionNumber },
    output: { id: "output-a", label: "Output A", ordinal: 0 },
    slots,
  };
}

function output(widthIn, heightIn) {
  return {
    id: "output-a",
    label: "Output A",
    ordinal: 0,
    products: [{
      canonical_product_id: "product-a",
      canonical_product_revision: 1,
      width_in: widthIn,
      height_in: heightIn,
      orientation: widthIn >= heightIn ? "landscape" : "portrait",
    }],
  };
}

/** Parses the fallback exactly the way BrowserTemplatePreview does. */
function canvasFor(document) {
  const surface = document.output.surfaces[0];
  return browserPreviewCanvas(
    JSON.stringify(document.template.browser_document),
    surface.id,
    surface.variant_id,
    document.input_slots ?? [],
  );
}

function within(layer, canvas) {
  return layer.offsetIn.x >= -0.001
    && layer.offsetIn.y >= -0.001
    && layer.offsetIn.x + layer.sizeIn.width <= canvas.widthIn + 0.001
    && layer.offsetIn.y + layer.sizeIn.height <= canvas.heightIn + 0.001;
}

test("a single image slot becomes one full-bleed-with-margin layer the real parser accepts", () => {
  const document = fallbackBrowserPreviewDocument({
    templateID: "tpl_test",
    contract: contract([{ key: "image_main", kind: "image", ordinal: 1, required: true, suggested_label: "Portrait" }]),
    output: output(5, 7),
  });
  assert.equal(document.preview_source, "fallback");
  const canvas = canvasFor(document);
  assert.ok(canvas, "the fallback document must parse through browserPreviewCanvas unchanged");
  assert.equal(canvas.widthIn, 5);
  assert.equal(canvas.heightIn, 7);
  assert.equal(canvas.backgroundColor, "#fbf2eb");
  assert.equal(canvas.layers.length, 1);
  const [image] = canvas.layers;
  assert.equal(image.kind, "image");
  assert.equal(image.inputSlotKey, "image_main");
  assert.ok(image.offsetIn.x > 0 && image.offsetIn.y > 0, "the single image keeps a print margin");
  assert.ok(within(image, canvas));
  assert.deepEqual(document.assets, []);
});

test("a memory-mate-shaped contract lays a hero out with a matted inset above two stacked text lines", () => {
  const document = fallbackBrowserPreviewDocument({
    templateID: "tpl_test",
    contract: contract([
      { key: "image_team", kind: "image", ordinal: 1, required: true, suggested_label: "Team photo", expected_aspect_ratio: { width: 10, height: 8 } },
      { key: "image_athlete", kind: "image", ordinal: 2, required: false, suggested_label: "Athlete portrait", expected_aspect_ratio: { width: 5, height: 7 } },
      { key: "text_name", kind: "text", ordinal: 3, required: true, suggested_label: "Athlete name", max_length: 40 },
      { key: "text_team", kind: "text", ordinal: 4, required: false, suggested_label: "Team and season" },
    ]),
    output: output(8, 10),
  });
  const canvas = canvasFor(document);
  assert.ok(canvas, "the fallback document must parse through browserPreviewCanvas unchanged");
  assert.deepEqual(canvas.layers.map((layer) => layer.role), [
    "image_team",
    "fallback_mat",
    "image_athlete",
    "fallback_keyline",
    "text_name",
    "text_team",
  ]);
  const [hero, mat, inset, keyline, name, team] = canvas.layers;

  // Contract order drives the composition: the first image slot is the hero.
  assert.equal(hero.inputSlotKey, "image_team");
  assert.equal(inset.inputSlotKey, "image_athlete");
  assert.ok(inset.sizeIn.width < hero.sizeIn.width / 2, "the second slot reads as an inset, not a peer");
  assert.ok(inset.offsetIn.x > hero.offsetIn.x + hero.sizeIn.width / 2, "the inset sits on the hero's right");
  assert.ok(mat.sizeIn.width > inset.sizeIn.width && mat.sizeIn.height > inset.sizeIn.height, "the mat backs the inset");
  assert.equal(mat.fills[0].color, "#ffffff");
  assert.equal(keyline.kind, "shape");

  // Text roles must be the exact contract slot keys so typed values render.
  assert.equal(name.kind, "text");
  assert.equal(name.sample, "Athlete name");
  assert.equal(team.sample, "Team and season");
  assert.ok(name.typeSizePt > team.typeSizePt, "the first text slot leads");
  assert.ok(team.offsetIn.y > name.offsetIn.y, "text slots stack downward");
  assert.ok(canvas.layers.every((layer) => within(layer, canvas)), "every layer stays on the surface");

  // Only image nodes are bridged to input slots, through the exact node ids.
  assert.deepEqual(document.input_slots.map((slot) => slot.slot_key), ["image_team", "image_athlete"]);
  assert.ok(document.input_slots.every((slot) => slot.surface_id === document.output.surfaces[0].id && slot.variant_id === document.output.surfaces[0].variant_id));
});

test("a text-only contract centers its lines and bridges no input slots", () => {
  const document = fallbackBrowserPreviewDocument({
    templateID: "tpl_test",
    contract: contract([
      { key: "text_headline", kind: "text", ordinal: 1, required: true, suggested_label: "A headline that runs long", max_length: 10 },
      { key: "text_footer", kind: "text", ordinal: 2, required: false },
    ]),
    output: output(10, 8),
  });
  const canvas = canvasFor(document);
  assert.ok(canvas, "the fallback document must parse through browserPreviewCanvas unchanged");
  assert.deepEqual(canvas.layers.map((layer) => layer.kind), ["text", "text"]);
  const [headline, footer] = canvas.layers;
  assert.equal(headline.sample, "A headline", "max_length truncates the sample");
  assert.equal(footer.sample, "text_footer", "an unlabelled slot falls back to its exact key");
  assert.equal(headline.align, "center");
  assert.ok(headline.offsetIn.y > canvas.heightIn * 0.2, "a text-only layout centers vertically instead of hugging the top");
  assert.ok(canvas.layers.every((layer) => within(layer, canvas)));
  assert.deepEqual(document.input_slots, []);
});

test("three or more image slots become a hero over a row, and unusable product dimensions build nothing", () => {
  const document = fallbackBrowserPreviewDocument({
    templateID: "tpl_test",
    contract: contract([
      { key: "image_a", kind: "image", ordinal: 1, required: true },
      { key: "image_b", kind: "image", ordinal: 2, required: false },
      { key: "image_c", kind: "image", ordinal: 3, required: false },
    ]),
    output: output(8, 10),
  });
  const canvas = canvasFor(document);
  assert.ok(canvas);
  const [hero, second, third] = canvas.layers;
  assert.ok(hero.sizeIn.width > second.sizeIn.width, "the first slot stays the hero");
  assert.equal(second.offsetIn.y, third.offsetIn.y, "the remaining slots share one row");
  assert.ok(third.offsetIn.x > second.offsetIn.x);
  assert.ok(canvas.layers.every((layer) => within(layer, canvas)));

  assert.equal(fallbackBrowserPreviewDocument({
    templateID: "tpl_test",
    contract: contract([{ key: "image_a", kind: "image", ordinal: 1, required: true }]),
    output: { id: "output-a", ordinal: 0, products: [] },
  }), null);
});

// The restored Modern Vintage r2 contract is pinned from the supplied
// render-request so the browser copy cannot silently drift from the picker.
const memoryMateContract = {
  template: { id: "tpl_9ede6ad441b647cdae32e781e16d39f5", revision_id: "rev_c926b893f2a144afa968b868bba503ca", revision_number: 2 },
  output: {
    id: "memory-mate-8x10-portrait-a",
    label: "8 × 10 Memory Mate (Portrait)",
    ordinal: 4,
    surfaces: [{ id: "memory-mate-8x10-portrait", variant_id: "a", fulfillment_role: "artwork", ordinal: 0, width_in: 8, height_in: 10 }],
  },
  slots: [
    { key: "athlete.portrait.5x7", kind: "image", ordinal: 1, required: false, suggested_label: "Athlete portrait (5x7)", suggested_semantic_key: "athlete.portrait", expected_aspect_ratio: { width: 5, height: 7 } },
    { key: "athlete.portrait.10x8", kind: "image", ordinal: 2, required: false, suggested_label: "athlete.portrait", suggested_semantic_key: "athlete.portrait", expected_aspect_ratio: { width: 10, height: 8 } },
  ],
};

const memoryMateOutput = {
  id: "memory-mate-8x10-portrait-a",
  label: "8 × 10 Memory Mate (Portrait)",
  ordinal: 4,
  products: [{ canonical_product_id: "memory-mate-8x10", canonical_product_revision: 1, width_in: 8, height_in: 10, orientation: "portrait" }],
};

function specDocument(contract = memoryMateContract, output = memoryMateOutput) {
  return specBrowserPreviewDocument({ spec: modernVintageSpec, contract, output });
}

test("spec slot keys resolve to the contract keys the rest of the app binds by", () => {
  const keys = contractSlotKeysForSpec(modernVintageSpec.slots, memoryMateContract.slots);
  // The spec names slots semantically; the storefront binds by stable key.
  // Both contract slots share a semantic key, so the 5:7 / 10:8 aspect ratios
  // are what disambiguate them.
  assert.equal(keys.get("athlete.portrait.5x7"), "athlete.portrait.5x7");
  assert.equal(keys.get("athlete.portrait.10x8"), "athlete.portrait.10x8");
});

test("aspect-ambiguous spec slots still resolve, by label and then declaration order", () => {
  const byLabel = contractSlotKeysForSpec(
    [{ key: "spec.a", kind: "image", label: "Left" }, { key: "spec.b", kind: "image", label: "Right" }],
    [
      { key: "image_right", kind: "image", ordinal: 2, required: false, suggested_label: "Right" },
      { key: "image_left", kind: "image", ordinal: 1, required: false, suggested_label: "Left" },
    ],
  );
  assert.equal(byLabel.get("spec.a"), "image_left");
  assert.equal(byLabel.get("spec.b"), "image_right");

  const byOrder = contractSlotKeysForSpec(
    [{ key: "spec.a", kind: "image" }, { key: "spec.b", kind: "image" }],
    [
      { key: "image_second", kind: "image", ordinal: 6, required: false },
      { key: "image_first", kind: "image", ordinal: 1, required: false },
    ],
  );
  assert.equal(byOrder.get("spec.a"), "image_first", "declaration order follows contract ordinal, not array order");
  assert.equal(byOrder.get("spec.b"), "image_second");
});

test("the bundled published spec converts into a parser-valid document with exact geometry", () => {
  const document = specDocument();
  assert.equal(document.preview_source, "local_published_copy");
  // The storefront output id is the spec surface id joined to its variant id;
  // the contract publishes that pairing outright.
  assert.deepEqual(document.output.surfaces, [{
    id: "memory-mate-8x10-portrait",
    variant_id: "a",
    width_in: 8,
    height_in: 10,
    fulfillment_role: "artwork",
    ordinal: 0,
  }]);

  const canvas = canvasFor(document);
  assert.ok(canvas, "the converted spec must parse through browserPreviewCanvas unchanged");
  assert.equal(canvas.widthIn, 8);
  assert.equal(canvas.heightIn, 10);
  assert.equal(canvas.backgroundColor, "#ffede1", "the full-bleed solid base doubles as the canvas base colour");

  const backgroundURL = "https://images.batchrelay.com/qs721nx4b560vgs1g9frmkt97d8c539d/templates/backgrounds/sha256/f547fc575716fc1ba04226cf7d5f08adca8615e6f4f96db8ccb893cde05dd324.jpg";
  assert.equal(canvas.layers.length, 5);
  const [base, background, tint, individual, team] = canvas.layers;

  assert.equal(base.fills[0].color, "#ffede1");
  assert.equal(background.assetRef, backgroundURL);
  assert.equal(background.fitMode, "cover");
  assert.equal(tint.fills[0].color, "#17110c");
  // The renderer paints a shape's first fill opaquely and applies alpha at the
  // layer, so the published fill opacity is folded in exactly once.
  assert.equal(tint.opacity, 0.55);
  assert.equal(tint.fills[0].opacity, 1);

  assert.equal(individual.inputSlotKey, "athlete.portrait.5x7");
  assert.equal(team.inputSlotKey, "athlete.portrait.10x8");
  assert.equal(individual.inputSlotLabel, "Athlete portrait (5x7)");
  assert.equal(team.inputSlotLabel, "athlete.portrait");
  assert.equal(individual.anchor, "mc");
  assert.deepEqual(individual.offsetIn, { x: -1.623, y: -1.822 });
  assert.deepEqual(individual.sizeIn, { width: 4.003, height: 5.604 });
  assert.deepEqual(team.offsetIn, { x: 0, y: 2.799 });
  assert.deepEqual(team.sizeIn, { width: 4.185, height: 3.348 });
  assert.equal(individual.cornerRadiusIn, 0.06);
  assert.equal(team.cornerRadiusIn, 0.06);

  // Anchor-relative geometry resolves to the published composition: the
  // individual portrait upper-left, the team photo lower-centre.
  const individualAt = browserPreviewLayerPosition(individual, canvas);
  const teamAt = browserPreviewLayerPosition(team, canvas);
  assert.ok(Math.abs(individualAt.x - 0.3755) < 0.001 && Math.abs(individualAt.y - 0.376) < 0.001);
  assert.ok(Math.abs(teamAt.x - 1.9075) < 0.001 && Math.abs(teamAt.y - 6.125) < 0.001);
  assert.ok(teamAt.y > individualAt.y + individual.sizeIn.height, "the team photo sits below the individual portrait");
  assert.ok(Math.abs((teamAt.x + team.sizeIn.width / 2) - canvas.widthIn / 2) < 0.001, "the team photo is horizontally centred");

  assert.deepEqual(document.input_slots, [
    { surface_id: "memory-mate-8x10-portrait", variant_id: "a", node_id: "n_1c8755c5-ebdb-4cd8-a2bc-1b81d5213913", slot_key: "athlete.portrait.5x7" },
    { surface_id: "memory-mate-8x10-portrait", variant_id: "a", node_id: "n_6ca10bb7-5a87-4a5e-bb28-27118ca09820", slot_key: "athlete.portrait.10x8" },
  ]);
});

test("the surface pairing falls back to the naming convention when the contract omits surfaces", () => {
  const document = specDocument({ ...memoryMateContract, output: { id: memoryMateContract.output.id, ordinal: 4 } });
  assert.ok(document);
  assert.equal(document.output.surfaces[0].id, "memory-mate-8x10-portrait");
  assert.equal(document.output.surfaces[0].variant_id, "a");
  assert.ok(canvasFor(document));
});

test("the bundled copy is pinned to the template and revision it was taken from", () => {
  // The preview prefers the bundled copy only for this exact template id; the
  // storefront looks it up by that key before falling back to synthesis.
  assert.equal(modernVintageSpec.templateId, "tpl_9ede6ad441b647cdae32e781e16d39f5");
  assert.equal(modernVintageSpec.revisionId, "rev_c926b893f2a144afa968b868bba503ca");
  assert.equal(modernVintageSpec.schemaVersion, "batchrelay.render-template/v6");
});

test("a same-sized sibling output does not inherit the bundled memory mate", () => {
  // The 8x10 plaque outputs share the memory mate's trim but are a different
  // composition, and the bundled copy holds only the surface it was taken
  // with. The contract's own surface pairing is what keeps them apart.
  const plaqueContract = {
    ...memoryMateContract,
    output: {
      id: "plaque-a",
      ordinal: 2,
      surfaces: [{ id: "plaque", variant_id: "a", fulfillment_role: "artwork", ordinal: 0, width_in: 8, height_in: 10 }],
    },
    slots: [
      { key: "image_1hhkzc0", kind: "image", ordinal: 1, required: false },
      { key: "image_1koiw91", kind: "image", ordinal: 2, required: false },
    ],
  };
  const plaqueOutput = {
    id: "plaque-a",
    ordinal: 2,
    products: [{ canonical_product_id: "contemporary-plaque-8x10", canonical_product_revision: 1, width_in: 8, height_in: 10, orientation: "portrait" }],
  };
  assert.equal(specDocument(plaqueContract, plaqueOutput), null);
  assert.equal(fallbackBrowserPreviewDocument({ templateID: modernVintageSpec.templateId, contract: plaqueContract, output: plaqueOutput }).preview_source, "fallback");
});

test("a bundled spec that does not cover the requested output yields no exact document", () => {
  assert.equal(specDocument(
    { ...memoryMateContract, output: { id: "print-5x7-portrait", ordinal: 0 } },
    { ...memoryMateOutput, id: "print-5x7-portrait", products: [{ canonical_product_id: "print-5x7", canonical_product_revision: 1, width_in: 5, height_in: 7, orientation: "portrait" }] },
  ), null);
  // ...and the offline path still produces a usable synthesized layout there.
  assert.equal(fallbackBrowserPreviewDocument({
    templateID: "tpl_9ede6ad441b647cdae32e781e16d39f5",
    contract: { ...memoryMateContract, output: { id: "print-5x7-portrait", ordinal: 0 }, slots: [memoryMateContract.slots[0]] },
    output: { ...memoryMateOutput, id: "print-5x7-portrait", products: [{ canonical_product_id: "print-5x7", canonical_product_revision: 1, width_in: 5, height_in: 7, orientation: "portrait" }] },
  }).preview_source, "fallback");
});

test("every bundled spec file is registered, readable, and pinned to its template", () => {
  const files = readdirSync(specsDirectory).filter((name) => name.endsWith(".json")).sort();
  assert.ok(files.length > 0, "the bundled spec directory must not be empty");

  // Turbopack cannot enumerate a directory at build time, so the registry
  // lists its imports explicitly. This is the guard that makes that safe: a
  // spec file dropped in without an import fails here with the exact line to
  // add, instead of silently never loading.
  const registry = readFileSync(new URL("../src/lib/storefront/template-specs/index.ts", import.meta.url), "utf8");
  for (const file of files) {
    assert.ok(
      registry.includes(`./specs/${file}`),
      `${file} is not registered. Add: import x from "./specs/${file}"; and list it in registeredSpecFiles.`,
    );
    const spec = renderTemplateSpecFromRequest(JSON.parse(readFileSync(new URL(file, specsDirectory), "utf8")));
    assert.ok(spec, `${file} must load through renderTemplateSpecFromRequest`);
    assert.ok(file.startsWith(spec.templateId), `${file} must be named for its template id`);
  }
});

test("an unreadable or incomplete spec is skipped rather than thrown", () => {
  // The registry keeps loading its other specs when one file is malformed.
  assert.equal(renderTemplateSpecFromRequest(null), null);
  assert.equal(renderTemplateSpecFromRequest({}), null);
  assert.equal(renderTemplateSpecFromRequest({ template: { templateId: "tpl_x", revisionId: "rev_x", surfaces: [] } }), null);
  assert.equal(renderTemplateSpecFromRequest({ template: { templateId: "tpl_x", revisionId: "rev_x", surfaces: [{ id: "s" }] } }), null);
  // A bare template document is accepted alongside the render-request wrapper.
  const bare = renderTemplateSpecFromRequest({
    templateId: "tpl_x",
    revisionId: "rev_x",
    surfaces: [{ id: "s", widthIn: 8, heightIn: 10, variants: [{ id: "a", layers: [] }] }],
  });
  assert.equal(bare.templateId, "tpl_x");
  assert.deepEqual(bare.slots, []);
});

test("only https template art on a trusted host is used, and never through the proxy", () => {
  const cdn = "https://images.batchrelay.com/tenant/templates/backgrounds/sha256/abc.jpg";
  assert.equal(publicTemplateAssetURL(cdn), cdn);
  // Refs the API alone can resolve, and any untrusted origin, are refused.
  assert.equal(publicTemplateAssetURL("builtin:pattern/grain/v1"), null);
  assert.equal(publicTemplateAssetURL("http://images.batchrelay.com/a.jpg"), null);
  assert.equal(publicTemplateAssetURL("https://evil.example.com/a.jpg"), null);
  assert.equal(publicTemplateAssetURL("https://images.batchrelay.com.evil.example/a.jpg"), null);
  assert.equal(publicTemplateAssetURL("https://user:pass@images.batchrelay.com/a.jpg"), null);
  assert.equal(publicTemplateAssetURL(undefined), null);
});

test("the Neon Lights spec keeps its CDN background beneath the published tint", () => {
  const contract = {
    ...memoryMateContract,
    template: { id: neonLightsSpec.templateId, revision_id: neonLightsSpec.revisionId, revision_number: 3 },
    slots: [
      { key: "image_122qlv9", kind: "image", ordinal: 1, required: false, suggested_label: "Athlete portrait (5x7)", suggested_semantic_key: "athlete.portrait", expected_aspect_ratio: { width: 5, height: 7 } },
      { key: "text_5106920550f5", kind: "text", ordinal: 2, required: false, suggested_label: "Print Name", suggested_semantic_key: "athlete_print_name" },
      { key: "text_171cff5dcfde", kind: "text", ordinal: 3, required: false, suggested_label: "Jersey Number", suggested_semantic_key: "athlete_jersey_number" },
      { key: "text_746edef46a4a", kind: "text", ordinal: 4, required: false, suggested_label: "Team", suggested_semantic_key: "athlete_team" },
      { key: "text_1e6560b98c6e", kind: "text", ordinal: 5, required: false, suggested_label: "Year", suggested_semantic_key: "athlete_year" },
      { key: "image_12rkfks", kind: "image", ordinal: 10, required: false, suggested_label: "athlete.portrait", suggested_semantic_key: "athlete.portrait", expected_aspect_ratio: { width: 10, height: 8 } },
    ],
  };
  const document = specBrowserPreviewDocument({ spec: neonLightsSpec, contract, output: memoryMateOutput });
  assert.equal(document.preview_source, "local_published_copy");

  const backgroundURL = "https://images.batchrelay.com/qs721nx4b560vgs1g9frmkt97d8c539d/templates/backgrounds/sha256/7058e81385b9b20cd943656ceede1f69fd92113537c6864402af3ac9eb09bed2.jpg";
  assert.equal(document.assets.length, 7, "the frozen copy includes the background and all six transparent overlays");
  assert.deepEqual(document.assets[0], { asset_ref: backgroundURL, kind: "public_template_asset", content_url: backgroundURL });
  assert.equal(document.assets.filter((asset) => asset.content_url.endsWith(".png")).length, 6);

  const canvas = canvasFor(document);
  assert.ok(canvas, "the converted spec must parse through browserPreviewCanvas unchanged");
  assert.equal(canvas.backgroundColor, "#ffede1");
  assert.equal(canvas.layers.length, 15, "every published layer survives the frozen browser conversion");

  // Paint order is what makes the design read: base, background, tint, photos,
  // composed text, then the six transparent overlays.
  const [base, background, tint, individual, team, ...decoration] = canvas.layers;
  assert.equal(base.kind, "shape");
  assert.equal(base.fills[0].color, "#ffede1");
  assert.equal(background.kind, "image");
  assert.equal(background.assetRef, backgroundURL);
  assert.equal(background.inputSlotKey, undefined, "published art is never bound to a shopper photo slot");
  assert.equal(background.fitMode, "cover");
  assert.deepEqual(background.sizeIn, { width: 8, height: 10 });

  assert.equal(tint.kind, "shape");
  assert.equal(tint.fills[0].color, "#17110c");
  assert.equal(tint.opacity, 0.55);
  assert.equal(individual.inputSlotKey, "image_122qlv9");
  assert.equal(team.inputSlotKey, "image_12rkfks");
  const textLayers = decoration.slice(0, 4);
  assert.deepEqual(textLayers.map((layer) => {
    const binding = layer.textFragments?.find((fragment) => fragment.kind === "binding");
    return [binding?.slotKey, binding?.placeholder];
  }), [
    ["text_5106920550f5", "Print Name"],
    ["text_171cff5dcfde", "Jersey Number"],
    ["text_746edef46a4a", "Team"],
    ["text_1e6560b98c6e", "Year"],
  ]);
  assert.ok(textLayers.every((layer) => layer.fontFamily.startsWith("var(--font-barlow-semi-condensed)")));
  assert.deepEqual(textLayers.slice(0, 3).map((layer) => [layer.sizeIn.width, layer.align]), [
    [3.2560340261635883, "left"],
    [3.211509685046013, "right"],
    [3.1717939179104064, "left"],
  ]);
  assert.ok(decoration.slice(4).every((layer) => layer.kind === "image" && layer.assetRef?.endsWith(".png")));
});

test("the two bundled templates share a composition but stay separately addressable", () => {
  assert.notEqual(modernVintageSpec.templateId, neonLightsSpec.templateId);
  assert.equal(neonLightsSpec.revisionId, "rev_398677279733464cafb253d610f0e891");
  // Modern Vintage's restored r2 background remains separate from the frozen
  // Neon Lights artwork while both templates are independently selectable.
  const modernVintage = specDocument();
  assert.equal(modernVintage.assets.length, 1);
  assert.equal(modernVintage.assets[0].kind, "public_template_asset");
});
