/** The phone sheet's resting heights, lowest first. */
export type SheetSnap = "collapsed" | "half" | "full";

export const SHEET_SNAPS: readonly SheetSnap[] = ["collapsed", "half", "full"];
/** A finger must travel this far (px) before a press on the sheet becomes a drag. */
export const DRAG_START = 8;
/** Release speed (px/ms) from which a drag is a flick: it goes on to the next snap its way. */
export const FLICK_VELOCITY = 0.5;
/** How far (px) the sheet can be pulled past its first or last snap, approached but never reached. */
const STRETCH = 64;

/**
 * Where a released sheet rests. `shown` is how many px of it are on screen,
 * `velocity` the finger's speed in px/ms (positive = down) and `heights` each
 * snap's resting height. A flick goes to the next snap its way from where it
 * was let go; a slower release rests on the nearest snap.
 */
export function snapAfterRelease(
  shown: number,
  velocity: number,
  heights: Readonly<Record<SheetSnap, number>>,
  allowed: readonly SheetSnap[] = SHEET_SNAPS,
): SheetSnap {
  const stops = [...allowed].sort((a, b) => heights[a] - heights[b]);
  if (velocity <= -FLICK_VELOCITY) return stops.find((snap) => heights[snap] > shown + 1) ?? stops[stops.length - 1];
  if (velocity >= FLICK_VELOCITY) return [...stops].reverse().find((snap) => heights[snap] < shown - 1) ?? stops[0];
  return stops.reduce((best, snap) => (Math.abs(heights[snap] - shown) < Math.abs(heights[best] - shown) ? snap : best));
}

/** Past `min` or `max` the sheet follows the finger with growing resistance, as native sheets do. */
export function rubberBand(offset: number, min: number, max: number): number {
  const resist = (over: number) => (1 - 1 / ((over * 0.55) / STRETCH + 1)) * STRETCH;
  if (offset < min) return min - resist(min - offset);
  if (offset > max) return max + resist(offset - max);
  return offset;
}

/**
 * A tap on the grabber or the peek row, as in Maps: the peek opens to half,
 * half lowers to the peek and full comes back down to half.
 */
export function snapAfterTap(current: SheetSnap): SheetSnap {
  return current === "half" ? "collapsed" : "half";
}

/** ArrowUp / ArrowDown on the grabber: one allowed snap up or down, stopping at the ends. */
export function stepSnap(current: SheetSnap, direction: 1 | -1, allowed: readonly SheetSnap[] = SHEET_SNAPS): SheetSnap {
  const stops = SHEET_SNAPS.filter((snap) => allowed.includes(snap));
  const index = stops.indexOf(current);
  if (index < 0) return stops[0] ?? current;
  return stops[Math.min(stops.length - 1, Math.max(0, index + direction))];
}
