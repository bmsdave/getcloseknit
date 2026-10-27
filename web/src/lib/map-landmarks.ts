/**
 * Landmarks to find your way by eye (DESIGN.md › Map): water and green space, recoloured from the
 * basemap's own OpenMapTiles layers, never textured. Both sit twice in the stack:
 * - under the area colour, as the basemap's ground (the positron water, wood and these greens);
 * - over it, as a veil in the same colour: water nearly opaque (no one lives on the Thames), parks
 *   soft, so the area's colour still reads through a park and the data keeps first place.
 * Water gets a slightly darker edge and canals a line from mid zooms; the big parks are named from
 * public/park-labels.json (scripts/park-labels.mjs), the river by the basemap's own water labels.
 */
import type {
  ExpressionSpecification, FillLayerSpecification, FilterSpecification, GeoJSONSourceSpecification, LineLayerSpecification, SymbolLayerSpecification,
} from "maplibre-gl";

import type { ResolvedTheme } from "./ui-themes";

export interface LandmarkPalette {
  water: string; waterEdge: string; waterLabel: string;
  park: string; parkEdge: string; parkLabel: string; halo: string;
  /** How strongly the veils lie over the area colour. */
  parkVeil: number; waterVeil: number;
}

/** A calm blue and a clean, fresh green (never olive or pine), on snow by day and navy by night. */
export const LANDMARK_PALETTES: Record<ResolvedTheme, LandmarkPalette> = {
  day: {
    water: "#bcdcf2", waterEdge: "#8fc1e5", waterLabel: "#2a679c",
    park: "#c4e7ce", parkEdge: "#9bd2ab", parkLabel: "#2a7148", halo: "#f4f7fa",
    parkVeil: 0.42, waterVeil: 0.9,
  },
  // By Night a strong dark-green veil over a warm area colour read as muddy brown. The veil is
  // lighter and its edge a fresher green, so the area colour stays clean.
  night: {
    water: "#13355f", waterEdge: "#285b8f", waterLabel: "#8cc4ee",
    park: "#1d4645", parkEdge: "#3f8f78", parkLabel: "#8fdcb2", halo: "#16203a",
    parkVeil: 0.3, waterVeil: 0.9,
  },
};

export const LANDMARK_SOURCE = "openmaptiles";
export const PARK_LABEL_SOURCE = "ck-park-labels";
export const GREEN_GROUND_LAYER = "ck-green-ground";
export const GREEN_VEIL_LAYER = "ck-green-veil";
export const GREEN_EDGE_LAYER = "ck-green-edge";
export const WATER_VEIL_LAYER = "ck-water-veil";
export const WATERWAY_LAYER = "ck-waterway";
export const WATER_EDGE_LAYER = "ck-water-edge";
export const PARK_LABEL_LAYER = "ck-park-labels";
/** Every landmark layer; the basemap theme leaves these to landmarkPaint. */
export const LANDMARK_LAYER_IDS = [
  GREEN_GROUND_LAYER, GREEN_VEIL_LAYER, GREEN_EDGE_LAYER, WATER_VEIL_LAYER, WATERWAY_LAYER, WATER_EDGE_LAYER, PARK_LABEL_LAYER,
] as const;
/** The positron layer that would paint protected areas (conservation areas, a World Heritage Site) green. */
const POSITRON_PROTECTED_AREAS = "park";

const polygon: ExpressionSpecification = ["match", ["geometry-type"], ["Polygon", "MultiPolygon"], true, false];
/** Parks, commons, heaths, gardens, cemeteries, woods and nature reserves. */
const greenFilters: { sourceLayer: string; filter: FilterSpecification }[] = [
  { sourceLayer: "landcover", filter: ["all", polygon, ["match", ["get", "class"], ["grass", "wood", "wetland"], true, false]] },
  { sourceLayer: "landuse", filter: ["all", polygon, ["match", ["get", "class"], ["cemetery"], true, false]] },
  { sourceLayer: "park", filter: ["all", polygon, ["match", ["get", "class"], ["nature_reserve", "national_park"], true, false]] },
];
/** The first veil: the area colour goes in under it. */
export const GREEN_VEIL_LAYER_FIRST = `${GREEN_VEIL_LAYER}-${greenFilters[0].sourceLayer}`;
const waterFilter: FilterSpecification = ["all", polygon, ["!=", ["get", "brunnel"], "tunnel"]];
const zoomed = (...stops: number[]): ExpressionSpecification => ["interpolate", ["linear"], ["zoom"], ...stops] as unknown as ExpressionSpecification;

export function parkLabelSource(origin: string): GeoJSONSourceSpecification {
  return { type: "geojson", data: `${origin}/park-labels.json`, attribution: "© OpenStreetMap contributors" };
}

/** Green space under the area colour (its own ids per source layer: a layer reads one source layer). */
function greenLayers(id: string, palette: LandmarkPalette, opacity: number): FillLayerSpecification[] {
  return greenFilters.map(({ sourceLayer, filter }) => ({
    id: `${id}-${sourceLayer}`, type: "fill", source: LANDMARK_SOURCE, "source-layer": sourceLayer, filter,
    paint: { "fill-color": palette.park, "fill-opacity": opacity },
  }));
}

/** The layers that go under the area colour (the ground's greens). */
export function landmarkGroundLayers(theme: ResolvedTheme): FillLayerSpecification[] {
  return greenLayers(GREEN_GROUND_LAYER, LANDMARK_PALETTES[theme], 1);
}

/** The layers that go over the area colour and under the streets: veils, canals and edges. */
export function landmarkVeilLayers(theme: ResolvedTheme): (FillLayerSpecification | LineLayerSpecification)[] {
  const p = LANDMARK_PALETTES[theme];
  return [
    ...greenLayers(GREEN_VEIL_LAYER, p, p.parkVeil),
    { id: GREEN_EDGE_LAYER, type: "line", source: LANDMARK_SOURCE, "source-layer": "landcover", minzoom: 13,
      filter: ["all", polygon, ["match", ["get", "class"], ["grass", "wood"], true, false]],
      paint: { "line-color": p.parkEdge, "line-width": zoomed(13, 0.5, 16, 1.2), "line-opacity": zoomed(13, 0, 14, 0.8) } },
    { id: WATER_VEIL_LAYER, type: "fill", source: LANDMARK_SOURCE, "source-layer": "water", filter: waterFilter,
      paint: { "fill-color": p.water, "fill-opacity": p.waterVeil } },
    { id: WATERWAY_LAYER, type: "line", source: LANDMARK_SOURCE, "source-layer": "waterway", minzoom: 11,
      filter: ["all", ["match", ["get", "class"], ["canal", "river", "stream"], true, false], ["!=", ["get", "brunnel"], "tunnel"]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": p.waterEdge,
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, ["match", ["get", "class"], "stream", 0.4, 0.8], 16, ["match", ["get", "class"], "stream", 1.2, 3]],
        "line-opacity": zoomed(11, 0.5, 13, 0.9),
      } },
    { id: WATER_EDGE_LAYER, type: "line", source: LANDMARK_SOURCE, "source-layer": "water", minzoom: 12, filter: waterFilter,
      paint: { "line-color": p.waterEdge, "line-width": zoomed(12, 0.5, 16, 1.4), "line-opacity": zoomed(12, 0, 13, 1) } },
  ];
}

/** Big parks' names, from the opening zoom for the six landmark parks, by size after that. */
export function parkLabelLayer(theme: ResolvedTheme): SymbolLayerSpecification {
  const p = LANDMARK_PALETTES[theme];
  const from = (zoom: number) => ["case", ["<=", ["get", "minzoom"], zoom], ["get", "name"], ""];
  return {
    id: PARK_LABEL_LAYER, type: "symbol", source: PARK_LABEL_SOURCE, minzoom: 11,
    layout: {
      "symbol-sort-key": ["get", "rank"],
      "text-field": ["step", ["zoom"], from(11), 12, from(12), 13, ["get", "name"]] as unknown as ExpressionSpecification,
      "text-font": ["Noto Sans Italic"],
      "text-size": zoomed(11, 10.5, 13, 12, 16, 14),
      "text-letter-spacing": 0.04,
      "text-max-width": 7,
      "text-padding": 6,
    },
    paint: { "text-color": p.parkLabel, "text-halo-color": p.halo, "text-halo-width": 1.6, "text-opacity": zoomed(11, 0.85, 13, 1) },
  };
}

type LandmarkMap = {
  getSource(id: string): unknown; getLayer(id: string): unknown;
  addSource(id: string, source: GeoJSONSourceSpecification): void;
  addLayer(layer: FillLayerSpecification | LineLayerSpecification | SymbolLayerSpecification, before?: string): void;
  setLayoutProperty(layer: string, property: string, value: unknown): void;
};

/** Basemap street layers (OpenFreeMap / OpenMapTiles ids), lowest first. */
export const STREET_LAYERS = ["tunnel_motorway_casing", "highway_path", "highway_minor"];

/**
 * Where the veils go in, and so the area colour under them: under the basemap's first street layer,
 * over its buildings. Under opaque buildings the colour showed only in courtyards at street zoom.
 */
export function veilAnchor(hasLayer: (id: string) => boolean): string | undefined {
  return STREET_LAYERS.find(hasLayer);
}

/**
 * Adds the landmarks once, with the style: greens under `groundBefore` (the basemap's water), veils
 * under `veilBefore` (its streets, see `veilAnchor`; the area colour then goes under the first veil), park names
 * under `labelBefore`. A style without the basemap's vector source (the test fixture) is left alone.
 * `parkLabelsLater`: the park names' source starts empty; the map sets its data once London is in view (the names
 * are London's, and the England map may open elsewhere).
 */
export function ensureLandmarks(map: LandmarkMap, origin: string, theme: ResolvedTheme, before: { ground?: string; veil?: string; label?: string },
  options: { parkLabelsLater?: boolean } = {}): void {
  if (!map.getSource(LANDMARK_SOURCE) || map.getLayer(GREEN_VEIL_LAYER_FIRST)) return;
  if (map.getLayer(POSITRON_PROTECTED_AREAS)) map.setLayoutProperty(POSITRON_PROTECTED_AREAS, "visibility", "none");
  for (const layer of landmarkGroundLayers(theme)) map.addLayer(layer, before.ground);
  for (const layer of landmarkVeilLayers(theme)) map.addLayer(layer, before.veil);
  if (!map.getSource(PARK_LABEL_SOURCE)) {
    const source = parkLabelSource(origin);
    map.addSource(PARK_LABEL_SOURCE, options.parkLabelsLater ? { ...source, data: { type: "FeatureCollection", features: [] } } : source);
  }
  map.addLayer(parkLabelLayer(theme), before.label);
}

/** Every landmark layer's paint for a theme, for re-applying when the theme changes. */
export function landmarkPaint(theme: ResolvedTheme): [layer: string, property: string, value: unknown][] {
  const layers = [...landmarkGroundLayers(theme), ...landmarkVeilLayers(theme), parkLabelLayer(theme)];
  return layers.flatMap((layer) => Object.entries(layer.paint ?? {}).map(([property, value]) => [layer.id, property, value] as [string, string, unknown]));
}

/** Whether a layer id is one of the landmark layers (the basemap theme leaves those alone). */
export function isLandmarkLayer(id: string): boolean {
  return LANDMARK_LAYER_IDS.some((prefix) => id === prefix || id.startsWith(`${prefix}-`));
}
