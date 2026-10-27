/** The area map's diagnostics (?diagnostics=1): the hooks the e2e specs and perf scripts read on `window`. */
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";

import type { GeographyId } from "@/lib/contracts";
import { areaTileTarget, featureAreaId } from "@/lib/area-tiles";
import { AREA_LABEL_LAYER_IDS } from "@/lib/map-area-labels";
import { DIAGNOSTICS_QUERY_PARAM } from "@/lib/map-state";
import { TRANSIT_SOURCE } from "@/lib/map-transit";
import { TREND_ARROW_DOWN_LAYER, TREND_ARROW_LAYER_IDS, TREND_ARROW_UP_LAYER, trendArrow } from "@/lib/map-trend-arrows";

import { WIDER_AREA_LAYERS } from "./camera";
import type { MapController } from "./controller";
import { fillSourceLayerOf, fillSourceOf, paintView, renderedAreas } from "./paint";
import type { AnalyticsView } from "./types";

export function diagnosticsEnabled(): boolean {
  try {
    return new URLSearchParams(window.location.search).get(DIAGNOSTICS_QUERY_PARAM) === "1";
  } catch {
    return false;
  }
}

export function installDiagnostics(controller: MapController, view: AnalyticsView) {
  const { map } = controller;
  // An area's feature-state on its tiles (My match's matchOut hatch flag), for the e2e specs.
  (window as unknown as { __closeKnitFillState?: (id: string) => Record<string, unknown> }).__closeKnitFillState = (id) =>
    (map.getSource(areaTileTarget(id).source) ? map.getFeatureState(areaTileTarget(id)) : {});
  if (!controller.morphSamples) controller.morphSamples = [];
  window.__closeKnitMap = map;
  window.__closeKnitDiagnostics = {
    measureStyleUpdate(iterations: number) {
      return measureStyleUpdate(controller, view, iterations);
    },
    renderedAreaCount() {
      return renderedAreas(map).length;
    },
    sourceAreaCount() {
      return map.querySourceFeatures(fillSourceOf(controller), fillSourceLayerOf(controller)).length;
    },
    fillSource() {
      return fillSourceOf(controller);
    },
    hideTransit() {
      // The Tube network loads on its own schedule; screenshots of other layers leave it out.
      for (const layer of map.getStyle().layers) {
        if ("source" in layer && layer.source === TRANSIT_SOURCE) map.setLayoutProperty(layer.id, "visibility", "none");
      }
    },
    featureValue(id: GeographyId) {
      // The period shown, or being morphed to.
      return controller.morph?.current?.pack.values.find((entry) => entry.geographyId === id)?.value ?? null;
    },
    renderedFeatureIds() {
      return renderedAreas(map).map((feature) => featureAreaId(feature));
    },
    renderedArrows() {
      // Placed arrows whose direction matches the area's change (the other one is transparent), once per area.
      const layers = TREND_ARROW_LAYER_IDS.filter((id) => map.getLayer(id)
        && map.getLayoutProperty(id, "visibility") !== "none");
      const shown = new Map<string, { layer: string; id: string | number | undefined }>();
      for (const feature of layers.length ? map.queryRenderedFeatures({ layers }) : []) {
        const value = map.getFeatureState({ source: feature.source, sourceLayer: feature.sourceLayer, id: feature.id }).value;
        const direction = trendArrow(typeof value === "number" ? value : null);
        if (direction && feature.layer.id === (direction === "up" ? TREND_ARROW_UP_LAYER : TREND_ARROW_DOWN_LAYER)) {
          shown.set(`${feature.layer.id}|${feature.id}`, { layer: feature.layer.id, id: featureAreaId(feature) });
        }
      }
      return [...shown.values()];
    },
    renderedAreaLabels() {
      const layers = AREA_LABEL_LAYER_IDS.filter((id) => map.getLayer(id));
      return (layers.length ? map.queryRenderedFeatures({ layers: [...layers] }) : [])
        .map((feature) => ({ kind: String(feature.properties.kind), label: String(feature.properties.label) }));
    },
    layerIds() {
      return map.getStyle().layers.map((layer) => layer.id);
    },

    geometryUpdateCount() {
      return controller.geometryUpdates;
    },
    paintProperty(layer: string, property: string) {
      return map.getLayer(layer) ? map.getPaintProperty(layer, property as never) : null;
    },
    layoutProperty(layer: string, property: string) {
      return map.getLayer(layer) ? map.getLayoutProperty(layer, property as never) : null;
    },
    geojsonKinds(source: string) {
      // The `kind` of each feature last set on a GeoJSON source (My match zones: zone, draft, corner).
      const data = (map.getSource(source) as GeoJSONSource | undefined)?.serialize().data;
      return typeof data === "object" && data && "features" in data
        ? (data.features as { properties?: { kind?: string } | null }[]).map((feature) => feature.properties?.kind ?? "") : [];
    },
    project(lngLat: [number, number]) {
      const point = map.project(lngLat);
      return { x: point.x, y: point.y };
    },
    renderedCount(layer: string, at?: [number, number]) {
      // Features of one layer drawn in view, or under one screen point.
      if (!map.getLayer(layer)) return 0;
      return (at ? map.queryRenderedFeatures(at, { layers: [layer] }) : map.queryRenderedFeatures({ layers: [layer] })).length;
    },
    renderedPoints(layer: string) {
      if (!map.getLayer(layer)) return [];
      return map.queryRenderedFeatures({ layers: [layer] }).flatMap((feature) => {
        if (feature.geometry.type !== "Point") return [];
        const point = map.project(feature.geometry.coordinates as [number, number]);
        return [{ x: point.x, y: point.y, properties: feature.properties ?? {} }];
      });
    },
    debug() {
      return debugSnapshot(controller);
    },
    morph() {
      const morph = controller.morph;
      return {
        morphing: morph?.morphing ?? false,
        progress: morph?.progress ?? 0,
        weight: morph?.weight ?? 0,
        landed: morph?.landed ?? 0,
        samples: [...(controller.morphSamples ?? [])],
        period: morph?.current?.pack.period ?? null,
      };
    },
    refreshTimings() {
      return [...controller.refreshTimings];
    },
  };
  window.__closeKnitCamera = () => {
    const centre = map.getCenter();
    return {
      zoom: map.getZoom(), lng: centre.lng, lat: centre.lat, bearing: map.getBearing(), pitch: map.getPitch(),
      doubleClickZoom: !!map.doubleClickZoom.isEnabled(), boxZoom: !!map.boxZoom.isEnabled(),
    };
  };
}

/** Per refresh, ms to get the pack and ms to resolve and paint it (the last 300). */
export function recordRefreshTiming(controller: MapController, timing: { period: string; fetchMs: number; applyMs: number }) {
  controller.refreshTimings = [...controller.refreshTimings, timing].slice(-300);
}

function measureStyleUpdate(controller: MapController, view: AnalyticsView, iterations: number): number {
  const durations: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const start = performance.now();
    paintView(controller, view);
    durations.push(performance.now() - start);
  }
  durations.sort((left, right) => left - right);
  return durations[Math.ceil(durations.length * 0.95) - 1] ?? 0;
}

function debugSnapshot(controller: MapController): unknown {
  const { map } = controller;
  return {
    bounds: map.getBounds()?.toArray() ?? [],
    sourceLoaded: map.isSourceLoaded(fillSourceOf(controller)),
    buildingsLoaded: map.isSourceLoaded("area-buildings"),
    renderedCount: renderedAreas(map).length,
    // A selected district or borough's own outline (the map fills neighbourhoods only).
    widerAreaRendered: map.getLayer(WIDER_AREA_LAYERS.outline)
      ? map.queryRenderedFeatures({ layers: [WIDER_AREA_LAYERS.outline] }).length : 0,
  };
}

declare global {
  interface Window {
    __closeKnitDiagnostics: {
      measureStyleUpdate(iterations: number): number;
      renderedAreaCount(): number;
      sourceAreaCount(): number;
      fillSource(): string;
      hideTransit(): void;
      featureValue(id: GeographyId): unknown;
      renderedFeatureIds(): (string | number | undefined)[];
      renderedArrows(): { layer: string; id: string | number | undefined }[];
      renderedAreaLabels(): { kind: string; label: string }[];
      layerIds(): string[];
      debug(): unknown;
      geometryUpdateCount(): number;
      paintProperty(layer: string, property: string): unknown;
      renderedCount(layer: string, at?: [number, number]): number;
      /** A layer's layout property (e.g. "visibility"), or null without the layer. */
      layoutProperty(layer: string, property: string): unknown;
      geojsonKinds(source: string): string[];
      /** A place's position in the map canvas, in CSS pixels. */
      project(lngLat: [number, number]): { x: number; y: number };
      /** The point features a layer has drawn, with their canvas positions (a "+N" fold, a dot). */
      renderedPoints(layer: string): { x: number; y: number; properties: Record<string, unknown> }[];
      morph(): { morphing: boolean; progress: number; weight: number; landed: number; samples: { at: number; writeMs: number; position: number; weight: number }[]; period: string | null };
      refreshTimings(): { period: string; fetchMs: number; applyMs: number }[];
    };
    /** Diagnostics only: the map itself, for the e2e specs to move (the compass spec turns it). */
    __closeKnitMap?: MapLibreMap;
    /** Diagnostics only: where the camera is and which click gestures zoom. */
    __closeKnitCamera?: () => { zoom: number; lng: number; lat: number; bearing: number; pitch: number; doubleClickZoom: boolean; boxZoom: boolean };
  }
}
