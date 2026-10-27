import type { Page } from "./fixtures";

// An England map for the test server, which has no evidence API: London and its South East neighbour as grids of
// small squares, with their coverage, area tiles, boxes and value packs answered in the browser (in-view-scale,
// legend-range). The service worker would fetch the tiles and boxes past page.route: a spec blocks it.
export const LONDON = "E12000007";
export const SOUTH_EAST = "E12000008";
// The site's served scope (GET /api/v1/scope, components/scope-context.tsx): England's words.
const ENGLAND_SCOPE = {
  schemaVersion: "scope.v1", id: "uk:nation:E92000001", level: "nation", name: "England",
  served: [{ id: `uk:region:${LONDON}`, code: LONDON, name: "London" }, { id: `uk:region:${SOUTH_EAST}`, code: SOUTH_EAST, name: "South East" }],
  bbox: [-6.45, 49.86, 1.77, 55.82], outsideReason: "outside-coverage",
};

/** The scope the browser asks for when the test server (no evidence API) could not tell it: England. */
export async function routeEnglandScope(page: Page) {
  await page.route("**/api/v1/scope**", (route) => route.fulfill({ json: ENGLAND_SCOPE }));
}
const COVERAGE = {
  schemaVersion: "map-coverage.v1", coverage: "england", productReleaseId: "official-2026-06",
  bounds: [[-6.45, 49.86], [1.77, 55.82]],
  regions: [
    { id: LONDON, name: "London", bbox: [-0.52, 51.28, 0.34, 51.7] },
    { id: SOUTH_EAST, name: "South East", bbox: [-1.96, 50.57, 1.45, 52.2] },
  ],
  chunks: [
    { id: LONDON, region: LONDON, bbox: [-0.52, 51.28, 0.34, 51.7], areas: 40 },
    { id: "E07000072", region: SOUTH_EAST, bbox: [0, 51.4, 0.4, 51.6], areas: 30 },
  ],
};

export interface Area { id: `uk:lsoa:${string}`; box: [number, number, number, number]; value: number; england: number; london: number }

/** A grid of small squares, values rising across it. */
function grid(prefix: string, west: number, columns: number, rows: number, value: (index: number) => number, england: (index: number) => number): Area[] {
  return Array.from({ length: columns * rows }, (_, index) => {
    const [column, row] = [index % columns, Math.floor(index / columns)];
    const [x, y] = [west + column * 0.05, 51.4 + row * 0.04];
    return {
      id: `uk:lsoa:${prefix}${String(index).padStart(4, "0")}`, box: [x, y, x + 0.045, y + 0.035],
      value: value(index), england: england(index), london: Math.round((index / (columns * rows - 1)) * 100),
    };
  });
}

// London: 40 areas, £5,000 to £15,000 per m², every one in England's top tenth.
export const LONDON_AREAS = grid("E0100", -0.4, 8, 5, (index) => 5_000 + index * 250, (index) => 90 + Math.floor(index / 4));
// Its neighbour: 30 areas, £2,000 to £7,800, ranked lower in England. Its first area matches London's first value.
export const SOUTH_EAST_AREAS = grid("E0102", 0.0, 6, 5, (index) => (index === 0 ? 5_000 : 2_000 + index * 200), (index) => 40 + index);
const AREAS: Record<string, Area[]> = { [LONDON]: LONDON_AREAS, [SOUTH_EAST]: SOUTH_EAST_AREAS, E07000072: SOUTH_EAST_AREAS };

export const TILE_RELEASE = "a1-0123456789ab";
const ALL_AREAS = [...LONDON_AREAS, ...SOUTH_EAST_AREAS];
/** The coverage's area tiles: answered by routeEngland, or empty by routeNoAreas. */
export const AREA_TILES = { release: TILE_RELEASE, minzoom: 5, maxzoom: 12, url: `/api/v1/tiles/areas/${TILE_RELEASE}/{kind}/{z}/{x}/{y}.mvt` };

function varint(value: number, out: number[]) {
  while (value > 0x7f) { out.push((value & 0x7f) | 0x80); value = Math.floor(value / 128); }
  out.push(value);
}

function field(number: number, bytes: number[], out: number[]) {
  varint((number << 3) | 2, out);
  varint(bytes.length, out);
  out.push(...bytes);
}

/** A Mapbox Vector Tile of squares in one tile (api map_tiles.py's shape: a layer named after the kind, ids from codes). */
export function squaresTile(kind: string, squares: readonly { id: string; box: readonly number[] }[], z: number, x: number, y: number): Buffer {
  const scale = 2 ** z * 4096;
  const project = (lon: number, lat: number) => {
    const sin = Math.sin((lat * Math.PI) / 180);
    return [Math.round(((lon + 180) / 360) * scale - x * 4096),
      Math.round((0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale - y * 4096)];
  };
  const zigzag = (value: number) => (value << 1) ^ (value >> 31);
  const features: number[] = [];
  for (const area of squares) {
    const [west, south, east, north] = area.box;
    const ring = [project(west, north), project(east, north), project(east, south), project(west, south)];
    if (ring.every(([px]) => px < -64) || ring.every(([px]) => px > 4160) || ring.every(([, py]) => py < -64) || ring.every(([, py]) => py > 4160)) continue;
    const geometry: number[] = [];
    let [cx, cy] = [0, 0];
    ring.forEach(([px, py], index) => {
      if (index === 0) varint((1 & 7) | (1 << 3), geometry);
      if (index === 1) varint((2 & 7) | (3 << 3), geometry);
      varint(zigzag(px - cx), geometry);
      varint(zigzag(py - cy), geometry);
      [cx, cy] = [px, py];
    });
    varint((7 & 7) | (1 << 3), geometry);
    const feature: number[] = [];
    varint((1 << 3) | 0, feature); varint(Number(area.id.slice(-8)), feature);
    varint((3 << 3) | 0, feature); varint(3, feature);
    field(4, geometry, feature);
    field(2, feature, features);
  }
  if (!features.length) return Buffer.alloc(0);
  const layer: number[] = [];
  varint((15 << 3) | 0, layer); varint(2, layer);
  field(1, [...Buffer.from(kind)], layer);
  layer.push(...features);
  varint((5 << 3) | 0, layer); varint(4096, layer);
  const tile: number[] = [];
  field(3, layer, tile);
  return Buffer.from(tile);
}

/**
 * The England map in the browser: the coverage names the area tiles (lib/area-tiles.ts), the tiles are the grid's
 * squares, each piece's boxes the box index's answer, the packs the grid's values. Every tile and box request is
 * counted.
 */
export async function routeEngland(page: Page, extra: Record<string, unknown> = {}): Promise<{ tiles: string[]; boxes: string[] }> {
  const seen = { tiles: [] as string[], boxes: [] as string[] };
  await routeEnglandScope(page);
  await page.route("**/api/v1/map/coverage**", (route) => route.fulfill({ json: { ...COVERAGE, areaTiles: AREA_TILES, ...extra } }));
  await page.route("**/api/v1/tiles/areas/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    seen.tiles.push(path);
    const [kind, z, x, y] = path.split("/").slice(-4);
    const body = kind === "lsoa" ? squaresTile(kind, ALL_AREAS, Number(z), Number(x), Number(y.replace(".mvt", ""))) : Buffer.alloc(0);
    return body.length
      ? route.fulfill({ status: 200, body, headers: { "content-type": "application/vnd.mapbox-vector-tile" } })
      : route.fulfill({ status: 204 });
  });
  await page.route("**/api/v1/areas/boxes**", (route) => {
    const url = new URL(route.request().url());
    seen.boxes.push(url.toString());
    const areas = url.searchParams.get("carrier") === "lsoa" ? (AREAS[url.searchParams.get("chunk") ?? ""] ?? []) : [];
    return route.fulfill({ json: { schemaVersion: "area-boxes.v1", carrier: url.searchParams.get("carrier"),
      areas: areas.map((area) => [area.id, ...area.box]) } });
  });
  await page.route("**/api/v1/value-packs/**", (route) => {
    const url = new URL(route.request().url());
    const [metricId, period] = url.pathname.split("/").slice(-2);
    const chunks = (url.searchParams.get("chunk") ?? "").split(",").filter(Boolean);
    const carrier = url.searchParams.get("level") ?? "lsoa";
    const values = carrier !== "lsoa" ? [] : chunks.flatMap((chunk) => AREAS[chunk] ?? []).map((area) => ({
      geographyId: area.id, name: "", metricId, period, value: area.value, regionPercentile: area.london,
      countryPercentile: area.england, sampleCount: 10, quality: "observed", sourceVersion: "", carrier,
    }));
    return route.fulfill({ json: { schemaVersion: "area-value-pack.v1", metricId, period, sourceVersion: "", values } });
  });
  return seen;
}

/** The values the map paints for these areas (diagnostics): places on the colour scale, 0..100 on a rank. */
export async function paintedValues(page: Page, ids: readonly Area["id"][]): Promise<number[]> {
  const handle = await page.waitForFunction((wanted) => {
    const diagnostics = window.__closeKnitDiagnostics;
    const values = wanted.map((id) => diagnostics?.featureValue(id));
    return values.every((value) => typeof value === "number") ? values : null;
  }, ids, { timeout: 30_000 });
  return await handle.jsonValue() as number[];
}

/** No areas anywhere: every area tile and every piece's box index empty (a spec about the map's words or camera). */
export async function routeNoAreas(page: Page) {
  await page.route("**/api/v1/tiles/areas/**", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/v1/areas/boxes**", (route) => route.fulfill({ json: { schemaVersion: "area-boxes.v1", areas: [] } }));
}
