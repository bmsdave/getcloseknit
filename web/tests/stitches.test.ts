import assert from "node:assert/strict";
import test from "node:test";

import { satinThreads, SATIN_GAP } from "../src/lib/satin";

test("satin threads cover the whole block, slanted, in three tones and a sheen", () => {
  const { tones, sheen } = satinThreads(0, 0, 60, 12, 4, 3);
  const count = tones.reduce((n, d) => n + (d.match(/M/g)?.length ?? 0), 0);
  assert.ok(count >= Math.floor(60 / SATIN_GAP), `about one thread per ${SATIN_GAP}px, got ${count}`);
  assert.equal(sheen.match(/M/g)?.length, count);
  assert.match(tones[0], /^M-?[\d.]+ 0\.4L-?[\d.]+ 11\.6/, "each thread runs top to bottom");
});

test("satin is deterministic, so server and client renders match", () => {
  assert.deepEqual(satinThreads(0, 0, 40, 12, 3, 7), satinThreads(0, 0, 40, 12, 3, 7));
});
