"use client";

/* eslint-disable @next/next/no-img-element -- local object URLs are browser-only preview state. */

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEventHandler,
  type ReactNode,
} from "react";

import { PrintFrame } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  parsePhotoDragKey,
  parsePhotoDropKey,
  photoDragKey,
  photoDropKey,
  type PhotoDropTarget,
} from "@/lib/storefront/photo-drag";

export type { PhotoDropTarget };

/** The minimum a pointer must travel before a tray photograph starts moving.
 *  Below it the thumbnail's own click still selects, so one control does both. */
const DRAG_ACTIVATION_DISTANCE = 8;

/** How long a slot keeps its confirmation ring after a photograph lands. */
const SETTLE_MS = 520;

export type DraggablePhoto = {
  id: string;
  filename: string;
  previewURL: string;
};

type ActiveDrag = { photo: DraggablePhoto; ordinal: number };

type PhotoDragState = {
  activePhotoId: string | null;
  /** The drop key that just received a photograph, for a brief affirmation. */
  settledDropKey: string | null;
};

const PhotoDragStateContext = createContext<PhotoDragState>({ activePhotoId: null, settledDropKey: null });

/** Labels a drop target for the screen-reader announcements. */
function targetLabel(target: PhotoDropTarget): string {
  return target.kind === "direct_print" ? "the print crop" : `the ${target.slotKey} image slot`;
}

function announcementsFor(labelOf: (key: string) => string): Announcements {
  return {
    onDragStart: ({ active }) => `Picked up ${labelOf(String(active.id))}. Move over a print slot to assign it.`,
    onDragOver: ({ active, over }) => over
      ? `${labelOf(String(active.id))} is over ${labelOf(String(over.id))}.`
      : `${labelOf(String(active.id))} is not over a print slot.`,
    onDragEnd: ({ active, over }) => over
      ? `${labelOf(String(active.id))} was assigned to ${labelOf(String(over.id))}.`
      : `${labelOf(String(active.id))} was dropped outside a print slot and nothing changed.`,
    onDragCancel: ({ active }) => `Dropping ${labelOf(String(active.id))} was cancelled. Nothing changed.`,
  };
}

export type PhotoDragProviderProps = {
  children: ReactNode;
  /** Photographs currently in the tray, used for the overlay and announcements. */
  photos: DraggablePhoto[];
  /** Runs the storefront's existing assignment path. There is no second one. */
  onDropPhoto: (photoId: string, target: PhotoDropTarget) => void;
};

/**
 * Wraps the tray and the workbench in one drag context so a thumbnail can be
 * carried from the tray into a print slot that lives in another component.
 */
export function PhotoDragProvider({ children, onDropPhoto, photos }: PhotoDragProviderProps) {
  const [active, setActive] = useState<ActiveDrag | null>(null);
  const [settledDropKey, setSettledDropKey] = useState<string | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
  }, []);

  const sensors = useSensors(
    // A distance constraint is what keeps the thumbnail's click-to-select
    // alive: a press that never travels is a click, not a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE } }),
    useSensor(KeyboardSensor),
  );

  const labelOf = useCallback((key: string) => {
    const photoId = parsePhotoDragKey(key);
    if (photoId) {
      const index = photos.findIndex((photo) => photo.id === photoId);
      const photo = index < 0 ? null : photos[index]!;
      return photo ? `image ${index + 1}, ${photo.filename}` : "that photograph";
    }
    const target = parsePhotoDropKey(key);
    return target ? targetLabel(target) : "that area";
  }, [photos]);

  const accessibility = useMemo(() => ({ announcements: announcementsFor(labelOf) }), [labelOf]);

  function onDragStart({ active: dragged }: DragStartEvent) {
    const photoId = parsePhotoDragKey(String(dragged.id));
    const index = photoId === null ? -1 : photos.findIndex((photo) => photo.id === photoId);
    setActive(index < 0 ? null : { photo: photos[index]!, ordinal: index + 1 });
  }

  function onDragEnd({ active: dragged, over }: DragEndEvent) {
    setActive(null);
    if (!over) return;
    const photoId = parsePhotoDragKey(String(dragged.id));
    const target = parsePhotoDropKey(String(over.id));
    if (photoId === null || target === null) return;
    onDropPhoto(photoId, target);
    // The preview repaint is the real landing animation. This only holds a
    // confirmation ring on the slot long enough to be seen.
    const key = String(over.id);
    setSettledDropKey(key);
    if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      settleTimer.current = null;
      setSettledDropKey((current) => (current === key ? null : current));
    }, SETTLE_MS);
  }

  const state = useMemo<PhotoDragState>(
    () => ({ activePhotoId: active?.photo.id ?? null, settledDropKey }),
    [active, settledDropKey],
  );

  return <PhotoDragStateContext.Provider value={state}>
    <DndContext
      accessibility={accessibility}
      // Print slots repaint and resize as photographs land in them, so their
      // rectangles cannot be measured once and trusted.
      collisionDetection={pointerWithin}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragCancel={() => setActive(null)}
      onDragEnd={onDragEnd}
      onDragStart={onDragStart}
      sensors={sensors}
    >
      {children}
      {/* The slot repaints instantly, so a flight back to the tray would only
          contradict what the shopper already sees. */}
      <DragOverlay dropAnimation={null}>
        {active ? <div className="w-44 rotate-[1.5deg] opacity-95">
          <PrintFrame aspect="4 / 5" className="w-full shadow-warm" innerClassName="bg-surface-warm">
            <img alt="" className="size-full object-cover" src={active.photo.previewURL} />
          </PrintFrame>
        </div> : null}
      </DragOverlay>
    </DndContext>
  </PhotoDragStateContext.Provider>;
}

export type DraggablePhotoHandle = {
  connect: (node: HTMLElement | null) => void;
  connectHandle: (node: HTMLElement | null) => void;
  /** Pointer-only activation, for a thumbnail body that already has a click. */
  bodyProps: { onPointerDown: PointerEventHandler<Element> | undefined };
  /** Full activation including keyboard, for a dedicated drag handle. */
  handleProps: Record<string, unknown>;
  isDragging: boolean;
};

/**
 * Makes one tray photograph draggable.
 *
 * The thumbnail body takes the pointer activator only. Its keyboard activator
 * goes on a separate handle instead, because the body is already a button that
 * selects the photograph and Space must keep doing that.
 */
export function useDraggablePhoto(photo: DraggablePhoto, disabled: boolean): DraggablePhotoHandle {
  // Renamed on the way out: an ESLint rule treats any `*Ref` name as a ref that
  // must not be read while rendering, and these are connectors, not refs.
  const { attributes, isDragging, listeners, setActivatorNodeRef: connectHandle, setNodeRef: connect } = useDraggable({
    disabled,
    id: photoDragKey(photo.id),
  });
  const pointerDown = listeners?.onPointerDown as PointerEventHandler<Element> | undefined;
  return {
    bodyProps: { onPointerDown: disabled ? undefined : pointerDown },
    handleProps: disabled ? {} : { ...attributes, ...listeners },
    isDragging,
    connectHandle,
    connect,
  };
}

export type PhotoDropTargetState = {
  connect: (node: HTMLElement | null) => void;
  isOver: boolean;
  isDragActive: boolean;
  settled: boolean;
};

/**
 * Marks a region as somewhere a tray photograph may land.
 *
 * This attaches a ref and nothing else. No pointer handler is added, so a slot
 * that already pans its photograph on pointer-down keeps that behaviour whole.
 */
export function usePhotoDropTarget(target: PhotoDropTarget, disabled = false): PhotoDropTargetState {
  const key = photoDropKey(target);
  const { isOver, setNodeRef: connect } = useDroppable({ disabled, id: key });
  const { activePhotoId, settledDropKey } = useContext(PhotoDragStateContext);
  return {
    isDragActive: !disabled && activePhotoId !== null,
    isOver: !disabled && isOver,
    connect,
    settled: !disabled && settledDropKey === key,
  };
}

/** The highlight half of a drop target, without its connector. Keeping the two
 *  apart lets a caller destructure and never hand a connector to a function. */
export type PhotoDropHighlight = Omit<PhotoDropTargetState, "connect">;

/** Drop affordances, kept on the app's existing ring vocabulary. */
export function photoDropTargetClassName({ isDragActive, isOver, settled }: PhotoDropHighlight): string {
  return cn(
    "transition-[box-shadow,background-color] duration-200 ease-[var(--ease-out-expo)] motion-reduce:transition-none",
    isOver
      ? "ring-2 ring-primary bg-primary/10"
      : settled
        ? "ring-2 ring-primary/70"
        : isDragActive
          ? "ring-2 ring-primary/30"
          : "",
  );
}
