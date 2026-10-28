/**
 * Safety rows for the area page: the contract of GET /api/v1/areas/{id}/safety
 * (api/area_api/safety.py). Offence types are rates per 1,000 residents beside London's; the trend
 * line is drawn only when the rate moved 15% or more either way, otherwise one row says "stable".
 */
import type { GeographyId } from "./contracts";
import type { DataMode } from "./map-state";

export interface SafetyType { category: string; offences: number; rate: number | null; regionRate: number | null }

export interface SafetyTrend {
  from: string;
  to: string;
  months: number;
  changePercent: number | null;
  stable: boolean;
  points: { period: string; rate: number }[];
}

export interface AreaSafety {
  schemaVersion: "area-safety.v1";
  productReleaseId?: string;
  geographyId: GeographyId;
  available: boolean;
  period?: string;
  rate: number | null;
  regionPercentile?: number | null;
  regionRate?: number | null;
  /** The region regionRate and regionPercentile are computed in (London for London; England coverage). */
  rankScope?: { code: string; name: string } | null;
  offences?: number | null;
  types: SafetyType[];
  trend: SafetyTrend | null;
  source: { attribution: string; licence: string | null; url: string | null } | null;
  caveats: string[];
}

export function areaSafetyPath(id: GeographyId): string {
  return `/api/v1/areas/${encodeURIComponent(id)}/safety`;
}

/** The safety read for an area with one (a neighbourhood or MSOA: the API sums an MSOA's neighbourhoods), else null. */
export function areaSafetyPathFor(id: GeographyId): string | null {
  return id.startsWith("uk:lsoa:") || id.startsWith("uk:msoa:") ? areaSafetyPath(id) : null;
}

export function readAreaSafety(payload: unknown, mode: DataMode): AreaSafety | null {
  const value = payload as Partial<AreaSafety> | null;
  if (!value || value.schemaVersion !== "area-safety.v1" || !Array.isArray(value.types)) return null;
  if (mode === "real" && value.productReleaseId?.startsWith("preview-")) return null;
  return value as AreaSafety;
}

/** How long a trend covers in words: "3 years", "1 year", "11 months". */
export function spanWords(months: number): string {
  const years = Math.round(months / 12);
  return years >= 2 ? `${years} years` : months >= 12 ? "1 year" : `${months} month${months === 1 ? "" : "s"}`;
}

/** "Stable over 3 years" (or "over 11 months" when less is loaded); null when the line should be drawn. */
export function stableWords(trend: SafetyTrend | null): string | null {
  if (!trend || !trend.stable) return null;
  return `Stable over ${spanWords(trend.months)}`;
}

/** "3,916.8", "8.1": a rate per 1,000 with one decimal and thousands separators. */
export function perThousand(rate: number): string {
  return rate.toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/**
 * The row's London figure (CUJ15 board "London ▲ 2.1"): London's own rate, with ▲ or ▼ when this area's
 * differs from it by as much as rateChip counts; null without London's rate. Outside London the figure is the
 * area's region's (`scope`, the payload's rankScope name).
 */
export function londonRateChip(rate: number | null, london: number | null, scope = "London"): string | null {
  if (london === null) return null;
  const gap = rateChip(rate, london);
  return `${scope} ${gap ? `${gap.startsWith("+") ? "▲" : "▼"} ` : ""}${perThousand(london)}`;
}

/** The name of the region the safety figures compare with: London unless the payload names another. */
export function safetyScope(safety: AreaSafety): string {
  return safety.rankScope?.name ?? "London";
}

/** "−24" per 1,000 against London, when the gap is a quarter of London's rate and at least 1; else null. */
export function rateChip(rate: number | null, london: number | null): string | null {
  if (rate === null || london === null) return null;
  const gap = rate - london;
  if (Math.abs(gap) < Math.max(1, london * 0.25)) return null;
  const size = Math.abs(gap) >= 10 ? Math.round(Math.abs(gap)).toString() : Math.abs(gap).toFixed(1);
  return `${gap > 0 ? "+" : "−"}${size}`;
}

/** An offence type in words: the police API's slug ("anti-social-behaviour") reads "Anti-social behaviour". */
export function offenceLabel(category: string): string {
  if (category === "anti-social-behaviour") return "Anti-social behaviour";
  if (!/^[a-z]+(-[a-z]+)*$/.test(category)) return category;
  const words = category.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
