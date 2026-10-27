import type { NextRequest } from "next/server";

import { proxyVectorTile } from "@/lib/tile-proxy";

interface Context {
  params: Promise<{ z: string; x: string; y: string }>;
}

// Freehold-parcel vector tiles come straight from the evidence service.
export async function GET(request: NextRequest, context: Context) {
  return proxyVectorTile(request, "properties", await context.params);
}
