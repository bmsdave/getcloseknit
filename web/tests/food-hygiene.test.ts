import assert from "node:assert/strict";
import test from "node:test";

import { ratedPlacesWords } from "../src/components/food-hygiene";
import { versusLondonWords } from "../src/components/overview-tiles";
import type { AreaSummary } from "../src/lib/contracts";
import { getMetric } from "../src/lib/fixtures";
import { metricGuidePath } from "../src/lib/guide-routes";
import { parseMapState, REAL_PUBLISHED_LAYERS } from "../src/lib/map-state";

test("food hygiene is a published layer that old links can open", () => {
  assert.ok(REAL_PUBLISHED_LAYERS.includes("food-hygiene"));
  assert.equal(parseMapState(new URLSearchParams("layer=food-hygiene")).layer, "food-hygiene");
  assert.equal(metricGuidePath("food-hygiene"), "/guide/getting-around");
});

test("food hygiene reads higher as better and describes places, not residents", () => {
  const metric = getMetric("food-hygiene");
  assert.equal(metric.direction, "higher-is-better");
  assert.equal(metric.unit, "%");
  assert.equal(metric.provenance.licence, "OGL-3.0");
  assert.match(metric.description, /not the people who live in the area/);
  assert.doesNotMatch(`${metric.description} ${metric.caveats.join(" ")}`, /resident/i);
  const legend = metric.legend.map((stop) => stop.value);
  assert.deepEqual(legend, [...legend].sort((a, b) => a - b));
  assert.equal(metric.legend.at(-1)?.colour, "#3a7d44"); // green at the high end
});

test("the London comparison talks about nearby food places", () => {
  assert.equal(versusLondonWords("food-hygiene", 80), "More well-rated food places nearby than 80% of London areas");
  assert.equal(versusLondonWords("food-hygiene", 10), "Fewer well-rated food places nearby than 90% of London areas");
});

test("the card counts rated places from the breakdown and the sample", () => {
  const summary = { value: 88.9, sampleCount: 126, breakdown: { "rated-4-or-5": 112 } } as unknown as AreaSummary;
  assert.equal(ratedPlacesWords(summary), "112 of 126 rated food places");
  assert.equal(ratedPlacesWords({ ...summary, breakdown: undefined } as AreaSummary), null);
  assert.equal(ratedPlacesWords({ ...summary, sampleCount: null } as AreaSummary), null);
});
