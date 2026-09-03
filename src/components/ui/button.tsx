import * as React from "react";

import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "md" | "lg";

const base =
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold no-underline transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-[var(--ease-out-expo)] active:translate-y-px active:scale-[.99] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
  secondary: "border border-border-strong bg-card text-foreground hover:bg-surface-warm",
  ghost: "bg-transparent text-muted-foreground hover:text-foreground",
};

const sizes: Record<ButtonSize, string> = {
  md: "h-12 px-5 text-[15px]",
  lg: "h-[54px] px-6 text-base",
};

/** Same classes the Button renders, for <a> or <label> elements that must look
 *  like a button. Pair with `cursor-pointer` on non-button elements. */
export function buttonClassName(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cn(base, variants[variant], sizes[size], className);
}

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, className, children, disabled, type, ...props },
  ref,
) {
  return (
    <button
      {...props}
      aria-busy={loading || undefined}
      className={buttonClassName(variant, size, className)}
      disabled={disabled || loading}
      ref={ref}
      type={type ?? "button"}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
        />
      ) : null}
      {children}
    </button>
  );
});
