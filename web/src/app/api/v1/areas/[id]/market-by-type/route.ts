import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { GeographyId } from "@/lib/contracts";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import type { AreaMarketResponse } from "@/lib/market";
import { fixtureAreaMarket } from "@/lib/market-fixture";

interface Context { params: Promise<{ id: string }> }

// Local market by property type: the API in real mode, demo fixtures otherwise.
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<AreaMarketResponse>(`/api/v1/areas/${encodeURIComponent(id)}/market-by-type`, request);
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const market = fixtureAreaMarket(decodeURIComponent(id) as GeographyId);
  if (!market) return NextResponse.json({ error: "area-not-found" }, { status: 404 });
  return NextResponse.json(market);
}
