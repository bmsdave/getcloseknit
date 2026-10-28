/**
 * Everything the area map remembers about one MapLibre map, owned in one place (review #22: it was 53 module-level
 * WeakMaps and WeakSets keyed by the map). area-map.tsx makes one with the map and hands it to the modules beside
 * this file: data (sources and packs), paint, scale, camera, overlays, interactions, refresh and diagnostics.
 */
import type { ExpressionSpecification, Map as MapLibreMap } from "maplibre-gl";

import type { Carrier, GeographyId, MapDefinition } from "@/lib/contracts";
import type { AreaBoxes } from "@/lib/area-boxes";
import type { CollisionView } from "@/lib/map-collisions";
import type { MapCoverage } from "@/lib/map-coverage";
import type { Morph } from "@/lib/map-morph";
import type { MapCard } from "@/lib/map-pick";
import type { HoverTarget } from "@/lib/map-property-layers";
import type { SaleView } from "@/lib/map-sale-layers";
import type { SchoolFilter, SchoolPoint } from "@/lib/map-school-layer";
import type { ScaleAnchor } from "@/lib/view-scale";
import type { SchoolPopupOpen } from "../school/school-map-popup";

import type { AnalyticsView, LastPaint, MapCallbacks, MorphSample } from "./types";

export interface MapController {
  readonly map: MapLibreMap;
  /** The parent's latest handlers. */
  callbacks: MapCallbacks;
  /** A tapped object's card for the sheet; null without a sheet. */
  onPick: ((card: MapCard | null) => void) | null;

  // ---- Data and sources (data.ts) ----
  /** The map's coverage (lib/map-coverage.ts): null until /api/v1/map/coverage answers. */
  coverage: MapCoverage | null;
  fetchController: AbortController | null;
  baseFetchController: AbortController | null;
  /** The last value pack request failed (not aborted): the map has no colours to show. */
  packFailed: boolean;
  /** The basemap style has loaded at least once: a later error is never "Base map didn't load". */
  styleLoaded: boolean;
  /** A basemap failure toast is up (or was shown): one at a time. */
  basemapToast: boolean;

  // ---- Paint (paint.ts) ----
  morph: Morph<AnalyticsView> | null;
  /** The colour expression the fills show now. */
  shownColour: ExpressionSpecification | null;
  /** Diagnostics only: one sample per morph frame, oldest first; null until diagnostics are on. */
  morphSamples: MorphSample[] | null;
  selectedArea: GeographyId | null;
  /** Each tiled area's feature-state as written (merged), so an area left with nothing loses its state. */
  tileStates: Map<string, Record<string, unknown>>;
  /** The kind of area the fill paints (lib/area-tiles.ts); null before the first paint. */
  drawnKind: Carrier | null;
  /** Change scale: each area's percent as written to its feature-state (the trend arrows). */
  arrowValues: Map<string, number | null>;
  /** The change scale is painted: parcels give way to the area colours and the arrows show. */
  changeScale: boolean;
  /** Layers › None: no area colours, no parcels, no trend arrows; overlays (Show) stay. */
  plain: boolean;
  /** A place comparison's translucent fill; null before the first paint. */
  translucentFill: boolean | null;
  /** Green streets and Canopy draw finer than areas: the areas stay, clear, so a tap still opens one. */
  areaFillHidden: boolean;
  propertyMetric: MapDefinition | null;
  /** The metric's unit, for the house tooltips. */
  hoverUnit: string | undefined;
  selectedParcel: string | null;
  /** Diagnostics only: geometry handed to the fill (a new set of boxes). */
  geometryUpdates: number;

  // ---- Scale (scale.ts) ----
  /** The last paint's areas, each one's box (lib/area-boxes.ts). */
  paintedBoxes: AreaBoxes | null;
  /** The view the rank scale was taken from (lib/view-scale.ts needsRescale). */
  scaleAnchor: ScaleAnchor | null;
  lastPaint: LastPaint | null;
  /** Diagnostics only: per refresh, ms to get the pack and ms to resolve and paint it. */
  refreshTimings: { period: string; fetchMs: number; applyMs: number }[];

  // ---- Show overlays (overlays.ts) ----
  saleView: SaleView | null;
  placesOn: boolean;
  collisionView: CollisionView | null;
  collisionMarkersLoading: boolean;
  schoolsLoading: boolean;
  loadedSchools: { points: SchoolPoint[]; filter: SchoolFilter } | null;
  latestSchools: { on: boolean; filter: SchoolFilter } | null;
  universitiesOn: boolean;
  universitiesLoading: boolean;

  // ---- Interactions (interactions.ts) ----
  /** The one school popup (a hover's peek or a keyboard stop's); null until the component mounts it. */
  schoolPopup: { show: (open: SchoolPopupOpen | null) => void; open: SchoolPopupOpen | null } | null;
  /** The home pin ([lng, lat]) for a school card's distance; null without one. */
  homePin: [number, number] | null;
  hovered: HoverTarget | null;
  areaTooltip: ((geographyId: string) => string[]) | null;
  /** The same for a ready-made criterion's MSOAs while the map paints them (refreshAnalytics). */
  rolledTooltip: ((geographyId: string) => string[]) | null;

  // ---- Camera (camera.ts) ----
  /** An area to fit once its box is known: on first load the zoomTo request arrives before any area's box. */
  pendingFit: GeographyId | null;
  /** The zoom the pending fit lands at (a link's ?z=); null fits the area's whole box. */
  fitZoom: number | null;
  /** An area to fit that the loaded pieces did not hold, while its box is asked for. */
  distantFit: GeographyId | null;
  /** The wider area (district, borough) fitted for this selection: it never refits. */
  fittedWiderArea: GeographyId | null;
}

/** The controller of each live map, for the callers outside the component that hold only the map (the Esc ladder). */
const controllers = new WeakMap<MapLibreMap, MapController>();

export function createMapController(map: MapLibreMap, callbacks: MapCallbacks): MapController {
  const controller: MapController = {
    map, callbacks, onPick: null,
    coverage: null, fetchController: null, baseFetchController: null, packFailed: false, styleLoaded: false, basemapToast: false,
    morph: null, shownColour: null, morphSamples: null, selectedArea: null, tileStates: new Map(), drawnKind: null,
    arrowValues: new Map(), changeScale: false, plain: false, translucentFill: null, areaFillHidden: false,
    propertyMetric: null, hoverUnit: undefined, selectedParcel: null, geometryUpdates: 0,
    paintedBoxes: null, scaleAnchor: null, lastPaint: null, refreshTimings: [],
    saleView: null, placesOn: false, collisionView: null, collisionMarkersLoading: false, schoolsLoading: false,
    loadedSchools: null, latestSchools: null, universitiesOn: false, universitiesLoading: false,
    schoolPopup: null, homePin: null, hovered: null, areaTooltip: null, rolledTooltip: null,
    pendingFit: null, fitZoom: null, distantFit: null, fittedWiderArea: null,
  };
  controllers.set(map, controller);
  return controller;
}

/** The controller of a map this module made, or undefined (a map from elsewhere, or one already removed). */
export function controllerOf(map: MapLibreMap): MapController | undefined {
  return controllers.get(map);
}

/** Stops the controller's running work and forgets the map. */
export function disposeMapController(controller: MapController) {
  controller.morph?.dispose();
  controllers.delete(controller.map);
}
