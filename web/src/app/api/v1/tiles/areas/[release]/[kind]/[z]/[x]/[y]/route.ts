import { promisify } from "node:util";
import { gzip } from "node:zlib";

import type { NextRequest } from "next/server";

import { demoAreaTile } from "@/lib/demo-area-tiles";
import { clientHeaders, evidenceServiceUrl } from "@/lib/evidence-service";
import { DEMO_TILE_RELEASE } from "@/lib/map-coverage";
import { parseTileCoordinate } from "@/lib/tile-proxy";

interface Context {
  params: Promise<{ release: string; kind: string; z: string; x: string; y: string }>;
}

const KINDS = new Set(["lsoa", "msoa", "borough"]);
const RELEASE = /^a\d-[0-9a-f]{12}$/;
const gzipAsync = promisify(gzip);

/**
 * Area boundaries as vector tiles (api map_tiles.py): one tile set per kind of area, immutable for a boundary
 * release. Neither Caddy nor Next compresses vector tiles, and gzip takes a third off these (mostly coordinates), so
 * the tile is compressed here; the browser keeps it for good (the release is in the URL). Demo data's release is its
 * fixture areas, made here (lib/demo-area-tiles.ts).
 */
export async function GET(request: NextRequest, context: Context) {
  const { release, kind, z, x, y } = await context.params;
  const tile = parseTileCoordinate(z, x, y.replace(/\.mvt$/, ".pbf"));
  if (!tile || !KINDS.has(kind) || !RELEASE.test(release)) return new Response(null, { status: 400 });
  if (release === DEMO_TILE_RELEASE) {
    const body = demoAreaTile(kind, tile.z, tile.x, tile.y);
    const headers = { "cache-control": "public, max-age=3600", "content-type": "application/vnd.mapbox-vector-tile" };
    return body.length ? new Response(body, { status: 200, headers }) : new Response(null, { status: 204, headers });
  }
  const base = evidenceServiceUrl();
  if (!base) return new Response(null, { status: 404 });
  const upstream = await fetch(`${base}/api/v1/tiles/areas/${release}/${kind}/${tile.z}/${tile.x}/${tile.y}.mvt`, {
    signal: request.signal,
    headers: { accept: "application/vnd.mapbox-vector-tile", ...clientHeaders(request.headers) },
  }).catch(() => null);
  if (!upstream) return new Response(null, { status: 503 });
  const cache = upstream.headers.get("cache-control") ?? "public, max-age=300";
  if (upstream.status === 204) return new Response(null, { status: 204, headers: { "cache-control": cache } });
  if (!upstream.ok) return new Response(null, { status: upstream.status });
  const body = Buffer.from(await upstream.arrayBuffer());
  const headers: Record<string, string> = { "cache-control": cache, "content-type": "application/vnd.mapbox-vector-tile", vary: "accept-encoding" };
  if (!/\bgzip\b/.test(request.headers.get("accept-encoding") ?? "")) return new Response(body, { status: 200, headers });
  return new Response(new Uint8Array(await gzipAsync(body, { level: 6 })), { status: 200, headers: { ...headers, "content-encoding": "gzip" } });
}
