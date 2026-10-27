import assert from "node:assert/strict";
import test from "node:test";

import type { FactorPreference, PreferenceProfile } from "../src/lib/contracts";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { factorFields, factorLevel, importanceDots, MUST_EDGE, OFF, placeLevel, tapDot, tapMust, withCurrentLevels } from "../src/lib/priority-levels";
import { decodeSharedProfile, encodeSharedProfile } from "../src/lib/profile-state";

const factor = (factorId: FactorPreference["factorId"], weight: number, minimumUtility: number | null = null): FactorPreference =>
  ({ factorId, weight, direction: "lower", minimumUtility, maximumUtility: null });

// Fix 30b everywhere: the wizard's Off / Matters / Must have is gone; every criterion is dots 1–5 (0 = off) + Must.
test("old Off / Matters / Must have levels read as dots and Must", () => {
  assert.deepEqual(factorLevel(undefined), OFF);
  assert.deepEqual(factorLevel(factor("crime", 0)), { dots: 0, must: false }); // Off
  assert.deepEqual(factorLevel(factor("crime", 3)), { dots: 3, must: false }); // Matters
  assert.deepEqual(factorLevel(factor("crime", 3, 50)), { dots: 3, must: true }); // Must have
  assert.deepEqual(factorLevel(factor("crime", 0, 50)), { dots: 3, must: true }); // an older must-have with no weight
  assert.deepEqual(factorLevel(factor("crime", 4.6)), { dots: 5, must: false });
  assert.deepEqual(factorLevel(factor("crime", 0.2)), { dots: 1, must: false });
  assert.equal(importanceDots(Number.NaN), 0);
});

test("a place always counts at least one dot and keeps its Must", () => {
  const place = { id: "p", label: "Any park", target: { kind: "category" as const, category: "park" as const }, mode: "walk" as const, targetMinutes: 10, weight: 0, must: true };
  assert.deepEqual(placeLevel(place), { dots: 1, must: true });
  assert.deepEqual(placeLevel({ ...place, weight: 4, must: false }), { dots: 4, must: false });
  assert.deepEqual(placeLevel(undefined), OFF);
});

test("tapping: the lit top dot turns off, Must alone starts at 3 dots and keeps them when it goes", () => {
  assert.deepEqual(tapDot({ dots: 3, must: true }, 3), OFF);
  assert.deepEqual(tapDot({ dots: 3, must: true }, 5), { dots: 5, must: true });
  assert.deepEqual(tapDot(OFF, 2), { dots: 2, must: false });
  assert.deepEqual(tapMust(OFF), { dots: 3, must: true });
  assert.deepEqual(tapMust({ dots: 5, must: false }), { dots: 5, must: true });
  assert.deepEqual(tapMust({ dots: 5, must: true }), { dots: 5, must: false });
});

test("a factor's fields: Must is a minimum fit of 50, a link's own limit is kept, off clears it", () => {
  // The chip default's range end with edges at 0 (v4 Task 21), never a cut on a fit.
  assert.deepEqual(factorFields({ dots: 4, must: true }), { weight: 4, minimumUtility: MUST_EDGE, maximumUtility: null });
  assert.equal(MUST_EDGE, 50);
  assert.deepEqual(factorFields({ dots: 2, must: true }, factor("crime", 3, 70)), { weight: 2, minimumUtility: 70, maximumUtility: null });
  assert.deepEqual(factorFields({ dots: 2, must: false }, factor("crime", 3, 70)), { weight: 2, minimumUtility: null, maximumUtility: null });
  assert.deepEqual(factorFields(OFF, factor("crime", 3, 70)), { weight: 0, minimumUtility: null, maximumUtility: null });
});

test("saved and shared searches are rewritten in whole dots; an unchanged one keeps its identity", () => {
  assert.equal(withCurrentLevels(DEFAULT_PROFILE), DEFAULT_PROFILE);
  const old: PreferenceProfile = {
    ...DEFAULT_PROFILE,
    factors: [factor("affordability", 2.5), factor("crime", 0, 50), factor("noise", 3), factor("market-level", 4.6)],
  };
  const levels = withCurrentLevels(old);
  assert.deepEqual(levels.factors.map((entry) => [entry.factorId, entry.weight, entry.minimumUtility]),
    [["affordability", 2.5, null], ["crime", 3, 50], ["noise", 3, null], ["market-level", 5, null]]);
  // A link made before the change opens in the same levels.
  const shared = decodeSharedProfile(encodeSharedProfile(old));
  assert.ok(shared);
  assert.deepEqual(shared.factors.map((entry) => [entry.factorId, entry.weight, entry.minimumUtility]),
    [["affordability", 2.5, null], ["crime", 3, 50], ["noise", 3, null], ["market-level", 5, null]]);
});
