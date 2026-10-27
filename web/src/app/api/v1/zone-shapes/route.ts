import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertZones, type MatchZone } from "@/lib/contracts";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import { previewZoneShapes, type ZoneShapesResponse } from "@/lib/zones";

// The zones are part of the household's private search: never cached.
const PRIVATE_HEADERS = { "Cache-Control": "no-store" };

/** Each My match Where zone's outline for the map (api/area_api/repository.zone_shapes); the preview draws its own. */
export async function POST(request: NextRequest) {
  let zones: MatchZone[];
  try {
    zones = ((await request.json()) as { zones: MatchZone[] }).zones;
    assertZones(zones);
    if (!zones.length) throw new Error("no zones");
  } catch {
    return NextResponse.json({ error: "invalid-zone-shapes-request" }, { status: 400, headers: PRIVATE_HEADERS });
  }
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<ZoneShapesResponse>("/api/v1/zone-shapes", request, {
      method: "POST", body: JSON.stringify({ zones }),
    });
    return NextResponse.json(upstream.body, { status: upstream.status, headers: PRIVATE_HEADERS });
  }
  return NextResponse.json(previewZoneShapes(zones), { headers: PRIVATE_HEADERS });
}
