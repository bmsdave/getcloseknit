import assert from "node:assert/strict";
import test from "node:test";

import type { MatchResult, PreferenceProfile, RangeCriterion } from "../src/lib/contracts";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { fitRows, limitName, limitReason } from "../src/lib/match-brief";
import { MAP_TOPIC_GROUPS } from "../src/lib/map-topics";
import {
  defaultRange, formatRangeValue, RANGE_LAYER_GROUPS, rangeChipLabel, rangeDomain, rangeLabel, rangeLayer, rangeLayerMenu,
} from "../src/lib/range-layers";

const range = (layer: string, bounds: Partial<RangeCriterion> = {}): RangeCriterion => ({
  layer, min: null, max: null, softMin: null, softMax: null, importance: 3, ...bounds,
});

test("+ Add criterion lists the map's layers in the Layers groups, never a descriptive one", () => {
  const layers = RANGE_LAYER_GROUPS.flatMap((group) => group.items.map((item) => item.layer));
  for (const layer of ["crime", "price-per-square-metre", "typical-price-terraced", "station-access", "noise", "nature-score", "food-hygiene", "custom:gyms", "custom:cycling"]) {
    assert.ok(layers.includes(layer), `${layer} is offered`);
  }
  // Census (religion included) describes people: never a criterion.
  assert.ok(!layers.some((layer) => layer.startsWith("census-")), "no Census layer");
  assert.ok(!layers.includes("wildlife-hedgehog"), "wildlife-hedgehog is not offered");
  // Owner decision 2026-10-18: household income and social renting (Tenure's Social rent view) are; a new range keeps the higher end.
  assert.deepEqual(["income", "social-renting"].map((layer) => [rangeLayer(layer)?.group, rangeLayer(layer)?.short, rangeLayer(layer)?.better]),
    [["homes-area", "Income", "higher"], ["homes-area", "Social rent", "higher"]]);
  assert.equal(rangeLabel(range("income", { min: 50_000 })), "≥ £50k a year");
  assert.equal(rangeLabel(range("social-renting", { max: 20 })), "≤ 20% of households");
  // Deprivation, the official index of the area, is (owner decision 2026-10-17): a higher decile is better.
  assert.equal(rangeLayer("deprivation")?.group, "homes-area");
  assert.equal(rangeLayer("deprivation")?.better, "higher");
  assert.ok(!RANGE_LAYER_GROUPS.some((group) => group.id === "people" || group.id === "my-criteria"));
  // The same groups, in the same order, as the Layers menu.
  const menuOrder = MAP_TOPIC_GROUPS.map((group) => group.id).filter((id) => RANGE_LAYER_GROUPS.some((group) => group.id === id));
  assert.deepEqual(RANGE_LAYER_GROUPS.map((group) => group.id), menuOrder);
  assert.equal(new Set(layers).size, layers.length, "each layer once");
});

test("the layer on the map is offered first, and chosen layers leave the list", () => {
  const menu = rangeLayerMenu("crime", ["noise"]);
  assert.equal(menu.first?.label, "Crime");
  assert.ok(!menu.groups.flatMap((group) => group.items).some((item) => item.layer === "noise"));
  assert.equal(rangeLayerMenu("crime", ["crime"]).first, null);
  assert.equal(rangeLayerMenu("census-religion-muslim", []).first, null);
  assert.equal(rangeLayerMenu(null, []).first, null);
});

test("ranges read in the household's words, on the card and as a chip", () => {
  assert.equal(rangeLabel(range("crime", { max: 25 })), "≤ 25 crimes / 1,000");
  assert.equal(rangeLabel(range("price-per-square-metre", { max: 7000, softMax: 8000 })), "≤ £7k/m² · soft to £8k");
  assert.equal(rangeLabel(range("food-hygiene", { min: 80, softMin: 60 })), "≥ 80% rated 4–5 · soft from 60%");
  assert.equal(rangeLabel(range("station-access", { min: 2, max: 10 })), "2 min–10 min walk");
  assert.equal(rangeChipLabel(range("crime", { max: 25 }), true), "Crime ≤ 25 · Must");
  assert.equal(rangeChipLabel(range("price-per-square-metre", { max: 7000, softMax: 8000 }), false), "Price/m² ≤ £7k · ≈ £8k");
  assert.equal(formatRangeValue("typical-price-terraced", 650_000), "£650k");
  assert.equal(formatRangeValue("price-per-square-metre", 7450), "£7.5k");
  assert.equal(formatRangeValue("custom:gyms", 3), "3 min"); // Layers v5: the nearest gym
  assert.equal(formatRangeValue("custom:nightlife", 2.5), "2.5 per 1,000");
  assert.equal(formatRangeValue("custom:universities", 3), "3 places");
  assert.equal(rangeLayer("typical-price-terraced")?.label, "Typical price · Terraced");
});

test("the slider spans London from its lowest to its 98th percentile, and a new range keeps the better half", () => {
  const values = Array.from({ length: 101 }, (_, index) => index * 2); // 0 … 200, with an outlier
  values.push(2_000);
  const domain = rangeDomain(values);
  assert.equal(domain.low, 0);
  assert.ok(domain.high >= 196 && domain.high <= 200, `high ${domain.high}`);
  assert.equal(domain.tail, true);
  assert.deepEqual(defaultRange("crime", values), range("crime", { max: 102 }));
  assert.deepEqual(defaultRange("food-hygiene", [60, 70, 80, 90, 100]), range("food-hygiene", { min: 80 }));
});

const profile: PreferenceProfile = {
  ...structuredClone(DEFAULT_PROFILE),
  factors: [{ factorId: "crime", weight: 3, direction: "lower", minimumUtility: 50, maximumUtility: null }],
  places: [{ id: "any-park", label: "Any park", target: { kind: "category", category: "park" }, mode: "walk", targetMinutes: 5, weight: 2, must: false }],
  ranges: [range("crime", { max: 25 }), range("price-per-square-metre", { max: 7000, softMax: 8000 })],
};

const result = (components: MatchResult["components"], unmetLimits: string[] = []): MatchResult => ({
  geographyId: "uk:lsoa:E01000001", name: "Bexley 022A", title: "Lamorbey · DA15", score: unmetLimits.length ? null : 61, rank: null,
  evidenceCompleteness: 100, excluded: unmetLimits.length > 0, unmetLimits, sourceReleaseSet: "t", components,
});
const part = (factorId: string, rawValue: number, utility: number, fit?: number) => ({
  factorId: factorId as MatchResult["components"][number]["factorId"], rawValue, unit: "", utility, weight: 3, contribution: 0,
  carrierGeographyId: "uk:lsoa:E01000001" as const, quality: "observed" as const, sourceVersion: "t", ...(fit === undefined ? {} : { fit }),
});

test("Fix 20: one table of friendly names, and short reasons, never a raw id", () => {
  assert.equal(limitName(profile, "place:any-park"), "Any park ≤ 5 min");
  assert.equal(limitName(profile, "crime"), "Safer streets · lowest 50% of London");
  assert.equal(limitName(profile, "range:crime"), "Crime ≤ 25");
  assert.equal(limitName(profile, "zone"), "Your zones");
  assert.equal(limitName(profile, "mark"), "Areas you ruled out");
  const out = result([part("place:any-park", 12.4, 30), part("crime", 70, 30), part("range:crime", 46, 0, 0)],
    ["place:any-park:below-minimum", "crime:below-minimum", "range:crime:outside", "mark:excluded", "range:noise:missing"]);
  assert.deepEqual(out.unmetLimits.map((code) => limitReason(profile, out, code)),
    ["park 12 min", "safer streets fit 30", "crime 46", "you ruled it out", "no data"]);
});

test("the map popup says how an area sits against each criterion: in, on the edge, out", () => {
  const rows = fitRows(result([part("range:crime", 12, 100, 1), part("range:price-per-square-metre", 7400, 60, 0.6), part("place:any-park", 9, 40)]), profile);
  assert.deepEqual(rows.map((row) => [row.name, row.value, row.state, row.note]), [
    ["Crime", "12 / 1,000", "in", null],
    ["Price per m²", "£7.4k", "edge", "on the edge, 60%"],
    ["Any park", "9 min", "edge", "over 5"],
  ]);
  const out = fitRows(result([part("range:crime", 46, 0, 0)], ["range:crime:outside"]), profile);
  assert.deepEqual(out.map((row) => [row.state, row.note]), [["out", "over 25 / 1,000"]]);
});

test("v4 Task 21: the popup shows a wizard factor's real value with ✓ ≈ ✗, and never a criterion the search dropped", () => {
  const nice = { ...profile, factors: [{ ...profile.factors[0], minimumUtility: null }], ranges: [] };
  const crime = { ...part("crime", 70, 60, 0.6), layer: "crime", percentile: 60, fitKind: "edge" as const };
  const stale = part("range:crime", 46, 0, 0);
  const rows = fitRows(result([crime, stale]), nice);
  assert.deepEqual(rows.map((row) => [row.name, row.value, row.state, row.note]), [["Safer streets", "70 / 1,000", "edge", "on the edge, 60%"]]);
  assert.equal(limitReason(nice, result([crime]), "crime:outside"), "safer streets 70");
});
