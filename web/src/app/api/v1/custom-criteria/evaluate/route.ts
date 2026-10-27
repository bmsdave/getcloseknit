import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertCustomCriterion, previewCustomPack, type CustomCriterionPack } from "@/lib/custom-criteria";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";

// A criterion is part of a household's search: POST only, never cached.
const PRIVATE_HEADERS = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  const body = await request.text();
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<CustomCriterionPack>("/api/v1/custom-criteria/evaluate", request, { method: "POST", body });
    return NextResponse.json(upstream.body, { status: upstream.status, headers: PRIVATE_HEADERS });
  }
  try {
    const { criterion } = JSON.parse(body || "{}") as { criterion?: unknown };
    assertCustomCriterion(criterion);
    return NextResponse.json(previewCustomPack(criterion), { headers: PRIVATE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid criterion";
    return NextResponse.json({ detail: { error: "invalid-criterion", message } }, { status: 400, headers: PRIVATE_HEADERS });
  }
}
