import assert from "node:assert/strict";
import test from "node:test";

import { HOME_SECTORS_TTL_MS, homeSitemapIndex, homeSitemapSectors } from "../src/lib/home-sitemap";

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

test("the sector list is read once per HOME_SECTORS_TTL_MS, and an API that does not answer throws, never 404s every shard", async () => {
  const previousUrl = process.env.CLOSE_KNIT_API_URL;
  const previousFetch = globalThis.fetch;
  process.env.CLOSE_KNIT_API_URL = "http://api.test";
  let asked = 0;
  let answer: Response | null = null;
  globalThis.fetch = (async () => {
    asked += 1;
    return answer ?? new Response("{}", { status: 429 });
  }) as typeof fetch;
  const ttl = HOME_SECTORS_TTL_MS;
  const at = (offset: number) => () => Date.now() + offset;
  try {
    answer = new Response(JSON.stringify([{ code: "E1 6", slug: "E1-6", name: "Spitalfields" }]), { headers: { "content-type": "application/json" } });
    assert.deepEqual(await homeSitemapSectors(at(ttl + 1000)), ["E1 6"]);
    answer = null;
    assert.deepEqual(await homeSitemapSectors(at(ttl + 2000)), ["E1 6"], "held: no second read");
    assert.equal(asked, 1);
    await assert.rejects(homeSitemapSectors(at(3 * ttl)), /did not load/, "a 429 is an error, not zero sectors");
    await assert.rejects(homeSitemapIndex("E1-6"), /answered 429/, "a shard whose index fails is a 500, not an empty sitemap");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.CLOSE_KNIT_API_URL;
    else process.env.CLOSE_KNIT_API_URL = previousUrl;
  }
});
