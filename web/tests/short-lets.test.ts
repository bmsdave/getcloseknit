import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ShortLetsView } from "../src/components/short-lets";
import { METRIC_IDS } from "../src/lib/contracts";
import { getMetric } from "../src/lib/fixtures";
import { MAP_TOPIC_GROUPS } from "../src/lib/map-topics";
import {
  type AreaShortLetsResponse, type ShortLetsValue, demoAreaShortLets, readAreaShortLets, shortLetBars, shortLetScaleLabel,
  shortLetsPath, shortLetsValue,
} from "../src/lib/short-lets";

const CAMDEN: ShortLetsValue = {
  available: true, listings: 42, entireHome: 33, active12m: 21, homes: 700, per1000Homes: 60, regionPercentile: 93,
  regionPer1000Homes: 26.9, entireHomeShare: 0.7857, regionEntireHomeShare: 0.6642, activeShare: 0.5, regionActiveShare: 0.5124,
  snapshot: "2026-09-17", sourceVersion: "src-inside-airbnb-london-20260917-abc", notes: [],
};
const ENVELOPE: AreaShortLetsResponse = {
  schemaVersion: "area-short-lets.v1", productReleaseId: "r1", value: CAMDEN, confidence: "high",
  sources: [{ release: "src", sourceUrl: "https://data.insideairbnb.com/x", licence: "CC-BY-4.0", attribution: "Inside Airbnb, insideairbnb.com, CC BY 4.0." }],
  caveats: [],
};

test("short lets: the envelope is read, anything else is not", () => {
  assert.equal(shortLetsPath("uk:lsoa:E01000842"), "/api/v1/areas/uk%3Alsoa%3AE01000842/short-lets");
  assert.equal(shortLetsValue(readAreaShortLets(ENVELOPE)), CAMDEN);
  assert.equal(readAreaShortLets({ schemaVersion: "area-home.v1", value: CAMDEN }), null);
  assert.equal(shortLetsValue(demoAreaShortLets()), null);
});

test("short lets: entire homes and activity as shares with London ticks", () => {
  assert.deepEqual(shortLetBars(CAMDEN).map((row) => [row.label, row.display, Math.round(row.marker!)]),
    [["Entire homes", "79%", 66], ["Active (12 mo)", "50%", 51]]);
  assert.equal(shortLetScaleLabel(CAMDEN), "60 per 1,000 homes; London 27 per 1,000 homes; more than 93% of London areas");
  assert.deepEqual(shortLetBars({ ...CAMDEN, listings: 0, entireHomeShare: null, activeShare: null }), []);
});

test("short lets render a rate, London's place and two bars; none listed reads none, never zero bars", () => {
  const html = renderToStaticMarkup(createElement(ShortLetsView, { value: CAMDEN }));
  assert.match(html, /data-testid="short-lets-rate"><strong>60 per 1,000 homes<\/strong> · London 27/);
  assert.match(html, /class="chart chart-scale" role="img" aria-label="60 per 1,000 homes; London 27/);
  assert.match(html, /aria-label="Airbnb listings here: Entire homes 79%, Active \(12 mo\) 50%"/);
  const none = renderToStaticMarkup(createElement(ShortLetsView,
    { value: { ...CAMDEN, listings: 0, entireHome: 0, active12m: 0, per1000Homes: 0, regionPercentile: 0, entireHomeShare: null, activeShare: null } }));
  assert.match(none, /<strong>None listed<\/strong>/);
  assert.doesNotMatch(none, /chart-bars/);
});

test("short lets are a map layer in Homes & area, so they work as a range criterion", () => {
  assert.ok((METRIC_IDS as readonly string[]).includes("short-lets-per-1000"));
  const group = MAP_TOPIC_GROUPS.find((candidate) => candidate.id === "homes-area");
  const item = group?.items.find((topic) => topic.id === "short-lets-per-1000");
  assert.equal(item?.layer, "short-lets-per-1000");
  const metric = getMetric("short-lets-per-1000");
  assert.equal(metric.provenance.licence, "CC-BY-4.0");
  assert.equal(metric.provenance.attribution, "Inside Airbnb, insideairbnb.com, CC BY 4.0.");
});
