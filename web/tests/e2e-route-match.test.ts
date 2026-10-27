import assert from "node:assert/strict";
import test from "node:test";

import { mayMatch } from "../e2e/route-match";

const section = new URL("http://127.0.0.1:4280/api/v1/areas/uk%3Alsoa%3AE01000001/schools?mode=demo&period=2026-06");
const evidence = new URL("http://127.0.0.1:4280/api/v1/areas/uk%3Alsoa%3AE01000001?mode=demo&metric=crime");

test("a spec's globs match section URLs as page.route does, with or without the query string", () => {
  assert.equal(mayMatch("**/api/v1/areas/**", section), true);
  assert.equal(mayMatch("**/api/v1/areas/*/schools", section), true);
  assert.equal(mayMatch("**/api/v1/areas/*/nature", section), false);
  assert.equal(mayMatch("**/api/v1/areas/boxes**", section), false);
  assert.equal(mayMatch("**/api/v1/areas/*/{schools,kids}", section), true);
  assert.equal(mayMatch("/api/v1/areas/*/schools", section), true);
  // One * never spans a "/": the area's own evidence is not a section's glob.
  assert.equal(mayMatch("**/api/v1/areas/*/schools", evidence), false);
});

test("regular expressions and predicates are asked as they are", () => {
  assert.equal(mayMatch(/\/api\/v1\/areas\/[^/?]+\?/, evidence), true);
  assert.equal(mayMatch(/\/api\/v1\/areas\/[^/?]+\?/, section), false);
  assert.equal(mayMatch(/\/api\/v1\/areas\/[^/?]+\/schools(\?|$)/g, section), true);
  assert.equal(mayMatch((url) => url.searchParams.get("metric") === "crime", evidence), true);
  assert.equal(mayMatch((url) => url.searchParams.get("metric") === "crime", section), false);
});
