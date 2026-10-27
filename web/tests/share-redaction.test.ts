import assert from "node:assert/strict";
import test from "node:test";

import type { GeographyId, PreferenceProfile } from "../src/lib/contracts";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { buildMatchPack } from "../src/lib/matching";
import { decodeSharedProfile } from "../src/lib/profile-state";
import {
  buildShortlist, comparedBriefHref, decodeSharedShortlist, encodeSharedShortlist, importSharedShortlist, OWN_BRIEF,
  redactProfileForShare, shareReviewLines, UNSHARED_BUDGET,
} from "../src/lib/saved-shortlists";

// v4 Task 38: the link really leaves out the budget and the pinned coordinates unless the review ticks them.
const IDS: GeographyId[] = ["uk:lsoa:E01000001", "uk:lsoa:E01000002"];
const NAMES = { "uk:lsoa:E01000001": "Westminster preview", "uk:lsoa:E01000002": "North London preview" };

function privateProfile(): PreferenceProfile {
  const profile = structuredClone(DEFAULT_PROFILE);
  profile.maximumBudget = 654_321;
  profile.targetBudget = 543_210;
  profile.places = [
    { id: "work", label: "Canary Office", target: { kind: "point", latitude: 51.505432, longitude: -0.019876 }, mode: "transit", targetMinutes: 30, weight: 3, must: false },
    { id: "park", label: "Any park", target: { kind: "category", category: "park" }, mode: "walk", targetMinutes: 10, weight: 2, must: false },
  ] as PreferenceProfile["places"];
  profile.zones = [
    { kind: "polygon", points: [[51.4641, -0.1561], [51.4641, -0.1401], [51.4561, -0.1401]], label: "Round my flat" },
    { kind: "borough", id: "uk:lad:E09000022", label: "Lambeth" },
  ];
  profile.marks = { liked: [], excluded: [], notes: { "uk:lsoa:E01000001": "Secret canary note" } };
  return profile;
}

function shortlist(profile = privateProfile()) {
  return buildShortlist({ name: "Family move", candidates: IDS, candidateNames: NAMES, profile, mode: "demo",
    release: "preview-2026-09", evidence: buildMatchPack(structuredClone(DEFAULT_PROFILE)) });
}

function profileOf(fragment: string): PreferenceProfile {
  const decoded = decodeSharedShortlist(fragment);
  assert.ok(decoded.ok);
  return decoded.share.profile;
}

test("by default the link carries no budget, no pinned coordinates, no drawn area and no notes", () => {
  const fragment = encodeSharedShortlist(shortlist());
  const decoded = decodeSharedShortlist(fragment);
  assert.ok(decoded.ok);
  const text = JSON.stringify(decoded.share) + JSON.stringify(decodeSharedProfile(JSON.parse(Buffer.from(
    fragment.slice("#shortlist=v1.".length).replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf8")).profileFragment));
  for (const secret of ["654321", "543210", "51.505432", "-0.019876", "Canary Office", "Round my flat", "51.4641", "Secret canary note"]) {
    assert.ok(!text.includes(secret), `the redacted link leaks ${secret}`);
  }
  assert.equal(decoded.share.budgetShared, false);
  assert.equal(decoded.share.placesShared, false);
  assert.equal(decoded.share.profile.maximumBudget, UNSHARED_BUDGET);
  // What carries no coordinates stays: a "nearest park" rule and a borough.
  assert.deepEqual(decoded.share.profile.places?.map((place) => place.id), ["park"]);
  assert.deepEqual(decoded.share.profile.zones?.map((zone) => zone.kind), ["borough"]);
});

test("each part comes along only when the review ticks it", () => {
  const withBudget = profileOf(encodeSharedShortlist(shortlist(), { includeBudget: true }));
  assert.equal(withBudget.maximumBudget, 654_321);
  assert.equal(withBudget.places?.length, 1);
  const withPlaces = profileOf(encodeSharedShortlist(shortlist(), { includeDestinations: true }));
  assert.equal(withPlaces.maximumBudget, UNSHARED_BUDGET);
  assert.equal(withPlaces.places?.length, 2);
  assert.equal(withPlaces.zones?.length, 2);
  const everything = decodeSharedShortlist(encodeSharedShortlist(shortlist(), OWN_BRIEF));
  assert.ok(everything.ok);
  assert.equal(everything.share.redacted, false);
  assert.equal(everything.share.budgetShared, true);
  assert.equal(everything.share.profile.marks?.notes["uk:lsoa:E01000001"], "Secret canary note");
});

test("the brief's Copy link is redacted unless included", () => {
  const pack = buildMatchPack(structuredClone(DEFAULT_PROFILE));
  const href = comparedBriefHref({ pack, compared: IDS, profile: privateProfile(), mode: "demo" });
  assert.equal(profileOf(href!.slice("/brief".length)).maximumBudget, UNSHARED_BUDGET);
  const kept = comparedBriefHref({ pack, compared: IDS, profile: privateProfile(), mode: "demo", includeBudget: true });
  assert.equal(profileOf(kept!.slice("/brief".length)).maximumBudget, 654_321);
});

test("an import without the budget keeps the unset default, never the stand-in ceiling", () => {
  const decoded = decodeSharedShortlist(encodeSharedShortlist(shortlist()));
  assert.ok(decoded.ok);
  const imported = importSharedShortlist(decoded.share);
  assert.equal(imported.profile.maximumBudget, DEFAULT_PROFILE.maximumBudget);
});

test("redaction never sends the Tailor answers", () => {
  const profile = { ...privateProfile(), household: "kids-primary", lifestyle: [] } as PreferenceProfile;
  const redacted = redactProfileForShare(profile, OWN_BRIEF);
  assert.equal(redacted.household, undefined);
  assert.equal(redacted.lifestyle, undefined);
});

test("the review says what goes and what stays out", () => {
  const lines = shareReviewLines(privateProfile(), ["Westminster preview", "North London preview"], {});
  assert.equal(lines.shared[0], "2 areas: Westminster preview; North London preview");
  assert.deepEqual(lines.left, ["Budget up to £654,321", "Exact places: Canary Office, Round my flat", "Private notes (1)"]);
  const ticked = shareReviewLines(privateProfile(), ["A"], { includeBudget: true, includeDestinations: true, includeNotes: true });
  assert.deepEqual(ticked.left, []);
  assert.ok(ticked.shared.includes("Budget up to £654,321"));
});
