import type { Feature, FeatureCollection, Polygon } from "geojson";

import type { GeographyId, MetricId, ValuePack, ValuePackEntry } from "./contracts";

export const LONDON_LSOA_COUNT = 4835;
export const LONDON_BBOX = { west: -0.52, south: 51.28, east: 0.34, north: 51.7 };

export interface LondonScaleArea {
  geographyId: GeographyId;
  name: string;
  polygon: Polygon;
  center: [number, number];
}

export interface LondonScaleFixture {
  seed: number;
  areas: LondonScaleArea[];
}

export function buildLondonScaleFixture(seed: number, count = LONDON_LSOA_COUNT): LondonScaleFixture {
  const random = mulberry32(seed);
  const columns = Math.ceil(Math.sqrt(count * bboxAspect()));
  const rows = Math.ceil(count / columns);
  const areas: LondonScaleArea[] = [];
  for (let index = 0; index < count; index += 1) {
    areas.push(buildArea(index, columns, rows, random));
  }
  return { seed, areas };
}

export function londonScaleValuePack(
  fixture: LondonScaleFixture,
  metricId: MetricId,
  period: string,
): ValuePack {
  return {
    schemaVersion: "area-value-pack.v1",
    metricId,
    period,
    sourceVersion: `london-scale-seed-${fixture.seed}`,
    values: fixture.areas.map((area, index) => valueEntry(area, metricId, period, index)),
  };
}

export function londonScaleGeoJson(
  fixture: LondonScaleFixture,
): FeatureCollection<Polygon, { name: string; geography_id: GeographyId }> {
  return {
    type: "FeatureCollection",
    features: fixture.areas.map((area): Feature<Polygon, { name: string; geography_id: GeographyId }> => ({
      type: "Feature",
      properties: { name: area.name, geography_id: area.geographyId },
      geometry: area.polygon,
    })),
  };
}

function buildArea(index: number, columns: number, rows: number, random: () => number): LondonScaleArea {
  const column = index % columns;
  const row = Math.floor(index / columns);
  const west = LONDON_BBOX.west + ((LONDON_BBOX.east - LONDON_BBOX.west) * column) / columns;
  const south = LONDON_BBOX.south + ((LONDON_BBOX.north - LONDON_BBOX.south) * row) / rows;
  const east = LONDON_BBOX.west + ((LONDON_BBOX.east - LONDON_BBOX.west) * (column + 1)) / columns;
  const north = LONDON_BBOX.south + ((LONDON_BBOX.north - LONDON_BBOX.south) * (row + 1)) / rows;
  const ring = jitteredRing(west, south, east, north, random);
  const code = `E01${String(100001 + index).padStart(6, "0")}`;
  return {
    geographyId: `uk:lsoa:${code}`,
    name: `London LSOA ${code}`,
    polygon: { type: "Polygon", coordinates: [ring] },
    center: [(west + east) / 2, (south + north) / 2],
  };
}

function jitteredRing(west: number, south: number, east: number, north: number, random: () => number): number[][] {
  const width = east - west;
  const height = north - south;
  const inset = () => 0.08 + random() * 0.12;
  const ring = [
    [west + width * inset(), south + height * inset()],
    [east - width * inset(), south + height * inset()],
    [east - width * inset(), north - height * inset()],
    [west + width * inset(), north - height * inset()],
  ];
  ring.push([...ring[0]]);
  return ring;
}

function valueEntry(area: LondonScaleArea, metricId: MetricId, period: string, index: number): ValuePackEntry {
  const gradient = (area.center[0] - LONDON_BBOX.west) / (LONDON_BBOX.east - LONDON_BBOX.west);
  const value = Math.round(3_100 + gradient * 6_500 + ((index * 7919) % 900));
  return {
    geographyId: area.geographyId,
    name: area.name,
    metricId,
    period,
    value,
    regionPercentile: Math.round(gradient * 100),
    countryPercentile: null,
    sampleCount: 20 + ((index * 13) % 60),
    quality: "observed",
    sourceVersion: "london-scale-preview",
    carrier: "lsoa",
  };
}

function bboxAspect(): number {
  return (LONDON_BBOX.east - LONDON_BBOX.west) / (LONDON_BBOX.north - LONDON_BBOX.south);
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
