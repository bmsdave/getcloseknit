/**
 * The area map's colour scale: a pack's values reduced to what the fill paints (crime filter, ranks, change, the
 * reader's own range), and the rank scale taken from the areas in view (lib/view-scale.ts, lib/legend-range.ts).
 */
import type { ValuePack, MapDefinition } from "@/lib/contracts";
import type { AreaBoxes } from "@/lib/area-boxes";
import { crimeCategories } from "@/lib/crime-filter";
import { AUTO_SCALE, legendScaleDragging, legendScaleFor, legendScaleKey, rangePosition, setViewValues } from "@/lib/legend-range";
import { displayMapValue, effectiveScaleMode, percentileStops, rescaledStops, type LegendScaleMode } from "@/lib/legend-scale";
import { intersects, viewScopeFromAreas, viewScopeIsEngland, type Bbox } from "@/lib/map-coverage";
import type { DataMode } from "@/lib/map-state";
import { changeValues } from "@/lib/map-trend";
import { setViewCoverage, viewCoverage } from "@/lib/no-data";
import { divergingStops } from "@/lib/palettes";
import { median, PRICE_METRIC_ID } from "@/lib/price-scale";
import { needsRescale, setViewScale, viewBreaks, viewPosition, type ScaleAnchor } from "@/lib/view-scale";

import { motionDuration } from "./camera";
import type { MapController } from "./controller";
import { areaBoxes, coverageOf, mapBbox } from "./data";
import { areaFills, paintView } from "./paint";
import type { AnalyticsView, AreaMapProps, LastPaint } from "./types";

/** A rescale eases the colours over this long (at once with reduced motion): no jump, no flicker. */
const RESCALE_MORPH_MS = 300;

/** The measured values of the areas whose boxes reach into `bounds`; areas with no value are left out. */
export function valuesInView(values: ValuePack["values"], bounds: Bbox, boxes: ReadonlyMap<string, Bbox>): number[] {
  const found: number[] = [];
  for (const entry of values) {
    if (entry.value === null || !Number.isFinite(entry.value)) continue;
    const box = boxes.get(entry.geographyId);
    if (box && intersects(box, bounds)) found.push(entry.value);
  }
  return found;
}

/**
 * What the view's ranks are in (lib/map-coverage viewScopeFromAreas): London on the London map, else the one region
 * whose painted areas the view shows, or null across regions (coloured by rank in England).
 */
export function mapViewScope(controller: MapController, mode: DataMode, data: AreaBoxes | null = controller.paintedBoxes): string | null {
  if (mode === "demo") return "London";
  return viewScopeFromAreas(coverageOf(controller), mapBbox(controller.map), data ?? []);
}

/** The bounds the rank scale reads: the view now when it moved far enough from the anchor's, else the anchor's. */
export function scaleBounds(controller: MapController, level: string): Bbox {
  const { map } = controller;
  const next: ScaleAnchor = { zoom: map.getZoom(), bounds: mapBbox(map), level };
  const anchor = controller.scaleAnchor;
  if (anchor && !needsRescale(anchor, next)) return anchor.bounds;
  controller.scaleAnchor = next;
  return next.bounds;
}

/** Whether the reader can set the layer's scale, the store's key and the scale set (lib/legend-range.ts). */
export function ownScale(props: Pick<AreaMapProps, "metric" | "matchPack">, scaleMode: LegendScaleMode) {
  const key = legendScaleKey(props.metric.id, scaleMode);
  const adjustable = !props.matchPack && !props.metric.bivariate && props.metric.id !== "personal-match";
  return { key, adjustable, scale: adjustable ? legendScaleFor(key) : AUTO_SCALE };
}

/** The colours of the layer's ramp on a scale, low to high (only their order is used). */
function rampStops(metric: MapDefinition, scaleMode: LegendScaleMode): readonly { value: number; colour: string }[] {
  return scaleMode === "change" ? divergingStops() : metric.legend;
}

/** The measured values a scale reads: the change for the change scale, the filtered rate under a crime filter. */
export function measuredValues(pack: ValuePack, props: Pick<AreaMapProps, "metric">, base: ValuePack | null, scaleMode: LegendScaleMode,
  included: readonly string[], filterActive: boolean): ValuePack["values"] {
  if (scaleMode === "change") return changeValues(pack.values, base?.values ?? null);
  if (!filterActive) return pack.values;
  return pack.values.map((entry) => ({ ...entry, value: displayMapValue(entry, props.metric.id, "linear", included, filterActive) }));
}

/** `base` is the pack for period − window; only the change scale uses it. `inView` places the rank scale's view. */
export function resolveAnalyticsView(pack: ValuePack, props: AreaMapProps, base: ValuePack | null,
  inView?: { bounds: Bbox; boxes: ReadonlyMap<string, Bbox>; now?: Bbox }): AnalyticsView {
  const isCrime = props.metric.id === "crime";
  const categories = isCrime ? crimeCategories(pack.values) : [];
  const included = categories.filter((category) => !props.excludedCrime.includes(category));
  const filterActive = isCrime && props.excludedCrime.length > 0;
  // A colour square paints cell numbers: percentile and change scales do not apply.
  const scaleMode = props.metric.bivariate ? "linear" : effectiveScaleMode(props.metric.id, props.scaleMode, filterActive);
  const regionMedian = props.metric.id === PRICE_METRIC_ID || isCrime ? median(pack.values.map((entry) => entry.value)) : null;
  // The reader's own scale (lib/legend-range.ts): a range of measured values, or which areas the rank splits.
  const own = ownScale(props, scaleMode);
  const measured = own.adjustable || scaleMode === "change" ? measuredValues(pack, props, base, scaleMode, included, filterActive) : null;
  if (inView && measured && own.adjustable) setViewValues(own.key, valuesInView(measured, inView.now ?? inView.bounds, inView.boxes));
  if (own.scale.range && measured) {
    // Equal steps between the two values: each painted value is its place on the range, the ramp spread evenly over it.
    const range = own.scale.range;
    const values = measured.map((entry) => ({
      ...entry, value: entry.value === null || !Number.isFinite(entry.value) ? null : rangePosition(entry.value, range),
    }));
    if (inView) setViewScale(null);
    return {
      pack: { ...pack, values }, metric: props.metric, selected: props.selected, scaleMode, rescale: null, median: regionMedian,
      raw: measured, custom: percentileStops(rampStops(props.metric, scaleMode)).map((stop) => ({ ...stop, label: "" })),
    };
  }
  if (scaleMode === "change") {
    const values = measured ?? changeValues(pack.values, base?.values ?? null);
    return { pack: { ...pack, values }, metric: props.metric, selected: props.selected, scaleMode, rescale: null, median: regionMedian };
  }
  // The rank scale is the view's own (lib/view-scale.ts): the values of the areas in view split into equal shares,
  // one scale for everything on screen. A colour square, My match, or too few valued areas keep the published ranks;
  // so do the region's or England's ranks when the reader chose them.
  const breaks = scaleMode === "percentile" && inView && !props.matchPack && !props.metric.bivariate && own.scale.scope === "view"
    ? viewBreaks(valuesInView(pack.values, inView.bounds, inView.boxes), Math.max(2, props.metric.legend.length))
    : null;
  if (inView) setViewScale(breaks ? { metricId: props.metric.id, breaks } : null);
  if (breaks) {
    const values = pack.values.map((entry) => ({
      ...entry, value: entry.value === null || !Number.isFinite(entry.value) ? null : viewPosition(entry.value, breaks),
    }));
    return {
      pack: { ...pack, values }, metric: props.metric, selected: props.selected, scaleMode, rescale: null, median: regionMedian,
      viewBreaks: breaks, raw: pack.values,
    };
  }
  // Too few areas in view: a view across regions colours by rank in England, one scale on both sides of every border
  // (a pack from an older API without England's ranks keeps each region's).
  const englandRanks = own.scale.scope === "england" || (own.scale.scope === "view" && viewScopeIsEngland());
  const england = scaleMode === "percentile" && !props.matchPack && !props.clientPack && englandRanks
    && pack.values.some((entry) => entry.countryPercentile !== null && entry.countryPercentile !== undefined);
  const values = pack.values.map((entry) => ({
    ...entry, value: displayMapValue(entry, props.metric.id, scaleMode, included, filterActive, england),
  }));
  const rescale = isCrime && filterActive && scaleMode === "linear"
    ? rescaledStops(props.metric.legend, values.map((entry) => entry.value))
    : null;
  return { pack: { ...pack, values }, metric: props.metric, selected: props.selected, scaleMode, rescale, median: regionMedian };
}

/**
 * A move that loads no new pieces: when the view moved far enough (zoom ±0.5, the centre 30% away), the rank scale
 * takes the new view's breaks and the colours ease to them. The last paint's pack and boxes are reused: no fetch.
 */
export function rescaleOnMove(controller: MapController) {
  const { map } = controller;
  const last = controller.lastPaint;
  if (!last || !last.ticket.scope.isCurrent(last.ticket.sequence) || last.props.matchPack) return;
  // The legend's "No data" and the coverage banner follow the view (lib/no-data.ts).
  setViewCoverage(viewCoverage(last.pack.values, areaBoxes(last.data), mapBbox(map)));
  if (last.props.metric.bivariate) return;
  const crimeFiltered = last.props.metric.id === "crime" && last.props.excludedCrime.length > 0;
  const scaleMode = effectiveScaleMode(last.props.metric.id, last.props.scaleMode, crimeFiltered);
  const own = ownScale(last.props, scaleMode);
  // The legend's histogram follows the view on every layer; the colours stay put on the reader's own scale.
  if (own.adjustable) publishViewValues(controller, last, scaleMode, own.key);
  if (scaleMode !== "percentile" || own.scale.range || own.scale.scope !== "view") return;
  const anchor = controller.scaleAnchor;
  if (anchor && !needsRescale(anchor, { zoom: map.getZoom(), bounds: mapBbox(map), level: last.level })) return;
  const view = resolveAnalyticsView(last.pack, last.props, last.base, { bounds: scaleBounds(controller, last.level), boxes: areaBoxes(last.data) });
  paintView(controller, view, motionDuration(RESCALE_MORPH_MS));
}

/** The values in view now, for the legend's histogram (the last paint's pack: no fetch). */
function publishViewValues(controller: MapController, last: LastPaint, scaleMode: LegendScaleMode, key: string) {
  const isCrime = last.props.metric.id === "crime";
  const filterActive = isCrime && last.props.excludedCrime.length > 0;
  const included = isCrime ? crimeCategories(last.pack.values).filter((category) => !last.props.excludedCrime.includes(category)) : [];
  const measured = measuredValues(last.pack, last.props, last.base, scaleMode, included, filterActive);
  setViewValues(key, valuesInView(measured, mapBbox(controller.map), areaBoxes(last.data)));
}

/** The reader moved a handle, chose a scope or reset: the last paint recolours (at once while dragging), no fetch. */
export function repaintLast(controller: MapController) {
  const { map } = controller;
  const last = controller.lastPaint;
  if (!last || !last.ticket.scope.isCurrent(last.ticket.sequence) || !areaFills(map).length) return;
  const view = resolveAnalyticsView(last.pack, last.props, last.base,
    { bounds: scaleBounds(controller, last.level), boxes: areaBoxes(last.data), now: mapBbox(map) });
  paintView(controller, view, legendScaleDragging() ? 0 : motionDuration(RESCALE_MORPH_MS));
}
