/**
 * Street trees, Green streets and Canopy on the map (lib/map-street-trees.ts): adds the sources and layers once,
 * shows or hides them and repaints them for the theme. A hover peeks at a tree or a street in the map tooltip
 * and a tap opens its card (map-controller/interactions.ts registerPick); the trees' heat takes no tap: the area under it does
 * (no more zoom-in bubbles).
 */
import type { Map as MapLibreMap } from "maplibre-gl";

import {
  CANOPY_LAYER, CANOPY_SOURCE_ID, GREEN_STREET_BAND_LAYER, GREEN_STREET_LAYER, GREEN_STREET_LAYERS, GREEN_STREET_SOURCE_ID, STREET_TREE_PALETTES, TILE_MAX_ZOOM,
  TREE_HEAT_LAYER, TREE_POINT_LAYER, TREE_PREFETCH_ZOOM, TREE_SOURCE_ID, greenStreetColour, greenStreetLayers,
  greenStreetSource, tilesCovering, treeLayers, treeSource, canopyLayer, canopySource,
} from "@/lib/map-street-trees";
import { COLLISION_LAYERS } from "@/lib/map-collisions";
import { CYCLE_LAYERS } from "@/lib/map-cycle-lanes";
import { mapRelease } from "@/lib/release-url";
import { resolvedUiTheme } from "@/lib/ui-themes";

import "../styles/street-trees.css";

// Show's other heat and lines: the trees' heat goes under them all (V4-03 board), whichever came first.
const OVER_TREE_HEAT: readonly string[] = [...COLLISION_LAYERS, ...CYCLE_LAYERS];

const prefetching = new WeakSet<MapLibreMap>();
// Tree tile URLs fetched ahead for this map (the browser's cache holds them; the API ignores the extra fetch).
const prefetched = new WeakMap<MapLibreMap, Set<string>>();
const PREFETCH_MEMORY = 400;

/**
 * Street trees (Show): a heat from zoom 12 to 15.5, a dot per tree from 15. `heat` false hides the heat but
 * keeps the dots: with Green cover as the layer the heat would repeat the cover.
 */
export function applyStreetTrees(map: MapLibreMap, on: boolean, before: string | undefined, heat = true) {
  if (!on && !map.getLayer(TREE_POINT_LAYER)) return;
  if (!map.getSource(TREE_SOURCE_ID)) map.addSource(TREE_SOURCE_ID, treeSource(window.location.origin, mapRelease(map)));
  if (!map.getLayer(TREE_POINT_LAYER)) {
    const [heatLayer, pointLayer] = treeLayers(STREET_TREE_PALETTES[resolvedUiTheme()]);
    const over = map.getStyle().layers.find((layer) => OVER_TREE_HEAT.includes(layer.id))?.id;
    map.addLayer(heatLayer, over ?? before);
    map.addLayer(pointLayer, before);
  }
  map.setLayoutProperty(TREE_HEAT_LAYER, "visibility", on && heat ? "visible" : "none");
  map.setLayoutProperty(TREE_POINT_LAYER, "visibility", on ? "visible" : "none");
  if (!prefetching.has(map)) {
    prefetching.add(map);
    map.on("moveend", () => prefetchTreeTiles(map));
  }
  if (on) prefetchTreeTiles(map);
}

/**
 * The dots' tiles (zoom 15, the first to hold single trees) for the view, fetched from zoom 14.5 while the
 * heat still shows, so they sit in the browser's cache when the map asks for them half a zoom later: the
 * dots then draw at once instead of after a round trip. Nothing at other zooms, and each tile once.
 */
export function prefetchTreeTiles(map: MapLibreMap): string[] {
  const zoom = map.getZoom();
  if (zoom < TREE_PREFETCH_ZOOM || zoom >= TILE_MAX_ZOOM || !map.getLayer(TREE_POINT_LAYER)
    || map.getLayoutProperty(TREE_POINT_LAYER, "visibility") === "none") return [];
  // The source's own template (it reads its tile list a tick after it is added, too late for this call).
  const template = treeSource(window.location.origin, mapRelease(map)).tiles?.[0];
  if (!template) return [];
  const bounds = map.getBounds();
  let done = prefetched.get(map);
  if (!done || done.size > PREFETCH_MEMORY) prefetched.set(map, done = new Set());
  const urls: string[] = [];
  for (const tile of tilesCovering([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()], TILE_MAX_ZOOM)) {
    const url = template.replace("{z}", String(tile.z)).replace("{x}", String(tile.x)).replace("{y}", String(tile.y));
    if (done.has(url)) continue;
    done.add(url);
    urls.push(url);
    fetch(url, { priority: "low" } as RequestInit).catch(() => undefined);
  }
  return urls;
}

/**
 * Green streets (Layers › Nature): every road link by its street trees, from zoom 13. Trees draw over them.
 * The band of homes along each street goes under `bandBefore` (the basemap's roads, where the area fill sits),
 * so homes, sales and every pin draw over it; the line stays under the trees, over the pins' streets.
 */
export function applyGreenStreets(map: MapLibreMap, on: boolean, before: string | undefined, bandBefore = before) {
  if (!on && !map.getLayer(GREEN_STREET_LAYER)) return;
  if (!map.getSource(GREEN_STREET_SOURCE_ID)) map.addSource(GREEN_STREET_SOURCE_ID, greenStreetSource(window.location.origin, mapRelease(map)));
  if (!map.getLayer(GREEN_STREET_LAYER)) {
    const under = map.getLayer(TREE_HEAT_LAYER) ? TREE_HEAT_LAYER : before;
    for (const layer of greenStreetLayers(STREET_TREE_PALETTES[resolvedUiTheme()])) {
      map.addLayer(layer, layer.id === GREEN_STREET_BAND_LAYER ? bandBefore : under);
    }
  }
  for (const id of GREEN_STREET_LAYERS) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
}

/** Canopy (Layers › Nature › Green & trees › Green cover): from the satellite at every zoom (8+), under the streets and trees. */
export function applyCanopy(map: MapLibreMap, on: boolean, before: string | undefined) {
  if (!on && !map.getLayer(CANOPY_LAYER)) return;
  if (!map.getSource(CANOPY_SOURCE_ID)) map.addSource(CANOPY_SOURCE_ID, canopySource(window.location.origin, mapRelease(map)));
  if (!map.getLayer(CANOPY_LAYER)) {
    const under = [GREEN_STREET_LAYER, TREE_HEAT_LAYER].find((id) => map.getLayer(id)) ?? before;
    map.addLayer(canopyLayer(resolvedUiTheme()), under);
  }
  map.setLayoutProperty(CANOPY_LAYER, "visibility", on ? "visible" : "none");
}

/** Day or night colours for whichever of them is on the map. */
export function restyleStreetTrees(map: MapLibreMap) {
  const palette = STREET_TREE_PALETTES[resolvedUiTheme()];
  if (map.getLayer(CANOPY_LAYER)) {
    for (const [name, value] of Object.entries(canopyLayer(resolvedUiTheme()).paint ?? {})) {
      map.setPaintProperty(CANOPY_LAYER, name as "raster-opacity", value as never);
    }
  }
  if (map.getLayer(GREEN_STREET_BAND_LAYER)) map.setPaintProperty(GREEN_STREET_BAND_LAYER, "fill-color", greenStreetColour(palette));
  if (map.getLayer(GREEN_STREET_LAYER)) map.setPaintProperty(GREEN_STREET_LAYER, "line-color", greenStreetColour(palette));
  if (!map.getLayer(TREE_POINT_LAYER)) return;
  for (const layer of treeLayers(palette)) {
    for (const [name, value] of Object.entries(layer.paint ?? {})) map.setPaintProperty(layer.id, name as "circle-color", value as never);
  }
}

