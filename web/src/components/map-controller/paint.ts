/**
 * The area map's paint: the area fills on their tiles (lib/area-tiles.ts), their colours and the period morph
 * (lib/map-morph.ts), the selection, the fade under houses and places, the trend arrows and the house-level layers.
 */
import type { ExpressionSpecification, GeoJSONSource, Map as MapLibreMap, MapGeoJSONFeature, PointLike } from "maplibre-gl";

import { tileKindOf, type Carrier, type GeographyId, type MapDefinition, type ValuePack } from "@/lib/contracts";
import type { AreaBoxes } from "@/lib/area-boxes";
import {
  AREA_FILL_LAYERS, AREA_TILE_KINDS, areaLevelZooms, areaOutlineFilter, areaTileLayers, areaTileSourceId, areaTileTarget,
  ensureAreaTileSource, type AreaTiles,
} from "@/lib/area-tiles";
import { percentileStops, type LegendScaleMode, type LegendStop } from "@/lib/legend-scale";
import { AREA_LABEL_LAYER_IDS, AREA_LABEL_SOURCE_ID, areaLabelLayers, areaLabelSource } from "@/lib/map-area-labels";
import { COLLISION_AREA_FADE, COLLISION_HANDOVER_ZOOM, COLLISION_HIT_LAYER, COLLISION_MARKER_LAYER } from "@/lib/map-collisions";
import { GREEN_VEIL_LAYER_FIRST, STREET_LAYERS } from "@/lib/map-landmarks";
import { hairlineLayer, LAD_EDGE_LAYER, ladEdgeLayer } from "@/lib/area-edges";
import { NO_DATA_OPACITY, noDataColour, withNoDataColour } from "@/lib/no-data";
import {
  createMorph, createMorphStore, MORPH_WEIGHT_KEY, morphColourExpression, morphOpacityExpression, morphUnknownExpression, qualityKey, type Morph,
} from "@/lib/map-morph";
import { PLACE_AREA_FADE, PLACE_MIN_ZOOM } from "@/lib/map-place-layers";
import {
  AREA_FADE_ZOOM, areaFadedUnderHouses, areaFillFade, BLOCK_FILL_LAYER, BLOCK_OUTLINE_LAYER, blockColour, DEFAULT_SOLD_RAMP,
  HOUSE_FADED_FILL, homePaint, opacityOverZoom, PARCEL_FILL_LAYER, PROPERTY_LAYER_IDS, PROPERTY_SOURCE_ID, propertyLayers,
  propertyLayersApply, propertySource,
} from "@/lib/map-property-layers";
import { SALE_LAYER_IDS, SALE_PIN_LAYER, saleHaloColour } from "@/lib/map-sale-layers";
import { SCHOOL_LAYERS } from "@/lib/map-school-layer";
import { selectionFillOpacity, selectionHaloPaint, selectionOutlinePaint } from "@/lib/map-selection-paint";
import { TRANSIT_SOURCE } from "@/lib/map-transit";
import { addTrendIcons, TREND_ARROW_LAYER_IDS, trendArrowLayers } from "@/lib/map-trend-arrows";
import { divergingStops } from "@/lib/palettes";
import { PRICE_METRIC_ID, PRICE_MORPH_MS } from "@/lib/price-scale";
import { mapRelease } from "@/lib/release-url";
import { playbackBeat } from "@/lib/timeline-playback";
import { resolvedUiTheme } from "@/lib/ui-themes";

import { motionDuration } from "./camera";
import type { MapController } from "./controller";
import { areaBoxes, areaTilesOf, currentPieces } from "./data";
import type { AnalyticsView, AreaMapProps } from "./types";

export const EMPTY_COLLECTION: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
/** Basemap layers the zone fill goes under (OpenFreeMap / OpenMapTiles ids), first found wins. */
const FILL_UNDER_LAYERS = [GREEN_VEIL_LAYER_FIRST, ...STREET_LAYERS];
/** Share of the usual fill opacity a place comparison keeps (0.88 → 0.44): a tint over the streets. */
const COMPARISON_FILL_SCALE = 0.5;
/** How long a paint on another kind of area waits for that kind's tiles before it lands anyway. */
const NEXT_KIND_WAIT_MS = 2_000;
const MARKER_LAYERS: ReadonlySet<string> = new Set([COLLISION_HIT_LAYER, COLLISION_MARKER_LAYER, ...SCHOOL_LAYERS]);
/** Colour expressions by metric, scale and stops: a memo shared by every map (the expressions are plain data). */
const colourCache = new Map<string, ExpressionSpecification>();

export function colourExpression(
  metric: MapDefinition,
  scaleMode: LegendScaleMode,
  rescale: LegendStop[] | null,
): ExpressionSpecification {
  const source = rescale ?? (scaleMode === "change"
    ? divergingStops()
    : scaleMode === "percentile" ? percentileStops(metric.legend) : metric.legend);
  const theme = resolvedUiTheme();
  const key = `${theme}:${metric.id}:${scaleMode}:${source.map((stop) => `${stop.value}=${stop.colour}`).join(",")}`;
  const cached = colourCache.get(key);
  if (cached) return cached;
  // Price levels sit on a log axis (the legend's stops are spaced evenly in ratio).
  const logScaled = metric.id === PRICE_METRIC_ID && scaleMode === "linear" && !rescale;
  const expression = morphColourExpression(source, logScaled ? "log" : "linear", noDataColour(theme));
  colourCache.set(key, expression);
  return expression;
}

/** No area colours: the basemap shows through (My match with nothing to match yet). */
export function clearAreaFill(controller: MapController) {
  const { map } = controller;
  for (const id of areaFills(map)) map.setPaintProperty(id, "fill-color", "rgba(0, 0, 0, 0)");
  // The next colours land at once rather than morphing from a fill that is not there.
  controller.shownColour = null;
}

export function paintView(controller: MapController, view: AnalyticsView, morphMs?: number) {
  const { map } = controller;
  const colour = colourExpression(view.metric, view.scaleMode, view.custom ?? view.rescale);
  const morph = morphFor(controller);
  const previous = morph.latest;
  const duration = morphMs ?? morphDuration(previous, controller.shownColour, view, colour);
  controller.shownColour = colour;
  for (const id of areaFills(map)) map.setPaintProperty(id, "fill-color", colour);
  // A place comparison is read against the streets under it: its fill lets the map show through.
  const translucent = !!view.metric.bivariate;
  if (controller.translucentFill !== translucent) {
    controller.translucentFill = translucent;
    applyAreaFade(controller);
  }
  applyAreaSelection(controller, view.selected);
  // The same values again (a selection, a re-render) leave the morph alone.
  if (!previous || !sameValues(previous.pack.values, view.pack.values)) {
    // A playback step starts on the beat; any other change starts now.
    morph.show(view, duration, playbackBeat.startFor(view.pack.period));
  }
  const change = view.scaleMode === "change";
  // The arrows read the change itself, also on the reader's own range (pack.values are places on it then).
  if (change) applyArrowValues(controller, view.custom && view.raw ? { ...view.pack, values: view.raw } : view.pack);
  controller.changeScale = change;
  applyTrendArrows(controller);
  paintPropertyLayers(controller, view.metric);
}

// The area fill morphs between periods (lib/map-morph): it reads two values
// per area (`a`, `b`) and a weight `t` from feature-state and colours the
// blend. A period change on the same colour scale morphs; anything else —
// another layer or scale, reduced motion — lands at once.
const MORPH_SAMPLE_LIMIT = 2_000;

export function morphDuration(
  previous: AnalyticsView | null,
  previousColour: ExpressionSpecification | null,
  view: AnalyticsView,
  colour: ExpressionSpecification,
): number {
  if (!previous || previous.pack.period === view.pack.period || previousColour !== colour) return 0;
  return motionDuration(PRICE_MORPH_MS);
}

export function sameValues(left: ValuePack["values"], right: ValuePack["values"]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const [a, b] = [left[index], right[index]];
    if (a.geographyId !== b.geographyId || a.value !== b.value || a.quality !== b.quality) return false;
  }
  return true;
}

/** The pack's values for the areas of the paint's pieces (all of them before any paint). */
export function drawnValues(drawn: AreaBoxes | null, values: ValuePack["values"]): ValuePack["values"] {
  // Indexed only for a pack that carries more than them (a ready-made criterion: every LSOA in England).
  if (!drawn || values.length <= drawn.length) return values;
  const ids = areaBoxes(drawn);
  return values.filter((entry) => ids.has(entry.geographyId));
}

function morphFor(controller: MapController): Morph<AnalyticsView> {
  const existing = controller.morph;
  if (existing) return existing;
  const store = createMorphStore((id, state) => writeAreaState(controller, id, state));
  const morph: Morph<AnalyticsView> = createMorph<AnalyticsView>({
    // Only the areas the source draws: MapLibre replays every state it holds into each tile that loads (a
    // ready-made criterion carries every LSOA in England, 34k states where 5k are drawn: a zoom then stalled).
    load: (key, view, t) => store.load(key, drawnValues(controller.paintedBoxes, view.pack.values), t),
    weigh: (t) => {
      const samples = controller.morphSamples;
      const started = performance.now();
      store.weigh(t);
      if (!samples) return;
      samples.push({ at: started, writeMs: performance.now() - started, position: morph.landed + morph.progress, weight: t });
      if (samples.length > MORPH_SAMPLE_LIMIT) samples.shift();
    },
    settle: (key) => store.settle(key),
    begin: (view) => {
      controller.callbacks.onMedian(view.median);
      controller.callbacks.onPainted?.({
        metricId: view.metric.id, scaleMode: view.scaleMode, values: view.raw ?? view.pack.values, inView: !!view.viewBreaks, custom: !!view.custom,
      });
    },
    now: () => performance.now(),
    frame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
  });
  controller.morph = morph;
  return morph;
}

/** The selected area on its tiles: the fill's opacity and its kind's outline. */
export function applyAreaSelection(controller: MapController, selected: GeographyId | null) {
  const previous = controller.selectedArea;
  if (previous === selected) return;
  if (previous) writeAreaState(controller, previous, { selected: false });
  if (selected) writeAreaState(controller, selected, { selected: true });
  filterAreaOutlines(controller.map, selected);
  controller.selectedArea = selected;
}

function emptyState(state: Record<string, unknown>): boolean {
  return Object.entries(state).every(([key, value]) => key === MORPH_WEIGHT_KEY || value === null || value === undefined || value === false);
}

/**
 * An area's feature-state on its kind's tile source. An area left with nothing (out of the view's pieces, unselected)
 * loses its state altogether: MapLibre replays every state it holds into each tile that loads, so it holds only the
 * areas in play. Every kind's source is on the map before the first state (mountAreaFills).
 */
export function writeAreaState(controller: MapController, id: string, state: Record<string, unknown>) {
  const target = areaTileTarget(id);
  if (!Number.isFinite(target.id)) return;
  const { map, tileStates: held } = controller;
  const previous = held.get(id);
  const merged = previous ? Object.assign(previous, state) : { ...state };
  const onMap = !!map.getSource(target.source);
  if (emptyState(merged)) {
    if (held.delete(id) && onMap) map.removeFeatureState(target);
    return;
  }
  if (!previous) held.set(id, merged);
  if (onMap) map.setFeatureState(target, state);
}

/** Each kind's area fill on the map. */
export function areaFills(map: MapLibreMap): string[] {
  return AREA_FILL_LAYERS.filter((id) => map.getLayer(id));
}

/** The areas the fills have drawn under `point`, or in view. */
export function renderedAreas(map: MapLibreMap, point?: PointLike): MapGeoJSONFeature[] {
  const layers = areaFills(map);
  if (!layers.length) return [];
  return point ? map.queryRenderedFeatures(point, { layers }) : map.queryRenderedFeatures({ layers });
}

/** The source the fill draws from now: the drawn kind's area tiles (LSOAs before the first paint). */
export function fillSourceOf(controller: MapController): string {
  return areaTileSourceId(controller.drawnKind ?? "lsoa");
}

export function fillSourceLayerOf(controller: MapController): { sourceLayer: string } {
  return { sourceLayer: tileKindOf(controller.drawnKind ?? "lsoa") };
}

/** England's map paints a layer of LSOAs on MSOAs below WIDE_ZOOM (lib/map-coverage.ts): the two kinds hand over. */
export function lsoaLevels(props: Pick<AreaMapProps, "matchPack" | "clientPack" | "clientRollup" | "metric">): boolean {
  return !props.matchPack && (props.clientPack ? !!props.clientRollup : props.metric.carrier === "lsoa");
}

/**
 * Every kind's tile source and fill, added once under the streets and never removed: each draws over the zoom range
 * areaLevelZooms gives it (none until then), with the colours every fill shares.
 */
function mountAreaFills(controller: MapController, tiles: AreaTiles) {
  const { map } = controller;
  if (AREA_TILE_KINDS.every((kind) => map.getLayer(areaTileLayers(kind).fill))) return;
  const before = fillBeforeLayer(map);
  for (const kind of AREA_TILE_KINDS) {
    const source = ensureAreaTileSource(map, tiles, kind);
    const { fill } = areaTileLayers(kind);
    if (map.getLayer(fill)) continue;
    // No antialiasing: MapLibre's antialiased edge is a second, translucent pass over both sides of a shared edge, a
    // darker seam between neighbours (a sixth of the pixels of a z9.6 view, stronger as the fill fades over houses).
    map.addLayer({
      id: fill, type: "fill", source, "source-layer": kind, minzoom: 24, maxzoom: 24,
      paint: { "fill-color": controller.shownColour ?? noDataColour(resolvedUiTheme()), "fill-opacity": fillOpacity(), "fill-antialias": false },
    }, before);
    // The level's hairlines over its fill (a LAD's border is the ink line below, at every zoom).
    if (kind !== "borough" && !map.getLayer(areaTileLayers(kind).edge)) map.addLayer(hairlineLayer(kind, source, resolvedUiTheme()), before);
  }
  if (!map.getLayer(LAD_EDGE_LAYER)) map.addLayer(ladEdgeLayer(areaTileSourceId("lad"), resolvedUiTheme()), before);
}

/**
 * Each kind's halo and outline for the selected area (feature-state `selected`), over everything on the map then.
 * They hold the selected area's feature alone (areaOutlineFilter).
 */
function mountAreaOutlines(controller: MapController) {
  const { map } = controller;
  for (const kind of AREA_TILE_KINDS) {
    const { halo, outline } = areaTileLayers(kind);
    if (map.getLayer(outline)) continue;
    const layer = {
      type: "line", source: areaTileSourceId(kind), "source-layer": kind, minzoom: 24, maxzoom: 24,
      filter: areaOutlineFilter(kind, controller.selectedArea),
    } as const;
    map.addLayer({ ...layer, id: outline, paint: { ...selectionOutlinePaint() } });
    map.addLayer({ ...layer, id: halo, paint: { ...selectionHaloPaint() } }, outline);
  }
}

/** The selected area's kind's halo and outline take its feature; the kind it leaves, none (a filter: its tiles reload). */
function filterAreaOutlines(map: MapLibreMap, selected: GeographyId | null) {
  for (const kind of AREA_TILE_KINDS) {
    const filter = areaOutlineFilter(kind, selected);
    for (const id of [areaTileLayers(kind).halo, areaTileLayers(kind).outline]) if (map.getLayer(id)) map.setFilter(id, filter);
  }
}

/** Each kind's layers over its zoom range (areaLevelZooms): `painted` and `also` at every zoom. */
export function applyAreaLevels(controller: MapController, painted: Carrier, lsoa: boolean, also: Iterable<Carrier> = []) {
  const { map } = controller;
  controller.drawnKind = painted;
  const zooms = areaLevelZooms(painted, lsoa, also);
  for (const kind of AREA_TILE_KINDS) {
    for (const id of Object.values(areaTileLayers(kind))) {
      if (map.getLayer(id)) map.setLayerZoomRange(id, ...zooms[kind]);
    }
  }
}

/**
 * Another kind of area joins the one drawn at every zoom, still clear (it holds no colours yet), and this resolves
 * once its tiles in view are loaded (at most NEXT_KIND_WAIT_MS): its colours then land on drawn tiles in the frame
 * the drawn kind's leave, never a frame without a fill. Checked from the next frame on, which puts its tiles in use.
 */
export function nextKindLoaded(controller: MapController, tiles: AreaTiles, kind: Carrier): Promise<void> {
  const { map } = controller;
  mountAreaFills(controller, tiles);
  for (const id of Object.values(areaTileLayers(kind))) if (map.getLayer(id)) map.setLayerZoomRange(id, 0, 24);
  const source = areaTileSourceId(kind);
  return new Promise((resolve) => {
    const check = () => { if (map.isSourceLoaded(source)) done(); };
    const done = () => {
      window.clearTimeout(timer);
      map.off("render", check);
      resolve();
    };
    const timer = window.setTimeout(done, NEXT_KIND_WAIT_MS);
    map.on("render", check);
  });
}

/**
 * The area fill on area tiles (lib/area-tiles.ts): each kind's layers stay on the map and the kind the paint is on
 * draws at every zoom (applyAreaLevels); `data` holds each area's box (what the scale, the view's region and fitting
 * read). The selected area's outline is drawn from the same tiles as its fill; the trend arrows sit on them too.
 */
export function ensureTileLayers(controller: MapController, data: AreaBoxes, tiles: AreaTiles, kind: Carrier, lsoa: boolean,
  also: Iterable<Carrier>) {
  const { map } = controller;
  mountAreaFills(controller, tiles);
  // No shapes to send anywhere: the paint's boxes are what its areas are (drawnValues).
  if (controller.paintedBoxes !== data) controller.geometryUpdates += 1;
  controller.paintedBoxes = data;
  ensureAreaLabels(map);
  ensureTrendArrows(map, areaTileSourceId(kind), tileKindOf(kind));
  mountAreaOutlines(controller);
  applyAreaLevels(controller, kind, lsoa, also);
}

/** The first view's tiles start loading with the coverage, alongside its value pack: nothing shows until it paints. */
export function primeAreaTiles(controller: MapController, props: AreaMapProps) {
  const tiles = areaTilesOf(controller);
  if (!tiles || controller.drawnKind !== null) return;
  const kind = currentPieces(controller, { mode: props.mode, carrier: props.metric.carrier })[0]?.carrier ?? props.metric.carrier;
  mountAreaFills(controller, tiles);
  applyAreaLevels(controller, kind, lsoaLevels(props));
}

/** Change scale: each area's percent as its feature-state, for the rise/fall arrows on its tiles. */
export function applyArrowValues(controller: MapController, pack: ValuePack) {
  const written = controller.arrowValues;
  for (const entry of pack.values) {
    if (written.has(entry.geographyId) && written.get(entry.geographyId) === entry.value) continue;
    writeAreaState(controller, entry.geographyId, { value: entry.value });
    written.set(entry.geographyId, entry.value);
  }
}

// Street blocks, parcels (freehold polygons) and parcel-less dwellings sit above the area
// fill for the price layer; other layers hide them. A sold home takes its last sale's coarse
// band in the palette's price colours; any other is clear and shows its area's colour.
function paintPropertyLayers(controller: MapController, metric: MapDefinition) {
  const { map } = controller;
  ensurePropertyLayers(controller, metric);
  controller.propertyMetric = metric;
  controller.hoverUnit = metric.unit;
  // Street blocks: the median £/m² of three or more homes.
  map.setPaintProperty(BLOCK_FILL_LAYER, "fill-color", blockColour(metric));
  map.setPaintProperty(BLOCK_OUTLINE_LAYER, "line-color", blockColour(metric));
  syncHouseLayers(controller);
}

// Parcels carry £/m² levels, not change: the change scale keeps the area colours on top.
export function applyTrendArrows(controller: MapController) {
  const { map } = controller;
  const shown = controller.changeScale && !controller.plain;
  for (const id of TREND_ARROW_LAYER_IDS) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", shown ? "visible" : "none");
  }
}

export function applyPlain(controller: MapController, plain: boolean) {
  if (controller.plain === plain) return;
  controller.plain = plain;
  applyTrendArrows(controller);
  syncHouseLayers(controller);
}

export function salesOn(controller: MapController): boolean {
  return !!controller.saleView?.on;
}

/** Parcels/blocks and sale pins share the house level: one or the other. */
export function syncHouseLayers(controller: MapController) {
  const { map } = controller;
  const metric = controller.propertyMetric;
  const sales = salesOn(controller);
  const parcels = !!metric && propertyLayersApply(metric.id) && !sales && !controller.changeScale && !controller.plain;
  if (map.getLayer(PARCEL_FILL_LAYER)) {
    for (const id of PROPERTY_LAYER_IDS) map.setLayoutProperty(id, "visibility", parcels ? "visible" : "none");
  }
  if (map.getLayer(SALE_PIN_LAYER)) {
    for (const id of SALE_LAYER_IDS) map.setLayoutProperty(id, "visibility", sales ? "visible" : "none");
  }
  applyHomePaint(controller);
  applyAreaFade(controller);
}

/** The homes' palette (the sale pins' six price colours) and theme. */
function currentHomePaint(controller: MapController) {
  return { ramp: controller.saleView?.ramp ?? DEFAULT_SOLD_RAMP, theme: resolvedUiTheme() };
}

export function applyHomePaint(controller: MapController) {
  const { map } = controller;
  if (map.getLayer(SALE_PIN_LAYER)) map.setPaintProperty(SALE_PIN_LAYER, "icon-halo-color", saleHaloColour(resolvedUiTheme()));
  if (!map.getLayer(PARCEL_FILL_LAYER)) return;
  for (const [layer, paint] of Object.entries(homePaint(currentHomePaint(controller)))) {
    for (const [property, value] of Object.entries(paint)) {
      map.setPaintProperty(layer, property as Parameters<MapLibreMap["setPaintProperty"]>[1], value);
    }
  }
}

/**
 * The area fill steps back where houses carry the colour, and under place points so they read. Set when one of
 * those changes, never on a zoom: every zoom is in the one expression (opacityOverZoom), so the tiles stay laid out.
 */
export function applyAreaFade(controller: MapController) {
  const { map } = controller;
  const fills = areaFills(map);
  if (!fills.length) return;
  const base = fillOpacity();
  const sales = salesOn(controller);
  const opacity = opacityOverZoom(base, (zoom) => {
    const houseFaded = areaFadedUnderHouses(zoom, { sales });
    const placeFaded = controller.placesOn && zoom >= PLACE_MIN_ZOOM;
    // The collision heat is warm like the top area classes: the fill steps back under it.
    const heatFaded = !!controller.collisionView && zoom < COLLISION_HANDOVER_ZOOM;
    const fades = [controller.translucentFill ? COMPARISON_FILL_SCALE : 1, placeFaded && !houseFaded ? PLACE_AREA_FADE : 1,
      heatFaded ? COLLISION_AREA_FADE : 1];
    return (houseFaded ? HOUSE_FADED_FILL : 1) * areaFillFade(zoom, fades);
  }, [AREA_FADE_ZOOM, PLACE_MIN_ZOOM, COLLISION_HANDOVER_ZOOM]);
  // None, or a street layer on: the fill stays (an area still takes a tap and its outline) but shows no colour.
  for (const id of fills) map.setPaintProperty(id, "fill-opacity", controller.plain || controller.areaFillHidden ? 0 : opacity);
  // The outline draws only the selected area: it stays at full strength over houses and places.
}

function ensurePropertyLayers(controller: MapController, metric: MapDefinition) {
  const { map } = controller;
  if (!map.getSource(PROPERTY_SOURCE_ID)) {
    map.addSource(PROPERTY_SOURCE_ID, propertySource(window.location.origin, mapRelease(map)));
  }
  if (map.getLayer(PARCEL_FILL_LAYER)) return;
  for (const layer of propertyLayers(metric, currentHomePaint(controller))) map.addLayer(layer, firstSymbolLayer(map));
  controller.hoverUnit = metric.unit;
}

export function applySelectedParcel(controller: MapController | null, parcelId: string | null) {
  const map = controller?.map;
  if (!controller || !map?.getSource(PROPERTY_SOURCE_ID)) return;
  const previous = controller.selectedParcel;
  if (previous && previous !== parcelId) {
    map.setFeatureState({ source: PROPERTY_SOURCE_ID, sourceLayer: "parcels", id: Number(previous) }, { selected: false });
    controller.selectedParcel = null;
  }
  if (parcelId && previous !== parcelId) {
    map.setFeatureState({ source: PROPERTY_SOURCE_ID, sourceLayer: "parcels", id: Number(parcelId) }, { selected: true });
    controller.selectedParcel = parcelId;
  }
}

/** The zone fill tints the basemap's buildings and sits under its roads, so streets stay readable over the colour. */
export function fillBeforeLayer(map: MapLibreMap): string | undefined {
  // A basemap without streets or labels (the e2e fixture style): under the Tube network, as on a real one.
  return FILL_UNDER_LAYERS.find((id) => map.getLayer(id))
    ?? map.getStyle().layers.find((layer) => "source" in layer && layer.source === TRANSIT_SOURCE)?.id ?? firstSymbolLayer(map);
}

/**
 * Evidence-quality opacity of the two periods, blended like the colour. An area with no quality in either period
 * is not in the view's packs: clear (the tiles draw every area of a kind).
 */
function fillOpacity(): ExpressionSpecification {
  const opacity = morphOpacityExpression(selectionFillOpacity);
  const absent = ["all", ["==", ["feature-state", qualityKey("a")], null], ["==", ["feature-state", qualityKey("b")], null]];
  // An area in the packs without a value in either period: "No data", one grey (lib/no-data.ts).
  return ["case", absent, 0, morphUnknownExpression(), NO_DATA_OPACITY, opacity] as unknown as ExpressionSpecification;
}

/** Day and Night: the fill's "No data" grey follows the theme (the ramp's colours are the same in both). */
export function applyNoDataTheme(controller: MapController) {
  const { map } = controller;
  if (!controller.shownColour) return;
  const colour = withNoDataColour(controller.shownColour, noDataColour(resolvedUiTheme()));
  controller.shownColour = colour;
  for (const id of areaFills(map)) map.setPaintProperty(id, "fill-color", colour);
}

// Borough and postcode-district labels come from their own point source and
// install independently of the fill/outline lifecycle: fixture styles may
// already provide those layers while never providing labels.
function ensureAreaLabels(map: MapLibreMap) {
  if (!map.getSource(AREA_LABEL_SOURCE_ID)) {
    // The names (0.45 MB of points) load once the map is idle after its first colours, as the Tube network does:
    // the first paint never waits for them (perf/layer-load, phase C).
    map.addSource(AREA_LABEL_SOURCE_ID, { type: "geojson", data: EMPTY_COLLECTION });
    map.once("idle", () => {
      (map.getSource(AREA_LABEL_SOURCE_ID) as GeoJSONSource | undefined)?.setData(areaLabelSource(window.location.origin).data);
    });
  }
  if (map.getLayer(AREA_LABEL_LAYER_IDS[0])) return;
  // Under the Show markers already on the map (collision bursts, school caps): they stay on top of every label.
  for (const layer of areaLabelLayers(AREA_LABEL_SOURCE_ID, resolvedUiTheme())) map.addLayer(layer, firstMarkerLayer(map));
}

/** The lowest Show marker layer in the style (labels go under it), or undefined for the top. */
function firstMarkerLayer(map: MapLibreMap): string | undefined {
  return map.getStyle().layers.find((layer) => MARKER_LAYERS.has(layer.id))?.id;
}

// Rise/fall thread icons over each area in the change scale; hidden until paintView shows them.
/** The rise/fall arrows on the drawn kind's tiles (`source`, `sourceLayer`). */
function ensureTrendArrows(map: MapLibreMap, source: string, sourceLayer: string) {
  addTrendIcons(map, window.devicePixelRatio || 1);
  const existing = map.getLayer(TREND_ARROW_LAYER_IDS[0]);
  if (existing?.source === source && existing.sourceLayer === sourceLayer) return;
  const visibility = existing ? map.getLayoutProperty(TREND_ARROW_LAYER_IDS[0], "visibility") : undefined;
  for (const id of TREND_ARROW_LAYER_IDS) if (map.getLayer(id)) map.removeLayer(id);
  for (const layer of trendArrowLayers(source, sourceLayer)) {
    map.addLayer(visibility ? { ...layer, layout: { ...layer.layout, visibility } } : layer);
  }
}

export function firstSymbolLayer(map: MapLibreMap): string | undefined {
  return map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
}
