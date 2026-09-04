/**
 * Ring geometry for the template carousel.
 *
 * The published templates sit on a ring seen from the front: the chosen one
 * faces the shopper, its neighbours stand to either side, and the ones after
 * those wait behind it. Choosing the next template turns the whole ring one
 * step, so every card travels along the same arc rather than sliding in a row.
 * Kept pure so the wrapping and the slot positions can be tested without a
 * browser.
 */

/** Degrees between neighbouring cards on the ring. Five positions face forward. */
export const TEMPLATE_CAROUSEL_STEP_DEG = 72;
/** How many steps either side of the chosen card are drawn at all. */
export const TEMPLATE_CAROUSEL_REACH = 2;
/** Ring radius, as a share of the stage width (container query units). */
const RING_RADIUS_CQW = 31.5;

/**
 * The signed number of steps from the chosen card to `index`, taking the
 * shorter way round. An exact half turn resolves to the right-hand side so a
 * ring of two or four never has two cards competing for one slot.
 */
export function ringOffset(index: number, selectedIndex: number, count: number): number {
  if (count <= 0) return 0;
  let offset = (((index - selectedIndex) % count) + count) % count;
  if (offset > count / 2) offset -= count;
  return offset;
}

export type RingSlot = {
  /** Horizontal position from the stage centre, in container-width units. */
  x: number;
  /** Small lift so the back of the ring reads as further away, in px. */
  y: number;
  scale: number;
  /** The card turns to face the centre of the ring. */
  rotateY: number;
  opacity: number;
  /** Softening for the cards that are not the shopper's focus, in px. */
  blur: number;
  zIndex: number;
  /** Whether the card is within reach and should carry its preview. */
  visible: boolean;
};

export function ringSlot(offset: number): RingSlot {
  const visible = Math.abs(offset) <= TEMPLATE_CAROUSEL_REACH;
  // Anything beyond reach parks at the back of the ring, unseen, so it can
  // arrive from there when its turn comes.
  const clamped = Math.max(-TEMPLATE_CAROUSEL_REACH - 0.5, Math.min(TEMPLATE_CAROUSEL_REACH + 0.5, offset));
  const phi = (clamped * TEMPLATE_CAROUSEL_STEP_DEG * Math.PI) / 180;
  const depth = (1 - Math.cos(phi)) / 2; // 0 at the front, 1 at the back
  return {
    x: Math.round(Math.sin(phi) * RING_RADIUS_CQW * 100) / 100,
    y: Math.round(-depth * 10 * 100) / 100,
    scale: Math.round((1 - depth * 0.46) * 1000) / 1000,
    rotateY: Math.round(-Math.sin(phi) * 22 * 100) / 100,
    opacity: !visible ? 0 : offset === 0 ? 1 : Math.round((0.46 - depth * 0.2) * 100) / 100,
    blur: offset === 0 ? 0 : Math.round(depth * 2.2 * 100) / 100,
    zIndex: 10 + Math.round((1 - depth) * 20),
    visible,
  };
}
