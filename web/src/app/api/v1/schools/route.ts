import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { SchoolSearchResponse } from "@/lib/contracts";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import { searchSchools } from "@/lib/fixtures";

export async function GET(request: NextRequest) {
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<SchoolSearchResponse>(
      `/api/v1/schools${request.nextUrl.search}`,
      request,
    );
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const query = request.nextUrl.searchParams.get("q") ?? "";
  return NextResponse.json({ schemaVersion: "school-search.v1", schools: searchSchools(query) });
}
