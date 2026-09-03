"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { CartProposalCard } from "@/components/storefront/cart-proposal-card";
import {
  PROPOSAL_DECK_MAX_PREVIEWS,
  adjacentProposalId,
  proposalIndex,
  proposalPreviewWindow,
  proposalTravelGeometry,
  restoreActiveProposalId,
  shouldCommitWheelProgress,
  wheelProgress as nextWheelProgress,
} from "@/lib/storefront/proposal-deck";
import type { CartProposal, CartProposalStackEntry } from "@/lib/storefront/local-cart";
import type { PrintReview } from "@/lib/storefront/print-review";

export type CartProposalStackProps = {
  entries: readonly CartProposalStackEntry[];
  previewFor: (proposal: CartProposal) => {
    aspect: string;
    templatePreview: ReactNode | null;
    review: PrintReview;
    foundInCatalog: boolean;
  };
  onAccept: (proposal: CartProposal) => void;
  onReject: (proposal: CartProposal) => void;
};

const WHEEL_SETTLE_MS = 140;
const PEEK_RIGHT_PX = 11;
const FAN_RIGHT_PX = 30;
const PEEK_UP_PX = 10;
const SCALE_STEP = 0.045;

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

function layerStyle({
  depth,
  side = 1,
  fan,
  travel,
  active,
  candidate,
}: {
  depth: number;
  side?: -1 | 1;
  fan: boolean;
  travel: number;
  active: boolean;
  candidate: boolean;
}): CSSProperties {
  const amount = Math.abs(travel);
  const geometry = proposalTravelGeometry(travel);
  const scale = 1 - SCALE_STEP * depth;
  const right = (fan ? FAN_RIGHT_PX : PEEK_RIGHT_PX) * depth;
  const up = PEEK_UP_PX * depth;
  if (active) return {
    transform: `translate(${geometry.activeX}px, 0) scale(${1 - amount * 0.02})`,
    opacity: 1 - amount * 0.08,
    zIndex: 100,
  };
  if (candidate && amount > 0) return {
    transform: `translate(${geometry.candidateX}px, 0) scale(${geometry.candidateScale})`,
    opacity: 0.82 + amount * 0.18,
    zIndex: 101,
  };
  return {
    transform: `translate(${side * right}px, ${-up}px) scale(${scale})`,
    opacity: 1 - 0.18 * depth,
    zIndex: 100 - depth,
  };
}

/**
 * A cursor- and keyboard-browseable proposal deck. Selection is an id, never
 * an array index, so staging or resolving another card cannot replace the card
 * the shopper was reviewing. Only three preview trees mount at once, with one
 * temporary fourth tree available for an exit flight.
 */
export function CartProposalStack({ entries, previewFor, onAccept, onReject }: CartProposalStackProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingEntries = useMemo(() => [...entries].filter((entry) => !entry.exit).reverse(), [entries]);
  const pendingIds = useMemo(() => pendingEntries.map((entry) => entry.proposal.id), [pendingEntries]);
  const exitingIds = useMemo(() => entries.filter((entry) => entry.exit).map((entry) => entry.proposal.id), [entries]);
  const [activeProposalId, setActiveProposalId] = useState<string | null>(() => pendingIds[0] ?? null);
  const [announcement, setAnnouncement] = useState("");
  const [wheelTravel, setWheelTravel] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const previousPendingIds = useRef(pendingIds);
  const wheelTravelRef = useRef(0);
  const wheelDeltaRef = useRef(0);
  const wheelFrameRef = useRef<number | null>(null);
  const wheelSettleRef = useRef<number | null>(null);
  const wheelConsumedRef = useRef(false);
  const focusRecoveryRef = useRef(false);
  const seenProposalIds = useRef(new Set<string>());
  const commitSelectionRef = useRef<(id: string) => void>(() => undefined);
  const pendingIdsRef = useRef(pendingIds);
  const activeIdRef = useRef(activeProposalId);
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const finePointer = useMediaQuery("(hover: hover) and (pointer: fine)");
  const [arrivalProposalId, setArrivalProposalId] = useState<string | null>(null);

  // The layout effect below restores a removed id to its nearest survivor
  // before paint. This render fallback only covers the first mounted frame.
  const activeId = activeProposalId && pendingIds.includes(activeProposalId)
    ? activeProposalId
    : pendingIds[0] ?? null;
  const activeIndex = proposalIndex(pendingIds, activeId);
  const fan = !prefersReducedMotion && finePointer && (hovered || focusWithin);

  useLayoutEffect(() => {
    const previous = previousPendingIds.current;
    const restored = restoreActiveProposalId(activeProposalId, previous, pendingIds);
    if (restored !== activeProposalId) {
      focusRecoveryRef.current = Boolean(rootRef.current?.contains(document.activeElement));
      setActiveProposalId(restored);
      if (previous.length > 0 && restored) {
        setAnnouncement(`Proposal ${proposalIndex(pendingIds, restored) + 1} of ${pendingIds.length}`);
      }
    }
    // One new active card may enter. Mark the whole batch seen immediately so
    // its background layers, and cards mounted later while browsing, settle in
    // place instead of replaying an arrival animation.
    if (restored && !seenProposalIds.current.has(restored) && !previous.includes(restored)) {
      setArrivalProposalId(restored);
    }
    for (const id of pendingIds) seenProposalIds.current.add(id);
    previousPendingIds.current = pendingIds;
  }, [activeProposalId, pendingIds]);

  useEffect(() => {
    if (!arrivalProposalId) return;
    const timer = window.setTimeout(() => {
      setArrivalProposalId((current) => current === arrivalProposalId ? null : current);
    }, 240);
    return () => window.clearTimeout(timer);
  }, [arrivalProposalId]);

  useEffect(() => {
    pendingIdsRef.current = pendingIds;
    activeIdRef.current = activeId;
  }, [activeId, pendingIds]);

  useEffect(() => {
    if (!focusRecoveryRef.current || !activeId) return;
    focusRecoveryRef.current = false;
    rootRef.current?.querySelector<HTMLButtonElement>("[data-proposal-primary-action]")?.focus({ preventScroll: true });
  }, [activeId]);

  const clearWheelMotion = useCallback(() => {
    wheelDeltaRef.current = 0;
    wheelTravelRef.current = 0;
    setWheelTravel(0);
  }, []);

  const commitSelection = useCallback((id: string) => {
    const ids = pendingIdsRef.current;
    if (!ids.includes(id) || id === activeIdRef.current) {
      clearWheelMotion();
      return;
    }
    setActiveProposalId(id);
    activeIdRef.current = id;
    setAnnouncement(`Proposal ${proposalIndex(ids, id) + 1} of ${ids.length}`);
    clearWheelMotion();
  }, [clearWheelMotion]);
  useEffect(() => {
    commitSelectionRef.current = commitSelection;
  }, [commitSelection]);

  const settleWheel = useCallback(() => {
    if (wheelSettleRef.current !== null) window.clearTimeout(wheelSettleRef.current);
    wheelSettleRef.current = window.setTimeout(() => {
      wheelSettleRef.current = null;
      const travel = wheelTravelRef.current;
      const direction = Math.sign(travel) as -1 | 0 | 1;
      const target = direction ? adjacentProposalId(pendingIdsRef.current, activeIdRef.current, direction) : null;
      if (!wheelConsumedRef.current && target && shouldCommitWheelProgress(travel)) {
        wheelConsumedRef.current = true;
        commitSelectionRef.current(target);
      } else {
        clearWheelMotion();
      }
      // Continuous wheel input can traverse one card only; it unlocks after
      // the quiet settle interval instead of turning a single swipe into 37.
      wheelConsumedRef.current = false;
    }, WHEEL_SETTLE_MS);
  }, [clearWheelMotion]);

  const flushWheel = useCallback(() => {
    wheelFrameRef.current = null;
    const delta = wheelDeltaRef.current;
    wheelDeltaRef.current = 0;
    if (!delta || prefersReducedMotion || wheelConsumedRef.current) return;
    const ids = pendingIdsRef.current;
    const current = activeIdRef.current;
    const next = nextWheelProgress(
      wheelTravelRef.current,
      delta,
      adjacentProposalId(ids, current, -1) !== null,
      adjacentProposalId(ids, current, 1) !== null,
    );
    wheelTravelRef.current = next;
    setWheelTravel(next);
  }, [prefersReducedMotion]);

  const onWheel = useCallback((event: globalThis.WheelEvent) => {
    if (prefersReducedMotion) return;
    const dominantDelta = event.shiftKey
      ? event.deltaY
      : Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : 0;
    if (!dominantDelta) return; // preserve normal vertical page scrolling.
    const delta = dominantDelta * (event.deltaMode === 1 ? 16 : 1);
    const direction = Math.sign(delta) as -1 | 0 | 1;
    const reversing = wheelTravelRef.current !== 0 && Math.sign(wheelTravelRef.current) !== direction;
    const navigable = direction !== 0 && (reversing || adjacentProposalId(pendingIdsRef.current, activeIdRef.current, direction) !== null);
    // At an edge, retain the browser's horizontal scroll but let the deck make
    // a tiny resisted nudge before it snaps back. It is feedback, never a card
    // change, and intentionally does not call preventDefault.
    if (!navigable) {
      if (!wheelConsumedRef.current) {
        wheelDeltaRef.current += delta;
        if (wheelFrameRef.current === null) wheelFrameRef.current = window.requestAnimationFrame(flushWheel);
      }
      settleWheel();
      return;
    }
    event.preventDefault();
    if (!wheelConsumedRef.current) {
      wheelDeltaRef.current += delta;
      if (wheelFrameRef.current === null) wheelFrameRef.current = window.requestAnimationFrame(flushWheel);
    }
    settleWheel();
  }, [flushWheel, prefersReducedMotion, settleWheel]);

  // React may delegate wheel listeners as passive. The deck only cancels a
  // horizontal event with a real adjacent card, so subscribe natively with an
  // explicit non-passive listener and leave ordinary page scrolling alone.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  useEffect(() => () => {
    if (wheelFrameRef.current !== null) window.cancelAnimationFrame(wheelFrameRef.current);
    if (wheelSettleRef.current !== null) window.clearTimeout(wheelSettleRef.current);
  }, []);

  const selectRelative = useCallback((direction: -1 | 1) => {
    const target = adjacentProposalId(pendingIdsRef.current, activeIdRef.current, direction);
    if (target) commitSelection(target);
  }, [commitSelection]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") { event.preventDefault(); selectRelative(-1); }
    else if (event.key === "ArrowRight") { event.preventDefault(); selectRelative(1); }
    else if (event.key === "Home" && pendingIdsRef.current[0]) {
      event.preventDefault();
      commitSelection(pendingIdsRef.current[0]);
    } else if (event.key === "End" && pendingIdsRef.current.at(-1)) {
      event.preventDefault();
      commitSelection(pendingIdsRef.current.at(-1)!);
    }
  }, [commitSelection, selectRelative]);

  const travelDirection = Math.sign(wheelTravel) as -1 | 0 | 1;
  const travelTarget = travelDirection ? adjacentProposalId(pendingIds, activeId, travelDirection) : null;
  const mountedPendingIds = proposalPreviewWindow(pendingIds, activeId);
  if (travelTarget && !mountedPendingIds.includes(travelTarget)) {
    mountedPendingIds.splice(Math.min(1, mountedPendingIds.length), 0, travelTarget);
    // Trim rather than resize: assigning `length` on a shorter array pads it
    // with holes, and a hole resolves to no entry and drops a card that should
    // have been drawn.
    if (mountedPendingIds.length > PROPOSAL_DECK_MAX_PREVIEWS) {
      mountedPendingIds.splice(PROPOSAL_DECK_MAX_PREVIEWS);
    }
  }
  const mountedIds = proposalPreviewWindow(mountedPendingIds, activeId, exitingIds);
  const entriesById = useMemo(() => new Map(entries.map((entry) => [entry.proposal.id, entry])), [entries]);
  const mountedPendingCount = mountedIds.filter((id) => pendingIds.includes(id)).length;
  const moreCount = Math.max(0, pendingIds.length - mountedPendingCount);

  return (
    <div
      aria-keyshortcuts="ArrowLeft ArrowRight Home End"
      className="pointer-events-none fixed bottom-5 left-5 z-50 w-[min(92vw,300px)]"
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocusWithin(false); }}
      onFocusCapture={() => setFocusWithin(true)}
      onKeyDown={onKeyDown}
      onPointerEnter={(event) => { if (event.pointerType === "mouse") setHovered(true); }}
      onPointerLeave={() => setHovered(false)}
      ref={rootRef}
    >
      <p aria-atomic="true" aria-live="polite" className="sr-only">{announcement}</p>

      {mountedIds.map((id) => {
        const entry = entriesById.get(id);
        if (!entry) return null;
        const { proposal, exit } = entry;
        const relativeIndex = pendingIds.indexOf(id) - activeIndex;
        const depth = exit ? 0 : Math.abs(relativeIndex);
        const onTop = !exit && id === activeId;
        const candidate = !exit && id === travelTarget;
        const { aspect, templatePreview, review, foundInCatalog } = previewFor(proposal);
        return (
          <div
            aria-hidden={!onTop}
            className={`absolute bottom-0 left-0 w-full origin-bottom-left transition-[transform,opacity] duration-[240ms] ease-[var(--ease-out-expo)] motion-reduce:transition-none ${onTop && !exit ? "pointer-events-auto" : "pointer-events-none"}`}
            data-proposal-card
            data-proposal-depth={depth}
            data-proposal-id={proposal.id}
            inert={!onTop || Boolean(exit)}
            key={proposal.id}
            style={exit
              ? { ...layerStyle({ depth: 0, fan: false, travel: 0, active: true, candidate: false }), zIndex: 200 }
              : layerStyle({ depth, side: relativeIndex < 0 ? -1 : 1, fan, travel: prefersReducedMotion ? 0 : wheelTravel, active: onTop, candidate })}
          >
            <CartProposalCard
              aspect={aspect}
              animateArrival={onTop && !exit && arrivalProposalId === proposal.id && !prefersReducedMotion}
              canGoNext={adjacentProposalId(pendingIds, activeId, 1) !== null}
              canGoPrevious={adjacentProposalId(pendingIds, activeId, -1) !== null}
              depth={depth}
              exit={exit}
              foundInCatalog={foundInCatalog}
              moreCount={moreCount}
              onAccept={() => onAccept(proposal)}
              onNext={() => selectRelative(1)}
              onPrevious={() => selectRelative(-1)}
              onReject={() => onReject(proposal)}
              position={activeIndex + 1}
              proposal={proposal}
              review={review}
              templatePreview={templatePreview}
              total={pendingIds.length}
            />
          </div>
        );
      })}
    </div>
  );
}
