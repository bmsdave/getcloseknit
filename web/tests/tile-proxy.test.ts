import assert from "node:assert/strict";
import test from "node:test";

import { parseTileCoordinate } from "../src/lib/tile-proxy";

test("tile segments parse into a tile inside the pyramid", () => {
  assert.deepEqual(parseTileCoordinate("16", "32740", "21790.pbf"), { z: 16, x: 32740, y: 21790 });
  assert.deepEqual(parseTileCoordinate("0", "0", "0"), { z: 0, x: 0, y: 0 });
});

test("crafted or out-of-range segments are rejected", () => {
  for (const [z, x, y] of [
    ["16", "..", "1.pbf"],
    ["16", "1", "..%2F..%2Fhealth"],
    ["16", "1", "1.pbf?x=1"],
    ["16", "-1", "1.pbf"],
    ["1", "2", "0.pbf"],
    ["23", "0", "0.pbf"],
    ["16", "1e3", "1.pbf"],
  ]) {
    assert.equal(parseTileCoordinate(z, x, y), null, `${z}/${x}/${y}`);
  }
});
