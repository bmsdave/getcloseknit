import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { assertZones, type MatchZone } from "@/lib/contracts";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import { previewPortalLinks, type PortalFilter, type PortalLinksResponse } from "@/lib/portal-zones";

// The budget is part of the household's private search: never cached.
const PRIVATE_HEADERS = { "Cache-Control": "no-store" };

/** The search's zones as portal searches (api/area_api/portal_zones.py); the preview draws them itself. */
export async function POST(request: NextRequest) {
  let body: PortalFilter & { zones: MatchZone[] };
  try {
    body = await request.json() as PortalFilter & { zones: MatchZone[] };
    assertZones(body.zones);
    if (!["buy", "rent"].includes(body.market) || !Number.isInteger(body.maxPrice) || !Number.isInteger(body.minBedrooms)) throw new Error("filter");
  } catch {
    return NextResponse.json({ error: "invalid-portal-links-request" }, { status: 400, headers: PRIVATE_HEADERS });
  }
  const filter: PortalFilter = { market: body.market, maxPrice: body.maxPrice, minBedrooms: body.minBedrooms };
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<PortalLinksResponse>("/api/v1/portal-links", request, {
      method: "POST", body: JSON.stringify({ ...filter, zones: body.zones ?? [] }),
    });
    return NextResponse.json(upstream.body, { status: upstream.status, headers: PRIVATE_HEADERS });
  }
  return NextResponse.json(previewPortalLinks(body.zones ?? [], filter), { headers: PRIVATE_HEADERS });
}
