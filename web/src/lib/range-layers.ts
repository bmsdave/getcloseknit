/**
 * "+ Add criterion": every map layer that can be a range criterion, in the Layers menu's groups and
 * order (lib/map-topics.ts), with how its values read ("≤ 25 crimes / 1,000", "£7k", "10 min").
 *
 * Left out on purpose: the People group and every other Census layer (descriptive only), Wildlife seen (records
 * show where an animal was seen, not where it is absent: a range would read gaps as absence) and the household's
 * own criteria (they already have a direction and a weight in My criteria). Deprivation (owner
 * decision), household income and social renting (Social rent is a view of Census Tenure) are offered.
 */
import { isDescriptiveLayer, type MapLayerId, type RangeCriterion } from "./contracts";
import { formatCustomValue, type CustomCriterion } from "./custom-criteria";
import { CUSTOM_PRESETS, presetBySlug } from "./custom-presets";
import { MAP_TOPIC_GROUPS, type TopicGroupId } from "./map-topics";
import { formatMoney } from "./money-format";

export interface RangeLayer {
  /** A metric id, or `custom:<preset id>` for a ready-made criterion. */
  layer: string;
  /** The card's name ("Crime", "Typical home price · Terraced"). */
  label: string;
  /** The chip's name ("Crime", "Price/m²"). */
  short: string;
  group: TopicGroupId;
  groupLabel: string;
  /** The end a new range keeps: lower crime, cheaper, a shorter walk; more of a ready-made criterion unless it says less. */
  better: "lower" | "higher";
}

export interface RangeLayerGroup { id: TopicGroupId; label: string; items: RangeLayer[] }

const LEFT_OUT_GROUPS: readonly TopicGroupId[] = ["people", "my-criteria"];
const LEFT_OUT_ITEMS = ["wildlife-hedgehog"];
const HIGHER_IS_BETTER = ["food-hygiene", "nature-score", "deprivation", "good-schools-nearby", "good-schools-nearby-secondary", "broadband-gigabit"];
// No better end, but a new range has to keep one: the higher, as in "Higher household income", "More social renting".
const HIGHER_FIRST = ["income", "social-renting"];
const SHORT: Record<string, string> = { "price-per-square-metre": "Price/m²", "typical-price": "Home price", "station-access": "Station walk" };

function presetOf(layer: string): CustomCriterion | null {
  return layer.startsWith("custom:") ? presetBySlug(layer.slice("custom:".length))?.criterion ?? null : null;
}

/**
 * Criteria without a Layers-menu row (Layers v5: New stations are pins there, PR 2); the km figure stays a
 * criterion, at the end of its group, so find_areas and saved matches keep it.
 */
const EXTRA_RANGE_LAYERS: readonly Omit<RangeLayer, "groupLabel">[] = [
  { layer: "future-station-distance", label: "New stations", short: "New station", group: "getting-around", better: "lower" },
];

/** The groups and items "+ Add criterion" lists, in the Layers menu's order. */
export const RANGE_LAYER_GROUPS: readonly RangeLayerGroup[] = MAP_TOPIC_GROUPS
  .filter((group) => !LEFT_OUT_GROUPS.includes(group.id))
  .map((group) => ({
    id: group.id, label: group.label,
    items: [...group.items, ...EXTRA_RANGE_LAYERS.filter((extra) => extra.group === group.id).map((extra): typeof group.items[number] =>
      ({ id: extra.layer, group: extra.group, label: extra.label, kind: "metric", layer: extra.layer as MapLayerId, keywords: [] }))]
      .flatMap((item): RangeLayer[] => {
      if (!item.layer || item.kind === "custom" || LEFT_OUT_ITEMS.includes(item.id)) return [];
      // A view's subviews (Price per m² › Borough HPI › 5 yrs) are its layers, named after it.
      const layerViews = (item.views ?? [])
        .flatMap((view) => (view.subviews ? view.subviews.map((sub) => ({ ...sub, label: `${view.label} · ${sub.label}` })) : [view]))
        .filter((view) => view.layer);
      const entry = (layer: string, label: string): RangeLayer => {
        const extra = EXTRA_RANGE_LAYERS.find((candidate) => candidate.layer === layer);
        if (extra) return { ...extra, groupLabel: group.label };
        const preset = CUSTOM_PRESETS.find((candidate) => `custom:${candidate.criterion.id}` === layer);
        const better = preset ? preset.direction : [...HIGHER_IS_BETTER, ...HIGHER_FIRST].includes(layer) ? "higher" : "lower";
        return { layer, label, short: SHORT[layer] ?? label, group: group.id, groupLabel: group.label, better };
      };
      // A Census item is descriptive only; a view of it that is not (Tenure's Social rent) is offered alone.
      if (isDescriptiveLayer(item.layer)) {
        return layerViews.filter((view) => !isDescriptiveLayer(view.layer!))
          .map((view) => ({ ...entry(view.layer!, `${item.label} · ${view.label}`), short: view.label }));
      }
      if (!layerViews.length) return [entry(item.layer, item.label)];
      // The item's own layer first when no view carries it (Price per m², then its Borough HPI views); a layer
      // per type of home: "Typical price" for all homes, then one entry per type; Wealth › Income is "Income".
      const own = layerViews.some((view) => view.layer === item.layer) ? [] : [entry(item.layer, item.label)];
      return [...own, ...layerViews.map((view) => {
        const whole = view.layer === item.layer && view.label === "All";
        const short = SHORT[view.layer!] ?? (item.id === "typical-price" ? `${view.label} price` : whole ? item.label : view.label);
        return { ...entry(view.layer!, whole ? item.label : `${item.label} · ${view.label}`), short };
      })];
    }),
  }))
  .filter((group) => group.items.length > 0);

const BY_LAYER = new Map(RANGE_LAYER_GROUPS.flatMap((group) => group.items).map((item) => [item.layer, item]));

/** The criterion entry for a layer; null for one that can't be a criterion. */
export function rangeLayer(layer: string): RangeLayer | null {
  return BY_LAYER.get(layer) ?? null;
}

/** The groups with `first` (the layer on the map) offered at the top, as "Use Crime as a filter". */
export function rangeLayerMenu(first: string | null, taken: readonly string[]): { first: RangeLayer | null; groups: RangeLayerGroup[] } {
  const lead = first && !taken.includes(first) ? rangeLayer(first) : null;
  return {
    first: lead,
    groups: RANGE_LAYER_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => !taken.includes(item.layer)) }))
      .filter((group) => group.items.length > 0),
  };
}

/** One value as the slider and chips say it: "25", "£7k", "£650k", "10 min", "80%", "12 places". */
export function formatRangeValue(layer: string, value: number): string {
  const preset = presetOf(layer);
  if (preset) return formatCustomValue(value, preset.formula).replace(" min walk", " min").replace(" per 1,000 residents", " per 1,000");
  if (layer === "price-per-square-metre") return value >= 10_000 ? `£${Math.round(value / 1000)}k` : `£${Number((value / 1000).toFixed(1))}k`;
  if (layer.startsWith("typical-price") || layer.startsWith("typical-rent")) return formatMoney(value);
  if (layer === "station-access" || layer === "supermarket-walk" || layer === "gp-walk") return `${Math.round(value)} min`;
  if (layer === "income") return formatMoney(value);
  if (layer === "noise" || layer === "food-hygiene" || layer === "social-renting" || layer === "flood-risk" || layer === "broadband-gigabit") return `${Math.round(value)}%`;
  return Number.isInteger(value) || Math.abs(value) >= 100 ? Math.round(value).toLocaleString("en-GB") : value.toFixed(1);
}

/** A value with its short unit, for the map popup and the card's ends: "158 / 1,000", "1.2 km"; else formatRangeValue. */
export function formatRangeValueUnit(layer: string, value: number): string {
  return `${formatRangeValue(layer, value)}${rangeUnit(layer)}`;
}

/** The short unit a bare number needs ("/ 1,000" for crime): "" when formatRangeValue already says it (£, min, %). */
export function rangeUnit(layer: string): string {
  if (layer === "crime" || layer === "road-collisions" || layer === "pipeline-homes-per-1000") return " / 1,000";
  return layer === "future-station-distance" ? " km" : "";
}

/** What follows a value on the card: " crimes / 1,000", "/m²", " walk", " of homes ≥ 55 dB". */
function unitWords(layer: string): string {
  if (layer === "crime") return " crimes / 1,000";
  if (layer === "price-per-square-metre") return "/m²";
  if (layer === "station-access") return " walk";
  if (layer === "road-collisions") return " hurt / 1,000";
  if (layer === "noise") return " of homes ≥ 55 dB";
  if (layer === "food-hygiene") return " rated 4–5";
  if (layer === "nature-score") return " Nature rank";
  if (layer === "deprivation") return " decile";
  if (layer === "income") return " a year";
  if (layer === "social-renting") return " of households";
  if (layer === "pipeline-homes-per-1000") return " new homes / 1,000";
  if (layer === "future-station-distance") return " km to a new station";
  if (layer.startsWith("typical-rent")) return " a month";
  if (layer === "flood-risk") return " of homes at flood risk";
  if (layer.startsWith("good-schools-nearby")) return " good schools within 1.5 km";
  if (layer === "supermarket-walk") return " walk to a supermarket";
  if (layer === "gp-walk") return " walk to a GP";
  if (layer === "broadband-gigabit") return " of premises with gigabit";
  return "";
}

/** The card's line: "≤ 25 crimes / 1,000", "£3k–£7k/m² · soft to £8k", "≥ 80% rated 4–5 · soft from 60%". */
export function rangeLabel(criterion: RangeCriterion): string {
  const value = (number: number) => formatRangeValue(criterion.layer, number);
  const { min, max, softMin, softMax } = criterion;
  const core = min !== null && max !== null ? `${value(min)}–${value(max)}` : max !== null ? `≤ ${value(max)}` : `≥ ${value(min ?? 0)}`;
  const soft = [
    softMax !== null && max !== null && softMax > max ? `soft to ${value(softMax)}` : null,
    softMin !== null && min !== null && softMin < min ? `soft from ${value(softMin)}` : null,
  ].filter(Boolean);
  return [`${core}${unitWords(criterion.layer)}`, ...soft].join(" · ");
}

/** A folded card's chip: "Crime ≤ 25 · Must", "Price/m² ≤ £7k · ≈ £8k". */
export function rangeChipLabel(criterion: RangeCriterion, strict: boolean): string {
  const entry = rangeLayer(criterion.layer);
  const value = (number: number) => formatRangeValue(criterion.layer, number);
  const { min, max, softMin, softMax } = criterion;
  const core = min !== null && max !== null ? `${value(min)}–${value(max)}` : max !== null ? `≤ ${value(max)}` : `≥ ${value(min ?? 0)}`;
  const edge = strict ? "Must" : `≈ ${value(max !== null && softMax !== null && softMax > max ? softMax : softMin ?? min ?? 0)}`;
  return `${entry?.short ?? criterion.layer} ${core} · ${edge}`;
}

/** The slider's span over London's values: from the lowest to the 98th percentile (the tail sits in the last bin). */
export interface RangeDomain { low: number; high: number; step: number; tail: boolean }

export function rangeDomain(values: readonly number[]): RangeDomain {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return { low: 0, high: 100, step: 1, tail: false };
  const top = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))];
  const step = niceStep((top - sorted[0]) / 100 || 1);
  let low = Math.floor(sorted[0] / step) * step;
  const high = Math.max(low + step, Math.ceil(top / step) * step);
  // A count or a share that starts just above 0 reads from 0.
  if (low > 0 && low < (high - low) * 0.15) low = 0;
  return { low, high, step, tail: sorted[sorted.length - 1] > high };
}

function niceStep(raw: number): number {
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
}

/** A new criterion: the London middle as a strict edge on the better side (half of London stays). */
export function defaultRange(layer: string, values: readonly number[]): RangeCriterion {
  const domain = rangeDomain(values);
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  const middle = sorted.length ? sorted[Math.floor(sorted.length / 2)] : (domain.low + domain.high) / 2;
  const value = Math.round(middle / domain.step) * domain.step;
  const better = rangeLayer(layer)?.better ?? "lower";
  return better === "lower"
    ? { layer, min: null, max: value, softMin: null, softMax: null, importance: 3 }
    : { layer, min: value, max: null, softMin: null, softMax: null, importance: 3 };
}
