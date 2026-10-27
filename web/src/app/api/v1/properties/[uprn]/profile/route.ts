import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import { isUprn } from "@/lib/property-profile";
import { demoPropertyProfile } from "@/lib/property-profile-fixture";

interface Context {
  params: Promise<{ uprn: string }>;
}

/** property-profile.v2: proxied to the evidence API, or the demo fixture without one. */
export async function GET(request: NextRequest, context: Context) {
  const { uprn } = await context.params;
  if (!isUprn(uprn)) return NextResponse.json({ error: "invalid-query" }, { status: 400 });
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<unknown>(`/api/v1/properties/${encodeURIComponent(uprn)}/profile`, request);
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const profile = demoPropertyProfile(uprn);
  if (!profile) return NextResponse.json({ error: "property-not-found" }, { status: 404 });
  return NextResponse.json(profile);
}
