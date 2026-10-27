import assert from "node:assert/strict";
import test from "node:test";

import { chartScale, describeTrend } from "../src/lib/chart-scale";

test("scale exposes the numbers a reader needs: low, high, first and latest observed values", () => {
  const scale = chartScale([100, 120, null, 90, 110], { width: 260, height: 80 });
  assert.equal(scale.low, 90);
  assert.equal(scale.high, 120);
  assert.equal(scale.first, 100);
  assert.equal(scale.latest, 110);
  assert.equal(scale.observedCount, 4);
});

test("missing months break the line instead of dropping to zero", () => {
  const scale = chartScale([100, 120, null, 90, 110], { width: 260, height: 80 });
  assert.equal(scale.segments.length, 2);
  assert.equal(scale.segments[0].split(" ").length, 2);
  assert.equal(scale.segments[1].split(" ").length, 2);
  assert.ok(!scale.segments.join(" ").includes("NaN"));
});

test("a flat series still draws a mid-height line and a single tick", () => {
  const scale = chartScale([50, 50, 50], { width: 100, height: 80 });
  assert.equal(scale.segments.length, 1);
  assert.deepEqual(scale.ticks, [50]);
  assert.ok(scale.segments[0].split(" ").every((point) => point.endsWith(",40")));
});

test("ticks span low to high with the midpoint, and an empty series is explicit", () => {
  assert.deepEqual(chartScale([10, 30], { width: 100, height: 80 }).ticks, [30, 20, 10]);
  const empty = chartScale([null, null], { width: 100, height: 80 });
  assert.equal(empty.observedCount, 0);
  assert.deepEqual(empty.segments, []);
  assert.deepEqual(empty.ticks, []);
});

test("trend wording is derived from the data, never assumed", () => {
  assert.equal(describeTrend(100, 130), "rises");
  assert.equal(describeTrend(100, 80), "falls");
  assert.equal(describeTrend(100, 101), "is broadly flat");
  assert.equal(describeTrend(null, 5), "is incomplete");
});
