import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { type BrowserContext, type BrowserType, type Page, devices, expect, test } from "@playwright/test";

import { INTRO_DISMISSED_KEY } from "../src/lib/intro-boot";
import type { MetricDefinition } from "../src/lib/contracts";
import { londonOnlyLayers, MAP_TOPIC_GROUPS, type MapTopic, topicLayers } from "../src/lib/map-topics";
import { ANALYTICS_STORAGE_KEY } from "../src/lib/usage";

/**
 * Layer load time per layer and view (perf/layer-load/README.md), two metrics:
 *
 * - open: a cold open (a fresh browser profile: empty HTTP cache, no service worker) and a warm one (the same URL
 *   again in that profile), from navigation start;
 * - switch: in one page per view, every layer picked in the Layers menu as a visitor would, twice (the first switch
 *   and a switch back to it later), from the click.
 *
 * Settled = the map's colours applied (.map-stage data-painting false), MapLibre idle after that, and no same-origin
 * request open for QUIET_MS. Results go to PERF_OUT, one JSON line per layer × view × run (scripts/perf-layers.mjs).
 *
 * - repeat: the service worker on, as a visitor has it: a cold open, then F5 (colouredMs: painted with the fill's tiles
 *   loaded, from navigation start), then one zoom cycle twice (out, in, back): the second may take no area tile from
 *   the network (zoom-cycle run). Budgets PERF_REPEAT_BUDGET_MS (300) and PERF_ZOOM_NETWORK_BUDGET (0).
 *
 * PERF_MODE=open|switch|repeat|both (both: all three). Budgets: PERF_OPEN_BUDGET_MS (1000, warm open), PERF_COLD_BUDGET_MS (1500,
 * cold open), PERF_SWITCH_BUDGET_MS (1000, switch again); PERF_STRICT_OPEN=1 / PERF_STRICT_COLD=1 /
 * PERF_STRICT_SWITCH=1 fail over budget (PERF_STRICT=1: all three), each on its PERF_STRICT_OPEN_VIEWS /
 * PERF_STRICT_COLD_VIEWS / PERF_STRICT_SWITCH_VIEWS only (default every view; npm run perf:layers sets its own),
 * otherwise over-budget is only reported. Filters: PERF_LAYERS=crime,income  PERF_VIEWS=london  PERF_ALL_LAYERS=1.
 */

const OUT = process.env.PERF_OUT ?? "test-results/layer-load.jsonl";
const MODE = process.env.PERF_MODE ?? "both";
const OPEN_BUDGET_MS = Number(process.env.PERF_OPEN_BUDGET_MS ?? 1000);
const COLD_BUDGET_MS = Number(process.env.PERF_COLD_BUDGET_MS ?? 1500);
const SWITCH_BUDGET_MS = Number(process.env.PERF_SWITCH_BUDGET_MS ?? 1000);
const STRICT_OPEN = process.env.PERF_STRICT === "1" || process.env.PERF_STRICT_OPEN === "1";
const STRICT_COLD = process.env.PERF_STRICT === "1" || process.env.PERF_STRICT_COLD === "1";
const STRICT_SWITCH = process.env.PERF_STRICT === "1" || process.env.PERF_STRICT_SWITCH === "1";
// The views each strict budget holds on (PERF_STRICT_*_VIEWS, default every view).
const strictViews = (value: string | undefined) => new Set((value ?? "london,england,manchester").split(","));
const STRICT_OPEN_VIEWS = strictViews(process.env.PERF_STRICT_OPEN_VIEWS);
const STRICT_COLD_VIEWS = strictViews(process.env.PERF_STRICT_COLD_VIEWS);
const STRICT_SWITCH_VIEWS = strictViews(process.env.PERF_STRICT_SWITCH_VIEWS);
// Repeat visit (F5, service worker on): colours within 300 ms of navigation start, and no area tile seen before
// taken from the network again in a zoom cycle. PERF_REPEAT_LAYERS: the layers it runs for (each a fresh profile).
const REPEAT_BUDGET_MS = Number(process.env.PERF_REPEAT_BUDGET_MS ?? 300);
const ZOOM_NETWORK_BUDGET = Number(process.env.PERF_ZOOM_NETWORK_BUDGET ?? 0);
const STRICT_REPEAT = process.env.PERF_STRICT === "1" || process.env.PERF_STRICT_REPEAT === "1";
const STRICT_ZOOM = process.env.PERF_STRICT === "1" || process.env.PERF_STRICT_ZOOM === "1";
const STRICT_REPEAT_VIEWS = strictViews(process.env.PERF_STRICT_REPEAT_VIEWS);
const REPEAT_LAYERS = new Set((process.env.PERF_REPEAT_LAYERS ?? "typical-price,crime,income").split(",").map((layer) => layer.trim()));
// The API's tile URLs, or a static archive's Range requests (one per tile, after its header): both count as tiles.
const AREA_TILE = /\/api\/v1\/tiles\/areas\/|\/tiles\/areas-[0-9a-f]+-\w+\.pmtiles$/;
const LOAD_TIMEOUT_MS = Number(process.env.PERF_TIMEOUT_MS ?? 90_000);
const PAUSE_MS = Number(process.env.PERF_PAUSE_MS ?? 1000);
// Settled means: painted, idle and no request open for this long (a late coverage or piece request repaints).
const QUIET_MS = 750;
// How the browser draws the map. "gpu" (default since 2026-10-23, phase C): Chromium's new headless mode, which
// draws WebGL on the machine's GPU as a visitor's browser does. "swiftshader": the headless shell, which draws it
// on the CPU (SwiftShader); every run before phase C used it, and its first frames alone cost about a second.
const GL = process.env.PERF_GL === "swiftshader" ? "swiftshader" : "gpu";

export const VIEWS = {
  london: { lat: 51.5074, lng: -0.1278, zoom: 11 },
  england: { lat: 52.9, lng: -1.5, zoom: 6 },
  manchester: { lat: 53.4808, lng: -2.2426, zoom: 11 },
} as const;
type ViewId = keyof typeof VIEWS;
type Run = "cold" | "warm" | "switch" | "switch-again" | "repeat" | "zoom-cycle";

/** How a visitor reaches a layer in the Layers menu: its item, then a view chip or a pick. */
interface Route {
  layer: string;
  item: MapTopic;
  view?: string;
  pick?: { id: string; label: string };
}

/**
 * The layers the Layers menu offers: each item's own layer and its views, and the first of a long pick list
 * (Country of birth's 236 countries are one mechanism; PERF_ALL_LAYERS=1 measures them all, open only).
 */
function catalog(): Route[] {
  const all = process.env.PERF_ALL_LAYERS === "1";
  const routes = new Map<string, Route>();
  const add = (route: Route) => { if (route.layer !== "personal-match" && !routes.has(route.layer)) routes.set(route.layer, route); };
  for (const item of MAP_TOPIC_GROUPS.flatMap((group) => group.items)) {
    if (item.layer) add({ layer: item.layer, item });
    for (const view of item.views ?? []) if (view.layer) add({ layer: view.layer, item, view: view.id });
    const picks = item.picks?.options ?? [];
    for (const option of all ? picks : picks.slice(0, 1)) if (option.layer) add({ layer: option.layer, item, pick: { id: option.id, label: option.label } });
    if (all) for (const layer of topicLayers(item)) add({ layer, item });
  }
  return [...routes.values()];
}

function only(name: string): Set<string> | null {
  const value = process.env[name];
  return value ? new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean)) : null;
}

const layerFilter = only("PERF_LAYERS");
const viewFilter = only("PERF_VIEWS");
const ROUTES = catalog().filter((route) => !layerFilter || layerFilter.has(route.layer));
const VIEW_IDS = (Object.keys(VIEWS) as ViewId[]).filter((view) => !viewFilter || viewFilter.has(view));

let published: Promise<Set<string> | null> | null = null;
/** The layers with London's data alone, by the catalogue's coverage (filled with the metric ids). */
let londonOnly = new Set<string>();

/** The release's metric ids (null when the catalogue is unreachable: then every layer is tried). */
function publishedMetrics(baseURL: string): Promise<Set<string> | null> {
  published ??= fetch(new URL("/api/v1/metrics", baseURL))
    .then(async (response) => {
      if (!response.ok) return null;
      const body = await response.json() as { metrics?: Pick<MetricDefinition, "id" | "coverage">[] };
      londonOnly = londonOnlyLayers(body.metrics ?? []);
      return new Set((body.metrics ?? []).map((metric) => metric.id));
    })
    .catch(() => null);
  return published;
}

/** Custom criteria (counted from places) and detail layers (tiles) are not metrics in the catalogue. */
function isPublished(layer: string, metrics: Set<string> | null): boolean {
  if (!metrics || layer.startsWith("custom:") || layer === "canopy" || layer === "green-streets") return true;
  return metrics.has(layer);
}

interface RequestEntry {
  url: string;
  startMs: number;
  ms: number;
  ttfbMs: number;
  bytes: number;
  decodedBytes: number;
  status: number;
}

interface RunResult {
  layer: string;
  view: ViewId;
  run: Run;
  status: "ok" | "timeout" | "error" | "unpublished";
  /** How the map was drawn (GL). */
  gl?: string;
  ms: number | null;
  paintedMs: number | null;
  /** The app's own record (lib/layer-load-timing.ts), on builds that have it. */
  hookMs: number | null;
  /** Main-thread tasks over 50 ms during the measurement, and their total. */
  longTasks: number;
  longTaskMs: number;
  shownLayer: string | null;
  londonOnly: boolean;
  requests: number;
  bytes: number;
  apiRequests: number;
  apiBytes: number;
  failedRequests: number;
  slowest: RequestEntry[];
  error?: string;
  at: string;
  /** Repeat run: painted and the fill's tiles loaded, from navigation start (the repeat budget's figure). */
  colouredMs?: number | null;
  /** Zoom-cycle run: area-tile requests in the first and second cycle, and the second's that crossed the network. */
  zoom?: { zooms: number[]; firstTiles: number; firstNetwork: number; secondTiles: number; secondNetwork: number; network: string[] };
}

function write(result: RunResult) {
  mkdirSync(dirname(OUT), { recursive: true });
  appendFileSync(OUT, `${JSON.stringify(result)}\n`);
}

function skipped(layer: string, view: ViewId, run: Run): RunResult {
  return {
    layer, view, run, status: "unpublished", ms: null, paintedMs: null, hookMs: null, longTasks: 0, longTaskMs: 0,
    shownLayer: null, londonOnly: londonOnly.has(layer), requests: 0, bytes: 0, apiRequests: 0, apiBytes: 0,
    failedRequests: 0, slowest: [], at: new Date().toISOString(),
  };
}

function viewUrl(layer: string, view: ViewId): string {
  const { lat, lng, zoom } = VIEWS[view];
  const query = new URLSearchParams({ layer, lat: String(lat), lng: String(lng), zoom: String(zoom), diagnostics: "1" });
  return `/?${query}`;
}

/** Watches the map from the first script: when the colours settle and when MapLibre goes idle after that. */
function installWatcher() {
  const perf = { paintedAt: null as number | null, idleAt: null as number | null, colouredAt: null as number | null, longTasks: 0, longTaskMs: 0, longSince: 0, switching: false };
  (window as unknown as { __ckPerf: typeof perf }).__ckPerf = perf;
  performance.setResourceTimingBufferSize(10_000);
  try {
    // Main-thread work over 50 ms (parsing packs, building shapes): where time goes besides the network.
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.startTime < perf.longSince) continue;
        perf.longTasks += 1;
        perf.longTaskMs += entry.duration;
      }
    }).observe({ type: "longtask", buffered: true });
  } catch {
    // No Long Tasks API: the counts stay 0.
  }
  type IdleMap = {
    on(type: string, listener: () => void): void; triggerRepaint(): void;
    getLayer(id: string): { source?: string } | undefined; isSourceLoaded(id: string): boolean;
  };
  let map: IdleMap | null = null;
  let stage: Element | null = null;
  const onIdle = () => {
    // An open ends at the first idle once painted. A switch takes every idle while painted: one that never flips
    // data-painting (a tile layer) still ends at the idle after its tiles.
    if (perf.paintedAt !== null && (perf.idleAt === null || perf.switching) && stage?.getAttribute("data-painting") === "false") {
      perf.idleAt = performance.now();
    }
  };
  // Coloured: painted, and the tiles (or shapes) the fill draws from are loaded, at a frame after that.
  const onRender = () => {
    if (perf.paintedAt === null || perf.colouredAt !== null || !map) return;
    // The drawn kind's tiles (diagnostics since each kind kept its own fill), else the one fill's source.
    const source = (window as unknown as { __closeKnitDiagnostics?: { fillSource?: () => string } }).__closeKnitDiagnostics
      ?.fillSource?.() ?? map.getLayer("area-fill")?.source;
    if (!source || map.isSourceLoaded(source)) perf.colouredAt = performance.now();
  };
  const check = () => {
    stage = document.querySelector(".map-stage");
    const live = (window as unknown as { __closeKnitMap?: IdleMap }).__closeKnitMap;
    if (live && live !== map) {
      map = live;
      map.on("idle", onIdle);
      map.on("render", onRender);
    }
    const painting = stage?.getAttribute("data-painting");
    if (painting === "true") {
      perf.paintedAt = null;
      perf.idleAt = null;
      perf.colouredAt = null;
    } else if (painting === "false" && perf.paintedAt === null) {
      perf.paintedAt = performance.now();
      map?.triggerRepaint();
    }
  };
  new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-painting"] });
}

/**
 * A fresh profile on disk: an empty HTTP cache like a first visit, and a disk cache for the warm run like a
 * returning visitor's (an incognito context's small memory cache drops multi-megabyte answers).
 */
async function openContext(chromium: BrowserType, baseURL: string, serviceWorkers: "allow" | "block" = "block"): Promise<BrowserContext> {
  const profile = mkdtempSync(join(tmpdir(), "ck-layer-load-"));
  const context = await chromium.launchPersistentContext(profile, {
    ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, serviceWorkers, baseURL,
    ...(GL === "gpu" ? { channel: "chromium" } : {}),
  });
  // Full Chromium may still be writing the profile as it closes: retry, and never fail a run over a temp folder.
  context.on("close", () => {
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // Left for the OS to clear from tmpdir.
    }
  });
  await context.addInitScript(({ analytics, intro }) => {
    try {
      localStorage.setItem(analytics, "off");
      localStorage.setItem(intro, "1");
    } catch {
      // Storage blocked: the intro card and analytics then behave as for a first visit.
    }
  }, { analytics: ANALYTICS_STORAGE_KEY, intro: INTRO_DISMISSED_KEY });
  await context.addInitScript(installWatcher);
  return context;
}

/** Counts same-origin requests still open, from now until stop(). */
function openRequests(page: Page, origin: string) {
  let open = 0;
  const onRequest = (request: { url(): string }) => { if (request.url().startsWith(origin)) open += 1; };
  const onDone = (request: { url(): string }) => { if (request.url().startsWith(origin)) open = Math.max(0, open - 1); };
  page.on("request", onRequest);
  page.on("requestfinished", onDone);
  page.on("requestfailed", onDone);
  return {
    count: () => open,
    stop: () => {
      page.off("request", onRequest);
      page.off("requestfinished", onDone);
      page.off("requestfailed", onDone);
    },
  };
}

type PerfState = { paintedAt: number | null; idleAt: number | null };

/** Waits until painted + idle after `since` (page time) with nothing open for QUIET_MS; null on timeout. */
async function settle(page: Page, since: number, open: () => number, timeout = LOAD_TIMEOUT_MS): Promise<{ paintedAt: number; idleAt: number } | null> {
  const deadline = Date.now() + timeout;
  let candidate: { paintedAt: number; idleAt: number; at: number } | null = null;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => (window as unknown as { __ckPerf?: PerfState }).__ckPerf ?? null).catch(() => null);
    const ready = state && state.paintedAt !== null && state.idleAt !== null && state.idleAt > since && open() === 0;
    if (!ready) candidate = null;
    else if (!candidate || candidate.idleAt !== state.idleAt) candidate = { paintedAt: state.paintedAt!, idleAt: state.idleAt!, at: Date.now() };
    else if (Date.now() - candidate.at >= QUIET_MS) return candidate;
    await page.waitForTimeout(50);
  }
  return null;
}

/** What the page fetched since `since` (page time), the app's own timing and the long tasks. */
async function details(page: Page, origin: string, since: number, trigger: "open" | "switch") {
  return page.evaluate(({ origin, since, trigger }) => {
    const entries = (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
      .filter((entry) => entry.name.startsWith(origin) && entry.startTime >= since);
    const perf = (window as unknown as { __ckPerf?: { longTasks: number; longTaskMs: number } }).__ckPerf;
    const hook = ((window as unknown as { __ckLayerTimings?: { trigger: string; startMs: number; ms: number }[] }).__ckLayerTimings ?? [])
      .filter((entry) => entry.trigger === trigger && entry.startMs >= since - 50).at(-1);
    return {
      hookMs: hook?.ms ?? null,
      longTasks: perf?.longTasks ?? 0,
      longTaskMs: Math.round(perf?.longTaskMs ?? 0),
      shownLayer: new URLSearchParams(location.search).get("layer"),
      entries: entries.map((entry) => ({
        url: entry.name.slice(origin.length),
        startMs: Math.round(entry.startTime - since),
        ms: Math.round(entry.responseEnd - entry.startTime),
        ttfbMs: Math.round(entry.responseStart - entry.requestStart),
        bytes: entry.transferSize,
        decodedBytes: entry.decodedBodySize,
        status: (entry as PerformanceResourceTiming & { responseStatus?: number }).responseStatus ?? 0,
      })),
    };
  }, { origin, since, trigger }).catch(() => ({ hookMs: null, longTasks: 0, longTaskMs: 0, shownLayer: null, entries: [] as RequestEntry[] }));
}

function result(layer: string, view: ViewId, run: Run, status: RunResult["status"], since: number,
  settled: { paintedAt: number; idleAt: number } | null, info: Awaited<ReturnType<typeof details>>, error?: string): RunResult {
  const api = info.entries.filter((entry) => entry.url.startsWith("/api/"));
  return {
    layer, view, run, status, gl: GL, londonOnly: londonOnly.has(layer), at: new Date().toISOString(),
    ms: settled ? Math.round(settled.idleAt - since) : null,
    paintedMs: settled ? Math.round(settled.paintedAt - since) : null,
    hookMs: info.hookMs, longTasks: info.longTasks, longTaskMs: info.longTaskMs, shownLayer: info.shownLayer,
    requests: info.entries.length,
    bytes: info.entries.reduce((sum, entry) => sum + entry.bytes, 0),
    apiRequests: api.length,
    apiBytes: api.reduce((sum, entry) => sum + entry.bytes, 0),
    failedRequests: info.entries.filter((entry) => entry.status >= 400).length,
    slowest: [...api].sort((a, b) => b.ms - a.ms).slice(0, 6),
    ...(error ? { error } : {}),
  };
}

/** An open from navigation start: the view's link, or F5 (`reload`, the repeat run); `persist: false` writes no line. */
async function measureOpen(page: Page, origin: string, layer: string, view: ViewId, run: "cold" | "warm" | "repeat",
  { reload = false, persist = true } = {}): Promise<RunResult> {
  const open = openRequests(page, origin);
  let settled: Awaited<ReturnType<typeof settle>> = null;
  let error: string | undefined;
  try {
    if (reload) await page.reload({ waitUntil: "commit", timeout: LOAD_TIMEOUT_MS });
    else await page.goto(viewUrl(layer, view), { waitUntil: "commit", timeout: LOAD_TIMEOUT_MS });
    settled = await settle(page, 0, open.count);
  } catch (caught) {
    error = String(caught).slice(0, 300);
  } finally {
    open.stop();
  }
  const out = result(layer, view, run, error ? "error" : settled ? "ok" : "timeout", 0, settled, await details(page, origin, 0, "open"), error);
  if (run === "repeat") {
    out.colouredMs = await page.evaluate(() => (window as unknown as { __ckPerf?: { colouredAt: number | null } }).__ckPerf?.colouredAt ?? null)
      .then((at) => (at === null ? null : Math.round(at))).catch(() => null);
  }
  if (persist) write(out);
  return out;
}

/** Opens Layers (if closed) and searches for the item, so its button and view chips are on screen. */
async function findItem(page: Page, item: MapTopic) {
  const search = page.getByTestId("topic-search");
  if (!(await search.isVisible())) await page.getByTestId("layers-toggle").click();
  if ((await search.inputValue()) !== item.label) await search.fill(item.label);
}

/** The control that switches to the route's layer (after any step that must come first, untimed). */
async function switchTarget(page: Page, route: Route, origin: string) {
  await findItem(page, route.item);
  if (route.pick || route.view) {
    // View chips and pick lists show under their item once the item is on the map: put it there first (not timed),
    // unless it already is (its chips or pick search are on screen).
    const shown = route.pick ? page.getByTestId("topic-picks-search") : page.getByTestId(`view-${route.item.id}-${route.view}`);
    const itemButton = route.item.layer ? page.getByTestId(`layer-${route.item.layer}`).filter({ visible: true }).first() : null;
    const folded = page.getByTestId(`views-more-${route.item.id}`);
    if (itemButton && !(await shown.filter({ visible: true }).count()) && !(await folded.filter({ visible: true }).count())) {
      const since = await page.evaluate(() => {
        const perf = (window as unknown as { __ckPerf?: Record<string, unknown> }).__ckPerf;
        if (perf) Object.assign(perf, { switching: true, idleAt: null });
        return performance.now();
      });
      const open = openRequests(page, origin);
      await itemButton.click();
      await settle(page, since, open.count, 30_000);
      open.stop();
    }
    // In the search results the item on the map shows its view chips and pick list.
    await findItem(page, route.item);
  }
  if (route.pick) {
    await page.getByTestId("topic-picks-search").filter({ visible: true }).first().fill(route.pick.label);
    return page.getByTestId(`pick-${route.pick.id}`).filter({ visible: true }).first();
  }
  if (route.view) {
    const chip = page.getByTestId(`view-${route.item.id}-${route.view}`).filter({ visible: true }).first();
    if (!(await chip.isVisible().catch(() => false))) {
      const more = page.getByTestId(`views-more-${route.item.id}`).filter({ visible: true }).first();
      if (await more.isVisible().catch(() => false)) await more.click();
    }
    return chip;
  }
  return page.getByTestId(`layer-${route.layer}`).filter({ visible: true }).first();
}

async function measureSwitch(page: Page, origin: string, route: Route, view: ViewId, run: "switch" | "switch-again"): Promise<RunResult> {
  let error: string | undefined;
  let settled: Awaited<ReturnType<typeof settle>> = null;
  let since = 0;
  try {
    const target = await switchTarget(page, route, origin);
    await target.waitFor({ timeout: 10_000 });
    since = await page.evaluate(() => {
      const now = performance.now();
      const perf = (window as unknown as { __ckPerf?: Record<string, unknown> }).__ckPerf;
      if (perf) Object.assign(perf, { longTasks: 0, longTaskMs: 0, longSince: now, switching: true, idleAt: null });
      return now;
    });
    const open = openRequests(page, origin);
    await target.click();
    settled = await settle(page, since, open.count);
    open.stop();
  } catch (caught) {
    error = String(caught).slice(0, 300);
  }
  const out = result(route.layer, view, run, error ? "error" : settled ? "ok" : "timeout", since, settled, await details(page, origin, since, "switch"), error);
  write(out);
  return out;
}

if (MODE === "open" || MODE === "both") {
  for (const route of ROUTES) {
    const { layer } = route;
    for (const view of VIEW_IDS) {
      test(`open ${layer} @ ${view}`, async ({ playwright, baseURL }) => {
        if (!isPublished(layer, await publishedMetrics(baseURL!))) {
          for (const run of ["cold", "warm"] as const) write(skipped(layer, view, run));
          test.skip(true, "not in the release's metrics");
          return;
        }
        const context = await openContext(playwright.chromium, baseURL!);
        try {
          const page = context.pages()[0] ?? await context.newPage();
          const origin = new URL(baseURL!).origin;
          const cold = await measureOpen(page, origin, layer, view, "cold");
          await page.waitForTimeout(PAUSE_MS);
          const warm = await measureOpen(page, origin, layer, view, "warm");
          test.info().annotations.push({ type: "layer-load", description: `cold ${cold.ms ?? cold.status} ms, warm ${warm.ms ?? warm.status} ms` });
          if (STRICT_COLD && STRICT_COLD_VIEWS.has(view)) {
            expect(cold.status, `${layer} @ ${view} cold open settled`).toBe("ok");
            expect(cold.ms ?? Infinity, `${layer} @ ${view} cold open within ${COLD_BUDGET_MS} ms`).toBeLessThanOrEqual(COLD_BUDGET_MS);
          }
          if (STRICT_OPEN && STRICT_OPEN_VIEWS.has(view)) {
            expect(warm.status, `${layer} @ ${view} warm open settled`).toBe("ok");
            expect(warm.ms ?? Infinity, `${layer} @ ${view} warm open within ${OPEN_BUDGET_MS} ms`).toBeLessThanOrEqual(OPEN_BUDGET_MS);
          }
        } finally {
          await context.close();
          await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
        }
      });
    }
  }
}

if (MODE === "switch" || MODE === "both") {
  for (const view of VIEW_IDS) {
    test(`switch @ ${view}`, async ({ playwright, baseURL }) => {
      test.setTimeout(ROUTES.length * 2 * (LOAD_TIMEOUT_MS / 3) + 120_000);
      const metrics = await publishedMetrics(baseURL!);
      const routes = ROUTES.filter((route) => isPublished(route.layer, metrics));
      for (const route of ROUTES) if (!routes.includes(route)) for (const run of ["switch", "switch-again"] as const) write(skipped(route.layer, view, run));
      const context = await openContext(playwright.chromium, baseURL!);
      const over: string[] = [];
      try {
        const page = context.pages()[0] ?? await context.newPage();
        const origin = new URL(baseURL!).origin;
        // A layer that is in no route below, so the first route is a real switch.
        const open = openRequests(page, origin);
        await page.goto(viewUrl("noise", view));
        await settle(page, 0, open.count);
        open.stop();
        for (const run of ["switch", "switch-again"] as const) {
          for (const route of routes) {
            const measured = await measureSwitch(page, origin, route, view, run);
            if (run === "switch-again" && (measured.status !== "ok" || (measured.ms ?? Infinity) > SWITCH_BUDGET_MS)) {
              over.push(`${route.layer} ${measured.ms ?? measured.status}`);
            }
            await page.waitForTimeout(Math.min(PAUSE_MS, 300));
          }
        }
      } finally {
        await context.close();
      }
      test.info().annotations.push({ type: "switch-over-budget", description: over.join(", ") || "none" });
      if (STRICT_SWITCH && STRICT_SWITCH_VIEWS.has(view)) expect(over, `switches over ${SWITCH_BUDGET_MS} ms @ ${view}`).toEqual([]);
    });
  }
}

/**
 * Area-tile requests from `mark()` on: those the page or a map worker made (`requests`, whatever answered them), and
 * those that crossed the network (`network`): bytes transferred, by the page or by the service worker's own fetch.
 * One the service worker answered from its cache, or the HTTP cache answered, transfers nothing.
 */
function tileTraffic(context: BrowserContext) {
  let requests = 0;
  let network: string[] = [];
  context.on("requestfinished", async (request) => {
    if (!AREA_TILE.test(request.url())) return;
    if (!request.serviceWorker()) requests += 1;
    const response = await request.response().catch(() => null);
    if (!request.serviceWorker() && response?.fromServiceWorker()) return;
    const sizes = await request.sizes().catch(() => null);
    const range = request.headers().range;
    if (sizes && sizes.responseHeadersSize + sizes.responseBodySize > 0) network.push(new URL(request.url()).pathname + (range ? ` ${range}` : ""));
  });
  return {
    mark: () => { requests = 0; network = []; },
    read: () => ({ requests, network: [...new Set(network)] }),
  };
}

/** Each zoom in turn, settled (painted, idle, nothing open). */
async function zoomCycle(page: Page, origin: string, zooms: number[]) {
  for (const zoom of zooms) {
    const since = await page.evaluate((zoom) => {
      const perf = (window as unknown as { __ckPerf?: Record<string, unknown> }).__ckPerf;
      if (perf) Object.assign(perf, { switching: true, idleAt: null });
      const now = performance.now();
      (window as unknown as { __closeKnitMap: { jumpTo(options: { zoom: number }): void } }).__closeKnitMap.jumpTo({ zoom });
      return now;
    }, zoom);
    const open = openRequests(page, origin);
    await settle(page, since, open.count, 30_000);
    open.stop();
  }
}

if (MODE === "repeat" || MODE === "both") {
  for (const route of ROUTES.filter((entry) => REPEAT_LAYERS.has(entry.layer))) {
    const { layer } = route;
    for (const view of VIEW_IDS) {
      test(`repeat ${layer} @ ${view}`, async ({ playwright, baseURL }) => {
        if (!isPublished(layer, await publishedMetrics(baseURL!))) {
          for (const run of ["repeat", "zoom-cycle"] as const) write(skipped(layer, view, run));
          test.skip(true, "not in the release's metrics");
          return;
        }
        const context = await openContext(playwright.chromium, baseURL!, "allow");
        const traffic = tileTraffic(context);
        try {
          const page = context.pages()[0] ?? await context.newPage();
          const origin = new URL(baseURL!).origin;
          await measureOpen(page, origin, layer, view, "cold", { persist: false });
          // The worker installs on the first visit; what it has not seen yet the HTTP cache still holds.
          await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 15_000 }).catch(() => {});
          await page.waitForTimeout(PAUSE_MS);
          const repeat = await measureOpen(page, origin, layer, view, "repeat", { reload: true });
          // Out three levels, in two past the view, back to it; then the same again.
          const zooms = [Math.max(5, VIEWS[view].zoom - 3), VIEWS[view].zoom + 2, VIEWS[view].zoom];
          traffic.mark();
          await zoomCycle(page, origin, zooms);
          const first = traffic.read();
          traffic.mark();
          await zoomCycle(page, origin, zooms);
          const second = traffic.read();
          write({
            ...skipped(layer, view, "zoom-cycle"), status: "ok", gl: GL,
            zoom: { zooms, firstTiles: first.requests, firstNetwork: first.network.length, secondTiles: second.requests, secondNetwork: second.network.length, network: second.network.slice(0, 20) },
          });
          test.info().annotations.push({ type: "repeat", description: `F5 coloured in ${repeat.colouredMs ?? repeat.status} ms; `
            + `zoom cycle again: ${second.requests} tile requests, ${second.network.length} from the network` });
          if (STRICT_REPEAT && STRICT_REPEAT_VIEWS.has(view)) {
            expect(repeat.colouredMs ?? Infinity, `${layer} @ ${view} F5 coloured within ${REPEAT_BUDGET_MS} ms`).toBeLessThanOrEqual(REPEAT_BUDGET_MS);
          }
          if (STRICT_ZOOM) expect(second.network.length, `${layer} @ ${view} tiles from the network again: ${second.network.join(" ")}`).toBeLessThanOrEqual(ZOOM_NETWORK_BUDGET);
        } finally {
          await context.close();
          await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
        }
      });
    }
  }
}
