import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";

import { POST } from "../src/app/api/v1/sections/route";
import { AREA_ROUTES } from "../src/lib/area-page-seed";
import { BATCH_PARTS, batchArea, createSectionBatcher, MAX_BATCH, readSectionLines } from "../src/lib/section-batch";
import { INTERNAL_KEY_HEADER, RENDER_ID_HEADER } from "../src/lib/server-render";

// v4 Task 32, round 2: opening the map with a selected area fired 20-odd section reads and several got 429.

const AREA = "/api/v1/areas/uk%3Alsoa%3AE01000001";
const OTHER = "/api/v1/areas/uk%3Alsoa%3AE01000002";

test("a section URL goes in a batch only for one geography and a part the server reads", () => {
  assert.equal(batchArea(`${AREA}/noise`), "uk:lsoa:E01000001");
  assert.equal(batchArea(`${AREA}/noise?uprn=100021`), "uk:lsoa:E01000001");
  assert.equal(batchArea(`${AREA}?metric=price-per-square-metre&period=2026-06`), "uk:lsoa:E01000001", "the area's own evidence");
  assert.equal(batchArea("/api/v1/areas/uk:lad:E09000022/council-tax"), "uk:lad:E09000022");
  assert.equal(batchArea("/api/v1/areas/names?ids=uk%3Alsoa%3AE01000001"), null, "not a geography");
  assert.equal(batchArea("/api/v1/areas/boxes?carrier=lsoa"), null);
  assert.equal(batchArea(`${AREA}/similar`), null, "not a batched part");
  assert.equal(batchArea("/api/v1/properties/123"), null);
  assert.equal(batchArea(`${AREA}/noise/../../tiles`), null);
  assert.equal(batchArea(`${AREA}/noise?${"x".repeat(600)}`), null, "too long");
});

test("every batched part has its route handler on the server", () => {
  for (const part of BATCH_PARTS) assert.equal(typeof AREA_ROUTES[part], "function", part || "(the area)");
});

/** A batcher whose batches and single reads are recorded; `answer` is what the server sends back (null: the batch failed). */
function recorder(answer: (urls: string[]) => Record<string, unknown> | null) {
  const batches: string[][] = [];
  const singles: string[] = [];
  const batcher = createSectionBatcher(
    async (urls, deliver) => {
      batches.push(urls);
      const bodies = answer(urls);
      if (bodies === null) throw new Error("http-503");
      for (const [url, body] of Object.entries(bodies)) deliver(url, body);
    },
    async (url) => { singles.push(url); return new Response(JSON.stringify({ single: url }), { status: 200 }); },
    5,
  );
  return { batcher, batches, singles };
}

test("one area's sections asked for together go in one request; each caller gets its own response", async () => {
  const { batcher, batches, singles } = recorder((urls) => Object.fromEntries(urls.map((url) => [url, url.endsWith("/hmo") ? null : { url }])));
  const urls = [`${AREA}/noise`, `${AREA}/nature`, `${AREA}/kids`, `${AREA}/hmo`];
  const responses = await Promise.all([...urls, `${AREA}/noise`].map((url) => batcher.read(url)));
  assert.deepEqual(batches, [urls], "one batch, each URL once");
  assert.deepEqual(singles, []);
  assert.deepEqual(await responses[0].json(), { url: `${AREA}/noise` });
  assert.deepEqual(await responses[4].json(), { url: `${AREA}/noise` }, "a second caller of the same URL reads its own copy");
  assert.equal(responses[3].status, 404, "null is the server's 404: not here");
});

test("a URL the server left out, a failed batch, a lone URL or a non-section read are read on their own", async () => {
  const left = recorder((urls) => ({ [urls[0]]: { ok: true } }));
  const [first, second] = await Promise.all([left.batcher.read(`${AREA}/noise`), left.batcher.read(`${AREA}/nature`)]);
  assert.deepEqual(await first.json(), { ok: true });
  assert.deepEqual(await second.json(), { single: `${AREA}/nature` });
  const failed = recorder(() => null);
  await Promise.all([failed.batcher.read(`${AREA}/noise`), failed.batcher.read(`${AREA}/nature`)]);
  assert.deepEqual(failed.singles.sort(), [`${AREA}/nature`, `${AREA}/noise`]);
  const lone = recorder(() => ({}));
  await lone.batcher.read(`${AREA}/noise`);
  await lone.batcher.read("/api/v1/metrics");
  assert.deepEqual([lone.batches, lone.singles], [[], [`${AREA}/noise`, "/api/v1/metrics"]]);
});

test("batches are per area and at most MAX_BATCH URLs", async () => {
  const { batcher, batches } = recorder((urls) => Object.fromEntries(urls.map((url) => [url, {}])));
  const many = Array.from({ length: MAX_BATCH + 2 }, (_, index) => `${AREA}/noise?uprn=${index}`);
  await Promise.all([...many, `${OTHER}/noise`, `${OTHER}/kids`].map((url) => batcher.read(url)));
  assert.deepEqual(batches.map((batch) => batch.length).sort((a, b) => a - b), [2, 2, MAX_BATCH]);
});

test("each section is handed over as soon as its line arrives, before the slower ones", async () => {
  let release!: () => void;
  const slow = new Promise<void>((resolve) => { release = resolve; });
  const batcher = createSectionBatcher(async (urls, deliver) => {
    deliver(urls[0], { fast: true });
    await slow;
    deliver(urls[1], { slow: true });
  }, async () => { throw new Error("no single read"); }, 1);
  let slowDone = false;
  const fast = batcher.read(`${AREA}/noise`);
  const late = batcher.read(`${AREA}/schools`).then((response) => { slowDone = true; return response; });
  assert.deepEqual(await (await fast).json(), { fast: true });
  assert.equal(slowDone, false, "the fast section did not wait for the slow one");
  release();
  assert.deepEqual(await (await late).json(), { slow: true });
});

test("the NDJSON reader joins lines cut across chunks and skips a broken one", async () => {
  const text = `{"url":"/a","body":{"n":1}}\n{"url":"/b","bo` + `dy":null}\nnot json\n{"url":"/c","body":[2]}`;
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let start = 0; start < bytes.length; start += 7) controller.enqueue(bytes.slice(start, start + 7));
      controller.close();
    },
  });
  const seen: [string, unknown][] = [];
  await readSectionLines(stream, (url, body) => seen.push([url, body]));
  assert.deepEqual(seen, [["/a", { n: 1 }], ["/b", null], ["/c", [2]]]);
});

const KEY = "k".repeat(64);

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(new NextRequest("http://web.test/api/v1/sections", {
    method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers },
  }));
}

test("the server reads a batch as one render: one API page view for all of an area's sections", async (t) => {
  const saved = { url: process.env.CLOSE_KNIT_API_URL, key: process.env.CLOSE_KNIT_INTERNAL_KEY, fetch: globalThis.fetch };
  process.env.CLOSE_KNIT_API_URL = "http://api.test";
  process.env.CLOSE_KNIT_INTERNAL_KEY = KEY;
  const reads: { url: string; headers: Record<string, string> }[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    reads.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    const status = String(url).endsWith("/hmo") ? 404 : String(url).endsWith("/kids") ? 503 : 200;
    return new Response(JSON.stringify({ read: new URL(String(url)).pathname }), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = saved.fetch;
    if (saved.url === undefined) delete process.env.CLOSE_KNIT_API_URL; else process.env.CLOSE_KNIT_API_URL = saved.url;
    if (saved.key === undefined) delete process.env.CLOSE_KNIT_INTERNAL_KEY; else process.env.CLOSE_KNIT_INTERNAL_KEY = saved.key;
  });
  const urls = [`${AREA}/noise`, `${AREA}/hmo`, `${AREA}/kids`, `${AREA}/council-tax`, `${AREA}/short-lets`];
  const response = await post({ urls }, { "x-forwarded-for": "203.0.113.5", [INTERNAL_KEY_HEADER]: "forged", [RENDER_ID_HEADER]: "abcdefgh-1" });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(response.headers.get("content-type") ?? "", /ndjson/);
  const sections: Record<string, unknown> = {};
  await readSectionLines(response.body!, (url, body) => { sections[url] = body; });
  assert.deepEqual(sections[`${AREA}/noise`], { read: "/api/v1/areas/uk%3Alsoa%3AE01000001/noise" });
  assert.equal(sections[`${AREA}/hmo`], null, "a 404 is a definite 'not here'");
  assert.ok(!(`${AREA}/kids` in sections), "a failed read is left to the browser");
  assert.equal(reads.length, urls.length);
  const ids = new Set(reads.map((read) => read.headers[RENDER_ID_HEADER]));
  assert.equal(ids.size, 1, "one render id for the batch");
  assert.notEqual([...ids][0], "abcdefgh-1", "never the browser's own id");
  for (const read of reads) {
    assert.equal(read.headers[INTERNAL_KEY_HEADER], KEY, "the server's key, not the forged one");
    assert.equal(read.headers["x-forwarded-for"], "203.0.113.5", "charged to the viewer");
  }
});

test("a batch is one area's sections only: anything else is refused before any read", async () => {
  for (const body of [
    {}, { urls: [] }, { urls: "x" }, { urls: [1, 2] },
    { urls: [`${AREA}/noise`, `${OTHER}/noise`] },
    { urls: [`${AREA}/noise`, "/api/v1/metrics"] },
    { urls: [`${AREA}/noise`, `${AREA}/similar`] },
    { urls: Array.from({ length: MAX_BATCH + 1 }, (_, index) => `${AREA}/noise?uprn=${index}`) },
  ]) {
    assert.equal((await post(body)).status, 400, JSON.stringify(body).slice(0, 80));
  }
});
