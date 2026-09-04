/**
 * Survives a reload.
 *
 * Everything the shopper builds — drafts, slot assignments, framing, the demo
 * cart, the cards waiting in the corner — lives in React state, so a hot reload
 * or an accidental refresh used to empty the workbench. This module writes that
 * state down and reads it back.
 *
 * Two rules shape the whole format:
 *
 * 1. **References, never bytes.** Photographs stay where they are; a snapshot
 *    records only which photograph a slot named, as a `stableKey` (see
 *    `photo-library.ts`). No blob, data URL or object URL is ever stored — an
 *    object URL is dead the moment the page unloads, and image bytes would blow
 *    the storage quota on the first folder of portraits.
 * 2. **A restore is never a crash.** A malformed, foreign or older snapshot is
 *    discarded silently. A photograph that does not come back leaves its slot
 *    unassigned and its requirement listed, which is a state the workbench
 *    already knows how to display and the tools already know how to explain.
 */
import type { CartProposal, LocalCartItem } from "./local-cart";
import type { BrowserPhoto } from "./photo-library";
import { photoIdsByStableKey } from "./photo-library.ts";
import type { PhotoRole, PhotoRoleMemory } from "./photo-role-defaults";
import type { PrintDraft } from "./print-drafts";

/**
 * Bumped whenever a field changes meaning. A snapshot written by any other
 * version is thrown away rather than migrated: this is one browser tab's
 * scratch space, and a wrong restore is worse than an empty one.
 */
export const WORKBENCH_SCHEMA_VERSION = 1;

/** The single localStorage key this module owns. Nothing else writes it. */
export const WORKBENCH_STORAGE_KEY = "batchrelay-storefront-workbench-v1";

/** Long enough to coalesce a drag's worth of framing commits, short enough that
 *  a refresh a third of a second after an edit still keeps it. */
export const WORKBENCH_WRITE_DEBOUNCE_MS = 300;

/** Just enough of `Storage`, so tests can supply a literal. */
export type WorkbenchStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** Thumbnails are object URLs, which do not survive; they re-derive on restore. */
export type PersistedCartItem = Omit<LocalCartItem, "thumbnailURL">;
export type PersistedCartProposal = Omit<CartProposal, "thumbnailURL">;

export type WorkbenchStep = "catalog" | "prepare";

/** Everything worth writing down, with the bookkeeping fields left off. */
export type WorkbenchState = {
  /** Current photo id to stable key, which is what makes the rest re-linkable. */
  photoKeys: Record<string, string>;
  drafts: PrintDraft[];
  cart: PersistedCartItem[];
  proposals: PersistedCartProposal[];
  /** Role memory travels by stable key, never by this session's photo ids. */
  roleMemory: Partial<Record<PhotoRole, string>>;
  backgroundDraftIds: string[];
  selectedDraftId: string | null;
  selectedProductKey: string | null;
  step: WorkbenchStep;
  directCrop: { zoom: number; focusX: number; focusY: number };
};

export type WorkbenchSnapshot = WorkbenchState & {
  version: number;
  savedAt: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Shallow but load-bearing: every field the restore path indexes into is
 * checked for its container type, so a truncated or hand-edited snapshot fails
 * here rather than halfway through rebuilding the workbench.
 */
function isWorkbenchSnapshot(value: unknown): value is WorkbenchSnapshot {
  if (!isRecord(value)) return false;
  if (value.version !== WORKBENCH_SCHEMA_VERSION) return false;
  if (!Array.isArray(value.drafts) || !value.drafts.every(isRecord)) return false;
  if (!Array.isArray(value.cart) || !value.cart.every(isRecord)) return false;
  if (!Array.isArray(value.proposals) || !value.proposals.every(isRecord)) return false;
  if (!Array.isArray(value.backgroundDraftIds)) return false;
  if (!isRecord(value.photoKeys) || !isRecord(value.roleMemory)) return false;
  if (value.step !== "catalog" && value.step !== "prepare") return false;
  return true;
}

/** Assembles a snapshot's payload, stripping everything that cannot survive. */
export function workbenchState({
  photos,
  drafts,
  cart,
  proposals,
  roleMemory,
  backgroundDraftIds,
  selectedDraftId,
  selectedProductKey,
  step,
  directCrop,
}: {
  photos: readonly Pick<BrowserPhoto, "id" | "stableKey">[];
  drafts: readonly PrintDraft[];
  cart: readonly LocalCartItem[];
  proposals: readonly CartProposal[];
  roleMemory: PhotoRoleMemory;
  backgroundDraftIds: Iterable<string>;
  selectedDraftId: string | null;
  selectedProductKey: string | null;
  step: WorkbenchStep;
  directCrop: { zoom: number; focusX: number; focusY: number };
}): WorkbenchState {
  const keyByPhotoId: Record<string, string> = {};
  for (const photo of photos) if (photo.stableKey) keyByPhotoId[photo.id] = photo.stableKey;
  return {
    photoKeys: keyByPhotoId,
    drafts: [...drafts],
    // Thumbnails are object URLs. Named explicitly rather than spread-and-
    // delete, so a field added to a cart line later is a decision here.
    cart: cart.map(({ id, draftId, productId, productName, quantity, source, draft, addedAt }) =>
      ({ id, draftId, productId, productName, quantity, source, draft, addedAt })),
    proposals: proposals.map(({ id, draftId, productId, productName, quantity, source, draft, createdAt }) =>
      ({ id, draftId, productId, productName, quantity, source, draft, createdAt })),
    roleMemory: Object.fromEntries(Object.entries(roleMemory).flatMap(([role, photoId]) =>
      photoId && keyByPhotoId[photoId] ? [[role, keyByPhotoId[photoId]!]] : [])),
    backgroundDraftIds: [...backgroundDraftIds],
    selectedDraftId,
    selectedProductKey,
    step,
    directCrop,
  };
}

/**
 * Writes the snapshot. Never throws: a full quota, a private-browsing storage
 * that refuses writes, or a serialization failure all degrade to the previous
 * behaviour — an in-memory workbench — with one line in the console.
 */
export function writeWorkbenchSnapshot(
  storage: WorkbenchStorage,
  state: WorkbenchState,
  now: () => string = () => new Date().toISOString(),
): boolean {
  try {
    const snapshot: WorkbenchSnapshot = { ...state, version: WORKBENCH_SCHEMA_VERSION, savedAt: now() };
    storage.setItem(WORKBENCH_STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch (error) {
    console.warn("The workbench could not be saved to this browser's local storage.", error);
    return false;
  }
}

/** The stored snapshot, or null. Anything unreadable is discarded on the spot. */
export function readWorkbenchSnapshot(storage: WorkbenchStorage): WorkbenchSnapshot | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(WORKBENCH_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearWorkbenchSnapshot(storage);
    return null;
  }
  if (!isWorkbenchSnapshot(parsed)) {
    clearWorkbenchSnapshot(storage);
    return null;
  }
  return parsed;
}

export function clearWorkbenchSnapshot(storage: WorkbenchStorage): void {
  try {
    storage.removeItem(WORKBENCH_STORAGE_KEY);
  } catch {
    // Nothing to do and nothing to say: the next write will fail the same way.
  }
}

export type WorkbenchWriter = {
  /** Queues a write, replacing any write still waiting. */
  save(state: WorkbenchState): void;
  /** Writes immediately if one is queued. */
  flush(): void;
  /** Drops a queued write without performing it. */
  cancel(): void;
};

/**
 * A debounced write-through. Framing a photograph commits a new draft on every
 * mouse release; writing on each one would serialize the whole workbench
 * dozens of times during a single drag.
 */
export function createWorkbenchWriter(
  storage: WorkbenchStorage,
  {
    delayMs = WORKBENCH_WRITE_DEBOUNCE_MS,
    schedule = (callback: () => void, ms: number) => setTimeout(callback, ms) as unknown as number,
    unschedule = (handle: number) => clearTimeout(handle),
    now,
  }: {
    delayMs?: number;
    schedule?: (callback: () => void, ms: number) => number;
    unschedule?: (handle: number) => void;
    now?: () => string;
  } = {},
): WorkbenchWriter {
  let handle: number | null = null;
  let queued: WorkbenchState | null = null;
  const write = () => {
    handle = null;
    const state = queued;
    queued = null;
    if (state) writeWorkbenchSnapshot(storage, state, now);
  };
  return {
    save(state) {
      queued = state;
      if (handle !== null) unschedule(handle);
      handle = schedule(write, delayMs);
    },
    flush() {
      if (handle !== null) unschedule(handle);
      write();
    },
    cancel() {
      if (handle !== null) unschedule(handle);
      handle = null;
      queued = null;
    },
  };
}

/**
 * How many changes back the workbench can be walked. Ten covers a demo's worth
 * of agent actions without holding a serialized workbench per keystroke.
 */
export const WORKBENCH_HISTORY_LIMIT = 10;

/** One pre-mutation snapshot, labelled with the change that followed it. */
export type WorkbenchHistoryEntry = {
  /** What was about to happen, e.g. "revise_prints framing across 5 drafts". */
  label: string;
  state: WorkbenchState;
};

export type WorkbenchUndo = {
  /** The workbench as it stood before the undone changes. */
  state: WorkbenchState;
  /** The most recent change undone, for the line the shopper is shown. */
  label: string;
  /** Every change undone, newest first — longer than one only for multi-step. */
  labels: string[];
  /** How many changes were actually walked back, which may be fewer than asked. */
  undoneCount: number;
};

export type WorkbenchRedo = {
  /** The workbench as it stood after the re-applied changes. */
  state: WorkbenchState;
  /** The most recent change re-applied, for the line the shopper is shown. */
  label: string;
  /** Every change re-applied, oldest first — longer than one only for multi-step. */
  labels: string[];
  /** How many changes were actually re-applied. */
  redoneCount: number;
};

type WorkbenchRedoEntry = {
  label: string;
  /** State after this one original change. */
  state: WorkbenchState;
  /** The pre-mutation state to put back on the undo stack after a redo. */
  undoEntry: WorkbenchHistoryEntry;
};

/**
 * A bounded stack of pre-mutation snapshots.
 *
 * Deliberately a ring rather than unbounded history: this is a browser tab's
 * scratch space, each entry is a whole serialized workbench, and a shopper who
 * wants to go back twenty changes wants a reload, not an undo.
 *
 * Snapshots are pushed *before* a change applies, so undoing one restores the
 * state that change started from. Nothing here writes storage — the debounced
 * writer already saves whatever the workbench currently holds, which after a
 * restore is the restored state.
 */
export type WorkbenchHistory = {
  /** Records the state a change is about to modify. */
  push(label: string, state: WorkbenchState): void;
  /** Walks back up to `steps` changes, or null when there is nothing to undo. */
  undo(currentState: WorkbenchState, steps?: number): WorkbenchUndo | null;
  /** Re-applies up to `steps` changes that were previously undone. */
  redo(steps?: number): WorkbenchRedo | null;
  /** How many changes can still be walked back. */
  depth(): number;
  /** How many changes can still be re-applied. */
  redoDepth(): number;
  /** The pending labels, newest first. Read-only; for describing the history. */
  labels(): string[];
  clear(): void;
};

export function createWorkbenchHistory(limit: number = WORKBENCH_HISTORY_LIMIT): WorkbenchHistory {
  // Oldest first, so the newest entry is the last one — a plain array is the
  // right shape at this size, and shift() past the limit is the whole ring.
  const entries: WorkbenchHistoryEntry[] = [];
  const redos: WorkbenchRedoEntry[] = [];
  return {
    push(label, state) {
      if (limit <= 0) return;
      entries.push({ label, state });
      while (entries.length > limit) entries.shift();
      // A new change forks history: an old redo would restore a different
      // future than the shopper can now see.
      redos.length = 0;
    },
    undo(currentState, steps = 1) {
      if (entries.length === 0) return null;
      // Asking to go back further than the ring holds walks back as far as it
      // can and says how far it got, rather than refusing a reachable undo.
      const requested = Number.isInteger(steps) && steps > 0 ? steps : 1;
      const undoneCount = Math.min(requested, entries.length);
      const removed = entries.splice(entries.length - undoneCount, undoneCount);
      const oldest = removed[0]!;
      const labels = [...removed].reverse().map((entry) => entry.label);
      // Every removed pre-state gets a corresponding after-state. Walking
      // backward twice means the first redo returns to the intermediate state,
      // then the next one returns to the original present.
      let stateAfter = currentState;
      for (const entry of [...removed].reverse()) {
        redos.push({ label: entry.label, state: stateAfter, undoEntry: entry });
        stateAfter = entry.state;
      }
      return { state: oldest.state, label: labels[0]!, labels, undoneCount };
    },
    redo(steps = 1) {
      if (redos.length === 0) return null;
      const requested = Number.isInteger(steps) && steps > 0 ? steps : 1;
      const redone: WorkbenchRedoEntry[] = [];
      for (let index = 0; index < requested; index += 1) {
        const entry = redos.pop();
        if (!entry) break;
        redone.push(entry);
        entries.push(entry.undoEntry);
        while (entries.length > limit) entries.shift();
      }
      const latest = redone[redone.length - 1]!;
      return {
        state: latest.state,
        label: latest.label,
        labels: redone.map((entry) => entry.label),
        redoneCount: redone.length,
      };
    },
    depth() {
      return entries.length;
    },
    redoDepth() {
      return redos.length;
    },
    labels() {
      return [...entries].reverse().map((entry) => entry.label);
    },
    clear() {
      entries.length = 0;
      redos.length = 0;
    },
  };
}

/**
 * Wraps a bare state in the snapshot envelope, so an undo goes back through the
 * very same relink-and-apply path a reload restore uses. There is deliberately
 * no second restore implementation to drift from the proven one.
 */
export function workbenchSnapshotFromState(
  state: WorkbenchState,
  now: () => string = () => new Date().toISOString(),
): WorkbenchSnapshot {
  return { ...state, version: WORKBENCH_SCHEMA_VERSION, savedAt: now() };
}

export type WorkbenchRestore = {
  drafts: PrintDraft[];
  cart: LocalCartItem[];
  proposals: CartProposal[];
  roleMemory: PhotoRoleMemory;
  backgroundDraftIds: string[];
  selectedDraftId: string | null;
  selectedProductKey: string | null;
  step: WorkbenchStep;
  directCrop: { zoom: number; focusX: number; focusY: number };
  /** How many drafts came back, whatever state their photographs are in. */
  restoredDraftCount: number;
  /** Distinct photographs a restored draft named that the tray does not hold. */
  unlinkedPhotoCount: number;
  /** The stable keys still unaccounted for, so a later import can try again. */
  unlinkedPhotoKeys: string[];
};

type RelinkContext = {
  idByOldId: Map<string, string>;
  keyByOldId: Record<string, string>;
  unlinkedKeys: Set<string>;
  unlinkedIds: Set<string>;
};

/** Resolves one recorded photo id against the tray as it stands now. */
function relinkPhotoId(context: RelinkContext, oldId: string): string | null {
  const resolved = context.idByOldId.get(oldId);
  if (resolved) return resolved;
  context.unlinkedIds.add(oldId);
  const key = context.keyByOldId[oldId];
  if (key) context.unlinkedKeys.add(key);
  return null;
}

/**
 * A draft with its photo references translated to this session's ids.
 *
 * Unresolvable references are dropped rather than left dangling. A dangling id
 * would paint nothing while still reading as a filled slot, so the draft would
 * claim to be complete and `add_to_cart` would accept it; dropping the
 * assignment puts the slot back on the missing-requirements list, which is
 * exactly what the shopper needs to be told.
 *
 * Slot framing is deliberately kept for slots that lost their photograph: it is
 * keyed by slot, not by photo, and re-dropping the same picture should land it
 * where the shopper had put it.
 */
function relinkDraft(context: RelinkContext, draft: PrintDraft): PrintDraft {
  return {
    ...draft,
    photoIds: draft.photoIds.flatMap((photoId) => {
      const resolved = relinkPhotoId(context, photoId);
      return resolved ? [resolved] : [];
    }),
    slotAssignments: Object.fromEntries(Object.entries(draft.slotAssignments).flatMap(([slotKey, photoId]) => {
      const resolved = relinkPhotoId(context, photoId);
      return resolved ? [[slotKey, resolved]] : [];
    })),
  };
}

/** The thumbnail rule the workbench itself uses, re-applied after a restore. */
function restoredThumbnailURL(
  draft: PrintDraft,
  photos: readonly Pick<BrowserPhoto, "id" | "previewURL">[],
): string | null {
  const photoId = Object.values(draft.slotAssignments)[0] ?? draft.photoIds[0];
  return photos.find((photo) => photo.id === photoId)?.previewURL ?? null;
}

/**
 * Turns a snapshot back into live workbench values against the tray as it
 * stands right now.
 *
 * Pure and idempotent, which is what lets the caller run it again when a second
 * batch of photographs lands: the same snapshot plus a fuller tray simply
 * re-links more of it.
 */
export function relinkWorkbenchSnapshot(
  snapshot: WorkbenchSnapshot,
  photos: readonly Pick<BrowserPhoto, "id" | "stableKey" | "previewURL">[],
): WorkbenchRestore {
  const idByKey = photoIdsByStableKey(photos);
  const context: RelinkContext = {
    idByOldId: new Map(Object.entries(snapshot.photoKeys).flatMap(([oldId, key]) =>
      idByKey[key] ? [[oldId, idByKey[key]!] as [string, string]] : [])),
    keyByOldId: snapshot.photoKeys,
    unlinkedKeys: new Set(),
    unlinkedIds: new Set(),
  };
  const drafts = snapshot.drafts.map((draft) => relinkDraft(context, draft));
  const cart = snapshot.cart.map((item) => {
    const draft = relinkDraft(context, item.draft);
    return { ...item, draft, thumbnailURL: restoredThumbnailURL(draft, photos) };
  });
  const proposals = snapshot.proposals.map((proposal) => {
    const draft = relinkDraft(context, proposal.draft);
    return { ...proposal, draft, thumbnailURL: restoredThumbnailURL(draft, photos) };
  });
  const roleMemory: Record<string, string> = {};
  for (const [role, key] of Object.entries(snapshot.roleMemory)) {
    const photoId = key ? idByKey[key] : undefined;
    if (photoId) roleMemory[role] = photoId;
  }
  const draftIds = new Set(drafts.map((draft) => draft.id));
  return {
    drafts,
    cart,
    proposals,
    roleMemory: roleMemory as PhotoRoleMemory,
    backgroundDraftIds: snapshot.backgroundDraftIds.filter((id) => draftIds.has(id)),
    selectedDraftId: snapshot.selectedDraftId && draftIds.has(snapshot.selectedDraftId)
      ? snapshot.selectedDraftId
      : null,
    selectedProductKey: snapshot.selectedProductKey,
    step: snapshot.step,
    directCrop: snapshot.directCrop,
    restoredDraftCount: drafts.length,
    unlinkedPhotoCount: context.unlinkedIds.size,
    unlinkedPhotoKeys: [...context.unlinkedKeys],
  };
}

/** The one quiet line the shopper is told after a reload, or nothing to say. */
export function restoreNotice(restore: WorkbenchRestore): string | null {
  if (restore.restoredDraftCount === 0 && restore.cart.length === 0 && restore.proposals.length === 0) return null;
  const drafts = `Restored ${restore.restoredDraftCount} draft${restore.restoredDraftCount === 1 ? "" : "s"}`;
  return restore.unlinkedPhotoCount === 0
    ? `${drafts}.`
    : `${drafts}; ${restore.unlinkedPhotoCount} photograph${restore.unlinkedPhotoCount === 1 ? "" : "s"} could not be re-linked.`;
}
