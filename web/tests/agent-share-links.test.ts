import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { decodeSharedProfile, encodeSharedProfile } from "../src/lib/profile-state";

// The API's share_links.py encodes the same fixtures; both sides must agree byte for byte.
const fixture = JSON.parse(readFileSync(new URL("../../contracts/fixtures/agent-share-links.json", import.meta.url), "utf8")) as {
  cases: { name: string; profile: never; fragment: string }[];
};

for (const item of fixture.cases) {
  test(`agent share link ${item.name} round-trips through the site encoder`, () => {
    assert.equal(encodeSharedProfile(item.profile), item.fragment);
    assert.deepEqual(decodeSharedProfile(item.fragment), item.profile);
  });
}
