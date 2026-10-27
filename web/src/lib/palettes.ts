/**
 * Colour palettes for the choropleths, legends and sale pins. Every palette is
 * a real ramp on every layer, resampled to however many stops a legend has.
 * The standard and colour-blind palettes read a metric's polarity: on a layer
 * where high is good or bad they run from the good end to the bad one (prices:
 * cheap is good); on a neutral layer (income, a custom criterion) they use a
 * calm sequential ramp. The named palettes run low to high on every layer.
 */
import type { LegendStop } from "./contracts";
import { PRICE_METRIC_ID } from "./price-scale";
import { TYPICAL_PRICE_TYPES } from "./typical-price";

export interface Palette {
  id: string;
  label: string;
  /** Low to high: every layer, or only the neutral ones when `polar` is set. */
  colours: readonly string[];
  /** Good to bad, for layers with a polarity (oriented by `metricPolarity`). */
  polar?: readonly string[];
}

/** Whether a metric's high values are good, bad or neither. */
export type MetricPolarity = "good-high" | "good-low" | "neutral";

/**
 * Metrics with a better end; everything else (income, custom criteria, census layers) is neutral. Prices are
 * read as a buyer reads them: cheap is good, per m² and for the whole home of every type.
 */
export const METRIC_POLARITY: Readonly<Record<string, MetricPolarity>> = {
  [PRICE_METRIC_ID]: "good-low",
  ...Object.fromEntries(TYPICAL_PRICE_TYPES.map((type) => [type.id, "good-low" as const])),
  crime: "good-low",
  deprivation: "good-high", // decile 10 is the least deprived
  "station-access": "good-low",
  "food-hygiene": "good-high",
  noise: "good-low",
  "road-collisions": "good-low",
  "air-no2": "good-low",
  "mobile-4g-indoor": "good-high",
  "mobile-5g-outdoor": "good-high",
};

export function metricPolarity(metricId: string): MetricPolarity {
  return METRIC_POLARITY[metricId] ?? "neutral";
}

/** Green (good) through amber to red (bad): RdYlGn without its lime and pale middle. */
const TRAFFIC_LIGHT: readonly string[] = ["#1a9850", "#66bd63", "#fee08b", "#fdae61", "#f46d43", "#d73027"];
/**
 * Blue (good) to red (bad), safe under the common red-green deficiencies: ColorBrewer RdBu without its
 * near-white middle, so no class looks like the grey "no data".
 */
const BLUE_TO_RED: readonly string[] = ["#2166ac", "#4393c3", "#92c5de", "#f4a582", "#d6604d", "#b2182b"];
const YARN: readonly string[] = ["#eef5fb", "#cfe6f6", "#9fd0f0", "#5fb2e6", "#2b8fd6", "#1d6fb8"];

/**
 * A colour-blind-safe sequential ramp for neutral layers, low to high: ColorBrewer YlGnBu, the
 * 9-class ramp without its near-white first step. Lightness falls steadily from low to high, so the order
 * reads without a key and under the common colour-vision deficiencies; two hues, no rainbow.
 */
export const PRICE_RAMP: readonly string[] = [
  "#edf8b1", "#c7e9b4", "#7fcdbb", "#41b6c4", "#1d91c0", "#225ea8", "#253494", "#081d58",
];

/**
 * The Colours menu, default first. The default is colour-blind safe (blue good, red bad), not
 * the red-green traffic light, which stays as a choice under its old id ("current"): a visitor who picked
 * it keeps it (their choice is in storage or the link), everyone else gets the new default.
 */
export const PALETTES: readonly Palette[] = [
  { id: "colour-blind", label: "Colour-blind safe", colours: PRICE_RAMP, polar: BLUE_TO_RED },
  { id: "current", label: "Traffic light", colours: YARN, polar: TRAFFIC_LIGHT },
  { id: "viridis", label: "Viridis", colours: ["#440154", "#414487", "#2a788e", "#22a884", "#7ad151", "#fde725"] },
  { id: "magma", label: "Magma", colours: ["#fcfdbf", "#feb078", "#f1605d", "#b73779", "#721f81", "#2c115f"] },
  { id: "yarn", label: "Yarn (brand)", colours: YARN },
  { id: "ocean", label: "Ocean", colours: ["#eff6fb", "#c6dbef", "#9ecae1", "#6baed6", "#3182bd", "#08519c"] },
  { id: "ember", label: "Ember", colours: ["#ffffcc", "#fed976", "#feb24c", "#fd8d3c", "#e31a1c", "#800026"] },
];

export const DEFAULT_PALETTE = "colour-blind";

/** The colours a palette paints a metric with, low to high values. */
export function paletteRamp(palette: Palette, metricId: string): readonly string[] {
  const polarity = metricPolarity(metricId);
  if (!palette.polar || polarity === "neutral") return palette.colours;
  // Good to bad is low to high where low is good; reversed where high is good.
  return polarity === "good-low" ? palette.polar : [...palette.polar].reverse();
}

/** A layer's legend in the viewer's palette: values and labels unchanged. */
export function themedLegend(metricId: string, legend: readonly LegendStop[], palette: Palette): LegendStop[] {
  return recolourLegend(legend, paletteRamp(palette, metricId));
}

function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((part) => Math.round(part).toString(16).padStart(2, "0")).join("")}`;
}

/** The colour at position t (0..1) along a ramp, interpolated in RGB. */
export function rampAt(colours: readonly string[], t: number): string {
  if (colours.length === 1) return colours[0];
  const scaled = Math.min(1, Math.max(0, t)) * (colours.length - 1);
  const index = Math.min(colours.length - 2, Math.floor(scaled));
  const [a, b] = [hexToRgb(colours[index]), hexToRgb(colours[index + 1])];
  const f = scaled - index;
  return rgbToHex([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
}

/** `count` evenly spaced colours along a palette (low to high). */
export function sampleRamp(colours: readonly string[], count: number): string[] {
  return Array.from({ length: count }, (_, i) => rampAt(colours, count > 1 ? i / (count - 1) : 0));
}

/** A palette by id; the default for an unknown or missing one. */
export function paletteById(id: string | null | undefined): Palette {
  return PALETTES.find((palette) => palette.id === id) ?? PALETTES.find((palette) => palette.id === DEFAULT_PALETTE)!;
}

/**
 * Diverging ramp for the Change scale, falling → 0 → rising (ColorBrewer
 * PuOr: purple falls, orange rises; distinct for the common colour-vision
 * deficiencies). It is used whatever palette is chosen: the sequential
 * palettes cannot show a direction around zero.
 */
export const DIVERGING_RAMP: readonly string[] = ["#542788", "#998ec3", "#d8daeb", "#f7f7f7", "#fee0b6", "#f1a340", "#b35806"];
/** Fixed ±range in percent: bigger moves take the end colour. */
export const CHANGE_RANGE_PERCENT = 50;

function signedPercent(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}%` : rounded < 0 ? `−${Math.abs(rounded)}%` : "0%";
}

/** Legend stops spread evenly over −range…+range, with 0 at the neutral middle. */
export function divergingStops(range = CHANGE_RANGE_PERCENT): LegendStop[] {
  const last = DIVERGING_RAMP.length - 1;
  return DIVERGING_RAMP.map((colour, index) => {
    const value = Math.round((-range + (2 * range * index) / last) * 100) / 100;
    return { value, colour, label: signedPercent(value) };
  });
}

/** A fully transparent stop (My match's "not one of your matches"): left clear on the map and in the legend. */
export function isClearColour(colour: string): boolean {
  return /^rgba\(.*,\s*0\)$/.test(colour.replace(/\s+/g, " ").trim());
}

/** A legend with its colours taken from a ramp (low to high); values and labels unchanged. */
export function recolourLegend(legend: readonly LegendStop[], ramp: readonly string[]): LegendStop[] {
  // Clear stops stay clear; the ramp spreads over the painted ones.
  const clear = isClearColour;
  const colours = sampleRamp(ramp, legend.filter((stop) => !clear(stop.colour)).length);
  let next = 0;
  return legend.map((stop) => (clear(stop.colour) ? { ...stop } : { ...stop, colour: colours[next++] }));
}

/**
 * Lens ramps for custom criteria (the "Explore:" chips and "Build your own"): snow to the chip's own
 * yarn, five stops, lightness falling at least 8 L* per step so the order reads without colour. Yarns
 * too light to end a ramp (sky, tangerine, pink, sun) run on to a deeper shade of their own hue; none
 * passes through olive or mustard. Keyed by the --yarn-* name; the chip carries it (lib/explore-chips.ts).
 */
export const YARN_RAMPS = {
  cherry: ["#f4f7fa", "#f6cecb", "#f4a49b", "#ed796d", "#e2453c"],
  cobalt: ["#f4f7fa", "#bfd1f3", "#8cabeb", "#5c84e0", "#2f5bd3"],
  sky: ["#f4f7fa", "#b5d7f1", "#73b6e6", "#3d93d3", "#1d6fb8"],
  tangerine: ["#f4f7fa", "#f7c9aa", "#f49a52", "#da7024", "#b84a12"],
  pink: ["#f4f7fa", "#f6c1d4", "#f08cb0", "#d1618f", "#b0336e"],
  sun: ["#f4f7fa", "#f6da99", "#f3b940", "#e6972e", "#d9761c"],
} as const satisfies Record<string, readonly string[]>;
export type YarnName = keyof typeof YARN_RAMPS;

/** The API's sequential ramp for a criterion without a chip (custom_criteria.SEQUENTIAL; a test keeps them equal). */
export const CUSTOM_SEQUENTIAL: readonly string[] = YARN_RAMPS.cobalt;
/**
 * The API's pair ramp, B end … A end (custom_criteria.DIVERGING): blue to coral through a snow middle, the
 * same sides as the colour square (A red, B blue), so "more cafés" is one colour in both.
 */
export const CUSTOM_DIVERGING: readonly string[] = ["#2f5bd3", "#8cabeb", "#f4f7fa", "#f4a49b", "#e2453c"];

/** A yarn token ("var(--yarn-sun)") or name ("sun") → its lens ramp; the default ramp for anything else. */
export function yarnRamp(yarn: string | null | undefined): readonly string[] {
  const name = yarn?.match(/^(?:var\(--yarn-)?([a-z]+)\)?$/)?.[1];
  return name && name in YARN_RAMPS ? YARN_RAMPS[name as YarnName] : CUSTOM_SEQUENTIAL;
}

/**
 * A custom-criterion legend in a chip's yarn: each stop on the API's sequential ramp takes the same step
 * of `ramp` (so a reversed "nearest" legend stays reversed). A legend with any stop off that ramp (a pair's
 * blue-to-coral, which shares its blue end) is returned unchanged.
 */
export function yarnLegend(legend: readonly LegendStop[], ramp: readonly string[]): LegendStop[] {
  const steps = legend.map((stop) => CUSTOM_SEQUENTIAL.indexOf(stop.colour.toLowerCase()));
  if (ramp === CUSTOM_SEQUENTIAL || steps.some((step) => step < 0)) return legend.map((stop) => ({ ...stop }));
  return legend.map((stop, index) => ({ ...stop, colour: ramp[steps[index]] }));
}
