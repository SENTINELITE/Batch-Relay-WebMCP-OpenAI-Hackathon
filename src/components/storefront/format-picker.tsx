"use client";

import { Chip, Notice, Surface } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { CatalogProduct } from "@/lib/storefront/client";

const quickProductIDs = ["print-5x7", "print-8x10", "memory-mate-8x10"];

function selectionKey(product: Pick<CatalogProduct, "id" | "revision">) {
  return JSON.stringify([product.id, product.revision]);
}

function productSize(product: CatalogProduct) {
  const output = product.physical_output;
  return output ? `${output.width} × ${output.height}` : "Print";
}

type FormatPickerProps = {
  products: CatalogProduct[];
  selectedProductKey: string | null;
  state: "loading" | "ready" | "error";
  onSelect: (product: CatalogProduct) => void;
};

export function FormatPicker({ products, selectedProductKey, state, onSelect }: FormatPickerProps) {
  const quickProducts = quickProductIDs.flatMap((id) => {
    const product = products.find((candidate) => candidate.id === id);
    return product ? [product] : [];
  });
  const quickKeys = new Set(quickProducts.map(selectionKey));
  const otherProducts = products.filter((product) => !quickKeys.has(selectionKey(product)));

  return <section className="py-10" aria-labelledby="format-picker-title">
    <div className="flex flex-col gap-3">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl" id="format-picker-title">Choose the frame, not the workflow.</h1>
      <p className="max-w-[60ch] text-base leading-relaxed text-muted-foreground">Pick a common format here or ask the page agent to switch the visible print.</p>
    </div>
    {state === "loading" && <Notice className="mt-6" tone="info">Reading live formats…</Notice>}
    {state === "error" && <Notice className="mt-6" tone="warning">Live formats are unavailable.</Notice>}
    {state === "ready" && products.length === 0 && <Notice className="mt-6" tone="info">No supported published format is active.</Notice>}
    {products.length > 0 && <div className="mt-6 flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-3" aria-label="Common print formats">
        {quickProducts.map((product) => {
          const selected = selectionKey(product) === selectedProductKey;
          return <Surface
            aria-pressed={selected}
            as="button"
            className="flex min-h-[120px] flex-col justify-between gap-3 pr-10"
            interactive
            key={selectionKey(product)}
            onClick={() => onSelect(product)}
            selected={selected}
            type="button"
          >
            <span className="text-[13px] font-medium text-muted-foreground">{productSize(product)}</span>
            <strong className="text-lg font-semibold">{product.name}</strong>
          </Surface>;
        })}
      </div>
      {otherProducts.length > 0 && <details className="group rounded-[22px] border border-border bg-card transition-[background-color,border-color] duration-200 ease-[var(--ease-out-expo)] open:bg-surface-warm motion-reduce:transition-none">
        <summary className="flex min-h-36 cursor-pointer list-none items-center justify-between gap-6 px-6 py-6 sm:px-8 [&::-webkit-details-marker]:hidden">
          <span className="flex flex-col gap-2">
            <span className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Explore more print formats</span>
            <span className="text-sm leading-relaxed text-muted-foreground">Reveal every compatible size and layout.</span>
          </span>
          <span className="flex shrink-0 items-center gap-3 text-[15px] font-semibold text-foreground">
            <Chip tone="neutral">{otherProducts.length} more</Chip>
          <svg
            aria-hidden="true"
            className="size-4 text-muted-foreground transition-transform duration-200 ease-[var(--ease-out-expo)] group-open:rotate-180 motion-reduce:transition-none"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
          </span>
        </summary>
        <div className="grid gap-3 border-t border-border px-6 py-6 sm:grid-cols-2 sm:px-8 lg:grid-cols-4">
          {otherProducts.map((product) => {
            const selected = selectionKey(product) === selectedProductKey;
            return <Surface
              aria-pressed={selected}
              as="button"
              className={cn("flex flex-col gap-1 p-4", selected && "pr-10")}
              interactive
              key={selectionKey(product)}
              onClick={() => onSelect(product)}
              selected={selected}
              type="button"
            >
              <strong className="text-base font-semibold">{product.name}</strong>
              <span className="text-[13px] font-medium text-muted-foreground">{productSize(product)}</span>
              <span className="truncate font-mono text-[13px] text-muted-foreground">{product.id} · r{product.revision}</span>
            </Surface>;
          })}
        </div>
      </details>}
    </div>}
  </section>;
}
