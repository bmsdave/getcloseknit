import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { GeographyId } from "@/lib/contracts";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import { fixtureRentTrend, type AreaRentTrendResponse } from "@/lib/rent-trend";

interface Context { params: Promise<{ id: string }> }

// The borough's private rents since 2015 (ONS PIPR series): the API in real mode, demo numbers otherwise.
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<AreaRentTrendResponse>(`/api/v1/areas/${encodeURIComponent(id)}/rent-trend`, request);
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const geographyId = decodeURIComponent(id);
  if (!/^uk:(lsoa|msoa|lad):E\d{8}$/.test(geographyId)) return NextResponse.json({ error: "invalid-query" }, { status: 400 });
  return NextResponse.json(fixtureRentTrend(geographyId as GeographyId));
}
