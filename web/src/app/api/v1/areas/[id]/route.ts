import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { demoFriendlyFields } from "@/lib/area-labels-fixture";
import { METRIC_IDS, type GeographyId, type MetricId } from "@/lib/contracts";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import { getAreaSummary, getMetricTimeline, getPriceTimeline, METRICS, parentGeographyId } from "@/lib/fixtures";

interface Context {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const search = request.nextUrl.search;
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence(
      `/api/v1/areas/${encodeURIComponent(id)}${search}`,
      request,
    );
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  const metricParameter = request.nextUrl.searchParams.get("metric") ?? "price-per-square-metre";
  if (!METRIC_IDS.includes(metricParameter as MetricId)) {
    return NextResponse.json({ error: "metric-not-found" }, { status: 404 });
  }
  const metric = metricParameter as MetricId;
  const definition = METRICS.find((candidate) => candidate.id === metric);
  const period = request.nextUrl.searchParams.get("period") ?? definition?.defaultPeriod;
  if (!definition || !period || !definition.periods.includes(period)) {
    return NextResponse.json({ error: "period-not-found" }, { status: 404 });
  }
  const selected = decodeURIComponent(id) as GeographyId;
  const summary = getAreaSummary(selected, metric, period);
  if (!summary) return NextResponse.json({ error: "area-not-found" }, { status: 404 });
  // A district or borough is named as itself (Westminster), not as the neighbourhood whose figures it reuses.
  const own = demoFriendlyFields(selected);
  return NextResponse.json({
    schemaVersion: "area-summary.v1",
    summary,
    // The requested area's parent: a district or borough preview reuses a neighbourhood's figures.
    parentId: parentGeographyId(selected),
    ...(own.friendlyName ? own : demoFriendlyFields(summary.geographyId)),
    priceTimeline: getPriceTimeline(summary.geographyId),
    metricTimeline: getMetricTimeline(summary.geographyId, metric),
  });
}
