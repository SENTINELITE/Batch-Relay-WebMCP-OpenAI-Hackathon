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
  assert.match(revise, /slotTransformFromCropPatch\(draft\.slotTransforms\[slotKey\] \?\? initialBrowserPreviewTransform, cropPatch\)/);
  assert.match(revise, /patchDraft\(draft\.id, \{ slotTransforms: transforms, proofState: "idle" \}\)/);
  assert.match(revise, /patchDraft\(draft\.id, \{ directCrop: nextCrop \}\)/);
  // The reported crop is read back out of the committed transform, so the
  // response cannot claim a framing the draft did not take.
  assert.match(revise, /cropPatchFromSlotTransform\(transforms\[slotKey\]!\)/);
});

test("revise_prints repaints every visible surface before it answers", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  const revise = handler(ui, "revise_prints", "propose_prints");

  // The workbench preview, when the revised draft is the one on it.
  assert.match(revise, /if \(draft\.id === selectedDraftId\) \{\s*lastBrowserPreviewTransforms\.current = transforms;\s*setSlotTransforms\(transforms\);/);
  // A card paints a snapshot of the draft it proposed, so a reframed draft has
  // to be written back into its standing card or the shopper would be
  // answering a picture of the framing that was just replaced.
  assert.match(revise, /setProposalStack\(\(entries\) => entries\.map\(/);
  assert.match(revise, /proposal: \{ \.\.\.entry\.proposal, draft: next \}/);
  // And all of it lands before the tool resolves.
  assert.match(revise, /await nextPaint\(\);/);
  assert.ok(
    revise.indexOf("await nextPaint()") < revise.indexOf("respondToStorefrontWebMcpAction"),
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

  // The template is resolved as a pure read, exactly as a background
  // configure_print does, and every draft is recorded as rail-placed.
  assert.match(propose, /await resolveTemplateOffScreen\(batchProduct, draft, \{ orientation: batchOrientation \}\)/);
  assert.match(propose, /backgroundDraftIds\.current\.add\(draft\.id\)/);
  assert.match(propose, /placed: "draft_rail"/);
  assert.match(propose, /none of them took the screen/);
});

test("propose_prints reuses the one proposal machinery so the cards stack in the same deck", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  const propose = handler(ui, "propose_prints", "add_to_cart");

  // The same call add_to_cart makes, so the cards are the same cards with the
  // same duplicate rule and the same standalone previews.
  assert.match(propose, /const staged = proposeDraft\(draft, batchQuantity\);/);
  assert.match(propose, /duplicate_of_pending_proposal: staged\.duplicate/);
  assert.match(propose, /status: staged\.duplicate \? "already_proposed" : "proposed"/);
  // Nothing enters the cart here; only the shopper's answer does that.
  assert.doesNotMatch(propose, /addDraftToCart|resolveProposals|setCart\(/);
  assert.match(propose, /decided_by: "shopper"/);
  assert.match(propose, /nextStep: "await_shopper_decision"/);
});

test("propose_prints reports one ordered result per photograph and survives a partial failure", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  const propose = handler(ui, "propose_prints", "add_to_cart");

  // One print per photo reference, in the order they were named.
  assert.match(propose, /for \(const \[index, reference\] of refs\.entries\(\)\)/);
  assert.match(propose, /position: index \+ 1|const position = index \+ 1/);
  // A reference that cannot be resolved is reported in place and the loop
  // continues; aborting the batch would throw away the prints that did work.
  assert.match(propose, /is not in the current photo tray/);
  assert.match(propose, /matches multiple tray photographs/);
  assert.match(propose, /catch \(error\) \{[\s\S]*?status: "failed",[\s\S]*?reason: responseMessage\(error\)/);
  assert.match(propose, /continue;/);
  // Every item carries its verdict, and the batch carries the counts.
  assert.match(propose, /review: printReviewWire\(reviewForDraft\(draft\)\)/);
  assert.match(propose, /review_summary: summary/);
});

test("accept_ready answers only the unflagged cards and leaves the flagged ones standing", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  const resolve = handler(ui, "resolve_cart_proposal");

  // The subset is chosen by the verdict, not by position or count.
  assert.match(resolve, /targets = pendingProposals\.filter\(\(proposal\) => reviewForDraft\(proposal\.draft\)\.verdict === "ready"\)/);
  assert.match(resolve, /scope: readyOnly \? "ready_pending"/);
  // A needs_review card is exactly the one the shopper meant to look at, so it
  // is never swept up by this decision.
  assert.match(resolve, /every card waiting is flagged needs_review/);
  // It is still the shopper's decision: the quoted words are required for
  // accept_ready exactly as for every other decision.
  assert.match(resolve, /resolve_cart_proposal relays the shopper's decision only/);
  assert.ok(
    resolve.indexOf("shopperConfirmation") < resolve.indexOf('targets = pendingProposals.filter'),
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

  // The chip is a reason to look, never a block: both verdicts keep both
  // buttons live, and only the shopper presses either.
  assert.match(card, /needsReview \? "⚠ Needs review" : "✓ Ready"/);
  assert.match(card, /tone=\{needsReview \? "warning" : "success"\}/);
  assert.match(card, /printReviewSummary\(review\)/);
  assert.doesNotMatch(card, /disabled=\{[^}]*needsReview/);

  // A draft made in the rail says so, because the shopper never chose it in
  // the format picker and the card is their first sight of it.
  assert.match(card, /Found in catalog/);
  assert.match(ui, /foundInCatalog: backgroundDraftIds\.current\.has\(proposal\.draftId\)/);
});
