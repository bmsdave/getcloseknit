/**
 * London's rail network on the map, in yarn (DESIGN.md › Map): Tube, Elizabeth
 * line, DLR, Overground and Tram lines are plied yarn in each line's own TfL
 * colour (shadow, body, twist, sheen). Where lines share track each keeps its own lane, side by side
 * as on TfL's map, so every line shows its colour along its whole route. Stations are neutral ring markers
 * (lib/map-station-marker.ts): a white centre in a ring of the line's colour,
 * split one segment per line at an interchange, which is a size up. No roundel.
 * Built once from TfL open data by scripts/tfl-network.mjs into
 * public/tfl-network.json. Lines go above the area colour and the streets,
 * under the map's labels.
 *
 * Stations follow one rule across the whole city: every station is eligible at
 * every zoom and markers are thinned only where they would collide (interchanges
 * placed first), so the outskirts never look emptier than they are.
 *
 * The whole network recedes when zoomed out and comes forward as you zoom in (TRANSIT_REVEAL).
 * Colours: TfL's Colour standard, Issue 11 (screen values); the sheen keeps to the yarn's edge so the
 * middle of each line measures within a few ΔE of its TfL colour from zoom 13 in.
 */
import type { ExpressionSpecification, GeoJSONSourceSpecification, LineLayerSpecification, SymbolLayerSpecification } from "maplibre-gl";

import { tone } from "./knit";
import { stationMarkerImage, stationMarkerLines, STATION_MARKER_PREFIX } from "./map-station-marker";
import { putImage } from "./map-yarn-images";
import type { ResolvedTheme } from "./ui-themes";

export const TRANSIT_SOURCE = "tfl-network";
export const TRANSIT_CASING_LAYER = "ck-transit-casing";
export const TRANSIT_SHADOW_LAYER = "ck-transit-shadow";
export const TRANSIT_LINE_LAYER = "ck-transit-lines";
export const TRANSIT_TWIST_LAYER = "ck-transit-twist";
export const TRANSIT_SHEEN_LAYER = "ck-transit-sheen";
export const TRANSIT_STATION_LAYER = "ck-transit-stations";
export const TRANSIT_LAYER_IDS = [
  TRANSIT_CASING_LAYER, TRANSIT_SHADOW_LAYER, TRANSIT_LINE_LAYER, TRANSIT_TWIST_LAYER, TRANSIT_SHEEN_LAYER, TRANSIT_STATION_LAYER,
] as const;

export const TRANSIT_ATTRIBUTION = "Powered by TfL Open Data · Contains OS data © Crown copyright and database rights";

/**
 * TfL's line colours, the screen (RGB) values of TfL's Colour standard, Issue 11 (August 2026),
 * https://content.tfl.gov.uk/tfl-colour-standard.pdf. The same table as scripts/tfl-network.mjs (LINES).
 */
export const LINE_COLOURS: Readonly<Record<string, string>> = {
  bakerloo: "#B26300", central: "#DC241F", circle: "#FFC80A", district: "#007D32", "hammersmith-city": "#F589A6",
  jubilee: "#838D93", metropolitan: "#9B0058", northern: "#000000", piccadilly: "#0019A8", victoria: "#039BE5",
  "waterloo-city": "#76D0BD", elizabeth: "#60399E", dlr: "#00AFAD", tram: "#5FB526", liberty: "#5D6061",
  lioness: "#FAA61A", mildmay: "#0077AD", suffragette: "#5BBD72", weaver: "#823A62", windrush: "#ED1B00",
};

/** The lines' names, as TfL writes them (the station features carry the ids only). */
export const LINE_NAMES: Readonly<Record<string, string>> = {
  bakerloo: "Bakerloo", central: "Central", circle: "Circle", district: "District", "hammersmith-city": "Hammersmith & City",
  jubilee: "Jubilee", metropolitan: "Metropolitan", northern: "Northern", piccadilly: "Piccadilly", victoria: "Victoria",
  "waterloo-city": "Waterloo & City", elizabeth: "Elizabeth line", dlr: "DLR", tram: "Tram", liberty: "Liberty",
  lioness: "Lioness", mildmay: "Mildmay", suffragette: "Suffragette", weaver: "Weaver", windrush: "Windrush",
};

/** A station's hover peek: its name, then its lines ("Circle · Hammersmith & City"). */
export function stationPeekLines(properties: Record<string, unknown> | undefined): string[] {
  const name = typeof properties?.name === "string" ? properties.name : "";
  if (!name) return [];
  const lines = String(properties?.lines ?? "").split(",").filter(Boolean).map((id) => LINE_NAMES[id] ?? id);
  return lines.length ? [name, lines.join(" · ")] : [name];
}

export function transitSource(origin: string): GeoJSONSourceSpecification {
  return { type: "geojson", data: `${origin}/tfl-network.json`, attribution: TRANSIT_ATTRIBUTION };
}

/** Per-theme ground and labels; the Northern line's black turns light at night. */
export const TRANSIT_THEME: Record<ResolvedTheme, { ground: string; ink: string; northern: string; label: string; halo: string }> = {
  day: { ground: "#ffffff", ink: "#22252c", northern: "#22252c", label: "#22252c", halo: "#f4f7fa" },
  night: { ground: "#16203a", ink: "#f4f7fa", northern: "#eef3f8", label: "#f4f7fa", halo: "#16203a" },
};

/** A line's yarn colour in a theme. */
export function lineColour(line: string, theme: ResolvedTheme): string {
  return line === "northern" ? TRANSIT_THEME[theme].northern : LINE_COLOURS[line] ?? "#5b6270";
}

/** ["match", line, …] over every line, shaded by `k` (0 = the line's own colour). */
function byLine(theme: ResolvedTheme, k = 0): ExpressionSpecification {
  const pairs = Object.keys(LINE_COLOURS).flatMap((line) => [line, k === 0 ? lineColour(line, theme) : tone(lineColour(line, theme), k)]);
  return ["match", ["get", "line"], ...pairs, "#5b6270"] as unknown as ExpressionSpecification;
}

const width = (at10: number, at13: number, at16: number): ExpressionSpecification => ["interpolate", ["linear"], ["zoom"], 10, at10, 13, at13, 16, at16];
/** The yarn's width (px) at zooms 10, 13 and 16; lanes of a shared stretch sit a little wider apart. */
const BODY = [1.8, 3.4, 5.8] as const;
export const LANE_SPACING = 1.1;
/**
 * Where lines share track each runs in its own lane, side by side as on TfL's map: the data gives a
 * feature's `offset` in line widths from the bundle's middle. `shift` moves a layer within its lane (the sheen).
 */
export const laneOffset = (shift: readonly [number, number, number] = [0, 0, 0]): ExpressionSpecification =>
  ["interpolate", ["linear"], ["zoom"], ...[10, 13, 16].flatMap((zoom, i) => [zoom, ["+", ["*", ["coalesce", ["get", "offset"], 0], +(BODY[i] * LANE_SPACING).toFixed(2)], shift[i]]])] as unknown as ExpressionSpecification;
/**
 * How far the network has come forward at a zoom: faint across the city (the map opens at 11, out to 9),
 * so the lines never outshout the area colour, then plain from 12 on: a line much under full strength
 * blends with the ground, and a dark line (Piccadilly, Metropolitan, Elizabeth) reads as a pastel of
 * another colour. `k` is the layer's own strength.
 */
export const TRANSIT_REVEAL: readonly [zoom: number, strength: number][] = [[9, 0.15], [11, 0.25], [12, 0.55], [13, 0.85], [14.5, 1]];
const reveal = (k = 1): ExpressionSpecification =>
  ["interpolate", ["linear"], ["zoom"], ...TRANSIT_REVEAL.flatMap(([zoom, strength]) => [zoom, Math.min(1, +(strength * k).toFixed(3))])] as unknown as ExpressionSpecification;
/**
 * Stations come forward on the same curve, 1.6 times as strong (40% at 11, all but full at 13): a small marker at
 * a quarter strength would vanish at the opening zoom, where a line still shows as a faint thread.
 */
export const STATION_REVEAL = 1.6;
const isLine: ExpressionSpecification = ["==", ["get", "kind"], "line"];
const round = { "line-cap": "round", "line-join": "round" } as const;

/** A station's ring colours in a theme, one per line it serves (["central", "northern"]). */
export function stationColours(lines: readonly string[], theme: ResolvedTheme): string[] {
  return lines.map((line) => lineColour(line, theme));
}

export function transitLayers(theme: ResolvedTheme): (LineLayerSpecification | SymbolLayerSpecification)[] {
  const t = TRANSIT_THEME[theme];
  return [
    { id: TRANSIT_CASING_LAYER, type: "line", source: TRANSIT_SOURCE, minzoom: 9, filter: isLine, layout: round,
      paint: { "line-color": t.ground, "line-width": width(3.2, 5.4, 8.6), "line-opacity": reveal(0.8), "line-offset": laneOffset() } },
    { id: TRANSIT_SHADOW_LAYER, type: "line", source: TRANSIT_SOURCE, minzoom: 9, filter: isLine, layout: round,
      paint: { "line-color": "#000000", "line-width": width(2.2, 4, 6.6), "line-opacity": reveal(0.16), "line-translate": [0, 1], "line-offset": laneOffset() } },
    // The yarn: a body in the line's colour, the ply twist a shade darker, a lit sheen along one side.
    { id: TRANSIT_LINE_LAYER, type: "line", source: TRANSIT_SOURCE, minzoom: 9, filter: isLine, layout: round,
      paint: { "line-color": byLine(theme), "line-width": width(...BODY), "line-opacity": reveal(), "line-offset": laneOffset() } },
    { id: TRANSIT_TWIST_LAYER, type: "line", source: TRANSIT_SOURCE, minzoom: 11, filter: isLine, layout: { "line-join": "round" },
      paint: { "line-color": byLine(theme, -0.32), "line-width": width(1.6, 3.1, 5.3), "line-dasharray": [0.45, 0.6], "line-opacity": reveal(0.55), "line-offset": laneOffset() } },
    { id: TRANSIT_SHEEN_LAYER, type: "line", source: TRANSIT_SOURCE, minzoom: 11, filter: isLine, layout: round,
      // The sheen keeps to the yarn's edge, so the middle of the line shows the line's own colour.
      paint: { "line-color": byLine(theme, 0.35), "line-width": width(0.5, 0.9, 1.5), "line-offset": laneOffset([-0.65, -1.25, -2.15]), "line-opacity": reveal(0.7) } },
    {
      // One symbol per station, marker and name together: the marker is placed first and the name only
      // where it fits (text-optional), so a name never pushes its own station's marker off the map.
      // Every station is eligible at every zoom; markers that would collide are dropped, interchanges kept first.
      id: TRANSIT_STATION_LAYER, type: "symbol", source: TRANSIT_SOURCE, minzoom: 10, filter: ["==", ["get", "kind"], "station"],
      layout: {
        "symbol-sort-key": ["get", "rank"],
        // The marker for the station's own lines, drawn on demand (the missing-image resolver) and cached.
        "icon-image": ["concat", STATION_MARKER_PREFIX, ["get", "lines"]] as ExpressionSpecification,
        "icon-size": ["interpolate", ["linear"], ["zoom"], 10, ["case", ["get", "interchange"], 0.6, 0.5], 13, ["case", ["get", "interchange"], 0.95, 0.8], 16, ["case", ["get", "interchange"], 1.35, 1.15]] as ExpressionSpecification,
        "icon-padding": ["interpolate", ["linear"], ["zoom"], 10, 3, 13, 1, 16, 0],
        // Interchanges named from 12.5, every station from 13.5.
        "text-field": ["step", ["zoom"], "", 12.5, ["case", ["<=", ["get", "rank"], 2], ["get", "name"], ""], 13.5, ["get", "name"]] as ExpressionSpecification,
        "text-optional": true,
        "text-font": ["Noto Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 12.5, 10.5, 16, 12.5],
        "text-max-width": 8,
        "text-variable-anchor": ["top", "bottom", "right", "left"],
        "text-radial-offset": 0.95,
        "text-padding": 8,
      },
      paint: { "icon-opacity": reveal(STATION_REVEAL), "text-opacity": reveal(STATION_REVEAL), "text-color": t.label, "text-halo-color": t.halo, "text-halo-width": 1.5 },
    },
  ];
}

type TransitMap = {
  getSource(id: string): unknown; getLayer(id: string): unknown;
  addSource(id: string, source: GeoJSONSourceSpecification): void;
  addLayer(layer: LineLayerSpecification | SymbolLayerSpecification, before?: string): void;
  setPaintProperty(layer: string, property: string, value: unknown): void;
  hasImage(id: string): boolean;
  addImage(id: string, image: { width: number; height: number; data: Uint8ClampedArray }, options?: { pixelRatio?: number }): void;
  updateImage?(id: string, image: { width: number; height: number; data: Uint8ClampedArray }): void;
  setMissingStyleImageResolver?(resolver: ((id: string) => void) | null): unknown;
};

/** Per map: the theme and pixel ratio markers are drawn in, and the marker ids it has. */
const markerState = new WeakMap<object, { theme: ResolvedTheme; ratio: number; ids: Set<string> }>();

/** Draws one station marker into the map (or redraws it for a theme); false for a foreign id. */
export function putStationMarker(map: TransitMap, id: string, theme: ResolvedTheme, ratio: number): boolean {
  const lines = stationMarkerLines(id);
  if (!lines) return false;
  const image = stationMarkerImage(stationColours(lines, theme), theme, ratio);
  if (!image) return false;
  putImage(map, id, image, ratio);
  markerState.get(map)?.ids.add(id);
  return true;
}

/** Adds the network once (yarn lines under `before`, the map's labels; markers and names on top). */
export function ensureTransit(map: TransitMap, origin: string, theme: ResolvedTheme, pixelRatio: number, before?: string): void {
  if (map.getLayer(TRANSIT_LINE_LAYER)) return;
  if (!map.getSource(TRANSIT_SOURCE)) map.addSource(TRANSIT_SOURCE, transitSource(origin));
  for (const layer of transitLayers(theme)) map.addLayer(layer, layer.type === "symbol" ? undefined : before);
  if (!markerState.has(map)) {
    const state = { theme, ratio: Math.max(1, Math.ceil(pixelRatio)), ids: new Set<string>() };
    markerState.set(map, state);
    // A marker per line combination, drawn the first time a station asks for it.
    map.setMissingStyleImageResolver?.((id) => { putStationMarker(map, id, state.theme, state.ratio); });
  }
}

/** Show › Stations: the network (lines and stations) shown or hidden; it is on by default. */
export function applyTransitVisibility(map: { getLayer(id: string): unknown; setLayoutProperty(layer: string, property: string, value: unknown): void }, on: boolean): void {
  for (const id of TRANSIT_LAYER_IDS) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
}

/** Recolours the network for a theme: grounds, the Northern line's yarn and every marker drawn so far. */
export function applyTransitTheme(map: TransitMap, theme: ResolvedTheme): void {
  if (!map.getLayer(TRANSIT_LINE_LAYER)) return;
  for (const layer of transitLayers(theme)) {
    for (const [property, value] of Object.entries(layer.paint ?? {})) {
      try { map.setPaintProperty(layer.id, property, value); } catch { /* a style without the layer */ }
    }
  }
  const state = markerState.get(map);
  if (!state || state.theme === theme) return;
  state.theme = theme;
  for (const id of state.ids) putStationMarker(map, id, theme, state.ratio);
}
