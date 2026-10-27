import assert from "node:assert/strict";
import test from "node:test";

import { visibleTicks } from "../src/lib/legend-ticks";
import { priceLabel } from "../src/lib/price-scale";

test("legend money is short: £250k, £1.5m+, never £1465k", () => {
  assert.equal(priceLabel(2_300), "£2.3k");
  assert.equal(priceLabel(250_000), "£250k");
  assert.equal(priceLabel(999_700), "£1m");
  assert.equal(priceLabel(1_465_000), "£1.5m");
});

const five = (width: number) => [0, 0.25, 0.5, 0.75, 1].map((position) => ({ position, width }));

test("a wide legend keeps all five labels when they fit", () => {
  assert.deepEqual(visibleTicks(five(40), 460), [true, true, true, true, true]);
});

test("under 320 px a legend shows three labels: low, middle and high", () => {
  assert.deepEqual(visibleTicks(five(40), 290), [true, false, true, false, true]);
});

test("labels that would touch drop middles first; the ends always stay", () => {
  // 5 labels 60 px wide on a 330 px ramp: the quarter labels collide with the ends.
  assert.deepEqual(visibleTicks(five(60), 330), [true, false, true, false, true]);
  // Even the middle one collides on a tiny ramp: ends only.
  assert.deepEqual(visibleTicks(five(60), 140), [true, false, false, false, true]);
});

test("the '£840k£1465k+' collision: a middle label against the last one goes", () => {
  const ticks = [{ position: 0, width: 38 }, { position: 0.5, width: 38 }, { position: 1, width: 48 }];
  assert.deepEqual(visibleTicks(ticks, 200), [true, true, true]);
  assert.deepEqual(visibleTicks(ticks, 110), [true, false, true]);
});

test("two labels or an unmeasured legend show as they are", () => {
  assert.deepEqual(visibleTicks([{ position: 0, width: 80 }, { position: 1, width: 80 }], 100), [true, true]);
  assert.deepEqual(visibleTicks(five(40), 0), [true, true, true, true, true]);
});
