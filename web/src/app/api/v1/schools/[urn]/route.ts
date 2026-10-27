import { NextResponse } from "next/server";

import type { SchoolSummaryResponse } from "@/lib/contracts";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import { SCHOOLS } from "@/lib/fixtures";

interface Context { params: Promise<{ urn: string }> }

export async function GET(request: Request, context: Context) {
  const { urn } = await context.params;
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<SchoolSummaryResponse>(
      `/api/v1/schools/${encodeURIComponent(urn)}`,
      request,
    );
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const school = SCHOOLS.find((candidate) => candidate.urn === urn);
  return school
    ? NextResponse.json({ schemaVersion: "school-summary.v1", school })
    : NextResponse.json({ error: "school-not-found" }, { status: 404 });
}
