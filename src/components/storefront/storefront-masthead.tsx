"use client";

import { useState } from "react";

import { BatchRelayLockup } from "@/components/brand/batch-relay-lockup";
import { ThemeToggle } from "@/components/theme/theme-toggle";

/** One accepted cart proposal. `id` changes per add so a repeat of the same
 *  quantity still re-fires the chip acknowledgement. */
export type CartAcknowledgement = { id: number; quantity: number };

export type StorefrontMastheadProps = {
  cartCount: number;
  /** Latest accepted add. The chip flashes briefly instead of opening the cart
   *  sheet, so an agent-driven add is noticeable without stealing focus. */
  cartAcknowledgement?: CartAcknowledgement | null;
  onOpenCart?: () => void;
  onOpenHome?: () => void;
};

export function StorefrontMasthead({
  cartCount,
  cartAcknowledgement,
  onOpenCart,
  onOpenHome,
}: StorefrontMastheadProps) {
  // The acknowledgement is CSS on keyed elements: a new id remounts them and the
  // animation runs once, then unmounts itself on animationend. No timer fires and
  // the shopper's focus never moves.
  const [finishedId, setFinishedId] = useState(0);
  const acknowledgementId = cartAcknowledgement?.id ?? 0;
  const acknowledging = Boolean(cartAcknowledgement) && acknowledgementId > 0 && acknowledgementId !== finishedId;

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-[1400px] items-center gap-3 px-5 sm:h-[68px] sm:gap-4 sm:px-8 lg:px-12">
        <a
          aria-label="Batch Relay home"
          className="group flex shrink-0 items-center text-foreground no-underline"
          href="#catalog"
          onClick={onOpenHome}
        >
          <BatchRelayLockup />
        </a>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {/* Opens the demo cart sheet in place. It is deliberately not a link:
              the shopper never leaves the step they are looking at, and this is
              the only control that opens the cart. */}
          <button
            aria-controls="cart-sheet"
            aria-haspopup="dialog"
            className="relative inline-flex h-11 cursor-pointer items-center gap-2.5 rounded-full border border-border bg-card px-5 text-sm font-medium text-foreground transition-colors duration-200 ease-[var(--ease-out-expo)] hover:bg-surface-warm motion-reduce:transition-none"
            onClick={onOpenCart}
            type="button"
          >
            <span className="max-sm:sr-only">Local cart</span>
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-foreground px-1.5 text-[13px] font-semibold text-background">
              {cartCount}
            </span>
            {acknowledging && cartAcknowledgement ? (
              <>
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 animate-cart-ack rounded-full border-2 border-primary opacity-0 motion-reduce:animate-none"
                  data-cart-acknowledgement="pulse"
                  key={`pulse-${acknowledgementId}`}
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -top-2 right-1 animate-cart-ack-badge rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-[1.5] text-primary-foreground opacity-0 motion-reduce:animate-none"
                  data-cart-acknowledgement="badge"
                  key={`badge-${acknowledgementId}`}
                  onAnimationEnd={() => setFinishedId(acknowledgementId)}
                >
                  +{cartAcknowledgement.quantity}
                </span>
              </>
            ) : null}
          </button>
          <ThemeToggle />
        </div>
      </div>
      <p aria-live="polite" className="sr-only">
        {acknowledging ? `${cartCount} in the local cart.` : ""}
      </p>
    </header>
  );
}
