import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { METRIC_IDS, type MetricId } from "@/lib/contracts";
import { evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import { getValuePack, METRICS } from "@/lib/fixtures";

interface Context {
  params: Promise<{ metric: string; period: string }>;
}

export async function GET(request: NextRequest, context: Context) {
  const { metric, period } = await context.params;
  const search = request.nextUrl.search;
  if (evidenceServiceUrl()) {
    const upstream = await fetchEvidence(
      `/api/v1/value-packs/${encodeURIComponent(metric)}/${encodeURIComponent(period)}${search}`,
      request,
    );
    return NextResponse.json(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  if (!METRIC_IDS.includes(metric as MetricId)) {
    return NextResponse.json({ error: "metric-not-found" }, { status: 404 });
  }
  const definition = METRICS.find((candidate) => candidate.id === metric);
  if (!definition?.periods.includes(period)) {
    return NextResponse.json({ error: "period-not-found" }, { status: 404 });
  }
  return NextResponse.json(getValuePack(metric as MetricId, period));
}
