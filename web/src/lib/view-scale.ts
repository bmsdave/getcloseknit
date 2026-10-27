/**
 * The rank scale is the view's own (owner decision): a layer coloured by rank splits the values of the
 * areas in view into equal shares, one colour stop at each, whatever region they are in. One scale for everything
 * on screen, so nothing jumps at a region's border, and the most contrast at every zoom: all of London no longer
 * reads red because London sits in England's top tenth.
 *
 * The breaks move only when the view really changes (needsRescale): a small nudge or a slight zoom keeps them, so
 * colours do not flicker while someone looks around. Too few valued areas in view (VIEW_SCALE_MIN_AREAS) and the
 * map keeps the region's or England's ranks.
 */

import type { Bbox } from "./map-coverage";

/** Fewer valued areas in view than this: quantiles of a handful say little, the published ranks colour the map. */
export const VIEW_SCALE_MIN_AREAS = 20;
/** A zoom by this much or more re-splits the view's values. */
export const RESCALE_ZOOM_STEP = 0.5;
/** A pan moving the view's centre by more than this share of its width or height re-splits them. */
export const RESCALE_MOVE_SHARE = 0.3;

/** The view the breaks were taken from, and the level of areas it drew. */
export interface ScaleAnchor {
  zoom: number;
  bounds: Bbox;
  /** The layer and the kind of areas drawn ("price-per-square-metre:lsoa"): another level always re-splits. */
  level: string;
}

/** Whether `next` is far enough from the anchor's view to take new breaks (the hysteresis). */
export function needsRescale(anchor: ScaleAnchor | null, next: ScaleAnchor): boolean {
  if (!anchor || anchor.level !== next.level) return true;
  if (Math.abs(next.zoom - anchor.zoom) >= RESCALE_ZOOM_STEP) return true;
  const width = anchor.bounds[2] - anchor.bounds[0];
  const height = anchor.bounds[3] - anchor.bounds[1];
  if (!(width > 0) || !(height > 0)) return true;
  const dx = Math.abs((next.bounds[0] + next.bounds[2]) / 2 - (anchor.bounds[0] + anchor.bounds[2]) / 2);
  const dy = Math.abs((next.bounds[1] + next.bounds[3]) / 2 - (anchor.bounds[1] + anchor.bounds[3]) / 2);
  return dx > width * RESCALE_MOVE_SHARE || dy > height * RESCALE_MOVE_SHARE;
}

/**
 * `stops` values at evenly spaced quantiles of `values` (linear between closest ranks): the first is the lowest,
 * the last the highest, so each colour step holds an equal share of the areas. Null for fewer than `minimum`
 * values or when they are all the same (nothing to split).
 */
export function viewBreaks(values: readonly number[], stops: number, minimum = VIEW_SCALE_MIN_AREAS): number[] | null {
  if (values.length < minimum || stops < 2) return null;
  const sorted = Float64Array.from(values).sort();
  const last = sorted.length - 1;
  if (sorted[0] === sorted[last]) return null;
  return Array.from({ length: stops }, (_, index) => {
    const at = (index / (stops - 1)) * last;
    const low = Math.floor(at);
    const high = Math.ceil(at);
    return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
  });
}

/**
 * A value's place on the view's scale, 0..100, the colour ramp's input: linear between the breaks (stop i sits at
 * i / (stops − 1)). A value equal to several tied breaks sits in the middle of them; beyond the ends it clamps.
 */
export function viewPosition(value: number, breaks: readonly number[]): number {
  const last = breaks.length - 1;
  if (last < 1 || value < breaks[0]) return 0;
  if (value > breaks[last]) return 100;
  let low = 0;
  while (breaks[low] < value) low += 1;
  if (breaks[low] === value) {
    let high = low;
    while (high < last && breaks[high + 1] === value) high += 1;
    return ((low + high) / 2 / last) * 100;
  }
  const step = low - 1 + (value - breaks[low - 1]) / (breaks[low] - breaks[low - 1]);
  return (step / last) * 100;
}

/** The breaks the map paints with, for the legend: per layer, null while the published ranks colour it. */
export interface ViewScale {
  metricId: string;
  breaks: readonly number[];
}

let current: ViewScale | null = null;
const listeners = new Set<() => void>();

export function setViewScale(next: ViewScale | null): void {
  const same = next === current || (next && current && next.metricId === current.metricId
    && next.breaks.length === current.breaks.length && next.breaks.every((value, index) => value === current!.breaks[index]));
  if (same) return;
  current = next;
  for (const listener of listeners) listener();
}

export function currentViewScale(): ViewScale | null {
  return current;
}

/** The layer the view's breaks are for (null: the published ranks colour the map), for words that only need that. */
export function viewScaleMetricId(): string | null {
  return current?.metricId ?? null;
}

export function subscribeViewScale(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const COMPACT = new Intl.NumberFormat("en-GB", { notation: "compact", maximumSignificantDigits: 2 });
const COMPACT_GBP = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", notation: "compact", maximumSignificantDigits: 2 });

/** A class edge in a few characters: "£7.6k", "12%", "0.42", "1.2k". */
export function terseValue(value: number, unit: string): string {
  if (!Number.isFinite(value)) return "";
  if (/£|GBP|pound/i.test(unit)) return COMPACT_GBP.format(value);
  // A walk to the nearest place (a criterion's "minutes"): "3 min", "1.5 min".
  if (/minute/i.test(unit)) return `${Math.abs(value) < 10 && !Number.isInteger(value) ? value.toFixed(1) : Math.round(value)} min`;
  if (/%|percent(?!ile)|share/i.test(unit)) return `${Math.abs(value) < 10 && !Number.isInteger(value) ? value.toFixed(1) : Math.round(value)}%`;
  if (Math.abs(value) < 10 && !Number.isInteger(value)) return value.toFixed(Math.abs(value) < 1 ? 2 : 1);
  return COMPACT.format(value);
}
