import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fixtureAreaCivic } from "@/lib/civic-fixture";
import type { GeographyId } from "@/lib/contracts";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";

interface Context { params: Promise<{ id: string }> }

// Real mode proxies the evidence API; demo mode answers from made-up fixtures.
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence(`/api/v1/areas/${encodeURIComponent(id)}/civic`, request);
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const civic = fixtureAreaCivic(decodeURIComponent(id) as GeographyId);
  if (!civic) return NextResponse.json({ error: "area-not-found" }, { status: 404 });
  return NextResponse.json(civic);
}
