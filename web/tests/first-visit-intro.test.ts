import assert from "node:assert/strict";
import test from "node:test";

import { isDeepLink } from "../src/components/first-visit-intro";

test("a plain home visit shows the intro; deep links, including find=like and find=budget, skip it", () => {
  assert.equal(isDeepLink("", ""), false);
  assert.equal(isDeepLink("?layer=price-per-square-metre", ""), false);
  assert.equal(isDeepLink("?find=like&area=lsoa:E01000001", ""), true);
  assert.equal(isDeepLink("?find=budget&price=570000", ""), true);
  assert.equal(isDeepLink("?layer=price-per-square-metre&rank=most-expensive", ""), true);
  assert.equal(isDeepLink("?find=other", ""), false);
  assert.equal(isDeepLink("?selected=uk:lsoa:E01000001", ""), true);
  assert.equal(isDeepLink("", "#profile=v2.abc"), true);
  assert.equal(isDeepLink("?zoom=13", ""), true);
});
