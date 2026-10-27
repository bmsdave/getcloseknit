/**
 * The reader's own colour scale (owner request): per layer, the low and high value of the colour ramp
 * (two handles over a histogram of the values in view, components/legend-range.tsx) and which areas the automatic
 * scale ranks: the view (default, lib/view-scale.ts), the view's region or England.
 *
 * A custom range spreads the layer's colours in equal steps between its two values: below the low one is the first
 * colour, above the high one the last. The handles read in the layer's own unit, so equal steps keep each colour a
 * fixed span of that unit, and the histogram under them shows how many areas each colour holds. While a range is set
 * the view's automatic split is paused: moving the map keeps it.
 *
 * Kept per layer (and per change scale, whose unit is a percent) in the address (&range=lo,hi&scope=region) and on
 * this device (localStorage), read by the map and the legend from one store: a drag repaints the map and the legend,
 * never the page; only a released handle is written to the address.
 */

export type ScaleScope = "view" | "region" | "england";
export const SCALE_SCOPES: readonly ScaleScope[] = ["view", "region", "england"];

/**
 * The scopes a map of this coverage can rank by. A London map (CLOSE_KNIT_ENGLAND off, FLAGS.md) has no England
 * ranks (the API withholds countryPercentile), so it offers no "England" and reads a saved one as the region's.
 */
export function servedScopes(coverage: "england" | "london"): readonly ScaleScope[] {
  return coverage === "england" ? SCALE_SCOPES : SCALE_SCOPES.filter((scope) => scope !== "england");
}

export function servedScope(scope: ScaleScope, coverage: "england" | "london"): ScaleScope {
  return servedScopes(coverage).includes(scope) ? scope : "region";
}

export interface LayerScale {
  /** The ramp's low and high value in the layer's unit; null: the automatic scale. */
  range: readonly [number, number] | null;
  /** Which areas the automatic rank scale splits (percentile layers only). */
  scope: ScaleScope;
}

export const AUTO_SCALE: LayerScale = Object.freeze({ range: null, scope: "view" });

export function isAutoScale(scale: LayerScale): boolean {
  return scale.range === null && scale.scope === "view";
}

/** The store's key: a layer, or its change scale (a percent, never the layer's own unit). */
export function legendScaleKey(metricId: string, scaleMode: string): string {
  return scaleMode === "change" ? `${metricId}:change` : metricId;
}

/** `stops` values in equal steps from low to high: the classes of a custom range. */
export function rangeBreaks(range: readonly [number, number], stops: number): number[] {
  const [low, high] = range;
  if (stops < 2) return [low];
  return Array.from({ length: stops }, (_, index) => low + ((high - low) * index) / (stops - 1));
}

/** A value's place on a custom range, 0..100 (the colour ramp's input): below low is 0, above high is 100. */
export function rangePosition(value: number, range: readonly [number, number]): number {
  const [low, high] = range;
  if (!(high > low)) return value < low ? 0 : 100;
  if (value <= low) return 0;
  if (value >= high) return 100;
  return ((value - low) / (high - low)) * 100;
}

/**
 * A handle's name for a screen reader: the layer, which end of the colours it sets and the unit its values are in
 * ("Price per m², colours from, in £/m²"). Two handles that said only "Colours from" left the layer unsaid.
 */
export function handleLabel(layer: string, which: "low" | "high", unit: string): string {
  const words = unit.replace(/-/g, " ").trim();
  return `${layer}, colours ${which === "low" ? "from" : "to"}${words ? `, in ${words}` : ""}`;
}

/** A slider step that reads cleanly: 1, 2 or 5 × a power of ten, about a hundredth of the span. */
export function sliderStep(span: number): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const raw = span / 100;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / magnitude;
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * magnitude;
}

/** Four significant figures: what the address keeps of a value. */
function compact(value: number): number {
  return Number(value.toPrecision(4));
}

/**
 * The handles' values made safe: in order, inside the domain, at least one step apart. Null when the input is not
 * two finite numbers.
 */
export function clampRange(low: number, high: number, domain: readonly [number, number], step = 0): [number, number] | null {
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  const [min, max] = domain[0] <= domain[1] ? domain : [domain[1], domain[0]];
  let lo = Math.min(Math.max(Math.min(low, high), min), max);
  let hi = Math.min(Math.max(Math.max(low, high), min), max);
  const gap = Math.max(step, 0);
  if (hi - lo < gap) {
    if (lo + gap <= max) hi = lo + gap;
    else lo = Math.max(min, hi - gap);
  }
  return [lo, hi];
}

/** `&range=3200,19000`: two finite numbers, low first; anything else is no range. */
export function parseRange(raw: string | null | undefined): [number, number] | null {
  if (!raw) return null;
  const parts = raw.split(",");
  if (parts.length !== 2 || parts.some((part) => part.trim() === "")) return null;
  const [low, high] = parts.map(Number);
  if (!Number.isFinite(low) || !Number.isFinite(high) || low === high) return null;
  return low < high ? [low, high] : [high, low];
}

export function formatRange(range: readonly [number, number]): string {
  return `${compact(range[0])},${compact(range[1])}`;
}

export function parseScope(raw: string | null | undefined): ScaleScope | null {
  return raw === "view" || raw === "region" || raw === "england" ? raw : null;
}

/** The layer's scale from a page query (`?range=3200,19000&scope=region`); null when the query sets neither. */
export function legendScaleFromQuery(search: string): LayerScale | null {
  const query = new URLSearchParams(search);
  const range = parseRange(query.get("range"));
  const scope = parseScope(query.get("scope"));
  if (!range && !scope) return null;
  return { range, scope: scope ?? "view" };
}

/** Add the layer's scale to a serialized map query: the automatic scale stays out of the address. */
export function withLegendScaleQuery(serialized: string, scale: LayerScale): string {
  const query = new URLSearchParams(serialized);
  query.delete("range");
  query.delete("scope");
  if (scale.range) query.set("range", formatRange(scale.range));
  if (scale.scope !== "view") query.set("scope", scale.scope);
  return query.toString();
}

export const LEGEND_SCALE_STORAGE_KEY = "close-knit:legend-scale";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function localStore(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function validScale(value: unknown): LayerScale | null {
  const entry = value as { range?: unknown; scope?: unknown } | null;
  if (!entry || typeof entry !== "object") return null;
  const range = Array.isArray(entry.range) && entry.range.length === 2 ? parseRange(entry.range.join(",")) : null;
  const scope = parseScope(typeof entry.scope === "string" ? entry.scope : null) ?? "view";
  const scale = { range, scope };
  return isAutoScale(scale) ? null : scale;
}

/** Every layer's scale saved on this device; empty when storage is blocked or holds something else. */
export function readStoredScales(storage: StorageLike | null = localStore()): Record<string, LayerScale> {
  try {
    const parsed = JSON.parse(storage?.getItem(LEGEND_SCALE_STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const scales: Record<string, LayerScale> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const scale = validScale(value);
      if (scale) scales[key] = scale;
    }
    return scales;
  } catch {
    return {};
  }
}

/** Save one layer's scale on this device (the automatic one is removed); a blocked storage is ignored. */
export function writeStoredScale(key: string, scale: LayerScale, storage: StorageLike | null = localStore()): void {
  try {
    if (!storage) return;
    const scales = readStoredScales(storage);
    if (isAutoScale(scale)) delete scales[key];
    else scales[key] = { range: scale.range ? [compact(scale.range[0]), compact(scale.range[1])] : null, scope: scale.scope };
    storage.setItem(LEGEND_SCALE_STORAGE_KEY, JSON.stringify(scales));
  } catch {
    // Private mode or a full store: the address still carries the scale.
  }
}

// The store: committed scales per layer key, and the one a handle is dragging (not yet in the address or storage).
let committed = new Map<string, LayerScale>();
let live: { key: string; scale: LayerScale } | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** The scale the map and legend paint for a layer key: a handle being dragged, else the committed one. */
export function legendScaleFor(key: string): LayerScale {
  if (live && live.key === key) return live.scale;
  return committed.get(key) ?? AUTO_SCALE;
}

/** The scale written to the address and storage (a drag in progress is not). */
export function committedLegendScale(key: string): LayerScale {
  return committed.get(key) ?? AUTO_SCALE;
}

/** Whether a handle is being dragged (the map repaints at once, without easing). */
export function legendScaleDragging(): boolean {
  return live !== null;
}

/**
 * Set a layer's scale. `commit: false` while a handle moves (the map and legend follow); `commit: true` on release,
 * a scope choice or Reset (also saved on this device).
 */
export function setLegendScale(key: string, scale: LayerScale, { commit = true, storage }: { commit?: boolean; storage?: StorageLike | null } = {}): void {
  if (!commit) {
    live = { key, scale };
    notify();
    return;
  }
  live = null;
  const next = new Map(committed);
  if (isAutoScale(scale)) next.delete(key);
  else next.set(key, scale);
  committed = next;
  writeStoredScale(key, scale, storage === undefined ? localStore() : storage);
  notify();
}

/**
 * The scales a page opens with: those saved on this device, then the address's for the layer it names (a shared
 * link wins over this device for that layer).
 */
export function bootLegendScales(search: string, storage: StorageLike | null = localStore()): void {
  const next = new Map(Object.entries(readStoredScales(storage)));
  const query = new URLSearchParams(search);
  const layer = query.get("layer") ?? "price-per-square-metre";
  const shared = legendScaleFromQuery(search);
  if (shared) next.set(legendScaleKey(layer, query.get("scale") === "change" ? "change" : "value"), shared);
  committed = next;
  live = null;
  notify();
}

export function subscribeLegendScale(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The measured values of the areas in view for a layer key, sorted (the histogram's); kept by the map. */
export interface ViewValues {
  key: string;
  values: Float64Array;
}

let viewValues: ViewValues | null = null;
const valueListeners = new Set<() => void>();

export function setViewValues(key: string, values: readonly number[]): void {
  const sorted = Float64Array.from(values).sort();
  const previous = viewValues;
  if (previous && previous.key === key && previous.values.length === sorted.length
    && previous.values.every((value, index) => value === sorted[index])) return;
  viewValues = { key, values: sorted };
  for (const listener of valueListeners) listener();
}

export function currentViewValues(): ViewValues | null {
  return viewValues;
}

export function subscribeViewValues(listener: () => void): () => void {
  valueListeners.add(listener);
  return () => { valueListeners.delete(listener); };
}

/** The value at quantile `q` of sorted values (linear between closest ranks). */
export function quantileOf(sorted: ArrayLike<number>, q: number): number {
  const last = sorted.length - 1;
  if (last < 0) return Number.NaN;
  const at = Math.min(1, Math.max(0, q)) * last;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}

/**
 * The slider's span: the values in view without their extreme hundredths (one outlier would squeeze every other
 * area into one bar), widened to hold `include` (the range shown), then rounded out to the slider's step.
 */
export function histogramDomain(sorted: ArrayLike<number>, include: readonly [number, number] | null): [number, number] | null {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  if (sorted.length > 0) {
    const trim = sorted.length >= 100 ? 0.01 : 0;
    low = quantileOf(sorted, trim);
    high = quantileOf(sorted, 1 - trim);
  }
  if (include) {
    low = Math.min(low, include[0]);
    high = Math.max(high, include[1]);
  }
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  if (high === low) {
    const pad = Math.abs(low) > 0 ? Math.abs(low) * 0.1 : 1;
    low -= pad;
    high += pad;
  }
  const step = sliderStep(high - low);
  return [Math.floor(low / step) * step, Math.ceil(high / step) * step];
}

/** Counts of `sorted` values in `bins` equal bins across the domain; values beyond it count in the end bins. */
export function histogram(sorted: ArrayLike<number>, domain: readonly [number, number], bins: number): number[] {
  const counts = new Array<number>(Math.max(1, bins)).fill(0);
  const [low, high] = domain;
  const width = (high - low) / counts.length;
  for (let index = 0; index < sorted.length; index += 1) {
    const value = sorted[index];
    if (!Number.isFinite(value)) continue;
    const bin = width > 0 ? Math.floor((value - low) / width) : 0;
    counts[Math.min(counts.length - 1, Math.max(0, bin))] += 1;
  }
  return counts;
}

/** Share of sorted values at or below `value` (0..1): a rank in view, for colouring the histogram on a rank scale. */
export function rankIn(sorted: ArrayLike<number>, value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle] <= value) low = middle + 1;
    else high = middle;
  }
  return sorted.length ? low / sorted.length : 0;
}
