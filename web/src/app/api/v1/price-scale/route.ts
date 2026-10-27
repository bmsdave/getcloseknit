import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import type { MetricDefinition, ValuePack } from "@/lib/contracts";
import { clientHeaders, evidenceServiceUrl, fetchEvidence } from "@/lib/evidence-service";
import { getMetric, getValuePack } from "@/lib/fixtures";
import { PRICE_METRIC_ID, priceBreaks, yearlyPeriods } from "@/lib/price-scale";

// Computed once per mode and release from every yearly pack, then served from memory.
// Only known modes and release-shaped ids make a key, and at most MAX_SCALES are kept,
// so made-up query strings can neither grow the map nor trigger fresh upstream work.
const scales = new Map<string, Promise<number[] | null>>();
const MAX_SCALES = 8;
const MODES = new Set(["demo", "real"]);
const RELEASE = /^[\w.:-]{0,100}$/;

/**
 * The price layer's fixed colour scale (lib/price-scale.ts priceBreaks):
 * equal-count breaks over the latest yearly step's LSOA £/m² values, with
 * history steps below them down to the low end of every yearly step pooled.
 */
export async function GET(request: NextRequest) {
  const requested = request.nextUrl.searchParams.get("mode") ?? "demo";
  const release = request.nextUrl.searchParams.get("release") ?? "";
  if (!MODES.has(requested) || !RELEASE.test(release)) {
    return NextResponse.json({ error: "invalid-query" }, { status: 400 });
  }
  const base = evidenceServiceUrl();
  // With the API configured the scale is always the real one: ?mode=demo cannot ask for fixtures.
  const mode = base ? "real" : requested;
  const key = `${base ?? "fixtures"}|${mode}|${release}`;
  let scale = scales.get(key);
  if (!scale) {
    // The visitor who misses the cache pays for the upstream reads in their own rate bucket.
    scale = computeBreaks(`?${new URLSearchParams({ mode, release })}`, clientHeaders(request.headers));
    if (scales.size >= MAX_SCALES) scales.delete(scales.keys().next().value ?? "");
    scales.set(key, scale);
  }
  const breaks = await scale.catch(() => null);
  if (!breaks) {
    scales.delete(key);
    return NextResponse.json({ error: "price-scale-unavailable" }, { status: 503 });
  }
  return NextResponse.json(
    { schemaVersion: "price-scale.v4", metricId: PRICE_METRIC_ID, low: breaks[0], high: breaks.at(-1), breaks },
    // A release's scale never changes and its id is in the URL: a day's cache (5 minutes without one).
    { headers: { "cache-control": release ? "public, max-age=86400" : "public, max-age=300" } },
  );
}

async function computeBreaks(search: string, forwarded: Record<string, string>): Promise<number[] | null> {
  if (!evidenceServiceUrl()) {
    const packs = yearlyPeriods(getMetric(PRICE_METRIC_ID).periods)
      .map((period) => packValues(getValuePack(PRICE_METRIC_ID, period)));
    return priceBreaks(packs.flat(), packs.at(-1) ?? []);
  }
  // Not tied to one visitor's request: a cancelled page load must not abort the shared computation.
  const signal = new AbortController().signal;
  const metrics = await fetchEvidence<{ metrics?: MetricDefinition[] }>(`/api/v1/metrics${search}`, signal, { headers: forwarded });
  const metric = metrics.body.metrics?.find((candidate) => candidate.id === PRICE_METRIC_ID);
  if (metrics.status !== 200 || !metric) return null;
  const periods = yearlyPeriods(metric.periods);
  // Every yearly month's numbers in one read (a pack per year, one after another, took 5.6 s
  // on a cold API). An API without that read (a deploy in between) is asked pack by pack, as before.
  const read = await fetchEvidence<{ values?: Record<string, unknown> }>(
    `/api/v1/metric-values/${PRICE_METRIC_ID}${search}&periods=${periods.map(encodeURIComponent).join(",")}`, signal, { headers: forwarded },
  );
  let packs: number[][];
  if (read.status === 200) {
    packs = periods.map((period) => numbers(read.body.values?.[period]));
  } else if (read.status === 404 && !read.body.values) {
    packs = [];
    for (const period of periods) {
      const pack = await fetchEvidence<ValuePack>(
        `/api/v1/value-packs/${PRICE_METRIC_ID}/${encodeURIComponent(period)}${search}`, signal, { headers: forwarded },
      );
      if (pack.status !== 200) return null;
      packs.push(packValues(pack.body));
    }
  } else {
    return null;
  }
  return priceBreaks(packs.flat(), packs.at(-1) ?? []);
}

function numbers(values: unknown): number[] {
  return Array.isArray(values) ? values.filter((value): value is number => typeof value === "number") : [];
}

function packValues(pack: ValuePack): number[] {
  return (pack.values ?? []).flatMap((entry) => typeof entry.value === "number" ? [entry.value] : []);
}
