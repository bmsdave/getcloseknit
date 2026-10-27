/**
 * The area boundaries as vector tiles (api/area_api/map_tiles.py, migrations 116, 119, 125, 127): the only way area
 * shapes reach the browser. One tile set per kind of area, zoom 5-12 (overzoomed further in), immutable per release: a
 * static PMTiles archive per kind read with Range requests (the pmtiles protocol), or the API's tile URLs. The London
 * map's (CLOSE_KNIT_ENGLAND off) holds London's areas alone, demo data's its fixtures
 * (lib/demo-area-tiles.ts). The map paints them with feature-state colours; what it still needs of the shapes (each
 * area's box: the in-view scale, the view's region, fitting an area) is the box index (lib/area-boxes.ts).
 *
 * A tile feature's id is the area's ONS code as an integer (uk:lsoa:E01000001 -> 1000001), unique across kinds: the
 * browser derives it from the area id, so no lookup table travels. Each kind's fill and the selected area's outline
 * are layers on its tiles that stay on the map, drawn over a zoom range (areaLevelZooms), so the outline is the very
 * edge the fill is drawn with.
 */
import type { FilterSpecification, Map as MapLibreMap, VectorSourceSpecification } from "maplibre-gl";
import { Protocol } from "pmtiles";

import { carrierOf, carrierOfId, tileKindOf, type Carrier, type GeographyId, type TileKind } from "./contracts";
import { AREA_TILES_WORKER_URL } from "./map-core";
import { LAD_ZOOM, WIDE_ZOOM } from "./map-coverage";

export interface AreaTiles {
  release: string;
  minzoom: number;
  maxzoom: number;
  /**
   * One static archive per kind, `/tiles/areas-<release>-{kind}.pmtiles` (deploy/tools/area_pmtiles.py), or a tile
   * template, `/api/v1/tiles/areas/<release>/{kind}/{z}/{x}/{y}.mvt` (the API's, demo data's): {kind} and the MVT
   * layer are the tile kind (borough for a LAD, while ids say lad: TileKind).
   */
  url: string;
}

export const AREA_TILE_KINDS: readonly TileKind[] = ["lsoa", "msoa", "borough"];
const SOURCE_PREFIX = "area-tiles-";

export function isAreaTiles(value: unknown): value is AreaTiles {
  const tiles = value as Partial<AreaTiles> | null;
  return !!tiles && typeof tiles.release === "string" && typeof tiles.url === "string"
    && typeof tiles.minzoom === "number" && typeof tiles.maxzoom === "number";
}

/** The kind of area an id names (uk:lsoa:… -> lsoa, uk:lad:… -> lad). */
export function areaKind(id: string): Carrier {
  return carrierOfId(id);
}

/** A tile feature's id for an area: its ONS code's digits (E01000001 -> 1000001); NaN for anything else. */
export function areaTileId(id: string): number {
  const code = id.slice(id.lastIndexOf(":") + 1);
  return /^E\d{8}$/.test(code) ? Number(code.slice(1)) : Number.NaN;
}

/** The area id a tile feature stands for, from its layer (the kind) and id. */
export function areaIdFromTile(kind: string, id: number | string | undefined): GeographyId | null {
  const number = typeof id === "string" ? Number(id) : id;
  if (number === undefined || !Number.isInteger(number) || number <= 0 || !AREA_TILE_KINDS.includes(kind as TileKind)) return null;
  return `uk:${carrierOf(kind)}:E${String(number).padStart(8, "0")}` as GeographyId;
}

/** A rendered feature's area id: a tile feature's from its layer and number, any other feature's own id. */
export function featureAreaId(feature: { id?: string | number; source?: string; sourceLayer?: string }): string | number | undefined {
  if (isAreaTileSource(feature.source) && feature.sourceLayer) return areaIdFromTile(feature.sourceLayer, feature.id) ?? undefined;
  return feature.id;
}

export function areaTileSourceId(kind: Carrier | TileKind): string {
  return `${SOURCE_PREFIX}${tileKindOf(kind)}`;
}

export function isAreaTileSource(source: unknown): boolean {
  return typeof source === "string" && source.startsWith(SOURCE_PREFIX);
}

const targets = new Map<string, { source: string; sourceLayer: string; id: number }>();

/** The feature-state target of one area on its kind's tiles (kept: a paint writes thousands of them). */
export function areaTileTarget(id: string): { source: string; sourceLayer: string; id: number } {
  let target = targets.get(id);
  if (!target) {
    const kind = areaKind(id);
    target = { source: areaTileSourceId(kind), sourceLayer: tileKindOf(kind), id: areaTileId(id) };
    targets.set(id, target);
  }
  return target;
}

/**
 * Reads the static archives (`pmtiles://<file>/{z}/{x}/{y}`): the header and directories once per file, then each tile
 * with a Range request. Registered on MapLibre by each map before its first source (registerAreaTileProtocol).
 */
const archives = new Protocol({ metadata: false });
let workersLoaded = false;

/**
 * The pmtiles protocol in MapLibre's workers (AREA_TILES_WORKER_URL: each worker reads its tiles' ranges itself, off the
 * main thread, as it fetches any other tile) and on the main thread, which answers a worker that has not loaded it yet.
 */
export function registerAreaTileProtocol(maplibre: {
  addProtocol(name: string, load: typeof archives.tile): void;
  importScriptInWorkers(url: string): Promise<void>;
}) {
  maplibre.addProtocol("pmtiles", archives.tile);
  if (workersLoaded) return;
  workersLoaded = true;
  void maplibre.importScriptInWorkers(AREA_TILES_WORKER_URL).catch(() => { workersLoaded = false; });
}

export function areaTileSource(tiles: AreaTiles, kind: Carrier | TileKind, origin: string): VectorSourceSpecification {
  const url = `${origin}${tiles.url.replace("{kind}", tileKindOf(kind))}`;
  return {
    type: "vector",
    tiles: [url.endsWith(".pmtiles") ? `pmtiles://${url}/{z}/{x}/{y}` : url],
    minzoom: tiles.minzoom,
    maxzoom: tiles.maxzoom,
    // England's box: no request for the sea, Scotland's or Wales's tiles.
    bounds: [-6.5, 49.8, 1.9, 55.9],
  };
}

/**
 * One kind's layers on its tiles: the fill, its hairlines (lib/area-edges.ts; an LSOA's or MSOA's only), and over them
 * the selected area's halo and outline (feature-state). All draw over the kind's zoom range (areaLevelZooms).
 */
export function areaTileLayers(kind: Carrier | TileKind): { fill: string; edge: string; halo: string; outline: string } {
  const suffix = tileKindOf(kind);
  return { fill: `area-fill-${suffix}`, edge: `area-edge-${suffix}`, halo: `area-selection-halo-${suffix}`, outline: `area-outline-${suffix}` };
}

/**
 * The features one kind's halo and outline hold: the selected area's alone, none for any other kind. A line for every
 * area, even drawn at width 0, tripled the vertices a view sends to the GPU (perf:interaction, england-z7.5).
 */
export function areaOutlineFilter(kind: Carrier | TileKind, selected: string | null): FilterSpecification {
  const id = selected && tileKindOf(areaKind(selected)) === tileKindOf(kind) ? areaTileId(selected) : Number.NaN;
  return ["==", ["id"], Number.isFinite(id) ? id : -1];
}

/** Every area fill the map may hold (a tap and the diagnostics read the ones on it). */
export const AREA_FILL_LAYERS: readonly string[] = AREA_TILE_KINDS.map((kind) => areaTileLayers(kind).fill);

/** A zoom range no zoom is in: the kind's layers draw nowhere. */
const NOWHERE: [number, number] = [24, 24];

/**
 * The zoom range (minzoom, maxzoom) each kind's layers draw over. The kind painted draws at every zoom, so past
 * a level's edge it keeps its colours until the other kind's land and no frame goes blank. A layer of LSOAs is painted
 * on LADs below LAD_ZOOM and on MSOAs below WIDE_ZOOM (lib/map-coverage.ts viewPieces): the other kinds draw over their own zooms,
 * clear while it holds no colours, so its tiles are loading while its colours are fetched. `also`: other kinds the
 * paint's values name (demo data's sparse area carries its MSOA's value), at every zoom. Any other kind: nowhere.
 */
export function areaLevelZooms(painted: Carrier, lsoaLevels: boolean, also: Iterable<Carrier> = []): Record<TileKind, [number, number]> {
  const own = tileKindOf(painted);
  const zooms: Record<TileKind, [number, number]> = { lsoa: NOWHERE, msoa: NOWHERE, borough: NOWHERE };
  if (lsoaLevels) {
    zooms.borough = [0, LAD_ZOOM];
    zooms.msoa = [LAD_ZOOM, WIDE_ZOOM];
    zooms.lsoa = [WIDE_ZOOM, 24];
  }
  for (const kind of also) zooms[tileKindOf(kind)] = [0, 24];
  zooms[own] = [0, 24];
  return zooms;
}

/** The tile source of one kind, added once (it loads tiles only while a layer draws it). */
export function ensureAreaTileSource(map: MapLibreMap, tiles: AreaTiles, kind: Carrier | TileKind): string {
  const id = areaTileSourceId(kind);
  if (!map.getSource(id)) map.addSource(id, areaTileSource(tiles, kind, window.location.origin));
  return id;
}
