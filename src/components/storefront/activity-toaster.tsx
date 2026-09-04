"use client";

import { Toaster } from "sonner";

import { useThemePreference } from "@/components/theme/theme-provider";

/**
 * Where the agent's activity is announced.
 *
 * The proposal deck owns the bottom left, so agent acknowledgements sit in the
 * bottom right beside the cart. They are brief and auto-dismiss; their Undo
 * action remains the deliberate way to reverse a change, so a generic X would
 * only add a second, ambiguous dismissal control.
 *
 * The theme comes from the app's own class-based dark mode rather than
 * sonner's "system", so a shopper who has explicitly chosen light or dark does
 * not get toasts from the other one.
 */
export function ActivityToaster() {
  const { resolvedTheme } = useThemePreference();

  return (
    <Toaster
      position="bottom-right"
      theme={resolvedTheme}
      // Four at once is already more than a shopper reads; a batch that fires
      // more than that should collapse into the deck, not into a wall of text.
      visibleToasts={4}
      closeButton={false}
      gap={8}
      toastOptions={{
        duration: 3600,
        classNames: {
          toast: "font-sans",
          title: "text-[13px] font-medium",
          description: "text-[12px] opacity-80",
        },
      }}
    />
  );
}
