import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import { normalisePostcode } from "@/lib/postcode-page";
import { demoPostcodeHomes } from "@/lib/property-profile-fixture";

interface Context {
  params: Promise<{ postcode: string }>;
}

/** postcode-homes.v1: proxied to the evidence API, or the demo fixture without one. */
export async function GET(request: NextRequest, context: Context) {
  const postcode = normalisePostcode(decodeURIComponent((await context.params).postcode));
  if (!postcode) return NextResponse.json({ error: "invalid-query" }, { status: 400 });
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<unknown>(`/api/v1/postcodes/${encodeURIComponent(postcode)}/homes`, request);
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const homes = demoPostcodeHomes(postcode);
  if (!homes) return NextResponse.json({ error: "address-not-found" }, { status: 404 });
  return NextResponse.json(homes);
}
