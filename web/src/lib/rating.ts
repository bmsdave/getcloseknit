/**
 * The /10 rating behind <Rating> and <RatingBadge> (docs/area-card-2026-10/spec.md §3).
 * Pure, so it is unit tested without a DOM.
 *
 * `percentile` is the area's London percentile: the share (0–100) of London
 * areas with a lower value. A score is only ever derived from that real
 * distribution; without one the rating says "No rating", never a guess.
 */

import { regionShare } from "./evidence-format";

/** Trend arrows need at least this many sales/observations. Mirrors
 *  MIN_AREA_SALES in api/area_api/market.py (the market section's rule). */
export const RATING_TREND_MIN_SAMPLE = 10;

/** Band words for scores 1–2, 3–4, 5–6, 7–8, 9–10; the top band names its decile (9 "Top 20%", 10 "Top 10%"). */
export const RATING_BANDS = ["Well below London", "Below", "Middle", "Above", "Top 20%"] as const;
export const TOP_DECILE_BAND = "Top 10%";
export const NO_RATING = "No rating";

export type RatingTrend = {
  /** Change in per cent, e.g. 4 or -6. */
  pct: number;
  /** What it is compared with, shown after "vs": "2025", "last year". */
  period: string;
  /** true: up is good; false: up is bad; null: neither (neutral colour). */
  goodWhenUp: boolean | null;
  /** Sales/observations behind it; below RATING_TREND_MIN_SAMPLE the arrow is hidden.
   *  Required for count-based trends (sales, listings): left out, the sample
   *  rule is skipped, so omit it only for trends not built from a count. */
  n?: number;
};

export type RatingInput = {
  label: string;
  percentile: number | null;
  /** null for context metrics (Price, People): neutral colour and no score. */
  higherIsBetter: boolean | null;
  trend?: RatingTrend;
  fact?: string;
  /** The comparison word in the spoken label: "safer", "pricier". Defaults to
   *  "better" for rated metrics and "higher" for neutral ones. */
  comparative?: string;
  /** What the percentile is "of": the area's region (API rankScope), London by default. */
  scope?: string;
};

/** 1–5 is the diverging ramp (bad → neutral → good); "neutral" for context metrics; "none" without data. */
export type RatingTone = 1 | 2 | 3 | 4 | 5 | "neutral" | "none";

export type RatingModel = {
  /** 1–10, or null without a valid percentile or for a neutral metric. */
  score: number | null;
  /** Stitched blocks of 10: the score, or for a neutral metric its plain position. */
  steps: number;
  /** The band word; for a neutral metric the plain comparison ("pricier than 83% of London"). */
  band: string;
  tone: RatingTone;
  /** 0–1 along the scale marker (low → high merit; raw position when neutral). */
  position: number | null;
  /** The percentile the label speaks of: flipped when lower is better. */
  share: number | null;
};

export type TrendView = {
  direction: "up" | "down" | "flat";
  /** Visible text, e.g. "+4% vs 2025". */
  text: string;
  /** Spoken text, e.g. "up 4% vs 2025". */
  spoken: string;
  tone: "good" | "bad" | "neutral";
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
/** A real London percentile: finite and within 0–100. Anything else is "No rating". */
const valid = (p: number | null): p is number => p !== null && Number.isFinite(p) && p >= 0 && p <= 100;

/** clamp(ceil(p/10), 1, 10) of the (flipped when lower is better) percentile. */
export function ratingScore(percentile: number | null, higherIsBetter: boolean | null): number | null {
  if (!valid(percentile) || higherIsBetter === null) return null;
  return clamp(Math.ceil((higherIsBetter ? percentile : 100 - percentile) / 10), 1, 10);
}

export const ratingBand = (score: number) => score >= 10 ? TOP_DECILE_BAND : RATING_BANDS[clamp(Math.ceil(score / 2), 1, 5) - 1];

/** `comparative` words a neutral metric's comparison ("pricier"); a merit band
 *  word such as "Top 10%" would praise an expensive area. */
export function ratingModel(percentile: number | null, higherIsBetter: boolean | null, comparative?: string, scope = "London"): RatingModel {
  if (!valid(percentile)) return { score: null, steps: 0, band: NO_RATING, tone: "none", position: null, share: null };
  const p = percentile;
  if (higherIsBetter === null) {
    const steps = clamp(Math.ceil(p / 10), 1, 10);
    const band = `${comparative ?? "higher"} than ${regionShare(p)}% of ${scope}`;
    return { score: null, steps, band, tone: "neutral", position: p / 100, share: p };
  }
  const share = higherIsBetter ? p : 100 - p;
  const score = ratingScore(p, higherIsBetter)!;
  return { score, steps: score, band: ratingBand(score).replace(/London$/, scope), tone: clamp(Math.ceil(score / 2), 1, 5) as RatingTone, position: share / 100, share };
}

/** The trend to show, or null when it is missing or its sample is too small. */
/** A change in whole percent with its sign ("+3%", "−1%", "0%"): the one rounding for every change on the card. */
export function signedPercent(pct: number): string {
  const size = Math.round(Math.abs(pct));
  return size === 0 ? "0%" : `${pct > 0 ? "+" : "−"}${size}%`;
}

export function trendView(trend: RatingTrend | undefined): TrendView | null {
  if (!trend || !Number.isFinite(trend.pct)) return null;
  if (trend.n !== undefined && !(trend.n >= RATING_TREND_MIN_SAMPLE)) return null;
  const size = Math.round(Math.abs(trend.pct));
  const vs = `vs ${trend.period}`;
  if (size === 0) return { direction: "flat", text: `0% ${vs}`, spoken: `no change ${vs}`, tone: "neutral" };
  const up = trend.pct > 0;
  const tone = trend.goodWhenUp === null ? "neutral" : up === trend.goodWhenUp ? "good" : "bad";
  return { direction: up ? "up" : "down", text: `${signedPercent(trend.pct)} ${vs}`, spoken: `${up ? "up" : "down"} ${size}% ${vs}`, tone };
}

/** The accessible sentence, e.g. "Safety 8 out of 10, safer than 74% of London, down 6% vs last year". */
export function ratingLabel({ label, percentile, higherIsBetter, trend, fact, comparative, scope = "London" }: RatingInput): string {
  const model = ratingModel(percentile, higherIsBetter, comparative, scope);
  const parts: string[] = [];
  if (model.share === null) {
    parts.push(`${label}: ${NO_RATING.toLowerCase()}`);
    if (fact) parts.push(fact);
  } else if (model.score === null) {
    parts.push(`${label}: ${model.band}`);
  } else {
    parts.push(`${label} ${model.score} out of 10`, `${comparative ?? "better"} than ${regionShare(model.share)}% of ${scope}`);
  }
  // A trend stands on its own sample rule, so it shows even without a rating.
  const shown = trendView(trend);
  if (shown) parts.push(shown.spoken);
  return parts.join(", ");
}
