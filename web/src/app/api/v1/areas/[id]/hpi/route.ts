import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { GeographyId } from "@/lib/contracts";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import { fixtureAreaHpi, type AreaHpiResponse } from "@/lib/uk-hpi";

interface Context { params: Promise<{ id: string }> }

// The borough's official house price index (HM Land Registry UK HPI): the API in real mode, demo numbers otherwise.
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<AreaHpiResponse>(`/api/v1/areas/${encodeURIComponent(id)}/hpi`, request);
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const geographyId = decodeURIComponent(id);
  if (!/^uk:(lsoa|msoa|lad):E\d{8}$/.test(geographyId)) return NextResponse.json({ error: "invalid-query" }, { status: 400 });
  return NextResponse.json(fixtureAreaHpi(geographyId as GeographyId));
}
