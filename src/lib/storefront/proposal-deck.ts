/**
 * Pure state and geometry helpers for the proposal deck.
 *
 * The React component owns input and animation, but keeping selection and
 * wheel arithmetic here makes the two important invariants easy to exercise:
 * selection is an id (never a volatile array position), and a 37-card batch
 * cannot accidentally mount 37 live previews.
 */

export const PROPOSAL_DECK_MAX_PREVIEWS = 3;
export const PROPOSAL_DECK_MAX_PREVIEWS_DURING_EXIT = 4;
export const PROPOSAL_DECK_WHEEL_DISTANCE_PX = 240;
export const PROPOSAL_DECK_COMMIT_THRESHOLD = 0.35;
export const PROPOSAL_DECK_MAX_TRAVEL = 0.82;

/**
 * The ordered ids to keep mounted: the active card plus the cards around it.
 *
 * The window slides rather than only reaching forward. Reaching forward alone
 * collapsed the deck to a single card as soon as the active card was one of the
 * last two — a shopper answering a long batch would watch the stack silently
 * flatten to one card while a dozen proposals were still waiting behind it, with
 * nothing on screen suggesting the deck still had depth. Whenever at least
 * three proposals are pending, three are drawn.
 */
export function proposalPreviewWindow(
  orderedIds: readonly string[],
  activeId: string | null,
  exitingIds: readonly string[] = [],
): string[] {
  if (orderedIds.length === 0) return exitingIds.slice(0, PROPOSAL_DECK_MAX_PREVIEWS_DURING_EXIT);
  const activeIndex = Math.max(0, activeId ? orderedIds.indexOf(activeId) : 0);
  const start = Math.max(0, Math.min(activeIndex, orderedIds.length - PROPOSAL_DECK_MAX_PREVIEWS));
  const mounted = orderedIds.slice(start, start + PROPOSAL_DECK_MAX_PREVIEWS);
  const mountedLimit = exitingIds.length > 0
    ? PROPOSAL_DECK_MAX_PREVIEWS_DURING_EXIT
    : PROPOSAL_DECK_MAX_PREVIEWS;
  for (const id of exitingIds) {
    if (mounted.length >= mountedLimit) break;
    if (!mounted.includes(id)) mounted.push(id);
  }
  return mounted;
}

/**
 * Keeps a selected proposal when other cards arrive or leave. If its card was
 * answered elsewhere, choose the nearest surviving card at its old position.
 */
export function restoreActiveProposalId(
  activeId: string | null,
  previousOrderedIds: readonly string[],
  nextOrderedIds: readonly string[],
): string | null {
  if (nextOrderedIds.length === 0) return null;
  if (activeId && nextOrderedIds.includes(activeId)) return activeId;
  const previousIndex = activeId ? previousOrderedIds.indexOf(activeId) : -1;
  return nextOrderedIds[Math.max(0, Math.min(previousIndex < 0 ? 0 : previousIndex, nextOrderedIds.length - 1))] ?? null;
}

export function proposalIndex(orderedIds: readonly string[], activeId: string | null): number {
  const index = activeId ? orderedIds.indexOf(activeId) : -1;
  return index < 0 ? 0 : index;
}

export function adjacentProposalId(
  orderedIds: readonly string[],
  activeId: string | null,
  direction: -1 | 1,
): string | null {
  const index = proposalIndex(orderedIds, activeId);
  return orderedIds[index + direction] ?? null;
}

export function canNavigateProposal(
  orderedIds: readonly string[],
  activeId: string | null,
  direction: -1 | 1,
): boolean {
  return adjacentProposalId(orderedIds, activeId, direction) !== null;
}

/**
 * Converts a horizontal wheel delta into travel. At either edge the absent
 * direction receives only a small resisted nudge; callers can use that visual
 * feedback without treating it as a navigable wheel gesture.
 */
export function wheelProgress(
  progress: number,
  deltaPx: number,
  canGoPrevious: boolean,
  canGoNext: boolean,
): number {
  const delta = deltaPx / PROPOSAL_DECK_WHEEL_DISTANCE_PX;
  const requested = progress + delta;
  const direction = Math.sign(requested || delta);
  const available = direction > 0 ? canGoNext : canGoPrevious;
  const cap = available ? PROPOSAL_DECK_MAX_TRAVEL : 0.12;
  return Math.max(-cap, Math.min(cap, requested));
}

export function shouldCommitWheelProgress(progress: number): boolean {
  return Math.abs(progress) >= PROPOSAL_DECK_COMMIT_THRESHOLD;
}

/** Positive travel takes the active card left and brings its right neighbour in. */
export function proposalTravelGeometry(progress: number): {
  activeX: number;
  candidateX: number;
  candidateScale: number;
} {
  const amount = Math.min(PROPOSAL_DECK_MAX_TRAVEL, Math.abs(progress));
  const direction = Math.sign(progress) || 1;
  return {
    activeX: -96 * progress,
    candidateX: direction * 96 * (1 - amount),
    candidateScale: 0.96 + amount * 0.04,
  };
}

/**
 * How far one depth step of the deck fans out at rest, and how far it travels
 * per unit of normalised cursor position. The cursor runs from -1 (left/top
 * edge) to +1 (right/bottom edge); the cards behind the active one move to the
 * opposite corner, so a cursor in the upper-left puts the deck's tail in the
 * lower-right and vice versa. At dead centre only the rest fan remains, small
 * enough that the top card is fully readable but every edge behind it shows.
 */
export const PROPOSAL_DECK_REST = { x: 6, y: -5, rotate: 1.8 } as const;
export const PROPOSAL_DECK_SPREAD = { x: 13, y: 12, rotate: 1.6 } as const;
/** The active card leans a little toward the cursor, the near layer of the parallax. */
export const PROPOSAL_DECK_FOLLOW = { x: 4, y: 3, rotate: 0.5 } as const;
export const PROPOSAL_DECK_SCALE_STEP = 0.035;

export type DeckLayerGeometry = {
  /** Resting offset from the active card, before any cursor influence. */
  rest: { x: number; y: number; rotate: number };
  /** Per-unit cursor coefficients; negative values move against the cursor. */
  spread: { x: number; y: number; rotate: number };
  scale: number;
  opacity: number;
};

export function deckLayerGeometry(depth: number, side: -1 | 1 = 1): DeckLayerGeometry {
  if (depth <= 0) {
    return {
      rest: { x: 0, y: 0, rotate: 0 },
      spread: { x: PROPOSAL_DECK_FOLLOW.x, y: PROPOSAL_DECK_FOLLOW.y, rotate: PROPOSAL_DECK_FOLLOW.rotate },
      scale: 1,
      opacity: 1,
    };
  }
  return {
    // The rest fan always leans up and to the right, into the open corner of
    // the viewport, so the deepest card never slides off the bottom-left edge.
    rest: { x: PROPOSAL_DECK_REST.x * depth, y: PROPOSAL_DECK_REST.y * depth, rotate: side * -PROPOSAL_DECK_REST.rotate * depth },
    spread: { x: -PROPOSAL_DECK_SPREAD.x * depth, y: -PROPOSAL_DECK_SPREAD.y * depth, rotate: -PROPOSAL_DECK_SPREAD.rotate * depth },
    scale: 1 - PROPOSAL_DECK_SCALE_STEP * depth,
    opacity: 1 - 0.18 * depth,
  };
}

/** Normalises a viewport point to the -1..1 range the deck geometry expects. */
export function normalisedPointer(x: number, y: number, width: number, height: number): { x: number; y: number } {
  const clamp = (value: number) => Math.max(-1, Math.min(1, value));
  return {
    x: clamp((x / Math.max(1, width)) * 2 - 1),
    y: clamp((y / Math.max(1, height)) * 2 - 1),
  };
}
