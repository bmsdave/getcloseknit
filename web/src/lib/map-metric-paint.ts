/**
 * A layer's legend as every map paints it: capped, recoloured with the viewer's palette, and price
 * on its fixed breaks (log steps between the published legend's ends until the breaks arrive).
 * The explorer (use-explorer-controller.ts) and the home page's mini map share this.
 */
import type { MapDefinition } from "./contracts";
import { isCustomLayerId } from "./custom-criteria";
import { cappedLegend } from "./legend-scale";
import { paletteRamp, themedLegend, type Palette } from "./palettes";
import { logBreaks, PRICE_METRIC_ID, priceStops, stopsRange, type PriceRange } from "./price-scale";

const FALLBACK_PRICE_RANGE: PriceRange = { low: 2_000, high: 15_000 };

export function paintedMetric<T extends MapDefinition>(base: T, palette: Palette, priceBreaks: number[] | null): T {
  // A colour square (custom "A vs B") encodes two counts at once: a one-way palette would scramble it.
  if (base.bivariate) return base;
  // My match keeps its own 7 RdBu bands whatever map colours are chosen.
  if (base.id === "personal-match") return base;
  // A comparison's ramp already ends at London's top 1% ("3+"): capping it again would paint one place
  // and thirty the same (Good coffee read "0 → 0.005+", every area with a single shop at the darkest).
  const legend = isCustomLayerId(base.id) ? base.legend : cappedLegend(base.legend);
  if (base.id !== PRICE_METRIC_ID) return { ...base, legend: themedLegend(base.id, legend, palette) };
  const breaks = priceBreaks ?? logBreaks(stopsRange(base.legend) ?? FALLBACK_PRICE_RANGE);
  return { ...base, legend: priceStops(breaks, paletteRamp(palette, PRICE_METRIC_ID)) };
}
