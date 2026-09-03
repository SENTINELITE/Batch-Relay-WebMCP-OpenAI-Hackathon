import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MUTATING_AGENT_ACTIONS,
  agentActionLabel,
  agentActivity,
  isMutatingAgentAction,
} from "../src/lib/storefront/agent-activity.ts";
import {
  WORKBENCH_HISTORY_LIMIT,
  WORKBENCH_SCHEMA_VERSION,
  createWorkbenchHistory,
  relinkWorkbenchSnapshot,
  workbenchSnapshotFromState,
  workbenchState,
} from "../src/lib/storefront/workbench-persistence.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

/** The slice of the workbench that answers one WebMCP action. */
function handler(source, action, nextAction) {
  const start = source.indexOf(`request.action === "${action}"`);
  assert.notEqual(start, -1, `missing the ${action} handler`);
  const end = nextAction ? source.indexOf(`request.action === "${nextAction}"`) : source.length;
  assert.ok(end > start, `expected ${nextAction} to follow ${action}`);
  return source.slice(start, end);
}

// ---------------------------------------------------------------- feature 1

test("only tools that change the shopper's screen are allowed to announce anything", () => {
  // The read-only pair is the whole point of the distinction: an agent that
  // browses the catalog or reads the workbench must be able to do so without
  // interrupting a shopper who is customizing a print by hand.
  for (const readOnly of ["ask_storefront", "find_prints"]) {
    assert.equal(isMutatingAgentAction(readOnly), false, `${readOnly} must not be mutating`);
    assert.equal(agentActivity(readOnly, {}, { answer: "anything" }), null);
  }
  assert.deepEqual([...MUTATING_AGENT_ACTIONS], [
    "configure_print",
    "revise_prints",
    "propose_prints",
    "add_to_cart",
    "resolve_cart_proposal",
    "manage_cart",
    "undo_last_change",
  ]);
  // Viewing the cart arrives on a tool that can mutate, but changes nothing.
  assert.equal(agentActivity("manage_cart", { action: "view" }, { action: "view", cart_item_count: 3 }), null);
});

test("a batch announcement counts what the response actually staged", () => {
  const activity = agentActivity("propose_prints", { photoRefs: [1, 2, 3, 4, 5, 6] }, {
    status: "awaiting_shopper_confirmation",
    product: { name: "5×7 Print" },
    proposed_count: 6,
    review_summary: { proposed: 6, ready: 5, needs_review: 1 },
  });
  assert.equal(activity.message, "Agent staged 6 × 5×7 Print");
  assert.equal(activity.detail, "5 ready, 1 needs review");
  // The deck plays its own entrance for every card; a second pulse over the
  // workbench would be two animations arguing about where to look.
  assert.equal(activity.pulse, null);
  assert.equal(activity.undoable, true);

  // A batch that staged nothing must not read as an achievement, and leaves no
  // undo step behind for a shopper to walk back into.
  const nothing = agentActivity("propose_prints", { photoRefs: [1] }, {
    status: "nothing_proposed",
    product: { name: "5×7 Print" },
    proposed_count: 0,
    review_summary: { proposed: 0, ready: 0, needs_review: 0 },
  });
  assert.equal(nothing.message, "Agent staged nothing");
  assert.equal(nothing.undoable, false);
});

test("a single crop change is named in the shopper's terms rather than counted", () => {
  const zoomed = agentActivity(
    "configure_print",
    { slotPatches: [{ label: "individual", operation: "set_crop", zoom: 3 }] },
    { status: "configured", draft_id: "draft_7", product: { name: "5×7 Print" }, missing_requirements: [] },
  );
  assert.equal(zoomed.message, "Agent set the individual zoom to 3.0×");
  assert.equal(zoomed.pulse, "workbench", "the slot table has no motion of its own");

  // Two values at once is a diff, not a notification, so it falls back.
  const multi = agentActivity(
    "configure_print",
    { slotPatches: [{ label: "individual", operation: "set_crop", zoom: 3, focusX: 20 }] },
    { status: "configured", draft_id: "draft_7", product: { name: "5×7 Print" }, placed: "draft_rail", missing_requirements: [] },
  );
  assert.equal(multi.message, "Agent configured a 5×7 Print in the draft rail");

  // Face centring is only ever claimed when the request asked for it; nothing
  // here infers it from a crop that merely happens to land on a face.
  const faces = agentActivity(
    "revise_prints",
    { draftIds: ["a", "b", "c", "d", "e"], crop: { focusOn: "faces", subjectWidthPercent: 50 } },
    { status: "revised", applied_count: 5, skipped_count: 0 },
  );
  assert.equal(faces.message, "Agent centred the crop on the faces at 50% width across 5 prints");
  assert.equal(faces.detail, undefined);

  const partial = agentActivity(
    "revise_prints",
    { draftIds: ["a", "b"], crop: { zoom: 1.4, offsetX: 3 } },
    { status: "revised", applied_count: 1, skipped_count: 1 },
  );
  assert.equal(partial.message, "Agent reframed 1 print");
  assert.equal(partial.detail, "1 left alone");
});

test("a cart announcement says which of the two things add_to_cart did", () => {
  const added = agentActivity("add_to_cart", { draftId: "d" }, {
    status: "added", product_name: "8×10 Print", quantity: 2,
  });
  assert.equal(added.message, "Agent added 2 × 8×10 Print to the cart");

  const proposed = agentActivity("add_to_cart", { draftId: "d" }, {
    status: "awaiting_shopper_confirmation", product_name: "8×10 Print", quantity: 1,
    duplicate_of_pending_proposal: false,
  });
  assert.equal(proposed.message, "Agent proposed 1 × 8×10 Print");
  assert.equal(proposed.detail, "The card is waiting on your answer");

  // Returning a card that was already standing changed nothing, so it offers
  // no undo step — walking back a no-op would consume a real one.
  const duplicate = agentActivity("add_to_cart", { draftId: "d" }, {
    status: "awaiting_shopper_confirmation", product_name: "8×10 Print", quantity: 1,
    duplicate_of_pending_proposal: true,
  });
  assert.equal(duplicate.undoable, false);
});

test("relaying the shopper's decision never reads as the agent's own", () => {
  const accepted = agentActivity("resolve_cart_proposal", { decision: "accept_all" }, {
    decision: "accepted", resolved_count: 5, pending_proposal_count: 0, cart_item_count: 6,
  });
  assert.equal(accepted.message, "Agent relayed your yes to 5 prints");
  assert.equal(accepted.detail, "6 now in the cart");

  const rejected = agentActivity("resolve_cart_proposal", { decision: "reject" }, {
    decision: "rejected", resolved_count: 1, pending_proposal_count: 2,
  });
  assert.equal(rejected.message, "Agent relayed your no to 1 print");
  assert.equal(rejected.detail, "2 cards still waiting");
});

test("an undo names the change it took back, and is not itself undoable", () => {
  const activity = agentActivity("undo_last_change", { steps: 1 }, {
    status: "undone",
    undone: "revise_prints framing across 5 drafts",
    remaining_undo_steps: 0,
  });
  assert.equal(activity.message, "Undid: revise_prints framing across 5 drafts");
  assert.equal(activity.detail, "Nothing further to undo");
  // Offering Undo on an undo would promise a redo the ring buffer does not have.
  assert.equal(activity.undoable, false);
  assert.equal(activity.pulse, "workbench");
});

// ---------------------------------------------------------------- feature 2

/** The smallest workbench state the persistence format accepts. */
const state = (overrides = {}) => workbenchState({
  photos: [],
  drafts: [],
  cart: [],
  proposals: [],
  roleMemory: {},
  backgroundDraftIds: [],
  selectedDraftId: null,
  selectedProductKey: null,
  step: "prepare",
  directCrop: { zoom: 1, focusX: 50, focusY: 50 },
  ...overrides,
});

test("the undo ring buffer walks back through recorded states, newest first", () => {
  const history = createWorkbenchHistory(10);
  assert.equal(history.depth(), 0);
  assert.equal(history.undo(), null, "an untouched workbench has nothing to undo");

  history.push("configure_print", state({ directCrop: { zoom: 1, focusX: 50, focusY: 50 } }));
  history.push("revise_prints framing across 5 drafts", state({ directCrop: { zoom: 2, focusX: 50, focusY: 50 } }));
  history.push("add_to_cart", state({ directCrop: { zoom: 3, focusX: 50, focusY: 50 } }));
  assert.equal(history.depth(), 3);
  assert.deepEqual(history.labels(), ["add_to_cart", "revise_prints framing across 5 drafts", "configure_print"]);

  // One step back restores the state the newest change started from.
  const once = history.undo();
  assert.equal(once.label, "add_to_cart");
  assert.equal(once.undoneCount, 1);
  assert.equal(once.state.directCrop.zoom, 3);
  assert.equal(history.depth(), 2);

  // Several steps collapse into one restore, and report every label undone.
  const twice = history.undo(2);
  assert.deepEqual(twice.labels, ["revise_prints framing across 5 drafts", "configure_print"]);
  assert.equal(twice.undoneCount, 2);
  assert.equal(twice.state.directCrop.zoom, 1, "restores the oldest of the two, not the newest");
  assert.equal(history.depth(), 0);
  assert.equal(history.undo(), null);
});

test("the ring is bounded, and going back further than it holds says how far it got", () => {
  const history = createWorkbenchHistory(3);
  for (const zoom of [1, 2, 3, 4, 5]) history.push(`change ${zoom}`, state({ directCrop: { zoom, focusX: 50, focusY: 50 } }));
  assert.equal(history.depth(), 3, "only the last three survive");
  assert.deepEqual(history.labels(), ["change 5", "change 4", "change 3"]);

  // Asking for five back when three remain walks back three and says so,
  // rather than refusing an undo the shopper can plainly see is available.
  const undone = history.undo(5);
  assert.equal(undone.undoneCount, 3);
  assert.equal(undone.state.directCrop.zoom, 3);
  assert.equal(history.depth(), 0);

  assert.equal(WORKBENCH_HISTORY_LIMIT, 10, "the shipped ring holds ten changes");
});

test("an undone state round-trips through the same relink path a reload restore uses", () => {
  const photos = [
    { id: "photo_live_1", stableKey: "key-a", previewURL: "blob:a" },
    { id: "photo_live_2", stableKey: "key-b", previewURL: "blob:b" },
  ];
  const draft = {
    id: "draft_1",
    productId: "prod_1",
    productRevision: 1,
    photoIds: ["photo_old_1"],
    slotAssignments: { individual: "photo_old_1", team: "photo_old_2" },
    slotTransforms: { individual: { zoom: 2.5, offsetX: 0, offsetY: 0 } },
    textValues: {},
    template: null,
    templateContractKnown: true,
    requiredSlotKeys: [],
    directCrop: { zoom: 1, focusX: 50, focusY: 50 },
    proofState: "idle",
  };
  const history = createWorkbenchHistory();
  history.push("revise_prints framing across 1 draft", workbenchState({
    photos: [{ id: "photo_old_1", stableKey: "key-a" }, { id: "photo_old_2", stableKey: "key-b" }],
    drafts: [draft],
    cart: [],
    proposals: [{
      id: "proposal_1",
      draftId: "draft_1",
      productId: "prod_1",
      productName: "5×7 Print",
      quantity: 2,
      thumbnailURL: "blob:gone",
      source: "template",
      draft,
      createdAt: "2026-01-01T00:00:00.000Z",
    }],
    roleMemory: { individual: "photo_old_1" },
    backgroundDraftIds: ["draft_1"],
    selectedDraftId: "draft_1",
    selectedProductKey: "prod_1:1",
    step: "prepare",
    directCrop: { zoom: 1, focusX: 50, focusY: 50 },
  }));

  const undone = history.undo();
  const snapshot = workbenchSnapshotFromState(undone.state, () => "2026-01-02T00:00:00.000Z");
  assert.equal(snapshot.version, WORKBENCH_SCHEMA_VERSION, "an undo goes back through the real snapshot envelope");

  const restore = relinkWorkbenchSnapshot(snapshot, photos);
  // A restored proposal must come back as a standing card the shopper can
  // answer, with its photographs bound to this session's ids and its thumbnail
  // re-derived — an object URL never survives, and a dangling id would paint a
  // card claiming to be complete.
  assert.equal(restore.proposals.length, 1);
  assert.equal(restore.proposals[0].quantity, 2);
  assert.equal(restore.proposals[0].thumbnailURL, "blob:a");
  assert.deepEqual(restore.proposals[0].draft.slotAssignments, { individual: "photo_live_1", team: "photo_live_2" });
  assert.deepEqual(restore.drafts[0].photoIds, ["photo_live_1"]);
  assert.equal(restore.drafts[0].slotTransforms.individual.zoom, 2.5, "framing comes back exactly");
  assert.deepEqual(restore.roleMemory, { individual: "photo_live_1" });
  assert.equal(restore.unlinkedPhotoCount, 0);
});

test("the undo point is recorded once, centrally, and never for a read-only or refused call", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");

  // One capture, at the one point every bridge action passes through, before
  // any branch has run. A snapshot taken inside a handler would already hold
  // half the change it is supposed to undo.
  assert.equal((ui.match(/captureWorkbenchState\(\)/g) ?? []).length, 2, "one definition and one call site");
  assert.match(ui, /const preMutation = isMutatingAgentAction\(request\.action\) && request\.action !== "undo_last_change"/);
  // Recorded only once the response says something changed, so a refused call
  // and a batch that staged nothing leave no empty step to walk back into.
  assert.match(ui, /if \(activity\?\.undoable && preMutation\) \{\s*workbenchHistory\.current\.push\(preMutation\.label, preMutation\.state\);/);

  // Exactly one restore implementation. An undo that grew its own would drift
  // from the reload path that already proves proposal cards come back.
  assert.equal((ui.match(/relinkWorkbenchSnapshot\(/g) ?? []).length, 1, "the only call is inside applyWorkbenchRestore");
  const undo = handler(ui, "undo_last_change", null);
  assert.match(undo, /const undone = undoWorkbenchChange\(requestedSteps\);/);
  assert.match(undo, /undone: undone\.label/, "the description is read off the recorded label");
  // Nothing to undo is said in words, not faked by restoring the same state.
  assert.match(undo, /Nothing has changed in this workbench yet/);
  // The workbench must have repainted before the agent hears back, exactly as
  // it must after a reload restore.
  assert.ok(undo.indexOf("await nextPaint()") < undo.indexOf("respondWithActivity"));
  assert.match(ui, /workbenchSnapshotFromState\(undone\.state\)/);
});

test("every mutating branch announces through the one mapping, and no branch toasts on its own", async () => {
  const ui = await read("src/components/storefront/manual-storefront.tsx");
  // The read-only pair keeps calling the imported responder, so it cannot
  // announce anything by accident; every mutating branch goes through the
  // wrapper that maps action plus result to a line of text.
  assert.equal((ui.match(/respondWithActivity\(/g) ?? []).length, 12, "one definition and eleven mutating call sites");
  const ask = handler(ui, "ask_storefront", "find_prints");
  assert.doesNotMatch(ask, /respondWithActivity/);
  const find = handler(ui, "find_prints", "configure_print");
  assert.doesNotMatch(find, /respondWithActivity/);

  // Wording lives in agent-activity.ts alone. A toast fired from a branch
  // would be a second, drifting catalogue nobody could review in one place.
  assert.equal((ui.match(/\btoast\(/g) ?? []).length, 2, "only announceAgentActivity and the Undo button toast");
  assert.match(ui, /function announceAgentActivity\(activity: AgentActivity\)/);
  // The Undo button is the visible half of the tool, on the same restore path.
  assert.match(ui, /label: "Undo",[\s\S]*?const undone = undoWorkbenchChange\(1\);/);
});

test("the recorded label describes the change, so an undo can be narrated honestly", () => {
  assert.equal(
    agentActionLabel("revise_prints", { draftIds: ["a", "b", "c", "d", "e"] }),
    "revise_prints framing across 5 drafts",
  );
  assert.equal(agentActionLabel("revise_prints", { draft_ids: ["a"] }), "revise_prints framing across 1 draft");
  assert.equal(agentActionLabel("propose_prints", { photo_refs: [1, 2, 3] }), "propose_prints staging 3 prints");
  assert.equal(
    agentActionLabel("configure_print", { slotPatches: [{ label: "individual", operation: "set_crop", zoom: 3 }] }),
    "configure_print the individual zoom to 3.0×",
  );
  assert.equal(agentActionLabel("resolve_cart_proposal", { decision: "accept_all" }), "resolve_cart_proposal accept_all");
  assert.equal(agentActionLabel("manage_cart", { action: "clear" }), "manage_cart clear");
});

// ---------------------------------------------------------------- feature 3

test("update_quantity changes what a standing card asks for without answering it", async () => {
  const source = await read("src/webmcp/tools/storefront.ts");
  const start = source.indexOf('export const resolveCartProposal');
  const resolve = source.slice(start, source.indexOf("export const", start + 10));

  // Changing a question is not answering it. Demanding a quote of the shopper
  // accepting a proposal they have not accepted would invite an invented one,
  // which is the exact failure shopperConfirmation exists to prevent.
  assert.match(resolve, /if \(input\.decision === "update_quantity"\) \{/);
  const branch = resolve.slice(resolve.indexOf('if (input.decision === "update_quantity")'));
  // The branch's own body, stopping where the answering decisions resume.
  const guard = branch.slice(0, branch.indexOf("// The quote is the whole point"));
  assert.doesNotMatch(guard, /shopperConfirmation/, "update_quantity must not demand the shopper's words");
  // It names one card and carries a bounded quantity.
  assert.match(guard, /requireIdentifierAlias\(\s*raw,\s*"proposalId",\s*"proposal_id"/);
  assert.match(guard, /update_quantity requires quantity as a whole number from 1 through 99/);

  const ui = await read("src/components/storefront/manual-storefront.tsx");
  const resolveHandler = handler(ui, "resolve_cart_proposal", "undo_last_change");
  // The card is patched in place, so it keeps its position in the deck and its
  // live preview is never torn down and remounted — only the badge changes.
  assert.match(resolveHandler, /commitProposalStack\(\(entries\) => entries\.map\(\(entry\) =>\s*entry\.proposal\.id === target\.id && !entry\.exit/);
  assert.match(resolveHandler, /proposal: \{ \.\.\.entry\.proposal, quantity: nextQuantity \}/);
  // Nothing enters the cart: the card is still waiting on the shopper.
  const quantityBranch = resolveHandler.slice(
    resolveHandler.indexOf('requestedDecision === "update_quantity"'),
    resolveHandler.indexOf('decision must be accept'),
  );
  assert.doesNotMatch(quantityBranch, /resolveProposals|addDraftToCart|setCart\(/);
  assert.match(quantityBranch, /decision: "quantity_updated"/);
  assert.match(quantityBranch, /nextStep: "await_shopper_decision"/);
  // The badge must have repainted before the agent hears back.
  assert.ok(quantityBranch.indexOf("await nextPaint()") < quantityBranch.indexOf("respondWithActivity"));

  // And the accepted quantity is the new one, because the card carries it.
  const card = await read("src/lib/storefront/local-cart.ts");
  assert.match(card, /quantity: proposal\.quantity/);
});

test("a live quantity change is announced as a change to the question, not an add", () => {
  const activity = agentActivity("resolve_cart_proposal", { decision: "update_quantity", quantity: 2 }, {
    decision: "quantity_updated",
    product_name: "5×7 Print",
    previous_quantity: 1,
    quantity: 2,
    pending_proposal_count: 1,
  });
  assert.equal(activity.message, "Agent set that card to 2 copies");
  assert.equal(activity.detail, "5×7 Print — still waiting on your answer");
});
