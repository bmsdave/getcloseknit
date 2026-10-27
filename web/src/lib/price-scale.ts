/**
 * The price layer's fixed colour scale, anchored on the latest year:
 * equal-count breaks over the latest year's LSOA £/m² values (2nd–98th
 * percentile), a few history steps below them down to the whole history's
 * 2nd percentile, and a top band above the latest 98th percentile. One scale
 * for every year, so growth reads as the map warming, while the year people
 * look at spreads over every colour; colours blend in OKLab between one
 * palette colour per break.
 */
import type { LegendStop } from "./contracts";

export const PRICE_METRIC_ID = "price-per-square-metre";
/** Log steps below the latest year's range, down to the whole history's low end. */
export const PRICE_HISTORY_STEPS = 2;
/** Equal-count steps over the latest year's range: quintiles. */
export const PRICE_LATEST_STEPS = 5;
/** Steps between the breaks (PRICE_STEPS + 1 breaks); values from the last break up form the top band. */
export const PRICE_STEPS = PRICE_HISTORY_STEPS + PRICE_LATEST_STEPS;
/** Months per timeline step: the slider and playback move a month at a time. */
export const PRICE_STEP_MONTHS = 1;
/**
 * Playback: one month per 200 ms, so a year passes in 2.4 s and 2006–2026 (241 months) in about 48 s.
 * Faster, each month's morph start crowds a phone's frames (e2e price-layer frame budget).
 */
export const PRICE_PLAY_INTERVAL_MS = 200;
/** The map's value morph between steps: as long as a play step, so playback moves without pausing. */
export const PRICE_MORPH_MS = PRICE_PLAY_INTERVAL_MS;
/** Percentiles of the latest year's values at its first and last break (and of every year's at the first). */
export const PRICE_RANGE_PERCENTILES = [0.02, 0.98] as const;

export interface PriceRange {
  low: number;
  high: number;
}

/** June of each year, plus the latest month when it is not June: the price scale pools these (api/v1/price-scale). */
export function yearlyPeriods(periods: readonly string[]): string[] {
  return timelinePeriods(periods, 12);
}

/**
 * Timeline steps every `months` months, anchored on June (monthly by default;
 * quarterly: March, June, September, December; yearly: June), plus the latest
 * month when it is not a step.
 */
export function timelinePeriods(periods: readonly string[], months = PRICE_STEP_MONTHS): string[] {
  const steps = periods.filter((period) => {
    const month = Number(period.slice(5, 7));
    return Number.isInteger(month) && (((month - 6) % months) + months) % months === 0;
  });
  const latest = periods.at(-1);
  if (latest && !steps.includes(latest)) steps.push(latest);
  return steps;
}

/**
 * The timeline step a period sits on: its own step when it is one, otherwise
 * the last step before it (a typed month outside the steps stays as typed).
 */
export function timelineIndex(steps: readonly string[], period: string): number {
  const exact = steps.indexOf(period);
  if (exact >= 0) return exact;
  let index = 0;
  steps.forEach((step, position) => { if (step <= period) index = position; });
  return index;
}

/** The step after the one a period sits on; null once playback has reached the last. */
export function nextTimelinePeriod(steps: readonly string[], period: string): string | null {
  const exact = steps.indexOf(period);
  const following = exact >= 0 ? exact + 1 : steps.findIndex((step) => step > period);
  return following < 0 || following >= steps.length ? null : steps[following];
}

/** Linear-interpolated quantile of finite values (q in 0..1); null when none. */
export function quantile(values: readonly number[], q: number): number | null {
  return sortedQuantile(values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right), q);
}

function sortedQuantile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const position = Math.min(1, Math.max(0, q)) * (sorted.length - 1);
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

/**
 * The fixed breaks, PRICE_STEPS + 1 £/m² values: PRICE_HISTORY_STEPS log
 * steps from the 2nd percentile of every year's values (at least 20% below
 * the latest year's) up to the latest year's 2nd percentile, then
 * PRICE_LATEST_STEPS equal-count steps over the latest year's values up to its
 * 98th percentile, so each holds the same share of the latest year's LSOAs.
 * Rounded to what the labels show (£100 under £10k, £1k above) and strictly
 * rising (MapLibre's interpolate needs ascending stops); null without enough
 * spread in the latest year.
 */
export function priceBreaks(pooled: readonly number[], latest: readonly number[]): number[] | null {
  const sorted = positiveSorted(latest);
  const [lowQ, highQ] = PRICE_RANGE_PERCENTILES;
  const low = sortedQuantile(sorted, lowQ);
  const high = sortedQuantile(sorted, highQ);
  if (low === null || high === null || !(high - low > PRICE_LATEST_STEPS * 100)) return null;
  const historyLow = Math.min(sortedQuantile(positiveSorted(pooled), lowQ) ?? low, low * 0.8);
  const history = Array.from({ length: PRICE_HISTORY_STEPS },
    (_, index) => historyLow * (low / historyLow) ** (index / PRICE_HISTORY_STEPS));
  const current = Array.from({ length: PRICE_LATEST_STEPS + 1 },
    (_, index) => sortedQuantile(sorted, lowQ + ((highQ - lowQ) * index) / PRICE_LATEST_STEPS)!);
  const breaks: number[] = [];
  for (const value of [...history, ...current]) {
    const previous = breaks.at(-1);
    breaks.push(previous === undefined ? roundPrice(value) : Math.max(roundPrice(value), previous + priceUnit(previous)));
  }
  return breaks;
}

function positiveSorted(values: readonly number[]): number[] {
  return values.filter((value) => Number.isFinite(value) && value > 0).sort((left, right) => left - right);
}

/** The step priceLabel shows a value to: £100 under £10k, £1k above. */
function priceUnit(value: number): number {
  return value < 9_950 ? 100 : 1_000;
}

function roundPrice(value: number): number {
  const unit = priceUnit(value);
  return Math.round(value / unit) * unit;
}

/** Breaks spaced evenly on a log axis between a range's ends: the stand-in until the real breaks arrive. */
export function logBreaks(range: PriceRange, steps = PRICE_STEPS): number[] {
  return Array.from({ length: steps + 1 }, (_, index) => Math.round(range.low * (range.high / range.low) ** (index / steps)));
}

/**
 * Where a value sits along the scale, 0 at the first break and 1 at the last:
 * each step between breaks takes an equal share, on a log axis within the
 * step (clamped).
 */
export function rampPosition(value: number, breaks: readonly number[]): number {
  const last = breaks.length - 1;
  if (last < 1 || !(value > breaks[0])) return 0;
  if (value >= breaks[last]) return 1;
  let step = 0;
  while (value >= breaks[step + 1]) step += 1;
  const within = Math.log(value / breaks[step]) / Math.log(breaks[step + 1] / breaks[step]);
  return (step + within) / last;
}

/**
 * The colour band a value falls in, one per break: band k runs from break k
 * to break k + 1 (band 0 also takes everything below), and the last band is
 * everything from the last break up.
 */
export function priceBand(value: number, breaks: readonly number[]): number {
  let band = 0;
  while (band < breaks.length - 1 && value >= breaks[band + 1]) band += 1;
  return band;
}

/** How many values fall in each colour band (unknown values skipped). */
export function priceBandCounts(values: readonly (number | null)[], breaks: readonly number[]): number[] {
  const counts = breaks.map(() => 0);
  for (const value of values) {
    if (typeof value === "number" && value > 0) counts[priceBand(value, breaks)] += 1;
  }
  return counts;
}

/** Median of the finite values; null when there are none. */
export function median(values: readonly (number | null)[]): number | null {
  return quantile(values.filter((value): value is number => typeof value === "number"), 0.5);
}

/** "£2.3k", "£13k": one decimal under £10k; "£1.5m" from a million (never "£1465k"). */
export function priceLabel(value: number): string {
  if (value >= 999_500) return `£${Math.round(value / 100_000) / 10}m`;
  const thousands = value / 1000;
  return `£${thousands < 10 ? Math.round(thousands * 10) / 10 : Math.round(thousands)}k`;
}

/** The legend's range text, e.g. "£2.3k – £13k+". */
export function rangeLabel(range: PriceRange): string {
  return `${priceLabel(range.low)} – ${priceLabel(range.high)}+`;
}

/** `count` colours along a palette, end to end, interpolated in OKLab so steps look even. */
export function perceptualRamp(colours: readonly string[], count: number): string[] {
  if (count <= 1) return colours.slice(0, Math.max(0, count));
  return Array.from({ length: count }, (_, index) => oklabAt(colours, index / (count - 1)));
}

function oklabAt(colours: readonly string[], t: number): string {
  if (colours.length === 0) return "#000000";
  if (colours.length === 1) return colours[0];
  const scaled = Math.min(1, Math.max(0, t)) * (colours.length - 1);
  const segment = Math.min(colours.length - 2, Math.floor(scaled));
  const f = scaled - segment;
  if (f === 0) return colours[segment];
  if (f === 1) return colours[segment + 1];
  const [a, b] = [toOklab(colours[segment]), toOklab(colours[segment + 1])];
  return fromOklab([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
}

/**
 * One legend stop per break; the last reads "+". A palette with one colour
 * per break (the default price ramp) is used as is, others spread end to end.
 */
export function priceStops(breaks: readonly number[], colours: readonly string[]): LegendStop[] {
  const ramp = perceptualRamp(colours, breaks.length);
  const last = breaks.length - 1;
  return breaks.map((value, index) => ({
    value, colour: ramp[index], label: index === last ? `${priceLabel(value)}+` : priceLabel(value),
  }));
}

/** The range a legend built by priceStops spans. */
export function stopsRange(stops: readonly LegendStop[]): PriceRange | null {
  const low = stops[0]?.value;
  const high = stops.at(-1)?.value;
  return low && high && high > low ? { low, high } : null;
}

/**
 * Each colour band of a price legend in £/m² (see priceBand), e.g.
 * "£5.4k–£5.7k", with the colour at its middle; the first reads "Under …"
 * and the top band "£14k+". In the latest year each band between its breaks
 * holds about the same share of LSOAs.
 */
export function hueBandRanges(stops: readonly LegendStop[]): { colour: string; label: string }[] {
  const last = stops.length - 1;
  if (last < 1) return [];
  return stops.map((stop, band) => {
    if (band === last) return { colour: stop.colour, label: `${priceLabel(stop.value)}+` };
    const next = stops[band + 1];
    const label = band === 0 ? `Under ${priceLabel(next.value)}` : `${priceLabel(stop.value)}–${priceLabel(next.value)}`;
    return { colour: oklabAt([stop.colour, next.colour], 0.5), label };
  });
}

/**
 * MapLibre colour for a £/m² input: interpolating over ln(value) between
 * ln(break) gives every break-to-break step its equal share of the ramp, as
 * the legend draws it.
 */
export function logColourExpression(input: unknown, stops: readonly { value: number; colour: string }[]): unknown[] {
  return [
    "interpolate", ["linear"], ["ln", ["max", 1, ["to-number", input]]],
    ...stops.flatMap((stop) => [Math.log(Math.max(1, stop.value)), stop.colour]),
  ];
}


type Vector = [number, number, number];

function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function fromLinear(channel: number): number {
  const c = channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
}

function toOklab(hex: string): Vector {
  const value = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, a, b]: Vector): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(fromLinear);
  return `#${rgb.map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}
