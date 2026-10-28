/**
 * Where the map can go and what it loads for the view (England, CLOSE_KNIT_ENGLAND; api/area_api/map_chunks.py).
 *
 * The London map loaded every area's values at once, a value pack per layer. England has seven times as many areas,
 * so the map loads the pieces in view (each one's values and its areas' boxes), at a level for its zoom; the shapes
 * themselves are vector tiles (lib/area-tiles.ts). The zoom ladder (DESIGN.md §6, England map):
 *
 * - below LAD_ZOOM (all of England in view): England's LADs, one piece, each the median of its areas (296 readable
 *   areas instead of 6,900 MSOA specks);
 * - LAD_ZOOM to WIDE_ZOOM: each region in view as MSOAs (medians of their LSOAs);
 * - WIDE_ZOOM to NEIGHBOURHOOD_ZOOM: each region in view as the layer's own areas (LSOAs);
 * - from NEIGHBOURHOOD_ZOOM: the layer's own areas, one piece per LAD in view, London's boroughs as one piece (the
 *   request the London map always made).
 *
 * Every level is built from LSOAs, so each nests exactly in the one above. London is one region among nine at every
 * zoom: the same level, detail and loading path as its neighbours, and every piece in view paints in the same frame
 * (components/area-map.tsx), so the map reads as one map. Colours are the 9 quantiles of the areas in view (In view,
 * lib/view-scale.ts) at every level; fewer than 20 valued areas in view fall back on the ranks of their region (one
 * region in view, viewScopeName) or England's (several). Region and England are the reader's choice in Colour range.
 *
 * GET /api/v1/map/coverage says which: "england" with its regions and LAD chunks, or "london" (the flag off, demo
 * data), where the map is London's as before: one piece, London whole, and its tiles hold London's areas alone.
 * An area of a loaded piece without a value is grey ("No data") inside the layer's coverage and clear outside it
 * (DESIGN.md §6): lib/no-data.ts.
 */
import { carrierOf, type Carrier } from "./contracts";
import { LONDON_BOUNDS, MIN_MAP_ZOOM, type DataMode } from "./map-state";
import { mapFetch } from "./polite-fetch";
import { withRelease } from "./release-url";
import type { AreaTiles } from "./area-tiles";

export type Bbox = [west: number, south: number, east: number, north: number];

export interface CoverageArea {
  id: string;
  name?: string | null;
  /** A chunk's region code (E12…): which region a view is in (viewScopeName). Absent from an older API. */
  region?: string | null;
  bbox: Bbox;
  areas?: number;
}

export interface MapCoverage {
  coverage: "england" | "london";
  /** The release the chunk URLs are built for (?v=): the API caches those answers for good. Null for London. */
  productReleaseId: string | null;
  bounds: [[number, number], [number, number]];
  /** The MSOA level's pieces: every region with loaded areas. */
  regions: CoverageArea[];
  /** The neighbourhood level's pieces: London whole, every other LAD on its own. */
  chunks: CoverageArea[];
  /** The area boundaries as vector tiles (lib/area-tiles.ts); absent (an API before them): no areas to draw. */
  areaTiles?: AreaTiles | null;
}

export const LONDON_REGION = "E12000007";
/** Greater London's own box: overlays built from London-only sources (the Tube, park names) load inside it. */
export const LONDON_BBOX: Bbox = [-0.52, 51.28, 0.34, 51.7];
/** Below it all of England is in view on a laptop: its LADs, not 6,900 MSOAs a few pixels across. */
export const LAD_ZOOM = 6.5;
/** Below it (from LAD_ZOOM) the map paints MSOAs; from it, LSOAs. */
export const WIDE_ZOOM = 9;
/** From it the layer's own areas at full detail, per LAD in view. */
export const NEIGHBOURHOOD_ZOOM = 9.5;
/** Wide enough to see all of England on a laptop; the London map stops at MIN_MAP_ZOOM. */
export const ENGLAND_MIN_ZOOM = 5;
/**
 * How far past England's box the England map may pan, in degrees. MapLibre never shows past maxBounds, so a box
 * the size of England held a laptop's zoom near 7 and ENGLAND_MIN_ZOOM did nothing: with this margin all of
 * England fits at the widest zoom on a laptop (about 32° by 12° at zoom 5 on 1440×900) and on a phone.
 */
export const ENGLAND_PAN_MARGIN = { longitude: 20, latitude: 12 } as const;

export const LONDON_COVERAGE: MapCoverage = {
  coverage: "london", productReleaseId: null, bounds: LONDON_BOUNDS, regions: [], chunks: [],
};

/** Demo data's tiles: its fixture areas, made by the web's own tile route (lib/demo-area-tiles.ts). */
export const DEMO_TILE_RELEASE = "a0-000000000000";
/** Demo data's map: London's, its fixture areas drawn from tiles of their own. */
export const DEMO_COVERAGE: MapCoverage = {
  ...LONDON_COVERAGE,
  areaTiles: { release: DEMO_TILE_RELEASE, minzoom: 5, maxzoom: 12, url: `/api/v1/tiles/areas/${DEMO_TILE_RELEASE}/{kind}/{z}/{x}/{y}.mvt` },
};

/** What one request pair (values and boxes) covers: a chunk (null: every area) of one carrier. */
export interface ViewPiece {
  chunk: string | null;
  carrier: Carrier;
  /** The carrier is coarser than the layer's own: its values are medians of the layer's areas (?level=). */
  rolledUp: boolean;
}

const ORDER: readonly Carrier[] = ["lsoa", "msoa", "lad"];

function piece(chunk: string | null, carrier: Carrier, layerCarrier: Carrier): ViewPiece {
  const rolledUp = ORDER.indexOf(carrier) > ORDER.indexOf(layerCarrier);
  return { chunk, carrier: rolledUp ? carrier : layerCarrier, rolledUp };
}

/** The London map's one piece: London whole, the layer's own areas. */
export function londonPiece(carrier: Carrier): ViewPiece {
  return piece(LONDON_REGION, carrier, carrier);
}

/** Demo data's one piece: the fixtures, unchunked, as before. */
export function demoPiece(carrier: Carrier): ViewPiece {
  return piece(null, carrier, carrier);
}

export function intersects(a: Bbox, b: Bbox): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

/** The pieces a view of `bounds` at `zoom` loads for a layer drawn on `carrier`, in a stable order. */
export function viewPieces(coverage: MapCoverage, mode: DataMode, carrier: Carrier, bounds: Bbox, zoom: number): ViewPiece[] {
  if (mode === "demo") return [demoPiece(carrier)];
  if (coverage.coverage !== "england") return [londonPiece(carrier)];
  // A borough layer is 300 areas at most: one piece at every zoom.
  if (carrier === "lad") return [piece(null, "lad", carrier)];
  if (zoom >= NEIGHBOURHOOD_ZOOM) {
    return coverage.chunks.filter((chunk) => intersects(chunk.bbox, bounds)).map((chunk) => piece(chunk.id, carrier, carrier));
  }
  // All of England: its LADs, one piece (the medians of the layer's areas).
  if (zoom < LAD_ZOOM) return [piece(null, "lad", carrier)];
  // Every region alike, London too: MSOAs zoomed out, the layer's own areas from WIDE_ZOOM.
  const level: Carrier = zoom < WIDE_ZOOM ? "msoa" : carrier;
  return coverage.regions.filter((region) => intersects(region.bbox, bounds)).map((region) => piece(region.id, level, carrier));
}

/**
 * The LSOA pieces in view for a pack that carries every LSOA (a ready-made criterion, counted from places): never
 * rolled up, since it has no MSOA values, and only the pieces in view (perf/layer-load).
 */
export function lsoaPieces(coverage: MapCoverage, mode: DataMode, bounds: Bbox, zoom: number): ViewPiece[] {
  if (mode === "demo") return [demoPiece("lsoa")];
  if (coverage.coverage !== "england") return [londonPiece("lsoa")];
  const areas = zoom >= NEIGHBOURHOOD_ZOOM ? coverage.chunks : coverage.regions;
  return areas.filter((area) => intersects(area.bbox, bounds)).map((area) => piece(area.id, "lsoa", "lsoa"));
}

/** One string per set of pieces ("none" for a view of nothing, the sea): the map reloads only when it changes. */
export function piecesKey(pieces: readonly ViewPiece[]): string {
  if (!pieces.length) return "none";
  return pieces.map((entry) => `${entry.chunk ?? "*"}:${entry.carrier}:${entry.rolledUp ? "r" : ""}`).join(",");
}

/**
 * Where to look for one area's own box (a selected district or borough the map does not fill): London whole on the
 * London map; in England the LAD itself for a borough, else the pieces in view holding that kind of area.
 */
export function shapePieces(coverage: MapCoverage, mode: DataMode, id: string, bounds: Bbox): ViewPiece[] | undefined {
  const [, idKind, code] = id.split(":");
  const kind = carrierOf(idKind ?? "");
  if (mode === "demo") return undefined;
  if (coverage.coverage !== "england") return [londonPiece(kind)];
  if (kind === "lad") return [piece(code, "lad", "lad")];
  const areas = kind === "msoa" ? coverage.regions : coverage.chunks;
  return areas.filter((area) => intersects(area.bbox, bounds)).map((area) => piece(area.id, kind, kind));
}

/**
 * A value pack's URL for one piece (map-state.valuePackPath builds the base). A chunk's pack is asked for compact
 * (lib/value-pack-compact.ts): only what the map paints, a tenth of the size.
 */
export function piecePackPath(base: string, entry: ViewPiece, version: string | null): string {
  if (entry.chunk === null && !entry.rolledUp) return base;
  const parameters = new URLSearchParams();
  if (entry.chunk) parameters.set("chunk", entry.chunk);
  if (entry.rolledUp) parameters.set("level", entry.carrier);
  parameters.set("format", "compact");
  // The release makes the answer immutable (the API's IMMUTABLE), London's chunk too: a repeat visit reads it from
  // the browser's cache, never a revalidation round trip (perf/layer-load/README.md).
  if (version) parameters.set("v", version);
  return `${base}${base.includes("?") ? "&" : "?"}${parameters.toString()}`;
}

/** One value-pack request names at most this many chunks (api MAX_PACK_CHUNKS). */
export const MAX_PACK_CHUNKS = 64;

/**
 * The value-pack URLs for a view: London whole on its own (the London map's request, the release in it), the
 * other pieces of one level in one request (chunk=A,B,…, sorted): a view of thirty LADs is two requests per month,
 * not thirty, which keeps the timeline's prefetch under the rate limit. Boxes stay one request per piece
 * (pieceBoxesPath): they never change with the month and a pan only adds the new ones.
 */
export function viewPackPaths(base: string, pieces: readonly ViewPiece[], version: string | null): string[] {
  const paths: string[] = [];
  const groups = new Map<string, ViewPiece[]>();
  for (const entry of pieces) {
    if (entry.chunk === null || entry.chunk === LONDON_REGION) {
      paths.push(piecePackPath(base, entry, version));
      continue;
    }
    const key = `${entry.carrier}|${entry.rolledUp}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  for (const group of groups.values()) {
    const chunks = group.map((entry) => entry.chunk as string).sort();
    for (let start = 0; start < chunks.length; start += MAX_PACK_CHUNKS) {
      paths.push(piecePackPath(base, { ...group[0], chunk: chunks.slice(start, start + MAX_PACK_CHUNKS).join(",") }, version));
    }
  }
  return paths;
}

/** One piece's box index (lib/area-boxes.ts; the tiles draw the shapes), for this release. */
export function pieceBoxesPath(entry: ViewPiece, release: string | null | undefined, version: string | null): string {
  const parameters = new URLSearchParams({ carrier: entry.carrier });
  if (entry.chunk) parameters.set("chunk", entry.chunk);
  if (version) parameters.set("v", version);
  return withRelease(`/api/v1/areas/boxes?${parameters.toString()}`, release);
}

/** Where a map with this coverage may pan to, and how far out it may zoom. */
export function coverageCamera(coverage: MapCoverage): { bounds: [[number, number], [number, number]]; minZoom: number } {
  if (coverage.coverage !== "england") return { bounds: LONDON_BOUNDS, minZoom: MIN_MAP_ZOOM };
  const [[west, south], [east, north]] = coverage.bounds;
  const { longitude, latitude } = ENGLAND_PAN_MARGIN;
  return { bounds: [[west - longitude, south - latitude], [east + longitude, north + latitude]], minZoom: ENGLAND_MIN_ZOOM };
}

/**
 * What a view's ranks are "in": London on the London map; on the England map the region every LAD in view
 * belongs to ("North West"), or null when the view spans regions: the map then colours every area by its rank in
 * England (countryPercentile), one scale on both sides of a region's border. A view of nothing (the sea) keeps
 * London's words.
 */
export function viewScopeName(coverage: MapCoverage, bounds: Bbox): string | null {
  if (coverage.coverage !== "england") return "London";
  const inView = new Set(coverage.chunks.filter((chunk) => intersects(chunk.bbox, bounds)).map((chunk) => chunk.region ?? null));
  if (inView.size === 0) return "London";
  if (inView.size > 1 || inView.has(null)) return null;
  const [code] = inView;
  return coverage.regions.find((region) => region.id === code)?.name ?? null;
}

/** The region a piece's chunk is in: a region chunk is its own, a LAD chunk (or London whole) names its region. */
export function chunkRegion(coverage: MapCoverage, chunk: string | null): string | null {
  if (!chunk) return null;
  if (coverage.regions.some((region) => region.id === chunk)) return chunk;
  return coverage.chunks.find((entry) => entry.id === chunk)?.region ?? null;
}

/** A region counts as in view from this share of the view: a sliver of Surrey in a London view's corner does not. */
export const SCOPE_MIN_SHARE = 0.1;

/**
 * viewScopeName refined by the areas the view really shows: LAD boxes are loose (High Peak's reaches into
 * Manchester's view), so a view the boxes put across regions is one region's when that region's areas fill all
 * but a sliver of it (SCOPE_MIN_SHARE). `areas` are the painted areas, each with its region and box; each box's
 * overlap with the view is its weight.
 */
export function viewScopeFromAreas(coverage: MapCoverage, bounds: Bbox,
  areas: Iterable<{ region?: string | null; bbox: Bbox }>): string | null {
  const coarse = viewScopeName(coverage, bounds);
  if (coarse !== null || coverage.coverage !== "england") return coarse;
  const weights = new Map<string | null, number>();
  let total = 0;
  for (const area of areas) {
    const width = Math.min(area.bbox[2], bounds[2]) - Math.max(area.bbox[0], bounds[0]);
    const height = Math.min(area.bbox[3], bounds[3]) - Math.max(area.bbox[1], bounds[1]);
    if (width <= 0 || height <= 0) continue;
    const region = area.region ?? null;
    weights.set(region, (weights.get(region) ?? 0) + width * height);
    total += width * height;
  }
  const shown = [...weights].filter(([, weight]) => weight >= total * SCOPE_MIN_SHARE).map(([region]) => region);
  const [code] = shown;
  return shown.length === 1 && code ? coverage.regions.find((region) => region.id === code)?.name ?? null : null;
}

let viewScope: string | null = "London";
const scopeListeners = new Set<() => void>();

/** The main map sets its view's scope on every move (components/area-map.tsx); the legend and Layers read it. */
export function setViewScope(scope: string | null): void {
  if (scope === viewScope) return;
  viewScope = scope;
  for (const listener of scopeListeners) listener();
}

export function subscribeViewScope(listener: () => void): () => void {
  scopeListeners.add(listener);
  return () => { scopeListeners.delete(listener); };
}

/** "London", "North West", or "England" for a view across regions: "Lowest in England", "Rank in England". */
export function viewScopeWords(): string {
  return viewScope ?? "England";
}

/** Whether the map's view spans regions: its percentile colours are England's (countryPercentile), not a region's. */
export function viewScopeIsEngland(): boolean {
  return viewScope === null;
}

export function isCoverage(body: unknown): body is MapCoverage {
  const value = body as Partial<MapCoverage> | null;
  return !!value && (value.coverage === "england" || value.coverage === "london")
    && Array.isArray(value.regions) && Array.isArray(value.chunks) && Array.isArray(value.bounds);
}

const requests = new Map<string, Promise<MapCoverage>>();
let current: MapCoverage = LONDON_COVERAGE;
const listeners = new Set<() => void>();

/**
 * The coverage for a release, once per page and release (London's, with its fixture tiles, in demo data). A failure
 * rejects and is not kept: the next call asks again. London's coverage in its place would leave England unpainted for
 * the whole release.
 */
export function fetchMapCoverage(mode: DataMode, release: string | null | undefined, fetchImpl: typeof fetch = fetch): Promise<MapCoverage> {
  if (mode === "demo") return Promise.resolve(publish(DEMO_COVERAGE));
  const key = release ?? "";
  let pending = requests.get(key);
  if (!pending) {
    // mapFetch rides over a restart (503) or a rate limit before this gives up.
    const request = mapFetch(withRelease("/api/v1/map/coverage", release), undefined, fetchImpl)
      .then(async (response) => {
        const body = response.ok ? await response.json() as unknown : null;
        if (!isCoverage(body)) throw new Error(`map coverage unavailable (HTTP ${response.status})`);
        return body;
      });
    request.catch(() => { if (requests.get(key) === request) requests.delete(key); });
    requests.set(key, request);
    pending = request;
  }
  return pending.then(publish);
}

function publish(coverage: MapCoverage): MapCoverage {
  if (coverage !== current) {
    current = coverage;
    for (const listener of listeners) listener();
  }
  return coverage;
}

/** The coverage the map last loaded (London until one answers): the layer list says "London only" by it. */
export function subscribeMapCoverage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function loadedMapCoverage(): MapCoverage {
  return current;
}

/**
 * The main map's current pieces, for the price timeline's prefetch (it fetches the months ahead for the same view).
 * London's one piece until the map has a view.
 */
let activeView: { pieces: readonly ViewPiece[]; version: string | null } | null = null;

export function setActiveView(pieces: readonly ViewPiece[], version: string | null): void {
  activeView = { pieces, version };
}

export function activeViewPackPaths(base: string, carrier: Carrier = "lsoa"): string[] {
  // Before the map has a view, the coverage's release if it has answered: the same URL the map then asks for.
  const view = activeView ?? { pieces: [londonPiece(carrier)], version: current.productReleaseId };
  return viewPackPaths(base, view.pieces, view.version);
}

/** Test hook: forget fetched coverage and the active view. */
export function resetMapCoverage(): void {
  requests.clear();
  activeView = null;
  current = LONDON_COVERAGE;
  viewScope = "London";
}

/** What the layer list says on a layer whose data is London's alone (map-topics londonOnlyLayers) on the England map. */
export { LONDON_ONLY_LABEL } from "./coverage-reason";
