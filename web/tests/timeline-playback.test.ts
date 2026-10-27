import assert from "node:assert/strict";
import test from "node:test";

import {
  nextTimelinePeriod,
  PRICE_MORPH_MS,
  PRICE_PLAY_INTERVAL_MS,
  timelinePeriods,
  timelineIndex,
} from "../src/lib/price-scale";
import {
  createLruCache,
  createPackCache,
  nextStepDue,
  PLAY_LEAD_MS,
  playbackBeat,
  PREFETCH_AHEAD,
  playbackDurationMs,
  upcomingPeriods,
} from "../src/lib/timeline-playback";

function months(firstIndex: number, lastIndex: number): string[] {
  const periods: string[] = [];
  for (let index = firstIndex; index <= lastIndex; index += 1) {
    periods.push(`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`);
  }
  return periods;
}

const HISTORY = months(2006 * 12 + 5, 2026 * 12 + 5); // 2006-06 … 2026-06

// Play schedule

test("playback steps a month at a time and plays 2006–2026 in under a minute", () => {
  const steps = timelinePeriods(HISTORY);
  assert.deepEqual(steps.slice(0, 3), ["2006-06", "2006-07", "2006-08"]);
  assert.equal(steps.at(-1), "2026-06");
  assert.equal(steps.length, 241);
  const seconds = playbackDurationMs(steps, PRICE_PLAY_INTERVAL_MS) / 1000;
  assert.ok(seconds >= 40 && seconds <= 60, `${seconds}s`);
  // One morph per step, back to back: the map never rests between months.
  assert.equal(PRICE_MORPH_MS, PRICE_PLAY_INTERVAL_MS);
});

test("monthly steps keep the latest month; a month outside them rests on the step before it", () => {
  const steps = timelinePeriods(months(2006 * 12 + 5, 2026 * 12 + 8)); // … 2026-09
  assert.deepEqual(steps.slice(-3), ["2026-07", "2026-08", "2026-09"]);
  assert.equal(timelineIndex(steps, "2015-05"), steps.indexOf("2015-05"));
  assert.equal(nextTimelinePeriod(steps, "2015-05"), "2015-06");
  assert.equal(nextTimelinePeriod(steps, "2026-09"), null);
  assert.deepEqual(timelinePeriods(HISTORY, 3).slice(0, 3), ["2006-06", "2006-09", "2006-12"]);
  assert.deepEqual(timelinePeriods(HISTORY, 12).slice(0, 2), ["2006-06", "2007-06"]);
});

test("the play beat does not drift with timer and render latency, and restarts after a stall", () => {
  const interval = PRICE_PLAY_INTERVAL_MS;
  // Handed over a few ms late each time: the next step stays on the beat.
  let due = 1000;
  for (let step = 0; step < 20; step += 1) due = nextStepDue(due, due - PLAY_LEAD_MS + 7, interval);
  assert.equal(due, 1000 + 20 * interval);
  // A pack that took a second: the beat restarts from when the step was handed over.
  assert.equal(nextStepDue(5000, 5000 - PLAY_LEAD_MS + 1000, interval), 5000 + 1000 + interval);
  assert.ok(PLAY_LEAD_MS < interval);
});

test("the map starts a morph on the beat only for the step playback handed over", () => {
  playbackBeat.set("2010-06", 1234);
  assert.equal(playbackBeat.startFor("2010-06"), 1234);
  assert.equal(playbackBeat.startFor("2011-06"), null, "a slider move starts at once");
  playbackBeat.clear();
  assert.equal(playbackBeat.startFor("2010-06"), null);
});

// Prefetch and LRU

test("prefetch looks the next few steps ahead and wraps like playback", () => {
  const steps = ["2024-06", "2024-09", "2024-12", "2025-03", "2025-06"];
  assert.equal(PREFETCH_AHEAD, 6);
  assert.deepEqual(upcomingPeriods(steps, "2024-06", 3), ["2024-09", "2024-12", "2025-03"]);
  assert.deepEqual(upcomingPeriods(steps, "2024-06"), ["2024-09", "2024-12", "2025-03", "2025-06"]);
  assert.deepEqual(upcomingPeriods(steps, "2025-03"), ["2025-06"]);
  assert.deepEqual(upcomingPeriods(steps, "2025-06"), []);
  assert.deepEqual(upcomingPeriods(steps, "2024-10", 2), ["2024-12", "2025-03"]);
  assert.deepEqual(upcomingPeriods(["2024-06", "2024-09"], "2024-06", 3), ["2024-09"]);
  assert.deepEqual(upcomingPeriods(["2024-06"], "2024-06"), []);
});

test("the LRU drops the least recently used entry and a read refreshes one", () => {
  const cache = createLruCache<number>(2);
  cache.set("a", 1);
  cache.set("b", 2);
  assert.equal(cache.get("a"), 1);
  cache.set("c", 3);
  assert.deepEqual(cache.keys(), ["a", "c"]);
  assert.equal(cache.get("b"), undefined);
});

test("the pack cache fetches a path once, shares requests in flight and forgets failures", async () => {
  const calls: string[] = [];
  let fail = true;
  const cache = createPackCache<string>(async (path) => {
    calls.push(path);
    if (path === "/bad" && fail) throw new Error("network");
    return `pack ${path}`;
  }, 2);
  cache.prefetch(["/a", "/b"]);
  assert.equal(await cache.get("/a"), "pack /a");
  assert.equal(await cache.get("/b"), "pack /b");
  assert.deepEqual(calls, ["/a", "/b"]);

  await assert.rejects(cache.get("/bad"));
  assert.equal(cache.has("/bad"), false);
  fail = false;
  assert.equal(await cache.get("/bad"), "pack /bad");

  // Capacity 2: "/a" was least recently used and is fetched again.
  assert.equal(cache.has("/a"), false);
  assert.equal(await cache.get("/a"), "pack /a");
  assert.equal(calls.filter((path) => path === "/a").length, 2);
});
