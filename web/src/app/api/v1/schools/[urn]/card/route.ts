import { NextResponse } from "next/server";

import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import type { SchoolCard } from "@/lib/school-card";
import { demoSchoolCard } from "@/lib/school-card-fixture";

interface Context { params: Promise<{ urn: string }> }

/** school-card.v1: the evidence API when configured, the preview cards otherwise. */
export async function GET(request: Request, context: Context) {
  const { urn } = await context.params;
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<SchoolCard>(`/api/v1/schools/${encodeURIComponent(urn)}/card`, request);
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const card = demoSchoolCard(urn);
  return card ? NextResponse.json(card) : NextResponse.json({ error: "school-not-found" }, { status: 404 });
}
