import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { GeographyId } from "@/lib/contracts";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import type { AreaStandouts } from "@/lib/standouts";
import { fixtureStandouts } from "@/lib/standouts-fixture";

interface Context { params: Promise<{ id: string }> }

// The area page's tiles, tags and verdict: the API in real mode, demo fixtures otherwise.
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<AreaStandouts>(`/api/v1/areas/${encodeURIComponent(id)}/standouts`, request);
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const standouts = fixtureStandouts(decodeURIComponent(id) as GeographyId);
  if (!standouts) return NextResponse.json({ error: "area-not-found" }, { status: 404 });
  return NextResponse.json(standouts);
}
