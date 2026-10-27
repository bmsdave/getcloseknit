import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { type AreaHmoResponse, demoAreaHmo } from "@/lib/area-hmo";
import type { GeographyId } from "@/lib/contracts";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";

interface Context { params: Promise<{ id: string }> }

// Real HMO registers come from the evidence API; demo mode has none and says so.
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<AreaHmoResponse>(`/api/v1/areas/${encodeURIComponent(id)}/hmo`, request);
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const geographyId = decodeURIComponent(id);
  if (!/^uk:(lsoa|msoa|lad):E\d{8}$/.test(geographyId)) return NextResponse.json({ error: "invalid-query" }, { status: 400 });
  return NextResponse.json(demoAreaHmo(geographyId as GeographyId));
}
