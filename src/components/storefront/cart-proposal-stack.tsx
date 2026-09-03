"use client";

import type { CSSProperties, ReactNode } from "react";

import { CartProposalCard } from "@/components/storefront/cart-proposal-card";
import {
  CART_PROPOSAL_VISIBLE_DEPTH,
  type CartProposal,
  type CartProposalStackEntry,
} from "@/lib/storefront/local-cart";

export type CartProposalStackProps = {
  entries: readonly CartProposalStackEntry[];
  /** Aspect ratio and live template preview for one proposed draft. */
  previewFor: (proposal: CartProposal) => { aspect: string; templatePreview: ReactNode | null };
  onAccept: (proposal: CartProposal) => void;
  onReject: (proposal: CartProposal) => void;
};

/**
 * Geometry of one layer of the deck, by depth: 0 is the card on top.
 *
 * The scale is taken about the card's bottom-left corner, so a card behind
 * loses `depth * 5%` of its own height off the top. Translating by that same
 * percentage puts its top edge back where the top card's is, and the extra
 * pixels are what peeks out — a constant 12px step per layer whatever the card
 * happens to be tall, which varies with the print's aspect ratio.
 */
const PEEK_PX = 12;
const SCALE_STEP = 0.05;

function layerStyle(depth: number): CSSProperties {
  if (depth === 0) return { transform: "none", opacity: 1, zIndex: 100 };
  const scale = 1 - SCALE_STEP * depth;
  return {
    transform: `translate(${-4 * depth}px, calc(${-SCALE_STEP * depth * 100}% - ${PEEK_PX * depth}px)) scale(${scale})`,
    opacity: 1 - 0.2 * depth,
    zIndex: 100 - depth,
  };
}

/**
 * The picture-in-picture proposals, dealt as a deck in the bottom-left corner.
 *
 * The cards overlap in one spot rather than running up the left edge as a
 * column: the newest is on top at full size and is the only one the shopper can
 * click or tab into, and the ones already waiting sit behind it, each a little
 * smaller and a little higher so the depth of the stack is visible at a glance.
 * The deck's footprint is therefore one card plus a few pixels of peek, however
 * many proposals are waiting; past three, the rest are a count on the top card.
 *
 * Answering the top card pops it — it flies toward the cart chip, or slides
 * back out to the left — while the card behind scales up into its place. A card
 * resolved from the middle of the deck by `resolve_cart_proposal` fades where it
 * stands and the deck closes up over it.
 *
 * Each card's preview is bound to its own proposed draft, never to the
 * workbench: a proposal exists precisely because that print is *not* the one on
 * screen, so nothing here may depend on it being the selected draft.
 */
export function CartProposalStack({ entries, previewFor, onAccept, onReject }: CartProposalStackProps) {
  // Depth is counted over the proposals still waiting, so the card behind is
  // promoted the moment the top one is answered and rises while it leaves,
  // rather than waiting for its exit animation to finish.
  const pendingIds = entries.filter((entry) => !entry.exit).map((entry) => entry.proposal.id);
  const pendingCount = pendingIds.length;
  const moreCount = Math.max(0, pendingCount - CART_PROPOSAL_VISIBLE_DEPTH);

  return (
    <div className="pointer-events-none fixed bottom-5 left-5 z-50 w-[min(92vw,300px)]">
      <p aria-live="polite" className="sr-only">
        {pendingCount === 0
          ? "No cart proposals waiting."
          : `${pendingCount} cart ${pendingCount === 1 ? "proposal" : "proposals"} waiting for you.`}
      </p>

      {entries.map((entry, index) => {
        const { proposal, exit } = entry;
        // An answered card keeps the depth it had, counted over the whole deck,
        // so it plays its exit where it stood instead of jumping to the front.
        const depth = exit
          ? entries.length - 1 - index
          : pendingCount - 1 - pendingIds.indexOf(proposal.id);
        // Deeper cards are never seen, so their live previews are not mounted.
        if (depth >= CART_PROPOSAL_VISIBLE_DEPTH) return null;
        const onTop = depth === 0;
        const { aspect, templatePreview } = previewFor(proposal);

        return (
          <div
            // Every card is dealt onto the same spot, anchored to the corner, so
            // the deck cannot grow down the screen as proposals arrive. The
            // depth transform lives out here and transitions, while the card
            // inside plays its own arrival or exit animation.
            className={`absolute bottom-0 left-0 w-full origin-bottom-left transition-[transform,opacity] duration-300 ease-[var(--ease-out-expo)] motion-reduce:transition-none ${onTop && !exit ? "pointer-events-auto" : "pointer-events-none"}`}
            data-proposal-card
            data-proposal-depth={depth}
            inert={!onTop || Boolean(exit)}
            key={proposal.id}
            style={exit
              ? onTop
                // The card leaving the top flies clear of the deck.
                ? { ...layerStyle(depth), zIndex: 200 }
                // One resolved out of the middle just goes.
                : { ...layerStyle(depth), opacity: 0 }
              : layerStyle(depth)}
          >
            <CartProposalCard
              aspect={aspect}
              depth={depth}
              exit={exit}
              moreCount={moreCount}
              onAccept={() => onAccept(proposal)}
              onReject={() => onReject(proposal)}
              proposal={proposal}
              templatePreview={templatePreview}
            />
          </div>
        );
      })}
    </div>
  );
}
