/**
 * The basemap in Day or Night (DESIGN.md › Map rules). The map stays a real map: we only recolour
 * the OpenFreeMap positron layers by type and id, never add textures. The app's own layers (area
 * fills, sales, places, match overlays) keep their data colours; the area names and the 3D
 * buildings are the two app layers that follow the theme. Every paint change tolerates missing
 * layers (the Playwright fixture style has almost none).
 */
import type { ExpressionSpecification, Map as MapLibreMap } from "maplibre-gl";

import { isAreaTileSource } from "./area-tiles";
import { AREA_LABEL_LAYER_IDS, areaLabelPaint } from "./map-area-labels";
import { isLandmarkLayer, LANDMARK_PALETTES, landmarkPaint } from "./map-landmarks";
import type { ResolvedTheme } from "./ui-themes";

export interface BasemapPalette {
  bg: string; water: string; waterLabel: string; park: string; building: string; road: string; major: string;
  casing: string; rail: string; label: string; halo: string; boundary: string;
}

export const BASEMAP_PALETTES: Record<ResolvedTheme, BasemapPalette> = {
  day: {
    bg: "#f4f7fa", water: LANDMARK_PALETTES.day.water, waterLabel: LANDMARK_PALETTES.day.waterLabel, park: LANDMARK_PALETTES.day.park, building: "#e5eaf1", road: "#ffffff", major: "#ffffff",
    casing: "#d9e0e9", rail: "#cdd5df", label: "#5b6270", halo: "#f4f7fa", boundary: "#cfd8e3",
  },
  night: {
    bg: "#16203a", water: LANDMARK_PALETTES.night.water, waterLabel: LANDMARK_PALETTES.night.waterLabel, park: LANDMARK_PALETTES.night.park, building: "#1d2944", road: "#27334f", major: "#34436a",
    casing: "#1b2540", rail: "#2c3858", label: "#a9b6cc", halo: "#16203a", boundary: "#2a3656",
  },
};

/** Sources the app adds itself: their layers carry data colours and are never recoloured. */
const APP_SOURCES = new Set([
  "area-buildings", "area-labels", "sales", "places", "properties",
  "match-brief-outlines", "match-brief-lines", "zone-draw",
  // The TfL network keeps each line's own colour (its ids say "transit", which would read as rail).
  "tfl-network",
]);
const BUILDING_EXTRUSION_LAYER = "neutral-3d-buildings";
/** 3D buildings are a light relief over the area colour: most of the colour shows through them. */
export const BUILDING_EXTRUSION_OPACITY = 0.4;

/**
 * How strongly each road class draws over the area colour, at these zooms (the map always shows a
 * data layer). Across the city only motorways and trunk roads, thin and translucent; primary roads join
 * by mid zoom; secondary and local streets stay a faint trace until street zoom, so they don't chop
 * the colour into confetti. Unlisted classes (paths) follow the last row.
 */
const ROAD_ZOOMS = [11, 13, 15, 16];
const ROAD_REVEAL: [classes: string[], opacity: number[]][] = [
  [["motorway"], [0.7, 0.9, 1, 1]],
  [["trunk"], [0.55, 0.85, 1, 1]],
  [["primary"], [0, 0.7, 0.85, 1]],
  [["secondary", "tertiary"], [0, 0.25, 0.5, 1]],
  [["minor", "service", "track"], [0, 0.12, 0.35, 0.9]],
  [["path"], [0, 0, 0.3, 0.9]],
];
/** Positron's road lines (motorway tunnels, bridges and every highway_* line). */
const isRoadLine = (type: string, id: string) => type === "line" && /^(highway_|tunnel_motorway_)/.test(id);

function roadOpacity(): ExpressionSpecification {
  const stops = ROAD_ZOOMS.flatMap((zoom, index) => {
    const rows = ROAD_REVEAL.slice(0, -1).flatMap(([classes, opacity]) => [classes, opacity[index]]);
    return [zoom, ["match", ["get", "class"], ...rows, ROAD_REVEAL[ROAD_REVEAL.length - 1][1][index]]];
  });
  return ["interpolate", ["linear"], ["zoom"], ...stops] as unknown as ExpressionSpecification;
}

type Role = keyof BasemapPalette;
const has = (id: string, words: readonly string[]) => words.some((word) => id.includes(word));

/** The palette role of a basemap layer's main colour, or null to leave it alone. */
export function basemapRole(type: string, id: string): Role | null {
  const key = id.toLowerCase();
  if (type === "background") return "bg";
  if (type === "fill") {
    if (has(key, ["water", "ocean", "lake"])) return "water";
    if (has(key, ["park", "wood", "grass", "landcover", "green", "cemetery"])) return "park";
    if (has(key, ["building"])) return "building";
    // Residential and other land use: the ground, so no light patches stay on a night map.
    return "bg";
  }
  if (type === "line") {
    if (has(key, ["water", "river", "canal"])) return "water";
    if (has(key, ["rail", "transit"])) return "rail";
    if (has(key, ["boundary", "admin"])) return "boundary";
    if (has(key, ["casing"])) return "casing";
    if (has(key, ["motorway", "trunk", "primary", "major"])) return "major";
    return "road";
  }
  return null;
}

/** Paint changes for one layer: [property, colour] pairs. */
export function basemapPaint(type: string, id: string, palette: BasemapPalette): [string, string][] {
  if (type === "symbol") {
    // Water names (the River Thames along its course) in the water's own blue.
    const text = has(id.toLowerCase(), ["water"]) ? palette.waterLabel : palette.label;
    return [["text-color", text], ["text-halo-color", palette.halo]];
  }
  const role = basemapRole(type, id);
  if (!role) return [];
  const colour = palette[role];
  if (type === "background") return [["background-color", colour]];
  if (type === "fill") return role === "building" ? [["fill-color", colour], ["fill-outline-color", palette.casing]] : [["fill-color", colour]];
  return [["line-color", colour]];
}

/** Positron's road-number shields: white sprite plates with dark text. */
const isRoadShield = (type: string, id: string) => type === "symbol" && id.includes("shield");

/**
 * The shields' plates are images, so they cannot be recoloured, and by Night they stood out
 * as bright white blocks on the navy map. Night fades them out (road names stay); Day shows them. Paint,
 * not visibility: a layout change would re-parse every basemap tile.
 */
export function shieldOpacity(theme: ResolvedTheme): number {
  return theme === "night" ? 0 : 1;
}

function set(map: MapLibreMap, id: string, property: string, value: unknown) {
  try {
    map.setPaintProperty(id, property as Parameters<MapLibreMap["setPaintProperty"]>[1], value as Parameters<MapLibreMap["setPaintProperty"]>[2]);
  } catch {
    // A layer or property this style doesn't have: nothing to recolour.
  }
}

export function applyBasemapTheme(map: MapLibreMap, theme: ResolvedTheme): void {
  const palette = BASEMAP_PALETTES[theme];
  let layers: { id: string; type: string; source?: unknown }[] = [];
  try {
    layers = map.getStyle()?.layers ?? [];
  } catch {
    return;
  }
  for (const layer of layers) {
    if ((typeof layer.source === "string" && (APP_SOURCES.has(layer.source) || isAreaTileSource(layer.source)))
      || isLandmarkLayer(layer.id)) continue;
    for (const [property, value] of basemapPaint(layer.type, layer.id, palette)) set(map, layer.id, property, value);
    if (isRoadLine(layer.type, layer.id)) set(map, layer.id, "line-opacity", roadOpacity());
    if (isRoadShield(layer.type, layer.id)) {
      set(map, layer.id, "icon-opacity", shieldOpacity(theme));
      set(map, layer.id, "text-opacity", shieldOpacity(theme));
    }
  }
  for (const [id, property, value] of landmarkPaint(theme)) if (map.getLayer(id)) set(map, id, property, value);
  if (map.getLayer(BUILDING_EXTRUSION_LAYER)) {
    set(map, BUILDING_EXTRUSION_LAYER, "fill-extrusion-color", palette.building);
    set(map, BUILDING_EXTRUSION_LAYER, "fill-extrusion-opacity", BUILDING_EXTRUSION_OPACITY);
  }
  for (const id of AREA_LABEL_LAYER_IDS) {
    if (!map.getLayer(id)) continue;
    for (const [property, value] of Object.entries(areaLabelPaint(theme))) set(map, id, property, String(value));
  }
}
