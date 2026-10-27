/**
 * My match in words: a criterion's name, its chip ("King's Cross ≤ 35′"), its card line
 * ("≤ 35 min · up to 50 min"), and why an area ranks where it does ("#1 King's Cross 22′ · #2 safer than 91%").
 * Terse and plain (DESIGN.md §8); values are the areas' own figures, never an estimate for one home.
 */
import type { MatchComponent, MatchCriterion, MatchResult, PreferenceProfile } from "./contracts";
import { coversEngland, rankPlace } from "./coverage-words";
import { criterionId, DEFAULT_SOFT_METRES } from "./match-model";
import { chipFor } from "./match-ranges";
import { placeSoftMinutes, type SearchItem } from "./match-search";
import { formatMoney } from "./money-format";
import { formatRangeValue, rangeLayer, rangeUnit } from "./range-layers";
import { describeZone } from "./zones";

/** Layers a chip names that are not map layers (schools, disorder): their card names. */
const LAYER_NAMES: Record<string, string> = { schools: "School score", disorder: "Antisocial behaviour", "road-collisions": "Road collisions" };

/** "Safer streets", "King's Cross", "Budget", "Where", or the layer's name for one picked under Any layer. */
export function itemName(item: MatchCriterion): string {
  if (item.kind === "budget") return "Budget";
  if (item.kind === "place") return item.label;
  if (item.kind === "where") return "Where";
  if (item.kind === "custom") return item.criterion.label;
  return chipFor(criterionId(item))?.label ?? rangeLayer(item.layer)?.label ?? LAYER_NAMES[item.layer] ?? item.layer;
}

/** What a range measures, for the card's head ("Safer streets · crime"). */
export function itemMeasure(item: MatchCriterion): string | null {
  if (item.kind === "place") return item.target.kind === "point" || item.target.kind === "any-of" ? "door to door" : null;
  return chipFor(criterionId(item))?.measure ?? null;
}

/**
 * The budget as one figure everywhere: "≤ £600k–£650k" (the comfortable end, then the most the household
 * typed, which a Must keeps as its limit), or "≤ £600k" with no stretch. Rent: "≤ £2,100–£2,300 a month".
 */
export function budgetRange(profile: Pick<PreferenceProfile, "market" | "targetBudget" | "maximumBudget">): string {
  const { market, targetBudget, maximumBudget } = profile;
  if (!(maximumBudget > targetBudget)) return `≤ ${budgetMoney(maximumBudget || targetBudget, market)}`;
  const low = market === "rent" ? `£${Math.round(targetBudget).toLocaleString("en-GB")}` : formatMoney(targetBudget);
  return `≤ ${low}–${budgetMoney(maximumBudget, market)}`;
}

/** "£600k" or "£2,300 a month". */
export function budgetMoney(value: number, market: PreferenceProfile["market"]): string {
  return market === "rent" ? `£${Math.round(value).toLocaleString("en-GB")} a month` : formatMoney(value);
}

/** "median", "25th pct", "lowest", "highest" for a London percentile bound. */
export function percentileWord(value: number): string {
  if (value <= 0) return "lowest";
  if (value >= 100) return "highest";
  if (Math.round(value) === 50) return coversEngland() ? "region median" : "London median";
  const whole = Math.round(value);
  const suffix = whole % 10 === 1 && whole !== 11 ? "st" : whole % 10 === 2 && whole !== 12 ? "nd" : whole % 10 === 3 && whole !== 13 ? "rd" : "th";
  return `${whole}${suffix} pct`;
}

/** A range bound in words: the layer's value when known (`value` maps a percentile to it), else the percentile. */
function rangeBound(item: Extract<MatchCriterion, { kind: "range" }>, bound: number, value?: (percentile: number) => number | null): string {
  if (item.scale !== "percentile") return formatRangeValue(item.layer, bound);
  const real = value?.(bound);
  return real !== null && real !== undefined ? formatRangeValue(item.layer, real) : percentileWord(bound);
}

/** The chip: "Budget ≤ £600k", "King's Cross ≤ 35′", "Safer streets ≤ median", "Where · 2 zones". */
export function itemChip(item: MatchCriterion, profile: PreferenceProfile): string {
  // Both ends, Must or not: the typed maximum is never hidden behind its comfortable end ("≤ £600k–£650k").
  if (item.kind === "budget") return `Budget ${budgetRange(profile)}`;
  if (item.kind === "place") {
    const soft = placeSoftMinutes(item);
    return item.must ? `${item.label} ≤ ${item.targetMinutes}′` : `${item.label} ≤ ${item.targetMinutes}–${soft}′`;
  }
  if (item.kind === "where") return item.zones.length === 1 ? `Where · ${describeZone(item.zones[0])}` : `Where · ${item.zones.length} zones`;
  if (item.kind === "custom") return item.criterion.label;
  const name = itemName(item);
  const short = (bound: number) => (item.scale === "percentile" ? (Math.round(bound) === 50 ? "median" : percentileWord(bound)) : formatRangeValue(item.layer, bound));
  if (item.min !== null && item.max !== null) return `${name} ${short(item.min)}–${short(item.max)}`;
  return item.max !== null ? `${name} ≤ ${short(item.max)}` : `${name} ≥ ${short(item.min ?? 0)}`;
}

/** The card's line: "≤ 35 min · up to 50 min", "Typical price here ≤ £600k · stretch to £650k", "≤ London median · up to 75th pct". */
export function itemLine(item: MatchCriterion, profile: PreferenceProfile, value?: (percentile: number) => number | null): string {
  if (item.kind === "budget") {
    const word = profile.market === "rent" ? "Typical rent here" : "Typical price here";
    // Must or not, the line reads as on the boards (V4-21c Budget card); a Must puts areas over the stretch out.
    const target = `${word} ≤ ${budgetMoney(profile.targetBudget, profile.market)}`;
    return profile.maximumBudget > profile.targetBudget ? `${target} · stretch to ${budgetMoney(profile.maximumBudget, profile.market)}` : target;
  }
  if (item.kind === "place") return item.must ? `≤ ${item.targetMinutes} min` : `≤ ${item.targetMinutes} min · up to ${placeSoftMinutes(item)} min`;
  if (item.kind === "where") {
    const soft = item.softMetres ?? DEFAULT_SOFT_METRES;
    return item.must ? "Only areas inside these" : `Inside these · lower the further out, to ${soft >= 1000 ? `${soft / 1000} km` : `${soft} m`}`;
  }
  if (item.kind === "custom") return item.direction === "higher" ? `More of it: the upper half of ${rankPlace()}` : `Less of it: the lower half of ${rankPlace()}`;
  const bound = (number: number) => rangeBound(item, number, value);
  // Real values carry their unit once ("≤ 65.4 / 1,000 · up to 100"); London words ("≤ London median") need none.
  const real = item.scale !== "percentile" || value?.(item.max ?? item.min ?? 50) != null;
  const range = item.min !== null && item.max !== null ? `${bound(item.min)}–${bound(item.max)}` : item.max !== null ? `≤ ${bound(item.max)}` : `≥ ${bound(item.min ?? 0)}`;
  const core = `${range}${real ? rangeUnit(item.layer) : ""}`;
  if (item.must) return core;
  const soft = [
    item.max !== null && item.softMax !== null && item.softMax > item.max ? `up to ${bound(item.softMax)}` : null,
    item.min !== null && item.softMin !== null && item.softMin < item.min ? `down to ${bound(item.softMin)}` : null,
  ].filter(Boolean);
  return [core, ...soft].join(" · ");
}

/** What one Soften step did, for the toast: "King's Cross now up to 60 min". */
export function softenedWords(before: MatchCriterion, after: MatchCriterion, profile: PreferenceProfile, afterProfile: PreferenceProfile): string {
  if (before.must && !after.must) return `${itemName(after)}: Must off, soft edge on`;
  if (after.kind === "budget") return `Budget now stretches to ${budgetMoney(afterProfile.maximumBudget, profile.market)}`;
  if (after.kind === "place") return `${after.label} now up to ${placeSoftMinutes(after)} min`;
  if (after.kind === "where") return `Where now reaches ${((after.softMetres ?? DEFAULT_SOFT_METRES) / 1000).toFixed(1).replace(/\.0$/, "")} km out`;
  return `${itemName(after)} now ${itemLine(after, afterProfile).split(" · ").slice(1).join(" · ") || "softer"}`;
}

/** One criterion's value for an area, short: "King's Cross 22′", "safer than 91%", "typical £615k", "crime 46". */
export function valueWords(item: MatchCriterion, component: MatchComponent, profile: PreferenceProfile): string {
  if (item.kind === "place") return `${item.label} ${Math.round(component.rawValue)}′`;
  if (item.kind === "budget") return profile.market === "rent" ? `rent ${budgetMoney(component.rawValue, "rent")}` : `typical ${formatMoney(component.rawValue)}`;
  if (item.kind === "where") return component.rawValue <= 0 ? "in your Where" : `${(component.rawValue / 1000).toFixed(1)} km outside Where`;
  if (item.kind === "custom") return item.criterion.label;
  const chip = chipFor(criterionId(item));
  if (chip?.why && component.percentile !== undefined) return chip.why(component.percentile);
  return `${(rangeLayer(item.layer)?.short ?? itemName(item)).toLowerCase()} ${formatRangeValue(item.layer, component.rawValue)}`;
}

/** ✓ in range, ≈ on the soft edge, ✗ out (or a failed Must). */
export type Mark = "in" | "edge" | "out";

export interface WhyPart { id: string; mark: Mark; text: string }

function markOf(component: MatchComponent | undefined, failed: boolean): Mark {
  if (failed || !component) return "out";
  const fit = component.fit ?? 1;
  return fit >= 1 ? "in" : fit > 0 ? "edge" : "out";
}

/**
 * The top-10 row's "why" (21d): its two strongest criteria in the household's priority order ("#1 King's Cross 22′ ·
 * #2 safer than 91%"); a near miss names what is off instead ("≈ #1 King's Cross 41′").
 */
export function whyParts(result: MatchResult, items: readonly SearchItem[], profile: PreferenceProfile, tied = false): WhyPart[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const components = new Map(result.components.map((component) => [component.factorId as string, component]));
  const label = (item: SearchItem, component: MatchComponent) => `${item.rank ? `#${item.rank} ` : ""}${valueWords(item.criterion, component, profile)}`;
  const edges = items.filter((item) => !item.must && components.has(item.id) && markOf(components.get(item.id), false) === "edge");
  if (edges.length) {
    return edges.slice(0, 2).map((item) => ({ id: item.id, mark: "edge", text: label(item, components.get(item.id)!) }));
  }
  // A row tied on score says the values that order it: #1's, then #2's, as the tie breaks.
  const breakers = tied ? tieBreakers(items).filter((item) => components.has(item.id)).slice(0, 2) : [];
  if (breakers.length) return breakers.map((item) => ({ id: item.id, mark: "in", text: label(item, components.get(item.id)!) }));
  const reasons = (result.reasons ?? []).filter((id) => byId.has(id) && components.has(id))
    .sort((a, b) => (byId.get(a)!.rank ?? 99) - (byId.get(b)!.rank ?? 99));
  return reasons.slice(0, 2).map((id) => ({ id, mark: "in", text: label(byId.get(id)!, components.get(id)!) }));
}

/**
 * What breaks an equal score, as the API's tie key does (match_model._tie_key): the ranked criteria in priority order
 * (#1's value, then #2's, V4-21d step 4), then the Musts (a budget-only search: the typical price, lowest first).
 */
export function tieBreakers(items: readonly SearchItem[]): SearchItem[] {
  const ranked = items.filter((item) => !item.must && item.rank !== null).sort((a, b) => a.rank! - b.rank!);
  return [...ranked, ...items.filter((item) => item.must && item.criterion.kind !== "where")];
}

/**
 * The note over a top 10 whose scores tie: every area inside every range scores 100, so the score alone does
 * not order them. "Tied at 100 · ordered by #1 King's Cross, then #2 Safer streets"; null when no two scores tie.
 */
export function tieNote(scores: readonly (number | null)[], items: readonly SearchItem[]): string | null {
  const counts = new Map<number, number>();
  for (const score of scores) if (score !== null) counts.set(score, (counts.get(score) ?? 0) + 1);
  const tied = [...counts].filter(([, count]) => count > 1).map(([score]) => score).sort((a, b) => b - a);
  const order = tieBreakers(items).slice(0, 2).map((item) => `${item.rank ? `#${item.rank} ` : ""}${itemName(item.criterion)}`);
  if (!tied.length || !order.length) return null;
  return `Tied at ${tied.slice(0, 2).join(" and ")} · ordered by ${order.join(", then ")}`;
}

/** A bottom-10 row: the criteria that sink it, in priority order, each with ✗ or ≈ (21e). */
export function sinkParts(result: MatchResult, items: readonly SearchItem[], profile: PreferenceProfile): WhyPart[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const components = new Map(result.components.map((component) => [component.factorId as string, component]));
  const failed = new Set(result.unmetLimits.map((code) => code.slice(0, code.lastIndexOf(":"))));
  const ids = (result.weakest ?? []).filter((id) => byId.has(id))
    .sort((a, b) => (byId.get(a)!.rank ?? 0) - (byId.get(b)!.rank ?? 0));
  return ids.slice(0, 2).map((id) => {
    const item = byId.get(id)!;
    const component = components.get(id);
    const mark = markOf(component, failed.has(id));
    const text = component ? `${item.rank ? `#${item.rank} ` : ""}${valueWords(item.criterion, component, profile)}` : `no ${itemName(item.criterion).toLowerCase()} data`;
    return { id, mark, text };
  });
}

/** "−2,850", or null for none. */
export function cutText(count: number | undefined): string | null {
  return count ? `−${count.toLocaleString("en-GB")}` : null;
}

/** "24%": a ranked criterion's weight in the score. */
export function weightText(weight: number): string {
  const percent = weight * 100;
  return percent >= 1 ? `${Math.round(percent)}%` : `${percent.toFixed(1)}%`;
}
