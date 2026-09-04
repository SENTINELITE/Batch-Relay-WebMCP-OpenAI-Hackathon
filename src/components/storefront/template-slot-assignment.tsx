"use client";

/* eslint-disable @next/next/no-img-element -- local object URLs are browser-only preview state. */

import type { ReactNode } from "react";

import { fieldControlClassName } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { TemplateContract } from "@/lib/storefront/client";

type AssignablePhoto = {
  id: string;
  filename: string;
  /** Object URL for the tray thumbnail, when the caller has one. */
  previewURL?: string;
};

type TemplateSlotAssignmentProps = {
  slots: TemplateContract["slots"];
  photos: AssignablePhoto[];
  assignments: Record<string, string>;
  /** Slot keys whose current photo came from the session role memory, not a
   *  deliberate choice. Shown so a carried-over default is never silent. */
  prefilledSlotProvenance?: Record<string, string>;
  textValues: Record<string, string>;
  onAssign: (slotKey: string, photoId: string | null) => void;
  onTextChange: (slotKey: string, value: string) => void;
  onTextCommit?: () => void;
};

const rowClassName = "rounded-[14px] border border-border bg-background/60 p-3";

const selectClassName = cn(
  fieldControlClassName,
  "appearance-none bg-[image:var(--select-chevron)] bg-[position:right_16px_center] bg-[length:18px_18px] bg-no-repeat pr-11",
);

function ImageSlotRow({ children, slotKey }: { children: ReactNode; slotKey: string }) {
  return (
    <label
      className={cn(rowClassName, "flex flex-wrap items-center gap-3 sm:flex-nowrap")}
      data-slot-key={slotKey}
    >
      {children}
    </label>
  );
}

/**
 * Names a run of slots and says how much of it is still outstanding. Image
 * pickers and text boxes used to sit in one undifferentiated list, so a missing
 * photograph looked exactly like an empty caption.
 */
function GroupHeading({ filled, label, total }: { filled: number; label: string; total: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[13px] font-medium uppercase tracking-[0.09em] text-muted-foreground">
        {label}
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      <span className="font-mono text-[13px] text-muted-foreground">
        {filled} / {total} filled
      </span>
    </div>
  );
}

/** The assigned photograph, so a slot is identifiable without reading a filename. */
function SlotThumbnail({ photo }: { photo: AssignablePhoto | undefined }) {
  return (
    <span className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-[12px] bg-surface-warm">
      {photo?.previewURL ? (
        <img alt="" className="size-full object-cover" draggable={false} src={photo.previewURL} />
      ) : (
        <svg
          aria-hidden="true"
          className="size-7 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth={1.6}
          viewBox="0 0 24 24"
        >
          <rect height="15" rx="2.5" width="19" x="2.5" y="4.5" />
          <circle cx="8.5" cy="9.5" fill="currentColor" r="1.7" stroke="none" />
          <path d="M3 16.5l4.8-4.4a1.6 1.6 0 0 1 2.2 0L14 16" />
        </svg>
      )}
    </span>
  );
}

function SlotLabel({ children }: { children: ReactNode }) {
  return <span className="text-[15px] font-semibold text-foreground">{children}</span>;
}

export function TemplateSlotAssignment({
  slots,
  photos,
  assignments,
  prefilledSlotProvenance,
  textValues,
  onAssign,
  onTextChange,
  onTextCommit,
}: TemplateSlotAssignmentProps) {
  const imageSlots = slots.filter((slot) => slot.kind === "image");
  const textSlots = slots.filter((slot) => slot.kind !== "image");
  const filledImages = imageSlots.filter((slot) => assignments[slot.key]).length;
  const filledTexts = textSlots.filter((slot) => (textValues[slot.key] ?? "").trim()).length;

  return (
    <div aria-label="Template slot assignments" className="flex flex-col gap-6">
      {imageSlots.length > 0 && (
        <div className="flex flex-col gap-3">
          <GroupHeading filled={filledImages} label="Photo slots" total={imageSlots.length} />
          {imageSlots.map((slot) => (
            <ImageSlotRow key={slot.key} slotKey={slot.key}>
              <SlotThumbnail photo={photos.find((photo) => photo.id === assignments[slot.key])} />
              <span className="grid min-w-0 flex-1 gap-1">
                <SlotLabel>
                  {slot.suggested_label ?? `Image ${slot.ordinal + 1}`}
                  {slot.required ? " *" : ""}
                </SlotLabel>
                {prefilledSlotProvenance?.[slot.key] && assignments[slot.key] && (
                  <span className="text-[13px] text-muted-foreground">
                    Prefilled from your {prefilledSlotProvenance[slot.key]}
                  </span>
                )}
              </span>
              <select
                className={cn(selectClassName, "sm:max-w-[280px]")}
                onChange={(event) => onAssign(slot.key, event.target.value || null)}
                value={assignments[slot.key] ?? ""}
              >
                <option value="">Unassigned</option>
                {photos.map((photo, index) => (
                  <option key={photo.id} value={photo.id}>
                    {String(index + 1).padStart(2, "0")} · {photo.filename}
                  </option>
                ))}
              </select>
            </ImageSlotRow>
          ))}
        </div>
      )}

      {textSlots.length > 0 && (
        <div className="flex flex-col gap-3">
          <GroupHeading filled={filledTexts} label="Print text" total={textSlots.length} />
          {textSlots.map((slot) => (
            <label className="flex flex-col gap-2" key={slot.key}>
              <SlotLabel>
                {slot.suggested_label ?? `Text ${slot.ordinal + 1}`}
                {slot.required ? " *" : ""}
              </SlotLabel>
              <input
                className={fieldControlClassName}
                maxLength={slot.max_length}
                onBlur={onTextCommit}
                onChange={(event) => onTextChange(slot.key, event.target.value)}
                value={textValues[slot.key] ?? ""}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
