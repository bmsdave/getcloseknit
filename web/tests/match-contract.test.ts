import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { MatchResult, PreferenceProfile, PreferenceProfileV2 } from "../src/lib/contracts";
import { scoreMatchPack, type RawMatchArea } from "../src/lib/matching";

interface FixtureEvidence {
  rawValue: number;
  utility: number;
  unit: string;
  carrierGeographyId: RawMatchArea["geographyId"];
  quality: "observed" | "fallback" | "suppressed";
  sourceVersion: string;
}

interface FixtureArea {
  geographyId: RawMatchArea["geographyId"];
  name: string;
  price: number;
  monthlyRent: number;
  journeys: Record<string, number>;
  evidence: Record<string, FixtureEvidence>;
}

function toRawFactors(evidence: Record<string, FixtureEvidence>): RawMatchArea["factors"] {
  // Shared fixtures store static evidence under the neutral `utility` name: the London percentile.
  return Object.fromEntries(
    Object.entries(evidence).filter(([factorId]) => !factorId.startsWith("range:")).map(([factorId, item]) => [factorId, {
      rawValue: item.rawValue,
      percentile: item.utility,
      carrierGeographyId: item.carrierGeographyId,
      quality: item.quality,
      sourceVersion: item.sourceVersion,
    }]),
  ) as RawMatchArea["factors"];
}

/** Evidence keyed `range:<layer>`: a map layer's value and its London percentile. */
function toRawRanges(evidence: Record<string, FixtureEvidence>): RawMatchArea["ranges"] {
  return Object.fromEntries(Object.entries(evidence).filter(([factorId]) => factorId.startsWith("range:")).map(([factorId, item]) => [factorId, {
    rawValue: item.rawValue, percentile: item.utility, unit: item.unit, carrierGeographyId: item.carrierGeographyId,
    quality: item.quality, sourceVersion: item.sourceVersion,
  }]));
}

interface FixtureCase {
  id: string;
  areas: FixtureArea[];
  profiles: Record<string, PreferenceProfile | PreferenceProfileV2>;
  expected: Record<string, {
    geographyId: string;
    score: number | null;
    rank: number | null;
    excluded: boolean;
    unmetLimits: string[];
    evidenceCompleteness: number;
    utilities: Record<string, number>;
    percentile: number | null;
    reasons: string[];
    weakest: string[];
  }[]>;
}

const fixture = JSON.parse(
  readFileSync(new URL("../../api/tests/match_contract_fixtures.json", import.meta.url), "utf-8"),
) as { cases: FixtureCase[] };

test("shared fixtures score identically to the Python production matcher", () => {
  assert.ok(fixture.cases.length > 0);
  for (const kase of fixture.cases) {
    checkCase(kase);
  }
});

function checkCase(kase: FixtureCase): void {
  const areas: RawMatchArea[] = kase.areas.map((area) => ({
    geographyId: area.geographyId,
    name: area.name,
    price: area.price,
    monthlyRent: area.monthlyRent,
    journeys: area.journeys,
    factors: toRawFactors(area.evidence),
    ranges: toRawRanges(area.evidence),
  }));
  for (const [name, profile] of Object.entries(kase.profiles)) {
    checkProfile(kase.id, name, profile, areas, kase.expected[name]);
  }
}

function checkProfile(caseId: string, name: string, profile: PreferenceProfile | PreferenceProfileV2, areas: RawMatchArea[], expected: FixtureCase["expected"][string]): void {
  const pack = scoreMatchPack(profile, areas);
  assert.equal(pack.values.length, expected.length, `${caseId}/${name}: area count`);
  pack.values.forEach((result, index) => checkResult(caseId, name, result, expected[index]));
}

function checkResult(caseId: string, name: string, result: MatchResult, want: FixtureCase["expected"][string][number]): void {
  assert.equal(result.geographyId, want.geographyId, `${caseId}/${name}: order`);
  assert.equal(result.score, want.score, `${caseId}/${name}: score`);
  assert.equal(result.rank, want.rank, `${caseId}/${name}: rank`);
  assert.equal(result.excluded, want.excluded, `${caseId}/${name}: excluded`);
  assert.deepEqual(result.unmetLimits, want.unmetLimits, `${caseId}/${name}: limits`);
  assert.equal(result.evidenceCompleteness, want.evidenceCompleteness, `${caseId}/${name}: completeness`);
  assert.equal(result.percentile, want.percentile, `${caseId}/${name}: percentile`);
  assert.deepEqual(result.reasons, want.reasons, `${caseId}/${name}: reasons`);
  assert.deepEqual(result.weakest, want.weakest, `${caseId}/${name}: weakest`);
  const utilities = Object.fromEntries(
    result.components.map((component) => [component.factorId, component.utility]),
  );
  assert.deepEqual(Object.keys(utilities).sort(), Object.keys(want.utilities).sort(), `${caseId}/${name}: factors`);
  for (const [factorId, utility] of Object.entries(want.utilities)) {
    assert.ok(Math.abs(utilities[factorId] - utility) < 1e-9, `${caseId}/${name}/${factorId}: utility`);
  }
}
