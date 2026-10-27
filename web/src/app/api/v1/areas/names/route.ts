import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { demoFriendlyFields } from "@/lib/area-labels-fixture";
import { AREA_NAMES_MAX_IDS, demoAreaNames, type AreaNamesResponse } from "@/lib/area-names";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";

const AREA_ID = /^uk:(lsoa|msoa|lad):E\d{8}$/;

/**
 * GET /api/v1/areas/names?ids=a,b: the name to show for each area, so a link that stored
 * codes as names (a shared shortlist) reads with today's names. Demo: the fixtures' friendly names.
 */
export async function GET(request: NextRequest) {
  const ids = [...new Set((request.nextUrl.searchParams.get("ids") ?? "").split(",").map((id) => id.trim()).filter(Boolean))];
  if (ids.length > AREA_NAMES_MAX_IDS || ids.some((id) => !AREA_ID.test(id))) {
    return NextResponse.json({ error: "invalid-query", message: `up to ${AREA_NAMES_MAX_IDS} area ids` }, { status: 400 });
  }
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<AreaNamesResponse>(
      `/api/v1/areas/names?ids=${encodeURIComponent(ids.join(","))}`, request);
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  return NextResponse.json(demoAreaNames(ids, demoFriendlyFields));
}
