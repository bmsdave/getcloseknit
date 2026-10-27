import type { NextRequest } from "next/server";

import { proxyRasterTile } from "@/lib/tile-proxy";

interface Context {
  params: Promise<{ z: string; x: string; y: string }>;
}

// Canopy (PNG): 10 m green cover from Sentinel-2, zoom 11-14.
export async function GET(request: NextRequest, context: Context) {
  return proxyRasterTile(request, "canopy", await context.params);
}
