// One cache per build: pwa-registration.tsx registers /sw.js?v=<build id>, so
// a deploy installs a new worker whose activate step drops the old build's
// cache, hashed /_next/static chunks and all.
const BUILD = new URLSearchParams(self.location.search).get("v") || "dev";
const CACHE_NAME = `close-knit-shell-${BUILD}`;
// The MapLibre worker's folder is named by its version (m=, lib/map-core.ts): its files never change.
const MAPLIBRE = new URLSearchParams(self.location.search).get("m");
const SHELL = [
  "/",
  "/guide",
  "/icon.svg",
  ...(MAPLIBRE ? [`/maplibre/${MAPLIBRE}/maplibre-gl-worker.mjs`, `/maplibre/${MAPLIBRE}/maplibre-gl-shared.mjs`] : []),
];
// Pages and assets cached on the way past, beyond the shell.
const RUNTIME_LIMIT = 60;
// Map data whose URL names its release (an area tile's /tiles/areas/<release>/, a value pack's or box set's ?v=)
// never changes: it is served from here first, so a repeat visit or a zoom back costs no round trip even after the
// HTTP cache let it go (perf/layer-load/README.md). One cache per release, kept apart from the build's: a newer
// release's first answer drops the older ones of its kind. Only answers the server calls immutable are kept.
const DATA_PREFIX = "close-knit-data-";
const DATA_LIMIT = 4000;

/** The data cache a request belongs to ("tiles-<release>" or "v-<release>"), or null when its URL names no release. */
function dataCacheKey(url) {
  const tile = /^\/api\/v1\/tiles\/areas\/([^/]+)\//.exec(url.pathname) ?? /^\/tiles\/areas-([0-9a-f]+)-\w+\.pmtiles$/.exec(url.pathname);
  if (tile) return `tiles-${tile[1]}`;
  const version = url.searchParams.get("v");
  return version && url.pathname.startsWith("/api/") ? `v-${version}` : null;
}

const pruned = new Set();
let dataPuts = 0;

async function putData(key, request, response) {
  const name = DATA_PREFIX + key;
  const cache = await caches.open(name);
  await cache.put(request, response);
  // The first answer of a release in this worker's life drops the other releases of its kind.
  if (!pruned.has(key)) {
    pruned.add(key);
    const kind = DATA_PREFIX + key.split("-")[0] + "-";
    const names = await caches.keys();
    await Promise.all(names.filter((other) => other.startsWith(kind) && other !== name).map((other) => caches.delete(other)));
  }
  // A bound on the device's storage, checked now and then: the oldest go first.
  if (++dataPuts % 200 === 0) {
    const keys = await cache.keys();
    await Promise.all(keys.slice(0, Math.max(0, keys.length - DATA_LIMIT)).map((entry) => cache.delete(entry)));
  }
}

// A Range request (an area tile archive's header or one tile, read by the pmtiles protocol) is kept under its URL and
// range: the Cache API holds no partial (206) answer, so the bytes are stored as a 200 and given back as the 206.
function rangeEntry(request) {
  const range = request.headers.get("range");
  return range ? new Request(`${request.url}?range=${encodeURIComponent(range)}`) : null;
}

async function cachedData(key, request) {
  // Opened only when it exists: a release that never answered immutable (demo data's tiles) leaves no cache behind.
  const name = DATA_PREFIX + key;
  const ranged = rangeEntry(request);
  const cached = (await caches.has(name)) ? await caches.open(name).then((cache) => cache.match(ranged ?? request)) : undefined;
  if (cached) return ranged ? new Response(cached.body, { status: 206, headers: cached.headers }) : cached;
  const response = await fetch(request);
  if ((ranged ? response.status === 206 : response.ok) && /\bimmutable\b/.test(response.headers.get("cache-control") ?? "")) {
    const copy = response.clone();
    const entry = ranged ? new Response(copy.body, { status: 200, headers: copy.headers }) : copy;
    void putData(key, ranged ?? request, entry).catch(() => {});
  }
  return response;
}

// The build files (scripts, styles, fonts) the shell pages' HTML names. Offline, a shell page whose own script is
// missing runs the shared ones, fails on its own and shows the error page instead of its server-rendered content.
// Read from the cached pages, which only install writes: once per worker.
let shellAssets = null;
function shellAssetUrls(cache) {
  shellAssets ??= (async () => {
    const assets = new Set();
    for (const path of SHELL) {
      const page = await cache.match(new URL(path, self.location.origin).href);
      if (!(page?.headers?.get("content-type") ?? "").includes("text/html")) continue;
      for (const [asset] of (await page.text()).matchAll(/\/_next\/static\/[^"'\\\s)]+/g)) {
        assets.add(new URL(asset, self.location.origin).href);
      }
    }
    return [...assets];
  })();
  return shellAssets;
}

/** Cached URLs to delete, oldest first, so at most `limit` entries remain beyond the shell and its build files. */
function evictable(urls, limit, kept = []) {
  const runtime = urls.filter((url) => !SHELL.includes(new URL(url).pathname) && !kept.includes(url));
  return runtime.slice(0, Math.max(0, runtime.length - limit));
}

async function putCapped(request, response) {
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response);
  const keys = await cache.keys();
  const kept = await shellAssetUrls(cache);
  await Promise.all(evictable(keys.map((key) => key.url), RUNTIME_LIMIT, kept).map((url) => cache.delete(url)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(async (cache) => {
    await cache.addAll(SHELL);
    await cache.addAll(await shellAssetUrls(cache));
  }));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME && !key.startsWith(DATA_PREFIX)).map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  const data = dataCacheKey(url);
  if (data) {
    event.respondWith(cachedData(data, event.request));
    return;
  }
  if (url.pathname.startsWith("/api/")) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(async () => (
      await caches.match(event.request) ?? caches.match("/")
    )));
    return;
  }
  // Only content-hashed build assets and the versioned MapLibre worker are safe to
  // serve cache-first; anything else (icons) goes to the network first so a deploy
  // is never masked by an old copy, and falls back to the cache offline.
  if (url.pathname.startsWith("/_next/static/") || /^\/maplibre\/\d[^/]*\//.test(url.pathname)) {
    event.respondWith(caches.match(event.request).then(async (cached) => {
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response.ok) void putCapped(event.request, response.clone());
      return response;
    }));
    return;
  }
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok) void putCapped(event.request, response.clone());
    return response;
  }).catch(async () => (await caches.match(event.request)) ?? Response.error()));
});
