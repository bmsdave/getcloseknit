import type { GeoJSONSourceSpecification, Map as MapLibreMap, SymbolLayerSpecification } from "maplibre-gl";

import { LAD_ZOOM } from "./map-coverage";
import type { ResolvedTheme } from "./ui-themes";

// Area labels are their own point source (/api/v1/labels), separate from the
// per-LSOA colours, on the same ladder as the areas (DESIGN.md §6, England map):
// England's nine regions while its LADs are painted (below LAD_ZOOM), one label
// per borough or district from there, one per postcode district ("BR6 ·
// Orpington") at mid zoom, and none at street zoom where the basemap's own names
// take over. Points never repeat per LSOA, and colliding labels of one tier
// yield (never overlap); the bigger one wins via its rank.
export const AREA_LABEL_SOURCE_ID = "area-labels";
export const REGION_LABEL_LAYER_ID = "area-labels-region";
export const BOROUGH_LABEL_LAYER_ID = "area-labels-borough";
export const DISTRICT_LABEL_LAYER_ID = "area-labels-district";
export const AREA_LABEL_LAYER_IDS = [REGION_LABEL_LAYER_ID, BOROUGH_LABEL_LAYER_ID, DISTRICT_LABEL_LAYER_ID] as const;

/** Zoom where district labels replace borough labels, and where all area labels stop. */
export const DISTRICT_LABEL_MIN_ZOOM = 11.5;
export const AREA_LABEL_MAX_ZOOM = 14;

export type AreaLabelKind = "region" | "borough" | "district";

export interface AreaLabelProperties {
  kind: AreaLabelKind;
  code: string;
  label: string;
  name: string | null;
  rank: number;
}

// Ink on the ground colour by day; pale ink on navy by night. Either reads over the translucent fills.
const LABEL_COLOURS: Record<ResolvedTheme, { text: string; halo: string }> = {
  day: { text: "#22252c", halo: "#f4f7fa" },
  night: { text: "#f4f7fa", halo: "#16203a" },
};

/** The area names' text and halo for a theme (also applied on theme change by map-basemap-theme). */
export function areaLabelPaint(theme: ResolvedTheme = "day"): NonNullable<SymbolLayerSpecification["paint"]> {
  return { "text-color": LABEL_COLOURS[theme].text, "text-halo-color": LABEL_COLOURS[theme].halo, "text-halo-width": 1.5 };
}

/** Which labels a zoom shows: regions below LAD_ZOOM, boroughs to 11.5, districts to 14, then none. */
export function areaLabelKindAt(zoom: number): AreaLabelKind | null {
  if (zoom < LAD_ZOOM) return "region";
  if (zoom < DISTRICT_LABEL_MIN_ZOOM) return "borough";
  if (zoom < AREA_LABEL_MAX_ZOOM) return "district";
  return null;
}

export function areaLabelSource(origin: string): GeoJSONSourceSpecification {
  return { type: "geojson", data: `${origin}/api/v1/labels` };
}

// Boroughs read as administrative names (spaced capitals), so they never look
// like a repeat of the basemap's own town label of the same name.
// A region reads as a heading over the map: larger and bold, in ordinary case. England is ~300 px wide at z5.3, so
// all nine fit only if they grow with the zoom, wrap ("Yorkshire and / The Humber") and may sit beside their point:
// at 17 px they collided and Yorkshire and The Humber, West Midlands and South East yielded.
export const REGION_TEXT_SIZE = ["step", ["zoom"], 12, 5.5, 13, 6, 14] as const;
const KIND_LAYOUT: Record<AreaLabelKind, SymbolLayerSpecification["layout"]> = {
  region: {
    "text-size": REGION_TEXT_SIZE as unknown as number, "text-font": ["Noto Sans Bold"], "text-max-width": 7, "text-padding": 2,
    "text-variable-anchor": ["center", "top", "bottom", "left", "right"], "text-radial-offset": 0.6,
  },
  borough: { "text-size": 12, "text-transform": "uppercase", "text-letter-spacing": 0.12 },
  district: { "text-size": 12.5 },
};

function labelLayer(id: string, kind: AreaLabelKind, zoom: { minzoom?: number; maxzoom: number },
  source: string, theme: ResolvedTheme): SymbolLayerSpecification {
  return {
    id,
    type: "symbol",
    source,
    ...zoom,
    filter: ["==", ["get", "kind"], kind],
    layout: {
      "text-field": ["get", "label"],
      "text-font": ["Noto Sans Regular"],
      "text-max-width": 14,
      "text-allow-overlap": false,
      "text-ignore-placement": false,
      "text-padding": 6,
      ...KIND_LAYOUT[kind],
      "symbol-sort-key": ["get", "rank"],
    },
    paint: areaLabelPaint(theme),
  };
}

export function areaLabelLayers(source = AREA_LABEL_SOURCE_ID, theme: ResolvedTheme = "day"): SymbolLayerSpecification[] {
  return [
    labelLayer(REGION_LABEL_LAYER_ID, "region", { maxzoom: LAD_ZOOM }, source, theme),
    labelLayer(BOROUGH_LABEL_LAYER_ID, "borough", { minzoom: LAD_ZOOM, maxzoom: DISTRICT_LABEL_MIN_ZOOM }, source, theme),
    labelLayer(DISTRICT_LABEL_LAYER_ID, "district",
      { minzoom: DISTRICT_LABEL_MIN_ZOOM, maxzoom: AREA_LABEL_MAX_ZOOM }, source, theme),
  ];
}

// The basemap's country and state names (OpenFreeMap positron: label_country_1..3, label_state) sit between the
// region labels below LAD_ZOOM ("United Kingdom" between North East and North West, "Isle of Man"): one label
// tier there (DESIGN.md §6.5), so they start at LAD_ZOOM. Towns and cities keep their own zooms.
const BASEMAP_REGION_TIER = /^label_(country|state)/;

/** [layer id, minzoom, maxzoom] for each basemap label that yields to the region labels. */
export function basemapLabelZooms(layers: readonly { id: string; type: string; minzoom?: number; maxzoom?: number }[]): [string, number, number][] {
  return layers.filter((layer) => layer.type === "symbol" && BASEMAP_REGION_TIER.test(layer.id))
    .map((layer) => [layer.id, Math.max(layer.minzoom ?? 0, LAD_ZOOM), layer.maxzoom ?? 24]);
}

export function yieldBasemapPlaceLabels(map: MapLibreMap): void {
  for (const [id, min, max] of basemapLabelZooms(map.getStyle()?.layers ?? [])) {
    if (min < max) map.setLayerZoomRange(id, min, max);
    else map.setLayoutProperty(id, "visibility", "none");
  }
}
