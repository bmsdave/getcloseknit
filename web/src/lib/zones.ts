import {
  ANY_OF_POINTS, assertZones, isLatLon, MAX_ZONE_LSOAS, MAX_ZONES, POLYGON_POINTS, type GeographyId,
  type MatchZone, type PlaceTarget, type StationSearchResult,
} from "./contracts";
import { loadedScope, type ServedScope } from "./scope";
import { areaGeoJson, parentGeographyId } from "./fixtures";

export const ZONE_LIMIT = "zone:outside";

interface PreviewStation extends StationSearchResult {
  // Median walk minutes from each preview LSOA, as lsoa_station_walk stores them.
  walks: Partial<Record<GeographyId, number>>;
}

// Preview-only stations; real mode reads the TfL/NaPTAN station table (place_station, #241).
export const PREVIEW_STATIONS: PreviewStation[] = [
  {
    stationId: "osm:n9000001", name: "Westminster preview station", modes: ["tube"], zone: "1",
    lines: [{ id: "jubilee", name: "Jubilee", mode: "tube" }],
    center: [-0.1248, 51.501], walks: { "uk:lsoa:E01000001": 6, "uk:lsoa:E01000003": 14 },
  },
  {
    stationId: "osm:n9000002", name: "Highbury preview station", modes: ["tube", "overground", "national-rail"], zone: "2",
    lines: [{ id: "victoria", name: "Victoria", mode: "tube" }, { id: "mildmay", name: "Mildmay", mode: "overground" }],
    center: [-0.104, 51.546], walks: { "uk:lsoa:E01000002": 8 },
  },
  {
    stationId: "osm:n9000003", name: "Waterloo preview station", modes: ["national-rail", "tube"], zone: "1",
    lines: [],
    center: [-0.1131, 51.5031], walks: { "uk:lsoa:E01000003": 5, "uk:lsoa:E01000001": 18 },
  },
];

const PREVIEW_LSOAS: GeographyId[] = ["uk:lsoa:E01000001", "uk:lsoa:E01000002", "uk:lsoa:E01000003"];
// Representative [latitude, longitude] of each preview LSOA (the preview origins in matching.ts).
const PREVIEW_POINTS: Record<string, [number, number]> = {
  "uk:lsoa:E01000001": [51.501, -0.1416], "uk:lsoa:E01000002": [51.545, -0.094], "uk:lsoa:E01000003": [51.503, -0.089],
};

export function searchPreviewStations(query: string): StationSearchResult[] {
  const needle = query.trim().toLocaleLowerCase("en-GB");
  if (needle.length < 2) return [];
  return PREVIEW_STATIONS
    .filter((station) => station.name.toLocaleLowerCase("en-GB").includes(needle))
    .map(({ walks: _walks, ...station }) => station);
}

/** Preview mirror of repository.zone_lsoas: null when there are no zones. */
export function previewZoneLsoas(zones: MatchZone[] | undefined): Set<GeographyId> | null {
  if (!zones?.length) return null;
  const found = new Set<GeographyId>();
  for (const zone of zones) {
    if (zone.kind === "lsoas") zone.ids.forEach((id) => found.add(id));
    if (zone.kind === "borough") {
      PREVIEW_LSOAS.filter((id) => boroughOf(id) === zone.id).forEach((id) => found.add(id));
    }
    if (zone.kind === "polygon") {
      PREVIEW_LSOAS.filter((id) => insidePolygon(PREVIEW_POINTS[id], zone.points)).forEach((id) => found.add(id));
    }
    if (zone.kind === "station") {
      const walks = PREVIEW_STATIONS.find((station) => station.stationId === zone.stationId)?.walks ?? {};
      for (const [id, minutes] of Object.entries(walks)) {
        if (minutes !== undefined && minutes <= zone.maxWalkMinutes) found.add(id as GeographyId);
      }
    }
  }
  return found;
}

/** A zone's outline for the map (POST /api/v1/zone-shapes); null for a drawn polygon (drawn from its corners). */
export interface ZoneShape {
  kind: MatchZone["kind"];
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null;
}
export interface ZoneShapesResponse {
  schemaVersion: "zone-shapes.v1";
  zones: ZoneShape[];
}

/** The preview's answer: each zone's preview areas as one MultiPolygon (the API unions the real LSOAs). */
export function previewZoneShapes(zones: MatchZone[]): ZoneShapesResponse {
  const shapes = new Map(areaGeoJson("lsoa").features.map((feature) => [feature.properties.geography_id, feature.geometry]));
  return {
    schemaVersion: "zone-shapes.v1",
    zones: zones.map((zone) => {
      if (zone.kind === "polygon") return { kind: zone.kind, geometry: null };
      const polygons = [...(previewZoneLsoas([zone]) ?? [])].sort().flatMap((id) => {
        const shape = shapes.get(id);
        return !shape ? [] : shape.type === "Polygon" ? [shape.coordinates] : shape.coordinates;
      });
      return { kind: zone.kind, geometry: polygons.length ? { type: "MultiPolygon", coordinates: polygons } : null };
    }),
  };
}

/** Ray casting on [latitude, longitude] corners; the preview stand-in for ST_Intersects. */
export function insidePolygon([lat, lon]: [number, number], points: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [latI, lonI] = points[i];
    const [latJ, lonJ] = points[j];
    if ((latI > lat) !== (latJ > lat) && lon < (lonJ - lonI) * (lat - latI) / (latJ - latI) + lonI) inside = !inside;
  }
  return inside;
}

function boroughOf(lsoa: GeographyId): GeographyId | null {
  const msoa = parentGeographyId(lsoa);
  return msoa ? parentGeographyId(msoa) : null;
}

/** Plain-language description of one zone, for the review step and the share preview. */
export function describeZone(zone: MatchZone): string {
  if (zone.kind === "station") {
    return `Within ${zone.maxWalkMinutes} min walk of ${zone.label ?? zone.stationId}`;
  }
  if (zone.kind === "borough") return `In ${zone.label ?? zone.id.split(":")[2]}`;
  if (zone.kind === "polygon") return zone.label ?? `An area you drew (${zone.points.length} corners)`;
  const count = `${zone.ids.length} chosen ${zone.ids.length === 1 ? "neighbourhood" : "neighbourhoods"}`;
  return zone.label ? `${zone.label} (${count})` : count;
}

/** The zones with one more added; the same array when it cannot be added. */
export function addZone(zones: MatchZone[], zone: MatchZone): MatchZone[] {
  if (zone.kind === "lsoas") {
    const index = zones.findIndex((item) => item.kind === "lsoas");
    if (index >= 0) {
      const existing = zones[index] as Extract<MatchZone, { kind: "lsoas" }>;
      const ids = [...new Set([...existing.ids, ...zone.ids])];
      if (ids.length === existing.ids.length || ids.length > MAX_ZONE_LSOAS) return zones;
      return zones.map((item, position) => position === index ? { ...existing, ids } : item);
    }
  }
  if (zones.length >= MAX_ZONES || zones.some((item) => zoneKey(item) === zoneKey(zone))) return zones;
  return [...zones, zone];
}

export function zoneKey(zone: MatchZone): string {
  if (zone.kind === "station") return `station:${zone.stationId}`;
  if (zone.kind === "borough") return `borough:${zone.id}`;
  if (zone.kind === "polygon") return `polygon:${zone.points.map((point) => point.join(",")).join(";")}`;
  return "lsoas";
}

/**
 * A finished drawing as a zone, or null when it is not one (too few corners, outside the served scope's box: London's,
 * or England's by CLOSE_KNIT_ENGLAND, as the API checks it).
 */
export function drawnZone(points: [number, number][], label?: string, scope: ServedScope = loadedScope()): MatchZone | null {
  const zone: MatchZone = { kind: "polygon", points: points.slice(0, POLYGON_POINTS.max), ...(label ? { label } : {}) };
  try {
    assertZones([zone]);
    const [west, south, east, north] = scope.bbox;
    return zone.points.every((point) => isLatLon(point, { latitude: [south, north], longitude: [west, east] })) ? zone : null;
  } catch {
    return null;
  }
}

/** A pinned place with one more point it may be near instead ("either office"); null when it cannot take one. */
export function addAlternative(target: PlaceTarget, latitude: number, longitude: number): PlaceTarget | null {
  const points = target.kind === "point" ? [[target.latitude, target.longitude] as [number, number]]
    : target.kind === "any-of" ? target.points : null;
  if (!points || points.length >= ANY_OF_POINTS.max) return null;
  return { kind: "any-of", points: [...points, [latitude, longitude]] };
}

/** Back to the first point only. */
export function firstPointOnly(target: PlaceTarget): PlaceTarget {
  if (target.kind !== "any-of") return target;
  const [latitude, longitude] = target.points[0];
  return { kind: "point", latitude, longitude };
}

/** The drawing bar: "Tap corners · 4 so far", the corners of the zone being drawn, never of one finished. */
export function drawBarStatus(corners: number): { lead: string; count: string } {
  return { lead: "Tap corners", count: ` · ${corners} so far` };
}
