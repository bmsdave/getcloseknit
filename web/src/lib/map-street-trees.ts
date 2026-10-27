/**
 * Street trees (Show) and Green streets (Layers › Nature), migration 066.
 *
 * Street trees: the GLA list of council, TfL and Royal Parks trees (GET /api/v1/tiles/street-trees). From
 * zoom 12 a soft green heat of how many trees stand nearby (no numbers), fading out by zoom 15.5
 * as one leaf-green dot per tree fades in from 15, the zoom whose tiles first hold single trees (no gap where
 * neither shows), as wide as its canopy where the owner recorded one and a small hollow dot where no size
 * is recorded. Tap or hover a dot: its kind, size, age and owner. Private gardens and parks are not in the
 * list. From zoom 14.5 the zoom-15 tiles in view are fetched ahead (components/street-trees-map.ts), so
 * the dots are drawn the moment the map reaches them.
 *
 * Green streets: OS Open Roads links from zoom 13 (GET /api/v1/tiles/green-streets), grey where no street
 * tree stands within 20 m to deep green at 12 or more trees per 100 m. The areas of Green & trees stay
 * underneath, clear. Tap or hover a street: its trees per 100 m and the share of its kerbs under canopy.
 * From zoom 14.5 a band 35 m each side of every street with trees (`green_street_bands` in the same tiles,
 * migration 102), in the street's green at 20 %, shades the homes along it, under the basemap's roads and
 * every pin; the line stays on top as its spine (Trees-green-streets board, Option 1). Taps on the band go
 * to the area underneath, as before.
 *
 * Canopy (Green & trees › Green cover): green cover seen from Sentinel-2 in summer 2025 (GET
 * /api/v1/tiles/canopy, PNG, zoom 8-14 and stretched further in): every 10 m cell with NDVI 0.4 or more in
 * four shades of leaf green, trees, gardens (private ones too), grass and parks alike; zoomed out (8-10) each
 * pixel's share of green in the same shades, so it shows at every zoom.
 *
 * Pure definitions (paint, filters, words) so they are unit-tested; components/street-trees-map.ts adds
 * them to the map.
 */
import type { ExpressionSpecification, LayerSpecification, RasterSourceSpecification, VectorSourceSpecification } from "maplibre-gl";

import type { ResolvedTheme } from "./ui-themes";
import { withRelease } from "./release-url";

/** Greater London's box (lib/map-coverage.ts LONDON_BBOX): the trees, streets and canopy mosaic are London's. */
const LONDON_TILE_BOUNDS: [number, number, number, number] = [-0.52, 51.28, 0.34, 51.7];

export const TREE_SOURCE_ID = "street-trees";
export const TREE_HEAT_LAYER = "street-tree-heat";
export const TREE_POINT_LAYER = "street-tree-point";
export const TREE_LAYERS = [TREE_HEAT_LAYER, TREE_POINT_LAYER] as const;
/** The tiles start here (counts per cell for the heat; api/area_api/street_trees.py). */
export const TREE_MIN_ZOOM = 12;
/** The dots fade in from here, where the tiles hold single trees; the heat is gone by TREE_DOT_ZOOM (owner decision). */
export const TREE_POINT_ZOOM = 15;
export const TREE_DOT_ZOOM = 15.5;
/** From here the zoom-15 tiles in view are fetched ahead of the dots. */
export const TREE_PREFETCH_ZOOM = 14.5;

export const GREEN_STREET_SOURCE_ID = "green-streets";
export const GREEN_STREET_LAYER = "green-street-line";
export const GREEN_STREET_BAND_LAYER = "green-street-band";
export const GREEN_STREET_LAYERS = [GREEN_STREET_BAND_LAYER, GREEN_STREET_LAYER] as const;
export const GREEN_STREET_MIN_ZOOM = 13;
/** The band fades in from here (full by TREE_DOT_ZOOM, as the trees' heat fades out): further out the lines alone stay legible. */
export const GREEN_STREET_BAND_ZOOM = 14.5;
export const GREEN_STREET_BAND_OPACITY = 0.2;
// From zoom 15 a tile holds every tree and every link in it: the map overzooms it.
export const TILE_MAX_ZOOM = 15;

export const TREE_ATTRIBUTION = "Street trees: GLA public realm trees, Nov 2025 (Open Government Licence v3.0)";
export const GREEN_STREET_ATTRIBUTION = "Green streets: contains OS data © Crown copyright and database right 2026; GLA street trees (OGL v3.0)";

/** Trees per 100 m: no tree, then six greens; a class starts at its break. */
export const GREEN_STREET_BREAKS = [0, 2, 4, 6, 8, 12] as const;
export const GREEN_STREET_TOP = `${GREEN_STREET_BREAKS.at(-1)}+`;

export interface StreetTreePalette {
  /** No street tree on the link. */
  bare: string;
  /** Low to high, one per break. */
  greens: readonly string[];
  /** Tree dots. */
  leaf: string;
  /** The dot's ring and a hollow dot's middle: the ground of the map. */
  halo: string;
}

// Fresh greens on snow by day, brighter on navy by night (DESIGN.md: never olive or pine).
export const STREET_TREE_PALETTES: Record<ResolvedTheme, StreetTreePalette> = {
  day: {
    bare: "#c8d0da",
    greens: ["#c9e8dc", "#a3d6c3", "#78c0a6", "#4fa78a", "#2f8f73", "#1f6e58"],
    leaf: "#2f8f73", halo: "#ffffff",
  },
  night: {
    bare: "#4a5878",
    greens: ["#2c6a5f", "#2f8270", "#3f9c80", "#5cb896", "#86d3ad", "#b4ecc9"],
    leaf: "#5cb896", halo: "#16203a",
  },
};

export function treeSource(origin: string, release?: string | null): VectorSourceSpecification {
  return {
    type: "vector",
    tiles: [withRelease(`${origin}/api/v1/tiles/street-trees/{z}/{x}/{y}.pbf`, release)],
    minzoom: TREE_MIN_ZOOM,
    // The GLA street trees are London's: no tile requests for the rest of England (CLOSE_KNIT_ENGLAND).
    bounds: LONDON_TILE_BOUNDS,
    maxzoom: TILE_MAX_ZOOM,
    attribution: TREE_ATTRIBUTION,
  };
}

export function greenStreetSource(origin: string, release?: string | null): VectorSourceSpecification {
  return {
    type: "vector",
    tiles: [withRelease(`${origin}/api/v1/tiles/green-streets/{z}/{x}/{y}.pbf`, release)],
    minzoom: GREEN_STREET_MIN_ZOOM,
    bounds: LONDON_TILE_BOUNDS,
    maxzoom: TILE_MAX_ZOOM,
    attribution: GREEN_STREET_ATTRIBUTION,
  };
}

/** A street's colour from its trees per 100 m. */
export function greenStreetColour(palette: StreetTreePalette): ExpressionSpecification {
  const steps = GREEN_STREET_BREAKS.flatMap((limit, index) => [index === 0 ? 0.05 : limit, palette.greens[index]]);
  return ["step", ["coalesce", ["get", "per_100m"], 0], palette.bare, ...steps] as ExpressionSpecification;
}

const known: ExpressionSpecification = [">", ["coalesce", ["get", "canopy_m"], 0], 0];

/**
 * A tree's dot radius in px: its canopy's own radius at street zoom (0.37 m a pixel at zoom 18 in London),
 * never under 2.5 px; a small fixed dot where no canopy is recorded.
 */
export function treeRadius(): ExpressionSpecification {
  const canopy = ["coalesce", ["get", "canopy_m"], 0];
  const at = (zoom: number, floor: number) => ["case", known, ["max", floor, ["/", ["/", canopy, 2], 0.373 * 2 ** (18 - zoom)]], floor];
  return ["interpolate", ["exponential", 2], ["zoom"], 15, at(15, 2.5), 18, at(18, 4), 20, at(20, 6)] as unknown as ExpressionSpecification;
}

/** "#1f6e58" → "rgba(31, 110, 88, 0)": the heat's clear end in its first green (no grey fringe). */
function clear(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  return `rgba(${r}, ${g}, ${b}, 0)`;
}

/** The heat's colours from fewer to more trees: the six street greens (by night they brighten on navy). */
export function treeHeatRamp(palette: StreetTreePalette): string[] {
  return [...palette.greens];
}

/**
 * The heat's paint (V4-03 board). Each point weighs its trees (n: a cell's count below zoom 15, 1 for a tree).
 * A zoom step in spreads the same trees over four times the pixels: the intensity grows about 3x a step,
 * with the radius, so only the leafiest streets and parks' edges reach the deepest green at every zoom.
 * Max opacity 0.7, gone by zoom 15.5 where the dots have taken over. Collisions keep their warm ramp.
 */
export function treeHeatPaint(palette: StreetTreePalette) {
  const greens = treeHeatRamp(palette);
  return {
    "heatmap-weight": ["coalesce", ["get", "n"], 1],
    // Tuned on the real list round Notting Hill (V4-03 board's place): district shapes at 12, street rows at 15.
    "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], TREE_MIN_ZOOM, 0.016, 13, 0.05, 14, 0.18, 15, 0.58, TREE_DOT_ZOOM, 1],
    "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 10, 10, 13, 18, 15, 28, TREE_DOT_ZOOM, 30],
    "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"],
      0, clear(greens[0]), 0.08, greens[0], 0.25, greens[1], 0.45, greens[2], 0.65, greens[3], 0.85, greens[4], 1, greens[5]],
    "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 15, 0.7, TREE_DOT_ZOOM, 0],
  } as Record<string, ExpressionSpecification>;
}

export function treeLayers(palette: StreetTreePalette): LayerSpecification[] {
  const common = { source: TREE_SOURCE_ID, "source-layer": "street_trees" };
  return [
    { ...common, id: TREE_HEAT_LAYER, type: "heatmap", minzoom: TREE_MIN_ZOOM, maxzoom: TREE_DOT_ZOOM, paint: treeHeatPaint(palette) },
    { ...common, id: TREE_POINT_LAYER, type: "circle", minzoom: TREE_POINT_ZOOM,
      layout: { "circle-sort-key": ["-", 0, ["coalesce", ["get", "canopy_m"], 0]] },  // big crowns under small ones
      paint: {
        "circle-color": ["case", known, palette.leaf, palette.halo],
        "circle-radius": treeRadius(),
        // Fading in from 15 as the heat fades out: no zoom where neither shows.
        "circle-opacity": ["interpolate", ["linear"], ["zoom"], TREE_POINT_ZOOM, 0, TREE_DOT_ZOOM, ["case", known, 0.78, 1]],
        "circle-stroke-opacity": ["interpolate", ["linear"], ["zoom"], TREE_POINT_ZOOM, 0, TREE_DOT_ZOOM, 1],
        "circle-stroke-color": ["case", known, palette.halo, palette.leaf],
        "circle-stroke-width": ["case", known, 1, 1.6],
      } },
  ];
}

/**
 * Green streets: the band (the tiles' 35 m buffer of every street with trees, the homes fronting it) in the
 * street's green, translucent so the footprints under it still read; then the line on top as its spine.
 */
export function greenStreetLayers(palette: StreetTreePalette): LayerSpecification[] {
  return [{
    id: GREEN_STREET_BAND_LAYER, type: "fill", source: GREEN_STREET_SOURCE_ID, "source-layer": "green_street_bands",
    minzoom: GREEN_STREET_BAND_ZOOM,
    paint: {
      "fill-color": greenStreetColour(palette),
      "fill-opacity": ["interpolate", ["linear"], ["zoom"], GREEN_STREET_BAND_ZOOM, 0, TREE_DOT_ZOOM, GREEN_STREET_BAND_OPACITY],
      // Bands of neighbouring links meet edge to edge: no seams drawn between them.
      "fill-antialias": false,
    },
  }, {
    id: GREEN_STREET_LAYER, type: "line", source: GREEN_STREET_SOURCE_ID, "source-layer": "green_streets",
    minzoom: GREEN_STREET_MIN_ZOOM,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": greenStreetColour(palette),
      "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 13, 1.6, 15, 3.5, 17, 7, 19, 13],
      "line-opacity": 0.92,
    },
  }];
}

/**
 * The XYZ tiles at `zoom` covering a box [west, south, east, north], at most `limit` (none when the box needs
 * more): a wide desktop view at zoom 14.5 spans about 20 zoom-15 tiles, a phone's about 6.
 */
export function tilesCovering(box: [number, number, number, number], zoom: number, limit = 24): { z: number; x: number; y: number }[] {
  const n = 2 ** zoom;
  const column = (lng: number) => Math.floor(((lng + 180) / 360) * n);
  const row = (lat: number) => {
    const rad = (Math.min(85, Math.max(-85, lat)) * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  };
  const [west, south, east, north] = box;
  const [x0, x1, y0, y1] = [column(west), column(east), row(north), row(south)];
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > limit) return [];
  const tiles = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push({ z: zoom, x: ((x % n) + n) % n, y });
  return tiles;
}

/** The colours a theme paints Green streets with, low to high (for the legend). */
export function greenStreetRamp(palette: StreetTreePalette): string[] {
  return [palette.bare, ...palette.greens];
}

type Properties = Record<string, unknown> | null | undefined;

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/** "13 m tall · 8 m canopy · 32 cm girth", or "Size not recorded". */
export function treeSizeText(properties: Properties): string {
  const height = text(properties?.height);
  const canopy = text(properties?.canopy);
  const girth = text(properties?.girth);
  const parts = [
    height && `${height} tall`,
    canopy && `${canopy} canopy`,
    girth && (/\d/.test(girth) ? `${girth} girth` : girth),
  ].filter((part): part is string => !!part);
  return parts.length ? parts.join(" · ") : "Size not recorded";
}

/** "Mature (31-80)" → "Mature · 31–80 years"; null when no age is recorded. */
export function treeAgeText(age: unknown): string | null {
  const value = text(age);
  if (!value) return null;
  const match = /^(.*?)\s*\((.+)\)$/.exec(value);
  if (!match) return value;
  return `${match[1]} · ${match[2].replace(/(\d)\s*-\s*(\d)/, "$1–$2")} years`;
}

/** Who looks after it, as people say it: "LB Barnet" → "Barnet Council", "Transport for London" → "TfL". */
export function treeOwnerText(owner: unknown): string | null {
  const value = text(owner);
  if (!value) return null;
  const borough = /^(?:LB|RB)\s+(.+)$/.exec(value);
  if (borough) return `${borough[1]} Council`;
  return ({ "Transport for London": "TfL", "The Royal Parks": "Royal Parks", "City of Westminster": "Westminster City Council" } as Record<string, string>)[value] ?? value;
}

/** The tree popup's lines: kind, size, age when recorded, then owner and source. */
export function treePopupLines(properties: Properties): string[] {
  const owner = treeOwnerText(properties?.owner);
  return [
    text(properties?.name) ?? "Tree",
    treeSizeText(properties),
    treeAgeText(properties?.age),
    [owner, "GLA tree list"].filter(Boolean).join(" · "),
  ].filter((line): line is string => !!line);
}

/** A street's popup: its name, trees per 100 m and, where known, the share of its kerbs under canopy. */
export function greenStreetPopupLines(properties: Properties): string[] {
  const trees = Number(properties?.trees ?? 0);
  const per100 = Number(properties?.per_100m ?? 0);
  const canopy = properties?.canopy;
  const name = text(properties?.name) ?? "Unnamed road";
  if (!trees) return [name, "No street trees", "Council, TfL and park trees within 20 m"];
  const density = `${per100.toLocaleString("en-GB", { maximumFractionDigits: 1 })} trees per 100 m`;
  const shade = typeof canopy === "number" ? `${Math.round(canopy * 100)}% of kerbs under canopy` : null;
  return [name, shade ? `${density} · ${shade}` : density, `${trees} ${trees === 1 ? "tree" : "trees"} · GLA tree list`];
}

export const CANOPY_SOURCE_ID = "canopy";
export const CANOPY_LAYER = "canopy-cover";
// Zoom 8-10 tiles hold each pixel's share of green (deploy/tools/etl_canopy.py pyramid).
export const CANOPY_MIN_ZOOM = 8;
const CANOPY_TILE_MAX_ZOOM = 14;
export const CANOPY_ATTRIBUTION = "Canopy: contains modified Copernicus Sentinel data (2025)";
// The tiles' leaf green and its four strengths (deploy/tools/etl_canopy.py LEAF, ALPHAS), for the legend.
const CANOPY_LEAF = [0x2f, 0x8f, 0x73] as const;
export const CANOPY_ALPHAS = [70, 120, 170, 215] as const;
// The map's ground under the cover (DESIGN.md --paper), Day and Night.
const GROUND: Record<ResolvedTheme, readonly [number, number, number]> = { day: [0xf4, 0xf7, 0xfa], night: [0x16, 0x20, 0x3a] };

export function canopySource(origin: string, release?: string | null): RasterSourceSpecification {
  return {
    type: "raster",
    tiles: [withRelease(`${origin}/api/v1/tiles/canopy/{z}/{x}/{y}.png`, release)],
    tileSize: 256,
    minzoom: CANOPY_MIN_ZOOM,
    maxzoom: CANOPY_TILE_MAX_ZOOM,
    // The mosaic's box: no requests for tiles beyond London.
    bounds: LONDON_TILE_BOUNDS,
    attribution: CANOPY_ATTRIBUTION,
  };
}

/** By night the tiles' green is lifted a little so it reads on navy. */
export function canopyLayer(theme: ResolvedTheme): LayerSpecification {
  return {
    id: CANOPY_LAYER, type: "raster", source: CANOPY_SOURCE_ID, minzoom: CANOPY_MIN_ZOOM,
    paint: { "raster-opacity": 0.9, "raster-brightness-min": theme === "night" ? 0.18 : 0, "raster-fade-duration": 150 },
  };
}

/** The legend's four shades: leaf green at the tiles' strengths over the map's ground. */
export function canopyLegendColours(theme: ResolvedTheme): string[] {
  const ground = GROUND[theme];
  return CANOPY_ALPHAS.map((alpha) => `#${CANOPY_LEAF.map((part, index) => {
    const value = Math.round(part * (alpha / 255) + ground[index] * (1 - alpha / 255));
    return value.toString(16).padStart(2, "0");
  }).join("")}`);
}
