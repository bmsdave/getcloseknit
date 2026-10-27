/**
 * "Change" colour scale: each area is coloured by how much its price per m²
 * moved between `period − window` and `period`. The map keeps one value per
 * area in feature-state, so the change is computed here from two value packs
 * and painted through the same path as measured values.
 */
import type { ValuePackEntry } from "./contracts";
import type { LegendScaleMode } from "./legend-scale";
import { CHANGE_WINDOWS, periodYearsBefore, type ChangeWindow } from "./price-change";

/** The only metric whose history is long and comparable enough to colour by change. */
export const CHANGE_METRIC_ID = "price-per-square-metre";
export const DEFAULT_CHANGE_WINDOW: ChangeWindow = 5;

export function changeAvailable(metricId: string): boolean {
  return metricId === CHANGE_METRIC_ID;
}

/** The period to compare against, or null when the metric has no data for it. */
export function changeBasePeriod(period: string, window: ChangeWindow, periods: readonly string[]): string | null {
  const base = periodYearsBefore(period, window);
  return base !== null && periods.includes(base) ? base : null;
}

/** Percent change rounded to 0.1, or null when either end is missing or the start is not positive. */
export function percentChange(from: number | null | undefined, to: number | null | undefined): number | null {
  if (typeof from !== "number" || typeof to !== "number" || !Number.isFinite(from) || !Number.isFinite(to)) return null;
  if (from <= 0) return null;
  return Math.round((to / from - 1) * 1000) / 10;
}

/**
 * Current entries with `value` replaced by the percent change against the
 * same area in the base pack. Areas missing from the base (or reported on a
 * different carrier) become unknown rather than a guessed 0%.
 */
export function changeValues(
  current: readonly ValuePackEntry[],
  base: readonly ValuePackEntry[] | null,
): ValuePackEntry[] {
  const before = new Map((base ?? []).map((entry) => [entry.geographyId, entry.value]));
  return current.map((entry) => ({
    ...entry,
    value: percentChange(before.get(entry.geographyId), entry.value),
    regionPercentile: null,
  }));
}

export function parseChangeWindow(raw: string | null | undefined): ChangeWindow | null {
  const value = Number(raw);
  return (CHANGE_WINDOWS as readonly number[]).includes(value) ? value as ChangeWindow : null;
}

export function parseScaleMode(raw: string | null | undefined): LegendScaleMode | null {
  return raw === "linear" || raw === "percentile" || raw === "change" ? raw : null;
}

/** Scale settings read from a page query (`?scale=change&window=5`). */
export function scaleFromQuery(search: string): { scale: LegendScaleMode | null; window: ChangeWindow | null } {
  const query = new URLSearchParams(search);
  return { scale: parseScaleMode(query.get("scale")), window: parseChangeWindow(query.get("window")) };
}

/** Add the scale settings to a serialized map query; the layer's default scale (map-setup.ts) stays out of the URL. */
export function withScaleQuery(serialized: string, scale: LegendScaleMode, window: ChangeWindow, layerDefault: LegendScaleMode = "linear"): string {
  const query = new URLSearchParams(serialized);
  query.delete("scale");
  query.delete("window");
  if (scale !== layerDefault) query.set("scale", scale);
  if (scale === "change") query.set("window", String(window));
  return query.toString();
}
