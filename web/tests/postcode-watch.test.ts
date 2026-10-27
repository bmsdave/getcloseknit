import assert from "node:assert/strict";
import test from "node:test";

import { watchPrompt } from "../src/components/watch-listings";

test("the watch prompt names the place and asks Claude, not Close Knit, to keep the watch", () => {
  const prompt = watchPrompt("SW1A 1AB");
  assert.match(prompt, /^Using Close Knit, watch for new homes for sale in SW1A 1AB\./);
  assert.match(prompt, /portals' own searches for SW1A 1AB/);
  assert.match(prompt, /asking price against recorded sales/);
  assert.doesNotMatch(prompt, /@|e-mail/i);
});
