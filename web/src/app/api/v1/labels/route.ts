import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { demoMapLabels } from "@/lib/area-labels-fixture";
import { evidenceServiceUrl, fetchSharedEvidence } from "@/lib/evidence-service";

// Map label points (boroughs, postcode districts). Real mode proxies the
// evidence API, which caches them per release; demo mode serves fixtures.
export async function GET(request: NextRequest) {
  if (evidenceServiceUrl()) {
    const upstream = await fetchSharedEvidence("/api/v1/labels", request);
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  return NextResponse.json(demoMapLabels(), { headers: { "Cache-Control": "public, max-age=3600" } });
}
