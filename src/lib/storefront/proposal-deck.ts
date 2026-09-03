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
