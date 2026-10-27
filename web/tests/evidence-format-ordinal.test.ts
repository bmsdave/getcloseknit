import assert from "node:assert/strict";
import test from "node:test";

import { formatOrdinal } from "../src/lib/evidence-format";

test("ordinals use 1st, 2nd, 3rd, then th", () => {
  assert.equal(formatOrdinal(1), "1st");
  assert.equal(formatOrdinal(2), "2nd");
  assert.equal(formatOrdinal(3), "3rd");
  assert.equal(formatOrdinal(4), "4th");
  assert.equal(formatOrdinal(92), "92nd");
});

test("teens always take th, including 111th through 113th", () => {
  for (const value of [11, 12, 13, 111, 112, 113]) {
    assert.equal(formatOrdinal(value), `${value}th`);
  }
  assert.equal(formatOrdinal(21), "21st");
  assert.equal(formatOrdinal(22), "22nd");
  assert.equal(formatOrdinal(23), "23rd");
});

test("every whole percentile from 0 to 100 carries a suffix", () => {
  for (let percentile = 0; percentile <= 100; percentile += 1) {
    assert.match(formatOrdinal(percentile), /^\d+(st|nd|rd|th)$/);
  }
  assert.equal(formatOrdinal(0), "0th");
  assert.equal(formatOrdinal(100), "100th");
});

test("negatives keep their sign with the matching suffix", () => {
  assert.equal(formatOrdinal(-1), "-1st");
  assert.equal(formatOrdinal(-22), "-22nd");
});

test("unsupported inputs pass through without a false suffix", () => {
  assert.equal(formatOrdinal(92.5), "92.5");
  assert.equal(formatOrdinal(Number.NaN), "NaN");
  assert.equal(formatOrdinal(Number.POSITIVE_INFINITY), "Infinity");
});
