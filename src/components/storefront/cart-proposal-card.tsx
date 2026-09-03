"use client";

/* eslint-disable @next/next/no-img-element -- local object URLs are browser-only preview state. */

import type { ReactNode } from "react";

import { Button, Chip, PrintFrame } from "@/components/ui";
import { directCropFocus } from "@/lib/storefront/print-drafts";
import type { CartProposal } from "@/lib/storefront/local-cart";
import { printReviewSummary, type PrintReview } from "@/lib/storefront/print-review";

export type CartProposalCardProps = {
  proposal: CartProposal;
  /** CSS aspect-ratio for the direct-print window, e.g. "4 / 5". */
  aspect: string;
  /** Live client-side template preview, when the draft uses a template. */
  templatePreview: ReactNode | null;
  /** Geometry-only verdict for the proposed draft: resolution, zoom, trim, aspect. */
  review: PrintReview;
  /** True when this draft was made in the draft rail, never on the shopper's screen. */
  foundInCatalog: boolean;
  /** 0 for the card on top of the deck, 1 and 2 for the ones peeking behind it. */
  depth: number;
  /** Proposals waiting beyond the visible depth, shown as a count on the deck. */
  moreCount: number;
  /** Set once the shopper has answered, while the card animates away. */
  exit: "accept" | "reject" | null;
  onAccept: () => void;
  onReject: () => void;
};

const exitAnimation: Record<"accept" | "reject", string> = {
  // Toward the masthead cart chip, after a beat of affirmation.
  accept: "animate-proposal-accept",
  reject: "animate-proposal-reject",
};

/**
 * One floating picture-in-picture proposal, a card in the bottom-left deck.
 *
 * Every card is the same width so the deck has a stable footprint whichever
 * proposal is on top; the cards behind are scaled and dimmed by the stack, and
 * only the top one is interactive. Each proposes exactly one draft for the demo
 * cart and stays until the shopper, or the agent relaying their words, answers.
 */
export function CartProposalCard({
  proposal,
  aspect,
  templatePreview,
  review,
  foundInCatalog,
  depth,
  moreCount,
  exit,
  onAccept,
  onReject,
}: CartProposalCardProps) {
  const needsReview = review.verdict === "needs_review";
  const focus = directCropFocus(proposal.draft.directCrop);
  const onTop = depth === 0;
  // The exit plays on the card itself, inside the stack's depth transform, so a
  // resolved card can fly out while the one behind it scales up into its place.
  const motion = exit
    ? `${exitAnimation[exit]} motion-reduce:animate-none motion-reduce:opacity-0`
    : "animate-proposal-in motion-reduce:animate-none";

  const thumbnail = <PrintFrame aspect={aspect}>
    {proposal.thumbnailURL
      ? <img
        alt={`Preview of ${proposal.productName}`}
        className="block h-full w-full object-cover"
        draggable={false}
        src={proposal.thumbnailURL}
        style={{
          objectPosition: `${focus.focusX}% ${focus.focusY}%`,
          transform: `scale(${proposal.draft.directCrop.zoom})`,
        }}
      />
      : <span aria-hidden className="block h-full w-full bg-surface-warm" />}
  </PrintFrame>;

  return (
    <aside
      aria-label="Cart proposal"
      className={`${motion} relative flex w-full flex-col gap-3 rounded-[18px] border border-border-strong bg-card p-4 shadow-warm`}
      role="dialog"
    >
      {onTop && moreCount > 0 ? (
        <span
          aria-hidden
          className="absolute -right-2 -top-2 rounded-full border border-border-strong bg-surface-warm px-2 py-0.5 font-mono text-[11px] leading-tight text-muted-foreground shadow-warm"
        >
          +{moreCount} more
        </span>
      ) : null}

      <b className="block text-[15px] font-semibold leading-tight">{proposal.productName}</b>

      {/* This print was found in the catalog and made behind the screen — the
          shopper never chose it in the format picker, so the card says so. */}
      {foundInCatalog ? (
        <Chip className="self-start" tone="info">
          Found in catalog · {proposal.productName}
        </Chip>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        {/* The verdict is a reason to look, never a block: both cards can still
            be accepted, and only the shopper does that. */}
        <Chip tone={needsReview ? "warning" : "success"}>
          {needsReview ? "⚠ Needs review" : "✓ Ready"}
        </Chip>
        <span className="font-mono text-[13px] text-muted-foreground">
          Qty {proposal.quantity}
        </span>
      </div>

      {needsReview ? (
        <p className="text-[13px] leading-snug text-status-warning">
          {printReviewSummary(review)}
        </p>
      ) : null}

      <div className="overflow-hidden">
        {templatePreview ? (
          <div className="pointer-events-none [&_section]:border-0 [&_section]:bg-transparent [&_section]:p-0">
            {templatePreview}
          </div>
        ) : thumbnail}
      </div>

      <div className="flex gap-2">
        <Button className="flex-1" disabled={Boolean(exit) || !onTop} onClick={onAccept}>
          Add to cart
        </Button>
        <Button className="flex-1" disabled={Boolean(exit) || !onTop} onClick={onReject} variant="secondary">
          Don&apos;t add
        </Button>
      </div>
    </aside>
  );
}
