/**
 * Keys for dragging a tray photograph onto a print slot.
 *
 * Ported from the studio schema editor's convention: a drag id carries its own
 * source and a drop id carries its own target, so a drop never has to consult
 * separate React state that may have moved on since the drag began. Parsing is
 * strict and returns null on anything unrecognised.
 */

/** Where a dragged photograph may land. */
export type PhotoDropTarget =
  /** A published template image slot, addressed by its stable contract key. */
  | { kind: "template_slot"; slotKey: string }
  /** A direct print, which has no slots and prints the tray selection. */
  | { kind: "direct_print" };

const DRAG_PREFIX = "photo:";
const SLOT_PREFIX = "slot:";
const DIRECT_KEY = "direct-print";

export function photoDragKey(photoId: string): string {
  return `${DRAG_PREFIX}${photoId}`;
}

export function parsePhotoDragKey(key: string): string | null {
  if (!key.startsWith(DRAG_PREFIX)) return null;
  const photoId = key.slice(DRAG_PREFIX.length);
  return photoId === "" ? null : photoId;
}

export function photoDropKey(target: PhotoDropTarget): string {
  return target.kind === "direct_print" ? DIRECT_KEY : `${SLOT_PREFIX}${target.slotKey}`;
}

export function parsePhotoDropKey(key: string): PhotoDropTarget | null {
  if (key === DIRECT_KEY) return { kind: "direct_print" };
  if (!key.startsWith(SLOT_PREFIX)) return null;
  // Slot keys are published contract keys and are never re-encoded here, so
  // the remainder is taken whole rather than split on a second separator.
  const slotKey = key.slice(SLOT_PREFIX.length);
  return slotKey === "" ? null : { kind: "template_slot", slotKey };
}
