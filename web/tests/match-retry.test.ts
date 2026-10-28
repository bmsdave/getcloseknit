import assert from "node:assert/strict";
import test from "node:test";

import { isBusyStatus, MATCH_BUSY_WORDS, matchRetryDelay } from "../src/lib/match-retry";

// G-E09: a 429 on /matches is retried with a growing wait and the panel says so, never a stale ranking in silence.
test("busy answers are retried, bad requests are not", () => {
  assert.equal(isBusyStatus(429), true);
  assert.equal(isBusyStatus(503), true);
  assert.equal(isBusyStatus(400), false);
  assert.equal(isBusyStatus(200), false);
});

test("the wait follows Retry-After, else doubles from 2 s, never past 30 s", () => {
  assert.deepEqual([0, 1, 2].map((attempt) => matchRetryDelay(attempt, null)), [2000, 4000, 8000]);
  assert.equal(matchRetryDelay(0, "7"), 7000);
  assert.equal(matchRetryDelay(0, "0"), 2000, "never a hammering retry");
  assert.equal(matchRetryDelay(0, "3600"), 30000);
  assert.equal(matchRetryDelay(1, "soon"), 4000);
  assert.match(MATCH_BUSY_WORDS.retrying, /Busy, retrying/);
});
