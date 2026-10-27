import assert from "node:assert/strict";
import test from "node:test";

import { backoffMs, mapFetch, politeFetch, retryAfterMs, RETRY_LIMIT } from "../src/lib/polite-fetch";

function responder(statuses: number[], retryAfter = "0") {
  const calls: string[] = [];
  const impl = (async (input: string) => {
    calls.push(input);
    const status = statuses[Math.min(calls.length - 1, statuses.length - 1)];
    return new Response("{}", { status, headers: { "retry-after": retryAfter } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("a rate-limited request waits and succeeds on retry", async () => {
  const { impl, calls } = responder([429, 200]);
  const response = await politeFetch("/api/v1/areas/x", undefined, impl);
  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
});

test("it gives up after the retry limit and returns the 429", async () => {
  const { impl, calls } = responder([429]);
  const response = await politeFetch("/api/v1/areas/x", undefined, impl);
  assert.equal(response.status, 429);
  assert.equal(calls.length, RETRY_LIMIT + 1);
});

test("other statuses are returned at once", async () => {
  const { impl, calls } = responder([404]);
  assert.equal((await politeFetch("/x", undefined, impl)).status, 404);
  assert.equal(calls.length, 1);
});

test("Retry-After is read as seconds or a date and capped", () => {
  assert.equal(retryAfterMs("2"), 2000);
  assert.equal(retryAfterMs("120"), 8000);
  assert.equal(retryAfterMs(null), 1000);
  assert.equal(retryAfterMs(new Date(10_000).toUTCString(), 7_000), 3000);
});

test("an abort during the wait rejects", async () => {
  const { impl } = responder([429, 200], "5");
  const controller = new AbortController();
  const pending = politeFetch("/x", { signal: controller.signal }, impl);
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(pending);
});

test("the map's requests ride over a restart (503) or a network error; a panel's fail at once", async () => {
  const panel = responder([503, 200]);
  assert.equal((await politeFetch("/api/v1/areas/x", undefined, panel.impl)).status, 503);
  assert.equal(panel.calls.length, 1);
  const { impl, calls } = responder([503, 200]);
  assert.equal((await mapFetch("/api/v1/value-packs/crime/2026-08", undefined, impl)).status, 200);
  assert.equal(calls.length, 2);
  let tries = 0;
  const flaky = (async () => {
    tries += 1;
    if (tries === 1) throw new TypeError("Failed to fetch");
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  assert.equal((await mapFetch("/x", undefined, flaky)).status, 200);
  assert.equal(tries, 2);
  assert.deepEqual([0, 1, 2, 3].map(backoffMs), [500, 1500, 4500, 8000]);
});
