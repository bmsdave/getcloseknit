import assert from "node:assert/strict";
import test from "node:test";

import { assertPlaces, type MatchComponent, type MatchResult, type PlacePreference } from "../src/lib/contracts";
import { formatFactorLabel } from "../src/lib/evidence-format";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { PLACE_PRESETS, tradeoffsFor } from "../src/lib/match-brief";
import { buildMatchPack } from "../src/lib/matching";
import { decodeSharedProfile, encodeSharedProfile } from "../src/lib/profile-state";
import { QUICK_FACTOR_IDS, quickFactorNote } from "../src/lib/quick-criteria";

const component = (factorId: string, rawValue: number, utility: number, detail?: MatchComponent["detail"], quality: MatchComponent["quality"] = "observed"): MatchComponent => ({
  factorId: factorId as MatchComponent["factorId"], rawValue, unit: "u", utility, weight: 3, contribution: 0,
  carrierGeographyId: "uk:lsoa:E01000001", quality, sourceVersion: "s", ...(detail ? { detail } : {}),
});

test("quick factors read as words, not slugs", () => {
  assert.deepEqual(QUICK_FACTOR_IDS.map(formatFactorLabel), ["Noise", "Visible disorder", "Energy rating A–C", "Leasehold share"]);
  assert.equal(formatFactorLabel("station-access"), "Station Access");
});

test("each quick factor card shows the figures behind its fit", () => {
  assert.equal(quickFactorNote(component("noise", 38.8, 46, { road: 34.2, rail: 5, air: 0 })),
    "39% of homes at 55 dB or more: road 34%, rail 5%, aircraft 0%.");
  assert.match(quickFactorNote(component("disorder", 26.79, 50))!, /^26\.8 incidents per 1,000 residents a year: anti-social behaviour/);
  assert.match(quickFactorNote(component("disorder", 30, 50, undefined, "fallback"))!, /\(neighbourhood rate\)\.$/);
  assert.equal(quickFactorNote(component("epc-share", 59.7, 79, { homesRated: 1540, ratedAToC: 920 })),
    "60% of homes rated A–C (of 1,540 homes with a certificate).");
  assert.equal(quickFactorNote(component("crime", 50, 50)), null);
});

test("a mostly leasehold area says what to check", () => {
  const mostly = quickFactorNote(component("leasehold-share", 82, 90, { sales: 22 }))!;
  assert.match(mostly, /^82% of 22 sales in the last year were leasehold\. Mostly leasehold: check years left/);
  const fallback = quickFactorNote(component("leasehold-share", 20, 10, { sales: 40 }, "fallback"))!;
  assert.equal(fallback, "20% of 40 sales in the last year were leasehold in the wider neighbourhood.");
});

test("the selected area carries the quick figures on its criterion cards", () => {
  const result = { geographyId: "uk:lsoa:E01000001", name: "A", score: 70, rank: 1, evidenceCompleteness: 100, excluded: false,
    unmetLimits: [], components: [component("noise", 60, 20, { road: 58, rail: 4, air: 12 })] } as unknown as MatchResult;
  const [noise] = tradeoffsFor(result, { ...DEFAULT_PROFILE, factors: [{ factorId: "noise", weight: 3, direction: "lower", minimumUtility: null, maximumUtility: null }] }, null);
  assert.equal(noise.label, "Quiet streets");
  assert.equal(noise.kind, "compromise");
  assert.equal(noise.note, "60% of homes at 55 dB or more: road 58%, rail 4%, aircraft 12%.");
});

test("preview scoring ranks by a quick factor", () => {
  const profile = { ...DEFAULT_PROFILE, factors: [{ factorId: "noise" as const, weight: 5, direction: "lower" as const, minimumUtility: null, maximumUtility: null }] };
  const pack = buildMatchPack(profile);
  const best = pack.values.find((value) => value.rank === 1)!;
  assert.equal(best.geographyId, "uk:lsoa:E01000002"); // the quietest preview area
  assert.equal(best.components[0].unit, "% of homes ≥55 dB");
});

test("school rules may rank by Progress 8 (secondaries only) and links keep it", () => {
  const base = { id: "s", label: "School", mode: "walk", targetMinutes: 20, weight: 4, must: false } as const;
  const progress8: PlacePreference = { ...base, target: { kind: "school", phase: "secondary", top: 20, rankBy: "progress8" } };
  assertPlaces([progress8, { ...base, id: "t", target: { kind: "category", category: "step_free_station" } }]);
  assert.throws(() => assertPlaces([{ ...base, target: { kind: "school", phase: "primary", top: 20, rankBy: "progress8" } }]), /school ranking/);
  const profile = { ...DEFAULT_PROFILE, places: [progress8] };
  assert.deepEqual(decodeSharedProfile(encodeSharedProfile(profile))?.places, [progress8]);
  assert.ok(PLACE_PRESETS.some((preset) => preset.target.kind === "school" && preset.target.rankBy === "progress8"));
  assert.ok(PLACE_PRESETS.some((preset) => preset.target.kind === "category" && preset.target.category === "step_free_station"));
});

test("a null school ranking reads as results, as in Python", () => {
  const place = { id: "s", label: "School", mode: "walk", targetMinutes: 20, weight: 4, must: false,
    target: { kind: "school", phase: "secondary", top: 20, rankBy: null } };
  assertPlaces([place]);
});
