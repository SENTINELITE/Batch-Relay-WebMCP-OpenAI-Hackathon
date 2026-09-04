import type { PrintDraft } from "./print-drafts";

/**
 * The demo cart lives entirely in this browser tab. Nothing here is uploaded,
 * rendered by a provider, quoted, or ordered.
 */
export type LocalCartItem = {
  id: string;
  draftId: string;
  productId: string;
  productName: string;
  quantity: number;
  /** Object URL for a tray photo already held by the photo library. */
  thumbnailURL: string | null;
  source: "direct" | "template";
  /** Snapshot of the draft at the moment the shopper accepted it. */
  draft: PrintDraft;
  addedAt: string;
};

/** One picture-in-picture proposal awaiting the shopper's accept or reject. */
export type CartProposal = {
  id: string;
  draftId: string;
  productId: string;
  productName: string;
  quantity: number;
  thumbnailURL: string | null;
  source: "direct" | "template";
  draft: PrintDraft;
  createdAt: string;
  /** A shopper-visible follow-up marker. It never answers the proposal. */
  reviewFlagged?: boolean;
};

/**
 * One entry in the bottom-left proposal deck.
 *
 * A resolved proposal is not removed at once: it keeps its place with `exit`
 * set so the card can play its accept or reject animation where it stands,
 * while the card behind it scales up into the top of the deck. Everything that
 * counts proposals — the published capability state, ask_storefront, duplicate
 * detection — reads `pendingCartProposals`, so a card on its way out is already
 * resolved as far as the agent is concerned.
 */
export type CartProposalStackEntry = {
  proposal: CartProposal;
  exit: "accept" | "reject" | null;
};

/**
 * How many cards of the bottom-left deck are drawn: the one on top plus the two
 * peeking out behind it. Anything waiting past that is a count on the top card
 * rather than another live preview mounted where nobody can see it.
 */
export const CART_PROPOSAL_VISIBLE_DEPTH = 3;

/** How long each exit animation runs before its entry leaves the stack. */
export const CART_PROPOSAL_EXIT_MS: Record<"accept" | "reject", number> = {
  // Leave a small buffer after the 380ms/280ms CSS motion completes, so the
  // card behind has scaled into place before the answered card is dropped.
  accept: 400,
  reject: 300,
};

/** The proposals still awaiting the shopper, oldest first. */
export function pendingCartProposals(
  entries: readonly CartProposalStackEntry[],
): CartProposal[] {
  return entries.filter((entry) => !entry.exit).map((entry) => entry.proposal);
}

/**
 * The pending proposal already asking about this draft, if any.
 *
 * Proposing the same draft twice would stack two identical cards asking the
 * same question, so add_to_cart returns the standing one instead.
 */
export function pendingCartProposalForDraft(
  entries: readonly CartProposalStackEntry[],
  draftId: string,
): CartProposal | null {
  return pendingCartProposals(entries).find((proposal) => proposal.draftId === draftId) ?? null;
}

/** The wire shape ask_storefront and the cart tools list proposals in. */
export function cartProposalWireItems(proposals: readonly CartProposal[]) {
  return proposals.map((proposal, index) => ({
    proposal_id: proposal.id,
    draft_id: proposal.draftId,
    product_id: proposal.productId,
    product_name: proposal.productName,
    quantity: proposal.quantity,
    review_flagged: proposal.reviewFlagged === true,
    // Oldest first, so "the first one" and "the last one" mean something.
    position: index + 1,
    created_at: proposal.createdAt,
  }));
}

export type CartProposalOutcome = {
  proposalId: string;
  draftId: string;
  productName: string;
  quantity: number;
  decision: "accepted" | "rejected";
  decidedAt: string;
};

export function createCartProposal(
  fields: Omit<CartProposal, "id" | "createdAt">,
): CartProposal {
  return { ...fields, id: `proposal_${crypto.randomUUID()}`, createdAt: new Date().toISOString() };
}

/** One line entering the demo cart, however the shopper asked for it. */
export function createCartItem(
  fields: Omit<LocalCartItem, "id" | "addedAt">,
): LocalCartItem {
  return { ...fields, id: `item_${crypto.randomUUID()}`, addedAt: new Date().toISOString() };
}

export function cartItemFromProposal(proposal: CartProposal): LocalCartItem {
  return createCartItem({
    draftId: proposal.draftId,
    productId: proposal.productId,
    productName: proposal.productName,
    quantity: proposal.quantity,
    thumbnailURL: proposal.thumbnailURL,
    source: proposal.source,
    draft: proposal.draft,
  });
}

/**
 * A cart line represents the finished print, not the mutable local draft
 * that happened to create it. This leaves an identical re-add as one line
 * with a larger quantity, while a new photograph, crop, slot assignment,
 * text field, or published template output receives its own line.
 */
export function localCartConfigurationKey(item: Pick<LocalCartItem, "productId" | "source" | "draft">): string {
  const { draft } = item;
  const number = (value: number | undefined) => Number.isFinite(value) ? value : 0;
  const entries = <T>(value: Record<string, T>) => Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right));

  if (item.source === "direct") {
    return JSON.stringify({
      productId: item.productId,
      productRevision: draft.productRevision,
      source: item.source,
      photoId: draft.photoIds[0] ?? null,
      crop: {
        zoom: number(draft.directCrop.zoom),
        focusX: number(draft.directCrop.focusX),
        focusY: number(draft.directCrop.focusY),
        offsetX: number(draft.directCrop.offsetX),
        offsetY: number(draft.directCrop.offsetY),
      },
    });
  }

  return JSON.stringify({
    productId: item.productId,
    productRevision: draft.productRevision,
    source: item.source,
    template: draft.template
      ? { id: draft.template.id, outputId: draft.template.outputId, revisionId: draft.template.revisionId }
      : null,
    assignments: entries(draft.slotAssignments),
    textValues: entries(draft.textValues),
    slotTransforms: entries(draft.slotTransforms).map(([slotKey, transform]) => [
      slotKey,
      {
        zoom: number(transform.zoom),
        offsetX: number(transform.offsetX),
        offsetY: number(transform.offsetY),
      },
    ]),
  });
}

export type LocalCartMerge = { items: LocalCartItem[]; line: LocalCartItem };

/**
 * A finished template often carries a human-readable print name, while the
 * product name alone is repeated across every cart row. Prefer that value for
 * display only; the canonical product name remains on the cart/tool wire.
 */
export function cartItemDisplayName(item: Pick<LocalCartItem, "productName" | "draft">): string {
  const values = Object.values(item.draft.textValues)
    .map((value) => value.trim())
    // Jersey numbers and years are useful artwork inputs, not a person's name.
    .filter((value) => value.length > 0 && value.length <= 80 && /[^\d\s]/.test(value));
  const printName = values[0];
  return printName ? `${printName}’s ${item.productName}` : item.productName;
}

/** Adds a finished-print snapshot, increasing quantity only when it is exact. */
export function mergeLocalCartItem(items: readonly LocalCartItem[], incoming: LocalCartItem): LocalCartMerge {
  const key = localCartConfigurationKey(incoming);
  const existing = items.find((item) => localCartConfigurationKey(item) === key);
  if (!existing) return { items: [...items, incoming], line: incoming };
  // An exact re-add is still the shopper's latest cart action. Preserve the
  // original line identity, but refresh this timestamp so "most recent" means
  // what they last put in the cart, including a merged quantity increase.
  const line = { ...existing, quantity: existing.quantity + incoming.quantity, addedAt: incoming.addedAt };
  return {
    items: items.map((item) => item.id === existing.id ? line : item),
    line,
  };
}

export function cartProposalOutcome(
  proposal: CartProposal,
  decision: CartProposalOutcome["decision"],
): CartProposalOutcome {
  return {
    proposalId: proposal.id,
    draftId: proposal.draftId,
    productName: proposal.productName,
    quantity: proposal.quantity,
    decision,
    decidedAt: new Date().toISOString(),
  };
}

/** Total prints in the demo cart, counting quantities. */
export function localCartPrintCount(items: readonly LocalCartItem[]): number {
  return items.reduce((total, item) => total + item.quantity, 0);
}

/** The line affected by a shopper request such as "change the most recent one." */
export function mostRecentLocalCartItem(items: readonly LocalCartItem[]): LocalCartItem | null {
  return items.reduce<LocalCartItem | null>((latest, item) =>
    !latest || item.addedAt >= latest.addedAt ? item : latest, null);
}

/** The wire shape both manage_cart and resolve_cart_proposal return. */
export function localCartWireItems(items: readonly LocalCartItem[]) {
  return items.map((item, index) => ({
    item_id: item.id,
    draft_id: item.draftId,
    product_id: item.productId,
    product_name: item.productName,
    quantity: item.quantity,
    source: item.source,
    position: index + 1,
    added_at: item.addedAt,
  }));
}
