import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { evidenceServiceUrl, fetchSharedEvidence } from "@/lib/evidence-service";
import { LONDON_COVERAGE } from "@/lib/map-coverage";

/**
 * The coverage asked for with the release it names (?release=, the page's): a repeat visit reads it from the browser's
 * cache instead of waiting on a round trip before any colour (perf/layer-load/README.md). A day, not immutable: it
 * also follows a server flag (CLOSE_KNIT_ENGLAND), which may change within a release.
 */
const COVERAGE_RELEASE_CACHE = "public, max-age=86400, stale-while-revalidate=604800";

// Where the map can go and the pieces it loads (lib/map-coverage.ts, map-coverage.v1). Real mode proxies the
// evidence API (England behind CLOSE_KNIT_ENGLAND); demo mode is the London map.
export async function GET(request: NextRequest) {
  if (evidenceServiceUrl()) {
    const upstream = await fetchSharedEvidence<{ productReleaseId?: string | null }>("/api/v1/map/coverage", request);
    const release = request.nextUrl.searchParams.get("release");
    const headers = upstream.status === 200 && release && upstream.body?.productReleaseId === release
      ? { ...upstream.headers, "cache-control": COVERAGE_RELEASE_CACHE } : upstream.headers;
    return NextResponse.json(upstream.body, { status: upstream.status, headers });
  }
  return NextResponse.json({ schemaVersion: "map-coverage.v1", ...LONDON_COVERAGE });
}
