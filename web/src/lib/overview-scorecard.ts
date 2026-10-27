import type { AreaProfileResponse, AreaSummary, MetricId, PROFILE_METRIC_IDS } from "./contracts";
import type { HelpId } from "./help-texts";
import type { ScaleDirection } from "./map-legend";
import type { PriceChange } from "./price-change";

/** Home sizes the Overview prices: typical London floor areas per bedroom count. */
export const HOME_SIZES = [
  { bedrooms: 1, label: "1-bed", squareMetres: 50 },
  { bedrooms: 2, label: "2-bed", squareMetres: 70 },
  { bedrooms: 3, label: "3-bed", squareMetres: 95 },
] as const;
export type HomeSize = (typeof HOME_SIZES)[number]["squareMetres"];

/** 1 bed -> 50 m², 2 -> 70, 3 or more -> 95; anything else (studio, unknown) -> 70. */
export function defaultHomeSize(bedrooms: number | null | undefined): HomeSize {
  if (bedrooms === 1) return 50;
  if (typeof bedrooms === "number" && bedrooms >= 3) return 95;
  return 70;
}

export function isHomeSize(value: unknown): value is HomeSize {
  return HOME_SIZES.some((size) => size.squareMetres === value);
}

export function homeSizeLabel(size: HomeSize): string {
  return HOME_SIZES.find((option) => option.squareMetres === size)?.label ?? `${size} m²`;
}

/**
 * £/m² rounded one way everywhere (tile, home cost, card header): to the
 * nearest £100, so every place shows the same figure.
 */
export function roundPricePerSquareMetre(value: number): number {
  return Math.round(value / 100) * 100;
}

/** "£10,100/m²": the rounded price per square metre. */
export function formatPricePerSquareMetre(value: number): string {
  return `£${roundPricePerSquareMetre(value).toLocaleString("en-GB")}/m²`;
}

/**
 * Floor area times the rounded £/m² (so the sum shown beside it adds up),
 * rounded to the nearest £1,000; null when the price is unknown.
 */
export function homeCost(pricePerSquareMetre: number | null, squareMetres: number): number | null {
  if (pricePerSquareMetre === null || !Number.isFinite(pricePerSquareMetre) || pricePerSquareMetre <= 0) return null;
  return Math.round((roundPricePerSquareMetre(pricePerSquareMetre) * squareMetres) / 1000) * 1000;
}

/** One verdict against London, worded the same on area, brief and postcode pages. */
export type LondonVerdict = "Lower than most of London" | "About average for London" | "Higher than most of London";

/**
 * Where a London percentile sits, in words: at or below 40 lower, at or above
 * 60 higher, else about average. Null when no percentile was published.
 */
export function londonVerdict(percentile: number | null | undefined): LondonVerdict | null {
  if (percentile === null || percentile === undefined || !Number.isFinite(percentile)) return null;
  if (percentile <= 40) return "Lower than most of London";
  if (percentile >= 60) return "Higher than most of London";
  return "About average for London";
}

/** "59 crimes per 1,000 people a year" (the rate is a rolling 12 months). */
export function crimeRateWords(value: number): string {
  return `${Math.round(value).toLocaleString("en-GB")} crimes per 1,000 people a year`;
}

/** "About average for London · 59 crimes per 1,000 people a year"; null when unknown. */
export function crimeVerdict(crime: Pick<AreaSummary, "value" | "regionPercentile"> | null): string | null {
  if (!crime || crime.value === null) return null;
  const verdict = londonVerdict(crime.regionPercentile);
  return verdict ? `${verdict} · ${crimeRateWords(crime.value)}` : crimeRateWords(crime.value);
}

export const BUSY_CENTRE_NOTE = "Busy centre: counts include shops and stations";

/**
 * Crime is counted per resident, so a centre with few residents and many
 * visitors reads high. True when the residents behind the rate (crimes ÷
 * rate) are under 1,000 or the rate is above 200 per 1,000.
 */
export function busyCentre(crime: Pick<AreaSummary, "value" | "sampleCount"> | null): boolean {
  if (!crime || crime.value === null || crime.value <= 0) return false;
  if (crime.value > 200) return true;
  return crime.sampleCount !== null && crime.sampleCount !== undefined && (crime.sampleCount * 1000) / crime.value < 1000;
}

/** Schools are counted within this distance everywhere (tile, card, brief). */
export const SCHOOL_RADIUS_METRES = 1000;

/** "about half of homes": a share of homes in plain words. */
export function shareOfHomes(share: number): string {
  if (share < 0.05) return "very few homes";
  if (share < 0.15) return "about 1 in 10 homes";
  if (share < 0.23) return "about 1 in 5 homes";
  if (share < 0.29) return "about a quarter of homes";
  if (share < 0.42) return "about a third of homes";
  if (share < 0.58) return "about half of homes";
  if (share < 0.71) return "about two-thirds of homes";
  if (share < 0.85) return "about three-quarters of homes";
  return "almost all homes";
}

/** "about half of homes hear busy-road noise" (road or rail at 55 dB or more); null when unknown. */
export function noiseShareWords(noise: AreaProfileResponse["noise"]): string | null {
  if (!noise || !noise.available || noise.any55Share === null) return null;
  return `${shareOfHomes(noise.any55Share)} hear busy-road noise`;
}

export interface TrendWords {
  direction: "up" | "down" | "flat" | "unknown";
  arrow: string;
  text: string;
}

/** "▲ 4.2%" / "▼ 1.3%" / "No change"; "unknown" without a year of history. */
export function trendWords(change: PriceChange | null): TrendWords {
  if (!change) return { direction: "unknown", arrow: "", text: "unknown" };
  const rounded = Math.round(change.percent * 10) / 10;
  if (rounded === 0) return { direction: "flat", arrow: "■", text: "No change" };
  const percent = `${Math.abs(rounded).toFixed(1)}%`;
  return rounded > 0
    ? { direction: "up", arrow: "▲", text: percent }
    : { direction: "down", arrow: "▼", text: percent };
}

export type ScoredMetricId = (typeof PROFILE_METRIC_IDS)[number];

/**
 * London score 1–10: the tenth of London areas this one falls in, counting
 * how much of the named thing it has (10 = most crime, most deprived,
 * priciest). Deprivation deciles run the other way (10 = least deprived),
 * so a higher-is-better scale flips. Null when no percentile was published.
 */
export function londonScore(percentile: number | null, direction: ScaleDirection): number | null {
  if (percentile === null || !Number.isFinite(percentile)) return null;
  const clamped = Math.min(100, Math.max(0, percentile));
  const decile = Math.min(10, Math.floor(clamped / 10) + 1);
  return direction === "higher-is-better" ? 11 - decile : decile;
}

/** Badge colour: green -> red where more is worse (crime, deprivation); neutral elsewhere. */
export type ScoreTone = "neutral" | "1" | "2" | "3" | "4" | "5";
export function scoreTone(metricId: MetricId, score: number | null): ScoreTone {
  if (score === null || (metricId !== "crime" && metricId !== "deprivation")) return "neutral";
  return String(Math.ceil(score / 2)) as ScoreTone;
}

/** The scored topics, in the order the Overview shows them. */
export const SCORED_METRICS: ReadonlyArray<{ id: ScoredMetricId; label: string; help: HelpId }> = [
  { id: "price-per-square-metre", label: "Price", help: "scorecard-price" },
  { id: "crime", label: "Crime", help: "scorecard-crime" },
  { id: "deprivation", label: "Deprivation", help: "scorecard-deprivation" },
  { id: "income", label: "Income", help: "scorecard-income" },
  { id: "social-renting", label: "Social renting", help: "scorecard-social-renting" },
];

/** "2 primary · 1 secondary within 1 km"; "unknown" when no count was published. */
export function schoolsWords(schools: AreaProfileResponse["schools"]): string {
  if (!schools) return "unknown";
  return `${schools.primary} primary · ${schools.secondary} secondary within ${schools.radiusMetres / 1000} km`;
}

/** any55Share is a 0–1 share of homes at 55 dB or more: <10% quiet, 10–40% some noise, >40% busy. */
export function noiseWords(noise: AreaProfileResponse["noise"]): string {
  if (!noise || !noise.available || noise.any55Share === null) return "unknown";
  if (noise.any55Share < 0.1) return "Quiet";
  if (noise.any55Share <= 0.4) return "Some road noise";
  return "Busy";
}

/** The profile's summary for one metric, or null when it was not published. */
export function profileMetric(profile: AreaProfileResponse | null, metricId: MetricId): AreaSummary | null {
  return profile?.metrics.find((entry) => entry.metricId === metricId && entry.value !== null) ?? null;
}
