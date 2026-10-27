import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { GeographyId } from "@/lib/contracts";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import type { AreaPlacesResponse } from "@/lib/places";
import { fixtureAreaPlaces } from "@/lib/places-fixture";

interface Context { params: Promise<{ id: string }> }

// Stations, parks and everyday places near an area (or ?uprn= a home):
// the evidence API in real mode, small preview fixtures in demo mode.
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<AreaPlacesResponse>(
      `/api/v1/areas/${encodeURIComponent(id)}/places${request.nextUrl.search}`,
      request,
    );
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const uprn = request.nextUrl.searchParams.get("uprn");
  if (uprn !== null && !/^[0-9]{1,12}$/.test(uprn)) return NextResponse.json({ error: "invalid-query" }, { status: 400 });
  const places = fixtureAreaPlaces(decodeURIComponent(id) as GeographyId, uprn);
  if (!places) return NextResponse.json({ error: "area-not-found" }, { status: 404 });
  return NextResponse.json(places);
}
