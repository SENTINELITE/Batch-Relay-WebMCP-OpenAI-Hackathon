"use client";

import { useCallback, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { ringOffset, ringSlot } from "@/lib/storefront/template-carousel";

export type TemplateCarouselItem = { id: string; name: string };

export type TemplateCarouselProps = {
  templates: TemplateCarouselItem[];
  selectedTemplateId: string;
  onSelect: (templateId: string) => void;
  /** A read-only rendering of the template with the shopper's photographs and
   *  text where its slots match, or null while the artwork is still loading. */
  previewFor: (templateId: string) => ReactNode | null;
  loading?: boolean;
};

const TURN_MS = 560;

/**
 * The template picker as a ring of live previews.
 *
 * The chosen template faces the shopper at full strength; its neighbours stand
 * to either side, softened and turned inward, and the next two wait behind.
 * Turning the ring moves every card along the same arc, so a template arriving
 * from the back and one leaving toward it read as one rotation. Every card is a
 * button, so a side card is chosen by clicking it; the arrow keys turn one
 * step; and a live caption announces the choice. There is no other chrome:
 * the cards are the prints themselves.
 */
export function TemplateCarousel({ templates, selectedTemplateId, onSelect, previewFor, loading = false }: TemplateCarouselProps) {
  const count = templates.length;
  const selectedIndex = Math.max(0, templates.findIndex((template) => template.id === selectedTemplateId));
  const selected = templates[selectedIndex] ?? null;

  const turn = useCallback((direction: -1 | 1) => {
    if (count < 2) return;
    const next = templates[(selectedIndex + direction + count) % count];
    if (next) onSelect(next.id);
  }, [count, onSelect, selectedIndex, templates]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") { event.preventDefault(); turn(-1); }
    else if (event.key === "ArrowRight") { event.preventDefault(); turn(1); }
  }, [turn]);

  return (
    <div
      aria-label="Template"
      aria-roledescription="carousel"
      className="flex flex-col gap-4"
      data-template-carousel
      onKeyDown={onKeyDown}
      role="group"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[15px] font-semibold text-foreground">Template</span>
        <span aria-atomic="true" aria-live="polite" className="font-mono text-[12px] text-muted-foreground">
          {loading ? "Loading templates…" : selected ? `${selected.name} · ${selectedIndex + 1} / ${count}` : "Select a template"}
        </span>
      </div>

      {/* The stage is its own container so ring positions can be expressed in
          container-width units and the ring scales with the rail it sits in. */}
      <div
        className="relative h-[clamp(220px,58cqw,300px)] w-full [container-type:inline-size] [perspective:1100px]"
        data-template-carousel-stage
      >
        {templates.map((template, index) => {
          const offset = ringOffset(index, selectedIndex, count);
          const slot = ringSlot(offset);
          const isSelected = index === selectedIndex;
          const preview = slot.visible ? previewFor(template.id) : null;
          const style: CSSProperties = {
            transform: `translate(calc(-50% + ${slot.x}cqw), calc(-50% + ${slot.y}px)) rotateY(${slot.rotateY}deg) scale(${slot.scale})`,
            opacity: slot.opacity,
            filter: slot.blur > 0 ? `blur(${slot.blur}px)` : undefined,
            zIndex: slot.zIndex,
            transition: `transform ${TURN_MS}ms var(--ease-spring), opacity ${Math.round(TURN_MS * 0.7)}ms ease-out, filter ${Math.round(TURN_MS * 0.7)}ms ease-out`,
          };
          return (
            <button
              aria-current={isSelected ? "true" : undefined}
              aria-hidden={!slot.visible}
              aria-label={isSelected ? `${template.name}, selected` : `Choose ${template.name}`}
              className={cn(
                "template-carousel-card absolute left-1/2 top-1/2 w-[42cqw] max-w-[230px] origin-center rounded-[10px] text-left motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring",
                slot.visible ? (isSelected ? "cursor-default" : "cursor-pointer") : "pointer-events-none",
              )}
              data-template-carousel-card
              data-template-carousel-offset={offset}
              key={template.id}
              onClick={() => { if (!isSelected) onSelect(template.id); }}
              style={style}
              tabIndex={slot.visible && !isSelected ? 0 : -1}
              type="button"
            >
              {/* The print frame is already rounded, clipped, and shadowed. Let
                  it fill the carousel card instead of giving every preview a
                  second, empty card behind it. */}
              <span className="pointer-events-none block [&_section]:border-0 [&_section]:bg-transparent [&_section]:p-0 [&_section>div]:max-w-full">
                {preview ?? (
                  <span className="flex aspect-[4/5] w-full items-center justify-center p-4 text-center text-[13px] font-medium leading-snug text-muted-foreground">
                    {template.name}
                  </span>
                )}
              </span>
            </button>
          );
        })}
        {count === 0 ? (
          <span className="absolute inset-0 flex items-center justify-center text-[15px] text-muted-foreground">
            {loading ? "Loading templates…" : "No published templates"}
          </span>
        ) : null}
      </div>

    </div>
  );
}
