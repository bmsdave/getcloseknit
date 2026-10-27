import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import { previewCriterionValues } from "@/lib/matching";

interface Context {
  params: Promise<{ layer: string }>;
}

/** Every area's value of a My match criterion layer and its London percentile (the range card's histogram). */
export async function GET(request: NextRequest, context: Context) {
  const { layer } = await context.params;
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence(`/api/v1/match-criteria/${encodeURIComponent(layer)}`, request);
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const values = previewCriterionValues(layer);
  return values ? NextResponse.json(values) : NextResponse.json({ error: "no values for this layer" }, { status: 404 });
}
