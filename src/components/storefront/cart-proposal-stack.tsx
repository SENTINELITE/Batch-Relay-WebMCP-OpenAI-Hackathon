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
  PROPOSAL_DECK_SCALE_STEP,
  adjacentProposalId,
  deckLayerGeometry,
  normalisedPointer,
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
  onToggleFlag: (proposal: CartProposal) => void;
};

const WHEEL_SETTLE_MS = 140;
// How long a card takes to settle into a new depth after a neighbour is
// answered or dealt. Wheel browsing follows the fingers more tightly.
const DECK_SETTLE_MS = 420;
const DECK_TRAVEL_MS = 160;
const ARRIVAL_MS = 400;
// The cursor is smoothed toward its target with this time constant so the
// parallax breathes rather than snapping to every pointer event.
const POINTER_SMOOTHING_MS = 110;
const SCALE_STEP = PROPOSAL_DECK_SCALE_STEP;

type DeckVars = CSSProperties & {
  "--deck-kx"?: string;
  "--deck-ky"?: string;
  "--deck-kr"?: string;
};

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

/**
 * The depth layout of one card: where it rests relative to the active card and
 * how strongly it answers the cursor. The cursor itself is never part of this
 * style; it lives in `--deck-nx`/`--deck-ny` on the deck root, written every
 * frame without a React render, and the parallax element below multiplies the
 * two. The coefficients are CSS custom properties so that a card promoted from
 * depth 1 to 0 glides between parallax strengths instead of jumping.
 */
function layerStyle({
  depth,
  side = 1,
  travel,
  active,
  candidate,
  settleMs,
}: {
  depth: number;
  side?: -1 | 1;
  travel: number;
  active: boolean;
  candidate: boolean;
  settleMs: number;
}): DeckVars {
  const amount = Math.abs(travel);
  const geometry = proposalTravelGeometry(travel);
  const layer = deckLayerGeometry(depth, side);
  const scale = 1 - SCALE_STEP * depth;
  const transition = settleMs > 0
    ? `transform ${settleMs}ms var(--ease-spring), opacity ${Math.round(settleMs * 0.75)}ms ease-out, --deck-kx ${settleMs}ms var(--ease-spring), --deck-ky ${settleMs}ms var(--ease-spring), --deck-kr ${settleMs}ms var(--ease-spring)`
    : "none";
  const vars = {
    "--deck-kx": `${layer.spread.x}`,
    "--deck-ky": `${layer.spread.y}`,
    "--deck-kr": `${layer.spread.rotate}`,
    transition,
  } satisfies DeckVars;
  if (active) return {
    ...vars,
    transform: `translate(${geometry.activeX}px, 0px) rotate(${-travel * 2}deg) scale(${1 - amount * 0.02})`,
    opacity: 1 - amount * 0.08,
    zIndex: 100,
  };
  if (candidate && amount > 0) return {
    ...vars,
    transform: `translate(${geometry.candidateX}px, 0px) rotate(0deg) scale(${geometry.candidateScale})`,
    opacity: 0.82 + amount * 0.18,
    zIndex: 101,
  };
  return {
    ...vars,
    transform: `translate(${layer.rest.x}px, ${layer.rest.y}px) rotate(${layer.rest.rotate}deg) scale(${scale})`,
    opacity: 1 - 0.18 * depth,
    zIndex: 100 - depth,
  };
}

// The cards behind the active one move against the cursor, the active card
// leans slightly toward it; both read the same smoothed cursor from the root.
const parallaxStyle: CSSProperties = {
  transform: "translate(calc(var(--deck-nx, 0) * var(--deck-kx, 0) * 1px), calc(var(--deck-ny, 0) * var(--deck-ky, 0) * 1px)) rotate(calc(var(--deck-nx, 0) * var(--deck-kr, 0) * 1deg))",
  willChange: "transform",
};

/**
 * A cursor- and keyboard-browseable proposal deck. Selection is an id, never
 * an array index, so staging or resolving another card cannot replace the card
 * the shopper was reviewing. Only three preview trees mount at once, with one
 * temporary fourth tree available for an exit flight.
 */
export function CartProposalStack({ entries, previewFor, onAccept, onReject, onToggleFlag }: CartProposalStackProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingEntries = useMemo(() => [...entries].filter((entry) => !entry.exit).reverse(), [entries]);
  const pendingIds = useMemo(() => pendingEntries.map((entry) => entry.proposal.id), [pendingEntries]);
  const exitingIds = useMemo(() => entries.filter((entry) => entry.exit).map((entry) => entry.proposal.id), [entries]);
  const [activeProposalId, setActiveProposalId] = useState<string | null>(() => pendingIds[0] ?? null);
  const [announcement, setAnnouncement] = useState("");
  const [wheelTravel, setWheelTravel] = useState(0);
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

  const hasCards = entries.length > 0;
  // Cursor parallax bypasses React entirely. The target is the cursor's
  // normalised viewport position; the deck eases toward it each frame and
  // publishes the result as two custom properties on the root, which every
  // card's parallax element multiplies by its own depth coefficient.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (!finePointer || prefersReducedMotion || !hasCards) {
      root.style.setProperty("--deck-nx", "0");
      root.style.setProperty("--deck-ny", "0");
      return;
    }
    const target = { x: 0, y: 0 };
    const current = { x: 0, y: 0 };
    let frame: number | null = null;
    let last = 0;
    const write = () => {
      root.style.setProperty("--deck-nx", current.x.toFixed(4));
      root.style.setProperty("--deck-ny", current.y.toFixed(4));
    };
    const tick = (now: number) => {
      frame = null;
      const dt = last ? Math.min(64, now - last) : 16;
      last = now;
      const k = 1 - Math.exp(-dt / POINTER_SMOOTHING_MS);
      current.x += (target.x - current.x) * k;
      current.y += (target.y - current.y) * k;
      if (Math.abs(target.x - current.x) < 0.0015 && Math.abs(target.y - current.y) < 0.0015) {
        current.x = target.x;
        current.y = target.y;
        write();
        last = 0;
        return;
      }
      write();
      frame = window.requestAnimationFrame(tick);
    };
    const schedule = () => {
      if (frame === null) frame = window.requestAnimationFrame(tick);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const next = normalisedPointer(event.clientX, event.clientY, window.innerWidth, window.innerHeight);
      target.x = next.x;
      target.y = next.y;
      schedule();
    };
    // Leaving the window lets the deck drift back to its resting fan.
    const onPointerLeave = () => {
      target.x = 0;
      target.y = 0;
      schedule();
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", onPointerLeave);
    window.addEventListener("blur", onPointerLeave);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("mouseleave", onPointerLeave);
      window.removeEventListener("blur", onPointerLeave);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [finePointer, hasCards, prefersReducedMotion]);

  // The layout effect below restores a removed id to its nearest survivor
  // before paint. This render fallback only covers the first mounted frame.
  const activeId = activeProposalId && pendingIds.includes(activeProposalId)
    ? activeProposalId
    : pendingIds[0] ?? null;
  const activeIndex = proposalIndex(pendingIds, activeId);

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
    }, ARRIVAL_MS);
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
  const settleMs = prefersReducedMotion ? 0 : wheelTravel !== 0 ? DECK_TRAVEL_MS : DECK_SETTLE_MS;

  return (
    <div
      aria-keyshortcuts="ArrowLeft ArrowRight Home End"
      className="pointer-events-none fixed bottom-5 left-5 z-50 w-[min(92vw,264px)]"
      onKeyDown={onKeyDown}
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
        const { aspect, templatePreview, review } = previewFor(proposal);
        return (
          <div
            aria-hidden={!onTop}
            className={`absolute bottom-0 left-0 w-full origin-center motion-reduce:transition-none ${onTop && !exit ? "pointer-events-auto" : "pointer-events-none"}`}
            data-proposal-card
            data-proposal-depth={depth}
            data-proposal-id={proposal.id}
            inert={!onTop || Boolean(exit)}
            key={proposal.id}
            style={exit
              ? { ...layerStyle({ depth: 0, travel: 0, active: true, candidate: false, settleMs }), zIndex: 200 }
              : layerStyle({ depth, side: relativeIndex < 0 ? -1 : 1, travel: prefersReducedMotion ? 0 : wheelTravel, active: onTop, candidate, settleMs })}
          >
            <div className="origin-center motion-reduce:transform-none" data-proposal-parallax style={parallaxStyle}>
            <CartProposalCard
              aspect={aspect}
              animateArrival={onTop && !exit && arrivalProposalId === proposal.id && !prefersReducedMotion}
              depth={depth}
              exit={exit}
              moreCount={moreCount}
              onAccept={() => onAccept(proposal)}
              onReject={() => onReject(proposal)}
              onToggleFlag={() => onToggleFlag(proposal)}
              position={activeIndex + 1}
              proposal={proposal}
              review={review}
              templatePreview={templatePreview}
              total={pendingIds.length}
            />
            </div>
          </div>
        );
      })}
    </div>
  );
}
