import type { NextRequest } from "next/server";

import { clientHeaders, evidenceServiceUrl } from "@/lib/evidence-service";

const TILE_HEADERS = { "cache-control": "public, max-age=3600" };
// Canopy tiles are fixed for a release: a day in the cache.
const RASTER_HEADERS = { "cache-control": "public, max-age=86400" };

export interface TileCoordinate {
  z: number;
  x: number;
  y: number;
}

/**
 * Parse `{z}/{x}/{y}.pbf` (or `.png`) route segments into a tile inside the XYZ pyramid,
 * or null. Only plain integers pass, so a crafted segment can never steer the
 * upstream request to another evidence-service path.
 */
export function parseTileCoordinate(z: string, x: string, y: string, extension: ".pbf" | ".png" = ".pbf"): TileCoordinate | null {
  const yDigits = y.endsWith(extension) ? y.slice(0, -extension.length) : y;
  if (![z, x, yDigits].every((part) => /^\d{1,7}$/.test(part))) return null;
  const tile = { z: Number(z), x: Number(x), y: Number(yDigits) };
  if (tile.z > 22) return null;
  const size = 2 ** tile.z;
  return tile.x < size && tile.y < size ? tile : null;
}

async function proxyTile(
  request: NextRequest,
  layer: string,
  segments: { z: string; x: string; y: string },
  format: { extension: ".pbf" | ".png"; type: string; headers: Record<string, string> },
): Promise<Response> {
  const tile = parseTileCoordinate(segments.z, segments.x, segments.y, format.extension);
  if (!tile) return new Response(null, { status: 400 });
  const base = evidenceServiceUrl();
  if (!base) return new Response(null, { status: 204, headers: format.headers });
  const upstream = await fetch(`${base}/api/v1/tiles/${layer}/${tile.z}/${tile.x}/${tile.y}${format.extension}`, {
    signal: request.signal,
    headers: { accept: format.type, ...clientHeaders(request.headers) },
  }).catch(() => null);
  if (!upstream) return new Response(null, { status: 503 });
  if (upstream.status === 204) return new Response(null, { status: 204, headers: format.headers });
  if (!upstream.ok) return new Response(null, { status: upstream.status });
  return new Response(await upstream.arrayBuffer(), {
    status: 200,
    headers: { ...format.headers, "content-type": format.type },
  });
}

/**
 * Forward a vector tile from the evidence service. Demo mode has no
 * dwellings or sales, so it answers "nothing here" rather than fixtures.
 */
export function proxyVectorTile(
  request: NextRequest,
  layer: "properties" | "sales" | "places" | "cycle-lanes" | "collisions" | "street-trees" | "green-streets",
  segments: { z: string; x: string; y: string },
): Promise<Response> {
  return proxyTile(request, layer, segments, { extension: ".pbf", type: "application/vnd.mapbox-vector-tile", headers: TILE_HEADERS });
}

/** Forward a PNG map tile (Canopy) from the evidence service; "nothing here" without one. */
export function proxyRasterTile(request: NextRequest, layer: "canopy", segments: { z: string; x: string; y: string }): Promise<Response> {
  return proxyTile(request, layer, segments, { extension: ".png", type: "image/png", headers: RASTER_HEADERS });
}
