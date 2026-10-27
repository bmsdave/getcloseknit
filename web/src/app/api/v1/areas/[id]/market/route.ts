import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import { getAreaPack } from "@/lib/fixtures";

interface Context { params: Promise<{ id: string }> }

// Market depth (turnover, leasehold share, resale and new-build £/m², growth): the API in real mode;
// in demo mode the preview pack's market block for the one area that has a pack.
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence(`/api/v1/areas/${encodeURIComponent(id)}/market`, request);
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const pack = getAreaPack(decodeURIComponent(id));
  if (!pack || pack === "address-outside") return NextResponse.json({ error: "area-not-found" }, { status: 404 });
  return NextResponse.json({ schemaVersion: "area-market.v1", productReleaseId: pack.productReleaseId, value: pack.market });
}
