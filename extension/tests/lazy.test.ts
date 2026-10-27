import assert from "node:assert/strict";
import test from "node:test";

import { lazyBatcher, visibilityWatcher } from "../src/content/lazy";

function fakeTimer() {
  const queue: (() => void)[] = [];
  return { schedule: (run: () => void) => void queue.push(run), fire: () => queue.splice(0).forEach((run) => run()), queue };
}

test("results that come into view together go in one request, at most 30 each", async () => {
  const timer = fakeTimer();
  const sent: number[][] = [];
  const batcher = lazyBatcher<number>({ max: 30, schedule: timer.schedule, flush: async (items) => void sent.push(items) });
  for (let i = 0; i < 65; i++) batcher.add(i);
  assert.equal(timer.queue.length, 1, "one pause for the whole burst");
  assert.equal(sent.length, 0, "nothing before the pause ends");
  timer.fire();
  await batcher.idle();
  assert.deepEqual(sent.map((batch) => batch.length), [30, 30, 5]);
  assert.deepEqual(sent.flat(), Array.from({ length: 65 }, (_, i) => i));
  batcher.add(99);
  timer.fire();
  await batcher.idle();
  assert.deepEqual(sent.at(-1), [99]);
});

test("a failed request does not stop the next batch", async () => {
  const timer = fakeTimer();
  const sent: number[][] = [];
  let first = true;
  const batcher = lazyBatcher<number>({ max: 2, schedule: timer.schedule, flush: async (items) => {
    if (first) {
      first = false;
      throw new Error("offline");
    }
    sent.push(items);
  } });
  [1, 2, 3].forEach((n) => batcher.add(n));
  timer.fire();
  await batcher.idle();
  assert.deepEqual(sent, [[3]]);
});

test("only cards in view are handed on, once each", () => {
  let callback: IntersectionObserverCallback = () => {};
  const observed = new Set<unknown>();
  class FakeObserver {
    constructor(cb: IntersectionObserverCallback) {
      callback = cb;
    }
    observe(el: Element) {
      observed.add(el);
    }
    unobserve(el: Element) {
      observed.delete(el);
    }
  }
  const seen: unknown[] = [];
  const watcher = visibilityWatcher((el) => seen.push(el), FakeObserver);
  const [a, b, c] = [{ id: "a" }, { id: "b" }, { id: "c" }] as unknown as Element[];
  [a, b, c].forEach((el) => watcher.watch(el));
  const entry = (target: Element, isIntersecting: boolean) => ({ target, isIntersecting }) as IntersectionObserverEntry;
  callback([entry(a, true), entry(b, false)], {} as IntersectionObserver);
  assert.deepEqual(seen, [a]);
  assert.equal(observed.has(a), false, "a visible card stops being watched");
  assert.equal(observed.has(b), true);
  callback([entry(b, true), entry(c, true)], {} as IntersectionObserver);
  assert.deepEqual(seen, [a, b, c]);
});

test("without IntersectionObserver every card counts as visible", () => {
  const seen: unknown[] = [];
  visibilityWatcher((el) => seen.push(el), undefined).watch({} as Element);
  assert.equal(seen.length, 1);
});
