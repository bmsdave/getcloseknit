import assert from "node:assert/strict";
import test from "node:test";

import {
  AREA_SEMANTICS,
  FLOOD_CHECK_URL,
  LOCATION_SEMANTICS,
  assessFloodArea,
  assessFloodLocation,
  estimateInsuranceCost,
} from "../src/lib/flood-evidence";
import * as floodEvidence from "../src/lib/flood-evidence";

test("a location on the mapped boundary counts as exposed", () => {
  const result = assessFloodLocation(-0.17, 51.505);

  assert.equal(result.status, "exposed");
  assert.ok(result.intersections.some(
    ([mechanism, hit]) => mechanism === "rivers-sea" && hit,
  ));
});

test("overlapping mechanisms stay separately named, never one score", () => {
  const result = assessFloodLocation(-0.13, 51.51);

  assert.equal(result.status, "exposed");
  const exposed = result.intersections.filter(([, hit]) => hit).map(([name]) => name).sort();
  assert.deepEqual(exposed, ["rivers-sea", "surface-water"]);
  assert.match(result.explanation, /surface-water/);
  assert.doesNotMatch(result.explanation.toLowerCase(), /flood score/);
});

test("an out-of-coverage location is distinct from no mapped exposure", () => {
  const outside = assessFloodLocation(-0.3, 51.51);
  const clear = assessFloodLocation(-0.07, 51.55);

  assert.equal(outside.status, "no-coverage");
  assert.equal(clear.status, "no-mapped-exposure");
  assert.notEqual(outside.status, clear.status);
  assert.match(outside.explanation.toLowerCase(), /coverage/);
});

test("a coarse area with a small exposed section reports area exposure", () => {
  const coarse: [number, number][] = [
    [-0.25, 51.45], [0.05, 51.45], [0.05, 51.6], [-0.25, 51.6], [-0.25, 51.45],
  ];
  const result = assessFloodArea(coarse);

  assert.equal(result.semantics, AREA_SEMANTICS);
  assert.ok(result.exposures["rivers-sea"] > 0);
  assert.ok(result.exposures["rivers-sea"] < 0.1);
  assert.ok(Math.abs(result.exposures["rivers-sea"] - 0.04) < 0.001);
  assert.match(result.explanation.toLowerCase(), /coarse/);
  assert.match(result.explanation.toLowerCase(), /building/);
});

test("locations use polygon intersection while areas use area exposure", () => {
  assert.equal(LOCATION_SEMANTICS, "polygon-intersection");
  assert.equal(AREA_SEMANTICS, "area-exposure");
});

test("two candidates screen differently by mechanism, not by one score", () => {
  const westminster = assessFloodArea([
    [-0.168, 51.489], [-0.113, 51.489], [-0.113, 51.528], [-0.168, 51.528],
    [-0.168, 51.489],
  ]);
  const north = assessFloodArea([
    [-0.123, 51.523], [-0.068, 51.523], [-0.068, 51.57], [-0.123, 51.57],
    [-0.123, 51.523],
  ]);

  assert.ok(westminster.exposures["rivers-sea"] > 0.5);
  assert.equal(north.exposures["rivers-sea"], 0);
  assert.ok(north.exposures["surface-water"] > 0);
});

test("insurance-cost prediction is unsupported", () => {
  assert.throws(() => estimateInsuranceCost(-0.13, 51.51), /unsupported/);
});

test("no single generic flood score is exported", () => {
  assert.equal((floodEvidence as Record<string, unknown>)["floodScore"], undefined);
  assert.equal((floodEvidence as Record<string, unknown>)["flood_score"], undefined);
});

test("the official check service is linked", () => {
  assert.match(FLOOD_CHECK_URL, /^https:\/\/www\.gov\.uk\//);
});
