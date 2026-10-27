import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { evidenceServiceUrl, fetchSharedEvidence } from "@/lib/evidence-service";
import { LONDON_SCOPE } from "@/lib/scope";

// The places the API serves this site (lib/scope.ts, scope.v1), for a page whose server could not read them
// (components/scope-context.tsx). Real mode proxies the evidence API; demo data is London's.
export async function GET(request: NextRequest) {
  if (evidenceServiceUrl()) {
    const upstream = await fetchSharedEvidence("/api/v1/scope", request);
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  return NextResponse.json(LONDON_SCOPE);
}
