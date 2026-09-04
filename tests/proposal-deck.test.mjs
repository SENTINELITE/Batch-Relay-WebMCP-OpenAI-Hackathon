import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PROPOSAL_DECK_COMMIT_THRESHOLD,
  PROPOSAL_DECK_MAX_PREVIEWS,
  adjacentProposalId,
  deckLayerGeometry,
  normalisedPointer,
  proposalPreviewWindow,
  proposalTravelGeometry,
  restoreActiveProposalId,
  shouldCommitWheelProgress,
  wheelProgress,
} from "../src/lib/storefront/proposal-deck.ts";

const ids = Array.from({ length: 37 }, (_, index) => `proposal_${index + 1}`);

test("the deck mounts the active preview and at most two followers, even for 37 proposals", () => {
  assert.deepEqual(proposalPreviewWindow(ids, "proposal_18"), ["proposal_18", "proposal_19", "proposal_20"]);
  assert.equal(proposalPreviewWindow(ids, "proposal_18").length, PROPOSAL_DECK_MAX_PREVIEWS);
  assert.ok(proposalPreviewWindow(ids, "proposal_37").length <= PROPOSAL_DECK_MAX_PREVIEWS);
  assert.ok(proposalPreviewWindow(ids, "proposal_18", ["leaving"]).length <= 4);
  assert.ok(proposalPreviewWindow(["a", "b"], "a", ["leaving-1", "leaving-2", "leaving-3"]).length <= 4);
});

test("selection is restored by id and falls to the nearest surviving proposal when resolved", () => {
  const previous = ["a", "b", "c", "d"];
  assert.equal(restoreActiveProposalId("c", previous, ["a", "b", "c", "d", "e"]), "c");
  assert.equal(restoreActiveProposalId("c", previous, ["a", "b", "d"]), "d");
  assert.equal(restoreActiveProposalId("d", previous, ["a", "b", "c"]), "c");
  assert.equal(restoreActiveProposalId("a", previous, []), null);
});

test("positive travel moves the active card left while its candidate comes from the right", () => {
  const positive = proposalTravelGeometry(0.5);
  const negative = proposalTravelGeometry(-0.5);
  assert.ok(positive.activeX < 0);
  assert.ok(positive.candidateX > 0);
  assert.ok(negative.activeX > 0);
  assert.ok(negative.candidateX < 0);
  assert.ok(positive.candidateScale > 0.96);
});

test("the cards behind the active one fan toward the corner opposite the cursor", () => {
  const upperLeft = normalisedPointer(0, 0, 1000, 800);
  const lowerRight = normalisedPointer(1000, 800, 1000, 800);
  const centre = normalisedPointer(500, 400, 1000, 800);
  assert.deepEqual(upperLeft, { x: -1, y: -1 });
  assert.deepEqual(lowerRight, { x: 1, y: 1 });
  assert.deepEqual(centre, { x: 0, y: 0 });
  // Cursor upper-left → tail lower-right: offset = spread × cursor is positive on both axes.
  const back = deckLayerGeometry(1);
  assert.ok(back.spread.x * upperLeft.x > 0);
  assert.ok(back.spread.y * upperLeft.y > 0);
  assert.ok(back.spread.x * lowerRight.x < 0);
  assert.ok(back.spread.y * lowerRight.y < 0);
  // Deeper cards travel further, and a centred cursor still leaves a visible fan.
  const deeper = deckLayerGeometry(2);
  assert.ok(Math.abs(deeper.spread.x) > Math.abs(back.spread.x));
  assert.ok(Math.abs(back.rest.x) > 0 && Math.abs(back.rest.y) > 0);
  assert.ok(deeper.scale < back.scale && back.scale < 1);
  // The active card leans the other way, toward the cursor, and only slightly.
  const top = deckLayerGeometry(0);
  assert.ok(top.spread.x > 0 && top.spread.x < Math.abs(back.spread.x));
  assert.deepEqual(top.rest, { x: 0, y: 0, rotate: 0 });
  // Cards on the other side of the active one fan the opposite way.
  assert.equal(deckLayerGeometry(1, -1).rest.rotate, -deckLayerGeometry(1, 1).rest.rotate);
});

test("wheel progress commits only after its threshold and resists unavailable edges", () => {
  const justShort = PROPOSAL_DECK_COMMIT_THRESHOLD - 0.01;
  assert.equal(shouldCommitWheelProgress(justShort), false);
  assert.equal(shouldCommitWheelProgress(PROPOSAL_DECK_COMMIT_THRESHOLD), true);
  assert.ok(wheelProgress(0, 80, false, false) < 0.35);
  assert.ok(wheelProgress(0, 80, false, true) > 0.12);
  assert.equal(adjacentProposalId(["a", "b"], "a", -1), null);
  assert.equal(adjacentProposalId(["a", "b"], "b", 1), null);
});

test("the deck owns a native non-passive wheel listener and gates card entry to a new active proposal", async () => {
  const [stack, card] = await Promise.all([
    readFile(new URL("../src/components/storefront/cart-proposal-stack.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/storefront/cart-proposal-card.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(stack, /root\.addEventListener\("wheel", onWheel, \{ passive: false \}\)/);
  assert.doesNotMatch(stack, /\bonWheel=\{onWheel\}/);
  assert.match(stack, /seenProposalIds/);
  assert.match(stack, /animateArrival=\{onTop && !exit && arrivalProposalId === proposal\.id && !prefersReducedMotion\}/);
  assert.match(card, /animateArrival \? "animate-proposal-in/);
});

/**
 * A model of the deck's own bookkeeping, driven exactly as the component drives
 * it: proposals are appended newest-last and the deck reads them newest-first,
 * a resolved card is marked `exit` immediately and removed when its animation
 * ends, and the selection is restored by id on every change.
 */
function deck() {
  let entries = [];
  let activeId = null;
  let previousPending = [];
  const pendingIds = () => entries.filter((entry) => !entry.exit).map((entry) => entry.proposal).reverse();
  const settle = () => {
    const pending = pendingIds();
    activeId = restoreActiveProposalId(activeId, previousPending, pending);
    previousPending = pending;
  };
  return {
    stage(count, prefix) {
      for (let index = 0; index < count; index += 1) entries.push({ proposal: `${prefix}_${index}`, exit: null });
      settle();
    },
    /** What the shopper can actually see and reach right now. */
    mounted() {
      const pending = pendingIds();
      const exiting = entries.filter((entry) => entry.exit).map((entry) => entry.proposal);
      return proposalPreviewWindow(proposalPreviewWindow(pending, activeId), activeId, exiting);
    },
    top: () => activeId,
    pendingCount: () => pendingIds().length,
    resolve(ids) {
      const answered = new Set(ids);
      entries = entries.map((entry) => answered.has(entry.proposal) && !entry.exit ? { ...entry, exit: "reject" } : entry);
      settle();
      // The exit timer, which is the only thing that drops an entry for good.
      entries = entries.filter((entry) => !answered.has(entry.proposal));
      settle();
    },
    orphans: () => entries.length,
  };
}

test("a twenty-card batch drains to exactly zero, one card at a time, with no orphan left behind", () => {
  const stack = deck();
  stack.stage(20, "batch");
  assert.equal(stack.pendingCount(), 20);

  let answered = 0;
  while (stack.pendingCount() > 0) {
    const top = stack.top();
    // The invariant the shopper depends on: while anything is pending there is
    // always a card on top to answer, and it is one of the mounted cards.
    assert.ok(top, "a pending deck must always have a card on top");
    assert.ok(stack.mounted().includes(top), "the top card must be mounted");
    stack.resolve([top]);
    answered += 1;
    assert.ok(answered <= 20, "the deck must not outlive its own proposals");
  }

  assert.equal(stack.pendingCount(), 0);
  assert.equal(stack.orphans(), 0, "no entry may survive its own resolution");
  assert.equal(stack.top(), null);
  assert.deepEqual(stack.mounted(), []);
  assert.equal(answered, 20);
});

test("the deck keeps a full stack drawn while a long batch is answered from the back", () => {
  const stack = deck();
  stack.stage(20, "batch");
  // Reaching only forward from the active card collapsed the deck to a single
  // card as soon as the shopper reached the last of them, hiding the fact that
  // a dozen proposals were still waiting behind it.
  const twenty = Array.from({ length: 20 }, (_, index) => `batch_${index}`);
  // Including when the active card is the very last one in the deck.
  assert.equal(proposalPreviewWindow(twenty, "batch_19").length, PROPOSAL_DECK_MAX_PREVIEWS);
  assert.equal(proposalPreviewWindow(twenty, "batch_18").length, PROPOSAL_DECK_MAX_PREVIEWS);
  assert.ok(proposalPreviewWindow(twenty, "batch_19").includes("batch_19"));
  while (stack.pendingCount() > PROPOSAL_DECK_MAX_PREVIEWS) {
    assert.equal(stack.mounted().length, PROPOSAL_DECK_MAX_PREVIEWS, `three cards must stay drawn with ${stack.pendingCount()} pending`);
    stack.resolve([stack.top()]);
  }
  assert.equal(stack.pendingCount(), PROPOSAL_DECK_MAX_PREVIEWS);
});

test("answering the whole stack at once clears it completely, including cards past the visible depth", () => {
  const stack = deck();
  stack.stage(20, "bulk");
  const everything = [];
  for (let index = 0; index < 20; index += 1) everything.push(`bulk_${index}`);

  // reject_all is the safety escape: it answers every pending card, not only
  // the three the deck happened to have mounted.
  stack.resolve(everything);
  assert.equal(stack.pendingCount(), 0);
  assert.equal(stack.orphans(), 0);
  assert.equal(stack.top(), null);
  assert.deepEqual(stack.mounted(), []);
});

test("a batch staged behind a card the shopper is holding leaves every card reachable", () => {
  const stack = deck();
  stack.stage(2, "first");
  const held = stack.top();
  // A second batch arrives while the shopper is looking at a card. Their card
  // is kept by id, so the new cards land in front of it.
  stack.stage(18, "second");
  assert.equal(stack.top(), held, "staging must not replace the card being reviewed");
  assert.equal(stack.pendingCount(), 20);

  // Every one of the twenty must still be answerable: drain and count.
  let answered = 0;
  while (stack.pendingCount() > 0) {
    stack.resolve([stack.top()]);
    answered += 1;
    assert.ok(answered <= 20);
  }
  assert.equal(answered, 20, "every staged proposal must be reachable and answerable");
  assert.equal(stack.orphans(), 0);
});
