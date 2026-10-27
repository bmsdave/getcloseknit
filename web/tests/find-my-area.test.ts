import assert from "node:assert/strict";
import test from "node:test";

import type { GeographyId, MatchComponent, MatchPack, MatchResult } from "../src/lib/contracts";
import { DEFAULT_PROFILE, FACTORS, RETIRED_FACTOR_IDS } from "../src/lib/fixtures";
import { friendlyName, groupRanks, plainFactorLabel, STRONG_MATCH_TOP, type Tradeoff, verdictFor } from "../src/lib/match-brief";
import { rankPack } from "../src/lib/matching";
import { scoreOf } from "../src/lib/match-model";
import { isUnsetProfile, withoutRetiredFactors } from "../src/lib/profile-state";
import { weightedProfile } from "./weighted-profile";

function component(factorId: string, utility: number, rawValue = 0): MatchComponent {
  return { factorId, rawValue, unit: "", utility, weight: 3, contribution: 0, carrierGeographyId: "uk:lsoa:E01000001",
    quality: "observed", sourceVersion: "test" } as MatchComponent;
}

function result(id: string, components: MatchComponent[], extra: Partial<MatchResult> = {}): MatchResult {
  return { geographyId: `uk:lsoa:${id}` as GeographyId, name: "Bexley 022A", score: 100, rank: null, evidenceCompleteness: 100,
    excluded: false, unmetLimits: [], sourceReleaseSet: "test", components, ...extra };
}

function pack(values: MatchResult[]): MatchPack {
  return { schemaVersion: "match-pack.v1", profileVersion: "preference-profile.v1", sourceReleaseSet: "test", values };
}

test("areas that tie on the score rank by the criteria in order (v4 Task 21d)", () => {
  const profile = weightedProfile();
  profile.factors = profile.factors.filter((factor) => ["affordability", "crime"].includes(factor.factorId));
  // Both fit everything: score 100. The budget is first in the order (weights tie, the factor order breaks it): cheaper first.
  const fits = (price: number, crime: number) => [{ ...component("affordability", 100, price), fit: 1 }, { ...component("crime", 100, crime), fit: 1, percentile: crime }];
  const cheap = result("E01000002", fits(400_000, 20), { rankScore: 100 });
  const dear = result("E01000001", fits(500_000, 10), { rankScore: 100 });
  const ranked = rankPack(pack([dear, cheap]), profile);
  assert.deepEqual(ranked.values.map((value) => [value.geographyId, value.rank, value.percentile]),
    [["uk:lsoa:E01000002", 1, 100], ["uk:lsoa:E01000001", 2, 0]]);
});

test("a criterion without evidence counts as half a fit, never as a free pass", () => {
  // Crime first (0.75) at fit 0.9, schools (0.25) missing: 0.9^0.75 · 0.5^0.25 = 0.777.
  const missing = scoreOf([{ fit: 0.9, utility: 90, weight: 0.75 }], 0.25);
  assert.equal(Math.round(missing * 100) / 100, 77.7);
  assert.ok(scoreOf([{ fit: 0.8, utility: 80, weight: 0.75 }, { fit: 0.8, utility: 80, weight: 0.25 }]) > missing);
});

test("results that share a friendly name take one position, numbered without gaps", () => {
  const a = result("E01000001", [], { title: "Lamorbey · DA15", rank: 1 });
  const b = result("E01000002", [], { title: "Lamorbey · DA15", rank: 2 });
  const c = result("E01000003", [], { title: "Sidcup · DA14", rank: 3 });
  const out = rankPack(pack([a, b, c]), DEFAULT_PROFILE);
  assert.deepEqual(groupRanks(out).values.map((value) => value.rank), [1, 1, 2]);
});

test("friendly names never show the official code", () => {
  assert.equal(friendlyName({ title: "Lamorbey · DA15", name: "Bexley 022A" }), "Lamorbey · DA15");
  assert.equal(friendlyName({ title: null, name: "Bexley 022A" }), "Bexley");
  assert.equal(plainFactorLabel("crime"), "Safer streets");
});

test("only the top tier reads Strong match", () => {
  const fits: Tradeoff[] = [{ id: "crime", label: "Safer streets", kind: "gain", detail: "", canKeepStrict: false }];
  assert.equal(verdictFor(fits, 1).label, "Strong match");
  assert.equal(verdictFor(fits, STRONG_MATCH_TOP + 1).label, "Good match");
  assert.equal(verdictFor(fits, 1212).tone, "good");
});

test("saved and shared profiles drop income and social renting but keep deprivation; the untouched default is unset", () => {
  const old = weightedProfile();
  old.factors = [...old.factors, { factorId: "income", weight: 3, direction: "higher", minimumUtility: null, maximumUtility: null },
    { factorId: "social-renting", weight: 1, direction: "lower", minimumUtility: null, maximumUtility: null },
    { factorId: "deprivation", weight: 2, direction: "higher", minimumUtility: 50, maximumUtility: null }];
  const cleaned = withoutRetiredFactors(old);
  assert.ok(!cleaned.factors.some((factor) => ["income", "social-renting"].includes(factor.factorId)));
  assert.deepEqual(cleaned.factors.find((factor) => factor.factorId === "deprivation"),
    { factorId: "deprivation", weight: 2, direction: "higher", minimumUtility: 50, maximumUtility: null });
  assert.deepEqual([...RETIRED_FACTOR_IDS], ["income", "social-renting"]);
  assert.equal(isUnsetProfile(DEFAULT_PROFILE), true);
  // A submitted search that happens to equal the defaults is still the household's own.
  assert.equal(isUnsetProfile(structuredClone(DEFAULT_PROFILE)), false);
});

// User decision 2026-10-11: the official deprivation decile is a match criterion again, said neutrally.
test("the wizard offers deprivation as the official decile, a higher decile preferred", () => {
  const deprivation = FACTORS.find((factor) => factor.id === "deprivation");
  assert.equal(deprivation?.defaultDirection, "higher");
  assert.equal(deprivation?.unit, "decile, 1 = most deprived");
  assert.equal(plainFactorLabel("deprivation"), "Less deprivation");
  // Like the quick criteria, it is absent from new profiles until weighted.
  assert.ok(!DEFAULT_PROFILE.factors.some((factor) => factor.factorId === "deprivation"));
});
