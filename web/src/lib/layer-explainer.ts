/**
 * The layer explainer behind the legend's "?" (components/layer-explainer.tsx): for the layer on the
 * map, its name, one plain line on what it measures, two to four short points on how it is counted
 * (each with its source and date), the guide article, and two marks on its scale: the London typical
 * figure and the area chosen. Everything comes from the layer's own definition, the painted values and
 * (Green & trees) the area's own nature figures; a point with no data is left out, never guessed.
 */
import type { GeographyId, MapDefinition, MapLayerId } from "./contracts";
import { describeCounted, describeFormula, describeTags, type CustomCriterion } from "./custom-criteria";
import { presetFor } from "./custom-presets";
import { formatOrdinal } from "./evidence-format";
import { metricGuidePath } from "./guide-routes";
import { mapPeriodLabel, mapValueText } from "./map-legend";
import { isWildlifeMetric } from "./nature-layers";
import { median } from "./price-scale";
import { isTypicalPriceLayer, TYPICAL_PRICE_TYPES } from "./typical-price";
import type { LegendScaleMode } from "./legend-scale";

/** The values the map paints (components/area-map.tsx), as the legend reads them: actual, rank or change. */
export interface PaintedValues {
  metricId: MapLayerId;
  scaleMode: LegendScaleMode;
  values: readonly { geographyId: GeographyId; value: number | null }[];
  /** The rank scale split the view's own values (lib/view-scale.ts): `values` are the measured values. */
  inView?: boolean;
  /** The reader's own range (lib/legend-range.ts) coloured them: `values` are the measured values. */
  custom?: boolean;
}

/**
 * The painted values, kept outside React state: the map hands them over on every timeline step, and
 * only an open explainer reads them (useSyncExternalStore), so playback re-renders nothing for them.
 */
export interface PaintedStore {
  get: () => PaintedValues | null;
  set: (next: PaintedValues) => void;
  subscribe: (listener: () => void) => () => void;
}

export function paintedStore(): PaintedStore {
  let current: PaintedValues | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (next) => {
      current = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export interface ExplainerPoint {
  text: string;
  /** Where it comes from and when ("HM Land Registry Price Paid · EPC floor areas"); empty when it is a note. */
  source: string;
  /** The chosen area's own figure for this point (Green & trees' three parts: "34th"); absent without one. */
  value?: string;
}

export interface LayerExplanation {
  name: string;
  line: string;
  points: ExplainerPoint[];
  guide: string;
}

/** The area's three Green & trees parts as London percentiles (GET /api/v1/areas/{id}/nature). */
export interface NatureParts {
  green: number | null;
  trees: number | null;
  site: number | null;
}

export const MAX_POINTS = 4;

/** "34th" for a London percentile; absent when unknown. */
function rank(value: number | null | undefined): string | undefined {
  return value === null || value === undefined ? undefined : formatOrdinal(Math.round(value));
}

/** The first sentence, and what is left. */
function sentences(text: string): [string, string] {
  const match = /^(.+?[.!?])(\s+|$)(.*)$/s.exec(text.trim());
  return match ? [match[1], match[3].trim()] : [text.trim(), ""];
}

function dated(source: string, when: string | null | undefined): string {
  return [source, when].filter((part) => part && part.trim()).join(" · ");
}

/** How to read a rank or change scale; nothing for measured values. */
export function scalePoint(scaleMode: LegendScaleMode | undefined, changeWindow: number | undefined, scope = "London",
  inView = false): ExplainerPoint | null {
  if (scaleMode === "percentile" && inView) {
    return {
      text: "Colours rank the areas in view from lowest to highest",
      source: "Each colour an equal share of the areas on screen; the steps move with the map",
    };
  }
  if (scaleMode === "percentile") {
    return { text: `Colours rank areas from lowest to highest in ${scope}`, source: "A rank, not the measured values" };
  }
  if (scaleMode === "change") {
    // The note under the scale already says orange rose, purple fell: the point adds the years and the arrows.
    const years = changeWindow ?? 5;
    return { text: `Price change over ${years} ${years === 1 ? "year" : "years"}`, source: "Zoom in close for arrows up and down" };
  }
  return null;
}

/**
 * What the "?" says for a layer. `name` is the selector's name for it ("Green & trees"); `period` the
 * month shown; `criterion` the household's or a ready-made criterion when that is what colours the map.
 */
export function explainLayer(metric: MapDefinition, input: {
  name: string;
  period: string;
  criterion?: CustomCriterion | null;
  nature?: NatureParts | null;
  /** The scale the legend draws: a rank or a change adds how to read it (no "?" in the Layers menu). */
  scaleMode?: LegendScaleMode;
  /** Years the change scale spans. */
  changeWindow?: number;
  /** What the view's ranks are in ("London", "North West", "its region"); absent = London. */
  rankScope?: string;
  /** The rank scale is the view's own (lib/view-scale.ts), not the region's. */
  inView?: boolean;
}): LayerExplanation {
  const { name, period } = input;
  const when = mapPeriodLabel(period);
  const guide = metricGuidePath(metric.id);
  const scale = scalePoint(input.scaleMode, input.changeWindow, input.rankScope, input.inView);
  const points = (list: (ExplainerPoint | null)[]) =>
    [...list, scale].filter((point): point is ExplainerPoint => !!point).slice(0, MAX_POINTS);
  if (input.criterion) {
    const criterion = input.criterion;
    return {
      name, guide: "/guide/your-match",
      line: presetFor(criterion)?.description ?? `${describeFormula(criterion)}.`,
      points: points([
        // The OpenStreetMap tags it counts live here, not in the side panel.
        { text: describeCounted(criterion), source: describeTags(criterion) },
        criterion.formula === "per_resident"
          ? { text: "Per 1,000 residents; the City of London is left out", source: "ONS Census 2021 population" }
          : null,
        { text: "Places on the map, never people", source: "OpenStreetMap contributors, ODbL" },
      ]),
    };
  }
  if (metric.id === "price-per-square-metre" || metric.id === "stock-value-per-square-metre") {
    return {
      name, guide, line: "What homes here sold for, per square metre of floor.",
      points: points([
        { text: "Sale price ÷ floor area of each home sold", source: "HM Land Registry Price Paid · EPC floor areas" },
        { text: "Middle of the last 12 months of sales", source: `Sales to ${when}` },
        { text: "An area figure, never a home's value", source: "" },
      ]),
    };
  }
  if (isTypicalPriceLayer(metric.id)) {
    const type = TYPICAL_PRICE_TYPES.find((entry) => entry.id === metric.id)!;
    return {
      name, guide, line: `The middle price of recent sales of ${type.words}, adjusted to today.`,
      points: points([
        { text: "Standard sales since 2023, each moved to today by the local price index", source: dated("HM Land Registry Price Paid · UK HPI", when) },
        { text: "Areas with few sales borrow from the area around them", source: "" },
        { text: "An area figure, never a home's value", source: "" },
      ]),
    };
  }
  if (metric.id === "crime") {
    return {
      name, guide, line: "Crimes police recorded here for every 1,000 people who live here.",
      points: points([
        { text: "Crimes recorded over 12 months", source: `police.uk, to ${when}` },
        { text: "Per 1,000 residents", source: "ONS population estimates" },
        { text: "Busy centres with few residents come out high", source: "Read with care near stations and high streets" },
      ]),
    };
  }
  if (metric.id === "nature-score") {
    const parts = input.nature ?? null;
    return {
      name, guide, line: "Green land, street trees and a nature site nearby, as one score.",
      points: points([
        { text: "Green land", source: "Sentinel-2 summer NDVI ≥ 0.4, 10 m grid", value: rank(parts?.green) },
        { text: "Street trees per hectare", source: "GLA public realm trees (council, TfL, Royal Parks)", value: rank(parts?.trees) },
        { text: "Nature site nearby", source: "Natural England: Local Nature Reserve, SSSI", value: rank(parts?.site) },
        { text: "Three equal parts, ranked across London", source: "No score if a part is missing" },
      ]),
    };
  }
  if (isWildlifeMetric(metric.id)) {
    return {
      name, guide, line: "Records come from people's sightings (GBIF), so there are more where more people look.",
      points: points([
        { text: "Birds, mammals and amphibians recorded within 1 km", source: dated("GBIF open-licence records, last five years", metric.freshness) },
        { text: "Seen, not absent: no record never means none here", source: "Under 200 records: too few to say (grey)" },
      ]),
    };
  }
  // Every other layer: its own definition, as published with the release.
  const [line, rest] = sentences(metric.description || metric.label);
  const source = dated(metric.provenance?.sourceName ?? "", metric.freshness || metric.provenance?.release);
  return {
    name, guide, line,
    points: points([
      rest ? { text: sentences(rest)[0], source } : source ? { text: metric.label, source } : null,
      ...metric.caveats.slice(0, 2).map((caveat) => ({ text: caveat, source: "" })),
    ]),
  };
}

/** One mark on the explainer's scale: its place (0..1) and its words. */
export interface ScaleMark {
  position: number;
  label: string;
}

/**
 * A value as the legend reads it: actual values in the layer's own words ("£7,600/m²", "95 crimes per
 * 1,000"), a rank as an ordinal, a change as a signed percentage.
 */
export function scaleValueText(value: number, metric: Pick<MapDefinition, "id" | "unit">, scaleMode: LegendScaleMode): string {
  if (scaleMode === "percentile") return formatOrdinal(Math.round(value));
  if (scaleMode === "change") return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(Math.round(value))}%`;
  return mapValueText(value, metric) ?? (Number.isInteger(value) ? String(value) : value.toFixed(1));
}

/**
 * The London typical mark (the middle of the painted values) and the chosen area's, placed on the
 * legend's own ramp by `position`. My match and a colour square have no such marks.
 */
export function scaleMarks(input: {
  metric: Pick<MapDefinition, "id" | "unit" | "bivariate">;
  scaleMode: LegendScaleMode;
  values: readonly (number | null)[];
  selected: { name: string; value: number | null } | null;
  position: (value: number) => number;
  /** Whose typical value it is: the view's region, England across regions (lib/map-coverage viewScopeWords). */
  scope?: string;
  /** The rank scale is the view's own (lib/view-scale.ts): values are measured, the typical one is the view's middle. */
  inView?: { median: number } | null;
}): { average: ScaleMark | null; area: ScaleMark | null } {
  if (input.metric.id === "personal-match" || input.metric.bivariate) return { average: null, area: null };
  const middle = input.inView ? input.inView.median : median(input.values);
  // The view's own scale paints measured values: they read as the layer's own words, not as a rank.
  const words = input.inView ? "linear" : input.scaleMode;
  const mark = (value: number, label: (text: string) => string): ScaleMark => ({
    position: Math.min(1, Math.max(0, input.position(value))), label: label(scaleValueText(value, input.metric, words)),
  });
  return {
    average: middle === null ? null : mark(middle, (text) => input.inView ? `Typical in view ${text}` : `${input.scope ?? "London"} typical ${text}`),
    area: input.selected && input.selected.value !== null ? mark(input.selected.value, (text) => `${input.selected!.name} · ${text}`) : null,
  };
}
