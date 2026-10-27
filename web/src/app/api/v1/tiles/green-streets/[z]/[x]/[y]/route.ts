import type { NextRequest } from "next/server";

import { proxyVectorTile } from "@/lib/tile-proxy";

interface Context {
  params: Promise<{ z: string; x: string; y: string }>;
}

// Green streets (OS Open Roads links with their street trees per 100 m, from zoom 13).
export async function GET(request: NextRequest, context: Context) {
  return proxyVectorTile(request, "green-streets", await context.params);
}
