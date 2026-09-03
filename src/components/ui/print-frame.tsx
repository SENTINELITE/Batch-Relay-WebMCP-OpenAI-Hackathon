import * as React from "react";

import { cn } from "@/lib/cn";

export type PrintFrameProps = React.HTMLAttributes<HTMLDivElement> & {
  /** CSS aspect-ratio for the inner window, e.g. "5 / 7" or 1.4. */
  aspect?: string | number;
  innerClassName?: string;
  /** Tilts the frame slightly on hover. Tray thumbnails only. */
  rotate?: boolean;
};

export const PrintFrame = React.forwardRef<HTMLDivElement, PrintFrameProps>(function PrintFrame(
  { aspect, children, className, innerClassName, rotate = false, style, ...props },
  ref,
) {
  return (
    <div
      {...props}
      className={cn(
        "rounded-[14px] bg-photo-border p-1.5 shadow-warm",
        rotate &&
          "transition-transform duration-200 ease-[var(--ease-out-expo)] hover:-rotate-1 motion-reduce:transition-none motion-reduce:hover:rotate-none",
        className,
      )}
      ref={ref}
      style={style}
    >
      <div
        className={cn("overflow-hidden rounded-[10px]", innerClassName)}
        style={aspect === undefined ? undefined : { aspectRatio: aspect }}
      >
        {children}
      </div>
    </div>
  );
});
