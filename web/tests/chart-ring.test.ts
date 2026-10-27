import assert from "node:assert/strict";
import test from "node:test";

import { ringBand, ringLabel } from "../src/components/charts/ring-score";

// The ring's centre label never runs into the band ("10/10" clipped in a tile).
const hole = (size: number) => size - 2 * ringBand(size) - 2;
const width = ({ text, fontSize, suffix, suffixSize }: ReturnType<typeof ringLabel>) =>
  0.62 * (text.length * fontSize + (suffix ? suffix.length * suffixSize : 0));

test("the centre label fits inside the hole at every ring size in use", () => {
  for (const size of [48, 56, 64, 88]) {
    for (const score of [0, 7, 9.5, 10]) {
      const label = ringLabel(score, 10, size);
      assert.ok(width(label) <= hole(size), `${score} at ${size}px`);
      if (label.suffix) assert.ok(label.suffixSize >= 11, "a shown /10 is at least 11px");
    }
  }
});

test("a tile ring drops /10 and keeps its number; a large ring keeps /10 when it fits", () => {
  assert.deepEqual({ ...ringLabel(10, 10, 48), fontSize: 0 }, { text: "10", fontSize: 0, suffix: null, suffixSize: 11 });
  assert.equal(ringLabel(7, 10, 88).suffix, "/10");
  assert.ok(ringLabel(9.5, 10, 48).fontSize < 48 * 0.28, "a wider number shrinks");
});
