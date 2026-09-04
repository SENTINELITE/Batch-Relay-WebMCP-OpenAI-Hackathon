import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { browserPreviewAssetProxyURL } from "../src/lib/storefront/client.ts";
import { selectArtworkPath } from "../src/lib/storefront/customization.ts";
import { cartItemDisplayName, localCartConfigurationKey, mergeLocalCartItem, mostRecentLocalCartItem } from "../src/lib/storefront/local-cart.ts";
import {
  browserPreviewCanvas,
  browserPreviewLayerPosition,
  browserPreviewPanLimits,
  clampBrowserPreviewTransform,
  minimumBrowserPreviewPanLimit,
} from "../src/lib/storefront/browser-preview.ts";
import { browserPreviewCropRect } from "../src/lib/storefront/browser-preview-crop.ts";
import { defaultCropForSubject } from "../src/lib/storefront/face-geometry.ts";
import {
  cropPatchFromSlotTransform,
  describeMissingRequirements,
  directCropFocus,
  effectiveRequiredTemplateSlotKeys,
  focusFromPreviewOffset,
  isCompleteTemplateDraft,
  missingRequirementsGuidance,
  missingTemplateDraftRequirements,
  naturalProductMatches,
  patchPrintDraft,
  productTypeMatches,
  rememberedCompatibleOutput,
  previewOffsetFromFocus,
  slotTransformFromCropPatch,
} from "../src/lib/storefront/print-drafts.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("direct artwork clears a template-only failure without changing its availability", () => {
  assert.deepEqual(selectArtworkPath("direct", "error"), {
    customization: "direct",
    templateState: "idle",
    clearTemplateNotice: true,
  });
  assert.deepEqual(selectArtworkPath("template", "error"), {
    customization: "template",
    templateState: "idle",
    clearTemplateNotice: true,
  });
});

test("the template demo is frozen while hosted rendering keeps the published route", async () => {
  const [templates, outputs, contract, renders, client] = await Promise.all([
    read("src/app/api/templates/route.ts"),
    read("src/app/api/templates/[templateId]/outputs/route.ts"),
    read("src/app/api/templates/[templateId]/outputs/[outputId]/contract/route.ts"),
    read("src/app/api/templates/[templateId]/renders/route.ts"),
    read("src/lib/storefront/client.ts"),
  ]);

  assert.match(templates, /frozenDemoTemplateCatalog/);
  assert.match(outputs, /frozenDemoTemplateOutputs/);
  assert.match(outputs, /frozen_demo_revision_mismatch/);
  assert.match(contract, /frozenDemoTemplateContract/);
  assert.match(contract, /frozen_demo_revision_mismatch/);
  assert.doesNotMatch(`${templates}\n${outputs}\n${contract}`, /forwardUpstream/);
  assert.match(renders, /`\/v1\/templates\/\$\{templateID\}\/renders`/);
  assert.match(client, /templateOutputs: \(templateId: string\) =>\s*request<TemplateOutputs>\(`\/api\/templates\/\$\{encodeURIComponent\(templateId\)\}\/outputs`\)/);
  assert.doesNotMatch(`${templates}\n${outputs}\n${contract}\n${renders}\n${client}`, /convex/i);
});

test("template compatibility keeps every canonical product and revision match and preserves a matching draft output", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  const prepare = await read("src/components/storefront/prepare-step.tsx");
  assert.match(ui, /compatibleTemplateOutputs\(outputs\.outputs, productForCompatibility\)/);
  assert.match(ui, /compatible\.length === 0/);
  assert.match(ui, /void discoverTemplates\(\)/);
  assert.match(ui, /preloadedTemplatePreviews/);
  assert.match(ui, /warmedForOutput/);
  assert.match(prepare, /<TemplateCarousel/);
  assert.doesNotMatch(prepare, /<SelectField/);
  assert.doesNotMatch(prepare, /Compatible published output/);
  assert.match(ui, /rememberedCompatibleOutput\(draft\.template, template\.id, outputs\.revision_id, compatible\)/);
  assert.doesNotMatch(ui, /outputs\.outputs\.find\(/);
});

test("print detail follows framing, an applicable published template, then cart", async () => {
  const prepare = await read("src/components/storefront/prepare-step.tsx");
  assert.doesNotMatch(prepare, /Crop frame ·/);
  assert.doesNotMatch(prepare, /The frame is a local crop aid/);
  assert.match(prepare, /const hasPublishedTemplate = customization === "template" && Boolean\(selectedTemplateId\) && \(Boolean\(templateContract\) \|\| templateLoading\);/);
  assert.match(prepare, /\{hasPublishedTemplate \? \([\s\S]*?title="Published studio template"[\s\S]*?\) : null\}\s*\{addToCartAction\}/);
});

test("a draft remembers an output only when the returned template revision still matches", () => {
  const outputs = [{ id: "portrait" }, { id: "landscape" }];
  const remembered = { id: "template_123", outputId: "landscape", revisionId: "revision_7" };
  assert.equal(
    rememberedCompatibleOutput(remembered, "template_123", "revision_7", outputs)?.id,
    "landscape",
  );
  assert.equal(rememberedCompatibleOutput(remembered, "template_123", "revision_8", outputs), null);
  assert.equal(rememberedCompatibleOutput(remembered, "template_456", "revision_7", outputs), null);
  assert.equal(rememberedCompatibleOutput(remembered, "template_123", "revision_7", [{ id: "portrait" }]), null);
});

test("heterogeneous drafts retain their exact template output and revision independently", async () => {
  const first = {
    id: "draft_5x7", productId: "print-5x7", productRevision: 4, photoIds: ["photo_1"],
    template: { id: "template_5x7", outputId: "print-5x7-portrait", revisionId: "revision_5x7" },
    templateContractKnown: true, requiredSlotKeys: ["portrait"], slotAssignments: { portrait: "photo_1" }, textValues: {}, slotTransforms: {},
    directCrop: { zoom: 1, focusX: 50, focusY: 50 }, proofState: "idle", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
  };
  const second = {
    ...first,
    id: "draft_memory_mate", productId: "memory-mate-8x10", productRevision: 7, photoIds: ["photo_1", "photo_2"],
    template: { id: "template_memory_mate", outputId: "memory-mate-8x10-portrait-a", revisionId: "revision_memory_mate" },
    requiredSlotKeys: ["individual", "team"], slotAssignments: { individual: "photo_1", team: "photo_2" },
  };
  const drafts = [first, second].map((draft) => draft.id === second.id
    ? patchPrintDraft(draft, { proofState: "preparing" })
    : draft);
  assert.deepEqual(drafts.map((draft) => draft.template), [
    { id: "template_5x7", outputId: "print-5x7-portrait", revisionId: "revision_5x7" },
    { id: "template_memory_mate", outputId: "memory-mate-8x10-portrait-a", revisionId: "revision_memory_mate" },
  ]);
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  assert.match(ui, /draftId\?: string;/);
  assert.match(ui, /const targetDraftId = draftId \?\? selectedDraftId;/);
  assert.match(ui, /chooseTemplate\(template\.id, product, output\.id, requestedOrientation, draft\.id\)/);
  assert.doesNotMatch(ui, /imageSlots\.flatMap/);
});

test("Memory Mate promotes both image slots to required and stays ineligible until they are explicitly assigned", async () => {
  const slots = [
    { key: "individual", kind: "image", required: false },
    { key: "team", kind: "image", required: false },
  ];
  assert.deepEqual(effectiveRequiredTemplateSlotKeys({ id: "memory-mate-8x10" }, slots), ["individual", "team"]);
  const draft = {
    id: "draft_memory_mate", productId: "memory-mate-8x10", productRevision: 7, photoIds: ["photo_1", "photo_2"],
    template: { id: "template_memory_mate", outputId: "memory-mate-8x10-portrait-a", revisionId: "revision_memory_mate" },
    templateContractKnown: true, requiredSlotKeys: ["individual", "team"], slotAssignments: { individual: "photo_1" }, textValues: {}, slotTransforms: {},
    directCrop: { zoom: 1, focusX: 50, focusY: 50 }, proofState: "idle", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
  };
  assert.equal(isCompleteTemplateDraft(draft), false);
  assert.deepEqual(missingTemplateDraftRequirements(draft), ["team"]);
  const completeInSamePatch = patchPrintDraft(draft, { slotAssignments: { individual: "photo_1", team: "photo_2" } });
  assert.equal(isCompleteTemplateDraft(completeInSamePatch), true);
  assert.deepEqual(missingTemplateDraftRequirements(completeInSamePatch), []);
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  const prepare = await read("src/components/storefront/prepare-step.tsx");
  assert.match(ui, /published_required:/);
  assert.match(prepare, /slots=\{visibleTemplateSlots\}/);
  assert.match(ui, /const missingRequirements = product\.template_requirement === "required"/);
  assert.match(ui, /missing_requirements: missingRequirements/);
  assert.match(ui, /"ready_for_proof_or_cart"/);
  assert.match(ui, /slot_assignments:/);
});

test("a missing slot is returned as a question for the shopper, not a bare key", async () => {
  // A partially specified memory mate used to come back as ["team"], which an
  // agent read as licence to pick a team photograph itself.
  const slots = [
    { key: "image_face", kind: "image", suggested_label: "Athlete portrait" },
    { key: "image_hero", kind: "image", suggested_label: "Team photo" },
    { key: "text_name", kind: "text", suggested_label: "Player name" },
  ];
  const aliases = { image_face: ["individual", "athlete", "portrait"], image_hero: ["team", "group"] };
  const missing = describeMissingRequirements(["image_hero", "text_name"], slots, aliases);
  assert.deepEqual(missing, [
    {
      slot_key: "image_hero",
      label: "Team photo",
      kind: "image",
      aliases: ["team", "group"],
      ask_shopper: "Which photo should be the team image?",
    },
    {
      slot_key: "text_name",
      label: "Player name",
      kind: "text",
      aliases: [],
      ask_shopper: "What should the Player name say?",
    },
  ]);

  const guidance = missingRequirementsGuidance(missing);
  assert.match(guidance, /Which photo should be the team image\?/);
  assert.match(guidance, /Ask the shopper/);
  assert.match(guidance, /Do not choose photographs for them/);
  assert.match(guidance, /do not call add_to_cart/);
  assert.equal(missingRequirementsGuidance([]), null);

  // The two template-level sentinels are not photograph questions.
  const noTemplate = describeMissingRequirements(["published_template_output"], slots, aliases);
  assert.equal(noTemplate[0].kind, "template");
  assert.match(noTemplate[0].ask_shopper, /which layout they want/);
});

test("the prepare step frames each image with pan and zoom, and takes photographs only from the tray", async () => {
  const prepare = await read("src/components/storefront/prepare-step.tsx");
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  // The managed URL ingest flow is gone from the visible workbench.
  for (const removed of [/source-url/, /Ingest URL/, /managed ingest/, /Routable HTTPS/, /sourceUrl/, /ingestAsset/]) {
    assert.doesNotMatch(prepare, removed);
    assert.doesNotMatch(ui, removed);
  }
  // Focus wording is replaced by pan wording without changing the vocabulary.
  assert.doesNotMatch(prepare, /Horizontal focus|Vertical focus/);
  assert.match(prepare, /label="Pan X"/);
  assert.match(prepare, /label="Pan Y"/);
  assert.match(prepare, /onCropXChange/);
  assert.match(prepare, /activeSlotTransform\.offsetX/);
  assert.match(prepare, /activeSlotTransform\.offsetY/);
  assert.match(prepare, /activeSlotTransform\.zoom/);
  // Direct prints use the same crop state through both sliders and
  // click-dragging the preview after it has been enlarged.
  assert.match(prepare, /function startDirectDrag/);
  assert.match(prepare, /function moveDirectDrag/);
  assert.match(prepare, /onPointerDown=\{startDirectDrag\}/);
  assert.match(prepare, /onLostPointerCapture=/);
  // Both zoom controls reach the tool schema's maximum.
  assert.equal(prepare.match(/max=\{4\}/g)?.length, 2);
  // The sliders and the preview's drag editing share one committed transform.
  assert.match(prepare, /onSlotTransformCommit\(activeImageSlotKey, activeSlotTransform\)/);
  assert.match(ui, /onSlotTransformChange=\{changeBrowserPreviewTransform\}/);
  assert.match(ui, /onSlotTransformCommit=\{updateBrowserPreviewTransform\}/);
  assert.match(ui, /onPreviewChange=\{\(slotKey, transform\) => changeBrowserPreviewTransform\(slotKey, transform\)\}/);
});

test("carried-over role defaults and current crops are reported, never silent", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  const slotAssignment = await read("src/components/storefront/template-slot-assignment.tsx");
  assert.match(ui, /prefilled_from:/);
  assert.match(ui, /default_photo_from:/);
  assert.match(ui, /photo_role_defaults:/);
  assert.match(ui, /crop: cropPatchFromSlotTransform\(/);
  assert.match(ui, /direct_crop: visibleDirectCrop\(/);
  assert.match(slotAssignment, /Prefilled from your \{prefilledSlotProvenance\[slot\.key\]\}/);
});

test("approved focus and offset crop inputs map into the shared preview framing vocabulary", () => {
  assert.equal(previewOffsetFromFocus(0), 100);
  assert.equal(previewOffsetFromFocus(50), 0);
  assert.equal(previewOffsetFromFocus(100), -100);
  assert.deepEqual(slotTransformFromCropPatch({ zoom: 1, offsetX: 0, offsetY: 0 }, { focusX: 25, focusY: 75 }), {
    zoom: 1, offsetX: 50, offsetY: -50,
  });
  assert.deepEqual(directCropFocus({ focusX: 50, focusY: 50, offsetX: 20, offsetY: -20 }), {
    focusX: 40, focusY: 60,
  });

  // A face near the source's upper-left must land in the middle of a tall slot
  // after its focus is converted to the preview's source-relative translation.
  const source = { width: 3000, height: 2000 };
  const targetAspectRatio = 5 / 7;
  const subject = { x: 0.1, y: 0.3, width: 0.1, height: 0.15 };
  const faceCrop = defaultCropForSubject(subject, targetAspectRatio, source.width / source.height);
  assert.ok(faceCrop);
  const transform = slotTransformFromCropPatch(
    { zoom: 1, offsetX: 0, offsetY: 0 },
    faceCrop,
    { sourceAspectRatio: source.width / source.height, targetAspectRatio },
  );
  const crop = browserPreviewCropRect(source, targetAspectRatio, transform);
  const projectedCenterX = ((subject.x + subject.width / 2) * source.width - crop.left) / crop.width;
  const projectedCenterY = ((subject.y + subject.height / 2) * source.height - crop.top) / crop.height;
  assert.ok(Math.abs(projectedCenterX - 0.5) < 1e-9);
  assert.ok(Math.abs(projectedCenterY - 0.5) < 1e-9);
  const publishedFaceCrop = cropPatchFromSlotTransform(transform, {
    sourceAspectRatio: source.width / source.height,
    targetAspectRatio,
  });
  assert.ok(Math.abs(publishedFaceCrop.focusX - faceCrop.focusX) < 1e-9);
  assert.ok(Math.abs(publishedFaceCrop.focusY - faceCrop.focusY) < 1e-9);
});

test("cart quantities merge only exact finished-print configurations", () => {
  const direct = (overrides = {}) => ({
    id: "item_existing",
    draftId: "draft_a",
    productId: "print-5x7",
    productName: "5 × 7 Print",
    quantity: 1,
    thumbnailURL: "blob:photo-a",
    source: "direct",
    addedAt: "2026-09-03T00:00:00.000Z",
    draft: {
      id: "draft_a",
      productId: "print-5x7",
      productRevision: 3,
      photoIds: ["photo_a"],
      templateContractKnown: false,
      requiredSlotKeys: [],
      slotAssignments: {},
      textValues: {},
      slotTransforms: {},
      directCrop: { zoom: 1.5, focusX: 50, focusY: 50, offsetX: 0, offsetY: 0 },
      proofState: "idle",
      createdAt: "2026-09-03T00:00:00.000Z",
      updatedAt: "2026-09-03T00:00:00.000Z",
    },
    ...overrides,
  });

  const first = direct();
  const sameFinishedPrint = direct({ id: "item_new", draftId: "draft_b", quantity: 4, addedAt: "2026-09-03T00:05:00.000Z", draft: { ...first.draft, id: "draft_b" } });
  const merged = mergeLocalCartItem([first], sameFinishedPrint);
  assert.equal(merged.items.length, 1);
  assert.equal(merged.line.id, first.id);
  assert.equal(merged.line.quantity, 5);
  assert.equal(merged.line.addedAt, sameFinishedPrint.addedAt);
  assert.equal(mostRecentLocalCartItem([direct({ id: "older", addedAt: "2026-09-03T00:01:00.000Z" }), merged.line])?.id, first.id);

  const changedPan = direct({
    id: "item_panned",
    draft: { ...first.draft, directCrop: { ...first.draft.directCrop, focusX: 51 } },
  });
  assert.notEqual(localCartConfigurationKey(first), localCartConfigurationKey(changedPan));
  assert.equal(mergeLocalCartItem([first], changedPan).items.length, 2);

  const changedPhoto = direct({
    id: "item_photo_b",
    draft: { ...first.draft, photoIds: ["photo_b"] },
  });
  assert.notEqual(localCartConfigurationKey(first), localCartConfigurationKey(changedPhoto));
  assert.equal(mergeLocalCartItem([first], changedPhoto).items.length, 2);
});

test("cart display prefers a non-numeric printed name and otherwise keeps the product name", () => {
  const draft = {
    textValues: { text_print_name: "Julian", text_jersey_number: "12" },
  };
  assert.equal(cartItemDisplayName({ productName: "8 × 10 Memory Mate", draft }), "Julian’s 8 × 10 Memory Mate");
  assert.equal(cartItemDisplayName({ productName: "8 × 10 Print", draft: { textValues: { text_jersey_number: "12" } } }), "8 × 10 Print");
});

test("a published slot crop round-trips back through set_crop, so relative changes are grounded", () => {
  assert.equal(focusFromPreviewOffset(100), 0);
  assert.equal(focusFromPreviewOffset(0), 50);
  assert.equal(focusFromPreviewOffset(-100), 100);
  for (const transform of [
    { zoom: 1, offsetX: 0, offsetY: 0 },
    { zoom: 2.5, offsetX: 50, offsetY: -50 },
    { zoom: 4, offsetX: -100, offsetY: 100 },
    { zoom: 1.75, offsetX: -12.5, offsetY: 37.5 },
  ]) {
    const published = cropPatchFromSlotTransform(transform);
    assert.deepEqual(slotTransformFromCropPatch({ zoom: 1, offsetX: 0, offsetY: 0 }, published), transform);
    // The published crop is absolute: the framing it names does not depend on
    // whatever framing the slot happens to hold when the patch is applied.
    assert.deepEqual(slotTransformFromCropPatch({ zoom: 3, offsetX: 40, offsetY: -60 }, published), transform);
  }
});

test("natural catalog matching recognizes 5 x 7 and leaves type filtering grounded in returned fields", () => {
  const products = [
    { id: "print-5x7", name: "Classic 5 × 7 Print", description: "", category: "prints", fulfillment_type: "print", physical_output: { width: 5, height: 7 } },
    { id: "digital-5x7", name: "Digital 5 × 7", description: "", category: "downloads", fulfillment_type: "digital", physical_output: { width: 5, height: 7 } },
    { id: "keychain-5-7", name: "Trader card 5 and 7", description: "", category: "keychains", fulfillment_type: "physical", physical_output: { width: 1, height: 2 } },
  ];
  assert.deepEqual(naturalProductMatches(products, "5 x 7").map(({ id }) => id), ["print-5x7", "digital-5x7"]);
  assert.deepEqual(naturalProductMatches(products, "5×7").map(({ id }) => id), ["print-5x7", "digital-5x7"]);
  assert.deepEqual(naturalProductMatches(products, "5 by 7").map(({ id }) => id), ["print-5x7", "digital-5x7"]);
  assert.equal(productTypeMatches(products[0], "print"), true);
  assert.equal(productTypeMatches(products[1], "print"), false);
});

test("the workbench is one screen with no shipping, quote, or sandbox order step", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  assert.match(ui, /type ActiveStep = "catalog" \| "prepare";/);
  assert.doesNotMatch(ui, /shippingPostalCode|completeAddress|AddressDraft|setSandboxOrder|setQuote\(/);
  assert.doesNotMatch(ui, /request_server_proof|prepare_sandbox_order/);
});

test("the live template preview is the prepare step's primary visual", async () => {
  const prepare = await read("src/components/storefront/prepare-step.tsx");
  assert.match(prepare, /const templatePreviewIsPrimary = customization === "template"\s*&& \(Boolean\(browserPreview\) \|\| templateLoading \|\| Boolean\(selectedTemplateId && templateContract\)\);/);
  assert.match(prepare, /<PreviewCrossfade transitionKey=\{selectedTemplateId\}>\{browserPreview\}<\/PreviewCrossfade>/);
  // The preview renders in the left visual column, ahead of the crop fallback.
  assert.ok(
    prepare.indexOf("{templatePreviewIsPrimary ? (") < prepare.indexOf('alt="Selected image crop preview"'),
    "the template preview must precede the direct-print crop fallback",
  );
  // The redundant artwork-path chooser is gone and templates are the default.
  assert.doesNotMatch(prepare, /onChooseArtworkPath|Choose artwork path|Direct artwork/);
  assert.doesNotMatch(prepare, /canUseTemplate/);
});

test("a template draft defaults to the template path and repaints on agent slot patches", async () => {
  const [ui, preview] = await Promise.all([
    read("src/components/storefront/manual-storefront.tsx"),
    read("src/components/storefront/browser-template-preview.tsx"),
  ]);
  assert.match(ui, /setCustomization\(product\.template_requirement === "unsupported" \? "direct" : "template"\);/);
  // configure_print must paint the preview before the tool resolves.
  assert.match(ui, /\/\/ The live template preview must repaint before the agent hears back\.\s*\n\s*await nextPaint\(\);/);
  // Committed framing flows in as a prop so agent crops are not stuck behind local state.
  assert.match(preview, /const committedTransforms = JSON\.stringify\([\s\S]{0,200}?localImageSlots/);
  assert.match(preview, /\}, \[[^\]]*\bcommittedTransforms\b[^\]]*\]\);/);
  assert.match(preview, /if \(drag\.current\) return;/);
});

test("the cart proposal paints before its tool call resolves", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  assert.match(ui, /const \{ proposal, duplicate \} = proposeDraft\(draft, requestedQuantity\);\s*\n\s*\/\/[^\n]*\n\s*await nextPaint\(\);/);
  // Bulk resolution paints once for the whole batch, after the cart has moved.
  assert.match(ui, /const nextCart = resolveProposals\(targets, decision\);\s*\n[^\n]*\n\s*await nextPaint\(\);/);
});

test("browser preview proxies keep document, assets, proof status, and bytes same-origin", async () => {
  const [preview, status, content, asset, client] = await Promise.all([
    read("src/app/api/templates/[templateId]/outputs/[outputId]/browser-preview/route.ts"),
    read("src/app/api/browser-previews/[renderId]/route.ts"),
    read("src/app/api/browser-previews/[renderId]/artifacts/[artifactId]/content/route.ts"),
    read("src/app/api/templates/[templateId]/outputs/[outputId]/browser-preview/assets/[assetRef]/content/route.ts"),
    read("src/lib/storefront/client.ts"),
  ]);
  assert.match(preview, /export async function GET/);
  assert.match(preview, /export async function POST/);
  assert.match(preview, /\/v1\/templates\/\$\{templateID\}\/outputs\/\$\{outputID\}\/browser-preview/);
  assert.match(preview, /\["revision_id"\]/);
  assert.match(preview, /requestIdempotencyKey/);
  assert.match(status, /\/v1\/browser-previews\/\$\{renderID\}/);
  assert.match(content, /\/v1\/browser-previews\/\$\{renderID\}\/artifacts\/\$\{artifactID\}\/content/);
  assert.match(asset, /\/v1\/templates\/\$\{templateID\}\/outputs\/\$\{outputID\}\/browser-preview\/assets\/\$\{assetRefID\}\/content/);
  assert.match(client, /browserPreviewArtifactURL: \(renderId: string, artifactId: string\) =>\s*`\/api\/browser-previews/);
  assert.match(client, /output_id: string/);
  assert.match(client, /browser-preview\?revision_id=\$\{encodeURIComponent\(body\.revision_id\)\}/);
  assert.match(client, /browserPreviewAssetProxyURL/);
  assert.match(client, /outputs\/\$\{encodeURIComponent\(outputId\)\}\/browser-preview/);
  assert.doesNotMatch(`${preview}\n${status}\n${content}\n${asset}`, /https?:\/\//);
  assert.match(client, /contentURL\.startsWith\("\/\/"\)/);
  assert.match(client, /browserPreviewAssetContentPath/);
});

test("browser-preview asset content uses only the returned same-origin opaque handle", () => {
  assert.equal(
    browserPreviewAssetProxyURL("/v1/templates/tpl_123/outputs/print_5x7/browser-preview/assets/ZnVsbC1odHRwcy1yZWY/content?revision_id=rev_456"),
    "/api/templates/tpl_123/outputs/print_5x7/browser-preview/assets/ZnVsbC1odHRwcy1yZWY/content?revision_id=rev_456",
  );
  assert.equal(browserPreviewAssetProxyURL("https://example.test/v1/templates/tpl/outputs/output/browser-preview/assets/handle/content?revision_id=rev"), null);
  assert.equal(browserPreviewAssetProxyURL("/v1/templates/tpl/outputs/output/browser-preview/assets/raw-https-ref/content?revision_id=rev&unexpected=true"), null);
  assert.equal(browserPreviewAssetProxyURL("/v1/templates/tpl/outputs/output/browser-preview/assets/raw-https-ref/content"), null);
});

test("the local browser preview accepts only the published visual document subset", () => {
  const canvas = browserPreviewCanvas(JSON.stringify({
    background: { baseColor: "#f4f0e8" },
    surfaces: [{
      id: "front",
      widthIn: 5,
      heightIn: 7,
      variants: [{
        id: "default",
        nodes: [
          { id: "portrait", kind: "image", role: "portrait", insetIn: { x: 0.5, y: 0.5 }, sizeIn: { width: 4, height: 5 }, rotationDeg: 0 },
          { id: "name", kind: "text", role: "athlete.name", insetIn: { x: 0.5, y: 6 }, sizeIn: { width: 4, height: 0.4 }, rotationDeg: 0, typeSizePt: 18, fontFamily: "system-ui", fontWeight: 700, trackingEm: 0, align: "center", verticalAlign: "middle", color: "#17110c", sample: "Avery" },
          { id: "band", kind: "shape", role: "decoration", insetIn: { x: 0, y: 0 }, sizeIn: { width: 5, height: 0.2 }, rotationDeg: 0, fills: [{ kind: "linearGradient", angleDeg: 90, stops: [{ offset: 0, color: "#112233" }, { offset: 1, color: "#445566" }] }] },
        ],
      }],
    }],
  }), "front", "default");
  assert.equal(canvas?.layers.length, 3);
  assert.equal(canvas?.layers[1]?.role, "athlete.name");
  assert.equal(canvas?.layers[2]?.fills?.[0]?.kind, "linearGradient");
  assert.equal(canvas?.backgroundColor, "#f4f0e8");
  assert.equal(browserPreviewCanvas("not-json", "front", "default"), null);
});

test("the local browser preview resolves the published anchor-relative geometry", () => {
  const canvas = browserPreviewCanvas(JSON.stringify({
    surfaces: [{
      id: "memory-mate-8x10-portrait",
      widthIn: 8,
      heightIn: 10,
      variants: [{
        id: "a",
        background: { baseColor: "#ffede1", art: "grain" },
        nodes: [
          { id: "portrait", kind: "image", role: "portrait.individual", anchor: "mc", insetIn: { x: -1.623, y: -1.822 }, sizeIn: { width: 4.003, height: 5.604 }, rotationDeg: 0, cornerRadiusIn: 0.06 },
          { id: "team", kind: "image", role: "portrait.individual", anchor: "mc", insetIn: { x: 0, y: 2.799 }, sizeIn: { width: 4.185, height: 3.348 }, rotationDeg: 0, cornerRadiusIn: 0.06 },
        ],
      }],
    }],
  }), "memory-mate-8x10-portrait", "a");
  assert.ok(canvas);
  const portrait = browserPreviewLayerPosition(canvas.layers[0], canvas);
  const team = browserPreviewLayerPosition(canvas.layers[1], canvas);
  assert.ok(Math.abs(portrait.x - 0.3755) < 0.000001 && Math.abs(portrait.y - 0.376) < 0.000001);
  assert.ok(Math.abs(team.x - 1.9075) < 0.000001 && Math.abs(team.y - 6.125) < 0.000001);
  assert.equal(canvas.backgroundArt, "grain");
  assert.equal(canvas.layers[0].cornerRadiusIn, 0.06);
});

test("the local browser preview maps independent Memory Mate photos through exact published node bindings", () => {
  const document = JSON.stringify({
    surfaces: [{
      id: "memory-mate-5x7-portrait",
      widthIn: 5,
      heightIn: 7,
      variants: [{
        id: "default",
        nodes: [
          { id: "individual", kind: "image", role: "portrait.individual", insetIn: { x: 0, y: 0 }, sizeIn: { width: 5, height: 5 }, imageSource: { kind: "binding", key: "portrait.individual" } },
          { id: "team", kind: "image", role: "portrait.individual", insetIn: { x: 0, y: 5 }, sizeIn: { width: 5, height: 2 }, imageSource: { kind: "binding", key: "portrait.individual" } },
          { id: "art", kind: "image", role: "athlete.portrait", insetIn: { x: 0, y: 0 }, sizeIn: { width: 1, height: 1 }, imageSource: { kind: "templateAsset", assetRef: "brand-frame" } },
          { id: "no-source", kind: "image", role: "athlete.team", insetIn: { x: 0, y: 0 }, sizeIn: { width: 1, height: 1 } },
        ],
      }],
    }],
  });
  const inputSlots = [
    { surface_id: "memory-mate-5x7-portrait", variant_id: "default", node_id: "individual", slot_key: "image_122qlv9" },
    { surface_id: "memory-mate-5x7-portrait", variant_id: "default", node_id: "team", slot_key: "image_12rkfks" },
    { surface_id: "memory-mate-5x7-portrait", variant_id: "default", node_id: "art", slot_key: "image_should_not_replace_art" },
  ];
  const canvas = browserPreviewCanvas(document, "memory-mate-5x7-portrait", "default", inputSlots);
  assert.ok(canvas);
  assert.equal(canvas.layers[0].inputSlotKey, "image_122qlv9");
  assert.equal(canvas.layers[1].inputSlotKey, "image_12rkfks");
  assert.equal(canvas.layers[2].inputSlotKey, undefined);
  assert.equal(canvas.layers[2].assetRef, "brand-frame");
  assert.equal(canvas.layers[3].inputSlotKey, undefined);

  const missing = browserPreviewCanvas(document, "memory-mate-5x7-portrait", "default");
  assert.equal(missing?.layers[0]?.inputSlotKey, undefined);
  assert.equal(missing?.layers[1]?.inputSlotKey, undefined);

  const duplicate = browserPreviewCanvas(document, "memory-mate-5x7-portrait", "default", [
    ...inputSlots,
    { surface_id: "memory-mate-5x7-portrait", variant_id: "default", node_id: "individual", slot_key: "image_duplicate" },
  ]);
  assert.equal(duplicate?.layers[0]?.inputSlotKey, undefined);
  assert.equal(duplicate?.layers[1]?.inputSlotKey, "image_12rkfks");

  const wrongSurface = browserPreviewCanvas(document, "memory-mate-5x7-portrait", "default", [
    { surface_id: "other-surface", variant_id: "default", node_id: "individual", slot_key: "image_wrong_surface" },
    inputSlots[1],
  ]);
  assert.equal(wrongSurface?.layers[0]?.inputSlotKey, undefined);
  assert.equal(wrongSurface?.layers[1]?.inputSlotKey, "image_12rkfks");
});

test("baked preview framing retains the shared centered-cover transform vocabulary", async () => {
  const source = await read("src/lib/storefront/browser-preview-crop.ts");
  assert.match(source, /BrowserPreviewTransform/);
  assert.match(source, /baseWidth \/ normalized\.zoom/);
  assert.match(source, /\(normalized\.offsetX \/ 100\)/);
  assert.match(source, /rasterizeBrowserPreviewCrop/);
});

test("template slot framing is a bounded cover mask, never an empty translated image", () => {
  const source = { width: 4000, height: 3000 };
  assert.equal(minimumBrowserPreviewPanLimit(1), 0);
  assert.equal(minimumBrowserPreviewPanLimit(2), 25);
  assert.equal(minimumBrowserPreviewPanLimit(4), 37.5);
  assert.deepEqual(browserPreviewPanLimits(source, 1, 1), { x: 12.5, y: 0 });
  assert.deepEqual(clampBrowserPreviewTransform({ zoom: 1, offsetX: 80, offsetY: -80 }, source, 1), {
    zoom: 1, offsetX: 12.5, offsetY: 0,
  });
  assert.deepEqual(browserPreviewPanLimits(source, 1, 2), { x: 31.25, y: 25 });
});

test("template preview clears a drag when pointer capture is lost outside the slot", async () => {
  const preview = await read("src/components/storefront/browser-template-preview.tsx");
  assert.match(preview, /onLostPointerCapture/);
  assert.match(preview, /window\.addEventListener\("pointerup", endWindowDrag\)/);
  assert.match(preview, /window\.addEventListener\("pointercancel", endWindowDrag\)/);
  assert.match(preview, /function finishDrag\(/);
  assert.match(preview, /drag\.current = null/);
  assert.match(preview, /globalThis\.document\.addEventListener\("pointerdown", clearOutsideSelection, true\)/);
  assert.match(preview, /target\.closest\("\[data-template-framing-controls\]"\)/);
});

test("visible framing controls keep a named focal target while zoom changes", async () => {
  const prepare = await read("src/components/storefront/prepare-step.tsx");
  const storefront = await read("src/components/storefront/manual-storefront.tsx");
  assert.match(prepare, /aria-label="Keep crop focus on"/);
  assert.match(prepare, /Keep zoom focused on/);
  assert.match(prepare, /onFramingFocusChange/);
  assert.match(prepare, /onFramingZoomChange/);
  assert.match(storefront, /function resolveVisibleFramingFocus/);
  assert.match(storefront, /function applyVisibleFramingFocus\(preset: FocusPreset, zoom: number/);
  assert.match(storefront, /slotTransformFromCropPatch\(initialBrowserPreviewTransform, result\.patch/);
  assert.match(storefront, /onFramingZoomChange=\{\(zoom\) => applyVisibleFramingFocus\(framingFocus, zoom\)\}/);
});

test("a committed browser-preview slot transform updates the local draft without a removed render path", async () => {
  const source = await read("src/components/storefront/manual-storefront.tsx");
  assert.match(source, /function updateBrowserPreviewTransform\(slotKey: string, transform: BrowserPreviewTransform\)[\s\S]*lastBrowserPreviewTransforms\.current\[slotKey\] \?\? transform[\s\S]*patchDraft\(selectedDraftId, \{ slotTransforms: next, proofState: "idle" \}\)/);
  assert.doesNotMatch(source, /invalidateTemplateRenderForBrowserPreviewChange|setTemplateRender/);
});

test("the multi-slot browser preview preserves independent slot transforms without guessing a mapping", async () => {
  const source = await read("src/components/storefront/browser-template-preview.tsx");
  const prepare = await read("src/components/storefront/prepare-step.tsx");
  assert.match(source, /localImageSlots: Record<string, LocalBrowserPreviewImage>/);
  assert.match(source, /const localSlotKey = layer\.inputSlotKey/);
  assert.match(source, /const localImage = localSlotKey \? localImageSlots\[localSlotKey\] : undefined/);
  assert.match(source, /<EmptyImageSlot label=/);
  assert.match(source, /onPreviewChange\?\.\(slotKey, normalized\)/);
  assert.match(source, /onPreviewCommit\?\.\(reason, slotKey, eventTransformFor\(slotKey\)\)/);
  assert.match(source, /serverProof\.transforms\[slotKey\]/);
  assert.doesNotMatch(source, /layer\.role\].*localImageSlots|localImageSlots\[layer\.role\]/);
  assert.match(source, /requestAnimationFrame/);
  assert.doesNotMatch(source, /RangeField/);
  assert.match(prepare, /onPointerUp=\{\(\) => onSlotTransformCommit\(activeImageSlotKey, activeSlotTransform\)\}/);
  assert.match(prepare, /onBlur=\{\(\) => onSlotTransformCommit\(activeImageSlotKey, activeSlotTransform\)\}/);
});
