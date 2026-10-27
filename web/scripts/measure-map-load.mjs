#!/usr/bin/env node
/**
 * Cold map-load numbers for v4 Task 32 (faster map loads): for each scenario a fresh browser context
 * (empty cache) opens the page and we record requests, bytes on the wire (encoded) and decoded, the
 * time until the map announces "Map ready", until the network is idle, and the slowest API calls.
 *
 *   node scripts/measure-map-load.mjs http://127.0.0.1:4507 [runs]
 *
 * Point it at a production build (`next build && next start`) with CLOSE_KNIT_API_URL set: the dev
 * server's unminified bundles would swamp the numbers.
 */
import { chromium } from "@playwright/test";

const origin = (process.argv[2] ?? "http://127.0.0.1:4507").replace(/\/+$/, "");
const runs = Number(process.argv[3] ?? 3);
const SCENARIOS = [
  { name: "cold /", path: "/" },
  { name: "zoom-15 deep link", path: "/?selected=uk:lsoa:E01000001&lat=51.5203&lng=-0.0960&zoom=15" },
];

async function measure(browser, path) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  // Skip the first-visit card: it is the same on every run and not what is measured.
  await context.addInitScript(() => { try { localStorage.setItem("close-knit.intro-dismissed.v1", "1"); } catch {} });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  const requests = new Map();
  cdp.on("Network.requestWillBeSent", (event) => {
    requests.set(event.requestId, { url: event.request.url, start: event.timestamp, encoded: 0, decoded: 0, end: null });
  });
  cdp.on("Network.dataReceived", (event) => {
    const entry = requests.get(event.requestId);
    if (entry) entry.decoded += event.dataLength;
  });
  cdp.on("Network.loadingFinished", (event) => {
    const entry = requests.get(event.requestId);
    if (entry) { entry.encoded = event.encodedDataLength; entry.end = event.timestamp; }
  });
  const started = Date.now();
  await page.goto(origin + path, { waitUntil: "domcontentloaded" });
  let ready = null;
  try {
    await page.locator(".map-status").filter({ hasText: "Map ready" }).waitFor({ state: "attached", timeout: 60_000 });
    ready = Date.now() - started;
  } catch { /* never ready: reported as null */ }
  // Builds with the loading state (v4 Task 32) mark the map stage once its colours are painted.
  let painted = null;
  if (await page.locator(".map-stage[data-painting]").count()) {
    await page.locator('.map-stage[data-painting="false"]').waitFor({ state: "attached", timeout: 60_000 }).catch(() => undefined);
    painted = Date.now() - started;
  }
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => undefined);
  const idle = Date.now() - started;
  const list = [...requests.values()];
  // The colours' critical path: both the area boxes and the first value pack have arrived (the tiles load alongside).
  const first = Math.min(...list.map((entry) => entry.start));
  const ended = (part) => list.filter((entry) => entry.url.includes(part) && entry.end).map((entry) => entry.end)[0];
  const shapes = ended("/api/v1/areas/boxes");
  const pack = ended("/api/v1/value-packs/");
  const dataMs = shapes && pack ? Math.round((Math.max(shapes, pack) - first) * 1000) : null;
  const api = list.filter((entry) => /\/api\/v1\//.test(entry.url) && entry.end)
    .map((entry) => ({ url: entry.url.replace(origin, "").replace(/[?&]release=[^&]*/, ""), ms: Math.round((entry.end - entry.start) * 1000), kb: Math.round(entry.encoded / 1024) }))
    .sort((a, b) => b.ms - a.ms);
  const geometry = list.find((entry) => entry.url.includes("/api/v1/areas/boxes"));
  await context.close();
  return {
    requests: list.length,
    encodedMB: list.reduce((sum, entry) => sum + entry.encoded, 0) / 1e6,
    decodedMB: list.reduce((sum, entry) => sum + entry.decoded, 0) / 1e6,
    geometryKB: geometry ? { encoded: Math.round(geometry.encoded / 1024), decoded: Math.round(geometry.decoded / 1024) } : null,
    readyMs: ready,
    dataMs,
    paintedMs: painted,
    idleMs: idle,
    slowest: api.slice(0, 4),
  };
}

const browser = await chromium.launch();
for (const scenario of SCENARIOS) {
  for (let run = 1; run <= runs; run += 1) {
    const result = await measure(browser, scenario.path);
    console.log(JSON.stringify({ scenario: scenario.name, run, ...result }));
  }
}
await browser.close();
