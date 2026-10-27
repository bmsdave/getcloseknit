import assert from "node:assert/strict";
import test from "node:test";

import {
  bandIndex, compassPoint, formatShare, ringLabel, ringPoint, scalePosition, segmentFill, segmentTone, spreadMarkers,
  stackWidths, waffleCells,
} from "../src/lib/chart-geometry";

test("scalePosition maps a value onto 0..1 and clamps at both ends", () => {
  assert.equal(scalePosition(5, 0, 10), 0.5);
  assert.equal(scalePosition(-4, 0, 10), 0);
  assert.equal(scalePosition(40, 0, 10), 1);
  assert.equal(scalePosition(3, 3, 3), 0.5, "a flat range puts the value in the middle");
});

test("stackWidths sums to 100 and keeps tiny shares visible", () => {
  const widths = stackWidths([86, 11, 2, 1]);
  assert.ok(Math.abs(widths.reduce((sum, width) => sum + width, 0) - 100) < 1e-9);
  for (const width of widths) assert.ok(width >= 1.5, `${width} is under the visible minimum`);
  assert.ok(widths[0] > widths[1] && widths[1] > widths[2], "order of size is kept");
  const tiny = stackWidths([99.7, 0.3]);
  assert.ok(tiny[1] >= 1.5, "a 0.3% share still gets a visible sliver");
});

test("stackWidths leaves zero parts at zero and handles empty input", () => {
  assert.deepEqual(stackWidths([100, 0]), [100, 0]);
  assert.deepEqual(stackWidths([0, 0]), [0, 0]);
  assert.deepEqual(stackWidths([]), []);
  const crowded = stackWidths(Array.from({ length: 80 }, (_, i) => (i === 0 ? 1000 : 1)));
  assert.ok(Math.abs(crowded.reduce((sum, width) => sum + width, 0) - 100) < 1e-9, "too many parts still sum to 100");
});

test("waffleCells rounds to cells and never hides a non-zero share", () => {
  assert.equal(waffleCells(0.003), 1);
  assert.equal(waffleCells(0.649), 65);
  assert.equal(waffleCells(0), 0);
  assert.equal(waffleCells(1), 100);
  assert.equal(waffleCells(0.998), 99, "not everything stays visibly short of full");
});

test("segmentFill rounds a 1-10 score and treats unknown as empty", () => {
  assert.equal(segmentFill(9), 9);
  assert.equal(segmentFill(6.6), 7);
  assert.equal(segmentFill(null), 0);
  assert.equal(segmentFill(14), 10);
});

test("segmentTone colours only scores with a direction", () => {
  assert.equal(segmentTone(9, "worse-high"), "bad");
  assert.equal(segmentTone(2, "worse-high"), "good");
  assert.equal(segmentTone(9, "better-high"), "good");
  assert.equal(segmentTone(5, "better-high"), "neutral");
  assert.equal(segmentTone(9, "neutral"), "c1");
});

test("ringPoint places bearings clockwise from north", () => {
  const east = ringPoint(1500, 90, 1500, 100);
  assert.ok(Math.abs(east.x - 100) < 1e-9 && Math.abs(east.y) < 1e-9);
  assert.ok(ringPoint(750, 0, 1500, 100).y < 0, "north points up");
  const far = ringPoint(9000, 180, 1500, 100);
  assert.ok(Math.abs(far.y - 100) < 1e-9, "beyond the outer ring sits on the rim");
});

test("spreadMarkers pushes overlapping markers apart and keeps them inside", () => {
  const spread = spreadMarkers([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], 18, 100);
  for (let a = 0; a < spread.length; a += 1) {
    for (let b = a + 1; b < spread.length; b += 1) {
      assert.ok(Math.hypot(spread[a].x - spread[b].x, spread[a].y - spread[b].y) >= 17.5, `${a} and ${b} still overlap`);
    }
    assert.ok(Math.hypot(spread[a].x, spread[a].y) <= 100 + 1e-9);
  }
  assert.deepEqual(spreadMarkers([{ x: 10, y: 10 }], 18, 100), [{ x: 10, y: 10 }], "a lone marker stays put");
});

test("formatShare names tiny and near-total shares", () => {
  assert.equal(formatShare(0.004), "under 1%");
  assert.equal(formatShare(0.12), "12%");
  assert.equal(formatShare(0), "0%");
  assert.equal(formatShare(0.997), "over 99%");
  assert.equal(formatShare(1), "100%");
});

test("small labels for rings, bearings and bands", () => {
  assert.deepEqual([500, 1000, 1500].map(ringLabel), ["500 m", "1 km", "1.5 km"]);
  assert.equal(compassPoint(0), "north");
  assert.equal(compassPoint(44), "north-east");
  assert.equal(compassPoint(-90), "west");
  assert.equal(compassPoint(350), "north");
  assert.equal(bandIndex([{ id: "a" }, { id: "b" }], "b"), 1);
  assert.equal(bandIndex([{ id: "a" }], null), -1);
});
