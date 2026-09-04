"use client";

import { useEffect, useRef, useState } from "react";

import { Button, Chip, Notice, Surface, TextField } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { CatalogProduct } from "@/lib/storefront/client";
import { describeFormatMatches, filterFormats } from "@/lib/storefront/format-search";

const quickProductIDs = ["print-5x7", "print-8x10", "memory-mate-8x10"];

/**
 * Declarative WebMCP (Chrome 146+ behind chrome://flags/#enable-webmcp-testing).
 * These attributes turn the search form itself into an agent-discoverable tool:
 * the browser derives the JSON schema from the form's inputs. Everywhere else in
 * this app WebMCP is imperative (@nekuda/webmcp-sdk registerTool); this is the
 * other face of the same protocol, and the two coexist on one page.
 *
 * They are plain unknown attributes in browsers without WebMCP, so the form
 * stays an ordinary, human-usable search box.
 */
const searchFormToolAttributes = {
  toolname: "search-print-formats",
  tooldescription:
    "Search the live print formats shown in the catalog chooser by size or name. Filters only the formats already visible on this page; it does not add anything to the cart.",
  toolautosubmit: "",
};

const searchInputToolAttributes = {
  // The associated visible label is enough for human assistive tech, but the
  // explicit title keeps the generated declarative-tool schema stable even if
  // this shared field component's label markup changes later.
  toolparamtitle: "Print format query",
  toolparamdescription: "A size or product name, e.g. 8 by 10 or memory mate. Leave empty to list every visible format.",
};

/** Non-standard members the WebMCP-enabled browser adds to the submit event. */
type AgentToolResult = { content: Array<{ type: "text"; text: string }> };
type AgentSubmitEvent = SubmitEvent & {
  agentInvoked?: boolean;
  respondWith?: (result: AgentToolResult | Promise<AgentToolResult>) => void;
};

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
  const formRef = useRef<HTMLFormElement>(null);
  const [query, setQuery] = useState("");

  // A native listener, not React's onSubmit: the declarative WebMCP contract is
  // defined on the real submit event, and reading the value out of FormData is
  // what makes an agent-filled input work without React owning the field.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;

    const handleSubmit = (event: SubmitEvent) => {
      event.preventDefault();
      const raw = new FormData(form).get("query");
      const value = typeof raw === "string" ? raw : "";
      setQuery(value);

      const agentEvent = event as AgentSubmitEvent;
      // Feature-detect: without WebMCP neither member exists and the human path
      // above is all that runs.
      if (
        "respondWith" in agentEvent &&
        typeof agentEvent.respondWith === "function" &&
        agentEvent.agentInvoked === true
      ) {
        agentEvent.respondWith(
          Promise.resolve({
            content: [{ type: "text" as const, text: describeFormatMatches(products, value) }],
          }),
        );
      }
    };

    form.addEventListener("submit", handleSubmit);
    return () => form.removeEventListener("submit", handleSubmit);
  }, [products]);

  const visibleProducts = filterFormats(products, query);
  const quickProducts = quickProductIDs.flatMap((id) => {
    const product = visibleProducts.find((candidate) => candidate.id === id);
    return product ? [product] : [];
  });
  const quickKeys = new Set(quickProducts.map(selectionKey));
  const otherProducts = visibleProducts.filter((product) => !quickKeys.has(selectionKey(product)));
  const searching = query.trim().length > 0;

  const compactCard = (product: CatalogProduct) => {
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
  };

  return <section className="py-10" aria-labelledby="format-picker-title">
    <div className="flex flex-col gap-3">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl" id="format-picker-title">Choose print.</h1>
      <p className="max-w-[60ch] text-base leading-relaxed text-muted-foreground">Pick a common format here or ask the page agent to switch the visible print.</p>
    </div>
    {state === "loading" && <Notice className="mt-6" tone="info">Reading live formats…</Notice>}
    {state === "error" && <Notice className="mt-6" tone="warning">Live formats are unavailable.</Notice>}
    {state === "ready" && products.length === 0 && <Notice className="mt-6" tone="info">No supported published format is active.</Notice>}
    {products.length > 0 && <form
      {...searchFormToolAttributes}
      className="mt-6 hidden flex-col gap-3 rounded-[22px] border border-border bg-card p-4 sm:flex-row sm:items-end sm:gap-4 sm:p-5"
      ref={formRef}
    >
      <TextField
        {...searchInputToolAttributes}
        autoComplete="off"
        containerClassName="sm:flex-1"
        defaultValue=""
        hint="Filters the formats below. The page agent can run this same search."
        label="Search print formats"
        name="query"
        onChange={(event) => setQuery(event.target.value)}
        placeholder="8 by 10, memory mate…"
        type="search"
      />
      <Button className="sm:shrink-0" type="submit" variant="secondary">Search</Button>
    </form>}
    {products.length > 0 && searching && visibleProducts.length === 0 && <Notice className="mt-4" tone="info">No visible print format matches “{query.trim()}”.</Notice>}
    {searching && visibleProducts.length > 0 && <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Matching print formats">
      {visibleProducts.map(compactCard)}
    </div>}
    {!searching && products.length > 0 && <div className="mt-6 flex flex-col gap-6">
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
      {otherProducts.length > 0 && <details className="group hidden rounded-[22px] border border-border bg-card transition-[background-color,border-color] duration-200 ease-[var(--ease-out-expo)] open:bg-surface-warm motion-reduce:transition-none">
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
          {otherProducts.map(compactCard)}
        </div>
      </details>}
    </div>}
  </section>;
}
