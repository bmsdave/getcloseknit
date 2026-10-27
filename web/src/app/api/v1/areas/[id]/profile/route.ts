import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { type AreaProfileResponse, type GeographyId } from "@/lib/contracts";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import { fixtureAreaProfile } from "@/lib/area-profile-fixture";

interface Context {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<AreaProfileResponse>(
      `/api/v1/areas/${encodeURIComponent(id)}/profile${request.nextUrl.search}`,
      request,
    );
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const period = request.nextUrl.searchParams.get("period");
  if (!period) return NextResponse.json({ error: "period-required" }, { status: 400 });
  const profile = fixtureAreaProfile(decodeURIComponent(id) as GeographyId, period);
  if (!profile) return NextResponse.json({ error: "area-not-found" }, { status: 404 });
  return NextResponse.json(profile);
}
