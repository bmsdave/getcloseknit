import assert from "node:assert/strict";
import test from "node:test";

import { isDescriptiveLayer, METRIC_IDS } from "../src/lib/contracts";
import { METRICS } from "../src/lib/fixtures";
import { metricGuidePath } from "../src/lib/guide-routes";
import { HELP } from "../src/lib/help-texts";
import { legendTitle, mapValueText } from "../src/lib/map-legend";
import { parseMapState, REAL_PUBLISHED_LAYERS } from "../src/lib/map-state";
import { findTopic, isRankedLayer, LAYER_EXCLUSIONS } from "../src/lib/map-topics";
import { formatRangeValue, rangeLayer } from "../src/lib/range-layers";

const NEW_LAYERS = ["supermarket-walk", "gp-walk", "broadband-gigabit"] as const;

test("Layers v5 PR 3 batch 2: the three new metrics are published, ranked, with a guide each", () => {
  for (const id of NEW_LAYERS) {
    assert.ok((METRIC_IDS as readonly string[]).includes(id), id);
    assert.ok((REAL_PUBLISHED_LAYERS as readonly string[]).includes(id), id);
    assert.equal(parseMapState(new URLSearchParams({ layer: id })).layer, id);
    assert.notEqual(metricGuidePath(id), "/guide", id);
    assert.notEqual(legendTitle(METRICS.find((metric) => metric.id === id)!), "", id);
    assert.ok(!isDescriptiveLayer(id), id);
    assert.ok(isRankedLayer(id), id);
  }
});

test("Supermarket and GP sit in Everyday life as walking minutes; a shorter walk is the better end", () => {
  for (const [id, label] of [["supermarket-walk", "Supermarket"], ["gp-walk", "GP"]] as const) {
    const item = findTopic(id)!;
    assert.equal(item.group, "everyday-life", id);
    assert.equal(item.label, label);
    assert.equal(item.measure, "Walk to nearest");
    const metric = METRICS.find((entry) => entry.id === id)!;
    assert.equal(metric.unit, "minutes");
    assert.equal(rangeLayer(id)?.better, "lower", id);
    assert.equal(formatRangeValue(id, 6.4), "6 min");
  }
  assert.equal(mapValueText(4.2, METRICS.find((metric) => metric.id === "gp-walk")!), "4 min walk to a GP");});

test("Broadband sits in Homes & area where Mobile signal was; more gigabit is the better end", () => {
  const item = findTopic("broadband-gigabit")!;
  assert.equal(item.group, "homes-area");
  assert.equal(item.label, "Broadband");
  assert.equal(rangeLayer("broadband-gigabit")?.better, "higher");
  assert.equal(formatRangeValue("broadband-gigabit", 93.6), "94%");
  assert.match(LAYER_EXCLUSIONS["mobile-4g-indoor"] ?? "", /Broadband/);
  assert.equal(findTopic("mobile-4g-indoor"), null);
  const metric = METRICS.find((entry) => entry.id === "broadband-gigabit")!;
  assert.equal(mapValueText(96.2, metric), "96% gigabit broadband");
});

test("The new layers' demo legends rise strictly, and help texts name source, year and licence", () => {
  for (const id of NEW_LAYERS) {
    const metric = METRICS.find((entry) => entry.id === id)!;
    const values = metric.legend.map((stop) => stop.value);
    assert.ok(values.length >= 2, id);
    for (let index = 1; index < values.length; index += 1) assert.ok(values[index] > values[index - 1], `${id}: ${values}`);
    assert.ok(metric.legend.at(-1)!.label.endsWith("+"), id);
    assert.ok(metric.provenance.licence, id);
    assert.match(HELP[id].short, /Licence/, id);
    assert.match(HELP[id].short, /OpenStreetMap|NHS England|Ofcom/, id);
    assert.match(HELP[id].short, /20\d\d/, id);
  }
});
