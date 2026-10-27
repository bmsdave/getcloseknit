import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import type { SchoolPointsResponse } from "@/lib/map-school-layer";
import { previewSchoolPoints } from "@/lib/school-points-preview";

/** Every open school as a map point (Show › Schools); the preview schools without the API. */
export async function GET(request: NextRequest) {
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<SchoolPointsResponse>(`/api/v1/schools/points${request.nextUrl.search}`, request);
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  return NextResponse.json({ schemaVersion: "school-points.v1", schools: previewSchoolPoints() } satisfies SchoolPointsResponse);
}
