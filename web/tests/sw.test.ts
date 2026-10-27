import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// public/sw.js run in a sandbox with an in-memory CacheStorage: a new build
// ID gets its own cache and drops the old ones; runtime entries are capped.
const SOURCE = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const ORIGIN = "https://getcloseknit.test";

type Entry = { url: string };
/** A page's HTML answer, as addAll stores it. */
function htmlPage(html: string) {
  return { ok: true, headers: { get: (name: string) => (name === "content-type" ? "text/html; charset=utf-8" : null) }, text: async () => html };
}
class MemoryCache {
  entries = new Map<string, unknown>();
  constructor(private pages: Record<string, string> = {}) {}
  async put(request: Entry | string, response: unknown) {
    const url = typeof request === "string" ? request : request.url;
    this.entries.delete(url); // a re-put moves to the end, like a real Cache
    this.entries.set(url, response);
  }
  async addAll(urls: string[]) {
    for (const url of urls) {
      const html = this.pages[new URL(url, ORIGIN).pathname];
      await this.put(new URL(url, ORIGIN).href, html === undefined ? { ok: true } : htmlPage(html));
    }
  }
  async keys() { return [...this.entries.keys()].map((url) => ({ url })); }
  async delete(request: Entry | string) { return this.entries.delete(typeof request === "string" ? request : request.url); }
  async match(request: Entry | string) { return this.entries.get(typeof request === "string" ? request : request.url); }
}

/** `pages`: the HTML the network answers for those paths. */
function memoryCaches(seed: Record<string, string[]> = {}, pages: Record<string, string> = {}) {
  const store = new Map<string, MemoryCache>();
  for (const [name, urls] of Object.entries(seed)) {
    const cache = new MemoryCache();
    for (const url of urls) cache.entries.set(new URL(url, ORIGIN).href, { ok: true });
    store.set(name, cache);
  }
  return {
    store,
    async open(name: string) { if (!store.has(name)) store.set(name, new MemoryCache(pages)); return store.get(name)!; },
    async keys() { return [...store.keys()]; },
    async has(name: string) { return store.has(name); },
    async delete(name: string) { return store.delete(name); },
    async match(request: Entry) {
      for (const cache of store.values()) { const hit = await cache.match(request); if (hit) return hit; }
      return undefined;
    },
  };
}

type Headers = { get(name: string): string | null };
type Fake = { ok: boolean; status: number; body?: unknown; headers?: Headers; clone(): Fake };

/** The parts of Response and Request the worker builds. */
class FakeResponse implements Fake {
  ok: boolean;
  status: number;
  headers: Headers;
  constructor(public body: unknown, init: { status: number; headers: Headers }) {
    this.status = init.status;
    this.ok = init.status >= 200 && init.status < 300;
    this.headers = init.headers;
  }
  clone() { return this; }
  static error() { return { ok: false, status: 0 }; }
}
class FakeRequest { constructor(public url: string) {} }

function loadWorker(search: string, caches = memoryCaches(), fetched: string[] = [], cacheControl = "") {
  const handlers = new Map<string, (event: unknown) => void>();
  const pending: Promise<unknown>[] = [];
  const headers = (extra: Record<string, string> = {}): Headers => ({ get: (name) => (name === "cache-control" ? cacheControl : extra[name] ?? null) });
  const context = vm.createContext({
    self: {
      location: new URL(`/sw.js${search}`, ORIGIN),
      addEventListener: (type: string, handler: (event: unknown) => void) => handlers.set(type, handler),
      skipWaiting() {}, clients: { claim() {} },
    },
    caches, URL, URLSearchParams, Promise, Response: FakeResponse, Request: FakeRequest,
    fetch: async (request: { url: string; headers: Headers }) => {
      const range = request.headers.get("range");
      fetched.push(new URL(request.url).pathname + new URL(request.url).search + (range ? ` ${range}` : ""));
      return new FakeResponse(`body ${range ?? ""}`.trim(), range
        ? { status: 206, headers: headers({ "content-range": `${range.replace("=", " ")}/99999` }) }
        : { status: 200, headers: headers() });
    },
  });
  vm.runInContext(SOURCE, context);
  const fire = async (type: string, extra: object = {}) => {
    handlers.get(type)!({ ...extra, waitUntil: (work: Promise<unknown>) => pending.push(work), respondWith: (work: Promise<unknown>) => pending.push(work) });
    return (await Promise.all(pending.splice(0))).at(-1) as Fake | undefined;
  };
  const get = (path: string, range?: string) => fire("fetch", { request: {
    url: new URL(path, ORIGIN).href, method: "GET", mode: "no-cors", headers: { get: (name: string) => (name === "range" ? range ?? null : null) },
  } });
  return { caches, fire, get, evictable: context.evictable as (urls: string[], limit: number) => string[] };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a new build ID installs its own cache and deletes the old builds' caches", async () => {
  const caches = memoryCaches({
    "close-knit-shell-v3": ["/", "/_next/static/chunks/old-map.js"],
    "close-knit-shell-20261001120000": ["/", "/_next/static/chunks/older.js"],
  });
  const worker = loadWorker("?v=20261010090000", caches);
  await worker.fire("install");
  await worker.fire("activate");
  assert.deepEqual(await caches.keys(), ["close-knit-shell-20261010090000"]);
  const urls = [...caches.store.get("close-knit-shell-20261010090000")!.entries.keys()].map((url) => new URL(url).pathname);
  assert.ok(urls.includes("/") && urls.includes("/guide"));
  assert.ok(!urls.some((path) => path.startsWith("/_next/static/")), "no stale chunks carried over");
});

test("without a build ID the worker still works, under a dev cache", async () => {
  const worker = loadWorker("");
  await worker.fire("install");
  assert.deepEqual(await worker.caches.keys(), ["close-knit-shell-dev"]);
});

test("runtime entries are capped at 60, oldest out first, and the shell is kept", async () => {
  const worker = loadWorker("?v=b2&m=6.7.0");
  await worker.fire("install");
  for (let index = 0; index < 75; index += 1) {
    await worker.get(index % 2 ? `/_next/static/chunks/c${index}.js` : `/icons/i${index}.svg`);
    await settle();
  }
  const paths = [...worker.caches.store.get("close-knit-shell-b2")!.entries.keys()].map((url) => new URL(url).pathname);
  const shell = ["/", "/guide", "/icon.svg", "/maplibre/6.7.0/maplibre-gl-worker.mjs", "/maplibre/6.7.0/maplibre-gl-shared.mjs"];
  assert.deepEqual(paths.filter((path) => shell.includes(path)), shell);
  const runtime = paths.filter((path) => !shell.includes(path));
  assert.equal(runtime.length, 60);
  assert.equal(runtime[0], "/_next/static/chunks/c15.js");
  assert.equal(runtime.at(-1), "/icons/i74.svg");
});

test("install keeps the build files the shell pages name, and the runtime cap never drops them", async () => {
  // As Next writes them: script and stylesheet tags, and the same paths quoted inside the page's data.
  const guide = '<link rel="stylesheet" href="/_next/static/chunks/guide.css"/><script src="/_next/static/chunks/guide.js" async>'
    + '</script><script>self.__next_f.push([1,"[\\"/_next/static/chunks/shared.js\\"]"])</script>';
  const worker = loadWorker("?v=b4", memoryCaches({}, { "/guide": guide }));
  await worker.fire("install");
  const cache = worker.caches.store.get("close-knit-shell-b4")!;
  const kept = ["/_next/static/chunks/guide.css", "/_next/static/chunks/guide.js", "/_next/static/chunks/shared.js"];
  const paths = () => [...cache.entries.keys()].map((url) => new URL(url).pathname);
  assert.deepEqual(paths().filter((path) => path.startsWith("/_next/")), kept);
  for (let index = 0; index < 75; index += 1) {
    await worker.get(`/_next/static/chunks/c${index}.js`);
    await settle();
  }
  assert.ok(kept.every((path) => paths().includes(path)), "the guide still opens offline");
  assert.equal(paths().filter((path) => /\/c\d+\.js$/.test(path)).length, 60);
});

const IMMUTABLE = "public, max-age=31536000, immutable";
const TILE = "/api/v1/tiles/areas/a1-0123456789ab/msoa/11/1023/681.mvt";
const PACK = "/api/v1/value-packs/income/2023-01?mode=real&chunk=E12000007&format=compact&v=rel-2";

test("map data whose URL names its release is served from the worker's cache after the first answer", async () => {
  const fetched: string[] = [];
  const worker = loadWorker("?v=b3", memoryCaches(), fetched, IMMUTABLE);
  for (let round = 0; round < 2; round += 1) {
    await worker.get(TILE);
    await worker.get(PACK);
    await settle();
  }
  assert.deepEqual(fetched, [TILE, PACK], "the second round never reaches the network");
  assert.deepEqual(await worker.caches.keys(), ["close-knit-data-tiles-a1-0123456789ab", "close-knit-data-v-rel-2"]);
});

test("an area tile archive is kept range by range and each range answered again as a 206 from the cache", async () => {
  const archive = "/tiles/areas-0123456789ab-lsoa.pmtiles";
  const fetched: string[] = [];
  const worker = loadWorker("?v=b3", memoryCaches(), fetched, IMMUTABLE);
  const first = await worker.get(archive, "bytes=0-16383");
  await settle();
  const again = await worker.get(archive, "bytes=0-16383");
  await worker.get(archive, "bytes=20000-20999");
  await settle();
  assert.deepEqual(fetched, [`${archive} bytes=0-16383`, `${archive} bytes=20000-20999`], "a range is fetched once");
  assert.equal(first?.status, 206);
  assert.equal(again?.status, 206);
  assert.equal(again?.body, "body bytes=0-16383");
  assert.equal(again?.headers?.get("content-range"), "bytes 0-16383/99999");
  const cache = worker.caches.store.get("close-knit-data-tiles-0123456789ab")!;
  assert.deepEqual([...cache.entries.keys()], [
    `${ORIGIN}${archive}?range=bytes%3D0-16383`, `${ORIGIN}${archive}?range=bytes%3D20000-20999`]);
  assert.equal((cache.entries.get(`${ORIGIN}${archive}?range=bytes%3D0-16383`) as Fake).status, 200, "the Cache API keeps no 206");
});

test("only immutable answers are kept, and an API URL without a release is left to the browser", async () => {
  const fetched: string[] = [];
  const worker = loadWorker("?v=b3", memoryCaches(), fetched, "public, max-age=300");
  await worker.get(PACK);
  await settle();
  await worker.get(PACK);
  await worker.get("/api/v1/map/coverage?release=rel-2");
  assert.deepEqual(fetched, [PACK, PACK], "not immutable: asked again; coverage: not intercepted at all");
  assert.equal(worker.caches.store.get("close-knit-data-v-rel-2")?.entries.size ?? 0, 0);
  // Never immutable (demo data's tiles): no cache is even opened for it.
  assert.deepEqual(await worker.caches.keys(), []);
});

test("a newer release drops the older release's data of its kind; a new build keeps the data", async () => {
  const caches = memoryCaches({
    "close-knit-data-v-rel-1": ["/api/v1/value-packs/income/2023-01?v=rel-1"],
    "close-knit-data-tiles-a1-0123456789ab": [TILE],
    "close-knit-shell-b2": ["/"],
  });
  const worker = loadWorker("?v=b3", caches, [], IMMUTABLE);
  await worker.fire("activate");
  assert.deepEqual(await caches.keys(), ["close-knit-data-v-rel-1", "close-knit-data-tiles-a1-0123456789ab"]);
  await worker.get(PACK);
  await settle();
  await settle();
  assert.deepEqual(await caches.keys(), ["close-knit-data-tiles-a1-0123456789ab", "close-knit-data-v-rel-2"]);
});

test("evictable picks the oldest non-shell URLs beyond the limit", () => {
  const { evictable } = loadWorker("?v=x");
  const urls = ["/", "/a.js", "/guide", "/b.js", "/c.js"].map((path) => new URL(path, ORIGIN).href);
  assert.deepEqual(evictable(urls, 2), [new URL("/a.js", ORIGIN).href]);
  assert.deepEqual(evictable(urls, 3), []);
  assert.deepEqual(evictable(urls, 0).length, 3);
});
