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
};

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

export function cartItemFromProposal(proposal: CartProposal): LocalCartItem {
  return {
    id: `item_${crypto.randomUUID()}`,
    draftId: proposal.draftId,
    productId: proposal.productId,
    productName: proposal.productName,
    quantity: proposal.quantity,
    thumbnailURL: proposal.thumbnailURL,
    source: proposal.source,
    draft: proposal.draft,
    addedAt: new Date().toISOString(),
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

/** The wire shape both manage_cart and resolve_cart_proposal return. */
export function localCartWireItems(items: readonly LocalCartItem[]) {
  return items.map((item) => ({
    item_id: item.id,
    draft_id: item.draftId,
    product_id: item.productId,
    product_name: item.productName,
    quantity: item.quantity,
    source: item.source,
  }));
}
