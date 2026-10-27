import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import { getPropertySummary } from "@/lib/fixtures";

interface Context {
  params: Promise<{ uprn: string }>;
}

export async function GET(request: NextRequest, context: Context) {
  const { uprn } = await context.params;
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<unknown>(`/api/v1/properties/${encodeURIComponent(uprn)}`, request);
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const property = getPropertySummary(uprn);
  if (!property) return NextResponse.json({ error: "property-not-found" }, { status: 404 });
  return NextResponse.json({ schemaVersion: "property.v2", productReleaseId: "preview-2026-09", property });
}
