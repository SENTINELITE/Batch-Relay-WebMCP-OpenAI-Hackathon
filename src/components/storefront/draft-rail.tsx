"use client";

import { Surface } from "@/components/ui";
import type { PrintDraft } from "@/lib/storefront/print-drafts";

export type DraftRailProps = {
  drafts: PrintDraft[];
  onSelect: (draft: PrintDraft) => void;
  productNameFor: (draft: PrintDraft) => string;
  selectedDraftId: string | null;
};

export function DraftRail({ drafts, onSelect, productNameFor, selectedDraftId }: DraftRailProps) {
  return (
    <section
      aria-label="Visible print drafts"
      className="rounded-[22px] bg-surface-warm px-5 py-5 sm:px-6 sm:py-6"
    >
      <p className="text-[15px] font-semibold text-foreground">Visible drafts</p>
      <p className="mt-1 max-w-[65ch] text-sm text-muted-foreground">
        Each agent configuration is a separate local draft. Select one before preparing, proofing, or
        adding it to cart.
      </p>
      <ol className="mt-4 flex snap-x gap-3 overflow-x-auto pb-1">
        {drafts.map((draft, index) => {
          const selected = draft.id === selectedDraftId;
          const photoCount = draft.photoIds.length;
          return (
            <li className="w-60 shrink-0 snap-start" key={draft.id}>
              <Surface
                aria-current={selected ? "true" : undefined}
                aria-pressed={selected}
                as="button"
                className="min-h-[4.5rem] p-4"
                interactive
                onClick={() => onSelect(draft)}
                selected={selected}
              >
                <span className="font-mono text-[13px] text-muted-foreground">0{index + 1}</span>
                <span className="mt-1 block pr-7 text-[15px] font-semibold text-foreground">
                  {productNameFor(draft)}
                </span>
                <span className="mt-0.5 block text-sm text-muted-foreground">
                  {photoCount} photo{photoCount === 1 ? "" : "s"} ·{" "}
                  {draft.proofState === "idle" ? "not proofed" : draft.proofState}
                </span>
              </Surface>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
