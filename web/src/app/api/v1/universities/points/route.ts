import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import type { UniversityPoint, UniversityPointsResponse } from "@/lib/map-university-layer";

/** Preview universities and colleges (made up, near the preview areas). */
const PREVIEW_POINTS: UniversityPoint[] = [
  { id: "osm:w1001", name: "Preview University, Strand Campus", kind: "university", latitude: 51.5115, longitude: -0.1160 },
  { id: "osm:w1002", name: "Preview University, Islington", kind: "university", latitude: 51.5465, longitude: -0.0985 },
  { id: "osm:n1003", name: "South Bank Preview College", kind: "college", latitude: 51.4985, longitude: -0.1025 },
];

/** Universities and colleges as map points (Student areas, Layers v5 PR 3); the preview points without the API. */
export async function GET(request: NextRequest) {
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<UniversityPointsResponse>(`/api/v1/universities/points${request.nextUrl.search}`, request);
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  return NextResponse.json({ schemaVersion: "university-points.v1", points: PREVIEW_POINTS } satisfies UniversityPointsResponse);
}
