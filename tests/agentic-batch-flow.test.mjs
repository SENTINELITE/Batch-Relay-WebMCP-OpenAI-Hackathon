import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

/** The slice of the workbench that answers one WebMCP action. */
function handler(source, action, nextAction) {
  const start = source.indexOf(`request.action === "${action}"`);
  assert.notEqual(start, -1, `missing the ${action} handler`);
  const end = nextAction ? source.indexOf(`request.action === "${nextAction}"`) : source.length;
  assert.ok(end > start, `expected ${nextAction} to follow ${action}`);
  return source.slice(start, end);
}

test("revise_prints reframes through the same patch path set_crop uses, never a second crop vocabulary", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  const revise = handler(ui, "revise_prints", "propose_prints");

  // A template slot goes through the shared transform patch, and a direct
  // print through the same directCrop fields configure_print writes. If either
  // grew its own arithmetic, the agent's read of a crop and its write of one
  // would stop agreeing.
  // Still the one shared transform patch. A focusOn preset only resolves to
  // values first — it never grows arithmetic of its own — and a resolved
  // face focus is absolute, so it starts from the flat frame rather than
  // adding itself to whatever pan was already there.
  assert.match(revise, /slotTransformFromCropPatch\(\s*resolvedFocus\.focusApplied === "faces" \? initialBrowserPreviewTransform : draft\.slotTransforms\[slotKey\] \?\? initialBrowserPreviewTransform,\s*resolvedFocus\.patch,\s*\{\s*sourceAspectRatio: photoAspectRatio/);
  assert.match(revise, /patchDraft\(draft\.id, \{ slotTransforms: transforms, proofState: "idle" \}\)/);
  assert.match(revise, /patchDraft\(draft\.id, \{ directCrop: nextCrop \}\)/);
  // The reported crop is read back out of the committed transform, so the
  // response cannot claim a framing the draft did not take.
  assert.match(revise, /cropPatchFromSlotTransform\(\s*transforms\[slotKey\]!,\s*slotCropGeometry/);
});

test("revise_prints repaints every visible surface before it answers", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  const revise = handler(ui, "revise_prints", "propose_prints");

  // The workbench preview, when the revised draft is the one on it.
  assert.match(revise, /if \(draft\.id === selectedDraftId\) \{\s*lastBrowserPreviewTransforms\.current = transforms;\s*setSlotTransforms\(transforms\);/);
  // A card paints a snapshot of the draft it proposed, so a reframed draft has
  // to be written back into its standing card or the shopper would be
  // answering a picture of the framing that was just replaced.
  assert.match(revise, /commitProposalStack\(\(entries\) => entries\.map\(/);
  assert.match(revise, /proposal: \{ \.\.\.entry\.proposal, draft: next \}/);
  // And all of it lands before the tool resolves.
  assert.match(revise, /await nextPaint\(\);/);
  assert.ok(
    revise.indexOf("await nextPaint()") < revise.indexOf("respondWithActivity"),
    "the repaint must be awaited before the response is sent",
  );
});

test("revise_prints reports every named draft and refuses to guess an ambiguous slot", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  const revise = handler(ui, "revise_prints", "propose_prints");

  // Per-draft results, not one all-or-nothing answer.
  assert.match(revise, /status: "skipped", reason: "no_such_visible_draft"/);
  assert.match(revise, /applied_count: applied/);
  assert.match(revise, /skipped_count: skipped/);
  // A role selector resolves only when exactly one slot owns the role, and a
  // multi-slot draft with no selector is skipped in words rather than guessed.
  assert.match(revise, /if \(matching\.length === 1\) slotKey = matching\[0\]!\.key;/);
  assert.match(revise, /ambiguous_slot_role/);
  assert.match(revise, /name one with slotSelector/);
  // Reframing is not a cart action and never answers a card.
  assert.doesNotMatch(revise, /addDraftToCart|proposeDraft|resolveProposals/);
});

test("propose_prints stages a batch in the background and never takes the screen", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  const propose = handler(ui, "propose_prints", "add_to_cart");

  // A batch print is background by definition: the shopper asked for prints,
  // not to have the one they are customizing taken away from them. Every way
  // the workbench could move is absent from this handler on purpose.
  for (const steal of [
    /setSelectedDraftId/,
    /selectProduct\(/,
    /noteVisibleDraft/,
    /noteShopperLookingAtSelectedDraft/,
    /setStep\(/,
    /dispatchPhotoLibrary/,
    /setBrowserPreviewDocument/,
    /setTemplateAssignments/,
  ]) assert.doesNotMatch(propose, steal, `propose_prints must not call ${steal}`);

  // One shared preflight keeps the background workbench pure while avoiding a
  // repeated template/output/contract/preview request for every photograph.
  assert.match(propose, /await resolveBatchTemplatePreflight\(batchProduct, \{/);
  assert.match(propose, /backgroundDraftIds\.current\.add\(draft\.id\)/);
  assert.match(propose, /placed: "draft_rail"/);
  assert.match(propose, /none of them took the screen/);
});

test("propose_prints leaves an unspecified direct print at neutral framing", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  const propose = handler(ui, "propose_prints", "add_to_cart");
  const directBatch = propose.slice(
    propose.indexOf("} else {\n              rememberRoles(rememberDirectPhoto"),
    propose.indexOf("            const proposal = createCartProposal"),
  );

  // createPrintDraft owns the neutral direct-print default (1x, centred, no
  // pan). Batch staging must not silently replace it with face analysis; that
  // would make a shopper's unqualified request look cached or cropped.
  assert.match(propose, /let draft = createPrintDraft\(batchProduct, \[photo\.id\]\);/);
  assert.match(directBatch, /An unspecified batch starts in the neutral print framing/);
  assert.doesNotMatch(directBatch, /defaultCropForSubject|subjectRegionFromFaces|directCrop:/);
});

test("propose_prints reuses the one proposal machinery so the cards stack in the same deck", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  const propose = handler(ui, "propose_prints", "add_to_cart");

  // Batch proposals use the same local-cart model as individual cards, then
  // commit every card to the deck in one state update.
  assert.match(propose, /const proposal = createCartProposal\(\{/);
  assert.match(propose, /const createdEntries: CartProposalStackEntry\[\] = \[\];/);
  assert.match(propose, /commitProposalStack\(\(entries\) => \[\.\.\.entries, \.\.\.createdEntries\]\);/);
  assert.match(propose, /duplicate_of_pending_proposal: false/);
  assert.match(propose, /status: "proposed"/);
  // Nothing enters the cart here; only the shopper's answer does that.
  assert.doesNotMatch(propose, /addDraftToCart|resolveProposals|setCart\(|proposeDraft\(/);
  assert.match(propose, /decided_by: "shopper"/);
  assert.match(propose, /nextStep: "await_shopper_decision"/);
});

test("propose_prints reports one ordered result per photograph and survives a partial failure", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  const propose = handler(ui, "propose_prints", "add_to_cart");

  // One print per photo reference, in the order they were named.
  assert.match(propose, /const resolvedPhotos = refs\.map\(\(reference, index\) =>/);
  assert.match(propose, /position: index \+ 1/);
  // A reference that cannot be resolved is reported in place and the loop
  // continues; aborting the batch would throw away the prints that did work.
  assert.match(propose, /is not in the current photo tray/);
  assert.match(propose, /matches multiple tray photographs/);
  assert.match(propose, /status: "skipped"/);
  assert.match(propose, /const validPhotos = resolvedPhotos\.flatMap/);
  // Every item carries its verdict, and the batch carries the counts.
  assert.match(propose, /review: printReviewWire\(reviewForDraft\(draft\)\)/);
  assert.match(propose, /review_summary: summary/);
});

test("propose_prints preflights shared template facts once and commits atomically", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  const propose = handler(ui, "propose_prints", "add_to_cart");
  const preflight = ui.slice(
    ui.indexOf("async function resolveBatchTemplatePreflight"),
    ui.indexOf("/** Compact discovery for ask_storefront"),
  );

  assert.equal((propose.match(/resolveBatchTemplatePreflight\(/g) ?? []).length, 1);
  assert.equal((propose.match(/setDrafts\(/g) ?? []).length, 1);
  assert.equal((propose.match(/commitProposalStack\(/g) ?? []).length, 1);
  assert.match(preflight, /await storefrontClient\.templateOutputs\(template\.id\)/);
  assert.match(preflight, /await storefrontClient\.templateContract\(template\.id, output\.id, outputs\.revision_id\)/);
  assert.match(preflight, /await resolvePreviewDocument\(template\.id, output, outputs\.revision_id, contract\)/);
  assert.match(propose, /status: "batch_preflight_failed"/);
  assert.match(propose, /committed: false/);
});

test("batch template intent is explicit, active, and idempotent", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  const selectors = ui.slice(
    ui.indexOf("function resolveRequestedBatchTemplate"),
    ui.indexOf("/**\n   * Shared preflight"),
  );
  const propose = handler(ui, "propose_prints", "add_to_cart");

  assert.match(selectors, /normalizedTemplateName/);
  assert.match(selectors, /template_not_found/);
  assert.match(selectors, /template_ambiguous/);
  assert.match(selectors, /template\.id === requested\.templateId/);
  assert.match(ui, /if \(!explicitTemplateSelection && product\.template_requirement === "optional"\) return null;/);
  assert.match(propose, /const idempotencyKey = batchStagingKey\(/);
  assert.match(propose, /const existingBatch = batchStagingSessions\.current\.get\(idempotencyKey\)/);
  assert.match(propose, /idempotent_retry: true/);
  assert.match(ui, /batchStagingSessions\.current\.delete\(key\)/);
});

test("accept_ready answers only the unflagged cards and leaves the flagged ones standing", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  const resolve = handler(ui, "resolve_cart_proposal");

  // The subset is chosen by the verdict, not by position or count.
  assert.match(resolve, /targets = standing\.filter\(\(proposal\) => reviewForDraft\(proposal\.draft\)\.verdict === "ready"\)/);
  assert.match(resolve, /scope: readyOnly \? "ready_pending"/);
  // A needs_review card is exactly the one the shopper meant to look at, so it
  // is never swept up by this decision.
  assert.match(resolve, /every card waiting is flagged needs_review/);
  // It is still the shopper's decision: the quoted words are required for
  // accept_ready exactly as for every other decision.
  assert.match(resolve, /resolve_cart_proposal relays the shopper's decision only/);
  assert.ok(
    resolve.indexOf("shopperConfirmation") < resolve.indexOf('targets = standing.filter'),
    "the shopper's own words are demanded before any card is selected",
  );
});

test("the review verdict rides on every response that offers a print, and on the card itself", async () => {
  const [ui, card] = await Promise.all([
    read("src/components/storefront/manual-storefront.tsx"),
    read("src/components/storefront/cart-proposal-card.tsx"),
  ]);

  // ask_storefront, configure_print, add_to_cart and propose_prints all speak
  // the same verdict shape, so an agent never has to derive it twice.
  assert.equal(ui.match(/printReviewWire\(/g).length >= 5, true);
  assert.match(ui, /proposal_review_summary: reviewCounts\(/);

  // Needs review stays visible as a compact, actionable pill. It opens the
  // reason and can be flagged for follow-up without answering the proposal.
  assert.match(card, /Needs review/);
  assert.match(card, /aria-expanded=\{reviewOpen\}/);
  assert.match(card, /printReviewSummary\(review\)/);
  assert.match(card, /Flag for follow-up/);
  assert.doesNotMatch(card, /disabled=\{[^}]*needsReview/);

  // Rail provenance stays in the tool state, not the compact card surface.
  assert.doesNotMatch(card, /Found in catalog/);
  assert.match(ui, /foundInCatalog: backgroundDraftIds\.current\.has\(proposal\.draftId\)/);
});

test("a crop patch on the print already on screen never tears its composed preview down", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  const configure = handler(ui, "configure_print", "revise_prints");

  // prepare-step falls back to the raw photograph whenever browserPreviewDocument
  // is null. selectProduct and chooseTemplate both null it and then await the
  // network, so reloading the workbench for a crop-only patch painted the
  // shopper's full-bleed picture for a frame before the template came back.
  assert.match(configure, /const reusesLoadedTemplate = Boolean\(/);
  // The reload — and the tray selection that goes with it — happen only when
  // the workbench is not already showing this exact draft, product and output.
  assert.match(
    configure,
    /if \(!reusesLoadedTemplate\) \{\s*selectProduct\(product, false, false\);\s*dispatchPhotoLibrary\(\{ type: "select", photoId: photoIds\[0\] \?\? null \}\);\s*\}/,
    "selectProduct and the tray selection must be gated behind the reuse check",
  );
  // Reusing means keeping the loaded template rather than resolving it again.
  assert.match(configure, /if \(reusesLoadedTemplate\) \{[\s\S]*?templateForPatch = loadedTemplate;/);
  // Every guard that makes the reuse safe: same draft, same product, same
  // template output, and a document actually painted.
  for (const guard of [
    /selectedDraftId === draft\.id/,
    /productSelectionKey\(selectedProduct\) === productSelectionKey\(product\)/,
    /browserPreviewDocumentRef\.current/,
    /existingDraft\.template\?\.outputId === loadedTemplate\.outputId/,
    /!requestedTemplateId \|\| requestedTemplateId === loadedTemplate\.id/,
    /!requestedOutputId \|\| requestedOutputId === loadedTemplate\.outputId/,
  ]) assert.match(configure, guard, `the reuse check must verify ${guard}`);

  // The repaint ordering the agent depends on survives.
  assert.match(configure, /await nextPaint\(\);/);
  assert.ok(
    configure.indexOf("await nextPaint()") < configure.lastIndexOf("respondWithActivity"),
    "the repaint must be awaited before the response is sent",
  );
});

test("the deck's published count is read live, so two calls in one tick agree with the deck", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");

  // The ref is the single source of truth and is written synchronously, so a
  // second tool call landing before React re-renders still sees the first
  // call's cards. Reading the rendered snapshot told the agent a smaller deck
  // than the one the shopper could see.
  assert.match(ui, /function commitProposalStack\(/);
  assert.match(ui, /proposalStackRef\.current = committed;\s*setProposalStack\(committed\);/);
  assert.match(ui, /function livePendingProposals\(\)/);
  assert.match(ui, /return pendingCartProposals\(proposalStackRef\.current\);/);
  // Nothing may mutate the deck behind the committer's back.
  const mutations = ui.match(/setProposalStack\(/g) ?? [];
  assert.equal(mutations.length, 1, "setProposalStack must only be called by commitProposalStack");
  // Duplicate detection and every reported count read the live stack.
  assert.match(ui, /pendingCartProposalForDraft\(proposalStackRef\.current, draft\.id\)/);
  assert.doesNotMatch(ui, /pending_proposal_count: pendingProposals\.length/);
});
