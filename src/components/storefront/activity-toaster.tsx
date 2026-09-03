"use client";

import { Toaster } from "sonner";

import { useThemePreference } from "@/components/theme/theme-provider";

/**
 * Where the agent's activity is announced.
 *
 * Bottom-centre is the only free corner: the proposal deck owns the bottom
 * left, the cart sheet covers the whole right edge when it is open, and the
 * masthead owns the top. A toast that lands on top of the very card it is
 * describing would hide the thing it wants the shopper to look at.
 *
 * That clearance is a width assumption, and worth stating: the deck is 300px
 * inset 20px, and a 356px toast centred on a viewport narrower than about
 * 1000px would start to overlap it. The storefront is presented on a desktop
 * window, so this is the right trade — but it is a trade, not a guarantee.
 *
 * The theme comes from the app's own class-based dark mode rather than
 * sonner's "system", so a shopper who has explicitly chosen light or dark does
 * not get toasts from the other one.
 */
export function ActivityToaster() {
  const { resolvedTheme } = useThemePreference();

  return (
    <Toaster
      position="bottom-center"
      theme={resolvedTheme}
      // Four at once is already more than a shopper reads; a batch that fires
      // more than that should collapse into the deck, not into a wall of text.
      visibleToasts={4}
      closeButton
      gap={8}
      toastOptions={{
        duration: 4200,
        classNames: {
          toast: "font-sans",
          title: "text-[13px] font-medium",
          description: "text-[12px] opacity-80",
        },
      }}
    />
  );
}
