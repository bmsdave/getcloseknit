import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { GET } from "../src/app/api/v1/price-scale/route";
import { PRICE_METRIC_ID } from "../src/lib/price-scale";

const ENV_KEY = "CLOSE_KNIT_API_URL";
const previousEnv = process.env[ENV_KEY];
const previousFetch = globalThis.fetch;

function restore() {
  if (previousEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = previousEnv;
  globalThis.fetch = previousFetch;
}

const NUMBERS = Array.from({ length: 100 }, (_, index) => 2000 + index * 200);

/**
 * A fake API: one yearly period with values wide enough for real breaks, read in one go
 * (/api/v1/metric-values) or, with `packsOnly` (an API without that read), as a value pack; records every URL.
 */
function fakeApi(packsOnly = false): string[] {
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.includes("/api/v1/metrics")) return json({ metrics: [{ id: PRICE_METRIC_ID, periods: ["2026-06"] }] });
    if (url.includes("/api/v1/metric-values/")) return packsOnly ? json({ detail: "Not Found" }, 404) : json({ values: { "2026-06": NUMBERS } });
    return json({ values: NUMBERS.map((value) => ({ value })) });
  }) as typeof fetch;
  return urls;
}

function get(query: string) {
  return GET(new NextRequest(`http://web.test/api/v1/price-scale?${query}`));
}

test("unknown modes and odd release ids are refused before any upstream work", async (context) => {
  context.after(restore);
  process.env[ENV_KEY] = "http://api:8080";
  const urls = fakeApi();
  assert.equal((await get("mode=evil&release=r1")).status, 400);
  assert.equal((await get("mode=real&release=%3Cscript%3E")).status, 400);
  assert.equal((await get(`mode=real&release=${"x".repeat(101)}`)).status, 400);
  assert.deepEqual(urls, []);
});

test("with the API configured, demo reads the real scale and only known params go upstream", async (context) => {
  context.after(restore);
  process.env[ENV_KEY] = "http://api:8080";
  const urls = fakeApi();
  const demo = await get("mode=demo&release=rel-2026.10&evil=1");
  assert.equal(demo.status, 200);
  assert.ok(urls.length > 0);
  for (const url of urls) {
    assert.ok(/\?mode=real&release=rel-2026\.10(&periods=2026-06)?$/.test(url), url);
  }
  const seen = urls.length;
  const real = await get("mode=real&release=rel-2026.10");
  assert.deepEqual(await real.json(), await demo.json());
  assert.equal(urls.length, seen, "demo and real share one cached scale");
});

test("the cache keeps at most eight scales", async (context) => {
  context.after(restore);
  process.env[ENV_KEY] = "http://api:8080";
  const urls = fakeApi();
  for (let index = 0; index < 9; index += 1) {
    assert.equal((await get(`mode=real&release=cap-${index}`)).status, 200);
  }
  const before = urls.length;
  await get("mode=real&release=cap-8");
  assert.equal(urls.length, before, "the newest scale is still cached");
  await get("mode=real&release=cap-0");
  assert.ok(urls.length > before, "the oldest scale was dropped and is computed again");
});

test("v4 Task 32: the yearly numbers come in one read, cached a day per release", async (context) => {
  context.after(restore);
  process.env[ENV_KEY] = "http://api:8080";
  const urls = fakeApi();

  const response = await get("mode=real&release=one-read");

  assert.equal(response.status, 200);
  assert.equal(urls.filter((url) => url.includes("/api/v1/value-packs/")).length, 0, "no full packs");
  assert.equal(urls.filter((url) => url.includes("/api/v1/metric-values/price-per-square-metre")).length, 1);
  assert.equal(response.headers.get("cache-control"), "public, max-age=86400");
});

test("an API without the one read (mid-deploy) is asked pack by pack, with the same scale", async (context) => {
  context.after(restore);
  process.env[ENV_KEY] = "http://api:8080";
  const one = await (await (fakeApi(), get("mode=real&release=same-a"))).json();
  const urls = fakeApi(true);

  const packs = await (await get("mode=real&release=same-b")).json();

  assert.ok(urls.some((url) => url.includes("/api/v1/value-packs/price-per-square-metre/2026-06")));
  assert.deepEqual(packs.breaks, one.breaks);
});
