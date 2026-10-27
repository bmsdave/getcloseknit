import assert from "node:assert/strict";
import test from "node:test";

import { sharedFetch } from "../src/lib/shared-fetch";

function counted() {
  const calls: string[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const impl = async (url: string) => {
    calls.push(url);
    await gate;
    return new Response(JSON.stringify({ url }), { status: 200 });
  };
  return { calls, impl, open: () => release() };
}

test("identical requests in flight share one fetch, each reading its own body (v4 Task 32)", async () => {
  const api = counted();
  const first = sharedFetch("/api/v1/areas/a?metric=price", undefined, api.impl);
  const second = sharedFetch("/api/v1/areas/a?metric=price", undefined, api.impl);
  const other = sharedFetch("/api/v1/areas/b?metric=price", undefined, api.impl);
  api.open();

  assert.deepEqual(await (await first).json(), { url: "/api/v1/areas/a?metric=price" });
  assert.deepEqual(await (await second).json(), { url: "/api/v1/areas/a?metric=price" });
  await other;
  assert.equal(api.calls.length, 2);

  // Settled requests are forgotten: a later ask fetches again.
  await sharedFetch("/api/v1/areas/a?metric=price", undefined, api.impl);
  assert.equal(api.calls.length, 3);
});

test("one caller's abort ends only its own wait", async () => {
  const api = counted();
  const controller = new AbortController();
  const aborted = sharedFetch("/api/v1/areas/c", { signal: controller.signal }, api.impl);
  const kept = sharedFetch("/api/v1/areas/c", undefined, api.impl);
  controller.abort();
  api.open();

  await assert.rejects(aborted, (error: unknown) => (error as Error).name === "AbortError");
  assert.equal((await kept).status, 200);
  assert.equal(api.calls.length, 1);
});
