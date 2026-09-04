"use client";

/* eslint-disable @next/next/no-img-element -- local object URLs are browser-only preview state. */

import { useId, useState, type ReactNode } from "react";

import { Button, PrintFrame } from "@/components/ui";
import { initialBrowserPreviewTransform } from "@/lib/storefront/browser-preview";
import { directCropFocus, slotTransformFromCropPatch, type PrintDraft } from "@/lib/storefront/print-drafts";
import { cartItemDisplayName, type CartProposal } from "@/lib/storefront/local-cart";
import { printReviewSummary, type PrintReview } from "@/lib/storefront/print-review";

export type CartProposalCardProps = {
  proposal: CartProposal;
  /** CSS aspect-ratio for the direct-print window, e.g. "4 / 5". */
  aspect: string;
  /** Live client-side template preview, when the draft uses a template. */
  templatePreview: ReactNode | null;
  /** Geometry-only verdict for the proposed draft: resolution, zoom, trim, aspect. */
  review: PrintReview;
  /** 0 for the card on top of the deck, 1 and 2 for the ones peeking behind it. */
  depth: number;
  /** Proposals waiting beyond the visible depth, shown as a count on the deck. */
  moreCount: number;
  /** Set once the shopper has answered, while the card animates away. */
  exit: "accept" | "reject" | null;
  /** True only for a newly dealt active card, never a browsing remount. */
  animateArrival: boolean;
  /** The active proposal's committed position in the deck. */
  position: number;
  /** Total proposals awaiting the shopper. */
  total: number;
  onAccept: () => void;
  onReject: () => void;
  onToggleFlag: () => void;
};

const exitAnimation: Record<"accept" | "reject", string> = {
  // Toward the masthead cart chip, after a beat of affirmation.
  accept: "animate-proposal-accept",
  reject: "animate-proposal-reject",
};

function ratioFromCSSAspect(aspect: string): number {
  const [width, height] = aspect.split("/").map(Number);
  return Number.isFinite(width) && Number.isFinite(height) && height > 0 ? width / height : 4 / 5;
}

/** The direct-print crop, using the same source-relative translation as the crop contract. */
function DirectProposalThumbnail({ aspect, draft, productName, source }: {
  aspect: string;
  draft: PrintDraft;
  productName: string;
  source: string;
}) {
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null);
  const targetAspectRatio = ratioFromCSSAspect(aspect);
  const focus = directCropFocus(draft.directCrop);
  const sourceAspectRatio = sourceSize ? sourceSize.width / sourceSize.height : null;
  const transform = slotTransformFromCropPatch(
    initialBrowserPreviewTransform,
    { zoom: draft.directCrop.zoom, focusX: focus.focusX, focusY: focus.focusY },
    { sourceAspectRatio, targetAspectRatio },
  );
  const coveredWidth = sourceAspectRatio && sourceAspectRatio > targetAspectRatio ? sourceAspectRatio / targetAspectRatio : 1;
  const coveredHeight = sourceAspectRatio && sourceAspectRatio <= targetAspectRatio ? targetAspectRatio / sourceAspectRatio : 1;

  return <PrintFrame aspect={aspect} innerClassName="relative">
    <img
      alt={`Preview of ${productName}`}
      className="absolute block max-w-none select-none"
      draggable={false}
      onLoad={(event) => {
        const { naturalHeight: height, naturalWidth: width } = event.currentTarget;
        if (width > 0 && height > 0) setSourceSize((current) => current?.width === width && current.height === height ? current : { width, height });
      }}
      src={source}
      style={{
        height: `${coveredHeight * transform.zoom * 100}%`,
        left: "50%",
        objectFit: "fill",
        top: "50%",
        transform: `translate(-50%, -50%) translate(${transform.offsetX}%, ${transform.offsetY}%)`,
        transformOrigin: "center",
        width: `${coveredWidth * transform.zoom * 100}%`,
      }}
    />
  </PrintFrame>;
}

/**
 * One floating picture-in-picture proposal in the cursor-responsive deck.
 *
 * Every card is the same width so the deck has a stable footprint whichever
 * proposal is on top; the cards behind are scaled and dimmed by the stack, and
 * only the top one is interactive. A review pill opens the specific concern and
 * lets a shopper flag it without treating a caution as a rejection.
 */
export function CartProposalCard({
  proposal,
  aspect,
  templatePreview,
  review,
  depth,
  moreCount,
  exit,
  animateArrival,
  position,
  total,
  onAccept,
  onReject,
  onToggleFlag,
}: CartProposalCardProps) {
  const needsReview = review.verdict === "needs_review";
  const onTop = depth === 0;
  const [reviewOpen, setReviewOpen] = useState(false);
  const reviewPanelId = useId();
  // The exit plays on the card itself, inside the stack's depth transform, so a
  // resolved card can fly out while the one behind it scales up into its place.
  const motion = exit
    ? `${exitAnimation[exit]} motion-reduce:animate-none motion-reduce:opacity-0`
    : animateArrival ? "animate-proposal-in motion-reduce:animate-none" : "";

  const thumbnail = proposal.thumbnailURL
    ? <DirectProposalThumbnail aspect={aspect} draft={proposal.draft} productName={proposal.productName} source={proposal.thumbnailURL} />
    : <PrintFrame aspect={aspect}><span aria-hidden className="block h-full w-full bg-surface-warm" /></PrintFrame>;
  const displayName = cartItemDisplayName(proposal);

  return (
    <aside
      aria-label={`Cart proposal ${position} of ${total}`}
      className={`${motion} relative flex w-full flex-col gap-3 rounded-[18px] border border-border-strong bg-card p-3 shadow-warm`}
      role="region"
    >
      {onTop && moreCount > 0 ? (
        <span
          aria-hidden
          className="absolute -right-2 -top-2 rounded-full border border-border-strong bg-surface-warm px-2 py-0.5 font-mono text-[11px] leading-tight text-muted-foreground shadow-warm"
        >
          +{moreCount} more
        </span>
      ) : null}

      <header className="flex items-start justify-between gap-3">
        <div>
          <b className="block text-[15px] font-semibold leading-tight">{displayName}</b>
          <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
            {position} / {total} · Qty {proposal.quantity}
          </span>
        </div>
        {needsReview ? (
          <button
            aria-controls={reviewPanelId}
            aria-expanded={reviewOpen}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-status-warning-surface px-3 text-[13px] font-semibold text-status-warning transition-colors hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
            onClick={() => setReviewOpen((open) => !open)}
            type="button"
          >
            Needs review <span aria-hidden className="font-normal">{reviewOpen ? "−" : "→"}</span>
          </button>
        ) : (
          <span className="pt-0.5 text-[13px] font-medium text-status-success">Ready</span>
        )}
      </header>

      <div className="overflow-hidden">
        {templatePreview ? (
          <div className="pointer-events-none [&_section]:border-0 [&_section]:bg-transparent [&_section]:p-0">
            {templatePreview}
          </div>
        ) : thumbnail}
      </div>

      {needsReview && reviewOpen ? (
        <section
          aria-label="Print review"
          className="rounded-[14px] border border-status-warning/30 bg-status-warning-surface/60 p-3"
          id={reviewPanelId}
        >
          <p className="text-[13px] leading-snug text-status-warning">
            {printReviewSummary(review)}
          </p>
          <Button
            aria-pressed={proposal.reviewFlagged === true}
            className="mt-2 h-8 px-3 text-[12px]"
            onClick={onToggleFlag}
            variant="ghost"
          >
            {proposal.reviewFlagged ? "Flagged for follow-up" : "Flag for follow-up"}
          </Button>
        </section>
      ) : null}

      <div className="flex gap-2">
        <Button
          className="flex-1 whitespace-nowrap"
          data-proposal-primary-action={onTop ? "true" : undefined}
          disabled={Boolean(exit) || !onTop}
          onClick={onAccept}
        >
          {needsReview ? "Add anyway" : "Add to cart"}
        </Button>
        <Button className="flex-1" disabled={Boolean(exit) || !onTop} onClick={onReject} variant="secondary">
          Skip
        </Button>
      </div>
    </aside>
  );
}
