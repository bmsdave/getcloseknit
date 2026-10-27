import assert from "node:assert/strict";
import test from "node:test";

import { assertPreferenceProfileV2, type PreferenceProfile, type PreferenceProfileV2 } from "../src/lib/contracts";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { createMatchRequest, resetMatchJobs } from "../src/lib/match-jobs";
import { contractProfile, migrateV1, rocWeights, specs, zoneDistances } from "../src/lib/match-model";
import { buildMatchPack, previewCriterionValues } from "../src/lib/matching";

// v4 Tasks 21, 21d, 21e, 8: the same rules as api/tests/test_match_model.py.

test("weights come from the place in the list (rank-order centroid)", () => {
  assert.deepEqual(rocWeights(2), [0.75, 0.25]);
  assert.deepEqual(rocWeights(13).slice(0, 4).map((weight) => Math.round(weight * 100)), [24, 17, 13, 10]);
  const fifteen = rocWeights(15);
  assert.ok(Math.abs(fifteen.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-12);
  assert.equal(Math.round(fifteen[0] * 100), 22);
  assert.equal(Math.round(fifteen[14] * 1000), 4);
});

test("a v1 search becomes one ordered list: dots → order, Must kept, zones first", () => {
  const v1: PreferenceProfile = {
    ...structuredClone(DEFAULT_PROFILE),
    factors: [
      { factorId: "affordability", weight: 3, direction: "target-range", minimumUtility: null, maximumUtility: null },
      { factorId: "crime", weight: 5, direction: "lower", minimumUtility: 50, maximumUtility: null },
      { factorId: "noise", weight: 4, direction: "lower", minimumUtility: null, maximumUtility: null },
    ],
    places: [{ id: "gym", label: "Gym", target: { kind: "category", category: "gym" }, mode: "walk", targetMinutes: 10, weight: 4, must: true }],
    ranges: [{ layer: "air-no2", min: null, max: 30, softMin: null, softMax: 40, importance: 2 }],
    zones: [{ kind: "borough", id: "uk:lad:E09000007" }],
  };
  const v2 = migrateV1(v1);
  assert.deepEqual(specs(v2).map((spec) => [spec.id, spec.must, Math.round(spec.weight * 1000)]), [
    ["zone", false, 521], ["crime", true, 0], ["noise", false, 271], ["place:gym", true, 0], ["affordability", false, 146], ["range:air-no2", false, 63]]); // four ranked: 52%, 27%, 15%, 6%
  const clean = contractProfile(v1);
  assert.doesNotThrow(() => assertPreferenceProfileV2(clean));
  assert.ok(clean.criteria.every((item) => Object.keys(item).every((key) => !key.startsWith("_"))));
});

test("distances outside a zone reach the nearest area inside, capped at three soft edges", () => {
  const points = new Map<string, [number, number]>([["in", [51.5, -0.1]], ["near", [51.509, -0.1]], ["far", [51.6, -0.1]]]);
  assert.deepEqual([...zoneDistances(new Set(["in"]), points, 1000)], [["in", 0], ["near", 995], ["far", 3000]]);
});

test("a v2 search scores in the preview, with rank, percentile, reasons and the bottom list", () => {
  const v2: PreferenceProfileV2 = {
    schemaVersion: "preference-profile.v2", market: "buy", targetBudget: 500_000, maximumBudget: 650_000,
    criteria: [{ kind: "range", layer: "disorder", scale: "percentile", min: null, max: 50, softMin: null, softMax: 75 }, { kind: "budget" }],
  };
  const pack = buildMatchPack(v2);
  assert.equal(pack.profileVersion, "preference-profile.v2");
  assert.deepEqual(pack.values.map((result) => result.percentile), [100, 50, 0]);
  assert.ok(pack.values.every((result) => result.components.some((component) => component.factorId === "range:disorder")));
  assert.equal(pack.bottom?.[0].geographyId, pack.values.at(-1)!.geographyId);
  resetMatchJobs();
  assert.equal(createMatchRequest(v2).status, 200);
});

test("every criterion layer has values for its card, the map's own or the factor's", () => {
  const disorder = previewCriterionValues("disorder")!;
  assert.equal(disorder.values.length, 3);
  assert.ok(disorder.values.every((entry) => entry.regionPercentile !== null));
  assert.equal(previewCriterionValues("crime")?.values.length, 3);
  assert.equal(previewCriterionValues("census-religion-muslim"), null);
  assert.equal(previewCriterionValues("not-a-layer"), null);
});
