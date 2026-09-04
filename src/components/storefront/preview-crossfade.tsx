"use client";

import { useEffect, useState, type ReactNode } from "react";

type Layer = { key: string; node: ReactNode };

export type PreviewCrossfadeProps = {
  /** The current preview, or null while the next one is still loading. */
  children: ReactNode | null;
  /** Changes when the preview is a different print, which starts a crossfade. */
  transitionKey: string;
  durationMs?: number;
};

/**
 * Keeps the main print on screen through a template change.
 *
 * Choosing a template briefly leaves the storefront without a preview
 * document, and the preview used to fall back to the raw photograph for that
 * moment and flash. This holds the last print in place until the next one
 * arrives, then dissolves between them: the old print blurs and fades out
 * while the new one sharpens and settles into place.
 */
export function PreviewCrossfade({ children, transitionKey, durationMs = 480 }: PreviewCrossfadeProps) {
  const [shown, setShown] = useState<Layer | null>(children ? { key: transitionKey, node: children } : null);
  const [exiting, setExiting] = useState<Layer | null>(null);

  // State is adjusted during render rather than in an effect, so the held
  // print and the new one are committed in the same frame with no blank
  // paint between them.
  if (children && (!shown || shown.key !== transitionKey)) {
    if (shown && shown.key !== transitionKey) setExiting(shown);
    setShown({ key: transitionKey, node: children });
  } else if (children && shown && shown.node !== children) {
    setShown({ key: transitionKey, node: children });
  }

  useEffect(() => {
    if (!exiting) return;
    const timer = window.setTimeout(() => setExiting(null), durationMs);
    return () => window.clearTimeout(timer);
  }, [durationMs, exiting]);

  const current = children ? { key: transitionKey, node: children } : shown;
  if (!current && !exiting) return null;

  return (
    <div className="relative" data-preview-crossfade>
      {exiting ? (
        <div
          aria-hidden
          className="preview-crossfade-exit pointer-events-none absolute inset-0 motion-reduce:hidden"
          key={`exit-${exiting.key}`}
        >
          {exiting.node}
        </div>
      ) : null}
      {current ? (
        <div className="preview-crossfade-enter motion-reduce:animate-none" key={current.key}>
          {current.node}
        </div>
      ) : null}
    </div>
  );
}
