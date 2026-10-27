import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { GeographyId } from "@/lib/contracts";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import { fixtureAreaSince } from "@/lib/market-fixture";
import type { AreaSinceResponse } from "@/lib/saved-since";

interface Context { params: Promise<{ id: string }> }

// What changed after ?date= (a saved area's line): the API in real mode, demo fixtures otherwise.
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<AreaSinceResponse>(
      `/api/v1/areas/${encodeURIComponent(id)}/since${request.nextUrl.search}`,
      request,
    );
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const date = request.nextUrl.searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    return NextResponse.json({ error: "invalid-query" }, { status: 400 });
  }
  const answer = fixtureAreaSince(decodeURIComponent(id) as GeographyId, date);
  if (!answer) return NextResponse.json({ error: "area-not-found" }, { status: 404 });
  return NextResponse.json(answer);
}
