"use client";

/* eslint-disable @next/next/no-img-element -- local object URLs are browser-only preview state. */

import type { ReactNode } from "react";

import { Button, Chip, PrintFrame } from "@/components/ui";
import { directCropFocus } from "@/lib/storefront/print-drafts";
import type { CartProposal } from "@/lib/storefront/local-cart";

export type CartProposalCardProps = {
  proposal: CartProposal;
  /** CSS aspect-ratio for the direct-print window, e.g. "4 / 5". */
  aspect: string;
  /** Live client-side template preview, when the draft uses a template. */
  templatePreview: ReactNode | null;
  onAccept: () => void;
  onReject: () => void;
};

/**
 * Floating picture-in-picture card. It proposes exactly one draft for the demo
 * cart and stays visible until the shopper, or the agent on their behalf,
 * accepts or rejects it.
 */
export function CartProposalCard({
  proposal,
  aspect,
  templatePreview,
  onAccept,
  onReject,
}: CartProposalCardProps) {
  const focus = directCropFocus(proposal.draft.directCrop);

  return (
    <aside
      aria-label="Cart proposal"
      className="flex flex-col gap-3 rounded-[18px] border border-border-strong bg-card p-4 shadow-warm"
      role="dialog"
    >
      <div className="flex items-center justify-between gap-2">
        <Chip tone="warning">Preview</Chip>
        <span className="font-mono text-[13px] text-muted-foreground">
          Qty {proposal.quantity}
        </span>
      </div>

      <b className="block text-[15px] font-semibold leading-tight">{proposal.productName}</b>

      <div className="overflow-hidden">
        {templatePreview ? (
          <div className="pointer-events-none [&_section]:border-0 [&_section]:bg-transparent [&_section]:p-0">
            {templatePreview}
          </div>
        ) : (
          <PrintFrame aspect={aspect}>
            {proposal.thumbnailURL ? (
              <img
                alt={`Preview of ${proposal.productName}`}
                className="block h-full w-full object-cover"
                draggable={false}
                src={proposal.thumbnailURL}
                style={{
                  objectPosition: `${focus.focusX}% ${focus.focusY}%`,
                  transform: `scale(${proposal.draft.directCrop.zoom})`,
                }}
              />
            ) : <span aria-hidden className="block h-full w-full bg-surface-warm" />}
          </PrintFrame>
        )}
      </div>

      <div className="flex gap-2">
        <Button className="flex-1" onClick={onAccept}>
          Add to cart
        </Button>
        <Button className="flex-1" onClick={onReject} variant="secondary">
          Don&apos;t add
        </Button>
      </div>
    </aside>
  );
}
