/**
 * What every MapLibre map on the site shares: the basemap style and the worker bundle.
 * The explorer map (area-map.tsx) reads these; anything else drawing a map should too, so a
 * pinned or self-hosted basemap changes in one place.
 */
export const BASE_STYLE = process.env.NEXT_PUBLIC_BASEMAP_STYLE_URL
  ?? "https://tiles.openfreemap.org/styles/positron";
// One folder per MapLibre version (scripts/copy-maplibre-worker.mjs), served immutable (next.config.ts).
export const MAPLIBRE_VERSION = process.env.NEXT_PUBLIC_MAPLIBRE_VERSION ?? "dev";
export const MAPLIBRE_WORKER_URL = `/maplibre/${MAPLIBRE_VERSION}/maplibre-gl-worker.mjs`;
/** The pmtiles protocol for MapLibre's workers (lib/area-tiles.ts registerAreaTileProtocol), from the same script. */
export const AREA_TILES_WORKER_URL = `/maplibre/${MAPLIBRE_VERSION}/area-tiles-${process.env.NEXT_PUBLIC_PMTILES_VERSION ?? "dev"}.mjs`;
/** Zoom levels' worth of the view each source keeps for zooming back (maxTileCacheZoomLevels; MapLibre's default: 5). */
export const MAP_TILE_CACHE_ZOOM_LEVELS = 8;
