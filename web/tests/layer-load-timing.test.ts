import assert from "node:assert/strict";
import test from "node:test";

import { createLayerLoadTimer, type LayerLoadTiming } from "../src/lib/layer-load-timing";

function clock() {
  let at = 0;
  return { now: () => at, set: (value: number) => { at = value; } };
}

test("the opening layer counts from navigation start, until the map is idle after painting", () => {
  const time = clock();
  const records: LayerLoadTiming[] = [];
  const timer = createLayerLoadTimer((timing) => records.push(timing), time.now);
  time.set(120);
  timer.begin("crime");
  timer.begin("crime");
  time.set(900);
  const pending = timer.painted();
  assert.ok(pending);
  time.set(1_150);
  const timing = timer.settle(pending, 11.234);
  assert.deepEqual(timing, { layer: "crime", trigger: "open", startMs: 0, paintedMs: 900, endMs: 1_150, ms: 1_150, zoom: 11.23 });
  assert.equal(records.length, 1);
  // Once only: a later idle with nothing pending records nothing.
  assert.equal(timer.settle(pending, 11), null);
  assert.equal(timer.painted(), null);
});

test("a switch counts from the switch; a switch before idle drops the earlier layer", () => {
  const time = clock();
  const records: LayerLoadTiming[] = [];
  const timer = createLayerLoadTimer((timing) => records.push(timing), time.now);
  timer.begin("crime");
  timer.settle(timer.painted()!, 11);
  time.set(5_000);
  timer.begin("income");
  const stale = timer.painted()!;
  time.set(5_100);
  timer.begin("noise");
  assert.equal(timer.settle(stale, 11), null);
  time.set(5_400);
  const pending = timer.painted()!;
  time.set(5_700);
  assert.equal(timer.settle(pending, 11)?.ms, 600);
  assert.deepEqual(records.map((entry) => [entry.layer, entry.trigger]), [["crime", "open"], ["noise", "switch"]]);
});

test("a repaint before idle (more pieces in view) moves the painted time on, the start stays", () => {
  const time = clock();
  const timer = createLayerLoadTimer(() => undefined, time.now);
  timer.begin("income");
  time.set(400);
  timer.painted();
  time.set(2_000);
  const pending = timer.painted()!;
  time.set(2_300);
  const timing = timer.settle(pending, null)!;
  assert.equal(timing.paintedMs, 2_000);
  assert.equal(timing.ms, 2_300);
  assert.equal(timing.zoom, null);
});
