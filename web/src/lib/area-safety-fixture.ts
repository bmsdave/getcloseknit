/**
 * Demo safety rows for the preview neighbourhoods, read from the demo crime evidence the rest of the
 * page shows (same rate, percentile and types), with made-up London rates per type.
 */
import type { GeographyId } from "./contracts";
import type { AreaSafety } from "./area-safety";
import { getAreaSummary } from "./fixtures";

const TYPE_LABELS: Record<string, string> = { violence: "Violence and sexual offences", burglary: "Burglary", other: "Other crime" };
const LONDON: Record<string, number> = { violence: 31, burglary: 5.3, other: 61.8 };
const LATEST = "2026-06";

function monthsBack(period: string, months: number): string {
  const [year, month] = period.split("-").map(Number);
  const index = year * 12 + month - 1 - months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

function monthsBetween(start: string, end: string): number {
  const [y1, m1] = start.split("-").map(Number);
  const [y2, m2] = end.split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

export function fixtureAreaSafety(id: GeographyId): AreaSafety | null {
  if (!id.startsWith("uk:lsoa:")) return null;
  const latest = getAreaSummary(id, "crime", LATEST);
  if (!latest || latest.value === null) return null;
  const points = Array.from({ length: 37 }, (_, index) => monthsBack(LATEST, 36 - index))
    .map((period) => ({ period, rate: getAreaSummary(id, "crime", period)?.value ?? null }))
    .filter((point): point is { period: string; rate: number } => point.rate !== null);
  const first = points[0]?.rate ?? latest.value;
  const change = first > 0 ? (latest.value - first) / first : 0;
  const types = Object.entries(latest.breakdown ?? {})
    .filter(([, rate]) => rate > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, rate]) => ({ category: TYPE_LABELS[key] ?? key, offences: Math.round(rate * 1.5), rate, regionRate: LONDON[key] ?? null }));
  return {
    schemaVersion: "area-safety.v1", productReleaseId: "preview-safety-2026-06", geographyId: id, available: true,
    period: LATEST, rate: latest.value, regionPercentile: latest.regionPercentile, regionRate: 98.1, offences: Math.round(latest.value * 1.5),
    types,
    trend: points.length > 1 ? {
      from: points[0].period, to: points.at(-1)!.period, months: monthsBetween(points[0].period, points.at(-1)!.period),
      changePercent: Math.round(change * 1000) / 10,
      stable: Math.abs(change) < 0.15, points,
    } : null,
    source: { attribution: "Demo figures, made up for the preview areas.", licence: null, url: null },
    caveats: ["Crime is counted where it happens, so busy shopping and night-life streets score high."],
  };
}
