/**
 * Range criteria on the map: a range is 1 inside [min, max], falls linearly to 0 across its
 * soft edges and is 0 beyond; "Must" is the preset with no soft edge (a filter with no weight). The score is the
 * weighted geometric mean of the ranked criteria's fits (lib/match-model.ts, api/area_api/match_model.py); a fit of 0
 * scores 0 (red on the map), only a failed Must is out.
 */
import type { GeographyId, MatchComponent, MatchCriterion, MatchPack, MatchResult, PlaceTarget, RangeCriterion, RangeFactorId } from "./contracts";
import { regionShare } from "./evidence-format";
import { DEFAULT_EDGE, DEFAULT_SOFT, roundHalfUp, scoreOf } from "./match-model";

export const RANGE_PREFIX = "range:";

export function rangeFactorId(layer: string): RangeFactorId {
  return `${RANGE_PREFIX}${layer}` as RangeFactorId;
}

export function isRangeFactor(id: string): id is RangeFactorId {
  return id.startsWith(RANGE_PREFIX);
}

export function rangeLayerOf(id: string): string {
  return id.slice(RANGE_PREFIX.length);
}

/** 1 inside [min, max]; across a soft edge, linear down to 0 at the edge; 0 beyond (range_fit). */
export function rangeFit(value: number, criterion: Pick<RangeCriterion, "min" | "max" | "softMin" | "softMax">): number {
  const { min, max, softMin, softMax } = criterion;
  if (min !== null && value < min) {
    return softMin === null || softMin >= min || value <= softMin ? 0 : (value - softMin) / (min - softMin);
  }
  if (max !== null && value > max) {
    return softMax === null || softMax <= max || value >= softMax ? 0 : (softMax - value) / (softMax - max);
  }
  return 1;
}

/** "Must": no soft edge on either side (range_is_strict). */
export function isStrict(criterion: RangeCriterion): boolean {
  return (criterion.softMin === null || criterion.softMin === criterion.min)
    && (criterion.softMax === null || criterion.softMax === criterion.max);
}

/** The Must preset: both soft edges snap to the range. */
export function withMust(criterion: RangeCriterion): RangeCriterion {
  return { ...criterion, softMin: null, softMax: null };
}

/** A component's fit: the one it carries (every component of the v4 model does), else its 0–100 utility. */
export function componentFit(component: Pick<MatchComponent, "fit" | "utility">): number {
  return component.fit ?? component.utility / 100;
}

/**
 * The 0–100 score of a set of components: the weighted geometric mean of the ranked fits (weights are the
 * rank-order centroid shares, a Must weighs 0), `missingWeight` counted as half a fit; a fit of 0 scores 0.
 * Rounded to six decimals first, then half up, exactly as the API does.
 */
export function fitScore(components: readonly Pick<MatchComponent, "fit" | "utility" | "weight">[], missingWeight = 0): number {
  return roundHalfUp(scoreOf(components, missingWeight));
}

/** Every LSOA's value of one layer, for live colouring and the histogram. */
export type LayerValues = ReadonlyMap<string, number>;

/**
 * The pack as it would be with `draft` in place of (or added beside) its criterion: fits, limits and scores
 * recomputed from the values already in the pack, else from `values`. A strict draft is a Must (a filter, no weight);
 * a soft one keeps its criterion's weight (a new one weighs as the last of the list) and never puts an area out.
 * Ranks are left for rankPack. Used while a slider is dragged, so the map recolours before the match runs again.
 */
export function livePack(pack: MatchPack, draft: RangeCriterion, values: LayerValues | null): MatchPack {
  const id = rangeFactorId(draft.layer);
  // Values on a coarser carrier (MSOA, borough) cannot be read per area here: such areas wait for the match.
  const perArea = values !== null && [...values.keys()].some((key) => key.startsWith("uk:lsoa:"));
  const must = isStrict(draft);
  const ranked = (pack.criteria ?? []).filter((criterion) => !criterion.must && criterion.id !== id).map((criterion) => criterion.weight);
  const weight = must ? 0 : (pack.criteria?.find((criterion) => criterion.id === id && !criterion.must)?.weight ?? (ranked.length ? Math.min(...ranked) : 1));
  return {
    ...pack,
    values: pack.values.map((result) => {
      const existing = result.components.find((component) => component.factorId === id);
      const raw = existing?.rawValue ?? values?.get(result.geographyId);
      const others = result.components.filter((component) => component.factorId !== id);
      const limits = result.unmetLimits.filter((code) => !code.startsWith(`${id}:`));
      let components = others;
      if (raw !== undefined) {
        const fit = rangeFit(raw, draft);
        components = [...others, {
          ...(existing ?? { unit: "", contribution: 0, carrierGeographyId: result.geographyId as GeographyId, quality: "observed" as const, sourceVersion: "live" }),
          factorId: id, rawValue: raw, utility: fit * 100, fit, fitKind: fit >= 1 ? "in" : fit > 0 ? "edge" : "out", weight, must,
        }];
        if (must && fit <= 0) limits.push(`${id}:outside`);
      } else if (must && perArea) {
        limits.push(`${id}:missing`);
      }
      const excluded = limits.length > 0;
      const precise = scoreOf(components, result.missingWeight ?? 0);
      return { ...result, components, unmetLimits: limits, excluded, rankScore: precise, score: excluded ? null : roundHalfUp(precise), rank: null };
    }),
  };
}

/** The limit a code belongs to: "range:crime:outside" → "range:crime" (limitFactor in matching.ts). */
function limitOf(code: string): string {
  return code.slice(0, code.lastIndexOf(":"));
}

/** How many areas are left (not out) of all London areas in the pack. */
export function areasLeft(pack: MatchPack): { left: number; total: number } {
  return { left: pack.values.filter((result) => !result.excluded).length, total: pack.values.length };
}

/**
 * "−3,150": per limit, how many areas it alone puts out (they come back without it). Board V3-30b:
 * areas left without the criterion minus areas left with it.
 */
export function impacts(pack: MatchPack): Map<string, number> {
  const counts = new Map<string, number>();
  for (const result of pack.values) {
    const failing = new Set(result.unmetLimits.map(limitOf));
    if (failing.size === 1) {
      const [only] = failing;
      counts.set(only, (counts.get(only) ?? 0) + 1);
    }
  }
  return counts;
}

/** Under this share of the areas left, the hint names the criterion that cuts most (board V3-30b frame 3). */
export const CUT_HINT_SHARE = 0.1;

/** The criterion the hint names, and whether no area is left at all. */
export interface CutHint { id: string; none: boolean }

/**
 * The hint under the count: with no area left, the criterion that puts the most areas out ("No areas left — widen
 * Crime"); with few left (under a tenth) and two or more criteria cutting, the one that cuts most ("Station walk cuts
 * most — soften it"). Zones and the areas you ruled out are never named: there is no edge to soften.
 */
export function cutHint(pack: MatchPack): CutHint | null {
  const left = pack.values.filter((result) => !result.excluded).length;
  const counts = new Map<string, number>();
  for (const result of pack.values) {
    for (const id of new Set(result.unmetLimits.map(limitOf))) {
      if (id !== "zone" && id !== "mark") counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const none = left === 0;
  if (!counts.size || (!none && (counts.size < 2 || left >= pack.values.length * CUT_HINT_SHARE))) return null;
  let best: string | null = null;
  for (const [id, count] of counts) if (best === null || count > counts.get(best)!) best = id;
  return best === null ? null : { id: best, none };
}

/** How an area sits against one criterion, for the map popup: in range, on the soft edge (with its fit), or out. */
export type FitState = "in" | "edge" | "out";

export function fitState(fit: number): FitState {
  return fit >= 1 ? "in" : fit > 0 ? "edge" : "out";
}

/** Histogram of London's values over [low, high] in `bins` equal steps; the last bin holds the tail above. */
export function histogram(values: Iterable<number>, low: number, high: number, bins: number): number[] {
  const counts = new Array<number>(bins).fill(0);
  const span = Math.max(1e-9, high - low);
  for (const value of values) {
    const index = Math.min(bins - 1, Math.max(0, Math.floor((value - low) / span * bins)));
    counts[index] += 1;
  }
  return counts;
}

// ---- The "What matters" chips and their defaults (the one place for them) ----------------------

/** A one-tap chip: the card it adds, with defaults; nothing to answer first. */
export interface MatchChip {
  id: string;
  /** The chip and card name ("Safer streets"). */
  label: string;
  /** The card's second name, what it measures ("crime"). */
  measure: string;
  criterion: MatchCriterion;
  /** "Safer than 91% of London": the top-10 "why" words for a London percentile (0 lowest … 100 highest value). */
  why?: (percentile: number) => string;
  /** Off by default until its data is live (FLAGS.md). */
  flag?: string;
}

/** The better half of London inside, the soft edge a quarter further (the chip default, as for agents). */
function lowerHalf(layer: string): MatchCriterion {
  return { kind: "range", layer, scale: "percentile", min: null, max: 100 - DEFAULT_EDGE, softMin: null, softMax: 100 - DEFAULT_EDGE + DEFAULT_SOFT, must: false };
}

function upperHalf(layer: string): MatchCriterion {
  return { kind: "range", layer, scale: "percentile", min: DEFAULT_EDGE, max: null, softMin: DEFAULT_EDGE - DEFAULT_SOFT, softMax: null, must: false };
}

function nearest(id: string, label: string, target: PlaceTarget, minutes: number): MatchCriterion {
  return { kind: "place", id, label, target, mode: "walk", targetMinutes: minutes, must: false };
}

const better = (word: string) => (percentile: number) => `${word} than ${regionShare(100 - percentile)}%`;
const higher = (word: string) => (percentile: number) => `${word} than ${regionShare(percentile)}%`;

/**
 * The chip defaults table (board V4-21c): Safer streets, Less disorder, Quiet streets, Clean air and Station walk keep
 * the better half of London (≤ the London median, soft to the 75th percentile); Good schools and Street trees the
 * upper half; the places are the nearest of a kind on foot with a +50% soft edge. On a percentile so the defaults need
 * no data and read the same for agents (find_areas); Fine-tune turns a range into the layer's own values.
 */
export const MATCH_CHIPS: readonly MatchChip[] = [
  { id: "safer-streets", label: "Safer streets", measure: "crime", criterion: lowerHalf("crime"), why: better("safer") },
  { id: "good-schools", label: "Good schools", measure: "school score", criterion: upperHalf("schools"), why: higher("schools better") },
  { id: "quiet-streets", label: "Quiet streets", measure: "road noise", criterion: lowerHalf("noise"), why: better("quieter") },
  { id: "parks-nearby", label: "Parks nearby", measure: "walk to a park", criterion: nearest("park", "Park", { kind: "category", category: "park" }, 10) },
  { id: "less-disorder", label: "Less disorder", measure: "antisocial behaviour", criterion: lowerHalf("disorder"), why: better("calmer") },
  { id: "clean-air", label: "Clean air", measure: "NO₂", criterion: lowerHalf("air-no2"), why: better("cleaner air") },
  { id: "top-primary", label: "Top primary", measure: "walk to a top-100 primary",
    criterion: nearest("top-primary", "Top primary", { kind: "school", phase: "primary", top: 100 }, 10) },
  { id: "station-walk", label: "Station walk", measure: "walk to a station", criterion: lowerHalf("station-access"), why: better("closer to a station") },
  { id: "fewer-collisions", label: "Fewer road collisions", measure: "road collisions", criterion: lowerHalf("road-collisions"),
    why: better("fewer collisions"), flag: "MATCH_CHIP_COLLISIONS" },
  { id: "street-trees", label: "Street trees", measure: "green streets", criterion: upperHalf("green-streets"), why: higher("greener") },
  { id: "gym-nearby", label: "Gym nearby", measure: "walk to a gym", criterion: nearest("gym", "Gym", { kind: "category", category: "gym" }, 10) },
  { id: "cafes-nearby", label: "Cafés nearby", measure: "walk to a café", criterion: nearest("cafe", "Café", { kind: "category", category: "cafe" }, 5) },
];

/** Chips off by default (FLAGS.md): a chip's data is not live yet. */
export const CHIP_FLAGS: Record<string, boolean> = { MATCH_CHIP_COLLISIONS: false };

/** The chips on offer: flagged-off chips are left out. */
export function liveChips(flags: Record<string, boolean> = CHIP_FLAGS): MatchChip[] {
  return MATCH_CHIPS.filter((chip) => !chip.flag || flags[chip.flag]);
}

/** The 21c start order, and the first six for each answer to "Kids at home?" / "Do you drive?" (board V4-21d). */
const START_ORDER = ["safer-streets", "good-schools", "quiet-streets", "parks-nearby", "less-disorder", "clean-air"];
const ANSWER_ORDER: Record<string, string[]> = {
  "yes/no": ["good-schools", "top-primary", "safer-streets", "parks-nearby", "station-walk", "fewer-collisions"],
  "yes/yes": ["good-schools", "top-primary", "safer-streets", "fewer-collisions", "parks-nearby", "quiet-streets"],
  "no/no": ["safer-streets", "station-walk", "cafes-nearby", "gym-nearby", "quiet-streets", "clean-air"],
  "no/yes": ["safer-streets", "quiet-streets", "clean-air", "gym-nearby", "fewer-collisions", "street-trees"],
};

/** Kids at home? Do you drive? Each only pre-orders the suggestions (never shown or used elsewhere). */
export interface ChipAnswers { kids?: boolean; drive?: boolean }

/** The suggestions, most likely first: the answers' six, then the start order, then the rest; `taken` ids left out. */
export function suggestedChips(answers: ChipAnswers, taken: ReadonlySet<string>, flags: Record<string, boolean> = CHIP_FLAGS): MatchChip[] {
  const answered = answers.kids !== undefined || answers.drive !== undefined;
  const key = `${answers.kids ? "yes" : "no"}/${answers.drive ? "yes" : "no"}`;
  const first = answered ? ANSWER_ORDER[key] : START_ORDER;
  const chips = liveChips(flags);
  const at = (id: string) => {
    const index = first.indexOf(id);
    if (index >= 0) return index;
    const start = START_ORDER.indexOf(id);
    return start >= 0 ? 10 + start : 20 + chips.findIndex((chip) => chip.id === id);
  };
  return chips.filter((chip) => !taken.has(chipCriterionId(chip))).sort((a, b) => at(a.id) - at(b.id));
}

/** The criterion id a chip adds (range:crime, place:park). */
export function chipCriterionId(chip: MatchChip): string {
  const item = chip.criterion;
  return item.kind === "range" ? rangeFactorId(item.layer) : item.kind === "place" ? `place:${item.id}` : item.kind;
}

/** The chip behind a criterion (a range on its layer, a place by its id), or null for the household's own. */
export function chipFor(id: string): MatchChip | null {
  return MATCH_CHIPS.find((chip) => chipCriterionId(chip) === id) ?? null;
}

/** Results by id, for quick lookups from the map. */
export function resultsById(pack: MatchPack | null): Map<string, MatchResult> {
  return new Map((pack?.values ?? []).map((result) => [result.geographyId, result]));
}
