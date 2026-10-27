import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { type AreaPipelineResponse, demoAreaPipeline } from "@/lib/development-pipeline";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";

interface Context { params: Promise<{ id: string }> }

// Real pipeline layers come from the evidence API; demo mode has none and says so.
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<AreaPipelineResponse>(`/api/v1/areas/${encodeURIComponent(id)}/pipeline`, request);
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  if (!/^uk:(lsoa|msoa|lad):E\d{8}$/.test(decodeURIComponent(id))) return NextResponse.json({ error: "invalid-query" }, { status: 400 });
  return NextResponse.json(demoAreaPipeline());
}
