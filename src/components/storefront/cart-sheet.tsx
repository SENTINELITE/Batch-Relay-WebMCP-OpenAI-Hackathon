"use client";

/* eslint-disable @next/next/no-img-element -- local object URLs are browser-only preview state. */

import { useEffect, useRef, useState } from "react";

import { Button, Chip, Notice, PrintFrame, Surface } from "@/components/ui";
import { localCartPrintCount, type LocalCartItem } from "@/lib/storefront/local-cart";

export type CartSheetProps = {
  items: LocalCartItem[];
  /** Whether the cart sheet is on screen. Owned by the storefront so the
   *  masthead cart chip is the single opener, from any step. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoveItem: (itemId: string) => void;
  onUpdateQuantity: (itemId: string, quantity: number) => void;
  onConfirmCheckout: () => void;
};

function CartThumbnail({ item }: { item: LocalCartItem }) {
  return (
    <PrintFrame aspect="1 / 1" className="w-12 shrink-0" innerClassName="relative">
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
      <span className="absolute bottom-0 right-0 rounded-tl-[6px] bg-foreground/80 px-1 font-mono text-[11px] leading-[1.5] text-background">
        {item.quantity}
      </span>
    </PrintFrame>
  );
}

/**
 * Demo cart as a right-edge sheet over the current step. It is only mounted
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

      {/* Surface owns `position: relative`, so the right-edge placement lives on
          this wrapper rather than fighting it. */}
      <div className="absolute inset-y-0 right-0 flex w-[min(92vw,400px)] animate-sheet-in">
        <Surface
          aria-labelledby="cart-sheet-title"
          aria-modal="true"
          className="flex w-full flex-col gap-4 overflow-y-auto rounded-none rounded-l-[22px] border-y-0 border-r-0 p-5 shadow-warm-lg sm:p-6"
          id="cart-sheet"
          role="dialog"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-2xl font-semibold tracking-[-0.02em]" id="cart-sheet-title">
                {checkingOut ? "Review your prints" : "Local cart"}
              </h2>
              <small className="text-[13px] text-muted-foreground">
                {isEmpty ? "Cart empty" : `${printCount} print${printCount === 1 ? "" : "s"}`}
              </small>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Chip tone="warning">Demo</Chip>
              <Button
                aria-label="Close demo cart"
                onClick={close}
                ref={closeRef}
                variant="ghost"
              >
                Close
              </Button>
            </div>
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
                    <CartThumbnail item={item} />
                    <div className="min-w-0 flex-1">
                      <b className="block truncate text-[15px] font-semibold">{item.productName}</b>
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
                <ul className="flex flex-col divide-y divide-border">
                  {items.map((item) => (
                    <li className="flex items-center gap-3 py-2 first:pt-0" key={item.id}>
                      <CartThumbnail item={item} />
                      <div className="min-w-0 flex-1">
                        <b className="block truncate text-[14px] font-semibold">{item.productName}</b>
                        <small className="block text-[13px] text-muted-foreground">
                          {item.source}
                        </small>
                      </div>
                      <div aria-label={`Quantity for ${item.productName}`} className="flex items-center gap-1" role="group">
                        <Button
                          aria-label={`Decrease ${item.productName} quantity`}
                          disabled={item.quantity <= 1}
                          onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
                          variant="ghost"
                        >
                          −
                        </Button>
                        <span className="min-w-7 text-center font-mono text-[13px]" aria-live="polite">{item.quantity}</span>
                        <Button
                          aria-label={`Increase ${item.productName} quantity`}
                          disabled={item.quantity >= 99}
                          onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                          variant="ghost"
                        >
                          +
                        </Button>
                      </div>
                      <Button
                        aria-label={`Remove ${item.productName}`}
                        onClick={() => onRemoveItem(item.id)}
                        variant="ghost"
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              <Button
                className="mt-auto w-full"
                disabled={isEmpty}
                onClick={() => { setComplete(false); setCheckingOut(true); }}
                size="lg"
              >
                Demo checkout
              </Button>
            </>
          )}
        </Surface>
      </div>
    </div>
  );
}
