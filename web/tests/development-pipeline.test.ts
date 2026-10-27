import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DevelopmentPipelineBlock, PipelineSourceItems } from "../src/components/development-pipeline";
import { METRIC_IDS } from "../src/lib/contracts";
import { type AreaPipelineResponse, readAreaPipeline } from "../src/lib/development-pipeline";
import { MAP_TOPIC_GROUPS } from "../src/lib/map-topics";
import { RANGE_LAYER_GROUPS } from "../src/lib/range-layers";

const PIPELINE: AreaPipelineResponse = {
  schemaVersion: "area-pipeline.v1", productReleaseId: "rel-1", dataMode: "release", confidence: "high",
  value: {
    notStarted: 120, underConstruction: 40, completed5y: 30, homes: 800, per1000: 200, regionPercentile: 91,
    within1km: { radiusMetres: 1000, total: 1450, notStarted: 1000, underConstruction: 450 },
    growthAreas: [{ name: "Canada Water", kind: "opportunity-area", url: "https://www.london.gov.uk/oa", share: 0.7, presence: "inside" }],
    notes: ["≈ 1,450 new homes permitted or being built within 1 km", "Inside the Canada Water Opportunity Area"],
  },
  evidence: [], caveats: ["Permissions are not completions: start and finish dates slip, and some permissions lapse unbuilt."],
  sources: [{ release: "src-gla-ldd-pipeline-abc", sourceUrl: "https://www.london.gov.uk/ldd", licence: "OGL-3.0", attribution: "London Development Database" }],
};

const render = (pipeline: AreaPipelineResponse | null | "unknown") =>
  renderToStaticMarkup(createElement(DevelopmentPipelineBlock, { pipeline }));

test("the 1 km count, its split, the rate and the growth area", () => {
  const html = render(PIPELINE);
  assert.match(html, /≈ <strong>1,450<\/strong> within 1 km/);
  assert.match(html, /1,000 not started/);
  assert.match(html, /450 being built/);
  assert.match(html, /<strong>200<\/strong> per 1,000 homes · higher than 91% of London/);
  assert.match(html, /Inside the <a href="https:\/\/www.london.gov.uk\/oa"[^>]*>Canada Water Opportunity Area<\/a>/);
});

test("nothing nearby and no rate stay short", () => {
  const html = render({ ...PIPELINE, value: { ...PIPELINE.value!, per1000: null, growthAreas: [],
    within1km: { radiusMetres: 1000, total: 0, notStarted: 0, underConstruction: 0 } } });
  assert.match(html, /None within 1 km/);
  assert.doesNotMatch(html, /pipeline-split|pipeline-rate|pipeline-growth-area/);
});

test("loading, unknown and unloaded render nothing", () => {
  assert.equal(render(null), "");
  assert.equal(render("unknown"), "");
  assert.equal(render({ ...PIPELINE, value: null }), "");
});

test("sources and caveats go in the section's sources menu", () => {
  const html = renderToStaticMarkup(createElement(PipelineSourceItems, { pipeline: PIPELINE }));
  assert.match(html, /<li>London Development Database<\/li>/);
  assert.match(html, /not completions/);
});

test("the payload reader and the layer: a metric, a Homes & area item and a range criterion", () => {
  assert.equal(readAreaPipeline({ schemaVersion: "area-location.v1", caveats: [] }), null);
  assert.ok(readAreaPipeline(PIPELINE));
  assert.ok((METRIC_IDS as readonly string[]).includes("pipeline-homes-per-1000"));
  const homes = MAP_TOPIC_GROUPS.find((group) => group.id === "homes-area")!;
  assert.ok(homes.items.some((item) => item.layer === "pipeline-homes-per-1000"));
  const ranges = RANGE_LAYER_GROUPS.find((group) => group.id === "homes-area")!;
  assert.ok(ranges.items.some((item) => item.layer === "pipeline-homes-per-1000"));
});
