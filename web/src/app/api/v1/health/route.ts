import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";

export async function GET(request: NextRequest) {
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence("/health", request);
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  return NextResponse.json({
    status: "unknown",
    code: "local-demo",
    productReleaseId: null,
    checks: [],
    unavailableReasons: [
      "Local demo fixture: no validated release is loaded, so freshness is not validated.",
    ],
  });
}
