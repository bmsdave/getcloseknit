/**
 * Area borders (DESIGN.md §6, England map): a line layer on the same tiles as the fill, so a border is the very edge
 * the colour is drawn with. The level painted has hairlines in the ground's colour; the LADs above it a thin ink line
 * over them, so both the area and where its borough or district ends can be read. Over the fill, under the streets
 * and labels (they share the fill's place in the style). The selected area is still its own outline
 * (feature-state, lib/map-selection-paint.ts).
 */
import type { ExpressionSpecification, LineLayerSpecification, Map as MapLibreMap } from "maplibre-gl";

import { LAD_ZOOM } from "./map-coverage";
import { NEUTRAL_LINE } from "./map-property-layers";
import type { ResolvedTheme } from "./ui-themes";

/** The LADs' ink line at every zoom (the borough tiles' own kind). */
export const LAD_EDGE_LAYER = "area-edge-lad";
/** Hairlines of the level painted: the same ground colour as the map's land. */
const HAIRLINE: Readonly<Record<ResolvedTheme, string>> = { day: "#ffffff", night: "#16203a" };
const HAIRLINE_OPACITY = 0.55;
const LAD_OPACITY = 0.35;

/** One kind's hairline layer id (an LSOA or MSOA level; a LAD's border is LAD_EDGE_LAYER at every zoom). */
export function areaEdgeLayerId(tileKind: string): string {
  return `area-edge-${tileKind}`;
}

const zoom = ["zoom"] as unknown as ExpressionSpecification;

/** Hairline widths: an MSOA 0.75 px; an LSOA 0.5 px, 0.75 from street level (12). */
function hairlineWidth(tileKind: "lsoa" | "msoa"): ExpressionSpecification | number {
  return tileKind === "msoa" ? 0.75 : ["step", zoom, 0.5, 12, 0.75] as unknown as ExpressionSpecification;
}

/** An LSOA's hairline steps back with the fill from 12 to street zoom 15; an MSOA's never reaches it. */
function hairlineOpacity(tileKind: "lsoa" | "msoa"): ExpressionSpecification | number {
  return tileKind === "msoa" ? HAIRLINE_OPACITY
    : ["interpolate", ["linear"], zoom, 12, HAIRLINE_OPACITY, 15, 0.2] as unknown as ExpressionSpecification;
}

export function hairlineLayer(tileKind: "lsoa" | "msoa", source: string, theme: ResolvedTheme): LineLayerSpecification {
  return {
    id: areaEdgeLayerId(tileKind), type: "line", source, "source-layer": tileKind, minzoom: 24, maxzoom: 24,
    layout: { "line-join": "round" },
    paint: { "line-color": HAIRLINE[theme], "line-width": hairlineWidth(tileKind), "line-opacity": hairlineOpacity(tileKind) },
  };
}

/** The LADs' ink: 0.5 px while they are the level painted (below LAD_ZOOM), 1 px over MSOAs and LSOAs, 1.5 from 12. */
export function ladEdgeLayer(source: string, theme: ResolvedTheme): LineLayerSpecification {
  return {
    id: LAD_EDGE_LAYER, type: "line", source, "source-layer": "borough",
    layout: { "line-join": "round" },
    paint: {
      "line-color": NEUTRAL_LINE[theme], "line-opacity": LAD_OPACITY,
      "line-width": ["step", zoom, 0.5, LAD_ZOOM, 1, 12, 1.5] as unknown as ExpressionSpecification,
    },
  };
}

/** Day and Night: the hairlines take the ground's colour, the LAD line the ink's. */
export function applyAreaEdgeTheme(map: MapLibreMap, theme: ResolvedTheme): void {
  for (const kind of ["lsoa", "msoa"] as const) {
    const id = areaEdgeLayerId(kind);
    if (map.getLayer(id)) map.setPaintProperty(id, "line-color", HAIRLINE[theme]);
  }
  if (map.getLayer(LAD_EDGE_LAYER)) map.setPaintProperty(LAD_EDGE_LAYER, "line-color", NEUTRAL_LINE[theme]);
}
