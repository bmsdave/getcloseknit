import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import type { AreaFutureTransport } from "@/lib/future-transport";

interface Context { params: Promise<{ id: string }> }

// Real new stations come from the evidence API; demo mode has no list and says so.
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<AreaFutureTransport>(`/api/v1/areas/${encodeURIComponent(id)}/future-transport`, request);
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const geographyId = decodeURIComponent(id);
  if (!/^uk:(lsoa|msoa|lad):E\d{8}$/.test(geographyId)) return NextResponse.json({ error: "invalid-query" }, { status: 400 });
  return NextResponse.json({
    schemaVersion: "area-future-transport.v1", productReleaseId: "preview-release", dataMode: "demo", confidence: "none",
    value: { available: false, nearest: null, note: null }, evidence: [], sources: [],
    caveats: ["New stations are loaded in real mode only."],
  });
}
