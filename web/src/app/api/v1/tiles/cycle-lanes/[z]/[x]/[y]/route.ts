import type { NextRequest } from "next/server";

import { proxyVectorTile } from "@/lib/tile-proxy";

interface Context {
  params: Promise<{ z: string; x: string; y: string }>;
}

// Cycle lane tiles (TfL Cycling Infrastructure Database and Cycleways; lines from zoom 11).
export async function GET(request: NextRequest, context: Context) {
  return proxyVectorTile(request, "cycle-lanes", await context.params);
}
