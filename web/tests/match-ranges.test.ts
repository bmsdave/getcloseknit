import assert from "node:assert/strict";
import test from "node:test";

import { assertPreferenceProfile, assertRanges, propertyKind, type GeographyId, type PreferenceProfile, type RangeCriterion } from "../src/lib/contracts";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import {
  areasLeft, cutHint, fitScore, histogram, impacts, isStrict, livePack, rangeFit, withMust,
} from "../src/lib/match-ranges";
import { applyRelaxation, buildMatchPack, describeUnmetLimits, scoreMatchPack, type RawMatchArea } from "../src/lib/matching";

// v4 Task 21: one model, the same numbers as api/tests/test_matching.py RangeCriteriaTests.

const range = (layer: string, bounds: Partial<RangeCriterion> = {}): RangeCriterion => ({
  layer, min: null, max: null, softMin: null, softMax: null, importance: 3, ...bounds,
});

function profileWith(ranges: RangeCriterion[], factors: PreferenceProfile["factors"] = []): PreferenceProfile {
  const profile = structuredClone(DEFAULT_PROFILE);
  profile.factors = factors.length ? factors : profile.factors.map((factor) => ({ ...factor, weight: 0, minimumUtility: null }));
  profile.ranges = ranges;
  return profile;
}

function area(id: string, values: Record<string, number>, factors: RawMatchArea["factors"] = {}): RawMatchArea {
  const ranges = Object.fromEntries(Object.entries(values).map(([layer, rawValue]) => [`range:${layer}`, {
    rawValue, unit: layer === "crime" ? "per 1,000" : "", carrierGeographyId: `uk:lsoa:${id}` as GeographyId, quality: "observed" as const, sourceVersion: "test",
  }]));
  return { geographyId: `uk:lsoa:${id}` as GeographyId, name: id, price: 0, monthlyRent: 0, journeys: {}, factors, ranges };
}

test("a range's fit is 1 inside, falls across the soft edge and is 0 beyond", () => {
  const crime = range("crime", { max: 25, softMax: 35 });
  assert.deepEqual([10, 25, 30, 35, 80].map((value) => rangeFit(value, crime)), [1, 1, 0.5, 0, 0]);
  const hygiene = range("food-hygiene", { min: 80, softMin: 60 });
  assert.equal(rangeFit(75, hygiene), 0.75);
  assert.equal(rangeFit(59, hygiene), 0);
});

test("Must is only the preset with the edges at the range", () => {
  assert.ok(isStrict(range("crime", { max: 25 })));
  assert.ok(isStrict(range("crime", { max: 25, softMax: 25 })));
  assert.ok(!isStrict(range("crime", { max: 25, softMax: 26 })));
  assert.ok(isStrict(withMust(range("crime", { max: 25, softMax: 40 }))));
  assert.equal(rangeFit(25.5, range("crime", { max: 25 })), 0);
});

test("a strict range puts areas out and soft edges shade the near misses", () => {
  const profile = profileWith([range("crime", { max: 25 }), range("price-per-square-metre", { max: 7000, softMax: 8000 })]);
  const pack = scoreMatchPack(profile, [
    area("E01000003", { crime: 46, "price-per-square-metre": 5000 }),
    area("E01000002", { crime: 20, "price-per-square-metre": 7400 }),
    area("E01000001", { crime: 12, "price-per-square-metre": 6500 }),
  ]);
  assert.deepEqual(pack.values.map((result) => [result.geographyId, result.score]),
    // Crime has no soft edge: a Must (a filter, no weight); the price is the only ranked criterion (fit 0.6).
    [["uk:lsoa:E01000001", 100], ["uk:lsoa:E01000002", 60], ["uk:lsoa:E01000003", null]]);
  const out = pack.values[2];
  assert.deepEqual(out.unmetLimits, ["range:crime:outside"]);
  assert.deepEqual(describeUnmetLimits(out, profile), ["Crime 46 per 1,000 is outside your ≤ 25"]);
  assert.equal(pack.values[1].components.find((component) => component.factorId === "range:price-per-square-metre")?.fit?.toFixed(2), "0.60");
});

test("importance dots set the order, the order sets the weights", () => {
  const profile = profileWith([range("crime", { max: 25, softMax: 35, importance: 1 }), range("station-access", { max: 10, softMax: 20, importance: 4 })]);
  // Station first (0.75), crime second (0.25): 0.8^0.75 · 0.5^0.25 = 0.7113.
  assert.equal(scoreMatchPack(profile, [area("E01000001", { crime: 30, "station-access": 12 })]).values[0].score, 71);
});

test("the old must and nice fields map onto the model", () => {
  const nice = { factorId: "crime" as const, weight: 2, direction: "lower" as const, minimumUtility: null, maximumUtility: null };
  const crime = { "crime": { rawValue: 60, percentile: 60, carrierGeographyId: "uk:lsoa:E01000001" as GeographyId, quality: "observed" as const, sourceVersion: "t" } };
  const areas = [area("E01000001", { "station-access": 4 }, crime)];
  const nicePack = scoreMatchPack(profileWith([range("station-access", { max: 10 })], [nice]), areas);
  // A wizard factor is a range on its London percentile (the better half, soft to the 75th): the 60th fits 0.6.
  assert.equal(nicePack.values[0].score, 60);
  const mustPack = scoreMatchPack(profileWith([range("station-access", { max: 10 })], [{ ...nice, minimumUtility: 50 }]), areas);
  assert.deepEqual(mustPack.values[0].unmetLimits, ["crime:outside"]);
  assert.equal(applyRelaxation(mustPack, ["crime"]).values[0].score, 100);
});

test("relaxing a Must lets its areas back in", () => {
  const pack = scoreMatchPack(profileWith([range("crime", { max: 25 })]), [area("E01000001", { crime: 40 })]);
  assert.ok(pack.values[0].excluded);
  const relaxed = applyRelaxation(pack, ["range:crime"]).values[0];
  assert.equal(relaxed.excluded, false);
  assert.equal(relaxed.score, 100); // a Must has no weight: nothing else to rank on
});

test("a missing value rules an area out only under a Must", () => {
  const areas = [area("E01000001", { crime: 10 }), area("E01000002", {})];
  const strict = scoreMatchPack(profileWith([range("crime", { max: 25 })]), areas);
  assert.deepEqual(strict.values.find((result) => result.geographyId === "uk:lsoa:E01000002")?.unmetLimits, ["range:crime:missing"]);
  const soft = scoreMatchPack(profileWith([range("crime", { max: 25, softMax: 40 })]), areas);
  assert.equal(soft.values.find((result) => result.geographyId === "uk:lsoa:E01000002")?.excluded, false);
});

test("Census and religion are never criteria", () => {
  for (const layer of ["census-religion-muslim", "census-ethnicity-white", "census-tenure-owned"]) {
    assert.throws(() => assertRanges([range(layer, { max: 10 })]), /never a match criterion/, layer);
  }
  assert.doesNotThrow(() => assertRanges([range("crime", { max: 25 }), range("custom:gyms", { min: 2, softMin: 1 })]));
  // Owner decision 2026-10-17: the official deprivation decile is an ordinary range.
  assert.doesNotThrow(() => assertRanges([range("deprivation", { min: 7 })]));
  // Owner decision 2026-10-18: so are household income and social renting.
  assert.doesNotThrow(() => assertRanges([range("income", { min: 50_000 }), range("social-renting", { max: 20 })]));
  for (const bad of [range("crime"), range("crime", { min: 30, max: 20 }), range("crime", { max: 25, softMax: 20 }),
    range("crime", { min: 5, softMin: 8 }), range("crime", { max: 25, importance: 0 }), { ...range("crime", { max: 25 }), extra: 1 } as never,
    range("Crime!", { max: 25 })]) {
    assert.throws(() => assertRanges([bad]));
  }
  assert.throws(() => assertRanges([range("crime", { max: 25 }), range("crime", { max: 30 })]));
});

test("any house subtype counts as a house (Fix 33)", () => {
  assert.equal(propertyKind({}), "any");
  assert.equal(propertyKind({ houseTypes: ["terraced", "semi"] }), "house");
  assert.equal(propertyKind({ propertyType: "flat", houseTypes: [] }), "flat");
  const profile = structuredClone(DEFAULT_PROFILE);
  assert.doesNotThrow(() => assertPreferenceProfile({ ...profile, houseTypes: ["terraced", "detached"] }));
  for (const bad of [["bungalow"], ["semi", "semi"], "semi"]) {
    assert.throws(() => assertPreferenceProfile({ ...profile, houseTypes: bad as never }));
  }
});

test("the preview matches ranges on the map fixture's own values", () => {
  const pack = buildMatchPack(profileWith([range("crime", { max: 80 })]));
  // Preview crime per 1,000: Westminster 54, South Bank 76 in; North London 112 out (a strict range is a Must).
  const out = pack.values.filter((result) => result.excluded).map((result) => result.name);
  assert.ok(out.length >= 1 && out.length < 3, `some areas out, not all: ${out.join(", ")}`);
  assert.ok(pack.values.every((result) => result.components.some((component) => component.factorId === "range:crime")));
});

test("dragging a slider recolours from the pack's own values, before the match runs again", () => {
  const profile = profileWith([range("crime", { max: 25 })]);
  const pack = scoreMatchPack(profile, [area("E01000001", { crime: 12 }), area("E01000002", { crime: 30 }), area("E01000003", { crime: 46 })]);
  assert.deepEqual(areasLeft(pack), { left: 1, total: 3 });
  const wider = livePack(pack, range("crime", { max: 25, softMax: 50 }), null);
  // Crime 30 and 46 across a 25–50 soft edge: fits 0.8 and 0.16.
  assert.deepEqual(wider.values.map((result) => result.score), [100, 80, 16]);
  // A new criterion reads its values from the layer (all London areas, loaded once).
  const walk = livePack(pack, range("station-access", { max: 10 }), new Map([["uk:lsoa:E01000001", 14]]));
  assert.deepEqual(walk.values.map((result) => result.unmetLimits), [
    ["range:station-access:outside"], ["range:crime:outside", "range:station-access:missing"], ["range:crime:outside", "range:station-access:missing"]]);
  assert.deepEqual(cutHint(walk), { id: "range:station-access", none: true }, "it puts all three out");
});

test("each criterion says how many areas it alone puts out (−n)", () => {
  const profile = profileWith([range("crime", { max: 25 }), range("station-access", { max: 10 })]);
  const pack = scoreMatchPack(profile, [
    area("E01000001", { crime: 12, "station-access": 4 }), area("E01000002", { crime: 40, "station-access": 4 }),
    area("E01000003", { crime: 40, "station-access": 20 }), area("E01000004", { crime: 12, "station-access": 20 }),
    area("E01000005", { crime: 50, "station-access": 6 })]);
  const counts = impacts(pack);
  assert.equal(counts.get("range:crime"), 2);
  assert.equal(counts.get("range:station-access"), 1);
  assert.equal(cutHint(pack), null, "one area of five is left: not few enough for a hint");
});

test("with few areas left and two criteria cutting, the hint names the one that cuts most; zones never", () => {
  const profile = profileWith([range("crime", { max: 25 }), range("station-access", { max: 10 })]);
  // Eleven areas, one left: crime puts out ten, the walk four.
  const areas = Array.from({ length: 11 }, (_, index) => area(`E010000${String(index + 10)}`, {
    crime: index === 0 ? 12 : 40, "station-access": index < 7 ? 4 : 20,
  }));
  const pack = scoreMatchPack(profile, areas);
  assert.deepEqual(areasLeft(pack), { left: 1, total: 11 });
  assert.deepEqual(cutHint(pack), { id: "range:crime", none: false });
  // One criterion alone: the count says it all.
  assert.equal(cutHint(scoreMatchPack(profileWith([range("crime", { max: 25 })]), areas)), null);
  // Only zones (or areas ruled out) cut: there is no edge to soften.
  const zoned = { ...pack, values: pack.values.map((result) => ({ ...result, excluded: true, unmetLimits: ["zone:outside"] })) };
  assert.equal(cutHint(zoned), null);
});

test("the score is the weighted geometric mean, half up, like the API", () => {
  assert.equal(fitScore([{ fit: 0.335, utility: 0, weight: 1 }]), 34);
  assert.equal(fitScore([{ fit: 0.525, utility: 0, weight: 1 }]), 53);
  assert.equal(fitScore([{ fit: 1, utility: 0, weight: 0 }]), 100, "only Musts: nothing to rank on");
  assert.equal(fitScore([{ fit: 0, utility: 0, weight: 1 }]), 0, "past the soft edge: 0, scored low, not out");
  assert.equal(fitScore([{ fit: 0.02, utility: 0, weight: 1 }]), 2, "the far end of a soft edge falls all the way, no floor");
  assert.equal(fitScore([{ fit: 1, utility: 0, weight: 0.75 }], 0.25), 84, "no evidence counts as half a fit");
  assert.deepEqual(histogram([0, 4, 5, 9, 10, 99], 0, 10, 2), [2, 4]);
});
