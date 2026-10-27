import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { NextRequest } from "next/server";

import { GET as priceForecast } from "../src/app/api/v1/areas/[id]/price-forecast/route";
import { GET as testStyle } from "../src/app/api/v1/style/route";
import { GUIDE_ARTICLES } from "../src/components/guide/articles";
import { MetricNotes } from "../src/components/guide/metric-notes";
import type { GeographyId } from "../src/lib/contracts";
import {
  fallbackMetric,
  getAreaSummary,
  getMetric,
  isPlaceholderMetric,
  METRICS,
  PERSONAL_MATCH_DEFINITION,
  realPilotUnavailableReason,
} from "../src/lib/fixtures";
import {
  applyModeSwitch,
  DATA_MODE_LABELS,
  DEMO_RELEASE,
  REAL_PILOT_RELEASE,
  requestAreaEvidence,
  type FetchLike,
} from "../src/lib/map-state";

const ENV_KEY = "CLOSE_KNIT_API_URL";

function withApi<T>(url: string | undefined, run: () => T): T {
  const previous = process.env[ENV_KEY];
  if (url === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = url;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = previous;
  }
}

test("real-mode fallback definitions carry no fixture source, release, caveats or periods", () => {
  for (const fixture of METRICS) {
    const placeholder = fallbackMetric(fixture.id, "real");
    assert.equal(isPlaceholderMetric(placeholder), true);
    assert.doesNotMatch(JSON.stringify(placeholder), /preview-/, fixture.id);
    assert.deepEqual(placeholder.periods, []);
    assert.deepEqual(placeholder.caveats, []);
    assert.equal(placeholder.freshness, "");
    assert.equal(placeholder.provenance.sourceName, "");
    assert.ok(placeholder.legend.every((stop) => stop.label === ""), fixture.id);
    assert.equal(placeholder.label, fixture.label);
    assert.equal(placeholder.unit, fixture.unit);
    assert.equal(fallbackMetric(fixture.id, "real"), placeholder, `${fixture.id}: one stable object`);
    assert.equal(fallbackMetric(fixture.id, "demo"), getMetric(fixture.id));
    assert.equal(isPlaceholderMetric(getMetric(fixture.id)), false);
  }
});

test("real data is never called a pilot", () => {
  assert.doesNotMatch(DATA_MODE_LABELS.real, /pilot/i);
  assert.doesNotMatch(applyModeSwitch({ mode: "demo", release: DEMO_RELEASE }, "real").notice ?? "", /pilot/i);
  assert.doesNotMatch(realPilotUnavailableReason("Schools", REAL_PILOT_RELEASE), /pilot/i);
});

test("real evidence carries the API's own parent area", async () => {
  const summary = { ...getAreaSummary("uk:lsoa:E01000001", "crime", "2026-06")!, sourceVersion: "official-2026-06" };
  const body = { schemaVersion: "area-summary.v1", summary, parentId: "uk:msoa:E02000001", priceTimeline: [], metricTimeline: [] };
  const fetchLike: FetchLike = async () => ({ ok: true, status: 200, json: async () => body });
  const result = await requestAreaEvidence({ path: "/x", mode: "real", release: REAL_PILOT_RELEASE }, fetchLike);
  assert.equal(result.status, "available");
  if (result.status === "available") assert.equal(result.payload.parentId, "uk:msoa:E02000001" as GeographyId);
  const invalid = await requestAreaEvidence({ path: "/x", mode: "real", release: REAL_PILOT_RELEASE },
    async () => ({ ok: true, status: 200, json: async () => ({ ...body, parentId: "nonsense" }) }));
  if (invalid.status === "available") assert.equal(invalid.payload.parentId, null);
});

test("fixture-only routes answer 404 on a real deployment and serve demo runs", async () => {
  const forecastRequest = () => new NextRequest("http://localhost/api/v1/areas/uk%3Amsoa%3AE02000001/price-forecast?horizon=5y");
  const context = { params: Promise.resolve({ id: "uk%3Amsoa%3AE02000001" }) };
  const real = await withApi("http://api.test", () => priceForecast(forecastRequest(), context));
  assert.equal(real.status, 404);
  assert.equal(withApi("http://api.test", () => testStyle()).status, 404);
  const demo = await withApi(undefined, () => priceForecast(forecastRequest(), context));
  assert.equal(demo.status, 200);
  assert.equal(withApi(undefined, () => testStyle()).status, 200);
});

test("guide metric notes show no fixture release or placeholder source link", () => {
  for (const metric of [...METRICS, PERSONAL_MATCH_DEFINITION]) {
    const html = renderToStaticMarkup(createElement(MetricNotes, { metricId: metric.id }));
    assert.doesNotMatch(html, /preview-/, metric.id);
    assert.doesNotMatch(html, /example\.invalid/, metric.id);
  }
});

test("the noise guide describes the real road and rail source, not the demo pilot", () => {
  const html = renderToStaticMarkup(createElement("div", null, GUIDE_ARTICLES.noise.finePrint));
  assert.doesNotMatch(html, /pilot|corridor|not a reviewed source/i);
  assert.match(html, /rail/i);
});
