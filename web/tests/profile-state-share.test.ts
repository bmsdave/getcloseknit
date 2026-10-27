import assert from "node:assert/strict";
import test from "node:test";

import type { GeographyId } from "../src/lib/contracts";
import { DEFAULT_PROFILE } from "../src/lib/fixtures";
import { decodeSharedProfile, encodeShareLink, encodeSharedProfile, exampleProfile, findLikeHref, parseFindLike, sharedCompared } from "../src/lib/profile-state";

const ORIGIN = "https://getcloseknit.com/?layer=personal-match";

test("the example search shares in a link under 300 characters, compared areas included", () => {
  const compared = ["uk:lsoa:E01000002", "uk:lsoa:E01000003"] as GeographyId[];
  const link = `${ORIGIN}${encodeShareLink(exampleProfile(), compared)}`;
  assert.ok(link.length < 300, `${link.length}: ${link}`);
  assert.ok(encodeShareLink(exampleProfile()).length < encodeSharedProfile(exampleProfile()).length / 1.5);
  assert.deepEqual(sharedCompared(new URL(link).hash), compared);
});

test("a compact link reads back as the same search", () => {
  const profile = exampleProfile();
  const decoded = decodeSharedProfile(encodeShareLink(profile, ["uk:lsoa:E01000002" as GeographyId]))!;
  assert.equal(decoded.maximumBudget, 600_000);
  assert.deepEqual(decoded.school, DEFAULT_PROFILE.school);
  assert.deepEqual(decoded.places, profile.places);
  // Zero-weight factors with no limits are left out; every weighted factor and limit survives.
  assert.deepEqual(decoded.factors, profile.factors.filter((factor) => factor.weight > 0));
  const strict = { ...profile, factors: profile.factors.map((factor) => factor.factorId === "crime" ? { ...factor, minimumUtility: 40 } : factor) };
  assert.equal(decodeSharedProfile(encodeShareLink(strict))!.factors.find((factor) => factor.factorId === "crime")!.minimumUtility, 40);
});

test("older v1 links still open, and links without areas compare nothing", () => {
  const v1 = encodeSharedProfile(exampleProfile());
  assert.equal(decodeSharedProfile(v1)!.maximumBudget, 600_000);
  assert.deepEqual(sharedCompared(v1), []);
  assert.deepEqual(sharedCompared(`${encodeShareLink(exampleProfile())}&compare=E0100000X.nope`), []);
  assert.equal(decodeSharedProfile("#profile=v2.!!!"), null);
});

test("find-like links name one London neighbourhood", () => {
  assert.equal(findLikeHref("uk:lsoa:E01000002" as GeographyId), "/?find=like&area=lsoa:E01000002");
  assert.equal(parseFindLike("?find=like&area=lsoa:E01000002"), "uk:lsoa:E01000002");
  assert.equal(parseFindLike("?find=like&area=uk:lsoa:E01000002&zoom=12"), "uk:lsoa:E01000002");
  assert.equal(parseFindLike("?find=like&area=borough:E09000002"), null);
  assert.equal(parseFindLike("?find=other&area=lsoa:E01000002"), null);
  assert.equal(parseFindLike("?layer=personal-match"), null);
});
