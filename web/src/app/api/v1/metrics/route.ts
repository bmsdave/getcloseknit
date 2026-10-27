import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { evidenceServiceUrl, fetchSharedEvidence } from "@/lib/evidence-service";
import { METRICS } from "@/lib/fixtures";
import { catalogueCacheHeaders, catalogueEtag, etagMatches } from "@/lib/metrics-cache";

/**
 * The release's metric catalogue. It only changes with a release, and every map page reads it before its first
 * paint: an ETag of the release lets a returning visitor revalidate with a 304 instead of 1.4 MB (41 kB gzipped),
 * and a short max-age with stale-while-revalidate spares even that within ten minutes (perf/layer-load).
 */
export async function GET(request: NextRequest) {
  if (evidenceServiceUrl()) {
    const upstream = await fetchSharedEvidence<{ productReleaseId?: string }>("/api/v1/metrics", request);
    const etag = upstream.status === 200 ? catalogueEtag(upstream.body?.productReleaseId) : null;
    if (!etag) return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
    const headers = { ...upstream.headers, ...catalogueCacheHeaders(etag) };
    if (etagMatches(request.headers.get("if-none-match"), etag)) return new NextResponse(null, { status: 304, headers });
    return NextResponse.json(upstream.body, { status: 200, headers });
  }
  return NextResponse.json({ schemaVersion: "area-metrics.v1", metrics: METRICS });
}
