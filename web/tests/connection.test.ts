import assert from "node:assert/strict";
import test from "node:test";

import { probeConnection, watchConnection } from "../src/lib/connection";
import { REAL_PILOT_RELEASE, requestAreaEvidence, type FetchLike } from "../src/lib/map-state";

class FakeWindow {
  listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? new Set()).add(listener));
  }
  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }
  fire(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

test("the browser's online event clears Offline without a reload; offline sets it; unsubscribe stops both", () => {
  const seen: string[] = [];
  const target = new FakeWindow();
  const stop = watchConnection(target, (status) => seen.push(status));
  target.fire("offline");
  target.fire("online");
  assert.deepEqual(seen, ["offline", "online"]);
  stop();
  target.fire("offline");
  assert.deepEqual(seen, ["offline", "online"]);
});

test("the probe reads any answer as connected, even a 503 from a restarting API; no answer is not", async () => {
  const restarting: FetchLike = async () => ({ ok: false, status: 503, json: async () => ({}) });
  assert.equal(await probeConnection(restarting), true);
  const dead: FetchLike = async () => { throw new TypeError("fetch failed"); };
  assert.equal(await probeConnection(dead), false);
});

test("a 502 during a deploy is a failed read with Try again, never Offline, and clears a stale Offline", async () => {
  const seen: string[] = [];
  const deploying: FetchLike = async () => ({ ok: false, status: 502, json: async () => ({}) });
  const result = await requestAreaEvidence(
    { path: "/api/v1/areas/uk:lsoa:E01000001?mode=real", mode: "real", release: REAL_PILOT_RELEASE },
    deploying,
    { onConnection: (status) => seen.push(status) },
  );
  assert.equal(result.status, "connection-lost");
  assert.match(result.status === "connection-lost" ? result.reason : "", /status 502/);
  assert.deepEqual(seen, ["online"]);
});
