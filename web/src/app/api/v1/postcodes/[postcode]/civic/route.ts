import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { fixturePostcodeCivic } from "@/lib/civic-fixture";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";

interface Context { params: Promise<{ postcode: string }> }

// Real mode proxies the evidence API; demo mode answers from made-up fixtures.
export async function GET(request: NextRequest, context: Context) {
  const { postcode } = await context.params;
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence(`/api/v1/postcodes/${encodeURIComponent(postcode)}/civic`, request);
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const civic = fixturePostcodeCivic(decodeURIComponent(postcode));
  if (!civic) return NextResponse.json({ error: "area-not-found" }, { status: 404 });
  return NextResponse.json(civic);
}
