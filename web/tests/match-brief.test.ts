import assert from "node:assert/strict";
import test from "node:test";

import type { MatchComponent, MatchPack, MatchResult, PlacePreference, PreferenceProfile } from "../src/lib/contracts";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import {
  alternativeFor, briefAreasFor, briefRequestFor, budgetGroups, budgetHeader, criteriaFor, overBudgetLabel, relaxBudget, keepStrict, relaxCriterion, setNote, statusOf, toggleMark, tradeoffsFor,
  verdictFor,
} from "../src/lib/match-brief";

const gym: PlacePreference = { id: "gym", label: "PureGym Angel", target: { kind: "point", latitude: 51.53, longitude: -0.1 }, mode: "walk", targetMinutes: 15, weight: 3, must: false };
const cafe: PlacePreference = { id: "cafe", label: "Any cafe", target: { kind: "category", category: "cafe" }, mode: "walk", targetMinutes: 5, weight: 1, must: false };
const profile: PreferenceProfile = structuredClone({ ...DEFAULT_PROFILE, targetBudget: 800_000, maximumBudget: 900_000, places: [gym, cafe] });

const component = (factorId: string, rawValue: number, utility: number, weight: number, targetMinutes?: number): MatchComponent => ({
  factorId: factorId as MatchComponent["factorId"], rawValue, unit: targetMinutes ? "minutes" : "u", utility, weight, contribution: 0,
  carrierGeographyId: "uk:lsoa:E01000001", quality: "observed", sourceVersion: "s", ...(targetMinutes ? { targetMinutes } : {}),
});
const result = (id: string, rank: number | null, components: MatchComponent[], excluded = false): MatchResult => ({
  geographyId: id as MatchResult["geographyId"], name: id.slice(-3), score: rank ? 90 - rank : null, rank,
  evidenceCompleteness: 100, excluded, unmetLimits: excluded ? ["crime:below-minimum"] : [], components,
} as MatchResult);

const selected = result("uk:lsoa:E01000001", 1, [component("crime", 30, 85, 4), component("place:gym", 9, 100, 3, 15), component("place:cafe", 8, 40, 1, 5)]);
const second = result("uk:lsoa:E01000002", 2, [component("crime", 60, 55, 4), component("place:gym", 18, 80, 3, 15), component("place:cafe", 3, 100, 1, 5)]);
const pack = { schemaVersion: "match-pack.v1", profileVersion: "preference-profile.v1", sourceReleaseSet: "s",
  values: [selected, second, result("uk:lsoa:E01000003", null, [], true)] } as MatchPack;

test("the brief covers the selected area, the list's page of ten, then liked areas (Fix 19)", () => {
  assert.deepEqual(briefAreasFor(pack, "uk:lsoa:E01000002", ["uk:lsoa:E01000003"]),
    ["uk:lsoa:E01000002", "uk:lsoa:E01000001", "uk:lsoa:E01000003"]);
  assert.deepEqual(briefAreasFor(pack, "uk:lad:E09000007"), ["uk:lsoa:E01000001", "uk:lsoa:E01000002"]);
  // Page 2 numbers rows 11–20: 25 ranked areas, the second page is the 11th to the 20th.
  const many = { ...pack, values: Array.from({ length: 25 }, (_, index) => result(`uk:lsoa:E0100${String(index + 10).padStart(4, "0")}`, index + 1, [])) } as MatchPack;
  const second = briefAreasFor(many, null, [], 1);
  assert.equal(second.length, 10);
  assert.equal(second[0], "uk:lsoa:E01000020");
  assert.equal(second[9], "uk:lsoa:E01000029");
  assert.ok(briefAreasFor(many, "uk:lsoa:E01000099", ["uk:lsoa:E01000098", "uk:lsoa:E01000097"]).length <= 12);
});

test("the brief request carries the budget, the home and pinned places", () => {
  const request = briefRequestFor({ ...profile, propertyType: "house" }, ["uk:lsoa:E01000001"]);
  assert.deepEqual(request.budget, [800_000, 900_000]);
  assert.equal(request.propertyType, "house");
  assert.deepEqual(request.destinations, [{ label: "PureGym Angel", latitude: 51.53, longitude: -0.1 }]);
  assert.ok(criteriaFor(profile).includes("commute"));
});

test("gains and compromises run in the one topic order, the status a tag", () => {
  const tradeoffs = tradeoffsFor(selected, profile, { estimatedPrice: 939_000, budgetFit: "stretch" });
  // Price, Getting around (a pinned place), Safety, Local places (a kind of place).
  assert.deepEqual(tradeoffs.map((t) => [t.id, t.kind]), [
    ["budget", "compromise"], ["place:gym", "gain"], ["crime", "gain"], ["place:cafe", "compromise"]]);
  const [budget, gymTrip, , cafeTrip] = tradeoffs;
  assert.equal(cafeTrip.detail, "8 min on foot, 3 over your 5");
  assert.equal(budget.detail, "Ballpark £939k, 4% over your £900k");
  assert.deepEqual([cafeTrip.miss, cafeTrip.minutes, cafeTrip.limit, budget.miss], [true, 8, 5, false]);
  assert.equal(gymTrip.detail, "9 min on foot (you wanted ≤ 15)");
  assert.ok(cafeTrip.canKeepStrict && budget.canKeepStrict);
  const within = tradeoffsFor(selected, profile, { estimatedPrice: 780_000, budgetFit: "within" });
  assert.deepEqual([within[0].id, within.find((t) => t.id === "budget")!.kind], ["budget", "gain"]);
});

test("a rent search reads the borough rent as a monthly figure", () => {
  const renting: PreferenceProfile = { ...profile, market: "rent", targetBudget: 2_000, maximumBudget: 2_500 };
  const budget = tradeoffsFor(selected, renting, { estimatedPrice: 2_621, budgetFit: "stretch" }).find((t) => t.id === "budget")!;
  assert.equal(budget.label, "Rent");
  assert.equal(budget.detail, "Ballpark £2,621 a month, 5% over your £2,500 a month");
});

test("keep strict turns a compromise into a hard limit", () => {
  assert.equal(keepStrict(profile, "place:cafe").places!.find((p) => p.id === "cafe")!.must, true);
  const budget = keepStrict(profile, "budget").factors.find((f) => f.factorId === "affordability")!;
  assert.equal(budget.minimumUtility, 1);
  const crime = keepStrict({ ...profile, factors: [{ factorId: "crime", weight: 4, direction: "lower", minimumUtility: null, maximumUtility: null }] }, "crime");
  assert.equal(crime.factors[0].minimumUtility, 50);
});

test("the alternative meets the compromised criterion and names what it costs", () => {
  const alternative = alternativeFor(pack, selected, profile, "place:cafe")!;
  assert.equal(alternative.geographyId, "uk:lsoa:E01000002");
  assert.equal(alternative.cost, "Crime fit 55 (was 85)");
  assert.equal(alternativeFor(pack, selected, profile, "budget",
    new Map([["uk:lsoa:E01000002", { estimatedPrice: 860_000, budgetFit: "within" }]]))!.name, "002");
  assert.equal(alternativeFor(pack, selected, profile, "budget"), null);
});

test("marks: liking and ruling out are exclusive; notes trim and clear", () => {
  const liked = toggleMark(profile, "uk:lsoa:E01000001", "liked");
  assert.deepEqual(liked.marks!.liked, ["uk:lsoa:E01000001"]);
  const ruledOut = toggleMark(liked, "uk:lsoa:E01000001", "excluded");
  assert.deepEqual([ruledOut.marks!.liked, ruledOut.marks!.excluded], [[], ["uk:lsoa:E01000001"]]);
  assert.deepEqual(toggleMark(ruledOut, "uk:lsoa:E01000001", "excluded").marks!.excluded, []);
  const noted = setNote(profile, "uk:lsoa:E01000001", "  viewing Saturday  ");
  assert.equal(noted.marks!.notes["uk:lsoa:E01000001"], "viewing Saturday");
  assert.deepEqual(setNote(noted, "uk:lsoa:E01000001", " ").marks!.notes, {});
});

test("places: unique ids from labels, at most eight, edits and removal", async () => {
  const { addPlace, newPlaceId, removePlace, updatePlace } = await import("../src/lib/match-brief");
  assert.equal(newPlaceId("PureGym Angel!", []), "puregym-angel");
  assert.equal(newPlaceId("Gym", [{ ...gym, id: "gym" }]), "gym-2");
  const added = addPlace(profile, { label: "Mum's", target: { kind: "point", latitude: 51.5, longitude: -0.2 }, mode: "transit", targetMinutes: 40, weight: 2, must: false });
  assert.equal(added.places!.at(-1)!.id, "mum-s");
  assert.equal(updatePlace(added, "mum-s", { must: true }).places!.at(-1)!.must, true);
  assert.equal(removePlace({ ...profile, places: [gym] }, "gym").places, undefined);
  let full: PreferenceProfile = { ...profile, places: [] };
  for (let i = 0; i < 9; i += 1) full = addPlace(full, { ...cafe, label: `Cafe ${i}` });
  assert.equal(full.places!.length, 8);
});

test("an old brief link becomes a My match profile", async () => {
  const { briefToProfile } = await import("../src/lib/match-brief");
  const converted = briefToProfile({ areas: ["uk:lsoa:E01000001"], budget: [800_000, 900_000], market: "buy", bedrooms: 3,
    propertyType: "house", criteria: ["price", "safety", "station"],
    destinations: [{ label: "King's Cross St Pancras", latitude: 51.53, longitude: -0.12 }] }, structuredClone(DEFAULT_PROFILE));
  assert.deepEqual([converted.targetBudget, converted.maximumBudget, converted.bedrooms, converted.propertyType], [800_000, 900_000, 3, "house"]);
  // The price always counts, so the landing groups by budget like the match panel.
  assert.deepEqual(converted.factors.map((f) => [f.factorId, f.weight]), [["affordability", 3], ["crime", 4], ["station-access", 3]]);
  assert.deepEqual(converted.places!.map((p) => [p.id, p.mode, p.targetMinutes]), [["king-s-cross-st-pa", "transit", 30]]);
});

test("misses are far-off compromises, listed first, and named in the verdict", () => {
  const tradeoffs = [
    { id: "crime", label: "Crime", kind: "compromise" as const, canKeepStrict: true, detail: "", utility: 40 },
    { id: "place:ms", label: "M&S", kind: "compromise" as const, canKeepStrict: true, detail: "", miss: true, minutes: 24, limit: 10 },
    { id: "place:office", label: "Office", kind: "gain" as const, canKeepStrict: false, detail: "", minutes: 20, limit: 40 },
  ];
  assert.deepEqual(tradeoffs.map(statusOf), ["compromise", "miss", "fits"]);
  const verdict = verdictFor(tradeoffs);
  assert.equal(verdict.tone, "good");
  assert.equal(verdict.summary, "Office fits. Doesn't fit: M&S. Compromise on Crime.");
  assert.equal(verdictFor([tradeoffs[2]]).label, "Strong match");
  assert.equal(verdictFor([tradeoffs[1], { ...tradeoffs[0], miss: true }]).tone, "weak");
  // v4.2: out (a failed Must) is filtered, not scored low: its own neutral tone, never the red "weak".
  assert.deepEqual((({ label, tone }) => ({ label, tone }))(verdictFor(tradeoffs, null, true)), { label: "Out", tone: "out" });
});

test("fine without it drops the hard limit and the weight", () => {
  const strict = keepStrict({ ...profile, places: [{ ...gym, must: false }] }, "place:gym");
  const relaxed = relaxCriterion(strict, "place:gym");
  assert.deepEqual([relaxed.places![0].must, relaxed.places![0].weight], [false, 1]);
  // A range keeps its edges and counts least (it was a no-op before: the id is not a factor).
  const ranged: PreferenceProfile = { ...profile, ranges: [{ layer: "crime", min: null, max: 60, softMin: null, softMax: 80, importance: 4 }] };
  assert.deepEqual(relaxCriterion(ranged, "range:crime").ranges, [{ layer: "crime", min: null, max: 60, softMin: null, softMax: 80, importance: 1 }]);
});

test("the results group by budget and the header counts what is within it", () => {
  const buyer: PreferenceProfile = { ...profile, targetBudget: 480_000, maximumBudget: 600_000 };
  const priced = (id: string, rank: number, price: number) => result(id, rank, [component("affordability", price, 0, 3)]);
  const ranked = [priced("uk:lsoa:E01000001", 1, 590_000), result("uk:lsoa:E01000002", 2, []), priced("uk:lsoa:E01000003", 3, 686_000)];

  assert.deepEqual(budgetGroups(ranked, buyer).map((group) => [group.title, group.results.map((entry) => entry.rank)]),
    [["Within budget", [1]], ["Price not known", [2]], ["Stretch", [3]]]);
  assert.equal(budgetHeader(ranked, buyer), "3 areas · 1 within budget");
  assert.equal(budgetHeader([ranked[1]], buyer), "1 area meets your must-haves");
  assert.equal(overBudgetLabel(ranked[2], buyer), "Over budget · ~£86k (14%)");
  assert.equal(overBudgetLabel(ranked[0], buyer), null);
  assert.equal(overBudgetLabel(priced("uk:lsoa:E01000004", 4, 600_000), buyer), null);
  assert.equal(overBudgetLabel(priced("uk:lsoa:E01000004", 4, 2_300), { ...buyer, market: "rent", maximumBudget: 2_000 }), "Over budget · ~£300 a month (15%)");
});

test("Relax budget 10% raises the maximum and the comfortable target on the wizard's steps", () => {
  assert.deepEqual(
    (({ targetBudget, maximumBudget }) => ({ targetBudget, maximumBudget }))(relaxBudget({ ...profile, targetBudget: 480_000, maximumBudget: 600_000 })),
    { targetBudget: 528_000, maximumBudget: 660_000 });
  const renter = relaxBudget({ ...profile, market: "rent", targetBudget: 1_600, maximumBudget: 19_500 });
  assert.equal(renter.maximumBudget, 20_000);
  assert.equal(renter.targetBudget, 1_760);
});
