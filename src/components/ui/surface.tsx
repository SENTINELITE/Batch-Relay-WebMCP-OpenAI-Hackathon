import * as React from "react";

import { cn } from "@/lib/cn";

export type SurfaceTag = "div" | "section" | "article" | "button" | "li";
export type SurfaceTone = "card" | "warm";

export type SurfaceProps = React.HTMLAttributes<HTMLElement> & {
  as?: SurfaceTag;
  disabled?: boolean;
  interactive?: boolean;
  selected?: boolean;
  tone?: SurfaceTone;
  type?: "button" | "submit" | "reset";
};

const tones: Record<SurfaceTone, string> = {
  card: "bg-card",
  warm: "bg-surface-warm",
};

export const Surface = React.forwardRef<HTMLElement, SurfaceProps>(function Surface(
  {
    as = "div",
    children,
    className,
    interactive = false,
    selected = false,
    tone = "card",
    type,
    ...props
  },
  ref,
) {
  const Component = as as React.ElementType;

  return (
    <Component
      {...props}
      className={cn(
        "relative rounded-[18px] p-5 text-left",
        tones[tone],
        selected ? "border-2 border-primary" : "border border-border",
        interactive &&
          "cursor-pointer transition-[box-shadow,border-color,transform] duration-200 ease-[var(--ease-out-expo)] hover:shadow-warm motion-reduce:transition-none",
        as === "button" && "block w-full disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      type={as === "button" ? (type ?? "button") : type}
    >
      {selected ? (
        <span
          aria-hidden="true"
          className="absolute right-3 top-3 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground"
        >
          <svg
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2.4}
            viewBox="0 0 24 24"
          >
            <path d="m5 12.5 4.5 4.5L19 7" />
          </svg>
        </span>
      ) : null}
      {children}
    </Component>
  );
});
