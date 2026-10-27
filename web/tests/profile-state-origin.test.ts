import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { assertPreferenceProfile } from "../src/lib/contracts";
import { decodeSharedProfile, encodeSharedProfile, exampleProfile, isUnsetProfile, markProfileOrigin, profileOrigin } from "../src/lib/profile-state";

test("a profile opened from a link reads as shared until any edit makes a new profile", () => {
  const shared = decodeSharedProfile(encodeSharedProfile({ ...DEFAULT_PROFILE, maximumBudget: 600_000 }))!;
  assert.equal(profileOrigin(shared), "own");
  assert.equal(markProfileOrigin(shared, "shared"), shared);
  assert.equal(profileOrigin(shared), "shared");
  assert.equal(profileOrigin({ ...shared, maximumBudget: 550_000 }), "own");
  assert.equal(profileOrigin(DEFAULT_PROFILE), "own");
});

test("the example is a valid, fresh search each time, marked so it is never saved", () => {
  const first = exampleProfile();
  const second = exampleProfile();
  assert.notEqual(first, second);
  assert.equal(profileOrigin(first), "example");
  assert.doesNotThrow(() => assertPreferenceProfile(first));
  assert.equal(isUnsetProfile(first), false);
  assert.equal(first.maximumBudget, 600_000);
  assert.deepEqual(first.places?.map((place) => [place.label, place.targetMinutes, place.mode]), [["King's Cross", 30, "transit"]]);
  // The shared default is never touched.
  assert.equal(DEFAULT_PROFILE.factors.find((factor) => factor.factorId === "crime")?.weight, 0);
  assert.equal(profileOrigin({ ...first }), "own");
});
