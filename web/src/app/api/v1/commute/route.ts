import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { AreaCommute } from "@/lib/commute";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";

// Pinned places are exact household locations: POST only, never cached.
const PRIVATE_HEADERS = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  const body = await request.text();
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<AreaCommute>("/api/v1/commute", request, { method: "POST", body });
    return NextResponse.json(upstream.body, { status: upstream.status, headers: PRIVATE_HEADERS });
  }
  const areaId = (JSON.parse(body || "{}") as { areaId?: string }).areaId ?? "";
  const empty: AreaCommute = { schemaVersion: "area-commute.v1", geographyId: areaId, network: null, places: [],
    caveats: ["Door-to-door routes need the evidence service; showing straight-line estimates."] };
  return NextResponse.json(empty, { headers: PRIVATE_HEADERS });
}
