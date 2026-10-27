import type { GeoJSONSourceSpecification, SymbolLayerSpecification } from "maplibre-gl";

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
// A region reads as a heading over the map: larger and bold, in ordinary case.
const KIND_LAYOUT: Record<AreaLabelKind, SymbolLayerSpecification["layout"]> = {
  region: { "text-size": 17, "text-font": ["Noto Sans Bold"] },
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
      ...KIND_LAYOUT[kind],
      "text-max-width": 14,
      "text-allow-overlap": false,
      "text-ignore-placement": false,
      "text-padding": 6,
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
