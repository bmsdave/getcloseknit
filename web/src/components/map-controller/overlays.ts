/**
 * The area map's Show overlays and their sources: sale pins, places, cycle lanes, schools, universities and road
 * collisions, each added the first time it is asked for and then shown or hidden.
 */
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";

import {
  COLLISION_HEAT_LAYER, COLLISION_HIT_LAYER, COLLISION_LAYERS, COLLISION_MARKER_LAYER, COLLISION_SOURCE_ID, DEFAULT_COLLISION_VIEW,
  addCollisionIcons, collisionHeatFilter, collisionHeatIntensity, collisionHeatWeight, collisionLayers, collisionPointFilter,
  collisionSource, type CollisionView,
} from "@/lib/map-collisions";
import { CYCLE_LAYERS, CYCLE_SOURCE_ID, cycleLayers, cycleSource } from "@/lib/map-cycle-lanes";
import { addPlaceIcons, PLACE_LAYER, PLACE_SOURCE_ID, placeFilter, placeLayers, placeSource, type PlaceView } from "@/lib/map-place-layers";
import {
  SALE_LAYER_IDS, SALE_PIN_LAYER, SALE_SQUARE_IMAGE, SALE_SOURCE_ID, saleColour, saleFilter, saleLayers, saleSource, saleSquareImage,
  type SaleView,
} from "@/lib/map-sale-layers";
import {
  SCHOOL_FOLD_LAYER, SCHOOL_LAYER, SCHOOL_LAYERS, SCHOOL_MIN_ZOOM, SCHOOL_SOURCE_ID, loadSchoolPoints, schoolFeatures, schoolFoldCount,
  schoolFoldLayer, schoolIcons, schoolLayer, schoolSource, type SchoolFilter,
} from "@/lib/map-school-layer";
import {
  UNIVERSITY_LAYERS, UNIVERSITY_SOURCE_ID, loadUniversityPoints, universityLayers, universityPointsPath, universitySource,
} from "@/lib/map-university-layer";
import { mapRelease, schoolPointsPath } from "@/lib/release-url";
import { addSchoolIcons, drawSchoolFold } from "@/lib/school-icons";
import { resolvedUiTheme } from "@/lib/ui-themes";

import type { MapController } from "./controller";
import { showSchoolPopup } from "./interactions";
import { applyAreaFade, firstSymbolLayer, syncHouseLayers } from "./paint";

export function applySaleView(controller: MapController, view: SaleView | null) {
  const { map } = controller;
  controller.saleView = view;
  if (view?.on) {
    if (!map.getSource(SALE_SOURCE_ID)) map.addSource(SALE_SOURCE_ID, saleSource(window.location.origin, mapRelease(map)));
    if (!map.getLayer(SALE_PIN_LAYER)) {
      // One rounded square tinted per sale (a house footprint, not a dot that reads as a collision or a tree).
      const ratio = window.devicePixelRatio || 1;
      const square = map.hasImage(SALE_SQUARE_IMAGE) ? null : saleSquareImage(ratio);
      if (square) map.addImage(SALE_SQUARE_IMAGE, square, { pixelRatio: Math.max(1, Math.ceil(ratio)), sdf: true });
      for (const layer of saleLayers(view, resolvedUiTheme())) map.addLayer(layer, firstSymbolLayer(map));
      orderPins(map);
    }
    for (const id of SALE_LAYER_IDS) map.setPaintProperty(id, "icon-color", saleColour(view));
    map.setFilter(SALE_PIN_LAYER, saleFilter(view.filters));
  }
  syncHouseLayers(controller);
}

// Place labels sit on top of every layer, basemap labels included, so a hovered place is never hidden.
export function applyPlaceView(controller: MapController, view: PlaceView) {
  const { map } = controller;
  if (!view.on && !map.getLayer(PLACE_LAYER)) return;
  if (!map.getSource(PLACE_SOURCE_ID)) map.addSource(PLACE_SOURCE_ID, placeSource(window.location.origin, mapRelease(map)));
  addPlaceIcons(map, window.devicePixelRatio || 1);
  if (!map.getLayer(PLACE_LAYER)) {
    for (const layer of placeLayers(view)) map.addLayer(layer);
  }
  map.setFilter(PLACE_LAYER, placeFilter(view.groups));
  map.setLayoutProperty(PLACE_LAYER, "visibility", view.on ? "visible" : "none");
  controller.placesOn = view.on && view.groups.length > 0;
  applyAreaFade(controller);
}

export function applyCycleLanes(map: MapLibreMap, on: boolean) {
  if (!on && !map.getLayer(CYCLE_LAYERS[0])) return;
  if (!map.getSource(CYCLE_SOURCE_ID)) map.addSource(CYCLE_SOURCE_ID, cycleSource(window.location.origin, mapRelease(map)));
  if (!map.getLayer(CYCLE_LAYERS[0])) for (const layer of cycleLayers()) map.addLayer(layer, firstSymbolLayer(map));
  for (const id of CYCLE_LAYERS) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
}

/**
 * Show › Schools: the points load once, when first asked for, into caps over the labels
 * (drawn for the combinations they use), every detail at every zoom; caps that would overlap fold into
 * the best of them with a "+N" beside it (a tap on it zooms in). The filters redraw the source. Hover
 * (a mouse) peeks at the school's popup; a click or tap opens its card in the sheet (registerPick).
 */
export function applySchools(controller: MapController, on: boolean, filter: SchoolFilter) {
  const { map } = controller;
  controller.latestSchools = { on, filter };
  if (!on) showSchoolPopup(controller, null);
  const loaded = controller.loadedSchools;
  if (map.getLayer(SCHOOL_LAYER) && loaded) {
    if (loaded.filter !== filter) {
      loaded.filter = filter;
      // Coloured by a measure, the caps are other images: drawn first, then the source (unless the filter moved on).
      void addSchoolIcons(map, schoolIcons(loaded.points, filter), window.devicePixelRatio || 1).then(() => {
        if (loaded.filter !== filter) return;
        (map.getSource(SCHOOL_SOURCE_ID) as GeoJSONSource | undefined)?.setData(schoolFeatures(loaded.points, filter));
        showSchoolPopup(controller, null);
      }).catch(() => undefined);
    }
    for (const id of SCHOOL_LAYERS) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    return;
  }
  if (!on || controller.schoolsLoading) return;
  controller.schoolsLoading = true;
  // The release is in the URL: the points are cached for an hour, and a new release must not wait that out.
  void loadSchoolPoints(schoolPointsPath(mapRelease(map)))
    .then(async (points) => {
      if (!points || map.getLayer(SCHOOL_LAYER)) return;
      const first = controller.latestSchools ?? { on: true, filter };
      await addSchoolIcons(map, schoolIcons(points, first.filter), window.devicePixelRatio || 1);
      if (map.getLayer(SCHOOL_LAYER)) return;
      const latest = controller.latestSchools ?? { on: true, filter };
      if (latest.filter !== first.filter) await addSchoolIcons(map, schoolIcons(points, latest.filter), window.devicePixelRatio || 1);
      if (map.getLayer(SCHOOL_LAYER)) return;
      registerSchoolFolds(map);
      map.addSource(SCHOOL_SOURCE_ID, schoolSource(points, latest.filter));
      controller.loadedSchools = { points, filter: latest.filter };
      // Over the labels and the road-collision bursts: placed first, so those give way to the caps.
      map.addLayer(schoolLayer());
      map.addLayer(schoolFoldLayer());
      orderPins(map);
      map.on("zoomend", () => { if (map.getZoom() < SCHOOL_MIN_ZOOM) showSchoolPopup(controller, null); });
      // Turned off while loading: keep the layers, hidden.
      if (!latest.on) for (const id of SCHOOL_LAYERS) map.setLayoutProperty(id, "visibility", "none");
    })
    .catch(() => undefined)
    .finally(() => { controller.schoolsLoading = false; });
}

/**
 * Student areas' universities and colleges (Layers v5 PR 3): loaded the first time the layer is chosen, under
 * the schools' caps, hidden again when another layer colours the map.
 */
export function applyUniversities(controller: MapController, on: boolean) {
  const { map } = controller;
  controller.universitiesOn = on;
  if (map.getLayer(UNIVERSITY_LAYERS[0])) {
    for (const id of UNIVERSITY_LAYERS) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    return;
  }
  if (!on || controller.universitiesLoading) return;
  controller.universitiesLoading = true;
  void loadUniversityPoints(universityPointsPath(mapRelease(map)))
    .then((points) => {
      if (!points || map.getLayer(UNIVERSITY_LAYERS[0])) return;
      if (!map.getSource(UNIVERSITY_SOURCE_ID)) map.addSource(UNIVERSITY_SOURCE_ID, universitySource(points));
      for (const layer of universityLayers()) map.addLayer(layer, underSchools(map));
      if (!controller.universitiesOn) for (const id of UNIVERSITY_LAYERS) map.setLayoutProperty(id, "visibility", "none");
    })
    .catch(() => undefined)
    .finally(() => { controller.universitiesLoading = false; });
}

/** "+N" bubbles are drawn when first asked for (any N), on a canvas, at once. */
function registerSchoolFolds(map: MapLibreMap) {
  map.on("styleimagemissing", (event: { id: string }) => {
    const count = schoolFoldCount(event.id);
    if (count === null || map.hasImage(event.id)) return;
    const ratio = Math.max(1, Math.ceil(window.devicePixelRatio || 1));
    const image = drawSchoolFold(count, ratio);
    if (image) map.addImage(event.id, image, { pixelRatio: ratio });
  });
}

/** Sale pins draw over the school caps, as they take the tap first (lib/map-pick.ts): right after the folds. */
function orderPins(map: MapLibreMap) {
  if (!map.getLayer(SALE_PIN_LAYER) || !map.getLayer(SCHOOL_FOLD_LAYER)) return;
  const ids = map.getStyle().layers.map((layer) => layer.id);
  const before = ids.slice(ids.indexOf(SCHOOL_FOLD_LAYER) + 1).find((id) => !(SALE_LAYER_IDS as readonly string[]).includes(id));
  for (const id of SALE_LAYER_IDS) map.moveLayer(id, before);
}

export function applyCollisions(controller: MapController, view: CollisionView | null) {
  const { map } = controller;
  controller.collisionView = view;
  if (!view && !map.getLayer(COLLISION_LAYERS[0])) return;
  if (view && COLLISION_LAYERS.some((id) => !map.getLayer(id))) {
    try {
      if (!map.getSource(COLLISION_SOURCE_ID)) map.addSource(COLLISION_SOURCE_ID, collisionSource(window.location.origin, mapRelease(map)));
      // The heat glows under the street names; the bursts sit over the labels, under the school caps
      // (placed after them, so they give way to the caps).
      for (const layer of collisionLayers(view)) {
        if (map.getLayer(layer.id)) continue;
        if (layer.id === COLLISION_MARKER_LAYER) addCollisionMarkers(controller);
        else map.addLayer(layer, layer.id === COLLISION_HEAT_LAYER ? firstSymbolLayer(map) : underSchools(map));
      }
    } catch {
      // The style is still loading (first paint, a theme switch): add the layers once it settles, with
      // whatever the viewer has chosen by then.
      map.once("idle", () => applyCollisions(controller, controller.collisionView));
      return;
    }
  }
  // Layers in place: filters and intensity change at once, without waiting for tiles to finish.
  if (view) {
    map.setFilter(COLLISION_HEAT_LAYER, collisionHeatFilter(view));
    map.setPaintProperty(COLLISION_HEAT_LAYER, "heatmap-weight", collisionHeatWeight(view));
    map.setPaintProperty(COLLISION_HEAT_LAYER, "heatmap-intensity", collisionHeatIntensity(view));
    for (const id of [COLLISION_HIT_LAYER, COLLISION_MARKER_LAYER]) if (map.getLayer(id)) map.setFilter(id, collisionPointFilter(view));
  }
  for (const id of COLLISION_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", view ? "visible" : "none");
  applyAreaFade(controller);
}

/** Just under the school caps when they are on the map, else at the top. */
function underSchools(map: MapLibreMap): string | undefined {
  return map.getLayer(SCHOOL_LAYER) ? SCHOOL_LAYER : undefined;
}

/** The bursts go in once their 12 pictures are drawn, with the filters chosen by then. */
function addCollisionMarkers(controller: MapController) {
  const { map } = controller;
  if (controller.collisionMarkersLoading) return;
  controller.collisionMarkersLoading = true;
  void addCollisionIcons(map, window.devicePixelRatio || 1)
    .then(() => {
      if (map.getLayer(COLLISION_MARKER_LAYER) || !map.getSource(COLLISION_SOURCE_ID)) return;
      const view = controller.collisionView;
      const layer = collisionLayers(view ?? DEFAULT_COLLISION_VIEW).find((candidate) => candidate.id === COLLISION_MARKER_LAYER);
      if (!layer) return;
      map.addLayer(layer, underSchools(map));
      if (!view) map.setLayoutProperty(COLLISION_MARKER_LAYER, "visibility", "none");
    })
    .catch(() => undefined)
    .finally(() => { controller.collisionMarkersLoading = false; });
}
