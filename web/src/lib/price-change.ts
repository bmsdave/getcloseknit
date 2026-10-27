import type { AreaSummary } from "./contracts";

export type ChangeWindow = 1 | 3 | 5 | 10 | 20;
export const CHANGE_WINDOWS: readonly ChangeWindow[] = [1, 3, 5, 10, 20];

export interface PriceChange {
  from: AreaSummary;
  to: AreaSummary;
  /** to.value / from.value */
  ratio: number;
  /** (ratio - 1) * 100 */
  percent: number;
}

/** "2026-06" minus `years` -> "2025-06"; null for a malformed period. */
export function periodYearsBefore(period: string, years: number): string | null {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return null;
  return `${Number(match[1]) - years}-${match[2]}`;
}

/**
 * Change of the latest point of a monthly timeline against the point
 * exactly `years` earlier (same month). Null when either end is missing,
 * has no value, or the start is not positive — never a guessed 0%.
 */
export function priceChange(timeline: readonly AreaSummary[], years: ChangeWindow): PriceChange | null {
  const to = timeline.at(-1);
  if (!to || to.value === null) return null;
  const startPeriod = periodYearsBefore(to.period, years);
  const from = timeline.find((point) => point.period === startPeriod);
  if (!from || from.value === null || from.value <= 0) return null;
  const ratio = to.value / from.value;
  return { from, to, ratio, percent: (ratio - 1) * 100 };
}
