/**
 * My match as one map-first search: which areas the brief describes, what the selected area
 * gains and gives up against the household's criteria, the one-tap changes that tighten a
 * compromise, and the marks (liked / ruled out / notes). Pure: no React, no map.
 */
import type { AreaBrief, BriefDestination, BriefRequest, BudgetFit, BriefCriterion } from "./brief-model";
import type {
  FactorId, GeographyId, MatchComponent, MatchPack, MatchResult, PlaceCategory, PlacePreference, PlaceTarget, PreferenceProfile,
} from "./contracts";
import { formatFactorLabel } from "./evidence-format";
import { formatCustomValue, type CustomPreference } from "./custom-criteria";
import { quickFactorNote } from "./quick-criteria";
import { allPreferences, type AnyProfile, budgetTier, rankPack, RENT_MONTHLY_BUDGET_CEILING } from "./matching";
import type { MatchList } from "./match-map";
import { boundWords, specs } from "./match-model";
import { componentFit, fitState, isRangeFactor, rangeFactorId, type FitState } from "./match-ranges";
import { formatRangeValue, formatRangeValueUnit, rangeChipLabel, rangeLabel, rangeLayer } from "./range-layers";
import { percentileWord } from "./match-words";
import { rankPlace } from "./coverage-words";
import { describeZone } from "./zones";
import { propertyKind } from "./contracts";
import { sortByTopic, type TopicId } from "./topic-order";

export const MAX_BRIEF_AREAS = 12;
/** The results list's page: ten rows, and the map numbers only the page shown. */
export const RANKING_PAGE = 10;
const LSOA_RE = /^uk:lsoa:E\d{8}$/;

/**
 * The ten the list shows and the map pins (one source for both): Top 10 in the precise rank (rankPack, so ties
 * break as everywhere else), Bottom 10 the least like the search first. Areas that share a name ("New Addington North ·
 * CR0" five times) are one row and one pin: the best of them in Top 10, the worst in Bottom 10. `page` steps the top
 * list by ten.
 */
export function matchRows(pack: MatchPack | null, profile: AnyProfile | null, list: MatchList = "top", page = 0): MatchResult[] {
  if (!pack) return [];
  const ranked = profile ? rankPack(pack, profile) : pack;
  const scored = ranked.values.filter((result) => !result.excluded && result.score !== null);
  // By rank; a pack without ranks (a preview) by its precise score, then id.
  const precise = (result: MatchResult) => result.rankScore ?? result.score ?? 0;
  const byRank = (left: MatchResult, right: MatchResult) => ((left.rank ?? Infinity) - (right.rank ?? Infinity))
    || precise(right) - precise(left) || (left.geographyId < right.geographyId ? -1 : left.geographyId > right.geographyId ? 1 : 0);
  if (list === "bottom") {
    // The pack's own bottom list leads (the API's least first), then the rest of the scored areas from the last.
    const byId = new Map(ranked.values.map((result) => [result.geographyId, result]));
    const listed = (pack.bottom ?? []).flatMap((entry) => (byId.has(entry.geographyId) ? [byId.get(entry.geographyId)!] : []));
    return oneByName([...listed, ...[...scored].sort(byRank).reverse()]).slice(0, RANKING_PAGE);
  }
  const left = scored.filter((result) => (result.rankScore ?? result.score ?? 0) > 0).sort(byRank);
  return oneByName(left).slice(page * RANKING_PAGE, (page + 1) * RANKING_PAGE);
}

/** The first of each id and each friendly name, in order. */
function oneByName(results: MatchResult[]): MatchResult[] {
  const ids = new Set<string>();
  const names = new Set<string>();
  return results.filter((result) => {
    const name = friendlyName(result).toLowerCase();
    if (ids.has(result.geographyId) || names.has(name)) return false;
    ids.add(result.geographyId);
    names.add(name);
    return true;
  });
}

/** The selected area first, then the page of ten the list shows (matchRows), then liked areas: at most twelve LSOAs. */
export function briefAreasFor(pack: MatchPack | null, selected: GeographyId | null, liked: GeographyId[] = [], page = 0,
  profile: AnyProfile | null = null): GeographyId[] {
  const ranked = matchRows(pack, profile, "top", page).map((result) => result.geographyId);
  const ordered = [selected, ...ranked, ...liked].filter((id): id is GeographyId => !!id && LSOA_RE.test(id));
  return [...new Set(ordered)].slice(0, MAX_BRIEF_AREAS);
}

/** Bottom 10: the selected area, then the ten least like the search (the least first), for their pins. */
export function bottomBriefAreasFor(pack: MatchPack | null, selected: GeographyId | null, profile: AnyProfile | null = null): GeographyId[] {
  const ordered = [selected, ...matchRows(pack, profile, "bottom").map((result) => result.geographyId)]
    .filter((id): id is GeographyId => !!id && LSOA_RE.test(id));
  return [...new Set(ordered)].slice(0, MAX_BRIEF_AREAS);
}

/** What the brief needs from the profile: the budget, the home wanted and the places to reach. */
/**
 * An area's typical price against the budget, read the same way on pins, popups, cards and the chip: within
 * up to the comfortable end (targetBudget), a stretch up to the maximum the household typed, over beyond it.
 */
export function budgetFitFor(price: number | null | undefined, profile: Pick<PreferenceProfile, "targetBudget" | "maximumBudget">): BudgetFit {
  const maximum = profile.maximumBudget || profile.targetBudget;
  if (price === null || price === undefined || !Number.isFinite(price) || !maximum) return "unknown";
  const target = Math.min(profile.targetBudget || maximum, maximum);
  return price <= target ? "within" : price <= maximum ? "stretch" : "over";
}

/** My match's brief with every price read by budgetFitFor (the API reads only the maximum, so £646k was "within" a £600k chip). */
export function refitBrief(brief: AreaBrief, profile: Pick<PreferenceProfile, "targetBudget" | "maximumBudget">): AreaBrief {
  const refit = <T extends { estimatedPrice: number | null; budgetFit: BudgetFit }>(place: T): T =>
    ({ ...place, budgetFit: budgetFitFor(place.estimatedPrice, profile) });
  return { ...brief, areas: brief.areas.map(refit), ring: brief.ring.map(refit) };
}

export function briefRequestFor(profile: PreferenceProfile, areas: GeographyId[]): BriefRequest {
  return {
    areas, budget: [profile.targetBudget, profile.maximumBudget], market: profile.market,
    bedrooms: profile.bedrooms, propertyType: propertyKind(profile),
    criteria: criteriaFor(profile), destinations: destinationsFor(profile),
  };
}

export function criteriaFor(profile: PreferenceProfile): BriefCriterion[] {
  // The old wizard's weighted factors, or (v4 My match) the same topics as range criteria on their layers.
  const weighted = new Set<string>(profile.factors.filter((factor) => factor.weight > 0).map((factor) => factor.factorId));
  for (const range of profile.ranges ?? []) weighted.add(range.layer);
  if (profile.places?.some((place) => place.target.kind === "school" || place.target.kind === "school-filter")) weighted.add("schools");
  const criteria: BriefCriterion[] = ["price"];
  if (weighted.has("schools") || profile.school.shortlistUrns.length) criteria.push("schools");
  if (weighted.has("commute") || profile.places?.length || profile.commuteDestinations.length) criteria.push("commute");
  if (weighted.has("crime")) criteria.push("safety");
  if (weighted.has("station-access")) criteria.push("station");
  return criteria;
}

export function destinationsFor(profile: PreferenceProfile): BriefDestination[] {
  return (profile.places ?? []).flatMap((place) => place.target.kind === "point"
    ? [{ label: place.label, latitude: place.target.latitude, longitude: place.target.longitude }]
    : []);
}

// ---- gains and compromises ----------------------------------------------------------------

export type TradeoffKind = "gain" | "on-target" | "compromise";

export interface Tradeoff {
  /** The criterion: a factor id, `place:<id>`, or "budget". */
  id: string;
  label: string;
  kind: TradeoffKind;
  detail: string;
  /** Tightening is offered for compromises that are not already hard limits. */
  canKeepStrict: boolean;
  /** A compromise far off the ask (a place over 1.25x its time, a fit under 25, a price over budget). */
  miss?: boolean;
  /** For the card's bar: minutes against the limit (places) or the 0-100 fit (factors). */
  minutes?: number;
  limit?: number;
  utility?: number;
  /** Quick criteria: the figures behind the fit ("38% of homes at 55 dB or more: road ..."). */
  note?: string;
}

/** How a criterion reads on its card: fits, compromise, or doesn't fit. */
export type CriterionStatus = "fits" | "compromise" | "miss";

export function statusOf(tradeoff: Tradeoff): CriterionStatus {
  if (tradeoff.kind !== "compromise") return "fits";
  return tradeoff.miss ? "miss" : "compromise";
}

export interface Verdict { label: string; tone: "strong" | "good" | "weak" | "out"; summary: string }

/** Only the top tier of the ranking may read "Strong match", never an area ranked #1212. */
export const STRONG_MATCH_TOP = 10;

/** The name people use: the friendly title ("Lamorbey · DA15"), else the official name without its
 * code ("Bexley 022A" → "Bexley"). */
export function friendlyName(result: { title?: string | null; name: string }): string {
  if (result.title) return result.title;
  return result.name.replace(/\s+\d{3}[A-Z]$/, "") || result.name;
}

/** Every result named the way people say it: the friendly title, never the official code (map list,
 * Compare › Brief and a shared shortlist's /brief alike). */
export function namedPack(pack: MatchPack): MatchPack {
  return { ...pack, values: pack.values.map((result) => ({ ...result, name: friendlyName(result) })) };
}

/**
 * Ranked results that share a name ("Lamorbey · DA15" twice) are one place in the list and on the map:
 * every member takes the group's position, so the numbers run 1, 2, 3 without gaps. Expects a pack
 * ordered by rank (rankPack).
 */
export function groupRanks(pack: MatchPack): MatchPack {
  const positions = new Map<string, number>();
  const ordered = [...pack.values].sort((left, right) => (left.rank ?? Infinity) - (right.rank ?? Infinity));
  for (const result of ordered) {
    if (result.rank === null) continue;
    const key = friendlyName(result).toLowerCase();
    if (!positions.has(key)) positions.set(key, positions.size + 1);
  }
  return { ...pack, values: pack.values.map((result) => (result.rank === null ? result
    : { ...result, rank: positions.get(friendlyName(result).toLowerCase())! })) };
}

/** One line for the selected area: what fits, and where it gives way (misses named first). Pass the
 * area's rank: outside the top tier an area with nothing missing reads "Good match", not "Strong". An area a Must
 * puts out reads "Out", never "Good". */
export function verdictFor(tradeoffs: Tradeoff[], rank: number | null = null, excluded = false): Verdict {
  const misses = tradeoffs.filter((tradeoff) => statusOf(tradeoff) === "miss");
  const compromises = tradeoffs.filter((tradeoff) => statusOf(tradeoff) === "compromise");
  const fits = tradeoffs.filter((tradeoff) => statusOf(tradeoff) === "fits");
  const names = (items: Tradeoff[]) => listWords(items.map((item) => item.label));
  const parts = [];
  if (fits.length) parts.push(`${names(fits)} ${fits.length === 1 ? "fits" : "fit"}.`);
  if (misses.length) parts.push(`Doesn't fit: ${names(misses)}.`);
  if (compromises.length) parts.push(`Compromise on ${names(compromises)}.`);
  const summary = parts.join(" ") || "No criteria to compare yet.";
  // Out is filtered, not scored low: the neutral hatch, never red (red = scored low, hatch = filtered).
  if (excluded) return { label: "Out", tone: "out", summary };
  if (misses.length >= 2 || (misses.length && !fits.length)) return { label: `Weak, ${misses.length} ${misses.length === 1 ? "miss" : "misses"}`, tone: "weak", summary };
  const gaps = misses.length + compromises.length;
  if (gaps) return { label: `Good, ${gaps} ${misses.length ? (gaps === 1 ? "miss" : "gaps") : (gaps === 1 ? "compromise" : "compromises")}`, tone: "good", summary };
  if (rank !== null && rank > STRONG_MATCH_TOP) return { label: "Good match", tone: "good", summary };
  return { label: "Strong match", tone: "strong", summary };
}

function listWords(words: string[]): string {
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** The plain words the wizard's toggles use ("Safer streets", not "Crime"), for summaries and cards. */
const PLAIN_FACTOR: Record<string, string> = {
  crime: "Safer streets", "station-access": "Near a station", noise: "Quiet streets", "market-level": "Lower price per m²",
  disorder: "Less disorder", "epc-share": "Energy-efficient homes", "leasehold-share": "More freehold sales", schools: "Good schools",
  deprivation: "Less deprivation",
};

export function plainFactorLabel(factorId: string): string {
  return PLAIN_FACTOR[factorId] ?? formatFactorLabel(factorId);
}

export function placeFor(profile: PreferenceProfile, factorId: string): PlacePreference | undefined {
  return profile.places?.find((place) => `place:${place.id}` === factorId);
}

/**
 * The one table from a limit id to the words people read ("Any park ≤ 10 min", "Safer streets fit
 * ≥ 50", "Crime ≤ 25", "Your zones"); a raw id (place:any-park) never reaches the screen.
 */
export function limitName(profile: PreferenceProfile, id: string): string {
  if (id === "zone") return profile.zones?.length === 1 ? describeZone(profile.zones[0]) : "Your zones";
  if (id === "mark") return "Areas you ruled out";
  if (id === "affordability" || id === "budget") return "Within budget";
  if (isRangeFactor(id)) {
    const range = profile.ranges?.find((entry) => rangeFactorId(entry.layer) === id);
    return range ? rangeChipLabel(range, true).replace(/ · Must$/, "") : "A range";
  }
  const place = placeFor(profile, id);
  if (place) return `${place.label} ≤ ${place.targetMinutes} min`;
  if (id.startsWith("custom:")) return customFor(profile, id)?.criterion.label ?? "Your criterion";
  // A wizard factor's Must is its range on London's values with no soft edge: "lowest 50% of London".
  const spec = specs(profile).find((entry) => entry.id === id);
  return spec?.must ? `${plainFactorLabel(id)} · ${boundWords(spec)}` : plainFactorLabel(id);
}

/** Why an area was out, as a short muted tag: "crime 46", "park 12 min", "over budget", "no data". */
export function limitReason(profile: PreferenceProfile, result: MatchResult, code: string): string {
  const id = code.slice(0, code.lastIndexOf(":"));
  if (code.endsWith(":missing")) return "no data";
  if (id === "zone") return "outside your zones";
  if (id === "mark") return "you ruled it out";
  if (id === "affordability") return "over budget";
  const component = result.components.find((part) => part.factorId === id);
  if (isRangeFactor(id)) {
    const layer = id.slice("range:".length);
    const short = (rangeLayer(layer)?.short ?? layer).toLowerCase();
    return component ? `${short} ${formatRangeValue(layer, component.rawValue)}` : short;
  }
  const place = placeFor(profile, id);
  if (place) {
    const word = place.target.kind === "school" || place.target.kind === "school-filter" ? "school" : place.target.kind === "category" ? place.target.category.replace("_", " ") : place.label.toLowerCase();
    return component ? `${word} ${Math.round(component.rawValue)} min` : word;
  }
  const words = plainFactorLabel(id).toLowerCase();
  if (component?.layer) return `${words} ${formatRangeValue(component.layer, component.rawValue)}`;
  return component ? `${words} fit ${Math.round(component.utility)}` : words;
}

/** One criterion against one area, for the map popup: in range, on the soft edge (its fit), or out. */
export interface FitRow { id: string; name: string; value: string; state: FitState; note: string | null }

/**
 * "✓ Crime 12 / 1,000 · ≈ Price £7.4k/m² on the edge, 60% · ✗ Walk 14 min, over 10": every criterion the area
 * was matched on, in the household's words. Ranges by their fit; places by the time against the limit (a must
 * is out beyond it, else on the edge); the budget by the ballpark; the wizard's priorities by their fit (a must
 * below its minimum is out).
 */
export function fitRows(result: MatchResult, profile: PreferenceProfile, pack: MatchPack | null = null): FitRow[] {
  const rows: FitRow[] = [];
  // Only the criteria still in the search: a pack from before a criterion was removed never shows it.
  const asked = new Set(allPreferences(profile).map((preference) => preference.factorId));
  for (const component of result.components) {
    const id = component.factorId as string;
    if (!asked.has(id)) continue;
    const fit = componentFit(component);
    if (isRangeFactor(id)) {
      const layer = id.slice("range:".length);
      const range = profile.ranges?.find((entry) => entry.layer === layer);
      const state = fitState(fit);
      // A London-percentile range (a chip's "≤ median") reads its bound as the layer's value there, as its card does.
      const bound = (value: number) => (range?.scale === "percentile" ? percentileValue(pack, id, value) : value);
      const said = (value: number) => { const real = bound(value); return real === null ? percentileWord(value) : formatRangeValueUnit(layer, real); };
      const max = range?.max != null ? bound(range.max) : null;
      const beyond = range && state === "out"
        ? (range.max !== null && (max === null || component.rawValue > max) ? `over ${said(range.max)}` : range.min !== null ? `under ${said(range.min)}` : null)
        : null;
      rows.push({ id, name: rangeLayer(layer)?.label ?? layer, value: formatRangeValueUnit(layer, component.rawValue), state,
        note: state === "edge" ? `on the edge, ${Math.round(fit * 100)}%` : beyond });
      continue;
    }
    const place = placeFor(profile, id);
    if (place) {
      const minutes = Math.round(component.rawValue);
      const within = component.rawValue <= place.targetMinutes;
      rows.push({ id, name: place.label, value: `${minutes} min`, state: component.fitKind ?? (within ? "in" : place.must ? "out" : "edge"),
        note: within ? null : `over ${place.targetMinutes}` });
      continue;
    }
    if (id === "affordability") {
      // One reading of the budget everywhere: ✓ up to the comfortable end, ≈ on the edge up to the maximum, ✗ over it.
      const fit = budgetFitFor(component.rawValue, profile);
      rows.push({ id, name: profile.market === "rent" ? "Rent" : "Price", value: profile.market === "rent" ? monthlyPounds(component.rawValue) : pounds(component.rawValue),
        state: fit === "within" ? "in" : fit === "stretch" ? "edge" : "out", note: fit === "over" ? "over budget" : fit === "stretch" ? "on the edge" : null });
      continue;
    }
    const failed = result.unmetLimits.some((code) => code.startsWith(`${id}:`));
    const name = id.startsWith("custom:") ? criterionLabel(profile, id) : plainFactorLabel(id);
    // The real value with ✓ ≈ ✗ (a wizard factor is a range on its layer), never "fit 70".
    const state: FitState = failed ? "out" : component.fitKind ?? fitState(fit);
    const value = component.layer ? formatRangeValueUnit(component.layer, component.rawValue)
      : id.startsWith("custom:") ? formatCustomValue(component.rawValue, customFor(profile, id)?.criterion.formula ?? "count")
        : `${Math.round(component.rawValue * 10) / 10}${component.unit ? ` ${component.unit}` : ""}`;
    rows.push({ id, name, value, state, note: state === "edge" ? `on the edge, ${Math.round(fit * 100)}%` : null });
  }
  return rows;
}

/** The layer's value at a London percentile (0 lowest … 100 highest), from the pack's own values of the criterion; null without them. */
export function percentileValue(pack: MatchPack | null, factorId: string, percentile: number): number | null {
  const values = (pack?.values ?? []).flatMap((result) => result.components.filter((component) => component.factorId === factorId)
    .map((component) => component.rawValue)).filter(Number.isFinite).sort((a, b) => a - b);
  if (!values.length) return null;
  return values[Math.round((Math.min(100, Math.max(0, percentile)) / 100) * (values.length - 1))];
}

export function criterionLabel(profile: PreferenceProfile, id: string): string {
  if (id === "budget" || id === "affordability") return "Price";
  const place = placeFor(profile, id);
  if (id.startsWith("custom:")) return customFor(profile, id)?.criterion.label ?? id;
  return place ? place.label : formatFactorLabel(id);
}

/** A range criterion's topic, from its Layers group (the same as GROUP_TOPIC in map-topics.ts). */
const RANGE_TOPIC: Partial<Record<string, TopicId>> = {
  cost: "price", safety: "safety", "getting-around": "getting-around", "homes-area": "homes", nature: "environment",
  "food-drink": "local-places", "going-out": "local-places", "everyday-life": "local-places",
};

const FACTOR_TOPIC: Record<FactorId, TopicId> = {
  affordability: "price", "market-level": "price", "growth-outlook": "price",
  commute: "getting-around", "station-access": "getting-around",
  crime: "safety", disorder: "safety", schools: "schools", noise: "environment",
  deprivation: "homes", income: "homes", "social-renting": "homes", "epc-share": "homes", "leasehold-share": "homes",
};

/** A criterion's topic: places by what they are (a park is Environment, a gym Local places), own criteria last. */
export function tradeoffTopic(profile: PreferenceProfile, id: string): TopicId {
  if (id === "budget") return "price";
  if (id.startsWith("custom:")) return "my-criteria";
  if (isRangeFactor(id)) return RANGE_TOPIC[rangeLayer(id.slice("range:".length))?.group ?? "my-criteria"] ?? "my-criteria";
  if (id.startsWith("place:")) {
    const target = placeFor(profile, id)?.target;
    if (target?.kind === "school") return "schools";
    if (target?.kind === "category") return target.category === "park" ? "environment" : target.category === "step_free_station" ? "getting-around" : "local-places";
    return "getting-around";
  }
  return FACTOR_TOPIC[id as FactorId] ?? "my-criteria";
}

/**
 * Each weighted criterion of the selected area as a gain, on target, or a compromise, in the one
 * topic order (lib/topic-order.ts); within a topic, misses and compromises lead. Status is a tag.
 */
export function tradeoffsFor(
  result: MatchResult, profile: PreferenceProfile,
  price: { estimatedPrice: number | null; budgetFit: BudgetFit } | null,
): Tradeoff[] {
  const tradeoffs: Tradeoff[] = [];
  // Rent searches have a price too: the borough average rent (null when unpublished, e.g. studios).
  if (price && price.estimatedPrice !== null) tradeoffs.push(priceTradeoff(profile, price));
  for (const component of result.components) {
    if (component.weight <= 0 || component.factorId === "affordability") continue;
    tradeoffs.push(component.factorId.startsWith("place:")
      ? placeTradeoff(profile, component)
      : component.factorId.startsWith("custom:") ? customTradeoff(profile, component)
        : isRangeFactor(component.factorId) ? rangeTradeoff(profile, component)
          : factorTradeoff(profile, component));
  }
  const order: Record<TradeoffKind, number> = { compromise: 0, gain: 1, "on-target": 2 };
  tradeoffs.sort((left, right) => order[left.kind] - order[right.kind] || Number(!!right.miss) - Number(!!left.miss));
  return sortByTopic(tradeoffs, (tradeoff) => tradeoffTopic(profile, tradeoff.id));
}

function priceTradeoff(profile: PreferenceProfile, price: { estimatedPrice: number | null; budgetFit: BudgetFit }): Tradeoff {
  const estimate = price.estimatedPrice!;
  const over = Math.round((estimate / profile.maximumBudget - 1) * 100);
  const strictAlready = profile.factors.some((factor) => factor.factorId === "affordability" && factor.minimumUtility !== null);
  // Rent searches compare the borough's average monthly rent with a monthly budget.
  const money = profile.market === "rent" ? monthlyPounds : pounds;
  const label = profile.market === "rent" ? "Rent" : "Price";
  if (price.budgetFit === "stretch" || price.budgetFit === "over") {
    return { id: "budget", label, kind: "compromise", canKeepStrict: !strictAlready, miss: price.budgetFit === "over",
      detail: `Ballpark ${money(estimate)}, ${over}% over your ${money(profile.maximumBudget)}` };
  }
  const kind: TradeoffKind = estimate <= profile.targetBudget ? "gain" : "on-target";
  return { id: "budget", label, kind, canKeepStrict: false,
    detail: kind === "gain" ? `Ballpark ${money(estimate)}, well within your ${money(profile.maximumBudget)}`
      : `Ballpark ${money(estimate)}, within your ${money(profile.maximumBudget)}` };
}

function placeTradeoff(profile: PreferenceProfile, component: MatchComponent): Tradeoff {
  const place = placeFor(profile, component.factorId);
  const target = component.targetMinutes ?? place?.targetMinutes ?? 0;
  const minutes = Math.round(component.rawValue);
  const label = place?.label ?? component.factorId;
  const how = place?.mode === "cycle" ? "by bike" : place?.mode === "transit" ? "by transit" : place?.mode === "car" ? "by car" : "on foot";
  const measure = { minutes, limit: target };
  if (component.rawValue > target) {
    return { id: component.factorId, label, kind: "compromise", canKeepStrict: !place?.must, miss: component.rawValue > target * 1.25,
      detail: `${minutes} min ${how}, ${Math.max(1, minutes - target)} over your ${target}`, ...measure };
  }
  return { id: component.factorId, label, kind: component.rawValue <= target * 0.75 ? "gain" : "on-target", canKeepStrict: false,
    detail: `${minutes} min ${how} (you wanted ≤ ${target})`, ...measure };
}

function factorTradeoff(profile: PreferenceProfile, component: MatchComponent): Tradeoff {
  const utility = Math.round(component.utility);
  const preference = profile.factors.find((factor) => factor.factorId === component.factorId);
  const label = plainFactorLabel(component.factorId);
  const note = quickFactorNote(component);
  const extra = note ? { note } : {};
  if (utility < 50) {
    return { id: component.factorId, label, kind: "compromise", canKeepStrict: preference?.minimumUtility == null, miss: utility < 25,
      detail: `Fit ${utility}/100: below the middle of ${rankPlace()} for what you asked`, utility, ...extra };
  }
  return { id: component.factorId, label, kind: utility >= 80 ? "gain" : "on-target", canKeepStrict: false,
    detail: `Fit ${utility}/100${utility >= 80 ? `: among the best in ${rankPlace()} for what you asked` : ""}`, utility, ...extra };
}

/** A range reads as its value and where it sits: inside ("Crime 54, within ≤ 80"), or on the soft edge with its fit. */
function rangeTradeoff(profile: PreferenceProfile, component: MatchComponent): Tradeoff {
  const layer = component.factorId.slice("range:".length);
  const fit = componentFit(component);
  const label = rangeLayer(layer)?.label ?? layer;
  const range = profile.ranges?.find((entry) => entry.layer === layer);
  const value = formatRangeValue(layer, component.rawValue);
  const utility = Math.round(fit * 100);
  if (fit >= 1) {
    return { id: component.factorId, label, kind: "on-target", canKeepStrict: false, utility,
      detail: `${value}${range ? `, within ${rangeLabel(range).split(" · ")[0]}` : ""}` };
  }
  return { id: component.factorId, label, kind: "compromise", canKeepStrict: false, miss: fit < 0.25, utility,
    detail: `${value}, on the soft edge (${utility}% fit)` };
}

export function customFor(profile: PreferenceProfile, factorId: string): CustomPreference | undefined {
  return profile.custom?.find((entry) => `custom:${entry.criterion.id}` === factorId);
}

/** A custom criterion reads as its value ("+0.42", "12 places") and the fit for more or less of it. */
function customTradeoff(profile: PreferenceProfile, component: MatchComponent): Tradeoff {
  const entry = customFor(profile, component.factorId);
  const utility = Math.round(component.utility);
  const label = entry?.criterion.label ?? component.factorId;
  const value = entry ? formatCustomValue(component.rawValue, entry.criterion.formula) : String(component.rawValue);
  const wish = entry?.direction === "lower" ? "less of it" : "more of it";
  const kind: TradeoffKind = utility < 50 ? "compromise" : utility >= 80 ? "gain" : "on-target";
  return { id: component.factorId, label, kind, canKeepStrict: false, miss: utility < 25,
    detail: `${value} · fit ${utility}/100 for ${wish}`, utility };
}

/** Affordability utility is clamped at 0 for any price at or over the maximum, so "within budget"
 * is a minimum of 1, not 0. */
export const STRICT_BUDGET_UTILITY = 1;

/** "Keep strict": the compromise becomes a hard limit, so areas that fall short leave the ranking. */
export function keepStrict(profile: PreferenceProfile, id: string): PreferenceProfile {
  if (id === "budget") {
    const factors = profile.factors.some((factor) => factor.factorId === "affordability")
      ? profile.factors.map((factor) => factor.factorId === "affordability"
        ? { ...factor, minimumUtility: STRICT_BUDGET_UTILITY, weight: Math.max(factor.weight, 1) } : factor)
      : [...profile.factors, { factorId: "affordability" as FactorId, weight: 1, direction: "higher" as const, minimumUtility: STRICT_BUDGET_UTILITY, maximumUtility: null }];
    return { ...profile, factors };
  }
  if (id.startsWith("place:")) {
    return { ...profile, places: (profile.places ?? []).map((place) => `place:${place.id}` === id ? { ...place, must: true } : place) };
  }
  return { ...profile, factors: profile.factors.map((factor) => factor.factorId === id ? { ...factor, minimumUtility: 50 } : factor) };
}

/** "Fine without it": the criterion stays but stops steering the ranking (lowest weight, no hard limit). */
export function relaxCriterion(profile: PreferenceProfile, id: string): PreferenceProfile {
  if (id === "budget") {
    return { ...profile, factors: profile.factors.map((factor) => factor.factorId === "affordability"
      ? { ...factor, minimumUtility: null, weight: Math.min(factor.weight, 1) } : factor) };
  }
  if (id.startsWith("place:")) {
    return { ...profile, places: (profile.places ?? []).map((place) => `place:${place.id}` === id ? { ...place, must: false, weight: 1 } : place) };
  }
  if (id.startsWith("custom:")) {
    return { ...profile, custom: (profile.custom ?? []).map((entry) => `custom:${entry.criterion.id}` === id ? { ...entry, weight: 1 } : entry) };
  }
  // A range keeps its edges (they say what is out) and counts least.
  if (isRangeFactor(id)) {
    return { ...profile, ranges: (profile.ranges ?? []).map((range) => rangeFactorId(range.layer) === id ? { ...range, importance: 1 } : range) };
  }
  return { ...profile, factors: profile.factors.map((factor) => factor.factorId === id ? { ...factor, minimumUtility: null, weight: 1 } : factor) };
}

export interface Alternative {
  geographyId: GeographyId;
  name: string;
  score: number | null;
  /** What it costs elsewhere, e.g. "Gym 18 min (+9)", or null when nothing gets worse. */
  cost: string | null;
}

/** The best other ranked area that meets the criterion this one compromises on. */
export function alternativeFor(pack: MatchPack, selected: MatchResult, profile: PreferenceProfile, id: string,
  prices: Map<GeographyId, { estimatedPrice: number | null; budgetFit: BudgetFit }> = new Map()): Alternative | null {
  const candidates = pack.values
    .filter((result) => result.geographyId !== selected.geographyId && !result.excluded && result.rank !== null)
    .sort((left, right) => (left.rank ?? Infinity) - (right.rank ?? Infinity));
  const meets = (result: MatchResult) => {
    if (id === "budget") {
      const price = prices.get(result.geographyId);
      if (price) return price.budgetFit === "within";
      const affordability = result.components.find((component) => component.factorId === "affordability");
      return affordability ? affordability.rawValue <= profile.maximumBudget : false;
    }
    const component = result.components.find((part) => part.factorId === id);
    if (!component) return false;
    if (id.startsWith("place:")) return component.rawValue <= (component.targetMinutes ?? Infinity);
    return component.utility >= 50;
  };
  const found = candidates.find(meets);
  if (!found) return null;
  return { geographyId: found.geographyId, name: found.name, score: found.score, cost: biggestLoss(selected, found, profile, id) };
}

function biggestLoss(from: MatchResult, to: MatchResult, profile: PreferenceProfile, except: string): string | null {
  let worst: { text: string; loss: number } | null = null;
  for (const component of to.components) {
    if (component.factorId === except || component.weight <= 0) continue;
    const before = from.components.find((part) => part.factorId === component.factorId);
    if (!before) continue;
    const loss = (before.utility - component.utility) * component.weight;
    if (loss <= 0 || (worst && worst.loss >= loss)) continue;
    const text = component.factorId.startsWith("place:")
      ? `${criterionLabel(profile, component.factorId)} ${Math.round(component.rawValue)} min (+${Math.round(component.rawValue - before.rawValue)})`
      : `${criterionLabel(profile, component.factorId)} fit ${Math.round(component.utility)} (was ${Math.round(before.utility)})`;
    worst = { text, loss };
  }
  return worst?.text ?? null;
}

// ---- marks -------------------------------------------------------------------------------

export type MarkKind = "liked" | "excluded";

export function marksOf(profile: PreferenceProfile) {
  return profile.marks ?? { liked: [], excluded: [], notes: {} };
}

/** Toggles a mark; liking and ruling out are exclusive. */
export function toggleMark(profile: PreferenceProfile, id: GeographyId, kind: MarkKind): PreferenceProfile {
  const marks = marksOf(profile);
  const other: MarkKind = kind === "liked" ? "excluded" : "liked";
  const on = marks[kind].includes(id);
  return { ...profile, marks: {
    ...marks,
    [kind]: on ? marks[kind].filter((item) => item !== id) : [...marks[kind], id],
    [other]: marks[other].filter((item) => item !== id),
  } };
}

export function setNote(profile: PreferenceProfile, id: GeographyId, text: string): PreferenceProfile {
  const marks = marksOf(profile);
  const notes = { ...marks.notes };
  const trimmed = text.trim().slice(0, 280);
  if (trimmed) notes[id] = trimmed; else delete notes[id];
  return { ...profile, marks: { ...marks, notes } };
}

function monthlyPounds(value: number): string {
  return `£${Math.round(value).toLocaleString("en-GB")} a month`;
}

function pounds(value: number): string {
  return value >= 1_000_000 ? `£${(value / 1_000_000).toFixed(2).replace(/0$/, "").replace(/\.0$/, "")}m` : `£${Math.round(value / 1000)}k`;
}

// ---- the budget in the results ------------------------------------------------------------

export type BudgetGroupId = "within" | "unknown" | "stretch";

const BUDGET_GROUPS: { id: BudgetGroupId; title: string }[] = [
  { id: "within", title: "Within budget" }, { id: "unknown", title: "Price not known" }, { id: "stretch", title: "Stretch" },
];

/** Ranked results in the budget tiers the ranking already orders them by (budgetTier in matching.ts):
 * "Within budget", "Price not known", then "Stretch". Empty groups are left out. */
export function budgetGroups<T extends MatchResult>(ranked: T[], profile: PreferenceProfile): { id: BudgetGroupId; title: string; results: T[] }[] {
  return BUDGET_GROUPS.map((group, tier) => ({ ...group, results: ranked.filter((result) => budgetTier(result, profile) === tier) }))
    .filter((group) => group.results.length > 0);
}

/** "3 areas · 1 within budget"; without any price evidence, "3 areas meet your must-haves". */
export function budgetHeader(ranked: MatchResult[], profile: PreferenceProfile): string {
  const areas = `${ranked.length.toLocaleString("en-GB")} ${ranked.length === 1 ? "area" : "areas"}`;
  if (!ranked.some((result) => budgetTier(result, profile) !== 1)) return `${areas} ${ranked.length === 1 ? "meets" : "meet"} your must-haves`;
  const within = ranked.filter((result) => budgetTier(result, profile) === 0).length;
  return `${areas} · ${within.toLocaleString("en-GB")} within budget`;
}

/** "Over budget · ~£86k (14%)" for an area whose ballpark is above the maximum; null otherwise. */
export function overBudgetLabel(result: MatchResult, profile: PreferenceProfile): string | null {
  const price = result.components.find((component) => component.factorId === "affordability");
  if (!price || price.rawValue <= profile.maximumBudget) return null;
  const over = price.rawValue - profile.maximumBudget;
  const share = Math.max(1, Math.round((over / profile.maximumBudget) * 100));
  const money = profile.market === "rent" ? `£${Math.round(over).toLocaleString("en-GB")} a month` : pounds(over);
  return `Over budget · ~${money} (${share}%)`;
}

/** "Relax budget 10%": the maximum (and the comfortable target with it) 10% higher, on the same steps
 * the wizard rounds to; a monthly rent stays under the rent ceiling. */
export function relaxBudget(profile: PreferenceProfile, share = 0.1): PreferenceProfile {
  const step = profile.market === "rent" ? 10 : 1_000;
  const raise = (value: number) => Math.round((value * (1 + share)) / step) * step;
  const ceiling = profile.market === "rent" ? RENT_MONTHLY_BUDGET_CEILING : Infinity;
  const maximumBudget = Math.min(ceiling, raise(profile.maximumBudget));
  return { ...profile, maximumBudget, targetBudget: Math.min(maximumBudget, raise(profile.targetBudget)) };
}

// ---- my places -----------------------------------------------------------------------------

export const PLACE_KIND_LABEL: Record<string, string> = {
  park: "Any park", cafe: "Any café", supermarket: "Any supermarket", convenience: "Any corner shop",
  gp: "Any GP surgery", pharmacy: "Any pharmacy", pub: "Any pub or bar", restaurant: "Any restaurant",
  gym: "Any gym", pool: "A public pool", sports_club: "A sports club", step_free_station: "A step-free station",
};

/** Ready-made places for the "add a kind" menu: a kind, a brand, or a top-school rule. */
export interface PlacePreset { key: string; label: string; target: PlaceTarget; minutes: number; weight: number }

export const PLACE_PRESETS: PlacePreset[] = [
  ...(Object.keys(PLACE_KIND_LABEL) as PlaceCategory[]).map((category) => ({
    key: category, label: PLACE_KIND_LABEL[category], target: { kind: "category" as const, category }, minutes: 10, weight: 2 })),
  { key: "brand-ms", label: "An M&S", target: { kind: "category", category: "supermarket", brand: "M&S" }, minutes: 10, weight: 3 },
  { key: "brand-waitrose", label: "A large supermarket", target: { kind: "category", category: "supermarket", brand: "Waitrose" }, minutes: 10, weight: 3 },
  { key: "brand-lidl", label: "A Lidl or Aldi", target: { kind: "category", category: "supermarket", brand: "Lidl" }, minutes: 10, weight: 2 },
  { key: "school-secondary-10", label: "A top-10 secondary school", target: { kind: "school", phase: "secondary", top: 10 }, minutes: 20, weight: 4 },
  { key: "school-secondary-50", label: "A top-50 secondary school", target: { kind: "school", phase: "secondary", top: 50 }, minutes: 20, weight: 4 },
  { key: "school-primary-50", label: "A top-50 primary school", target: { kind: "school", phase: "primary", top: 50 }, minutes: 15, weight: 4 },
  { key: "school-secondary-p8-20", label: "A top-20 secondary by Progress 8", target: { kind: "school", phase: "secondary", top: 20, rankBy: "progress8" }, minutes: 20, weight: 4 },
];

/** A short id from the label, unique within the profile's places. */
export function newPlaceId(label: string, places: PlacePreference[]): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 18) || "place";
  let id = base;
  for (let n = 2; places.some((place) => place.id === id); n += 1) id = `${base}-${n}`;
  return id;
}

export function addPlace(profile: PreferenceProfile, draft: Omit<PlacePreference, "id">): PreferenceProfile {
  const places = profile.places ?? [];
  if (places.length >= 8) return profile;
  return { ...profile, places: [...places, { ...draft, id: newPlaceId(draft.label, places) }] };
}

export function updatePlace(profile: PreferenceProfile, id: string, change: Partial<Omit<PlacePreference, "id">>): PreferenceProfile {
  return { ...profile, places: (profile.places ?? []).map((place) => (place.id === id ? { ...place, ...change } : place)) };
}

export function removePlace(profile: PreferenceProfile, id: string): PreferenceProfile {
  const places = (profile.places ?? []).filter((place) => place.id !== id);
  return { ...profile, places: places.length ? places : undefined };
}

// ---- old /brief links ------------------------------------------------------------------------

const CRITERION_FACTORS: Partial<Record<BriefCriterion, { factorId: FactorId; weight: number; direction: "lower" | "higher" }>> = {
  safety: { factorId: "crime", weight: 4, direction: "lower" },
  station: { factorId: "station-access", weight: 3, direction: "lower" },
  schools: { factorId: "schools", weight: 3, direction: "higher" },
};

/** A /brief#brief= link (from an earlier agent answer) as a My match profile on top of `base`. */
export function briefToProfile(brief: BriefRequest, base: PreferenceProfile): PreferenceProfile {
  const factors = brief.criteria.flatMap((criterion) => {
    const factor = CRITERION_FACTORS[criterion];
    return factor ? [{ ...factor, minimumUtility: null, maximumUtility: null }] : [];
  });
  const [low, high] = brief.budget;
  const maximum = high ?? low ?? base.maximumBudget;
  const places: PlacePreference[] = brief.destinations.slice(0, 8).map((destination, index) => ({
    id: newPlaceId(destination.label, []) + (index ? `-${index + 1}` : ""), label: destination.label.slice(0, 60),
    target: { kind: "point", latitude: destination.latitude, longitude: destination.longitude },
    mode: "transit", targetMinutes: 30, weight: 4, must: false,
  }));
  // The price always counts, as in Find my area: without it the results can't be grouped by budget
  // ("Within budget", "Price not known", "Stretch") and an over-budget area could lead.
  const price = base.factors.filter((factor) => factor.factorId === "affordability")
    .map((factor) => ({ ...factor, weight: Math.max(factor.weight, 3) }));
  return {
    ...base, market: brief.market, bedrooms: brief.bedrooms, maximumBudget: maximum,
    targetBudget: Math.min(low ?? Math.round(maximum * 0.9), maximum),
    factors: factors.length ? [...price, ...factors] : base.factors.map((factor) => factor.factorId === "affordability" ? { ...factor, weight: Math.max(factor.weight, 3) } : factor),
    propertyType: brief.propertyType === "any" ? undefined : brief.propertyType,
    places: places.length ? places : undefined,
  };
}
