import assert from "node:assert/strict";
import test from "node:test";

import type { PlacePreference, PreferenceProfile } from "../src/lib/contracts";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import {
  applyRelaxation, buildMatchPack, describeUnmetLimits, estimatePlaceMinutes, limitFactor, matchValuePack,
} from "../src/lib/matching";
import { matchBand } from "../src/lib/match-map";
import { rangeFit, specs } from "../src/lib/match-model";

// Places and marks in preview matching: the same rules as api/area_api/matching.py.
const work: PlacePreference = {
  id: "work", label: "Office", target: { kind: "point", latitude: 51.545, longitude: -0.094 },
  mode: "transit", targetMinutes: 20, weight: 5, must: true,
};
const park: PlacePreference = { id: "park", label: "Any park", target: { kind: "category", category: "park" }, mode: "walk", targetMinutes: 10, weight: 2, must: false };

function profile(extra: Partial<PreferenceProfile>): PreferenceProfile {
  return structuredClone({ ...DEFAULT_PROFILE, ...extra });
}

test("estimates use the same formulas as the API", () => {
  const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);
  near(estimatePlaceMinutes(1, "walk"), 16.25);
  near(estimatePlaceMinutes(5, "cycle"), 26);
  near(estimatePlaceMinutes(10, "transit", 6), 36);
  near(estimatePlaceMinutes(0.5, "transit", 12), 0.5 * 1.3 / 4.8 * 60);
});

test("limit ids keep the place id", () => {
  assert.equal(limitFactor("place:gym:outside"), "place:gym");
  assert.equal(limitFactor("crime:outside"), "crime");
  assert.equal(limitFactor("zone:outside"), "zone");
  assert.equal(limitFactor("mark:excluded"), "mark");
});

test("places are criteria; must is a limit that relaxes like any other", () => {
  const pack = buildMatchPack(profile({ places: [work, park] }));
  const north = pack.values.find((result) => result.geographyId === "uk:lsoa:E01000002")!;
  const component = north.components.find((part) => part.factorId === "place:work")!;
  assert.equal(component.unit, "minutes");
  assert.equal(component.targetMinutes, 20);
  assert.equal(component.utility, 100);
  assert.ok(north.components.some((part) => part.factorId === "place:park"));

  const farAway = pack.values.filter((result) => result.unmetLimits.includes("place:work:outside"));
  assert.ok(farAway.length > 0, "an area beyond 20 minutes fails the must");
  assert.match(describeUnmetLimits(farAway[0], profile({ places: [work, park] }))[0], /^Office: about \d+ min, over your 20$/);
  const relaxed = applyRelaxation(pack, ["place:work"]);
  assert.ok(relaxed.values.every((result) => !result.unmetLimits.some((code) => code.startsWith("place:work"))));
});

test("an area the household ruled out leaves the ranking", () => {
  const ruledOut = profile({ marks: { liked: [], excluded: ["uk:lsoa:E01000001"], notes: {} } });
  const result = buildMatchPack(ruledOut).values.find((entry) => entry.geographyId === "uk:lsoa:E01000001")!;
  assert.deepEqual(result.unmetLimits, ["mark:excluded"]);
  assert.equal(result.rank, null);
  assert.deepEqual(describeUnmetLimits(result, ruledOut), ["You ruled this area out"]);
});

test("a place is minutes with a soft edge: 1 up to the time set, 0 at +50% (same numbers as the API)", () => {
  const spec = specs(profile({ factors: [], places: [{ ...work, targetMinutes: 30, must: false }] }))[0];
  const cases: Array<[number, number]> = [[0, 1], [30, 1], [37.5, 0.5], [45, 0], [90, 0]];
  assert.deepEqual(cases.map(([minutes]) => rangeFit(minutes, spec.min, spec.max, spec.softMin, spec.softMax)), cases.map(([, fit]) => fit));
  assert.equal(specs(profile({ factors: [], places: [work] }))[0].softMax, null, "a Must place has no soft edge");
});

test("the map colours every scored area by its band, with no top-50 cap (v4 Task 21e)", () => {
  const pack = buildMatchPack(DEFAULT_PROFILE);
  const values = matchValuePack(pack).values;
  assert.equal(values.length, pack.values.length);
  assert.deepEqual(values.map((entry) => entry.value),
    pack.values.map((result) => (result.excluded || result.score === null ? null : matchBand(result.percentile!))));
  assert.ok(pack.values.every((result) => result.percentile !== null && result.percentile !== undefined));
});
