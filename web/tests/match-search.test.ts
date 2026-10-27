import assert from "node:assert/strict";
import test from "node:test";

import { assertPreferenceProfile, type GeographyId, type MatchCriterion, type MatchPack, type MatchResult, type PreferenceProfile } from "../src/lib/contracts";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { contractProfile } from "../src/lib/match-model";
import { chipCriterionId, liveChips, MATCH_CHIPS, suggestedChips } from "../src/lib/match-ranges";
import {
  addCriterion, areasLeft, bottomTen, budgetFromMaximum, cutCounts, cutsMost, freshSearch, hasBudget, moveCriterion, moves,
  normaliseSearch, removeCriterion, rescore, searchItems, setBudget, setMust, softened, softenStep, topTen, withCriteria,
} from "../src/lib/match-search";
import { itemChip, itemLine } from "../src/lib/match-words";
import { buildMatchPack } from "../src/lib/matching";

const chip = (id: string) => MATCH_CHIPS.find((entry) => entry.id === id)!.criterion;
const kingsCross: MatchCriterion = {
  kind: "place", id: "kings-cross", label: "King's Cross", target: { kind: "point", latitude: 51.5306, longitude: -0.1239 },
  mode: "transit", targetMinutes: 35, must: false,
};

function start(): PreferenceProfile {
  return setBudget(freshSearch(structuredClone(DEFAULT_PROFILE)), { market: "buy", maximum: 650_000 });
}

test("a fresh search has no criteria; the budget joins as a Must on top (CUJ-01 v4 step 2)", () => {
  const fresh = freshSearch(structuredClone(DEFAULT_PROFILE));
  assert.equal(searchItems(fresh).length, 0);
  assert.equal(hasBudget(fresh), false);
  const budgeted = start();
  assert.deepEqual(budgetFromMaximum(650_000, "buy"), { targetBudget: 600_000, maximumBudget: 650_000 });
  assert.equal(budgeted.targetBudget, 600_000);
  assert.deepEqual(searchItems(budgeted).map((item) => [item.id, item.must]), [["affordability", true]]);
  assert.doesNotThrow(() => assertPreferenceProfile(structuredClone(budgeted)));
  // Clearing the field takes the budget out of the search; switching to rent too (other units).
  assert.equal(hasBudget(setBudget(budgeted, { maximum: null })), false);
  assert.equal(hasBudget(setBudget(budgeted, { market: "rent" })), false);
});

test("the Budget chip names both ends, so the typed maximum is never hidden; its card the stretch, Must or not (v4.4)", () => {
  const budgeted = start();
  const budget = searchItems(budgeted)[0].criterion;
  // £650k typed: "≤ £600k–£650k", never a bare "≤ £600k" Must (final prod check: the chip hid what was typed).
  assert.equal(itemChip(budget, budgeted), "Budget ≤ £600k–£650k");
  assert.equal(itemLine(budget, budgeted), "Typical price here ≤ £600k · stretch to £650k");
  const soft = { ...budget, must: false };
  assert.equal(itemChip(soft, budgeted), "Budget ≤ £600k–£650k");
  assert.equal(itemChip(budget, { ...budgeted, maximumBudget: 600_000 }), "Budget ≤ £600k");
  const rent = setBudget(freshSearch(structuredClone(DEFAULT_PROFILE)), { market: "rent", maximum: 2_500 });
  assert.equal(itemChip(searchItems(rent)[0].criterion, rent), "Budget ≤ £2,300–£2,500 a month");
  assert.equal(itemLine(soft, budgeted), "Typical price here ≤ £600k · stretch to £650k");
  // No stretch left: the line stops at the one figure.
  assert.equal(itemLine(budget, { ...budgeted, maximumBudget: 600_000 }), "Typical price here ≤ £600k");
});

test("a client re-score keeps the API's valueAreas (Best value shown or hidden) until the next pack", () => {
  const profile = addCriterion(start(), chip("safer-streets"));
  const pack = buildMatchPack(contractProfile(profile));
  assert.equal(rescore(pack, profile).valueAreas, undefined);
  assert.equal(rescore({ ...pack, valueAreas: 0 }, profile).valueAreas, 0);
  assert.equal(rescore({ ...pack, valueAreas: 12 }, profile).valueAreas, 12);
});

test("chips join at the end; order sets #n and the rank-order weights; Musts sit on top with no weight", () => {
  let profile = start();
  profile = addCriterion(profile, kingsCross);
  profile = addCriterion(profile, chip("safer-streets"));
  profile = addCriterion(profile, chip("good-schools"));
  const items = searchItems(profile);
  assert.deepEqual(items.map((item) => [item.id, item.rank]), [
    ["affordability", null], ["place:kings-cross", 1], ["range:crime", 2], ["range:schools", 3]]);
  assert.deepEqual(items.map((item) => Math.round(item.weight * 1000)), [0, 611, 278, 111]);
  // The same id twice is one criterion.
  assert.equal(searchItems(addCriterion(profile, chip("safer-streets"))).length, 4);
  // Drag Good schools to #1.
  const moved = moveCriterion(profile, "range:schools", 0);
  assert.deepEqual(searchItems(moved).map((item) => item.id), ["affordability", "range:schools", "place:kings-cross", "range:crime"]);
  // Must on: into the Must block (after the budget); Must off: the end of the ranked list.
  const must = setMust(moved, "range:crime", true);
  assert.deepEqual(searchItems(must).map((item) => [item.id, item.must]), [
    ["affordability", true], ["range:crime", true], ["range:schools", false], ["place:kings-cross", false]]);
  const back = setMust(must, "range:crime", false);
  assert.deepEqual(searchItems(back).map((item) => item.id).slice(-1), ["range:crime"]);
  assert.deepEqual(searchItems(removeCriterion(back, "range:schools")).map((item) => item.id), ["affordability", "place:kings-cross", "range:crime"]);
});

test("the list round-trips through the saved v1 profile and the v2 request", () => {
  let profile = start();
  for (const item of [kingsCross, chip("quiet-streets"), chip("parks-nearby"), chip("clean-air")]) profile = addCriterion(profile, item);
  profile = setMust(profile, "place:park", true);
  const stored = assertPreferenceProfile(JSON.parse(JSON.stringify(profile)) as PreferenceProfile);
  assert.deepEqual(searchItems(stored).map((item) => item.criterion), searchItems(profile).map((item) => item.criterion));
  const v2 = contractProfile(stored);
  assert.deepEqual(v2.criteria.map((item) => item.kind), ["budget", "place", "place", "range", "range"]);
  assert.equal(JSON.stringify(v2).includes("suggest"), false);
  // Writing the same list again changes nothing.
  assert.deepEqual(withCriteria(stored, searchItems(stored).map((item) => item.criterion)), stored);
});

test("an old wizard search becomes the list (factors → ranges on their layer), keeping its order", () => {
  const old: PreferenceProfile = {
    ...structuredClone(DEFAULT_PROFILE),
    factors: [
      { factorId: "affordability", weight: 3, direction: "target-range", minimumUtility: null, maximumUtility: null },
      { factorId: "crime", weight: 5, direction: "lower", minimumUtility: null, maximumUtility: null },
      { factorId: "schools", weight: 4, direction: "higher", minimumUtility: null, maximumUtility: null },
    ],
  };
  const normal = normaliseSearch(old);
  assert.deepEqual(searchItems(normal).map((item) => item.id), ["range:crime", "range:schools", "affordability"]);
  assert.equal(normal.factors.find((factor) => factor.factorId === "crime")?.weight, 0);
  assert.equal(normal.ranges?.[0].scale, "percentile");
});

test("−N, areas left and the client re-score agree with the demo match", () => {
  let profile = start();
  profile = addCriterion(profile, chip("safer-streets"));
  profile = addCriterion(profile, chip("good-schools"));
  const pack = buildMatchPack(contractProfile(profile));
  const { left, total } = areasLeft(pack);
  assert.equal(total, pack.values.length);
  assert.ok(left > 0 && left <= total);
  const counts = cutCounts(pack);
  const overBudget = pack.values.filter((result) => result.unmetLimits.some((code) => code.startsWith("affordability:"))).length;
  assert.equal(counts.get("affordability") ?? 0, overBudget);
  // Re-scoring the same search from the pack's own components gives the same ranks.
  const again = rescore(pack, profile);
  assert.deepEqual(topTen(again).map((result) => result.geographyId), topTen(pack).map((result) => result.geographyId));
  // Reordering re-sorts at once (and matches what the API-side model scores for the new order).
  const swapped = moveCriterion(profile, "range:schools", 0);
  const live = rescore(pack, swapped);
  const fresh = buildMatchPack(contractProfile(swapped));
  assert.deepEqual(topTen(live).map((result) => result.geographyId), topTen(fresh).map((result) => result.geographyId));
  assert.ok(bottomTen(fresh).length > 0);
});

test("Soften widens the soft edge a fifth of the span, never the range; a Must first turns Must off", () => {
  const range = chip("safer-streets") as Extract<MatchCriterion, { kind: "range" }>;
  const step = softenStep(DEFAULT_PROFILE, range, null)!;
  assert.deepEqual(step.criterion, { ...range, softMax: 95 });
  assert.equal(softenStep(DEFAULT_PROFILE, { ...range, softMax: 100 }, null), null);
  const place = softenStep(DEFAULT_PROFILE, kingsCross, null)!.criterion as Extract<MatchCriterion, { kind: "place" }>;
  // 35 min · soft to 53 (×1.5) → +12 (a fifth of 0–70 min) → 65, in 5-minute steps; "≤ 35" stays.
  assert.equal(place.targetMinutes, 35);
  assert.equal(place.softMinutes, 65);
  let profile = start();
  profile = addCriterion(profile, chip("safer-streets"));
  profile = setMust(profile, "range:crime", true);
  const off = softened(profile, "range:crime", null)!;
  assert.equal(searchItems(off).find((item) => item.id === "range:crime")?.must, false);
  const budget = softened(profile, "affordability", null)!;
  assert.equal(searchItems(budget).find((item) => item.id === "affordability")?.must, false);
});

test("cuts most names a criterion while under 300 or half of London is left, with what one step brings back (v4.4)", () => {
  let profile = start();
  profile = addCriterion(profile, { ...chip("safer-streets"), must: true } as MatchCriterion);
  const pack = buildMatchPack(contractProfile(profile));
  const hint = cutsMost(pack, profile, new Map());
  const { left, total } = areasLeft(pack);
  if (left < Math.max(300, total / 2) && [...cutCounts(pack).values()].some((count) => count > 0)) {
    assert.ok(hint);
    // Never "Soften +0 areas": the hint names a step that brings areas back.
    assert.ok(hint.gain > 0);
  }
});

test("the Soften hint shows with 1,500 of 4,994 areas left, as on prod with King's Cross −2,341, and hides at half (v4.4)", () => {
  // A synthetic pack: King's Cross (a Must, 35 min) puts out every area over 35 minutes.
  let profile = start();
  profile = addCriterion(profile, { ...kingsCross, must: true });
  const id = "place:kings-cross";
  const make = (inside: number, total: number): MatchPack => ({
    ...buildMatchPack(contractProfile(profile)),
    values: Array.from({ length: total }, (_, index) => {
      const minutes = index < inside ? 20 : 40;
      const out = minutes > 35;
      return {
        geographyId: `uk:lsoa:E${String(1_000_000 + index).padStart(8, "0")}` as GeographyId, name: `Area ${index}`,
        score: out ? null : 80, rankScore: out ? null : 80, rank: out ? null : index + 1, excluded: out,
        unmetLimits: out ? [`${id}:max`] : [], percentile: null,
        components: [{
          factorId: id, rawValue: minutes, unit: "minutes", fit: out ? 0 : 1, must: true, quality: "observed",
          sourceVersion: "test", carrierGeographyId: null,
        }],
      } as unknown as MatchResult;
    }),
  });
  const busy = make(1_500, 4_994);
  assert.equal(areasLeft(busy).left, 1_500);
  const hint = cutsMost(busy, profile, new Map());
  assert.ok(hint, "a hint at 1,500 of 4,994 left");
  assert.equal(hint.id, id);
  assert.equal(hint.cut, 3_494);
  // The first tap turns King's Cross's Must off (its soft edge to 53 min): the 40-minute areas come back.
  assert.ok(hint.gain > 0);
  assert.equal(cutsMost(make(2_497, 4_994), profile, new Map()), null, "hidden once half are left");
});

test("moves report ▲▼ for the new top ten", () => {
  const ids = ["uk:lsoa:E01000001", "uk:lsoa:E01000002", "uk:lsoa:E01000003"] as const;
  assert.deepEqual([...moves([ids[0], ids[1], ids[2]], [ids[1], ids[0], ids[2]])], [[ids[1], 1], [ids[0], -1]]);
});

test("suggestions: the 21c start chips, then the order for Kids? / Drive?; taken and flagged chips left out", () => {
  const start6 = suggestedChips({}, new Set()).slice(0, 6).map((entry) => entry.id);
  assert.deepEqual(start6, ["safer-streets", "good-schools", "quiet-streets", "parks-nearby", "less-disorder", "clean-air"]);
  const kids = suggestedChips({ kids: true, drive: false }, new Set(["range:schools"])).map((entry) => entry.id);
  assert.equal(kids[0], "top-primary");
  assert.ok(!kids.includes("fewer-collisions"), "flagged off until its data is live");
  assert.ok(liveChips().every((entry) => !entry.flag));
  assert.equal(chipCriterionId(MATCH_CHIPS[0]), "range:crime");
});
