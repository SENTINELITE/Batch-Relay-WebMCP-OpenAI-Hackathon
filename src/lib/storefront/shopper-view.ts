/**
 * Which print draft the shopper is actually looking at.
 *
 * `add_to_cart` behaves differently depending on the answer: adding the draft
 * whose live preview already fills the prepare step needs no confirmation card,
 * because that preview *was* the pre-visualization. Adding any other draft — a
 * print the shopper has not seen — still goes through the picture-in-picture
 * proposal.
 *
 * The selected draft ID alone cannot answer this, because `configure_print`
 * selects the draft it creates: an agent that creates a 5x7 for an off-screen
 * request and adds it in the same breath would look, by selection alone, like a
 * shopper adding the print in front of them. So the context also records who
 * put the draft on screen and when. A shopper's own selection counts at once; a
 * draft an agent just created counts only once it has held the screen long
 * enough for the shopper to have seen it and spoken about it.
 *
 * The uncertain case fails toward the proposal card: a wrongly withheld direct
 * add costs one extra confirmation, while a wrongly granted one puts a print
 * the shopper never saw into the cart silently.
 */
export type ShopperViewContext = {
  /** The draft whose preview occupies the visible prepare step. */
  draftId: string | null;
  /** Epoch milliseconds when this draft became the visible selection. */
  since: number;
  /** Who selected it. A shopper's own selection is visible immediately. */
  origin: "shopper" | "agent";
};

/**
 * How long an agent-selected draft must hold the screen before adding it counts
 * as adding the print the shopper is looking at. It is longer than an agent's
 * own configure_print → add_to_cart chain (a second or two, no human in it) and
 * shorter than a shopper watching a preview land, reacting to it, and being
 * transcribed back into a tool call.
 */
export const SHOPPER_VIEW_SETTLE_MS = 8_000;

export const emptyShopperViewContext: ShopperViewContext = {
  draftId: null,
  since: 0,
  origin: "shopper",
};

export function shopperViewContext(
  draftId: string | null,
  origin: ShopperViewContext["origin"],
  now: number,
): ShopperViewContext {
  return { draftId, since: now, origin };
}

/**
 * True when `draftId` is the draft the shopper has in front of them, so adding
 * it needs no proposal card.
 */
export function isShopperVisibleDraft(
  context: ShopperViewContext,
  draftId: string | null,
  now: number,
): boolean {
  if (!draftId || context.draftId !== draftId) return false;
  if (context.origin === "shopper") return true;
  return now - context.since >= SHOPPER_VIEW_SETTLE_MS;
}

/**
 * Where a draft an agent just configured belongs: filling the workbench, or
 * waiting in the draft rail while the workbench keeps showing what it shows.
 */
export type DraftPlacement = "on_screen" | "draft_rail";

/**
 * Whether `configure_print` may swing the workbench to the draft it just
 * touched.
 *
 * A shopper hand-customizing a memory mate who says "add a 5x7 of image 6" is
 * asking for a second print, not for their work to be taken off the screen. The
 * proposal card is the whole experience for that off-screen print, so the draft
 * is made in the rail and the workbench does not move.
 *
 * The screen still moves in the two cases where nothing is being taken away:
 * when the agent is revising the draft that is already on screen, and when the
 * shopper has no draft of their own in front of them — either nothing is
 * selected yet, or the selected draft is one the agent placed and the shopper
 * has not touched, which is the agent-driven flow where following along is the
 * point.
 */
export function agentDraftPlacement(
  context: ShopperViewContext,
  selectedDraftId: string | null,
  draftId: string,
): DraftPlacement {
  // Revising the draft on screen edits it in place; that is not a navigation.
  if (selectedDraftId === draftId) return "on_screen";
  if (!selectedDraftId) return "on_screen";
  // Only a hands-on interaction with the selected draft claims the screen. An
  // agent-placed selection the shopper never touched yields it.
  const shopperIsHandsOn = context.draftId === selectedDraftId && context.origin === "shopper";
  return shopperIsHandsOn ? "draft_rail" : "on_screen";
}
