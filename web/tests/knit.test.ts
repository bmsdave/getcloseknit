import assert from "node:assert/strict";
import test from "node:test";

import { barGrid, deepen, knitStitch, looped, pixels, ribGrid, ringStitches, slack } from "../src/lib/knit";

test("a knitted bar fills whole stitches from the left, row by row", () => {
  const grid = barGrid(0.5, "#e2453c", "#eef3f8", 10, 3);
  assert.equal(grid.length, 3);
  for (const row of grid) {
    assert.deepEqual(row.slice(0, 5), Array(5).fill("#e2453c"));
    assert.deepEqual(row.slice(5), Array(5).fill("#eef3f8"));
  }
  assert.equal(barGrid(2, "#a", "#b", 4, 1)[0].filter((s) => s === "#a").length, 4, "values clamp to the strip");
});

test("ribbing alternates two knit and two purl columns, with a stripe", () => {
  const [row0, row1] = ribGrid(8, 3, "#c0352c", "#f6c445");
  assert.deepEqual(row0.slice(0, 4), ["#c0352c", "#c0352c", ["#c0352c", "p"], ["#c0352c", "p"]]);
  assert.equal(row1[0], "#f6c445");
});

test("stitches are deterministic, so server and client renders match", () => {
  assert.deepEqual(knitStitch(10, 8, 1), knitStitch(10, 8, 1));
  assert.notDeepEqual(knitStitch(10, 8, 0), knitStitch(10, 8, 1));
  assert.equal(slack([[0, 0], [100, 40], [200, 0]], 3, 4), slack([[0, 0], [100, 40], [200, 0]], 3, 4));
});

test("a looped thread is one valid path through every point", () => {
  const d = looped([[0, 0], [60, 10], [120, 0], [180, 20]], 1, 6, 1, 0);
  assert.match(d, /^M0\.00 0\.00( C[-\d. ]+)+$/);
  assert.ok(!d.includes("NaN"));
});

test("light yarn darkens gently, so white wool stays clean", () => {
  const white = parseInt(deepen("#ffffff", -0.3).slice(1, 3), 16);
  const red = parseInt(deepen("#e2453c", -0.3).slice(1, 3), 16);
  assert.ok(white > 200, "white stays light");
  assert.ok(red < 0xe2, "colour still shades");
});

test("pixel art maps characters to stitches", () => {
  assert.deepEqual(pixels(["ab"], { a: "#111111", b: ["#222222", "p"] }), [["#111111", ["#222222", "p"]]]);
});

test("a knitted ring places stitches evenly round the circle, rotated along it", () => {
  const ring = ringStitches(50, 50, 20, 8, 2, 5);
  assert.equal(ring.length, 16);
  const first = ring[0];
  assert.equal(first.angle, 22.5);
  assert.ok(Math.abs(Math.hypot(first.x - 50, first.y - 50) - 20) < 1e-9);
  assert.ok(first.x > 50 && first.y < 50, "first stitch just clockwise of 12 o'clock");
  const outer = ring.find((s) => s.row === 1)!;
  assert.ok(Math.abs(Math.hypot(outer.x - 50, outer.y - 50) - 25) < 1e-9);
  assert.deepEqual(ring.filter((s) => s.row === 0).map((s) => s.angle), [22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5]);
});
