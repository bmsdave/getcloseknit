import type { NextRequest } from "next/server";

import { proxyVectorTile } from "@/lib/tile-proxy";

interface Context {
  params: Promise<{ z: string; x: string; y: string }>;
}

// Road casualty tiles (DfT STATS19; counts from zoom 10, one point per casualty from 13).
export async function GET(request: NextRequest, context: Context) {
  return proxyVectorTile(request, "collisions", await context.params);
}
