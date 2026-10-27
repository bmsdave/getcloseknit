import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { PreferenceProfileV2 } from "../src/lib/contracts";
import { scorePack, specs } from "../src/lib/match-model";
import { profileLinkEvent, profileLinkToast, readProfileLink } from "../src/lib/profile-link";
import { decodeSharedProfile, encodeShareLink, encodeSharedProfile } from "../src/lib/profile-state";
import { encodeProfileLinkV3, fragmentValue, toPanelProfile, unpackV2Lenient, V3_PREFIX } from "../src/lib/profile-v2";
import { weightedProfile } from "./weighted-profile";

const fixture = JSON.parse(readFileSync(new URL("../../contracts/fixtures/agent-share-links.json", import.meta.url), "utf8")) as {
  v2Cases: { name: string; profile: PreferenceProfileV2; fragment: string }[];
};

function base64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

for (const item of fixture.v2Cases) {
  test(`v3 link ${item.name} matches the API byte for byte and reads back`, () => {
    assert.equal(encodeProfileLinkV3(item.profile), item.fragment);
    assert.deepEqual(unpackV2Lenient(fragmentValue(item.fragment, V3_PREFIX)), { profile: item.profile, skipped: 0 });
    const read = readProfileLink(item.fragment);
    assert.equal(read.status, "ok");
    assert.equal(read.version, "v3");
    assert.deepEqual(read.profileV2, item.profile);
  });
}

test("the site's own links read in full", () => {
  const profile = weightedProfile();
  for (const fragment of [encodeSharedProfile(profile), encodeShareLink(profile)]) {
    const read = readProfileLink(fragment);
    assert.equal(read.status, "ok", fragment.slice(0, 13));
    assert.deepEqual(read.profile, decodeSharedProfile(fragment));
    assert.equal(read.profileV2?.schemaVersion, "preference-profile.v2");
    assert.equal(profileLinkToast(read), null);
    assert.equal(profileLinkEvent(read), null);
  }
  assert.equal(readProfileLink("").status, "none");
  assert.equal(readProfileLink("#layer=crime").status, "none");
});

test("a link with an unreadable criterion opens the rest and says how much was skipped", () => {
  const packed = JSON.parse(Buffer.from(encodeSharedProfile(weightedProfile()).slice("#profile=v1.".length), "base64url").toString("utf8")) as unknown[];
  (packed[5] as unknown[]).push([99, 3, 0, null, null], "nonsense");  // two broken factors
  packed[10] = { p: [["gym", "Gym", 1, "gym", null, 0, 10, 3, 0], ["bad"]] };  // one good place, one broken
  const read = readProfileLink(`#profile=v1.${base64(packed)}`);
  assert.equal(read.status, "partial");
  assert.equal(read.skipped, 3);
  assert.deepEqual(read.profile?.places?.map((place) => place.id), ["gym"]);
  assert.equal(read.profile?.maximumBudget, weightedProfile().maximumBudget);
  assert.deepEqual(profileLinkToast(read), { text: "Part of this link couldn't be opened · 3 criteria skipped", kind: "profile-link-partial" });
  assert.deepEqual(profileLinkEvent(read), { result: "parts-skipped", version: "v1", skipped: 3 });
});

test("a truncated or garbage link fails with a toast and nothing from the link in the event", () => {
  const full = encodeSharedProfile(weightedProfile());
  const truncated = readProfileLink(full.slice(0, full.length - 25));
  assert.equal(truncated.status, "failed");
  assert.equal(truncated.profile, null);
  assert.deepEqual(profileLinkToast(truncated), { text: "This link couldn't be opened · Start fresh", kind: "profile-link-failed" });
  const garbage = readProfileLink("#profile=v1.@@@not-base64@@@");
  assert.equal(garbage.status, "failed");
  assert.equal(garbage.failure, "not-base64");
  const noBudget = readProfileLink(`#profile=v3.${base64({ m: 0, c: [["b", 0]] })}`);
  assert.deepEqual([noBudget.status, noBudget.failure, noBudget.skipped], ["failed", "no-budget", 1]);
  for (const read of [truncated, garbage, noBudget]) {
    assert.deepEqual(Object.keys(profileLinkEvent(read)!).sort(), ["result", "skipped", "version"]);
  }
});

test("a v3 link with a broken criterion keeps the others", () => {
  const read = readProfileLink(`#profile=v3.${base64({ m: 0, t: 500000, x: 600000, c: [["b", 0], ["r", "census-religion-muslim", 0, null, 5, null, null, 0], ["zz"], ["r", "crime", 1, null, 50, null, 75, 1]] })}`);
  assert.equal(read.status, "partial");
  assert.equal(read.skipped, 2);
  assert.deepEqual(read.profileV2?.criteria.map((item) => item.kind), ["budget", "range"]);
});

test("a v2 search opens as the saved profile with its order, Musts and soft edges (v4 Task 21c/21d)", () => {
  const v2: PreferenceProfileV2 = {
    schemaVersion: "preference-profile.v2", market: "buy", targetBudget: 500_000, maximumBudget: 650_000, bedrooms: 3,
    criteria: [
      { kind: "range", layer: "crime", scale: "percentile", min: null, max: 50, softMin: null, softMax: 75 },
      { kind: "budget", must: true },
      { kind: "range", layer: "air-no2", scale: "value", min: null, max: 30, softMin: null, softMax: 40 },
      { kind: "place", id: "gym", label: "Gym", target: { kind: "category", category: "gym" }, mode: "walk", targetMinutes: 10, softMinutes: 20 },
      { kind: "range", layer: "nature-score", scale: "percentile", min: 50, max: null, softMin: 25, softMax: null },
    ],
  };
  const { profile, skipped } = toPanelProfile(v2);
  assert.equal(skipped, 0);
  assert.deepEqual(profile.factors.filter((factor) => factor.weight > 0).map((factor) => [factor.factorId, factor.minimumUtility]), [["affordability", 1]]);
  assert.deepEqual(profile.ranges?.map((range) => [range.layer, range.scale]), [["crime", "percentile"], ["air-no2", "value"], ["nature-score", "percentile"]]);
  assert.equal(profile.places?.[0].softMinutes, 20);
  // Through the model the order comes back: the budget (a Must) on top, then crime, air, gym, nature as ranked.
  assert.deepEqual(specs(profile).map((spec) => [spec.id, spec.must]),
    [["affordability", true], ["range:crime", false], ["range:air-no2", false], ["place:gym", false], ["range:nature-score", false]]);
  assert.equal(scorePack(profile, []).values.length, 0);
});
