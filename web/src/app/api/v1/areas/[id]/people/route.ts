import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { GeographyId } from "@/lib/contracts";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import { fixtureAreaPeople } from "@/lib/people-fixture";
import type { AreaPeopleResponse } from "@/lib/people-profile";

interface Context {
  params: Promise<{ id: string }>;
}

// People and homes: the evidence API when one is configured, demo fixtures otherwise.
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<AreaPeopleResponse>(`/api/v1/areas/${encodeURIComponent(id)}/people`, request);
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const people = fixtureAreaPeople(decodeURIComponent(id) as GeographyId);
  if (!people) return NextResponse.json({ error: "area-not-found" }, { status: 404 });
  return NextResponse.json(people);
}
