import type { FactorPreference, PlacePreference, PreferenceProfile } from "./contracts";
import { DEFAULT_EDGE } from "./match-model";

/**
 * The current panel's levels (until the v4 panel rewrite): importance dots 1–5 (0 = off) and a "Must". The model
 * (lib/match-model.ts) reads them as one ordered list: dots give the order (weight descending), a Must is a filter
 * with no weight whose edges sit at its range (a factor's range is the chip default: the better half of London).
 */
export interface PriorityLevel {
  dots: number;
  must: boolean;
}

export const OFF: PriorityLevel = { dots: 0, must: false };
/** Dots a criterion gets when it is first turned on (by Must, or by a link with no weight): the old "Matters". */
export const DEFAULT_DOTS = 3;
/**
 * How a v1 factor stores its Must: a minimum of DEFAULT_EDGE, i.e. the range end of the chip default (London's better
 * half) with no soft edge. Not a cut on a fit: the model migrates it to a range with edges at 0 (migrateV1).
 */
export const MUST_EDGE = DEFAULT_EDGE;

/** A stored weight (0–5, any number in old saves) as whole dots: 0 stays off, anything above counts at least 1. */
export function importanceDots(weight: number): number {
  if (!Number.isFinite(weight) || weight <= 0) return 0;
  return Math.min(5, Math.max(1, Math.round(weight)));
}

function factorMust(factor: FactorPreference): boolean {
  return factor.minimumUtility !== null || factor.maximumUtility !== null;
}

/** A factor's level. An old "Must have" saved as weight 0 plus a minimum still counted: it reads as 3 dots and Must. */
export function factorLevel(factor: FactorPreference | undefined): PriorityLevel {
  if (!factor) return OFF;
  const must = factorMust(factor);
  const dots = importanceDots(factor.weight);
  return { dots: must && dots === 0 ? DEFAULT_DOTS : dots, must };
}

/** A place's level: a place in the search always counts (at least one dot). */
export function placeLevel(place: PlacePreference | undefined): PriorityLevel {
  if (!place) return OFF;
  return { dots: Math.max(1, importanceDots(place.weight)), must: place.must };
}

/** Tapping dot n: the lit top dot again turns the criterion off (and its Must); another dot sets the weight. */
export function tapDot(level: PriorityLevel, dot: number): PriorityLevel {
  return dot === level.dots ? OFF : { dots: dot, must: level.must };
}

/** Tapping Must: on (an off criterion starts at 3 dots), or off keeping its dots. */
export function tapMust(level: PriorityLevel): PriorityLevel {
  return level.must ? { ...level, must: false } : { dots: level.dots || DEFAULT_DOTS, must: true };
}

/** The factor's stored fields for a level; a Must kept on keeps the factor's own limit (a link may carry another). */
export function factorFields(level: PriorityLevel, factor?: FactorPreference): Pick<FactorPreference, "weight" | "minimumUtility" | "maximumUtility"> {
  if (level.dots === 0 || !level.must) return { weight: level.dots, minimumUtility: null, maximumUtility: null };
  if (factor && factorMust(factor)) return { weight: level.dots, minimumUtility: factor.minimumUtility, maximumUtility: factor.maximumUtility };
  return { weight: level.dots, minimumUtility: MUST_EDGE, maximumUtility: null };
}

/**
 * Saved and shared searches from before the one model (Off / Matters / Must have, or free 0–5 weights) in
 * whole dots, so what the wizard shows is what is matched: factor weights round to 1–5, and a weight-0
 * must-have becomes 3 dots + Must. The budget and places (whole 0–5 already) are left as they are.
 * An unchanged profile keeps its identity.
 */
export function withCurrentLevels(profile: PreferenceProfile): PreferenceProfile {
  let changed = false;
  const factors = profile.factors.map((factor) => {
    if (factor.factorId === "affordability") return factor;
    const weight = factorLevel(factor).dots;
    if (weight === factor.weight) return factor;
    changed = true;
    return { ...factor, weight };
  });
  return changed ? { ...profile, factors } : profile;
}
