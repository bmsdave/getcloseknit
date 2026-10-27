import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { GeographyId } from "@/lib/contracts";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import type { RecentSalesResponse } from "@/lib/market";
import { fixtureRecentSales } from "@/lib/market-fixture";

interface Context { params: Promise<{ id: string }> }

// Recent sales in the area, paged: the API in real mode, demo fixtures otherwise.
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence<RecentSalesResponse>(
      `/api/v1/areas/${encodeURIComponent(id)}/recent-sales${request.nextUrl.search}`,
      request,
    );
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const query = request.nextUrl.searchParams;
  const page = Number(query.get("page") ?? "1");
  const pageSize = Number(query.get("pageSize") ?? "20");
  const sort = query.get("sort") ?? "nearest";
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50
    || (sort !== "nearest" && sort !== "newest")) {
    return NextResponse.json({ error: "invalid-query" }, { status: 400 });
  }
  const list = fixtureRecentSales(decodeURIComponent(id) as GeographyId, page, pageSize, sort);
  if (!list) return NextResponse.json({ error: "area-not-found" }, { status: 404 });
  return NextResponse.json(list);
}
