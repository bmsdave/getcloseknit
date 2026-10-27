import assert from "node:assert/strict";
import test from "node:test";

import { stationWalkMinutes, walkMinutes } from "../src/lib/places";

test("station walk minutes stretch the straight line by the 1.3 routing detour", () => {
  // 800 m crow-fly: the old straight-line figure was 10 min, the API's
  // straight-line estimate 13 min, a routed walk typically 12-14 min.
  assert.equal(walkMinutes(800), 10);
  assert.equal(stationWalkMinutes(800), 13);
});

test("station walk minutes never read zero", () => {
  assert.equal(stationWalkMinutes(0), 1);
  assert.equal(stationWalkMinutes(40), 1);
});
