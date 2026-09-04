"use client";

/* eslint-disable @next/next/no-img-element -- local object URLs are browser-only preview state. */

import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button, Notice, PrintFrame, Surface } from "@/components/ui";
import { cartItemDisplayName, localCartPrintCount, type LocalCartItem } from "@/lib/storefront/local-cart";

export type CartSheetProps = {
  items: LocalCartItem[];
  /** Whether the cart sheet is on screen. Owned by the storefront so the
   *  masthead cart chip is the single opener, from any step. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoveItem: (itemId: string) => void;
  onUpdateQuantity: (itemId: string, quantity: number) => void;
  onConfirmCheckout: () => void;
  /** The finished composed preview for template-based cart lines. */
  templatePreviewFor: (item: LocalCartItem) => ReactNode | null;
};

/** No quantity badge: the row's stepper is the one place that number lives.
 *  Two readings of the same count invited the shopper to trust the wrong one. */
function CartThumbnail({ item, className, templatePreview }: { item: LocalCartItem; className?: string; templatePreview: ReactNode | null }) {
  if (templatePreview) return <div className={`pointer-events-none shrink-0 [&_section]:block [&_section]:w-full [&_section]:gap-0 [&_section>div]:w-full ${className ?? "w-[72px]"}`}>
    {templatePreview}
  </div>;
  return (
    <PrintFrame aspect="1 / 1" className={className ?? "w-[72px] shrink-0"}>
      {item.thumbnailURL ? (
        <img
          alt=""
          className="block h-full w-full object-cover"
          draggable={false}
          src={item.thumbnailURL}
        />
      ) : (
        <span className="block h-full w-full bg-foreground/5" />
      )}
    </PrintFrame>
  );
}

/** A deliberately compact enclosed quantity control. It is a secondary action
 *  in a cart row, so it must not compete with the print or Checkout button. */
function QuantityStepper({
  item,
  onUpdateQuantity,
}: {
  item: LocalCartItem;
  onUpdateQuantity: (itemId: string, quantity: number) => void;
}) {
  return (
    <div
      aria-label={`Quantity for ${item.productName}`}
      className="flex h-6 shrink-0 items-center rounded-md border border-border bg-background/60 px-0.5"
      role="group"
    >
      <button
        aria-label={`Decrease ${item.productName} quantity`}
        className="grid size-5 place-items-center rounded text-[14px] leading-none text-muted-foreground transition-colors hover:bg-surface-warm hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
        disabled={item.quantity <= 1}
        onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
        type="button"
      >
        −
      </button>
      <span aria-live="polite" className="min-w-5 text-center font-mono text-[12px] text-foreground">
        {item.quantity}
      </span>
      <button
        aria-label={`Increase ${item.productName} quantity`}
        className="grid size-5 place-items-center rounded text-[14px] leading-none text-muted-foreground transition-colors hover:bg-surface-warm hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
        disabled={item.quantity >= 99}
        onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
        type="button"
      >
        +
      </button>
    </div>
  );
}

/**
 * Demo cart as a floating panel over the current step. It is only mounted
 * while open — nothing about the cart lives permanently in a page corner — and
 * checkout is clearly labelled and places no order.
 */
export function CartSheet({
  items,
  open,
  onOpenChange,
  onRemoveItem,
  onUpdateQuantity,
  onConfirmCheckout,
  templatePreviewFor,
}: CartSheetProps) {
  const [checkingOut, setCheckingOut] = useState(false);
  const [complete, setComplete] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<Element | null>(null);
  const printCount = localCartPrintCount(items);
  const isEmpty = items.length === 0;

  /** Closes the sheet and drops its transient checkout state. */
  function close() {
    setCheckingOut(false);
    setComplete(false);
    onOpenChange(false);
  }

  // Escape closes whichever cart surface is showing, innermost first.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (checkingOut) setCheckingOut(false);
      else close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // `close` is stable enough for this handler; only open/checkingOut matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkingOut, open]);

  // A floating modal must own scrolling for its entire lifetime. Without this,
  // wheel/touch events at either end of a short or long cart chain through to
  // the storefront underneath, moving the page behind an open dialog.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const body = document.body;
    const rootOverflow = root.style.overflow;
    const bodyOverflow = body.style.overflow;
    const bodyPaddingRight = body.style.paddingRight;
    const scrollbarWidth = Math.max(0, window.innerWidth - root.clientWidth);
    root.style.overflow = "hidden";
    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) body.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      root.style.overflow = rootOverflow;
      body.style.overflow = bodyOverflow;
      body.style.paddingRight = bodyPaddingRight;
    };
  }, [open]);

  // Opening moves focus into the sheet; closing hands it back to the chip that
  // opened it, so nothing navigates and the page never scrolls.
  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  function confirm() {
    onConfirmCheckout();
    setCheckingOut(false);
    setComplete(true);
  }

  return (
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden="true"
        className="absolute inset-0 animate-backdrop-in bg-foreground/40"
        onClick={close}
      />

      {/* Surface owns `position: relative`, so the floating placement lives on
          this wrapper rather than fighting it. A small gutter lets the panel
          read as a distinct object instead of a continuation of the viewport. */}
      <div className="absolute inset-x-3 inset-y-3 flex animate-sheet-in sm:inset-x-auto sm:inset-y-5 sm:right-5 sm:w-[min(92vw,400px)]">
        <Surface
          aria-labelledby="cart-sheet-title"
          aria-modal="true"
          className="flex w-full flex-col gap-4 overflow-y-auto overscroll-contain rounded-[22px] p-5 shadow-warm-lg sm:p-6"
          id="cart-sheet"
          role="dialog"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-2xl font-semibold tracking-[-0.02em]" id="cart-sheet-title">
                Cart
              </h2>
              <small className="text-sm text-muted-foreground">
                {isEmpty
                  ? "Cart empty"
                  : `${items.length} photo${items.length === 1 ? "" : "s"} · ${printCount} print${printCount === 1 ? "" : "s"}`}
              </small>
            </div>
            <Button
              aria-label="Close demo cart"
              className="bg-surface-warm"
              onClick={close}
              ref={closeRef}
              variant="ghost"
            >
              Close
            </Button>
          </div>

          {complete && (
            <Surface className="flex flex-col gap-1 p-4" tone="warm">
              <b className="text-[15px] font-semibold">Demo checkout complete.</b>
              <small className="text-[13px] text-muted-foreground">
                No order was placed and nothing was charged.
              </small>
            </Surface>
          )}

          {checkingOut ? (
            <>
              <Notice role="note" tone="warning">
                Demo checkout — no order is placed and nothing is charged.
              </Notice>

              <ol className="flex flex-col divide-y divide-border">
                {items.map((item, index) => (
                  <li className="flex items-center gap-3 py-3 first:pt-0" key={item.id}>
                    <span className="font-mono text-[13px] text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <CartThumbnail className="w-12" item={item} templatePreview={templatePreviewFor(item)} />
                    <div className="min-w-0 flex-1">
                      <b className="block truncate text-[15px] font-semibold">{cartItemDisplayName(item)}</b>
                      <small className="block text-[13px] text-muted-foreground">
                        Quantity {item.quantity}
                      </small>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="mt-auto flex gap-2">
                <Button className="flex-1" onClick={confirm} size="lg">
                  Confirm demo checkout
                </Button>
                <Button onClick={() => setCheckingOut(false)} variant="secondary">
                  Back
                </Button>
              </div>
            </>
          ) : (
            <>
              {isEmpty ? (
                <small className="text-[13px] text-muted-foreground">
                  No prints in the demo cart yet. Propose a print to add one.
                </small>
              ) : (
                /* The product name gets the full width of the sheet rather than
                   whatever the controls leave over. On a 400px panel, sharing
                   one line with a stepper and a Remove button clipped every
                   title to "8 ×…". */
                <ul className="flex flex-col divide-y divide-border">
                  {items.map((item) => (
                    <li className="flex items-start gap-3.5 py-3.5 first:pt-0" key={item.id}>
                      <CartThumbnail item={item} templatePreview={templatePreviewFor(item)} />
                      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                        <b className="text-base font-semibold leading-[1.375] tracking-[-0.01em]">
                          {cartItemDisplayName(item)}
                        </b>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex shrink-0 items-center gap-1.5">
                            <QuantityStepper item={item} onUpdateQuantity={onUpdateQuantity} />
                            <Button
                              aria-label={`Remove ${item.productName}`}
                              className="h-7 px-2 text-[12px] text-muted-foreground hover:text-foreground"
                              onClick={() => onRemoveItem(item.id)}
                              variant="ghost"
                            >
                              Remove
                            </Button>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-auto flex flex-col gap-3.5 border-t border-border pt-5">
                <Button
                  className="w-full"
                  disabled={isEmpty}
                  onClick={() => { setComplete(false); setCheckingOut(true); }}
                  size="lg"
                >
                  Checkout
                </Button>
              </div>
            </>
          )}
        </Surface>
      </div>
    </div>
  );
}
