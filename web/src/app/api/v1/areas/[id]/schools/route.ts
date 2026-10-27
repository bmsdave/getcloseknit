import { NextResponse } from "next/server";

import type { AreaSchoolsResponse, GeographyId } from "@/lib/contracts";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import { getAreaSchools } from "@/lib/fixtures";

interface Context { params: Promise<{ id: string }> }

export async function GET(request: Request, context: Context) {
  const { id } = await context.params;
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<AreaSchoolsResponse>(
      `/api/v1/areas/${encodeURIComponent(id)}/schools`,
      request,
    );
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const schools = getAreaSchools(decodeURIComponent(id) as GeographyId);
  return NextResponse.json({ schemaVersion: "area-schools.v1", geographyId: id, schools });
}
