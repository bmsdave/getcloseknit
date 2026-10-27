/**
 * Demo data's area tiles: its fixture areas (lib/fixtures.ts) as Mapbox Vector Tiles, made on request by the web's
 * area tile route for DEMO_TILE_RELEASE, so demo data draws its areas from tiles exactly as real data does (one layer
 * named after the kind, each feature's id its ONS code as an integer, no properties). Three areas: a feature goes in
 * whole into every tile its box touches (MapLibre clips each tile as it draws it).
 */
import { areaTileId } from "./area-tiles";
import { carrierOf } from "./contracts";
import { areaGeoJson } from "./fixtures";

const EXTENT = 4096;
type Ring = number[][];

function varint(value: number, out: number[]) {
  let rest = value;
  while (rest > 127) {
    out.push((rest % 128) | 128);
    rest = Math.floor(rest / 128);
  }
  out.push(rest);
}

function field(number: number, bytes: number[], out: number[]) {
  varint((number << 3) | 2, out);
  varint(bytes.length, out);
  out.push(...bytes);
}

const zigzag = (value: number) => (value << 1) ^ (value >> 31);

/** A [longitude, latitude] in tile units of z/x/y (y down). */
function toTile([longitude, latitude]: number[], z: number, x: number, y: number): [number, number] {
  const size = 2 ** z;
  const sin = Math.sin((latitude * Math.PI) / 180);
  const column = ((longitude + 180) / 360) * size;
  const row = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size;
  return [Math.round((column - x) * EXTENT), Math.round((row - y) * EXTENT)];
}

/** A ring's points in tile units, open (no repeated first point), without repeats, wound as `exterior` says. */
function tileRing(ring: Ring, z: number, x: number, y: number, exterior: boolean): [number, number][] {
  const points: [number, number][] = [];
  for (const point of ring) {
    const next = toTile(point, z, x, y);
    const last = points[points.length - 1];
    if (!last || last[0] !== next[0] || last[1] !== next[1]) points.push(next);
  }
  if (points.length > 1 && points[0][0] === points[points.length - 1][0] && points[0][1] === points[points.length - 1][1]) points.pop();
  // The MVT spec's winding: an exterior ring's area is positive in tile units (y down), a hole's negative.
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[(index + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return area > 0 === exterior ? points : points.reverse();
}

/** One feature's geometry commands (MoveTo, LineTo, ClosePath per ring), or null when nothing of it is in the tile. */
function polygonCommands(polygons: Ring[][], z: number, x: number, y: number): number[] | null {
  const commands: number[] = [];
  let cursor: [number, number] = [0, 0];
  let inside = false;
  for (const polygon of polygons) {
    polygon.forEach((ring, index) => {
      const points = tileRing(ring, z, x, y, index === 0);
      if (points.length < 3) return;
      const xs = points.map(([px]) => px);
      const ys = points.map(([, py]) => py);
      inside ||= Math.min(...xs) <= EXTENT && Math.max(...xs) >= 0 && Math.min(...ys) <= EXTENT && Math.max(...ys) >= 0;
      points.forEach(([px, py], position) => {
        if (position === 0) commands.push((1 << 3) | 1);
        else if (position === 1) commands.push(((points.length - 1) << 3) | 2);
        commands.push(zigzag(px - cursor[0]), zigzag(py - cursor[1]));
        cursor = [px, py];
      });
      commands.push((1 << 3) | 7);
    });
  }
  return inside && commands.length ? commands : null;
}

/** One tile of a kind (lsoa, msoa, borough) of demo data's areas; empty when none of them is in it. */
export function demoAreaTile(kind: string, z: number, x: number, y: number): Uint8Array<ArrayBuffer> {
  const features: number[] = [];
  for (const area of areaGeoJson(carrierOf(kind)).features) {
    const geometry = area.geometry;
    const commands = polygonCommands(geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates, z, x, y);
    if (!commands) continue;
    const feature: number[] = [];
    varint((1 << 3) | 0, feature);
    varint(areaTileId(area.properties.geography_id), feature);
    varint((3 << 3) | 0, feature);
    varint(3, feature); // POLYGON
    const packed: number[] = [];
    for (const command of commands) varint(command >>> 0, packed);
    field(4, packed, feature);
    field(2, feature, features);
  }
  if (!features.length) return new Uint8Array(0);
  const layer: number[] = [];
  varint((15 << 3) | 0, layer);
  varint(2, layer);
  field(1, [...new TextEncoder().encode(kind)], layer);
  layer.push(...features);
  varint((5 << 3) | 0, layer);
  varint(EXTENT, layer);
  const tile: number[] = [];
  field(3, layer, tile);
  return Uint8Array.from(tile);
}
