import type { NextRequest } from "next/server";

import { proxyVectorTile } from "@/lib/tile-proxy";

interface Context {
  params: Promise<{ z: string; x: string; y: string }>;
}

// Sold-price tiles (one pin per home, merged cells at outer zooms).
export async function GET(request: NextRequest, context: Context) {
  return proxyVectorTile(request, "sales", await context.params);
}
