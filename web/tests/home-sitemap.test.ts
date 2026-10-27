import assert from "node:assert/strict";
import test from "node:test";

import { homeSitemapSectors } from "../src/lib/home-sitemap";

test("the per-address sitemap shards are the sectors with recorded homes, not every sector in England", async () => {
  const previousUrl = process.env.CLOSE_KNIT_API_URL;
  const previousFetch = globalThis.fetch;
  const asked: string[] = [];
  process.env.CLOSE_KNIT_API_URL = "http://api.test";
  let timeout: AbortSignal | null | undefined;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    asked.push(String(input));
    timeout = init?.signal;
    await new Promise((resolve) => setTimeout(resolve, 2700)); // a cold API: longer than the 2.5 s default
    if (timeout?.aborted) throw new Error("aborted");
    return new Response(JSON.stringify([{ code: "W5 1", slug: "W5-1", name: "Ealing" }]), {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    assert.deepEqual(await homeSitemapSectors(), ["W5 1"]);
    assert.deepEqual(asked, ["http://api.test/api/v1/sectors?homes=1"]);
    // A cold API takes seconds to list them: the sitemap waits rather than drop every shard (2.5 s default).
    assert.ok(timeout && !timeout.aborted);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.CLOSE_KNIT_API_URL;
    else process.env.CLOSE_KNIT_API_URL = previousUrl;
  }
});
