import assert from "node:assert/strict";
import test from "node:test";

import { METRIC_IDS } from "../src/lib/contracts";
import { getMetric } from "../src/lib/fixtures";
import { mapValueText } from "../src/lib/map-legend";
import { isLayerAvailableInMode, parseMapState } from "../src/lib/map-state";
import { findTopic, MAP_OVERLAYS } from "../src/lib/map-topics";

test("road collisions is a Safety layer that links can open, in either mode", () => {
  assert.ok(METRIC_IDS.includes("road-collisions"));
  const state = parseMapState(new URLSearchParams("selected=uk%3Alsoa%3AE01001209&layer=road-collisions"));
  assert.equal(state.layer, "road-collisions");
  assert.equal(isLayerAvailableInMode("road-collisions", "real"), true);
  assert.equal(findTopic("road-collisions")?.group, "safety");
});

// Layers v5 (PR 1): one item, Road danger; choosing it brings the collisions' dots (use-explorer-controller.ts).
test("the rate layer is named apart from the collisions overlay", () => {
  assert.equal(findTopic("road-collisions")?.label, "Road danger");
  assert.equal(MAP_OVERLAYS.find((overlay) => overlay.id === "collisions")?.label, "Road collisions");
});

test("it counts pedestrians and cyclists hurt, said per 1,000 residents a year", () => {
  const metric = getMetric("road-collisions");
  assert.equal(metric.direction, "higher-is-more");
  assert.equal(metric.unit, "per-1000-residents-per-year");
  assert.equal(mapValueText(1.234, metric), "1.2 hurt per 1,000 residents a year");
});
