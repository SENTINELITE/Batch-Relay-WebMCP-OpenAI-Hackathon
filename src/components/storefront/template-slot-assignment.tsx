"use client";

import type { ReactNode } from "react";

import { fieldControlClassName } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { TemplateContract } from "@/lib/storefront/client";

type AssignablePhoto = {
  id: string;
  filename: string;
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

const rowClassName =
  "grid items-center gap-3 rounded-[14px] border border-border bg-background/60 p-3 sm:grid-cols-[minmax(140px,.7fr)_minmax(0,1.3fr)]";

const selectClassName = cn(
  fieldControlClassName,
  "appearance-none bg-[image:var(--select-chevron)] bg-[position:right_16px_center] bg-[length:18px_18px] bg-no-repeat pr-11",
);

function ImageSlotRow({ children, slotKey }: { children: ReactNode; slotKey: string }) {
  return <label className={rowClassName} data-slot-key={slotKey}>{children}</label>;
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
  return <div className="grid gap-3" aria-label="Template slot assignments">
    <div className="grid gap-1">
      <p className="text-base font-semibold text-foreground">Template inputs</p>
      <p className="text-sm text-muted-foreground">Assign photographs using the published stable slot keys. Nothing is matched by a guessed label.</p>
    </div>
    {slots.map((slot) => slot.kind === "image" ? <ImageSlotRow key={slot.key} slotKey={slot.key}>
      <span className="grid min-w-0 gap-1">
        <span className="text-sm font-semibold text-foreground">{slot.suggested_label ?? `Image ${slot.ordinal + 1}`}{slot.required ? " *" : ""}</span>
        <span className="font-mono text-[13px] break-words text-muted-foreground">{slot.key}</span>
        {prefilledSlotProvenance?.[slot.key] && assignments[slot.key] && <span className="text-[13px] text-muted-foreground">Prefilled from your {prefilledSlotProvenance[slot.key]}</span>}
      </span>
      <select className={selectClassName} value={assignments[slot.key] ?? ""} onChange={(event) => onAssign(slot.key, event.target.value || null)}>
        <option value="">Unassigned</option>
        {photos.map((photo, index) => <option key={photo.id} value={photo.id}>{String(index + 1).padStart(2, "0")} · {photo.filename}</option>)}
      </select>
    </ImageSlotRow> : <label className={rowClassName} key={slot.key}>
      <span className="grid min-w-0 gap-1">
        <span className="text-sm font-semibold text-foreground">{slot.suggested_label ?? `Text ${slot.ordinal + 1}`}{slot.required ? " *" : ""}</span>
        <span className="font-mono text-[13px] break-words text-muted-foreground">{slot.key}</span>
      </span>
      <input
        className={fieldControlClassName}
        maxLength={slot.max_length}
        onBlur={onTextCommit}
        onChange={(event) => onTextChange(slot.key, event.target.value)}
        value={textValues[slot.key] ?? ""}
      />
    </label>)}
  </div>;
}
