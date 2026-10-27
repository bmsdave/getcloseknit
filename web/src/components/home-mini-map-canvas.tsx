"use client";

/**
 * The home page's mini map itself: MapLibre with the main map's basemap, its area fill
 * (value pack on the same area tiles, coloured by the same legend and morph expressions), the home's
 * area outlined and a pin on the home. Zoom only; a click opens the main map on the clicked area.
 * Loaded by home-mini-map.tsx with next/dynamic (no SSR), so the page paints before MapLibre.
 */
import * as maplibregl from "maplibre-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

import { KnitIcon } from "@/components/knit/knit-icon";

import "maplibre-gl/dist/maplibre-gl.css";

import { areaBox } from "@/lib/area-boxes";
import { areaTileSource, areaTileTarget, featureAreaId, isAreaTiles, registerAreaTileProtocol, type AreaTiles } from "@/lib/area-tiles";
import { carrierOfId, type GeographyId, type MapDefinition, type MetricDefinition, type ValuePack } from "@/lib/contracts";
import { applyBasemapTheme } from "@/lib/map-basemap-theme";
import { BASE_STYLE, MAPLIBRE_WORKER_URL } from "@/lib/map-core";
import { UNKNOWN_FILL_COLOR } from "@/lib/map-legend";
import { paintedMetric } from "@/lib/map-metric-paint";
import { createMorphStore, morphColourExpression, morphOpacityExpression, qualityKey, type MorphStore } from "@/lib/map-morph";
import { selectionFillOpacity, selectionHaloPaint, selectionOutlinePaint } from "@/lib/map-selection-paint";
import { demoPiece, fetchMapCoverage, londonPiece, piecePackPath, type Bbox } from "@/lib/map-coverage";
import { LONDON_BOUNDS, valuePackPath, type DataMode } from "@/lib/map-state";
import { DEFAULT_PALETTE, paletteById } from "@/lib/palettes";
import { politeFetch } from "@/lib/polite-fetch";
import { PRICE_METRIC_ID, PRICE_STEPS } from "@/lib/price-scale";
import { homeMapHref, type HomeMapLayer } from "@/lib/property-profile";
import { readValuePack } from "@/lib/value-pack-compact";
import { onUiThemeChange, resolvedUiTheme } from "@/lib/ui-themes";

/** `unavailable`: no map at all (no WebGL); `no-data`: the map runs but this layer did not load. */
export type MiniMapStatus = "loading" | "ready" | "no-data" | "unavailable";

const FILL = "home-mini-map-fill";
const OUTLINE = "home-mini-map-outline";
const HALO = "home-mini-map-halo";
const HOME_ZOOM = 14;

/** `home`: the home's area box, to centre on when the home has no point of its own. */
interface Painted { metric: MapDefinition; pack: ValuePack; tiles: AreaTiles; home: Bbox | null }

async function json<T>(url: string, signal: AbortSignal): Promise<T | null> {
  const response = await politeFetch(url, { signal });
  return response.ok ? (await response.json()) as T : null;
}

/** The release's fixed price breaks, or null (the legend's own log steps) when the answer is not a clean scale. */
function priceBreaks(payload: { breaks?: unknown } | null): number[] | null {
  const values = payload?.breaks;
  return Array.isArray(values) && values.length === PRICE_STEPS + 1 && values.every((value) => typeof value === "number")
    ? values as number[] : null;
}

/** The layer's definition (from /api/v1/metrics, as the explorer reads it), its value pack, the area tiles and the
 * home's area box. */
async function loadLayer(layer: HomeMapLayer, mode: DataMode, release: string, home: GeographyId | null,
  signal: AbortSignal): Promise<Painted> {
  const [catalogue, scale, coverage] = await Promise.all([
    json<{ metrics?: MetricDefinition[] }>("/api/v1/metrics", signal),
    layer === PRICE_METRIC_ID ? json<{ breaks?: unknown }>(`/api/v1/price-scale?${new URLSearchParams({ mode, release })}`, signal) : null,
    fetchMapCoverage(mode, release),
  ]);
  const tiles = coverage.areaTiles;
  if (!isAreaTiles(tiles)) throw new Error("mini map: no area tiles");
  const base = catalogue?.metrics?.find((metric) => metric.id === layer);
  if (!base) throw new Error(`mini map: no definition for ${layer}`);
  // Homes are London's (FLAGS.md, CLOSE_KNIT_ENGLAND): the map around one is London's one piece.
  const piece = mode === "demo" ? demoPiece(base.carrier) : londonPiece(base.carrier);
  const pack = readValuePack(await json<unknown>(piecePackPath(valuePackPath({ metric: layer, period: base.defaultPeriod, mode, release }), piece, null), signal));
  if (!pack?.values.length) throw new Error(`mini map: no values for ${layer}`);
  // The home's box from London's piece of its kind, as the pack (never every area of the kind in England).
  const box = home ? await areaBox(home, mode, release, [londonPiece(carrierOfId(home))]).catch(() => null) : null;
  return { metric: paintedMetric(base, paletteById(DEFAULT_PALETTE), priceBreaks(scale)), pack, tiles, home: box };
}

/** Under the basemap's first label, so street names stay readable over the colour. */
function firstSymbolLayer(map: MapLibreMap): string | undefined {
  return map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
}

const stores = new WeakMap<MapLibreMap, MorphStore>();

function storeFor(map: MapLibreMap): MorphStore {
  let store = stores.get(map);
  if (!store) {
    store = createMorphStore((id, state) => map.setFeatureState(areaTileTarget(id), state));
    stores.set(map, store);
  }
  return store;
}

/** The layer's areas on the main map's tiles of its kind: every area of the kind is drawn, the pack's coloured. */
function paint(map: MapLibreMap, { metric, pack, tiles }: Painted, home: GeographyId | null) {
  const kind = pack.values[0].carrier;
  const { source, sourceLayer } = areaTileTarget(pack.values[0].geographyId);
  if (!map.getSource(source)) map.addSource(source, areaTileSource(tiles, kind, window.location.origin));
  // A layer on another kind of area: the fill and outline move to its tiles.
  if (map.getLayer(FILL) && map.getLayer(FILL)?.source !== source) for (const id of [OUTLINE, HALO, FILL]) map.removeLayer(id);
  // One period, no morph: every area holds its value on side "a" with weight 0 (an area the new layer
  // leaves out is emptied by the store).
  storeFor(map).load("a", pack.values, 0);
  if (home) map.setFeatureState(areaTileTarget(home), { selected: true });
  const colour = morphColourExpression(metric.legend, metric.id === PRICE_METRIC_ID ? "log" : "linear", UNKNOWN_FILL_COLOR);
  if (map.getLayer(FILL)) map.setPaintProperty(FILL, "fill-color", colour);
  else {
    const before = firstSymbolLayer(map);
    // An area with no value in the pack is clear, as on the main map.
    const absent: maplibregl.ExpressionSpecification = ["==", ["feature-state", qualityKey("a")], null];
    const opacity = ["case", absent, 0, morphOpacityExpression(selectionFillOpacity)] as maplibregl.ExpressionSpecification;
    map.addLayer({ id: FILL, type: "fill", source, "source-layer": sourceLayer,
      paint: { "fill-color": colour, "fill-opacity": opacity, "fill-antialias": false } }, before);
    const mine: maplibregl.FilterSpecification = ["==", ["id"], home ? areaTileTarget(home).id : -1];
    map.addLayer({ id: HALO, type: "line", source, "source-layer": sourceLayer, filter: mine, paint: { ...selectionHaloPaint() } }, before);
    map.addLayer({ id: OUTLINE, type: "line", source, "source-layer": sourceLayer, filter: mine, paint: { ...selectionOutlinePaint() } }, before);
  }
}

/** Centre on the home's area when the home has no point of its own; returns the area's centre, or null. */
function fitArea(map: MapLibreMap, box: Bbox | null): { lat: number; lon: number } | null {
  if (!box) return null;
  const bounds = new maplibregl.LngLatBounds([box[0], box[1]], [box[2], box[3]]);
  map.fitBounds(bounds, { padding: 16, maxZoom: HOME_ZOOM, animate: false });
  const centre = bounds.getCenter();
  return { lat: centre.lat, lon: centre.lng };
}

/** The home's pin: a plain filled dot with a thin surface ring (DESIGN.md › Dot). */
function homePin(): HTMLElement {
  const pin = document.createElement("span");
  pin.className = "home-mini-map__pin";
  pin.setAttribute("aria-hidden", "true");
  return pin;
}

export function MiniMapCanvas({ point, geographyId, layer, mode, release, onStatus, onAreaCentre }: {
  point: { lat: number; lon: number } | null; geographyId: GeographyId | null; layer: HomeMapLayer;
  mode: DataMode; release: string; onStatus: (status: MiniMapStatus) => void;
  /** The home's area centre, once its shape loads, when the home has no point. */
  onAreaCentre: (centre: { lat: number; lon: number }) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const layerRef = useRef(layer);
  layerRef.current = layer;
  const lat = point?.lat ?? null;
  const lon = point?.lon ?? null;

  useEffect(() => {
    if (!container.current) return;
    maplibregl.setWorkerUrl(MAPLIBRE_WORKER_URL);
    registerAreaTileProtocol(maplibregl);
    let created: MapLibreMap;
    try {
      created = new maplibregl.Map({
        container: container.current,
        style: BASE_STYLE,
        ...(lat !== null && lon !== null ? { center: [lon, lat], zoom: HOME_ZOOM } : { bounds: LONDON_BOUNDS }),
        minZoom: 11,
        maxZoom: 17,
        // Zoom only, around the home: no panning, tilting or turning; the page scrolls past it.
        dragPan: false, dragRotate: false, pitchWithRotate: false, touchPitch: false, keyboard: false,
        doubleClickZoom: false, boxZoom: false,
        scrollZoom: { around: "center" }, touchZoomRotate: { around: "center" }, cooperativeGestures: true,
        attributionControl: { compact: true },
      });
    } catch {
      onStatus("unavailable");
      return;
    }
    created.touchZoomRotate.disableRotation();
    if (lat !== null && lon !== null) new maplibregl.Marker({ element: homePin() }).setLngLat([lon, lat]).addTo(created);
    const theme = () => applyBasemapTheme(created, resolvedUiTheme());
    const offTheme = onUiThemeChange(theme);
    created.on("load", () => { theme(); setMap(created); });
    // A click opens the main map on the area under it (the home's own when it lands on no area), this layer on.
    created.on("click", (event) => {
      const hit = created.getLayer(FILL) ? created.queryRenderedFeatures(event.point, { layers: [FILL] })[0] : undefined;
      const id = ((hit ? featureAreaId(hit) : undefined) as GeographyId | undefined) ?? geographyId;
      if (id) window.location.assign(homeMapHref(id, layerRef.current));
    });
    created.getCanvas().style.cursor = "pointer";
    return () => { offTheme(); created.remove(); setMap(null); };
  }, [lat, lon, geographyId, onStatus]);

  useEffect(() => {
    if (!map) return;
    const controller = new AbortController();
    onStatus("loading");
    void loadLayer(layer, mode, release, geographyId, controller.signal).then((painted) => {
      if (controller.signal.aborted) return;
      paint(map, painted, geographyId);
      if (lat === null || lon === null) {
        const centre = fitArea(map, painted.home);
        if (centre) onAreaCentre(centre);
      }
      onStatus("ready");
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      console.warn("home mini map: layer unavailable", layer, error);
      onStatus("no-data");
    });
    return () => controller.abort();
  }, [map, layer, mode, release, geographyId, lat, lon, onStatus, onAreaCentre]);

  // + and −, the main map's round buttons (map-layers.tsx › MapPosition).
  return (
    <>
      <div ref={container} className="home-mini-map__canvas" />
      <div className="home-mini-map__zoom">
        <button type="button" className="map-round" title="Zoom in" onClick={() => map?.zoomIn()} disabled={!map}>
          <KnitIcon name="plus" colour="var(--icon-yarn, currentColor)" className="map-round__icon" style={{ width: 20, height: 20 }} />
          <span className="sr-only">Zoom in</span>
        </button>
        <button type="button" className="map-round" title="Zoom out" onClick={() => map?.zoomOut()} disabled={!map}>
          <KnitIcon name="minus" colour="var(--icon-yarn, currentColor)" className="map-round__icon" style={{ width: 20, height: 20 }} />
          <span className="sr-only">Zoom out</span>
        </button>
      </div>
    </>
  );
}
