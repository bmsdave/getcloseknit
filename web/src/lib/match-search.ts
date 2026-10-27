/**
 * My match as one ordered list: what the panel reads and writes.
 *
 * The household's search stays a preference-profile.v1 on this device (saved searches, Tailor, the brief and the
 * shortlists read it), with the v2 list kept in it: `order` (ids, Musts first), a range's `scale` and `must`, a place's
 * `softMinutes`, an own criterion's `must` and `where` (lib/match-model.ts migrateV1 reads them). `searchItems` gives
 * the list as v2 criteria; `withCriteria` writes a list back. The match request sends the v2 profile (contractProfile).
 *
 * The rest is the panel's arithmetic, on the client from the pack's own components (no request): how many areas each
 * criterion cuts (−N), how many are left, which criterion cuts most and what one "Soften" step would bring back, and
 * the re-scored pack after a reorder (re-sorted at once, then confirmed by the API).
 */
import type {
  FactorPreference, GeographyId, MatchCriterion, MatchPack, MatchResult, PlacePreference, PreferenceProfile, RangeCriterion,
} from "./contracts";
import type { CustomPreference } from "./custom-criteria";
import {
  contractProfile, criterionId, DEFAULT_EDGE, DEFAULT_SOFT, DEFAULT_SOFT_METRES, rocWeights, scorePack, SOFT_MINUTES_FACTOR, specs,
  type EvidenceRow,
} from "./match-model";
import type { ChipAnswers } from "./match-ranges";

/** One criterion of the list: its id, the v2 criterion, Must, its place among the ranked (1 = top) and weight. */
export interface SearchItem {
  id: string;
  criterion: MatchCriterion;
  must: boolean;
  /** #n among the ranked criteria (not Musts); null for a Must. */
  rank: number | null;
  /** The rank-order centroid share (0 for a Must). */
  weight: number;
}

/** The API's limits for one search (match_model.MAX_CRITERIA, matching.MAX_PLACES, MAX_ZONES). */
export const MAX_CRITERIA = 20;
export const MAX_PLACES = 8;
/** "Soften": one step widens the soft edge by this share of the criterion's span (board V4-21c). */
export const SOFTEN_STEP = 0.2;
/** The budget's step: a tenth of the budget (the old "Relax budget 10%"); a fifth of £600k would be £120k. */
export const BUDGET_SOFTEN_STEP = 0.1;
/**
 * The "X cuts most · Soften" hint hides once 300 areas, or half of London's, are left, whichever is more. The
 * spec's 300 alone hid it on every real search (King's Cross −2,341 left ~1,500); the boards draw it at 612 and
 * 1,104 of 4,994 left.
 */
export const SOFTEN_HINT_UNTIL = 300;
export const SOFTEN_HINT_SHARE = 0.5;
/** A new budget's target: the maximum typed less this share (£650k max → ≤ £600k, stretch to £650k). */
export const BUDGET_STRETCH = 0.08;
/** Minutes a place card's slider spans at least (board: 0 min … 60 min). */
export const PLACE_SPAN_MINUTES = 60;

/** Musts first (the "Must · filters" block on top), each block in its own order. */
export function mustsFirst<T extends { must?: boolean }>(list: readonly T[]): T[] {
  return [...list.filter((item) => item.must), ...list.filter((item) => !item.must)];
}

/** The search as v2 criteria (no internal keys), Musts first. */
export function searchCriteria(profile: PreferenceProfile): MatchCriterion[] {
  return mustsFirst(contractProfile(profile).criteria);
}

/** The list the panel shows: Musts on top, then the ranked criteria with #n and their weight. */
export function searchItems(profile: PreferenceProfile): SearchItem[] {
  const criteria = searchCriteria(profile);
  const weights = rocWeights(criteria.filter((item) => !item.must).length);
  let rank = 0;
  return criteria.map((criterion) => {
    const must = Boolean(criterion.must);
    if (must) return { id: criterionId(criterion), criterion, must, rank: null, weight: 0 };
    rank += 1;
    return { id: criterionId(criterion), criterion, must, rank, weight: weights[rank - 1] };
  });
}

/**
 * The match request for a search, as sent (preference-profile.v2 JSON): also the key that says whether a pack answers
 * the search on screen. Tailor answers, notes and the Kids/Drive answers are not in it (contractProfile).
 */
export function searchKey(profile: PreferenceProfile): string {
  return JSON.stringify(contractProfile(profile));
}

/** True once the household has a budget in the search (the first of the three start rows). */
export function hasBudget(profile: PreferenceProfile): boolean {
  return searchCriteria(profile).some((item) => item.kind === "budget");
}

/** Importance dots for older readers (the brief, saved searches): 5 for #1 … 1 from #5 on; a Must 3. */
function dotsFor(index: number | null): number {
  return index === null ? 3 : Math.max(1, 5 - index);
}

/**
 * Writes an ordered list back into the v1 profile: the budget as the affordability factor (a Must as its minimum),
 * places, ranges, own criteria and the Where zones, every other factor off, and `order`. Everything else in the
 * profile (Tailor answers, marks, school settings, the old commute) is kept as it was.
 */
export function withCriteria(profile: PreferenceProfile, list: readonly MatchCriterion[]): PreferenceProfile {
  const criteria = mustsFirst(list);
  const ranked = criteria.filter((item) => !item.must);
  const dots = (item: MatchCriterion) => dotsFor(item.must ? null : ranked.indexOf(item));
  const budget = criteria.find((item) => item.kind === "budget");
  const affordability: FactorPreference = {
    factorId: "affordability", direction: "target-range",
    weight: budget ? dots(budget) : 0, minimumUtility: budget?.must ? 1 : null, maximumUtility: null,
  };
  const factors = profile.factors.some((factor) => factor.factorId === "affordability")
    ? profile.factors.map((factor) => (factor.factorId === "affordability" ? { ...factor, ...affordability }
      : { ...factor, weight: 0, minimumUtility: null, maximumUtility: null }))
    : [affordability, ...profile.factors.map((factor) => ({ ...factor, weight: 0, minimumUtility: null, maximumUtility: null }))];
  const places: PlacePreference[] = [];
  const ranges: RangeCriterion[] = [];
  const custom: CustomPreference[] = [];
  let where: Extract<MatchCriterion, { kind: "where" }> | null = null;
  for (const item of criteria) {
    if (item.kind === "place") {
      places.push({
        id: item.id, label: item.label, target: item.target, mode: item.mode, targetMinutes: item.targetMinutes, weight: dots(item),
        must: Boolean(item.must), ...(item.when !== undefined ? { when: item.when } : {}),
        ...(item.softMinutes !== undefined ? { softMinutes: item.softMinutes } : {}),
      });
    } else if (item.kind === "range") {
      ranges.push({
        layer: item.layer, min: item.min, max: item.max, softMin: item.min === null ? null : item.softMin,
        softMax: item.max === null ? null : item.softMax, importance: dots(item), scale: item.scale ?? "value", must: Boolean(item.must),
      });
    } else if (item.kind === "custom") {
      custom.push({ criterion: item.criterion, weight: dots(item), direction: item.direction, must: Boolean(item.must) });
    } else if (item.kind === "where") {
      where = item;
    }
  }
  const next: PreferenceProfile = { ...profile, factors, order: criteria.map(criterionId) };
  setOrDrop(next, "places", places.length ? places : undefined);
  setOrDrop(next, "ranges", ranges.length ? ranges : undefined);
  setOrDrop(next, "custom", custom.length ? custom : undefined);
  const zones = (where as Extract<MatchCriterion, { kind: "where" }> | null);
  setOrDrop(next, "zones", zones ? [...zones.zones] : undefined);
  setOrDrop(next, "where", zones ? { must: Boolean(zones.must), softMetres: zones.softMetres ?? DEFAULT_SOFT_METRES } : undefined);
  return next;
}

function setOrDrop<K extends keyof PreferenceProfile>(profile: PreferenceProfile, key: K, value: PreferenceProfile[K] | undefined) {
  if (value === undefined) delete profile[key];
  else profile[key] = value;
}

/**
 * A saved or shared search in the panel's form: the old wizard's priorities become range criteria, the order is
 * written down. An unset profile (the default, or Tailor answers only) is left as it is, so it stays unset.
 */
export function normaliseSearch(profile: PreferenceProfile): PreferenceProfile {
  return withCriteria(profile, searchCriteria(profile));
}

/** A fresh search: no criteria at all (the three start rows), Tailor answers, marks and school settings kept. */
export function freshSearch(profile: PreferenceProfile): PreferenceProfile {
  return withCriteria(profile, []);
}

// ---- edits ---------------------------------------------------------------------------------------------

/** A new criterion joins at the end (a Must at the end of the Musts); one with the same id is left as it is. */
export function addCriterion(profile: PreferenceProfile, criterion: MatchCriterion): PreferenceProfile {
  const criteria = searchCriteria(profile);
  const id = criterionId(criterion);
  if (criteria.some((item) => criterionId(item) === id) || criteria.length >= MAX_CRITERIA) return profile;
  if (criterion.kind === "place" && criteria.filter((item) => item.kind === "place").length >= MAX_PLACES) return profile;
  return withCriteria(profile, [...criteria, criterion]);
}

export function removeCriterion(profile: PreferenceProfile, id: string): PreferenceProfile {
  return withCriteria(profile, searchCriteria(profile).filter((item) => criterionId(item) !== id));
}

/** Replaces one criterion in place (its card's edits); the id may change only for a place's label. */
export function replaceCriterion(profile: PreferenceProfile, id: string, next: MatchCriterion): PreferenceProfile {
  return withCriteria(profile, searchCriteria(profile).map((item) => (criterionId(item) === id ? next : item)));
}

/**
 * Must on: the criterion joins the Must block (no soft edge, no weight). Must off: it joins the end of the ranked
 * list with a soft edge (its own if it kept one, else the default for its kind).
 */
export function setMust(profile: PreferenceProfile, id: string, must: boolean, span: Span | null = null): PreferenceProfile {
  const criteria = searchCriteria(profile);
  const item = criteria.find((entry) => criterionId(entry) === id);
  if (!item || Boolean(item.must) === must) return profile;
  const others = criteria.filter((entry) => entry !== item);
  const changed = must ? { ...item, must: true } : withSoftEdge({ ...item, must: false }, span);
  return withCriteria(profile, [...others, changed as MatchCriterion]);
}

/** A soft edge for a criterion that has none (turning Must off): a range's default, a place's +50%. */
function withSoftEdge(item: MatchCriterion, span: Span | null): MatchCriterion {
  if (item.kind !== "range") return item;
  const hasEdge = (item.min !== null && item.softMin !== null && item.softMin < item.min)
    || (item.max !== null && item.softMax !== null && item.softMax > item.max);
  if (hasEdge) return item;
  const reach = item.scale === "percentile" ? DEFAULT_SOFT : span ? roundTo((span.high - span.low) / 10, span.step) : 0;
  if (!reach) return item;
  return {
    ...item,
    softMin: item.min === null ? null : Math.max(span?.low ?? (item.scale === "percentile" ? 0 : -Infinity), item.min - reach),
    softMax: item.max === null ? null : Math.min(span?.high ?? (item.scale === "percentile" ? 100 : Infinity), item.max + reach),
  };
}

/**
 * Moves a ranked criterion to `index` among the ranked (0 = #1); a Must moves within the Must block. Returns the
 * profile unchanged for an unknown id.
 */
export function moveCriterion(profile: PreferenceProfile, id: string, index: number): PreferenceProfile {
  const criteria = searchCriteria(profile);
  const item = criteria.find((entry) => criterionId(entry) === id);
  if (!item) return profile;
  const block = criteria.filter((entry) => Boolean(entry.must) === Boolean(item.must) && entry !== item);
  const at = Math.max(0, Math.min(block.length, index));
  block.splice(at, 0, item);
  const musts = item.must ? block : criteria.filter((entry) => entry.must);
  const ranked = item.must ? criteria.filter((entry) => !entry.must) : block;
  return withCriteria(profile, [...musts, ...ranked]);
}

/** The typed maximum as the budget: target = maximum less 8% (rounded), maximum = what was typed. */
export function budgetFromMaximum(maximum: number, market: "buy" | "rent"): { targetBudget: number; maximumBudget: number } {
  const unit = market === "rent" ? 50 : 5000;
  const target = Math.max(unit, Math.round((maximum * (1 - BUDGET_STRETCH)) / unit) * unit);
  return { targetBudget: Math.min(target, maximum), maximumBudget: maximum };
}

/**
 * A tool's price as the budget (CUJ06 / CUJ11 boards: "£570k typical area price, fades above it"): the price is
 * the comfortable end and the stretch goes above it, the inverse of budgetFromMaximum (£570k → ≤ £570k, to £620k).
 */
export function budgetFromTarget(target: number, market: "buy" | "rent"): { targetBudget: number; maximumBudget: number } {
  const unit = market === "rent" ? 50 : 5000;
  const maximum = Math.round(target / (1 - BUDGET_STRETCH) / unit) * unit;
  return { targetBudget: target, maximumBudget: Math.max(target, maximum) };
}

/**
 * The Budget row: market, the maximum (null clears the budget from the search) and the home type. A new budget is a
 * Must at the top (CUJ-01 v4: "Budget ≤ £600k Must"); an existing one keeps its Must and place.
 */
export function setBudget(profile: PreferenceProfile, change: {
  market?: "buy" | "rent"; maximum?: number | null; propertyType?: "house" | "flat" | "any";
  /** A tool's price: the comfortable end, the stretch above it (budgetFromTarget); wins over `maximum`. */
  target?: number;
}): PreferenceProfile {
  const market = change.market ?? profile.market;
  let next: PreferenceProfile = { ...profile, market };
  if (change.propertyType !== undefined) next = { ...next, propertyType: change.propertyType, houseTypes: change.propertyType === "house" ? next.houseTypes : [] };
  const criteria = searchCriteria(profile);
  if (change.target === undefined && change.maximum === null) return withCriteria(next, criteria.filter((item) => item.kind !== "budget"));
  const setting = change.target !== undefined || change.maximum !== undefined;
  if (change.target !== undefined) next = { ...next, ...budgetFromTarget(change.target, market) };
  else if (change.maximum !== undefined && change.maximum !== null) next = { ...next, ...budgetFromMaximum(change.maximum, market) };
  else if (change.market && change.market !== profile.market) return withCriteria(next, criteria.filter((item) => item.kind !== "budget"));
  const has = criteria.some((item) => item.kind === "budget");
  // A tool's price is a limit (CUJ06 board: "over budget hatched", V4-21e: a failed Must is hatched, never red): its
  // budget is a Must, the one it replaces too.
  if (change.target !== undefined && has) {
    return withCriteria(next, criteria.map((item) => (item.kind === "budget" ? { ...item, must: true } : item)));
  }
  return withCriteria(next, has || !setting ? criteria : [{ kind: "budget", must: true }, ...criteria]);
}

// ---- soft edges and "Soften" -------------------------------------------------------------------------------

/** A criterion's slider span in its own values (a range's London values, a place's minutes, Where's metres). */
export interface Span { low: number; high: number; step: number }

function roundTo(value: number, step: number): number {
  return step > 0 ? Math.round(value / step) * step : value;
}

/** A place's slider: 0 to 60 minutes, or twice the target when that is longer. */
export function placeSpan(targetMinutes: number): Span {
  return { low: 0, high: Math.max(PLACE_SPAN_MINUTES, targetMinutes * 2), step: 5 };
}

/** A place's soft edge in minutes: its own, else +50%. */
export function placeSoftMinutes(item: Extract<MatchCriterion, { kind: "place" }>): number {
  return item.softMinutes ?? Math.round(item.targetMinutes * SOFT_MINUTES_FACTOR);
}

/** Where's soft edge in metres (default 1 km; 100 m – 5 km). */
export const WHERE_SPAN: Span = { low: 0, high: 5000, step: 100 };

/**
 * One "Soften" step (board V4-21c): the soft edge goes out by a fifth of the criterion's span, never past it; a Must
 * first turns Must off. Null when there is nothing left to give (the edge is at the end of the span, or an own
 * criterion with no edge to move). The range itself never changes: "≤ 35 min" stays what the household said.
 */
export function softenStep(profile: PreferenceProfile, item: MatchCriterion, span: Span | null): { criterion: MatchCriterion; maximumBudget?: number } | null {
  if (item.must) {
    if (item.kind === "budget") return { criterion: { ...item, must: false } };
    return item.kind === "custom" ? null : { criterion: withSoftEdge({ ...item, must: false } as MatchCriterion, span) };
  }
  if (item.kind === "budget") {
    return { criterion: item, maximumBudget: Math.round((profile.maximumBudget + profile.targetBudget * BUDGET_SOFTEN_STEP) / 1000) * 1000 };
  }
  if (item.kind === "place") {
    const span2 = span ?? placeSpan(item.targetMinutes);
    const now = placeSoftMinutes(item);
    const next = Math.min(span2.high, roundTo(now + (span2.high - span2.low) * SOFTEN_STEP, span2.step));
    return next > now ? { criterion: { ...item, softMinutes: Math.min(240, next) } } : null;
  }
  if (item.kind === "where") {
    const now = item.softMetres ?? DEFAULT_SOFT_METRES;
    const next = Math.min(WHERE_SPAN.high, roundTo(now + (WHERE_SPAN.high - WHERE_SPAN.low) * SOFTEN_STEP, WHERE_SPAN.step));
    return next > now ? { criterion: { ...item, softMetres: next } } : null;
  }
  if (item.kind === "range") {
    const range = item.scale === "percentile" ? { low: 0, high: 100, step: 1 } : span;
    if (!range) return null;
    const reach = (range.high - range.low) * SOFTEN_STEP;
    let { softMin, softMax } = item;
    let moved = false;
    if (item.max !== null) {
      const now = softMax !== null && softMax > item.max ? softMax : item.max;
      const next = Math.min(range.high, roundTo(now + reach, range.step));
      if (next > now) { softMax = next; moved = true; }
    }
    if (item.min !== null) {
      const now = softMin !== null && softMin < item.min ? softMin : item.min;
      const next = Math.max(range.low, roundTo(now - reach, range.step));
      if (next < now) { softMin = next; moved = true; }
    }
    return moved ? { criterion: { ...item, softMin, softMax } } : null;
  }
  return null;
}

/** The profile after one Soften step on `id`, or null when that criterion has nothing left to give. */
export function softened(profile: PreferenceProfile, id: string, span: Span | null): PreferenceProfile | null {
  const item = searchCriteria(profile).find((entry) => criterionId(entry) === id);
  if (!item) return null;
  const step = softenStep(profile, item, span);
  if (!step) return null;
  const base = step.maximumBudget !== undefined ? { ...profile, maximumBudget: step.maximumBudget } : profile;
  if (item.must && !step.criterion.must) return setMust(base, id, false, span);
  return replaceCriterion(base, id, step.criterion);
}

// ---- counts from the pack ------------------------------------------------------------------------------

/** "612 of 4,994 areas left": areas with a score above 0 (no failed Must, no criterion beyond its soft edge). */
export function areasLeft(pack: MatchPack): { left: number; total: number } {
  return { left: pack.values.filter(isLeft).length, total: pack.values.length };
}

function isLeft(result: MatchResult): boolean {
  return !result.excluded && result.score !== null && (result.rankScore ?? result.score) > 0;
}

/** Fully inside every range (no soft edge in use): a full match, not a near miss. */
export function isFullMatch(result: MatchResult): boolean {
  return isLeft(result) && result.components.every((component) => (component.fit ?? 1) >= 1);
}

/**
 * "−2,850" per criterion: the areas it alone counts out of London, each criterion on its own (so they add up to
 * more than the areas gone): a Must the areas outside it (or with no evidence for it), any other criterion the areas
 * beyond its soft edge (a fit of 0).
 */
export function cutCounts(pack: MatchPack): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (id: string) => counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const result of pack.values) {
    const failed = new Set(result.unmetLimits.map((code) => code.slice(0, code.lastIndexOf(":"))));
    for (const id of failed) if (id !== "mark") add(id);
    for (const component of result.components) {
      if (!component.must && (component.fit ?? 1) <= 0 && !failed.has(component.factorId)) add(component.factorId);
    }
  }
  return counts;
}

/**
 * The client's own match from the pack's components (21d "re-score on the client from cached fits"): the criteria
 * the pack has evidence for, in the profile's order and Musts, scored by the same model as the API. A criterion the
 * pack has no rows for yet (just added) is left out until the API answers. Names and titles are kept.
 */
export function rescore(pack: MatchPack, profile: PreferenceProfile): MatchPack {
  const present = new Set(pack.values.flatMap((result) => result.components.map((component) => component.factorId as string)));
  const contract = contractProfile(profile);
  const criteria = contract.criteria.filter((item) => present.has(criterionId(item)));
  const scoring = { ...contract, criteria };
  const sources = new Map(specs(scoring).map((entry) => [entry.id, entry]));
  const rows: EvidenceRow[] = [];
  const zoneDistance = new Map<string, number>();
  for (const result of pack.values) {
    for (const component of result.components) {
      const entry = sources.get(component.factorId);
      if (!entry) continue;
      if (entry.kind === "where") { zoneDistance.set(result.geographyId, component.rawValue); continue; }
      rows.push({
        geographyId: result.geographyId, name: result.name, factorId: entry.source, rawValue: component.rawValue,
        percentile: component.percentile ?? null, unit: component.unit, carrierGeographyId: component.carrierGeographyId,
        quality: component.quality, sourceVersion: component.sourceVersion, ...(component.detail ? { detail: component.detail } : {}),
      });
    }
  }
  const scored = scorePack(scoring, rows, {
    areas: pack.values.map((result) => ({ geographyId: result.geographyId, name: result.name })),
    zoneDistance: zoneDistance.size ? zoneDistance : null, sourceReleaseSet: pack.sourceReleaseSet,
  });
  const before = new Map(pack.values.map((result) => [result.geographyId, result]));
  return {
    ...scored,
    // Whether Best value has areas to list stays the API's answer until the next one arrives.
    ...(pack.valueAreas !== undefined ? { valueAreas: pack.valueAreas } : {}),
    values: scored.values.map((result) => {
      const was = before.get(result.geographyId);
      return was ? { ...result, title: was.title, displayName: was.displayName, value: was.value, valueRank: was.valueRank } : result;
    }),
  };
}

/** What cuts most, for "X cuts most · Soften +N areas": the biggest −N among criteria with a soft edge left to give. */
export interface CutsMost { id: string; cut: number; gain: number; next: PreferenceProfile }

/**
 * The hint under the count (board V4-21c): with fewer than 300 areas or half of London's left, the criterion with the biggest −N that one
 * Soften step can still widen and bring areas back, and how many (+N, counted on the client). Null when enough areas
 * are left or no one step brings any area back.
 */
export function cutsMost(pack: MatchPack, profile: PreferenceProfile, spans: ReadonlyMap<string, Span>): CutsMost | null {
  const { left, total } = areasLeft(pack);
  if (!total || left >= Math.max(SOFTEN_HINT_UNTIL, total * SOFTEN_HINT_SHARE)) return null;
  const counts = cutCounts(pack);
  const candidates = [...counts].filter(([id, cut]) => cut > 0 && id !== "mark").sort((a, b) => b[1] - a[1]);
  for (const [id, cut] of candidates) {
    const next = softened(profile, id, spans.get(id) ?? null);
    if (!next) continue;
    const gain = areasLeft(rescore(pack, next)).left - left;
    // "Soften +0 areas" would be a tap that gives nothing: try the next criterion that cuts.
    if (gain > 0) return { id, cut, gain, next };
  }
  return null;
}

// ---- top and bottom 10 ----------------------------------------------------------------------------------

/** The ten scored areas the list shows (best first), and the ten least like the search (least first). */
export function topTen(pack: MatchPack): MatchResult[] {
  return pack.values.filter((result) => isLeft(result) && result.rank !== null)
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity)).slice(0, 10);
}

export function bottomTen(pack: MatchPack): MatchResult[] {
  const byId = new Map(pack.values.map((result) => [result.geographyId, result]));
  if (pack.bottom?.length) {
    return pack.bottom.flatMap((entry) => (byId.has(entry.geographyId) ? [byId.get(entry.geographyId)!] : [])).slice(0, 10);
  }
  return pack.values.filter((result) => !result.excluded && result.score !== null && result.rank !== null)
    .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0)).slice(0, 10);
}

/** ▲2 / ▼1 per area: how a reorder moved each of the new top ten (null: new to the ten or not moved). */
export function moves(before: readonly GeographyId[], after: readonly GeographyId[]): Map<GeographyId, number> {
  const out = new Map<GeographyId, number>();
  after.forEach((id, index) => {
    const was = before.indexOf(id);
    if (was >= 0 && was !== index) out.set(id, was - index);
  });
  return out;
}

// ---- Kids? Drive? -----------------------------------------------------------------------------------------

/** The two inline answers, kept with the search only to order the suggestions (lib/match-ranges suggestedChips). */
export function chipAnswers(profile: PreferenceProfile): ChipAnswers {
  return profile.suggest ?? {};
}

export { DEFAULT_EDGE, DEFAULT_SOFT };
