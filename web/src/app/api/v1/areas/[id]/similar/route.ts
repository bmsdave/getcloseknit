import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertZones, type GeographyId, type MatchZone, type SimilarAreasResponse } from "@/lib/contracts";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import { previewSimilarAreas } from "@/lib/similar-areas";

interface Context {
  params: Promise<{ id: string }>;
}

const LSOA_ID_RE = /^uk:lsoa:E\d{8}$/;

export async function GET(request: NextRequest, context: Context) {
  const id = decodeURIComponent((await context.params).id);
  if (!LSOA_ID_RE.test(id)) {
    return NextResponse.json({ error: "invalid-query", message: "similar areas compare LSOAs" }, { status: 400 });
  }
  const search = request.nextUrl.searchParams;
  let zones: MatchZone[] | null = null;
  try {
    const parsed: unknown = search.get("outsideZones") ? JSON.parse(search.get("outsideZones")!) : undefined;
    assertZones(parsed);
    zones = parsed?.length ? parsed : null;
  } catch {
    return NextResponse.json({ error: "invalid-query", message: "invalid outsideZones" }, { status: 400 });
  }
  // Zones are part of a private profile: never let a shared cache keep them.
  const headers = zones ? { "Cache-Control": "no-store" } : undefined;
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<SimilarAreasResponse>(
      `/api/v1/areas/${encodeURIComponent(id)}/similar${request.nextUrl.search}`,
      request,
    );
    return NextResponse.json(upstream.body, { status: upstream.status, headers: headers ?? upstream.headers });
  }
  const payload = previewSimilarAreas(id as GeographyId, {
    cheaper: search.get("cheaper") === "true",
    zones,
    socialRenting: search.get("socialRenting") === "true",
  });
  if (!payload) return NextResponse.json({ error: "area-not-found" }, { status: 404 });
  return NextResponse.json(payload, { headers });
}
