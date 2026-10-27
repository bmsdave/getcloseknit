// AE-23: source-specific flood screening for candidate places.
//
// First release covers one reviewed Environment Agency dataset (rivers
// and sea). Locations report polygon intersection; coarse areas report
// area exposure, never building-level risk. Other mechanisms are
// separately named observations, never merged into one score. Missing
// coverage is distinct from no mapped exposure, and insurance-cost
// prediction is unsupported by design.
import { FLOOD_CHECK_URL, type GeographyId } from "./contracts";

export { FLOOD_CHECK_URL };

export const FLOOD_SOURCE_ID = "ea-flood-risk-rivers-sea";
export const PRIMARY_FLOOD_MECHANISM = "rivers-sea";
export const LOCATION_SEMANTICS = "polygon-intersection";
export const AREA_SEMANTICS = "area-exposure";

export const AREA_LEVEL_NOTE =
  "Mapped exposure describes the area polygon, not every building in " +
  "it: a small exposed section never means each building shares the risk.";

export type FloodMechanism = "rivers-sea" | "surface-water";
export type FloodStatus = "exposed" | "no-mapped-exposure" | "no-coverage";
export type FloodRing = [number, number][];

export interface FloodZone {
  name: FloodMechanism;
  label: string;
  ring: FloodRing;
}

export interface FloodLocationScreening {
  status: FloodStatus;
  intersections: [FloodMechanism, boolean][];
  explanation: string;
}

export interface FloodAreaScreening {
  semantics: typeof AREA_SEMANTICS;
  exposures: Record<FloodMechanism, number>;
  explanation: string;
}

export interface ScreenedCandidate {
  geographyId: GeographyId;
  name: string;
  box: FloodRing;
}

// Reviewed reference sample: planar screening polygons on the
// publication geometry (EPSG:4326), mirroring the reviewed ingestion
// fixture flood/ea-rofrs-sample.geojson.
export const REVIEWED_FLOOD_COVERAGE: FloodRing = [
  [-0.2, 51.48], [-0.06, 51.48], [-0.06, 51.58], [-0.2, 51.58], [-0.2, 51.48],
];

export const REVIEWED_FLOOD_ZONES: FloodZone[] = [
  {
    name: "rivers-sea",
    label: "Rivers and sea (reviewed Environment Agency dataset)",
    ring: [
      [-0.17, 51.49], [-0.11, 51.49], [-0.11, 51.52], [-0.17, 51.52],
      [-0.17, 51.49],
    ],
  },
  {
    name: "surface-water",
    label: "Surface water (separately named observation)",
    ring: [
      [-0.15, 51.5], [-0.09, 51.5], [-0.09, 51.54], [-0.15, 51.54],
      [-0.15, 51.5],
    ],
  },
];

// Coarse screening boxes for the preview candidates: bounding boxes,
// not building outlines, so every share below stays area exposure.
export const SCREENED_CANDIDATES: ScreenedCandidate[] = [
  {
    geographyId: "uk:lsoa:E01000001",
    name: "Westminster preview",
    box: box(-0.168, 51.489, -0.113, 51.528),
  },
  {
    geographyId: "uk:lsoa:E01000002",
    name: "North London preview",
    box: box(-0.123, 51.523, -0.068, 51.57),
  },
  {
    geographyId: "uk:lsoa:E01000003",
    name: "South Bank preview",
    box: box(-0.119, 51.479, -0.04, 51.53),
  },
];

export function assessFloodLocation(
  lon: number,
  lat: number,
  zones: FloodZone[] = REVIEWED_FLOOD_ZONES,
  coverage: FloodRing = REVIEWED_FLOOD_COVERAGE,
): FloodLocationScreening {
  const point: [number, number] = [lon, lat];
  if (!pointInRing(point, coverage)) {
    return {
      status: "no-coverage",
      intersections: [],
      explanation: "Outside the reviewed screening coverage: treat flood " +
        "exposure as unknown and check the official flood service.",
    };
  }
  const intersections = zones.map(
    (zone): [FloodMechanism, boolean] => [zone.name, pointInRing(point, zone.ring)],
  );
  const exposed = intersections.filter(([, hit]) => hit).map(([name]) => name);
  if (exposed.length === 0) {
    return {
      status: "no-mapped-exposure",
      intersections,
      explanation: "No mapped exposure inside the reviewed screening " +
        "coverage: no zone polygon intersects this location. Absence from " +
        "the mapped extent is not a guarantee; check the official flood " +
        "service for the property-specific position.",
    };
  }
  return { status: "exposed", intersections, explanation: exposedExplanation(exposed) };
}

export function assessFloodArea(
  ring: FloodRing,
  zones: FloodZone[] = REVIEWED_FLOOD_ZONES,
): FloodAreaScreening {
  requireRectangle(ring);
  const exposures = Object.fromEntries(
    zones.map((zone) => [zone.name, overlapFraction(ring, zone.ring)]),
  ) as Record<FloodMechanism, number>;
  const shares = Object.entries(exposures)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, share]) => `${name}: ${(share * 100).toFixed(1)}%`)
    .join(", ");
  return {
    semantics: AREA_SEMANTICS,
    exposures,
    explanation: `Coarse area exposure (${LOCATION_SEMANTICS} for points, ` +
      `${AREA_SEMANTICS} for areas): ${shares}. ${AREA_LEVEL_NOTE}`,
  };
}

export function assessScreenedCandidate(
  geographyId: GeographyId,
): { candidate: ScreenedCandidate; screening: FloodAreaScreening } | null {
  const candidate = SCREENED_CANDIDATES.find((entry) => entry.geographyId === geographyId);
  if (!candidate) return null;
  return { candidate, screening: assessFloodArea(candidate.box) };
}

export function estimateInsuranceCost(..._args: unknown[]): never {
  throw new Error(
    "insurance-cost prediction is unsupported: show mapped exposure " +
    "and link the official flood check, never a price",
  );
}

function exposedExplanation(exposed: FloodMechanism[]): string {
  const extra = exposed.filter((name) => name !== PRIMARY_FLOOD_MECHANISM);
  const separate = extra.length === 0
    ? ""
    : ` ${extra.join(", ")} is a separately named observation, never ` +
      "merged into the rivers-and-sea screening.";
  return `Mapped exposure under ${exposed.join(", ")} (${LOCATION_SEMANTICS} ` +
    `for a location).${separate} ${AREA_LEVEL_NOTE} Check the official ` +
    "flood service for the property-specific position.";
}

function pointInRing(point: [number, number], ring: FloodRing): boolean {
  if (ring.some((_, index) => pointOnSegment(point, ring[index - 1] ?? ring[ring.length - 1], ring[index]))) {
    return true;
  }
  let inside = false;
  for (let index = 0; index < ring.length; index += 1) {
    const previous = ring[index - 1] ?? ring[ring.length - 1];
    if (rayCrosses(point, previous, ring[index])) inside = !inside;
  }
  return inside;
}

function pointOnSegment(
  point: [number, number],
  first: [number, number],
  second: [number, number],
): boolean {
  const cross = (second[0] - first[0]) * (point[1] - first[1])
    - (second[1] - first[1]) * (point[0] - first[0]);
  if (Math.abs(cross) > 1e-12) return false;
  return Math.min(first[0], second[0]) - 1e-12 <= point[0]
    && point[0] <= Math.max(first[0], second[0]) + 1e-12
    && Math.min(first[1], second[1]) - 1e-12 <= point[1]
    && point[1] <= Math.max(first[1], second[1]) + 1e-12;
}

function rayCrosses(
  point: [number, number],
  first: [number, number],
  second: [number, number],
): boolean {
  if ((first[1] > point[1]) === (second[1] > point[1])) return false;
  const crossing = first[0] + ((point[1] - first[1]) * (second[0] - first[0])) / (second[1] - first[1]);
  return crossing > point[0];
}

function requireRectangle(ring: FloodRing): void {
  const longitudes = new Set(ring.map(([lon]) => lon));
  const latitudes = new Set(ring.map(([, lat]) => lat));
  const corners = new Set(ring.map(([lon, lat]) => `${lon},${lat}`));
  const expected = new Set(
    [...longitudes].flatMap((lon) => [...latitudes].map((lat) => `${lon},${lat}`)),
  );
  if (longitudes.size !== 2 || latitudes.size !== 2 || corners.size !== expected.size
    || [...corners].some((corner) => !expected.has(corner))) {
    throw new Error("area screening needs an axis-aligned rectangle");
  }
}

function overlapFraction(area: FloodRing, zone: FloodRing): number {
  requireRectangle(zone);
  const [west, south, east, north] = rectBounds(area);
  const [zoneWest, zoneSouth, zoneEast, zoneNorth] = rectBounds(zone);
  const width = Math.min(east, zoneEast) - Math.max(west, zoneWest);
  const height = Math.min(north, zoneNorth) - Math.max(south, zoneSouth);
  if (width <= 0 || height <= 0) return 0;
  return (width * height) / ((east - west) * (north - south));
}

function rectBounds(ring: FloodRing): [number, number, number, number] {
  const longitudes = ring.map(([lon]) => lon);
  const latitudes = ring.map(([, lat]) => lat);
  return [Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)];
}

function box(west: number, south: number, east: number, north: number): FloodRing {
  return [[west, south], [east, south], [east, north], [west, north], [west, south]];
}
