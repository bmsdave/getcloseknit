import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { previewBrief } from "@/lib/brief-fixture";
import type { AreaBrief } from "@/lib/brief-model";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";

// The budget is part of a household's private profile: never let a shared cache keep it.
const PRIVATE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  // With an evidence service the brief is always real: ?mode=demo never swaps in the preview areas.
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<AreaBrief>(`/api/v1/brief${request.nextUrl.search}`, request);
    return NextResponse.json(upstream.body, { status: upstream.status, headers: PRIVATE_HEADERS });
  }
  const number = (key: string) => (search.get(key) ? Number(search.get(key)) : null);
  const brief = previewBrief((search.get("areas") ?? "").split(",").filter(Boolean),
    [number("budgetMin"), number("budgetMax")], Number(search.get("bedrooms") ?? 2));
  if (!brief) return NextResponse.json({ error: "area-not-found" }, { status: 404, headers: PRIVATE_HEADERS });
  return NextResponse.json(brief, { headers: PRIVATE_HEADERS });
}
