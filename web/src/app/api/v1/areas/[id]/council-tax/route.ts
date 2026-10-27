import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { GeographyId } from "@/lib/contracts";
import { type AreaCouncilTaxResponse, demoCouncilTax } from "@/lib/council-tax";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";

interface Context { params: Promise<{ id: string }> }

// Real council tax bands come from the evidence API; demo mode has none and says so.
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<AreaCouncilTaxResponse>(`/api/v1/areas/${encodeURIComponent(id)}/council-tax`, request);
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const geographyId = decodeURIComponent(id) as GeographyId;
  if (!/^uk:(lsoa|msoa|lad):E\d{8}$/.test(geographyId)) return NextResponse.json({ error: "invalid-query" }, { status: 400 });
  return NextResponse.json(demoCouncilTax());
}
