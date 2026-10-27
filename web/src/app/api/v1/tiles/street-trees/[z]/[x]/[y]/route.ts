import type { NextRequest } from "next/server";

import { proxyVectorTile } from "@/lib/tile-proxy";

interface Context {
  params: Promise<{ z: string; x: string; y: string }>;
}

// Street trees (GLA public realm trees; counts from zoom 13, one point per tree from 15).
export async function GET(request: NextRequest, context: Context) {
  return proxyVectorTile(request, "street-trees", await context.params);
}
