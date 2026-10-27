import assert from "node:assert/strict";
import test from "node:test";

import { readAreaPageSeed, seedCache } from "../src/lib/area-page-seed";
import { clientHeaders } from "../src/lib/evidence-service";
import { INTERNAL_KEY_HEADER, RENDER_ID_HEADER, renderHeaders } from "../src/lib/server-render";
import type { AreaSeedQuery } from "../src/lib/section-seed";
import { TtlCache } from "../src/lib/ttl-cache";

const KEY = "k".repeat(64);
const QUERY: AreaSeedQuery = {
  geographyId: "uk:lsoa:E01000001", areaId: "uk:lsoa:E01000001", mode: "real", release: "rel-1", period: "2026-06", uprn: null,
};

/** The API at http://api.test answering `status` to every read; the reads it saw. */
function stubApi(t: test.TestContext, status: (url: string) => number = () => 200) {
  const saved = { url: process.env.CLOSE_KNIT_API_URL, key: process.env.CLOSE_KNIT_INTERNAL_KEY, fetch: globalThis.fetch };
  process.env.CLOSE_KNIT_API_URL = "http://api.test";
  process.env.CLOSE_KNIT_INTERNAL_KEY = KEY;
  const reads: { url: string; headers: Record<string, string> }[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    reads.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response("{}", { status: status(String(url)), headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  seedCache.clear();
  t.after(() => {
    globalThis.fetch = saved.fetch;
    if (saved.url === undefined) delete process.env.CLOSE_KNIT_API_URL; else process.env.CLOSE_KNIT_API_URL = saved.url;
    if (saved.key === undefined) delete process.env.CLOSE_KNIT_INTERNAL_KEY; else process.env.CLOSE_KNIT_INTERNAL_KEY = saved.key;
    seedCache.clear();
  });
  return reads;
}

test("seed cache: least recently read out first, entries expire", () => {
  let now = 0;
  const cache = new TtlCache<number>(2, 1000, () => now);
  cache.set("a", 1);
  cache.set("b", 2);
  assert.equal(cache.get("a"), 1, "a is now the most recent");
  cache.set("c", 3);
  assert.equal(cache.get("b"), undefined, "b was the least recently read");
  assert.deepEqual([cache.get("a"), cache.get("c"), cache.size], [1, 3, 2]);
  now = 999;
  assert.equal(cache.get("a"), 1);
  now = 1000;
  assert.equal(cache.get("c"), undefined, "expired");
  assert.equal(cache.size, 1);
});

test("a server render is one page view: every API read carries the key and one render id", async (t) => {
  const reads = stubApi(t);
  const seed = await readAreaPageSeed(QUERY, new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }));
  assert.ok(reads.length >= 18, `${reads.length} reads`);
  assert.equal(Object.keys(seed).length, reads.length, "every section read went to the API once");
  const ids = new Set(reads.map((read) => read.headers[RENDER_ID_HEADER]));
  assert.equal(ids.size, 1, "one render id");
  assert.match([...ids][0], /^[0-9a-f-]{36}$/);
  for (const read of reads) {
    assert.equal(read.headers[INTERNAL_KEY_HEADER], KEY, read.url);
    assert.equal(read.headers["x-forwarded-for"], "203.0.113.5", read.url);
  }
  const next = await readAreaPageSeed(QUERY, new Headers({ "x-forwarded-for": "203.0.113.5" }));
  assert.equal(reads.length, Object.keys(seed).length, "a repeat view of the area reads nothing from the API");
  assert.deepEqual(Object.keys(next).sort(), Object.keys(seed).sort());
  await readAreaPageSeed({ ...QUERY, release: "rel-2" }, new Headers());
  // All but the metric list, which the BFF shares for a minute (lib/evidence-service.ts fetchSharedEvidence).
  assert.equal(reads.length, 2 * Object.keys(seed).length - 1, "a new release reads again");
  assert.equal(reads.filter((read) => new URL(read.url).pathname === "/api/v1/metrics").length, 1);
});

test("a read that fails is left to the browser and not kept", async (t) => {
  const reads = stubApi(t, (url) => (url.endsWith("/schools") ? 429 : 200));
  const schools = "/api/v1/areas/uk%3Alsoa%3AE01000001/schools";
  const first = await readAreaPageSeed(QUERY, new Headers());
  assert.ok(!(schools in first), "no seed: the page shows it loading and reads it after hydration");
  const count = reads.length;
  await readAreaPageSeed(QUERY, new Headers());
  assert.deepEqual(reads.slice(count).map((read) => new URL(read.url).pathname), ["/api/v1/areas/uk%3Alsoa%3AE01000001/schools"],
    "only the failed read is tried again");
});

test("render headers need the key; a browser's copy is never passed on", (t) => {
  const saved = process.env.CLOSE_KNIT_INTERNAL_KEY;
  t.after(() => { if (saved === undefined) delete process.env.CLOSE_KNIT_INTERNAL_KEY; else process.env.CLOSE_KNIT_INTERNAL_KEY = saved; });
  delete process.env.CLOSE_KNIT_INTERNAL_KEY;
  assert.deepEqual(renderHeaders("render-1"), {}, "no key configured: nothing sent");
  const forged = new Headers({ "x-forwarded-for": "203.0.113.5", [INTERNAL_KEY_HEADER]: "guess", [RENDER_ID_HEADER]: "render-1" });
  assert.deepEqual(clientHeaders(forged), { "x-forwarded-for": "203.0.113.5" });
  process.env.CLOSE_KNIT_INTERNAL_KEY = KEY;
  assert.deepEqual(clientHeaders(forged), { "x-forwarded-for": "203.0.113.5" }, "a wrong key is dropped");
  assert.deepEqual(renderHeaders(null), {}, "no render, nothing sent");
  const own = new Headers({ [INTERNAL_KEY_HEADER]: KEY, [RENDER_ID_HEADER]: "render-1" });
  assert.deepEqual(clientHeaders(own), { [INTERNAL_KEY_HEADER]: KEY, [RENDER_ID_HEADER]: "render-1" }, "the seed's own reads");
});
