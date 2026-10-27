import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { AreaMobileResponse } from "@/lib/area-mobile";
import type { GeographyId } from "@/lib/contracts";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";

interface Context { params: Promise<{ id: string }> }

// Real mobile coverage comes from the evidence API; demo mode has none and says so.
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<AreaMobileResponse>(`/api/v1/areas/${encodeURIComponent(id)}/mobile`, request);
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const geographyId = decodeURIComponent(id);
  if (!/^uk:(lsoa|msoa|lad):E\d{8}$/.test(geographyId)) return NextResponse.json({ error: "invalid-query" }, { status: 400 });
  const demo: AreaMobileResponse = {
    schemaVersion: "area-mobile.v1", productReleaseId: "preview-release", geographyId: geographyId as GeographyId,
    available: false, grain: "borough", confidence: null, value: null, evidence: [], notes: [], sources: [],
    caveats: ["Mobile coverage is loaded in real mode only."],
  };
  return NextResponse.json(demo);
}
