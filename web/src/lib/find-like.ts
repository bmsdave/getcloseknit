// "Like this": the area's own evidence as a starting search. The area's place
// criteria come from the similar-areas answer (api/area_api/similarity.py), which carries the
// area's London percentiles; its price band and nearby schools come from the area brief. Only
// area-level figures are used, never a price for one home. The official deprivation decile is taken
// (a criterion again); household income and social renting are left out on purpose: they describe
// who lives somewhere, and are not match criteria (RETIRED_FACTOR_IDS).
import type { BriefArea, BriefSchool } from "./brief-model";
import { rankPlace } from "./coverage-words";
import type { FactorId, FactorPreference, PreferenceProfile, SimilarAreasResponse } from "./contracts";

/** How far below this area's fit a criterion may fall (percentile points) before an area is left out. */
export const LIKE_FLOOR = 15;
/** Price per m² stays within this many percentile points either side of this area's. */
export const LIKE_PRICE_BAND = 10;
/** The deprivation decile's London percentile stays within this many points either side: about a decile. */
export const LIKE_DEPRIVATION_BAND = 15;
/** About a 15-minute walk, the wizard's "Good schools" distance. */
export const LIKE_SCHOOL_METRES = 1_200;

type Vector = Partial<Record<FactorId, { rawValue: number; utility: number }>>;

export interface LikeSeed {
  /** Budget up to, rounded (null: no area price to start from). */
  budget: number | null;
  /** Crime, station walk, price level and deprivation decile as limits around this area's own fit. */
  factors: FactorPreference[];
  /** A good or outstanding school within about a 15-minute walk: "Good schools" matters. */
  schools: boolean;
  /** What was taken from the area, in plain words, in the order shown. */
  criteria: string[];
}

/** The area's own percentiles, read back from the similar-areas answer (every match carries them). */
export function targetVector(similar: SimilarAreasResponse | null): Vector {
  const vector: Vector = {};
  for (const match of similar?.values ?? []) {
    for (const component of match.components) {
      vector[component.factorId] ??= { rawValue: component.targetRawValue, utility: component.targetUtility };
    }
  }
  return vector;
}

export function likeSeed(input: {
  market: PreferenceProfile["market"];
  area: Pick<BriefArea, "estimatedPrice" | "priceContext"> | null;
  schools: BriefSchool[];
  similar: SimilarAreasResponse | null;
}): LikeSeed {
  const vector = targetVector(input.similar);
  const criteria: string[] = [];
  const factors: FactorPreference[] = [];
  const budget = likeBudget(input.market, input.area, criteria);
  const price = vector["market-level"];
  if (price) {
    const fit = 100 - price.utility;
    factors.push(limit("market-level", fit - LIKE_PRICE_BAND, fit + LIKE_PRICE_BAND));
    criteria.push(`${pricePerMetre(price, input.similar)} per m²`);
  }
  const crime = vector.crime;
  if (crime) {
    factors.push(limit("crime", 100 - crime.utility - LIKE_FLOOR, null));
    criteria.push(crimeWords(crime.utility));
  }
  const station = vector["station-access"];
  if (station) {
    factors.push(limit("station-access", 100 - station.utility - LIKE_FLOOR, null));
    criteria.push(`a station within about a ${Math.max(1, Math.round(station.rawValue))}-minute walk`);
  }
  const deprivation = vector.deprivation;
  if (deprivation) {
    // A higher decile (and percentile) is less deprived: the fit is the percentile itself.
    factors.push(limit("deprivation", deprivation.utility - LIKE_DEPRIVATION_BAND, deprivation.utility + LIKE_DEPRIVATION_BAND, "higher"));
    const [low, high] = bandRange("deprivation", deprivation, input.similar, LIKE_DEPRIVATION_BAND);
    criteria.push(`official deprivation decile ${low === high ? `about ${low}` : `${low}–${high}`} (1 = most deprived)`);
  }
  const schools = input.schools.some((school) => (school.grade.tier === "outstanding" || school.grade.tier === "good")
    && school.distanceMetres !== null && school.distanceMetres <= LIKE_SCHOOL_METRES);
  if (schools) criteria.push("good schools nearby");
  return { budget, factors, schools, criteria };
}

/** The seed's limits into the profile, replacing those factors' settings; other criteria stay as they are. */
export function applyLikeSeed(profile: PreferenceProfile, seed: LikeSeed): PreferenceProfile {
  const seeded = new Set(seed.factors.map((factor) => factor.factorId));
  return { ...profile, factors: [...profile.factors.filter((factor) => !seeded.has(factor.factorId)), ...seed.factors] };
}

/** "Like Highbury: budget up to £730k, £6.4k–£7.2k per m², crime lower than most of London, …" */
export function likeSummary(name: string, seed: LikeSeed): string {
  return seed.criteria.length ? `Like ${name}: ${seed.criteria.join(", ")}.` : `Like ${name}.`;
}

function likeBudget(market: PreferenceProfile["market"], area: Pick<BriefArea, "estimatedPrice" | "priceContext"> | null, criteria: string[]): number | null {
  const context = area?.priceContext;
  if (market === "buy" && context?.available) {
    // Up to the top of the middle half of recent sales here, so most homes like these are in reach.
    const budget = Math.round(context.p75 / 10_000) * 10_000;
    criteria.push(`budget up to ${thousands(budget)} (middle half of ${context.sales} sales here in ${context.windowMonths} months: `
      + `${thousands(context.p25)}–${thousands(context.p75)})`);
    return budget;
  }
  const price = area?.estimatedPrice ?? null;
  if (price === null) return null;
  if (market === "rent") {
    const rent = Math.round(price / 50) * 50;
    criteria.push(`budget about £${rent.toLocaleString("en-GB")} a month (the borough's average rent)`);
    return rent;
  }
  const budget = Math.round(price / 10_000) * 10_000;
  criteria.push(`budget about ${thousands(budget)} (a typical home price here)`);
  return budget;
}

/** The price per m² range of this area and the similar areas inside the band; one figure when alone. */
function pricePerMetre(target: { rawValue: number; utility: number }, similar: SimilarAreasResponse | null): string {
  const [low, high] = bandRange("market-level", target, similar, LIKE_PRICE_BAND);
  return low === high ? `about ${perMetre(low)}` : `${perMetre(low)}–${perMetre(high)}`;
}

/** The lowest and highest raw value of this area and the similar areas within `band` percentile points of it. */
function bandRange(factorId: FactorId, target: { rawValue: number; utility: number }, similar: SimilarAreasResponse | null, band: number): [number, number] {
  const values = [target.rawValue];
  for (const match of similar?.values ?? []) {
    const value = match.components.find((component) => component.factorId === factorId);
    if (value && Math.abs(value.utility - target.utility) <= band) values.push(value.rawValue);
  }
  return [Math.min(...values), Math.max(...values)];
}

function crimeWords(percentile: number): string {
  if (percentile <= 40) return `crime lower than most of ${rankPlace()}`;
  if (percentile >= 60) return "crime no higher than here";
  return `crime about average for ${rankPlace()}`;
}

function limit(factorId: FactorId, minimum: number, maximum: number | null, direction: FactorPreference["direction"] = "lower"): FactorPreference {
  const clamp = (value: number) => Math.min(100, Math.max(0, Math.round(value)));
  const floor = clamp(minimum);
  return {
    factorId, weight: 3, direction,
    minimumUtility: floor > 0 ? floor : null,
    maximumUtility: maximum === null || clamp(maximum) >= 100 ? null : clamp(maximum),
  };
}

function thousands(value: number): string {
  return `£${Math.round(value / 1000).toLocaleString("en-GB")}k`;
}

function perMetre(value: number): string {
  return `£${(Math.round(value / 100) / 10).toLocaleString("en-GB")}k`;
}
