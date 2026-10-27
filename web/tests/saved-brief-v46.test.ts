// v4.6 saved-brief track (check round 3, CUJ03 / CUJ14): Saved opens with two areas ticked, /?saved=1 survives the
// map's own address writes, and the area panel header has ♡ and Watch for every kind of area.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PRE_TICKED_AREAS, preTickedAreas, wantsSaved } from "../src/lib/saved-panel";

const A = "uk:lsoa:E01000001";
const B = "uk:lsoa:E01000002";
const C = "uk:lsoa:E01000003";

test("Saved ticks the best two by score, else the newest two (CUJ14 board: ♡ → Compare 2)", () => {
  assert.equal(PRE_TICKED_AREAS, 2);
  assert.deepEqual(preTickedAreas([A, B, C]), [A, B]);
  assert.deepEqual(preTickedAreas([A, B, C], { [A]: 74, [B]: 81, [C]: 86 }), [C, B]);
  // An area out of the search (null) or not scored yet comes after the scored ones, in row order.
  assert.deepEqual(preTickedAreas([A, B, C], { [A]: null, [C]: 60 }), [C, A]);
  // One saved area: nothing to compare, nothing ticked.
  assert.deepEqual(preTickedAreas([A], { [A]: 90 }), []);
});

test("/?saved=1 opens Saved", () => {
  assert.equal(wantsSaved("?saved=1"), true);
  assert.equal(wantsSaved("?layer=crime&saved=1"), true);
  assert.equal(wantsSaved("?layer=crime"), false);
});

test("the map's area header has Watch and ♡ for a neighbourhood, a wider neighbourhood and a borough", () => {
  const source = readFileSync(new URL("../src/components/evidence-panel.tsx", import.meta.url), "utf8");
  assert.match(source, /\/\^uk:\(lsoa\|msoa\|lad\):\/\.test\(props\.selected\)/);
  assert.match(source, /<WatchListings place=\{name\} className="area-brief__watch"/);
});
