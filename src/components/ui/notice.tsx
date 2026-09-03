import * as React from "react";

import { cn } from "@/lib/cn";

export type NoticeTone = "info" | "success" | "warning" | "error";
export type NoticeVariant = "inline" | "banner";

const inlineTones: Record<NoticeTone, string> = {
  info: "border-l-muted-foreground bg-status-info-surface",
  success: "border-l-status-success bg-status-success-surface",
  warning: "border-l-status-warning bg-status-warning-surface",
  error: "border-l-status-error bg-status-error-surface",
};

const bannerTones: Record<NoticeTone, string> = {
  info: "border-border bg-status-info-surface",
  success: "border-status-success/30 bg-status-success-surface",
  warning: "border-status-warning/30 bg-status-warning-surface",
  error: "border-status-error/30 bg-status-error-surface",
};

export type NoticeProps = React.HTMLAttributes<HTMLDivElement> & {
  tone?: NoticeTone;
  variant?: NoticeVariant;
};

export const Notice = React.forwardRef<HTMLDivElement, NoticeProps>(function Notice(
  { children, className, role, tone = "info", variant = "inline", ...props },
  ref,
) {
  const body =
    variant === "banner" ? (
      <div className="mx-auto w-full max-w-[1400px] px-5 py-2.5 text-[14px] leading-snug sm:px-8 lg:px-12">
        {children}
      </div>
    ) : (
      children
    );

  return (
    <div
      {...props}
      className={cn(
        "text-foreground",
        variant === "banner"
          ? cn("w-full border-t", bannerTones[tone])
          : cn(
              "rounded-[14px] border-l-[3px] px-4 py-3 text-[15px] leading-relaxed",
              inlineTones[tone],
            ),
        className,
      )}
      ref={ref}
      role={role ?? (tone === "error" ? "alert" : "status")}
    >
      {body}
    </div>
  );
});
