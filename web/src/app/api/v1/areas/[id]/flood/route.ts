import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { GeographyId } from "@/lib/contracts";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import type { AreaFloodResponse } from "@/lib/flood-risk";
import { fixtureAreaFlood } from "@/lib/flood-risk-fixture";

interface Context { params: Promise<{ id: string }> }

// Real flood bands come from the evidence API; demo mode answers from small fixtures.
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<AreaFloodResponse>(
      `/api/v1/areas/${encodeURIComponent(id)}/flood${request.nextUrl.search}`,
      request,
    );
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const uprn = request.nextUrl.searchParams.get("uprn");
  if (uprn !== null && !/^[0-9]{1,12}$/.test(uprn)) return NextResponse.json({ error: "invalid-query" }, { status: 400 });
  const flood = fixtureAreaFlood(decodeURIComponent(id) as GeographyId, uprn);
  if (!flood) return NextResponse.json({ error: "area-not-found" }, { status: 404 });
  return NextResponse.json(flood);
}
