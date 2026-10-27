import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import { type AreaShortLetsResponse, demoAreaShortLets } from "@/lib/short-lets";

interface Context { params: Promise<{ id: string }> }

// Real short lets come from the evidence API; demo mode has none and says so.
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<AreaShortLetsResponse>(`/api/v1/areas/${encodeURIComponent(id)}/short-lets`, request);
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const geographyId = decodeURIComponent(id);
  if (!/^uk:(lsoa|msoa|lad):E\d{8}$/.test(geographyId)) return NextResponse.json({ error: "invalid-query" }, { status: 400 });
  return NextResponse.json(demoAreaShortLets());
}
