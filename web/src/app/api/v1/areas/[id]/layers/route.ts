import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fixtureAreaLayers } from "@/lib/area-layers-fixture";
import type { GeographyId } from "@/lib/contracts";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";

interface Context { params: Promise<{ id: string }> }

// Every map layer as a tile (api/area_api/layers.py): the API in real mode; demo fixtures otherwise,
// which have the Overview's layers only (?scope=overview).
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence(`/api/v1/areas/${encodeURIComponent(id)}/layers${request.nextUrl.search}`, request);
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const layers = request.nextUrl.searchParams.get("scope") === "overview" ? fixtureAreaLayers(decodeURIComponent(id) as GeographyId) : null;
  if (!layers) return NextResponse.json({ error: "layers-unavailable" }, { status: 404 });
  return NextResponse.json(layers);
}
