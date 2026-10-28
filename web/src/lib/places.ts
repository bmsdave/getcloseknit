import type { ChartTone } from "./chart-geometry";
import type { GeographyId } from "./contracts";
import type { DataMode } from "./map-state";

/**
 * Getting around and nearby (track H): the area-places.v1 contract served by
 * GET /api/v1/areas/{id}/places (api/area_api/places.py), labels in plain
 * words, and the connectivity score so demo fixtures use the API's formula.
 */
export type RailMode = "tube" | "elizabeth-line" | "dlr" | "overground" | "tram" | "national-rail";
/** gyms, pools, cafes and bars are lifestyle counts for the tailored Overview; cafes and bars also sit in food and pubs. */
export type AmenityGroup = "groceries" | "pubs" | "food" | "pharmacies" | "gps" | "gyms" | "pools" | "cafes" | "bars";
export type ParkSizeClass = "pocket" | "small" | "local" | "district" | "metropolitan" | "regional";

export interface PlaceLine { id: string; name: string; mode: RailMode }
/** bearingDegrees: direction from the origin, clockwise from north; absent when unknown. */
export interface NearbyStation {
  name: string;
  modes: RailMode[];
  zone: string | null;
  lines: PlaceLine[];
  distanceMetres: number;
  bearingDegrees?: number;
}
export interface NearbyPark {
  name: string;
  kind: string;
  areaHectares: number;
  sizeClass: ParkSizeClass;
  distanceMetres: number;
  bearingDegrees?: number;
}
export interface NearbyAmenity { name: string | null; kind: string; distanceMetres: number; bearingDegrees?: number }
export interface AmenityGroupSummary { group: AmenityGroup; countWithinWalk: number; nearest: NearbyAmenity[] }
export interface Connectivity { score: number; points: number; stationsCounted: number; radiusMetres: number }
export interface AreaPlacesResponse {
  schemaVersion: "area-places.v1";
  productReleaseId: string;
  geographyId: GeographyId;
  origin: { kind: "area-centre" | "home"; uprn: string | null };
  available: boolean;
  stations: NearbyStation[];
  parks: NearbyPark[];
  walkRadiusMetres: number;
  amenities: AmenityGroupSummary[];
  connectivity: Connectivity | null;
  /** false outside TfL's London: stations there have no fare zones, so none is shown (absent in an old payload). */
  fareZones?: boolean;
  sources: Array<{ id: string; licence: string; attribution: string }>;
  caveats: string[];
}

export type AreaPlacesState =
  | { status: "available"; places: AreaPlacesResponse }
  | { status: "unavailable"; reason: string };

/** The nearby-places list, in order. */
export const AMENITY_GROUPS: readonly AmenityGroup[] = ["groceries", "pubs", "food", "pharmacies", "gps"];
export const LIFESTYLE_AMENITY_GROUPS: readonly AmenityGroup[] = ["gyms", "pools", "cafes", "bars"];
/** Lifestyle counts are raw OpenStreetMap tallies, never a rating: say where they come from. */
export const AMENITY_COUNT_SOURCE = "on OpenStreetMap";

/** One of each group, as in "Nearest shop". */
export const AMENITY_SINGULAR: Record<AmenityGroup, string> = { groceries: "shop", pubs: "pub or bar", food: "place to eat", pharmacies: "pharmacy", gps: "GP",
  gyms: "gym", pools: "pool", cafes: "café", bars: "bar" };

export const AMENITY_LABELS: Record<AmenityGroup, string> = {
  groceries: "Shops",
  pubs: "Pubs and bars",
  food: "Cafés and restaurants",
  pharmacies: "Pharmacies",
  gps: "GPs",
  gyms: "Gyms",
  pools: "Pools",
  cafes: "Cafés",
  bars: "Bars",
};

const KIND_LABELS: Record<string, string> = {
  supermarket: "Supermarket",
  convenience: "Convenience shop",
  pub: "Pub",
  bar: "Bar",
  cafe: "Café",
  restaurant: "Restaurant",
  pharmacy: "Pharmacy",
  gp: "GP surgery",
  gym: "Gym",
  pool: "Pool",
  "sports-centre": "Sports centre",
};

export const MODE_LABELS: Record<RailMode, string> = {
  tube: "Tube",
  "elizabeth-line": "Elizabeth line",
  dlr: "DLR",
  overground: "Overground",
  tram: "Tram",
  "national-rail": "National Rail",
};

/** Ring colours by mode; a station takes its first mode in this order. */
const MODE_ORDER: readonly RailMode[] = ["tube", "elizabeth-line", "overground", "dlr", "tram", "national-rail"];
export const MODE_TONES: Record<RailMode, ChartTone> = {
  tube: "c1", "elizabeth-line": "c4", overground: "c2", dlr: "c3", tram: "c5", "national-rail": "c6",
};

export function stationMode(station: Pick<NearbyStation, "modes" | "lines">): RailMode | null {
  const modes = new Set<RailMode>([...station.modes, ...station.lines.map((line) => line.mode)]);
  return MODE_ORDER.find((mode) => modes.has(mode)) ?? null;
}

/**
 * Stations as DistanceRings points, coloured by mode. Unless every station
 * has a bearing, the points are spread evenly round the rings instead
 * (directions = false): the chart then shows distance only.
 */
export function stationRingPoints(stations: NearbyStation[]): {
  points: Array<{ id: string; label: string; distanceMetres: number; bearingDegrees: number; tone: ChartTone }>;
  directions: boolean;
} {
  const directions = stations.every((station) => typeof station.bearingDegrees === "number");
  return {
    directions,
    points: stations.map((station, index) => {
      const mode = stationMode(station);
      return {
        id: `${station.name}-${station.distanceMetres}`,
        label: station.name,
        distanceMetres: station.distanceMetres,
        bearingDegrees: directions ? station.bearingDegrees! : (index * 360) / stations.length,
        tone: mode ? MODE_TONES[mode] : "neutral",
      };
    }),
  };
}

/** Modes present among the stations, in legend order. */
export function stationModes(stations: NearbyStation[]): RailMode[] {
  const present = new Set(stations.map(stationMode));
  return MODE_ORDER.filter((mode) => present.has(mode));
}

/** London Plan open space sizes, in our words. */
export const SIZE_LABELS: Record<ParkSizeClass, string> = {
  pocket: "Pocket park",
  small: "Small park",
  local: "Local park",
  district: "Large park",
  metropolitan: "Very large park",
  regional: "Huge park",
};

// The score (mirrors api/area_api/places.py; tests/places.test.ts shares its vectors).
export const SCORE_RADIUS_METRES = 1200;
const FULL_CREDIT_METRES = 400;
const STATION_CAP = 4;
const SCORE_CAP = 6;
const MODE_WEIGHT: Record<RailMode, number> = {
  tube: 1, "elizabeth-line": 1, dlr: 1, overground: 1, tram: 0.7, "national-rail": 0.6,
};

type ScoredStation = Pick<NearbyStation, "distanceMetres"> & { lines: Array<Pick<PlaceLine, "mode">>; modes: RailMode[] };

export function stationPoints(station: ScoredStation): number {
  const distance = station.distanceMetres;
  if (distance > SCORE_RADIUS_METRES) return 0;
  const closeness = distance <= FULL_CREDIT_METRES
    ? 1
    : (SCORE_RADIUS_METRES - distance) / (SCORE_RADIUS_METRES - FULL_CREDIT_METRES);
  let service = station.lines.reduce((sum, line) => sum + (MODE_WEIGHT[line.mode] ?? 0), 0);
  if (service === 0) service = Math.max(0, ...station.modes.map((mode) => MODE_WEIGHT[mode] ?? 0));
  return closeness * Math.min(service, STATION_CAP);
}

export function connectivityScore(points: number): number {
  return 1 + Math.round(9 * Math.sqrt(Math.min(Math.max(points, 0), SCORE_CAP) / SCORE_CAP));
}

export function connectivity(stations: ScoredStation[]): Connectivity {
  const counted = stations.filter((station) => station.distanceMetres <= SCORE_RADIUS_METRES);
  const points = counted.reduce((sum, station) => sum + stationPoints(station), 0);
  return {
    score: connectivityScore(points),
    points: Math.round(points * 100) / 100,
    stationsCounted: counted.length,
    radiusMetres: SCORE_RADIUS_METRES,
  };
}

/** Plain words for a score; null (nothing loaded) is unknown, never 1. */
export function scoreWords(score: number | null | undefined): string {
  if (score == null) return "Unknown";
  if (score <= 2) return "Few trains nearby";
  if (score <= 4) return "Some trains nearby";
  if (score <= 6) return "Good";
  if (score <= 8) return "Very good";
  return "Excellent";
}

export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres / 10) * 10} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

/** Minutes on foot at 80 m a minute over the straight-line distance. */
export function walkMinutes(metres: number): number {
  return Math.max(1, Math.round(metres / 80));
}

/**
 * Minutes on foot for a station walk estimated from the straight-line
 * distance: the 1.3 routing detour the API uses for its own straight-line
 * estimates (api/area_api/personal_places.py DETOUR), at 80 m a minute.
 * Say "about": this is not timed along paths. Where the routed walk exists
 * (the station-access metric), use that instead.
 */
export function stationWalkMinutes(metres: number): number {
  return Math.max(1, Math.round((metres * 1.3) / 80));
}

/** The fare zone in words; null where fares have no zones (outside TfL's London, `fareZones` false). */
export function zoneLabel(station: Pick<NearbyStation, "zone" | "modes">, fareZones = true): string | null {
  if (station.zone) return `Zone ${station.zone}`;
  if (!fareZones) return null;
  if (station.modes.length > 0 && station.modes.every((mode) => mode === "tram")) return "No zones";
  return "Unknown";
}

/** Line names, or the modes when TfL lists no lines for the station. */
export function lineNames(station: Pick<NearbyStation, "lines" | "modes">): string[] {
  return station.lines.length > 0
    ? station.lines.map((line) => line.name)
    : station.modes.map((mode) => MODE_LABELS[mode]);
}

export function amenityName(amenity: NearbyAmenity): string {
  return amenity.name ?? `Unnamed ${(KIND_LABELS[amenity.kind] ?? amenity.kind).toLowerCase()}`;
}

export function amenityKind(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

export function placesPath(query: { selected: GeographyId; uprn: string | null; mode: DataMode; release: string }): string {
  const parameters = new URLSearchParams({ mode: query.mode, release: query.release });
  if (query.uprn) parameters.set("uprn", query.uprn);
  return `/api/v1/areas/${encodeURIComponent(query.selected)}/places?${parameters.toString()}`;
}

/** Parse a places payload; real mode never accepts preview fixtures. */
export function readAreaPlaces(payload: unknown, mode: DataMode): AreaPlacesState {
  const places = payload as Partial<AreaPlacesResponse> | null;
  if (!places || places.schemaVersion !== "area-places.v1" || !Array.isArray(places.stations)
    || !Array.isArray(places.parks) || !Array.isArray(places.amenities)) {
    return { status: "unavailable", reason: "invalid-places-response" };
  }
  if (mode === "real" && (places.productReleaseId?.startsWith("preview-")
    || places.sources?.some((source) => source.id.startsWith("preview-")))) {
    return { status: "unavailable", reason: "fixture-places-in-real-mode" };
  }
  if (!places.available) return { status: "unavailable", reason: "places-not-loaded" };
  return { status: "available", places: places as AreaPlacesResponse };
}

/** Groups the API also counts inside a wider one (places.py: a café is food too, a bar is a pub too). */
const INSIDE: Partial<Record<AmenityGroup, AmenityGroup>> = { cafes: "food", bars: "pubs" };

/**
 * A section's count and its nearest places, each place once: a café is both "food" and "cafes", so the
 * wider group's count already holds it and the list shows it once (under its own, narrower group).
 */
export function groupPlaces(entries: readonly AmenityGroupSummary[], listed: number) {
  const groups = new Set(entries.map((entry) => entry.group));
  const total = entries
    .filter((entry) => !(INSIDE[entry.group] && groups.has(INSIDE[entry.group]!)))
    .reduce((sum, entry) => sum + entry.countWithinWalk, 0);
  const seen = new Set<string>();
  const nearest = [...entries]
    // The narrower groups first, so a café keeps its café icon.
    .sort((a, b) => Number(!INSIDE[a.group]) - Number(!INSIDE[b.group]))
    .flatMap((entry) => entry.nearest.map((amenity) => ({ ...amenity, group: entry.group })))
    .filter((amenity) => {
      const key = `${amenity.name ?? ""}|${amenity.kind}|${amenity.distanceMetres}|${amenity.bearingDegrees ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.distanceMetres - b.distanceMetres)
    .slice(0, listed);
  return { total, nearest };
}
