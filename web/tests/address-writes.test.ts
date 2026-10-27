import assert from "node:assert/strict";
import test from "node:test";

import { ADDRESS_WRITE_GAP_MS, addressWriteDelay, onlyPeriodChanged } from "../src/lib/address-writes";
import { PRICE_PLAY_INTERVAL_MS, timelinePeriods } from "../src/lib/price-scale";

test("only a month moving waits; any other change is written at once", () => {
  assert.equal(onlyPeriodChanged(null, "layer=crime&period=2026-06"), false);
  assert.equal(onlyPeriodChanged("layer=crime&period=2026-06", "layer=crime&period=2026-06"), false);
  assert.equal(onlyPeriodChanged("layer=crime&period=2026-05", "layer=crime&period=2026-06"), true);
  assert.equal(onlyPeriodChanged("layer=crime&period=2026-05", "layer=income&period=2026-06"), false);
  assert.equal(onlyPeriodChanged("layer=crime&period=2026-06", "layer=crime&period=2026-06&selected=uk%3Alsoa%3AE01000001"), false);
});

test("address writes are spaced out, so monthly playback stays under Safari's 100 writes in 30 s", () => {
  assert.equal(addressWriteDelay(1000, null), 0);
  assert.equal(addressWriteDelay(1000, 1000 - ADDRESS_WRITE_GAP_MS), 0);
  assert.equal(addressWriteDelay(1000, 900), ADDRESS_WRITE_GAP_MS - 100);
  // Playing all 241 months writes at most one address per gap, whatever the beat.
  const months = timelinePeriods(Array.from({ length: 241 }, (_, index) => {
    const month = 2006 * 12 + 5 + index;
    return `${Math.floor(month / 12)}-${String((month % 12) + 1).padStart(2, "0")}`;
  }));
  let last: number | null = null;
  const written: number[] = [];
  months.forEach((_, step) => {
    const now = step * PRICE_PLAY_INTERVAL_MS;
    if (addressWriteDelay(now, last) === 0) {
      written.push(now);
      last = now;
    }
  });
  const perThirtySeconds = Math.max(...written.map((at) => written.filter((other) => other >= at && other < at + 30_000).length));
  assert.ok(perThirtySeconds < 100, `${perThirtySeconds} writes in 30 s`);
  // Without the gap, playback alone would pass Safari's limit.
  assert.ok(Math.ceil(30_000 / PRICE_PLAY_INTERVAL_MS) > 100);
});
