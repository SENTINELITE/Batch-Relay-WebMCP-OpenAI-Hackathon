import assert from "node:assert/strict";
import test from "node:test";

import {
  SHOPPER_VIEW_SETTLE_MS,
  agentDraftPlacement,
  emptyShopperViewContext,
  isShopperVisibleDraft,
  shopperViewContext,
} from "../src/lib/storefront/shopper-view.ts";

const t0 = 1_700_000_000_000;

test("a draft the shopper selected themselves is visible immediately", () => {
  const context = shopperViewContext("draft_memory_mate", "shopper", t0);
  assert.equal(isShopperVisibleDraft(context, "draft_memory_mate", t0), true);
  assert.equal(isShopperVisibleDraft(context, "draft_memory_mate", t0 + 500), true);
});

test("a draft an agent just created is not yet the draft the shopper is watching", () => {
  // configure_print selects the draft it creates, so an agent that makes a 5x7
  // for an off-screen request and adds it in the same breath looks, by selection
  // alone, exactly like a shopper adding the print in front of them.
  const context = shopperViewContext("draft_5x7", "agent", t0);
  assert.equal(isShopperVisibleDraft(context, "draft_5x7", t0 + 1_500), false);
  assert.equal(isShopperVisibleDraft(context, "draft_5x7", t0 + SHOPPER_VIEW_SETTLE_MS - 1), false);
});

test("an agent-selected draft becomes the watched one once it has held the screen", () => {
  const context = shopperViewContext("draft_memory_mate", "agent", t0);
  assert.equal(isShopperVisibleDraft(context, "draft_memory_mate", t0 + SHOPPER_VIEW_SETTLE_MS), true);
  assert.equal(isShopperVisibleDraft(context, "draft_memory_mate", t0 + 60_000), true);
});

test("any other draft is never the one the shopper is watching", () => {
  const watched = shopperViewContext("draft_memory_mate", "shopper", t0);
  assert.equal(isShopperVisibleDraft(watched, "draft_5x7", t0 + 60_000), false);
  assert.equal(isShopperVisibleDraft(watched, null, t0 + 60_000), false);
  assert.equal(isShopperVisibleDraft(emptyShopperViewContext, "draft_5x7", t0), false);
});

test("the settle window is longer than an agent's own tool chain", () => {
  // Two tool calls with no human between them land seconds apart; a shopper
  // watching a preview, reacting, and being transcribed does not.
  assert.ok(SHOPPER_VIEW_SETTLE_MS >= 5_000, "settle window must outlast a configure_print → add_to_cart chain");
});

test("a new agent draft does not take the screen from a shopper customizing one by hand", () => {
  // The reported bug: the shopper is on the 8x10 memory mate, editing it
  // themselves, and says "add a 5x7 of image 6". The 5x7 belongs in the draft
  // rail; the proposal card is the whole experience for that off-screen print.
  const handsOn = shopperViewContext("draft_memory_mate", "shopper", t0);
  assert.equal(agentDraftPlacement(handsOn, "draft_memory_mate", "draft_5x7"), "draft_rail");
});

test("an agent draft still takes the screen when the shopper is not holding one", () => {
  // Nothing selected: there is no work to interrupt.
  assert.equal(agentDraftPlacement(emptyShopperViewContext, null, "draft_5x7"), "on_screen");
  // The selected draft is one the agent placed and the shopper never touched —
  // the agent-driven flow where following along is the point.
  const agentPlaced = shopperViewContext("draft_memory_mate", "agent", t0);
  assert.equal(agentDraftPlacement(agentPlaced, "draft_memory_mate", "draft_8x10"), "on_screen");
  // Even long after it settled, an untouched agent selection still yields.
  assert.equal(agentDraftPlacement(agentPlaced, "draft_memory_mate", "draft_8x10"), "on_screen");
});

test("revising the draft already on screen is never a navigation", () => {
  const handsOn = shopperViewContext("draft_memory_mate", "shopper", t0);
  assert.equal(agentDraftPlacement(handsOn, "draft_memory_mate", "draft_memory_mate"), "on_screen");
});

test("a stale shopper context for some other draft does not hold the screen", () => {
  // The context names a draft that is no longer the selection, so nothing the
  // shopper is looking at is being taken away.
  const stale = shopperViewContext("draft_old", "shopper", t0);
  assert.equal(agentDraftPlacement(stale, "draft_memory_mate", "draft_5x7"), "on_screen");
});

test("a background draft composes with add_to_cart's off-screen discriminator", () => {
  // The two rules must agree: a draft placed in the rail was never on screen,
  // so dwell never started for it and add_to_cart takes the proposal path.
  const handsOn = shopperViewContext("draft_memory_mate", "shopper", t0);
  assert.equal(agentDraftPlacement(handsOn, "draft_memory_mate", "draft_5x7"), "draft_rail");
  // The shopper-view context is left untouched by a background placement.
  assert.equal(isShopperVisibleDraft(handsOn, "draft_5x7", t0 + 60_000), false);
  // And the print they are actually holding still direct-adds.
  assert.equal(isShopperVisibleDraft(handsOn, "draft_memory_mate", t0 + 60_000), true);
});
