import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { AreaOwnershipResponse } from "@/lib/area-ownership";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";

interface Context { params: Promise<{ id: string }> }

// Company and overseas ownership comes from the evidence API (behind CLOSE_KNIT_OWNERSHIP); demo mode has none.
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (!evidenceServiceUrl()) return NextResponse.json({ error: "not-available" }, { status: 404 });
  const upstream = await fetchEvidence<AreaOwnershipResponse>(`/api/v1/areas/${encodeURIComponent(id)}/ownership`, request);
  return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
}
