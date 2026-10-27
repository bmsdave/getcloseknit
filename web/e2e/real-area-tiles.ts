import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PMTiles, SharedPromiseCache, tileIdToZxy, type Source } from "pmtiles";

import type { Page } from "./fixtures";

// Real area tiles around a point of the border of Redbridge (London) and Epping Forest (Essex), one archive per kind
// as production serves them (deploy/tools/area_topology.py --export web/e2e/area-tiles, written by
// deploy/tools/area_pmtiles.py): the map reads them with the pmtiles protocol, a Range request at a time.

export const TILES = fileURLToPath(new URL("./area-tiles", import.meta.url));
export const CENTRE: [number, number] = [0.0768, 51.6063];
const RELEASE = "0e2e0e2e0e2e";
/** The coverage's areaTiles for the exported archives (routeEngland(page, { areaTiles: REAL_AREA_TILES })). */
export const REAL_AREA_TILES = { release: RELEASE, minzoom: 5, maxzoom: 12, url: `/tiles/areas-${RELEASE}-{kind}.pmtiles` };

export function archivePath(kind: "lsoa" | "msoa"): string {
  return path.join(TILES, `areas-${RELEASE}-${kind}.pmtiles`);
}

/**
 * The exported archives, answered as Caddy serves them: a Range request gets its bytes (206, Content-Range), a
 * missing archive (another kind) 404. Returns every range answered, as "<file> <start>-<end>".
 */
export async function routeRealTiles(page: Page): Promise<string[]> {
  const ranges: string[] = [];
  await page.route("**/tiles/areas-*.pmtiles", (route) => {
    const name = path.basename(new URL(route.request().url()).pathname);
    if (!name.startsWith(`areas-${RELEASE}-`)) return route.fulfill({ status: 404 });
    let body: Buffer;
    try {
      body = readFileSync(path.join(TILES, name));
    } catch {
      return route.fulfill({ status: 404 });
    }
    const headers = { "content-type": "application/octet-stream", "cache-control": "public, max-age=31536000, immutable" };
    const range = /^bytes=(\d+)-(\d+)$/.exec(route.request().headers().range ?? "");
    if (!range) return route.fulfill({ status: 200, body, headers });
    const start = Number(range[1]);
    const end = Math.min(Number(range[2]), body.length - 1);
    ranges.push(`${name} ${start}-${end}`);
    return route.fulfill({ status: 206, body: body.subarray(start, end + 1),
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${body.length}` } });
  });
  return ranges;
}

function varint(data: Buffer, at: number): [number, number] {
  let value = 0;
  for (let shift = 1; ; shift *= 128) {
    const byte = data[at++];
    value += (byte & 0x7f) * shift;
    if (byte < 0x80) return [value, at];
  }
}

/** Each field of a protobuf message: its number and its value (a varint, or the bytes of a length-delimited one). */
function* fields(data: Buffer): Generator<[number, number | Buffer]> {
  let at = 0;
  while (at < data.length) {
    let key: number;
    [key, at] = varint(data, at);
    const type = key & 7;
    if (type === 0) {
      let value: number;
      [value, at] = varint(data, at);
      yield [key >>> 3, value];
    } else if (type === 2) {
      let length: number;
      [length, at] = varint(data, at);
      yield [key >>> 3, data.subarray(at, at + length)];
      at += length;
    } else {
      at += type === 1 ? 8 : 4;
    }
  }
}

/** The area ids of one kind in its exported archive (a feature's id is its ONS code's digits: lib/area-tiles.ts). */
export async function realTileIds(kind: "lsoa" | "msoa"): Promise<string[]> {
  const file = readFileSync(archivePath(kind));
  const source: Source = {
    getKey: () => kind,
    getBytes: async (offset, length) => ({ data: file.buffer.slice(file.byteOffset + offset, file.byteOffset + offset + length) }),
  };
  const archive = new PMTiles(source);
  const header = await archive.getHeader();
  const entries = await new SharedPromiseCache().getDirectory(source, header.rootDirectoryOffset, header.rootDirectoryLength, header);
  const ids = new Set<string>();
  for (const entry of entries) {
    const [z, x, y] = tileIdToZxy(entry.tileId);
    const tile = await archive.getZxy(z, x, y);
    if (!tile) continue;
    for (const [number, layer] of fields(Buffer.from(tile.data))) {
      if (number !== 3 || !Buffer.isBuffer(layer)) continue;
      for (const [field, feature] of fields(layer)) {
        if (field !== 2 || !Buffer.isBuffer(feature)) continue;
        for (const [key, id] of fields(feature)) {
          if (key === 1 && typeof id === "number") ids.add(`uk:${kind}:E${String(id).padStart(8, "0")}`);
        }
      }
    }
  }
  return [...ids].sort();
}
