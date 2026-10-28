/**
 * The box index: each area's [west, south, east, north], per view piece (GET /api/v1/areas/boxes, area-boxes.v1).
 * The shapes reach the map as vector tiles only (lib/area-tiles.ts); what the map still needs of them besides
 * drawing them is each area's box: the in-view scale, the view's region and fitting an area. Demo data reads its
 * fixtures' boxes.
 */
import { carrierOfId, type Carrier, type GeographyId, type ValuePackEntry } from "./contracts";
import { areaGeoJson } from "./fixtures";
import { pieceBoxesPath, type Bbox, type ViewPiece } from "./map-coverage";
import type { DataMode } from "./map-state";
import { mapFetch } from "./polite-fetch";
import { withRelease } from "./release-url";

/** One area's box; `region`: the region code of the piece it came in (England's map: which scale a view is on). */
export interface AreaBox {
  id: GeographyId;
  bbox: Bbox;
  region?: string | null;
}

/** The areas one paint draws, in its pack's order. */
export type AreaBoxes = readonly AreaBox[];

/** area-boxes.v1, as the API sends it. */
interface BoxesBody {
  schemaVersion: "area-boxes.v1";
  areas: [id: string, west: number, south: number, east: number, north: number][];
}

function isBoxesBody(body: unknown): body is BoxesBody {
  const value = body as Partial<BoxesBody> | null;
  return !!value && value.schemaVersion === "area-boxes.v1" && Array.isArray(value.areas);
}

/** One request per URL (carrier, piece and release are in it). */
const requests = new Map<string, Promise<AreaBox[]>>();
/** Every box loaded, by id: one object per area however many pieces hold it. */
const known = new Map<string, AreaBox>();

export function clearBoxCache(): void {
  requests.clear();
  known.clear();
}

/** An area's box once any piece holding it has loaded (the saved ♡ sits at its middle), else null. */
export function knownAreaBox(id: string): Bbox | null {
  return known.get(id)?.bbox ?? null;
}

function fetchBoxes(path: string, carrier: Carrier): Promise<AreaBox[]> {
  const cached = requests.get(path);
  if (cached) return cached;
  const pending = mapFetch(path).then(async (response) => {
    const body = response.ok ? (await response.json()) as unknown : null;
    if (!isBoxesBody(body)) throw new Error(`area boxes unavailable for ${carrier}`);
    return body.areas.map(([id, west, south, east, north]) => {
      const box = known.get(id) ?? { id: id as GeographyId, bbox: [west, south, east, north] as Bbox };
      known.set(id, box);
      return box;
    });
  });
  requests.set(path, pending);
  pending.catch(() => { if (requests.get(path) === pending) requests.delete(path); });
  return pending;
}

/** A shape's [west, south, east, north]. */
function geometryBox(coordinates: unknown): Bbox {
  const box: Bbox = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (value: unknown): void => {
    if (Array.isArray(value) && typeof value[0] === "number") {
      box[0] = Math.min(box[0], value[0]); box[1] = Math.min(box[1], value[1] as number);
      box[2] = Math.max(box[2], value[0]); box[3] = Math.max(box[3], value[1] as number);
    } else if (Array.isArray(value)) value.forEach(visit);
  };
  visit(coordinates);
  return box;
}

/** Demo data's boxes: its fixture areas' of every kind (a sparse area's value is its MSOA's in an LSOA pack). */
function demoBoxes(): AreaBox[] {
  return DEMO_KINDS.flatMap((carrier) => areaGeoJson(carrier).features.map((feature) => {
    const box = known.get(feature.properties.geography_id)
      ?? { id: feature.properties.geography_id, bbox: geometryBox(feature.geometry.coordinates) };
    known.set(box.id, box);
    return box;
  }));
}
const DEMO_KINDS: readonly Carrier[] = ["lsoa", "msoa", "lad"];

/** One piece's boxes; demo data's from its fixtures. */
function pieceBoxes(entry: ViewPiece, mode: DataMode, release?: string | null, version: string | null = null): Promise<AreaBox[]> {
  return mode === "demo" ? Promise.resolve(demoBoxes()) : fetchBoxes(pieceBoxesPath(entry, release, version), entry.carrier);
}

/**
 * The boxes of a paint's areas: its pieces' (null: every area of the values' carrier, a match pack's own areas), in
 * the values' order. `regionOf` names each piece's region; `partial`: the values cover more than the pieces (a
 * client pack with every LSOA), the areas outside are left out; otherwise an area without a box fails the paint.
 */
export async function paintBoxes(values: readonly ValuePackEntry[], pieces: readonly ViewPiece[] | null, mode: DataMode,
  release?: string | null, version: string | null = null,
  regionOf: (chunk: string | null) => string | null = () => null, partial = false): Promise<AreaBoxes> {
  const carrier = values[0]?.carrier ?? pieces?.[0]?.carrier ?? "lsoa";
  const loaded = pieces
    ? await Promise.all(pieces.map((entry) => pieceBoxes(entry, mode, release, version)))
    : [mode === "demo" ? demoBoxes() : await fetchBoxes(allBoxesPath(carrier, release), carrier)];
  const held = new Set<AreaBox>();
  loaded.forEach((boxes, index) => {
    const region = pieces ? regionOf(pieces[index].chunk) : null;
    for (const box of boxes) {
      if (region) box.region = region;
      held.add(box);
    }
  });
  const shown: AreaBox[] = [];
  for (const value of values) {
    const box = known.get(value.geographyId);
    if (box && held.has(box)) shown.push(box);
    else if (!partial) throw new Error(`area box missing for ${value.geographyId}`);
  }
  return shown;
}

/** Every area of a paint's pieces (each with its piece's region), valued or not: lib/no-data.ts greys the latter. */
export async function pieceAreas(pieces: readonly ViewPiece[], mode: DataMode, release?: string | null,
  version: string | null = null, regionOf: (chunk: string | null) => string | null = () => null): Promise<AreaBox[]> {
  const loaded = await Promise.all(pieces.map((entry) => pieceBoxes(entry, mode, release, version)));
  return loaded.flatMap((boxes, index) => {
    const region = regionOf(pieces[index].chunk);
    if (region) for (const box of boxes) box.region = region;
    return boxes;
  });
}

/** One area's box from the pieces that hold its kind (lib/map-coverage.ts shapePieces), else every area of it. */
export async function areaBox(id: GeographyId, mode: DataMode, release?: string | null,
  pieces?: readonly ViewPiece[], version: string | null = null): Promise<Bbox | null> {
  const carrier = carrierOfId(id);
  if (mode === "demo") demoBoxes();
  else if (pieces) await Promise.all(pieces.map((entry) => pieceBoxes(entry, mode, release, version)));
  else await fetchBoxes(withRelease(`/api/v1/areas/boxes?carrier=${encodeURIComponent(carrier)}`, release), carrier);
  return knownAreaBox(id);
}

/** Starts one piece's boxes now (the map's first view, at mount), alongside its value pack. */
function allBoxesPath(carrier: Carrier, release?: string | null): string {
  return withRelease(`/api/v1/areas/boxes?carrier=${encodeURIComponent(carrier)}`, release);
}

/**
 * Every area's box of a level, asked for while My match is scored (G-E29): a match pack is painted over all its areas'
 * boxes, so they no longer wait for the pack (~0.5 s after it on a shared search).
 */
export function prefetchAllBoxes(carrier: Carrier, release?: string | null): void {
  fetchBoxes(allBoxesPath(carrier, release), carrier).catch(() => undefined);
}

export function prefetchPieceBoxes(entry: ViewPiece, release?: string | null, version: string | null = null): void {
  fetchBoxes(pieceBoxesPath(entry, release, version), entry.carrier).catch(() => undefined);
}
