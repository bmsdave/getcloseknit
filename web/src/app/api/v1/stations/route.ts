import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { StationSearchResponse } from "@/lib/contracts";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import { searchPreviewStations } from "@/lib/zones";

export async function GET(request: NextRequest) {
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<StationSearchResponse>(`/api/v1/stations${request.nextUrl.search}`, request);
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const query = request.nextUrl.searchParams.get("q") ?? "";
  return NextResponse.json({ schemaVersion: "station-search.v1", results: searchPreviewStations(query) });
}
