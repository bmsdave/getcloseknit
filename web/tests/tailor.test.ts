import assert from "node:assert/strict";
import test from "node:test";

import { assertPreferenceProfile, type PreferenceProfile } from "../src/lib/contracts";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { decodeSharedProfile, encodeShareLink, matchRequestProfile } from "../src/lib/profile-state";
import { applyTailor, suggestedLifestyle, tailorAnswers, tailorSummary, withoutTailor } from "../src/lib/tailor";

const base = (): PreferenceProfile => structuredClone(DEFAULT_PROFILE);

test("an old profile (no Tailor answers) still parses unchanged", () => {
  const old = base();
  const parsed = assertPreferenceProfile(JSON.parse(JSON.stringify(old)) as PreferenceProfile);
  assert.deepEqual(parsed, old);
  assert.equal("household" in parsed, false);
});

test("lifestyle is capped at three; unknown answers are dropped, not fatal", () => {
  const stored = { ...base(), household: "pets", lifestyle: ["gym", "gym", "spa", "gp", "bars", "shops"] } as unknown as PreferenceProfile;
  const parsed = assertPreferenceProfile(stored);
  assert.equal(parsed.household, null);
  assert.deepEqual(parsed.lifestyle, ["gym", "gp", "bars"]);
});

test("household writes the school phases; reset keeps the rest of the search", () => {
  const tailored = applyTailor(base(), { household: "kids-secondary", market: "rent", lifestyle: ["gym", "parks", "cafes", "gp"] });
  assert.deepEqual(tailored.school.phases, ["secondary"]);
  assert.deepEqual(tailored.lifestyle, ["gym", "parks", "cafes"]);
  assert.equal(tailored.market, "rent");
  assert.deepEqual(applyTailor(base(), { household: "kids-mixed", market: "buy", lifestyle: [] }).school.phases, ["primary", "secondary"]);
  const reset = withoutTailor(tailored);
  assert.equal("household" in reset || "lifestyle" in reset, false);
  assert.deepEqual(reset.school.phases, ["secondary"]);
  // Skipping everything changes nothing.
  assert.deepEqual(applyTailor(base(), tailorAnswers(base())), base());
});

test("the chip reads 'kids at primary · gym'", () => {
  assert.equal(tailorSummary(applyTailor(base(), { household: "kids-primary", market: "buy", lifestyle: ["gym"] })), "kids at primary · gym");
  assert.equal(tailorSummary(base()), "");
  assert.equal(suggestedLifestyle("55plus"), "gp");
  assert.equal(suggestedLifestyle("kids-under5"), "parks");
  assert.equal(suggestedLifestyle(null), null);
});

test("v2 share links and match requests never carry household or lifestyle", () => {
  const plain = applyTailor(base(), { household: null, market: "buy", lifestyle: [] });
  const tailored = applyTailor(base(), { household: "kids-primary", market: "buy", lifestyle: ["gym", "gp"] });
  // The same link as before Tailor existed, apart from the school phases it already shared.
  assert.equal(encodeShareLink(tailored), encodeShareLink({ ...plain, school: tailored.school }));
  const decoded = decodeSharedProfile(encodeShareLink(tailored))!;
  assert.equal(decoded.household, undefined);
  assert.equal(decoded.lifestyle, undefined);
  assert.deepEqual(decoded.school.phases, ["primary"]);
  const request = JSON.parse(JSON.stringify(matchRequestProfile(tailored))) as Record<string, unknown>;
  assert.equal("household" in request || "lifestyle" in request, false);
});
