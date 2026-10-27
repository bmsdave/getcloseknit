import assert from "node:assert/strict";
import test from "node:test";

import {
  createCoalescingScheduler,
  createUpdateScope,
} from "../src/lib/map-update-scheduler";

function manualDriver() {
  const callbacks = new Map<number, () => void>();
  let nextHandle = 1;
  return {
    requested: () => callbacks.size,
    fire(handle: number) {
      callbacks.get(handle)?.();
      callbacks.delete(handle);
    },
    handles: () => [...callbacks.keys()],
    request: (callback: () => void) => {
      const handle = nextHandle;
      nextHandle += 1;
      callbacks.set(handle, callback);
      return handle;
    },
    cancel: (handle: number) => {
      callbacks.delete(handle);
    },
  };
}

test("rapid updates coalesce into one frame outside camera cadence", () => {
  const driver = manualDriver();
  const scheduler = createCoalescingScheduler(driver);
  let runs = 0;
  let last = "";
  scheduler.request(() => { runs += 1; last = "first"; });
  scheduler.request(() => { runs += 1; last = "second"; });
  scheduler.request(() => { runs += 1; last = "third"; });
  assert.equal(driver.requested(), 1);
  driver.fire(driver.handles()[0]);
  assert.equal(runs, 1);
  assert.equal(last, "third");
});

test("cancelled updates never run", () => {
  const driver = manualDriver();
  const scheduler = createCoalescingScheduler(driver);
  let runs = 0;
  scheduler.request(() => { runs += 1; });
  scheduler.cancel();
  assert.equal(driver.requested(), 0);
  scheduler.request(() => { runs += 1; });
  driver.fire(driver.handles()[0]);
  assert.equal(runs, 1);
});

test("stale async responses lose to newer requests", () => {
  const scope = createUpdateScope();
  const first = scope.issue();
  const second = scope.issue();
  assert.equal(scope.isCurrent(first), false);
  assert.equal(scope.isCurrent(second), true);
});

test("invalidated scope rejects every pending sequence", () => {
  const scope = createUpdateScope();
  const pending = scope.issue();
  scope.invalidate();
  assert.equal(scope.isCurrent(pending), false);
  const fresh = scope.issue();
  assert.equal(scope.isCurrent(fresh), true);
});
