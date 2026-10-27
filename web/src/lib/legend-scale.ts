/**
 * Legend scale modes for map colouring. Linear colours by the measured value
 * against the metric legend; percentile colours by London percentile spread
 * evenly across the legend colours, so skewed distributions (crime) stay
 * readable without changing the underlying values.
 */

import { censusView } from "./census-layers";
import { filteredCrimeValue } from "./crime-filter";
import { changeAvailable } from "./map-trend";

/** "change" colours by percent change over a window (price per m² only, lib/map-trend.ts). */
export type LegendScaleMode = "linear" | "percentile" | "change";

export interface ScaledEntry {
  value: number | null;
  regionPercentile: number | null;
  /** The rank in England (stored per release, migration 124): the scale of a view across regions. */
  countryPercentile?: number | null;
  breakdown?: Record<string, number>;
}

export function scaledMapValue(entry: ScaledEntry, mode: LegendScaleMode): number | null {
  if (mode === "percentile") return entry.regionPercentile;
  return entry.value;
}

/**
 * Percentiles describe the full headline rate, so a filtered crime subset
 * cannot be percentile-coloured honestly: an active crime filter pins the
 * map to the linear scale and the UI says so. The change scale exists only
 * for price per m²; other layers fall back to measured values. A Census layer is descriptive only:
 * always actual shares, never a rank in London.
 */
export function effectiveScaleMode(
  metricId: string,
  mode: LegendScaleMode,
  crimeFilterActive: boolean,
): LegendScaleMode {
  // My match paints its own bands by percentile among the scored areas: no other scale applies.
  if (metricId === "personal-match") return "linear";
  if (mode === "change" && !changeAvailable(metricId)) return "linear";
  if (censusView(metricId)) return "linear";
  if (metricId === "crime" && crimeFilterActive && mode === "percentile") return "linear";
  return mode;
}

/**
 * Map-ready value for one area: percentile mode colours by the region's percentile (England's for a view across
 * regions)
 * (which describes the full headline rate, so it ignores the crime filter);
 * linear crime mode rescales to the included categories.
 */
export function displayMapValue(
  entry: ScaledEntry,
  metricId: string,
  mode: LegendScaleMode,
  included: readonly string[],
  filterActive: boolean,
  /** The view spans regions: percentiles are England's, one scale across every border. */
  england = false,
): number | null {
  if (mode === "percentile") return england ? entry.countryPercentile ?? null : entry.regionPercentile;
  // Change values are computed from two packs before they reach here.
  if (mode === "change") return entry.value;
  if (metricId === "crime" && filterActive) {
    return filteredCrimeValue(entry.value, entry.breakdown, included);
  }
  return entry.value;
}

export function percentileStops(
  legend: readonly { value: number; colour: string }[],
): { value: number; colour: string }[] {
  if (legend.length === 0) return [];
  if (legend.length === 1) return [{ value: 0, colour: legend[0].colour }];
  return legend.map((stop, index) => ({
    value: Math.round((index / (legend.length - 1)) * 100),
    colour: stop.colour,
  }));
}

/** Round a data maximum up to a 1/2/5 creative step so rescaled legends read cleanly. */
export function niceCeiling(maximum: number): number {
  if (!(maximum > 0) || !Number.isFinite(maximum)) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(maximum));
  const fraction = maximum / magnitude;
  const step = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * Evenly spaced quantiles over sorted values (linear interpolation between
 * closest ranks), so each colour band holds a similar share of areas even
 * for long-tailed distributions like single-crime rates.
 */
export function quantileBreaks(values: readonly number[], count: number): number[] {
  if (values.length === 0 || count <= 0) return [];
  if (count === 1) return [values[0]];
  const sorted = [...values].sort((left, right) => left - right);
  const last = sorted.length - 1;
  return Array.from({ length: count }, (_, index) => {
    const position = (index / (count - 1)) * last;
    const low = Math.floor(position);
    const high = Math.ceil(position);
    const value = sorted[low] + (sorted[high] - sorted[low]) * (position - low);
    return Math.round(value * 100) / 100;
  });
}

export interface LegendStop {
  value: number;
  colour: string;
  label: string;
}

/**
 * Renormalize a metric's colours across the visible subset: 0 stays green
 * and the subset maximum itself becomes red, with intermediate breaks at
 * quantiles so one hotspot cannot wash the rest of the map a single colour.
 * Tied breaks collapse (keeping green at the floor and red at the top);
 * returns null when fewer than two distinct breaks exist, so callers fall
 * back to the published legend.
 */
export function rescaledStops(
  legend: readonly { value: number; colour: string }[],
  values: readonly (number | null)[],
): LegendStop[] | null {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (finite.length === 0 || legend.length === 0) return null;
  const top = Math.round(Math.max(...finite) * 100) / 100;
  if (top <= 0) return null;
  const breaks = quantileBreaks(finite, legend.length);
  breaks[0] = 0;
  const stops: LegendStop[] = [];
  let index = 0;
  while (index < breaks.length) {
    let end = index;
    while (end + 1 < breaks.length && breaks[end + 1] === breaks[index]) end += 1;
    const last = end === breaks.length - 1;
    const colourIndex = last ? legend.length - 1 : index;
    stops.push({
      value: breaks[index],
      colour: legend[colourIndex].colour,
      label: last ? `${top}+` : `${breaks[index]}`,
    });
    index = end + 1;
  }
  if (stops.length < 2) return null;
  return stops;
}

/**
 * A legend whose top stop is an outlier (the busiest West End street at
 * 4,459 crimes per 1,000 residents) caps it: the top colour starts at a round
 * number past the stop below and takes everything above, so the other
 * classes are not squeezed into one colour. Labels keep their units.
 */
export function cappedLegend<T extends { value: number; label: string }>(stops: readonly T[]): T[] {
  const result = [...stops];
  const [previous, last] = [result.at(-2), result.at(-1)];
  if (!previous || !last || !(previous.value > 0) || last.value <= previous.value * 3) return result;
  const cap = niceCeiling(previous.value * 1.5);
  const label = /\d/.test(last.label) ? last.label.replace(/[\d][\d,.]*/, cap.toLocaleString("en-GB")) : last.label;
  result[result.length - 1] = { ...last, value: cap, label: /\+/.test(label) ? label : `${label}+` };
  return result;
}

/** A value's place (0..1) along evenly drawn stops, linear within each step (the crime legend's London tick). */
export function linearRampPosition(value: number, breaks: readonly number[]): number {
  const last = breaks.length - 1;
  if (last < 1 || !(value > breaks[0])) return 0;
  if (value >= breaks[last]) return 1;
  let step = 0;
  while (value >= breaks[step + 1]) step += 1;
  return (step + (value - breaks[step]) / (breaks[step + 1] - breaks[step])) / last;
}
