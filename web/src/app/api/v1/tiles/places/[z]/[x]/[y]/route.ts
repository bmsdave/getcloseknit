import type { NextRequest } from "next/server";

import { proxyVectorTile } from "@/lib/tile-proxy";

interface Context {
  params: Promise<{ z: string; x: string; y: string }>;
}

// Places overlay tiles (unified OSM, FSA register, Overture and Foursquare; points from zoom 14).
export async function GET(request: NextRequest, context: Context) {
  return proxyVectorTile(request, "places", await context.params);
}
