import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { GeographyId } from "@/lib/contracts";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import { fixtureAreaKids, type AreaKidsResponse } from "@/lib/kids";

interface Context { params: Promise<{ id: string }> }

// Real Kids figures (nurseries, road safety, cycle lanes) come from the evidence API; demo mode answers from small fixtures.
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<AreaKidsResponse>(`/api/v1/areas/${encodeURIComponent(id)}/kids`, request);
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const kids = fixtureAreaKids(decodeURIComponent(id) as GeographyId);
  if (!kids) return NextResponse.json({ error: "area-not-found" }, { status: 404 });
  return NextResponse.json(kids);
}
