/**
 * What a street map shows that the quiet basemap leaves out (DESIGN.md › Map):
 * house numbers when zoomed right in, from the basemap's own OpenMapTiles
 * source. Their text takes the basemap's label colours, so they follow Day and
 * Night with it. Stations and lines come from TfL (lib/map-transit.ts).
 */
import type { SymbolLayerSpecification } from "maplibre-gl";

export const BASEMAP_SOURCE = "openmaptiles";
export const HOUSE_NUMBER_LAYER = "ck-house-numbers";
export const HOUSE_NUMBER_MIN_ZOOM = 17;

export function basemapExtraLayers(): SymbolLayerSpecification[] {
  return [
    {
      id: HOUSE_NUMBER_LAYER, type: "symbol", source: BASEMAP_SOURCE, "source-layer": "housenumber", minzoom: HOUSE_NUMBER_MIN_ZOOM,
      layout: {
        "text-field": ["get", "housenumber"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 10,
        "text-padding": 3,
      },
      paint: { "text-color": "#5b6270", "text-halo-color": "#f4f7fa", "text-halo-width": 1.2, "text-opacity": 0.85 },
    },
  ];
}

/** Adds the house numbers once; a style without the basemap source is left alone. */
export function ensureBasemapExtras(map: {
  getSource(id: string): unknown; getLayer(id: string): unknown; addLayer(layer: SymbolLayerSpecification, before?: string): void;
}, before?: string): void {
  if (!map.getSource(BASEMAP_SOURCE) || map.getLayer(HOUSE_NUMBER_LAYER)) return;
  for (const layer of basemapExtraLayers()) map.addLayer(layer, before);
}
