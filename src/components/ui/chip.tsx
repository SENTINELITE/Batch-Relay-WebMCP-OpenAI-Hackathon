import * as React from "react";

import { cn } from "@/lib/cn";

export type ChipTone = "neutral" | "warning" | "success" | "error" | "info";

const tones: Record<ChipTone, string> = {
  neutral: "bg-surface-warm text-foreground",
  warning: "bg-status-warning-surface text-status-warning",
  success: "bg-status-success-surface text-status-success",
  error: "bg-status-error-surface text-status-error",
  info: "border border-border text-muted-foreground",
};

export type ChipProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: ChipTone;
};

export const Chip = React.forwardRef<HTMLSpanElement, ChipProps>(function Chip(
  { children, className, tone = "neutral", ...props },
  ref,
) {
  return (
    <span
      {...props}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] font-medium",
        tones[tone],
        className,
      )}
      ref={ref}
    >
      {children}
    </span>
  );
});
