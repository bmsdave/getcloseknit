/**
 * What the map's first view will fetch, named in the page's <head> (app/page.tsx) so the requests start with the
 * HTML instead of after the scripts have loaded and the explorer has booted (perf/layer-load, phase C): the metric
 * catalogue and the coverage it waits for, MapLibre's worker, and on a London start London's boxes and the layer's
 * pack, elsewhere in England the boxes (and packs) of the pieces in view: the requests components/area-map.tsx makes
 * first. Every one is cacheable, so a guess that misses (another month, a saved view) costs one unused download,
 * never a wrong map. The server does not know the screen: a piece is named only when a phone's view holds it too,
 * and a pack (one request for every piece) only when a phone and a laptop see the same pieces.
 */
import type { Carrier, MetricCoverage } from "./contracts";
import {
  londonPiece, NEIGHBOURHOOD_ZOOM, pieceBoxesPath, piecePackPath, piecesKey, viewPackPaths, viewPieces, type Bbox, type MapCoverage,
} from "./map-coverage";
import { MAPLIBRE_WORKER_URL } from "./map-core";
import { isLayerAvailableInMode, LONDON_BOUNDS, MIN_MAP_ZOOM, valuePackPath, type MapState } from "./map-state";
import { piecesWithValues } from "./map-topics";
import { isDetailLayer } from "./nature-layers";
import { withRelease } from "./release-url";

/** A metric as the catalogue gives it: what the first pack's URL needs. */
export interface CatalogueLayer {
  carrier: Carrier;
  defaultPeriod: string;
  periods: readonly string[];
  /** Where it has values (the catalog's coverage): no preload of a piece outside its regions. */
  coverage?: MetricCoverage[];
}

/** Whether a camera opens on London (the London map's one piece loads first). */
export function isLondonStart(camera: { latitude: number; longitude: number; zoom: number }): boolean {
  const [[west, south], [east, north]] = LONDON_BOUNDS;
  return camera.zoom >= MIN_MAP_ZOOM && camera.longitude >= west && camera.longitude <= east
    && camera.latitude >= south && camera.latitude <= north;
}

/** The [west, south, east, north] a camera shows in a `width` x `height` map (512-pixel tiles, Web Mercator). */
export function cameraBbox(latitude: number, longitude: number, zoom: number, width: number, height: number): Bbox {
  const world = 512 * 2 ** zoom;
  const halfLongitude = (width / 2 / world) * 360;
  const y = Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360));
  const halfY = (height / 2 / world) * 2 * Math.PI;
  const toLatitude = (value: number) => (Math.atan(Math.exp(value)) * 360) / Math.PI - 90;
  return [longitude - halfLongitude, toLatitude(y - halfY), longitude + halfLongitude, toLatitude(y + halfY)];
}

/** The smallest and largest maps the server assumes (a phone, a laptop) when it names the pieces in view. */
const PHONE = { width: 360, height: 640 };
const LAPTOP = { width: 1440, height: 900 };

/**
 * The URLs to preload (as fetch) for a map opening on `state`. `linkedPeriod`: the link named its month; else the
 * layer's default month is the one the map asks for (lib/map-period.ts). `layers`: the release's catalogue, by id.
 * `coverage`: the map's (null: unknown, only London's start is named).
 */
export function mapPreloads(state: MapState, options: {
  linkedPeriod: boolean;
  layers: Readonly<Record<string, CatalogueLayer>> | null;
  coverage?: MapCoverage | null;
}): string[] {
  const shared = MAPLIBRE_WORKER_URL.replace(/maplibre-gl-worker\.mjs$/, "maplibre-gl-shared.mjs");
  const urls = [MAPLIBRE_WORKER_URL, shared];
  if (state.mode !== "real") return urls;
  // The explorer's catalogue (lib/section-seed.ts METRICS_PATH) and the map's coverage (lib/map-coverage.ts).
  urls.push("/api/v1/metrics", withRelease("/api/v1/map/coverage", state.release));
  const layer = options.layers?.[state.layer];
  const packed = layer && !state.layer.startsWith("custom:") && !isDetailLayer(state.layer) && state.layer !== "personal-match"
    && isLayerAvailableInMode(state.layer, state.mode);
  const period = !layer ? "" : options.linkedPeriod && layer.periods.includes(state.period) ? state.period : layer.defaultPeriod;
  const base = packed && period ? valuePackPath({ metric: state.layer, period, mode: state.mode, release: state.release }) : null;
  const coverage = options.coverage;
  // A piece's boxes (lib/area-boxes.ts); the area tiles themselves load with the map.
  if (isLondonStart(state) && state.zoom >= NEIGHBOURHOOD_ZOOM) {
    urls.push(pieceBoxesPath(londonPiece("lsoa"), state.release, coverage?.productReleaseId ?? null));
    if (base && layer) urls.push(piecePackPath(base, londonPiece(layer.carrier), coverage?.productReleaseId ?? null));
    return urls;
  }
  if (!layer || !base || coverage?.coverage !== "england") return urls;
  const inView = (size: { width: number; height: number }) => viewPieces(coverage, state.mode, layer.carrier,
    cameraBbox(state.latitude, state.longitude, state.zoom, size.width, size.height), state.zoom);
  const phone = inView(PHONE);
  const version = coverage.productReleaseId;
  for (const entry of phone) urls.push(pieceBoxesPath(entry, state.release, version));
  const valued = piecesWithValues(phone, layer, coverage);
  if (phone.length && piecesKey(phone) === piecesKey(inView(LAPTOP))) urls.push(...viewPackPaths(base, valued, version));
  return urls;
}
