import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { AreaSafety } from "@/lib/area-safety";
import { fixtureAreaSafety } from "@/lib/area-safety-fixture";
import type { GeographyId } from "@/lib/contracts";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";

interface Context { params: Promise<{ id: string }> }

// Offence types beside London and the three-year change: the API in real mode, demo fixtures otherwise.
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<AreaSafety>(`/api/v1/areas/${encodeURIComponent(id)}/safety`, request);
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const safety = fixtureAreaSafety(decodeURIComponent(id) as GeographyId);
  if (!safety) return NextResponse.json({ error: "area-not-found" }, { status: 404 });
  return NextResponse.json(safety);
}
