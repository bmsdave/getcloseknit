import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { type BrowserContext, type BrowserType, type CDPSession, type Page, devices, expect, test } from "@playwright/test";

import { INTRO_DISMISSED_KEY } from "../src/lib/intro-boot";
import { ANALYTICS_STORAGE_KEY } from "../src/lib/usage";

/**
 * Map interaction smoothness (perf/layer-load/README.md, "Interaction"): how the map keeps up while a visitor drags,
 * wheels and flies it, per view × layer, on the machine's GPU (Chromium's new headless mode, as layer-load.spec.ts).
 *
 * Per gesture (pan: three 600 px drags of 1 s each; zoom: the wheel across z6 ↔ z11 and back; fly: one flyTo):
 * frame times (requestAnimationFrame deltas) p50/p95/p99, dropped frames, long tasks (count, total, max) during the
 * gesture and after it until settled, main-thread busy % (CDP TaskDuration), DOM mutations (React re-renders),
 * GeoJSON setData calls, tile requests, the time from the gesture's end to settled (painted, idle, no request open)
 * and the JS heap. After the view settles: what is on the map (sources, layers, polygons, lines, points, vertices:
 * loaded and rendered) — see census() below.
 *
 * Budgets: frame p95 ≤ PERF_FRAME_P95_MS (33), p50 ≤ PERF_FRAME_P50_MS (17), no long task over PERF_LONG_TASK_MS
 * (100) during a gesture. PERF_STRICT_INTERACTION=1 (npm run perf:interaction's default) fails over budget; 0 only reports.
 * Filters: PERF_VIEWS=london-z11  PERF_LAYERS=crime  PERF_GESTURES=pan,zoom,fly. PERF_TRACE=<view>/<layer>/<gesture>
 * records a Chrome trace of that gesture to PERF_TRACE_OUT (default test-results/interaction-trace.json).
 */

const OUT = process.env.PERF_OUT ?? "test-results/map-interaction.jsonl";
const P95_BUDGET = Number(process.env.PERF_FRAME_P95_MS ?? 33);
const P50_BUDGET = Number(process.env.PERF_FRAME_P50_MS ?? 17);
const LONG_BUDGET = Number(process.env.PERF_LONG_TASK_MS ?? 100);
const STRICT = process.env.PERF_STRICT_INTERACTION === "1";
const LOAD_TIMEOUT_MS = Number(process.env.PERF_TIMEOUT_MS ?? 90_000);
const QUIET_MS = 500;
const GL = process.env.PERF_GL === "swiftshader" ? "swiftshader" : "gpu";
const TRACE = process.env.PERF_TRACE ?? "";
const TRACE_OUT = process.env.PERF_TRACE_OUT ?? "test-results/interaction-trace.json";
// A slower machine than the one measuring: CDP CPU throttling (4 ≈ a mid-range laptop next to an M-series Mac).
const CPU = Number(process.env.PERF_CPU_THROTTLE ?? 1);
// Device pixels per CSS pixel: 2 draws a Retina laptop's canvas (four times the pixels of the default 1).
const DPR = Number(process.env.PERF_DPR ?? 1);

export const INTERACTION_VIEWS = {
  "london-z11": { lat: 51.5074, lng: -0.1278, zoom: 11 },
  "london-z9.6": { lat: 51.5074, lng: -0.1278, zoom: 9.6 },
  "england-z6": { lat: 52.9, lng: -1.5, zoom: 6 },
  "england-z7.5": { lat: 52.9, lng: -1.5, zoom: 7.5 },
  "manchester-z11": { lat: 53.4808, lng: -2.2426, zoom: 11 },
} as const;
type ViewId = keyof typeof INTERACTION_VIEWS;

/** Price, crime, a census layer, a custom place layer, and price on the reader's own range (lib/legend-range.ts). */
const LAYERS: { id: string; layer: string; query?: Record<string, string> }[] = [
  { id: "typical-price", layer: "typical-price" },
  { id: "crime", layer: "crime" },
  { id: "census-accommodation-flat", layer: "census-accommodation-flat" },
  { id: "custom:good-coffee", layer: "custom:good-coffee" },
  { id: "typical-price+range", layer: "typical-price", query: { range: "300000,900000" } },
];
type Gesture = "pan" | "zoom" | "fly";
const GESTURES: Gesture[] = ["pan", "zoom", "fly"];

function only(name: string): Set<string> | null {
  const value = process.env[name];
  return value ? new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean)) : null;
}
const viewFilter = only("PERF_VIEWS");
const layerFilter = only("PERF_LAYERS");
const gestureFilter = only("PERF_GESTURES");

function viewUrl(layer: (typeof LAYERS)[number], view: ViewId): string {
  const { lat, lng, zoom } = INTERACTION_VIEWS[view];
  return `/?${new URLSearchParams({ layer: layer.layer, lat: String(lat), lng: String(lng), zoom: String(zoom), diagnostics: "1", ...layer.query })}`;
}

/** In the page from the first script: long tasks, setData calls, DOM mutations, and a frame recorder. */
function installRecorder() {
  const rec = {
    longTasks: [] as { start: number; duration: number }[],
    setData: [] as { at: number; source: string }[],
    mutations: 0,
    frames: [] as number[],
    recording: false,
    paintedAt: null as number | null,
    idleAt: null as number | null,
  };
  (window as unknown as { __ckRec: typeof rec }).__ckRec = rec;
  performance.setResourceTimingBufferSize(20_000);
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) rec.longTasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: "longtask", buffered: true });
  } catch {
    // No Long Tasks API.
  }
  const frame = (now: number) => {
    if (rec.recording) rec.frames.push(now);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  type Live = { on(type: string, listener: () => void): void; getSource(id: string): unknown; triggerRepaint(): void };
  let map: Live | null = null;
  let wrapped = false;
  const check = () => {
    const live = (window as unknown as { __closeKnitMap?: Live }).__closeKnitMap;
    if (live && live !== map) {
      map = live;
      map.on("idle", () => {
        if (document.querySelector(".map-stage")?.getAttribute("data-painting") === "false") rec.idleAt = performance.now();
      });
    }
    if (map && !wrapped) {
      // Every GeoJSON source shares the prototype: one wrapper counts setData on all of them.
      const style = (map as unknown as { style?: { sourceCaches?: Record<string, unknown>; tileManagers?: Record<string, { getSource(): unknown }> } }).style;
      const any = Object.values(style?.tileManagers ?? {}).map((manager) => manager.getSource())
        .find((source) => (source as { type?: string }).type === "geojson") as { setData?: unknown; id: string } | undefined;
      if (any) {
        // setData (every feature again) and updateData (a diff), counted apart.
        const proto = Object.getPrototypeOf(any) as Record<"setData" | "updateData", (...args: unknown[]) => unknown>;
        for (const method of ["setData", "updateData"] as const) {
          const original = proto[method];
          proto[method] = function (this: { id: string }, ...args: unknown[]) {
            rec.setData.push({ at: performance.now(), source: method === "setData" ? this.id : `${this.id}:diff` });
            return original.apply(this, args);
          };
        }
        wrapped = true;
      }
    }
    const painting = document.querySelector(".map-stage")?.getAttribute("data-painting");
    if (painting === "true") { rec.paintedAt = null; rec.idleAt = null; }
    else if (painting === "false" && rec.paintedAt === null) { rec.paintedAt = performance.now(); map?.triggerRepaint(); }
  };
  new MutationObserver((records) => {
    if (rec.recording) rec.mutations += records.length;
    check();
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  setInterval(check, 250);
}

async function openContext(chromium: BrowserType, baseURL: string): Promise<BrowserContext> {
  const profile = mkdtempSync(join(tmpdir(), "ck-interaction-"));
  const context = await chromium.launchPersistentContext(profile, {
    ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, deviceScaleFactor: DPR, serviceWorkers: "block", baseURL,
    ...(GL === "gpu" ? { channel: "chromium" } : {}),
  });
  context.on("close", () => {
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* tmpdir */ }
  });
  await context.addInitScript(({ analytics, intro }) => {
    try { localStorage.setItem(analytics, "off"); localStorage.setItem(intro, "1"); } catch { /* blocked */ }
  }, { analytics: ANALYTICS_STORAGE_KEY, intro: INTRO_DISMISSED_KEY });
  await context.addInitScript(installRecorder);
  return context;
}

/** Same-origin requests still open. */
function openRequests(page: Page, origin: string) {
  let open = 0;
  const onRequest = (request: { url(): string }) => { if (request.url().startsWith(origin)) open += 1; };
  const onDone = (request: { url(): string }) => { if (request.url().startsWith(origin)) open = Math.max(0, open - 1); };
  page.on("request", onRequest);
  page.on("requestfinished", onDone);
  page.on("requestfailed", onDone);
  return { count: () => open, stop: () => { page.off("request", onRequest); page.off("requestfinished", onDone); page.off("requestfailed", onDone); } };
}

/** Painted, MapLibre idle after `since`, nothing open for QUIET_MS; the idle time (page clock) or null. */
async function settle(page: Page, since: number, open: () => number, timeout = LOAD_TIMEOUT_MS): Promise<number | null> {
  const deadline = Date.now() + timeout;
  let candidate: { idleAt: number; at: number } | null = null;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const rec = (window as unknown as { __ckRec?: { paintedAt: number | null; idleAt: number | null } }).__ckRec;
      const map = (window as unknown as { __closeKnitMap?: { isMoving(): boolean; loaded(): boolean } }).__closeKnitMap;
      return rec ? { paintedAt: rec.paintedAt, idleAt: rec.idleAt, moving: map?.isMoving() ?? true } : null;
    }).catch(() => null);
    const ready = state && state.paintedAt !== null && state.idleAt !== null && state.idleAt > since && !state.moving && open() === 0;
    if (!ready) candidate = null;
    else if (!candidate || candidate.idleAt !== state.idleAt) candidate = { idleAt: state.idleAt!, at: Date.now() };
    else if (Date.now() - candidate.at >= QUIET_MS) return candidate.idleAt;
    await page.waitForTimeout(50);
  }
  return null;
}

async function cdpMetrics(cdp: CDPSession): Promise<Record<string, number>> {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map((entry) => [entry.name, entry.value]));
}

/** Runs one gesture in the page with synthetic input timed by the wall clock (the hand moves whatever the frames do). */
async function runGesture(page: Page, gesture: Gesture, startZoom: number): Promise<{ start: number; end: number; zoomReached: number }> {
  return page.evaluate(async ({ gesture, startZoom }) => {
    type M = {
      getCanvas(): HTMLCanvasElement; getZoom(): number; getCenter(): { lng: number; lat: number };
      getBounds(): { getWest(): number; getEast(): number }; flyTo(options: object): void; once(type: string, cb: () => void): void; isMoving(): boolean;
    };
    const map = (window as unknown as { __closeKnitMap: M }).__closeKnitMap;
    const rec = (window as unknown as { __ckRec: { frames: number[]; mutations: number; recording: boolean } }).__ckRec;
    const canvas = map.getCanvas();
    const box = canvas.getBoundingClientRect();
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitStill = async (limit: number) => {
      const until = performance.now() + limit;
      while (map.isMoving() && performance.now() < until) await sleep(16);
    };
    // A point on the canvas no panel covers, with room to drag 300 px each way.
    const candidates: [number, number][] = [];
    for (let fx = 0.5; fx <= 0.8; fx += 0.05) for (let fy = 0.35; fy <= 0.65; fy += 0.1) candidates.push([box.left + box.width * fx, box.top + box.height * fy]);
    const [cx, cy] = candidates.find(([x, y]) => document.elementFromPoint(x, y) === canvas
      && document.elementFromPoint(x - 300, y) === canvas && document.elementFromPoint(x + 300, y) === canvas) ?? [box.left + box.width / 2, box.top + box.height / 2];
    const mouse = (type: string, x: number, y: number, buttons: number) => canvas.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons, view: window,
    }));
    // Let the hit-testing above (a forced layout) finish in its own task, outside the measurement.
    await sleep(50);
    rec.frames = [];
    rec.mutations = 0;
    rec.recording = true;
    const start = performance.now();
    if (gesture === "pan") {
      // Three drags of 600 px over 1 s each: left, right, left.
      for (const direction of [-1, 1, -1]) {
        const x0 = cx - (direction * 300);
        mouse("mousedown", x0, cy, 1);
        const began = performance.now();
        for (;;) {
          await sleep(16);
          const t = Math.min(1, (performance.now() - began) / 1000);
          mouse("mousemove", x0 + direction * 600 * t, cy + Math.sin(t * Math.PI) * 20, 1);
          if (t >= 1) break;
        }
        mouse("mouseup", x0 + direction * 600, cy, 0);
        await sleep(60);
      }
    } else if (gesture === "zoom") {
      // The wheel (trackpad-sized steps, ~3 zoom levels a second) to the far end of z6 ↔ z11, then back.
      const target = startZoom >= 8.5 ? 6 : 11;
      for (const [goal, sign] of [[target, target > startZoom ? -1 : 1], [startZoom, target > startZoom ? 1 : -1]] as const) {
        const until = performance.now() + 6000;
        while (performance.now() < until && (sign < 0 ? map.getZoom() < goal - 0.05 : map.getZoom() > goal + 0.05)) {
          canvas.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: cx, clientY: cy, deltaY: sign * 7, deltaMode: 0, view: window }));
          await sleep(16);
        }
        await sleep(120);
      }
    } else {
      // A place search: London → Birmingham, Manchester → Leeds, England → London two levels in.
      const center = map.getCenter();
      const [lng, lat, zoom] = center.lat > 53 && map.getZoom() >= 8.5 ? [-1.5491, 53.8008, map.getZoom()]
        : map.getZoom() >= 8.5 ? [-1.8904, 52.4862, map.getZoom()] : [-0.1278, 51.5074, map.getZoom() + 2];
      map.flyTo({ center: [lng, lat], zoom });
      await sleep(50);
    }
    const inputEnd = performance.now();
    // Inertia and eases: the gesture lasts until the camera stops (at most 4 s more).
    await waitStill(4000);
    const end = performance.now();
    rec.recording = false;
    return { start, end: Math.max(end, inputEnd), zoomReached: map.getZoom() };
  }, { gesture, startZoom });
}

interface FrameStats { frames: number; p50: number; p95: number; p99: number; max: number; droppedPct: number; fps: number }

function frameStats(times: number[]): FrameStats {
  const deltas = times.slice(1).map((time, index) => time - times[index]).sort((a, b) => a - b);
  const pick = (q: number) => (deltas.length ? deltas[Math.min(deltas.length - 1, Math.floor(q * deltas.length))] : 0);
  const span = times.length > 1 ? times.at(-1)! - times[0] : 0;
  const expected = span / (1000 / 60);
  const dropped = deltas.reduce((sum, delta) => sum + Math.max(0, Math.round(delta / (1000 / 60)) - 1), 0);
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    frames: times.length, p50: round(pick(0.5)), p95: round(pick(0.95)), p99: round(pick(0.99)), max: round(deltas.at(-1) ?? 0),
    droppedPct: expected ? round((dropped / expected) * 100) : 0, fps: span ? round(((times.length - 1) / span) * 1000) : 0,
  };
}

/** Long tasks, setData calls, tile requests in [from, to) (page clock). */
async function windowStats(page: Page, origin: string, from: number, to: number) {
  return page.evaluate(({ from, to, origin }) => {
    const rec = (window as unknown as { __ckRec: { longTasks: { start: number; duration: number }[]; setData: { at: number; source: string }[]; mutations: number } }).__ckRec;
    const tasks = rec.longTasks.filter((task) => task.start >= from && task.start < to);
    const setData: Record<string, number> = {};
    for (const call of rec.setData) if (call.at >= from && call.at < to) setData[call.source] = (setData[call.source] ?? 0) + 1;
    const resources = (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter((entry) => entry.startTime >= from && entry.startTime < to);
    const kind = (url: string) => {
      const path = url.startsWith(origin) ? url.slice(origin.length) : url;
      if (/\/api\/v1\/tiles\/|\.pbf|\.mvt|\/tiles\//.test(path)) return path.startsWith("/") ? `tiles:${path.split("/").slice(0, 5).join("/").replace(/\/\d+$/, "")}` : `tiles:${new URL(url).host}`;
      if (/\.(png|webp|jpg)/.test(path)) return `raster:${url.startsWith(origin) ? "self" : new URL(url).host}`;
      if (path.startsWith("/api/")) return `api:${path.split("?")[0].split("/").slice(0, 5).join("/")}`;
      return "other";
    };
    const requests: Record<string, { count: number; cached: number; bytes: number; decoded: number }> = {};
    for (const entry of resources) {
      const key = kind(entry.name);
      const row = requests[key] ??= { count: 0, cached: 0, bytes: 0, decoded: 0 };
      row.count += 1;
      if (entry.transferSize === 0) row.cached += 1;
      row.bytes += entry.transferSize;
      row.decoded += entry.decodedBodySize;
    }
    return {
      longTasks: tasks.length,
      longTaskMs: Math.round(tasks.reduce((sum, task) => sum + task.duration, 0)),
      longTaskMax: Math.round(Math.max(0, ...tasks.map((task) => task.duration))),
      setData, setDataCalls: Object.entries(setData).filter(([source]) => !source.endsWith(":diff")).reduce((sum, [, count]) => sum + count, 0),
      updateDataCalls: Object.entries(setData).filter(([source]) => source.endsWith(":diff")).reduce((sum, [, count]) => sum + count, 0),
      requests, mutations: rec.mutations,
    };
  }, { from, to, origin });
}

/**
 * What the settled view holds, per source and style layer: features loaded (GeoJSON data, or tile features for
 * vector sources) and rendered (queryRenderedFeatures), by geometry kind, with polygon parts, rings and vertices;
 * tiles per source (in view, cached, raw bytes); GPU vertices per layer from the tiles' buckets (what is drawn).
 */
async function census(page: Page) {
  return page.evaluate(() => {
    type Geometry = { type: string; coordinates: unknown };
    type F = { geometry: Geometry; layer: { id: string; type: string }; source: string; sourceLayer?: string; id?: string | number };
    type Tile = { state: string; latestRawTileData?: ArrayBuffer; buckets?: Record<string, { layerIds?: string[]; layoutVertexArray?: { length: number }; segments?: unknown }> };
    type TM = { getIds(): string[]; getTileByID(id: string): Tile | undefined; getSource(): { type: string; id: string; _data?: { geojson?: unknown; updateable?: Map<unknown, unknown> } }; _outOfViewCache?: { order?: unknown[] } };
    type M = {
      getStyle(): { sources: Record<string, { type: string }>; layers: { id: string; type: string; source?: string; "source-layer"?: string; minzoom?: number; maxzoom?: number; layout?: { visibility?: string }; filter?: unknown }[] };
      getZoom(): number; queryRenderedFeatures(options?: object): F[]; querySourceFeatures(source: string, options?: object): F[];
      getLayoutProperty(id: string, name: string): unknown; style: { tileManagers: Record<string, TM> };
    };
    const map = (window as unknown as { __closeKnitMap: M }).__closeKnitMap;
    const zoom = map.getZoom();
    const count = (geometry: Geometry | null | undefined) => {
      const out = { kind: "none", parts: 0, rings: 0, vertices: 0 };
      if (!geometry) return out;
      const c = geometry.coordinates as never;
      switch (geometry.type) {
        case "Point": return { kind: "point", parts: 1, rings: 0, vertices: 1 };
        case "MultiPoint": return { kind: "point", parts: (c as unknown[]).length, rings: 0, vertices: (c as unknown[]).length };
        case "LineString": return { kind: "line", parts: 1, rings: 0, vertices: (c as unknown[]).length };
        case "MultiLineString": return { kind: "line", parts: (c as unknown[][]).length, rings: 0, vertices: (c as unknown[][]).reduce((s, l) => s + l.length, 0) };
        case "Polygon": return { kind: "polygon", parts: 1, rings: (c as unknown[][]).length, vertices: (c as unknown[][]).reduce((s, r) => s + r.length, 0) };
        case "MultiPolygon": return {
          kind: "polygon", parts: (c as unknown[][][]).length, rings: (c as unknown[][][]).reduce((s, p) => s + p.length, 0),
          vertices: (c as unknown[][][]).reduce((s, p) => s + p.reduce((t, r) => t + r.length, 0), 0),
        };
        default: return out;
      }
    };
    type Tally = { features: number; parts: number; rings: number; vertices: number };
    const blank = (): Record<string, Tally> => ({});
    const add = (into: Record<string, Tally>, geometry: Geometry | null | undefined) => {
      const counted = count(geometry);
      const row = into[counted.kind] ??= { features: 0, parts: 0, rings: 0, vertices: 0 };
      row.features += 1; row.parts += counted.parts; row.rings += counted.rings; row.vertices += counted.vertices;
    };
    const style = map.getStyle();
    const visible = style.layers.filter((layer) => (layer.layout?.visibility ?? map.getLayoutProperty(layer.id, "visibility")) !== "none"
      && zoom >= (layer.minzoom ?? 0) && zoom < (layer.maxzoom ?? 24));
    const started = performance.now();
    const rendered = map.queryRenderedFeatures();
    const queryMs = Math.round(performance.now() - started);
    const byLayer: Record<string, { type: string; source: string; features: number; vertices: number; gpuVertices: number }> = {};
    const renderedBySource: Record<string, Record<string, Tally>> = {};
    const seen = new Set<string>();
    for (const feature of rendered) {
      const counted = count(feature.geometry);
      const row = byLayer[feature.layer.id] ??= { type: feature.layer.type, source: feature.source, features: 0, vertices: 0, gpuVertices: 0 };
      row.features += 1; row.vertices += counted.vertices;
      // A feature drawn by a fill and its outline counts once per source.
      const key = `${feature.source}|${feature.sourceLayer ?? ""}|${feature.id ?? JSON.stringify(feature.geometry.coordinates).slice(0, 80)}|${counted.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      add(renderedBySource[feature.source] ??= blank(), feature.geometry);
    }
    const sources: Record<string, { type: string; tilesInView: number; tilesCached: number; tileBytes: number; loaded: Record<string, Tally>; dataBytes?: number }> = {};
    for (const [id, manager] of Object.entries(map.style.tileManagers)) {
      const source = manager.getSource();
      const ids = manager.getIds();
      const tiles = ids.map((tileId) => manager.getTileByID(tileId)).filter((tile): tile is Tile => !!tile);
      let tileBytes = 0;
      for (const tile of tiles) {
        tileBytes += tile.latestRawTileData?.byteLength ?? 0;
        for (const bucket of Object.values(tile.buckets ?? {})) {
          const vertices = bucket.layoutVertexArray?.length ?? 0;
          for (const layerId of bucket.layerIds ?? []) if (byLayer[layerId]) byLayer[layerId].gpuVertices += vertices;
          else if (vertices) byLayer[layerId] = { type: "?", source: id, features: 0, vertices: 0, gpuVertices: vertices };
        }
      }
      const loaded = blank();
      let dataBytes: number | undefined;
      const geojson = source._data?.geojson as { features?: { geometry: Geometry }[]; type?: string } | undefined;
      if (geojson?.features) {
        for (const feature of geojson.features) add(loaded, feature.geometry);
        dataBytes = geojson.features.length < 200_000 ? JSON.stringify(geojson).length : undefined;
      } else if (source._data?.updateable) {
        for (const feature of source._data.updateable.values() as Iterable<{ geometry: Geometry }>) add(loaded, feature.geometry);
      } else if (source.type === "vector" || source.type === "geojson") {
        const layers = new Set(style.layers.filter((layer) => layer.source === id).map((layer) => layer["source-layer"]));
        for (const sourceLayer of layers) for (const feature of map.querySourceFeatures(id, sourceLayer ? { sourceLayer } : {})) add(loaded, feature.geometry);
      }
      sources[id] = { type: source.type, tilesInView: ids.length, tilesCached: manager._outOfViewCache?.order?.length ?? 0, tileBytes, loaded, ...(dataBytes ? { dataBytes } : {}) };
    }
    const total = (rows: Record<string, Record<string, Tally>>) => {
      const out = blank();
      for (const tally of Object.values(rows)) for (const [kind, row] of Object.entries(tally)) {
        const into = out[kind] ??= { features: 0, parts: 0, rings: 0, vertices: 0 };
        into.features += row.features; into.parts += row.parts; into.rings += row.rings; into.vertices += row.vertices;
      }
      return out;
    };
    const fills = style.layers.filter((layer) => layer.type === "fill" && layer.source && (["analytics-fill", "analytics-areas"].includes(layer.source) || layer.source.startsWith("area-tiles-")));
    const lines = style.layers.filter((layer) => layer.type === "line" && layer.source && (["analytics-fill", "analytics-areas"].includes(layer.source) || layer.source.startsWith("area-tiles-")));
    return {
      zoom: Math.round(zoom * 100) / 100,
      sourceCount: Object.keys(style.sources).length, layers: style.layers.length, visibleLayers: visible.length,
      visibleByType: visible.reduce<Record<string, number>>((out, layer) => { out[layer.type] = (out[layer.type] ?? 0) + 1; return out; }, {}),
      areaLayers: { fills: fills.map((layer) => layer.id), lines: lines.map((layer) => layer.id) },
      queryRenderedMs: queryMs,
      renderedTotal: total(renderedBySource), loadedTotal: total(Object.fromEntries(Object.entries(sources).map(([id, row]) => [id, row.loaded]))),
      gpuVertices: Object.values(byLayer).reduce((sum, row) => sum + row.gpuVertices, 0),
      tilesInView: Object.values(sources).reduce((sum, row) => sum + row.tilesInView, 0),
      renderedBySource, sources, byLayer,
    };
  });
}

function write(line: object) {
  mkdirSync(dirname(OUT), { recursive: true });
  appendFileSync(OUT, `${JSON.stringify(line)}\n`);
}

for (const view of (Object.keys(INTERACTION_VIEWS) as ViewId[]).filter((id) => !viewFilter || viewFilter.has(id))) {
  for (const layer of LAYERS.filter((entry) => !layerFilter || layerFilter.has(entry.id))) {
    test(`interaction ${layer.id} @ ${view}`, async ({ playwright, baseURL }) => {
      test.setTimeout(LOAD_TIMEOUT_MS * 4 + 60_000);
      const context = await openContext(playwright.chromium, baseURL!);
      const over: string[] = [];
      try {
        const page = context.pages()[0] ?? await context.newPage();
        const origin = new URL(baseURL!).origin;
        const cdp = await context.newCDPSession(page);
        await cdp.send("Performance.enable", { timeDomain: "timeTicks" });
        if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
        const opened = openRequests(page, origin);
        await page.goto(viewUrl(layer, view), { waitUntil: "commit", timeout: LOAD_TIMEOUT_MS });
        const loaded = await settle(page, 0, opened.count);
        opened.stop();
        const base = { layer: layer.id, view, gl: GL, cpu: CPU, dpr: DPR, at: new Date().toISOString() };
        if (loaded === null) {
          write({ ...base, gesture: "open", status: "timeout" });
          throw new Error(`${layer.id} @ ${view} never settled`);
        }
        // An idle second: the frame rate of a still map (the control: ~60 fps).
        await page.evaluate(() => { const rec = (window as unknown as { __ckRec: { frames: number[]; recording: boolean } }).__ckRec; rec.frames = []; rec.recording = true; });
        await page.waitForTimeout(1000);
        const idleFrames = await page.evaluate(() => { const rec = (window as unknown as { __ckRec: { frames: number[]; recording: boolean } }).__ckRec; rec.recording = false; return rec.frames; });
        const settledCensus = await census(page);
        write({ ...base, gesture: "open", status: "ok", openMs: Math.round(loaded), idle: frameStats(idleFrames), census: settledCensus });
        for (const gesture of GESTURES.filter((entry) => !gestureFilter || gestureFilter.has(entry))) {
          const traced = TRACE === `${view}/${layer.id}/${gesture}`;
          if (traced) {
            await cdp.send("Tracing.start", {
              transferMode: "ReturnAsStream",
              traceConfig: { includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame", "v8.execute", "disabled-by-default-v8.cpu_profiler", "blink.user_timing", "gpu"] },
            });
          }
          const before = await cdpMetrics(cdp);
          const open = openRequests(page, origin);
          const { start, end, zoomReached } = await runGesture(page, gesture, INTERACTION_VIEWS[view].zoom);
          const after = await cdpMetrics(cdp);
          const frames = await page.evaluate(() => (window as unknown as { __ckRec: { frames: number[] } }).__ckRec.frames);
          const settledAt = await settle(page, end, open.count);
          open.stop();
          if (traced) {
            const done = new Promise<string>((resolve) => cdp.once("Tracing.tracingComplete", (event) => resolve(event.stream!)));
            await cdp.send("Tracing.end");
            const stream = await done;
            const chunks: string[] = [];
            for (;;) {
              const read = await cdp.send("IO.read", { handle: stream });
              chunks.push(read.base64Encoded ? Buffer.from(read.data, "base64").toString() : read.data);
              if (read.eof) break;
            }
            await cdp.send("IO.close", { handle: stream });
            mkdirSync(dirname(TRACE_OUT), { recursive: true });
            writeFileSync(TRACE_OUT, chunks.join(""));
          }
          const during = await windowStats(page, origin, start, end);
          const afterGesture = await windowStats(page, origin, end, settledAt ?? Number.MAX_SAFE_INTEGER);
          const wall = (after.Timestamp - before.Timestamp) * 1000;
          const busy = (key: string) => Math.round(((after[key] - before[key]) * 1000 / wall) * 1000) / 10;
          const stats = frameStats(frames);
          const line = {
            ...base, gesture, status: settledAt === null ? "timeout" : "ok",
            gestureMs: Math.round(end - start), zoomReached: Math.round(zoomReached * 100) / 100,
            frame: stats,
            busyPct: busy("TaskDuration"), scriptPct: busy("ScriptDuration"), layoutPct: busy("LayoutDuration"), stylePct: busy("RecalcStyleDuration"),
            during, after: afterGesture,
            settleMs: settledAt === null ? null : Math.round(settledAt - end),
            heapMb: Math.round((after.JSHeapUsedSize / 1048576) * 10) / 10,
            census: await census(page),
          };
          write(line);
          const overBudget = stats.p95 > P95_BUDGET || stats.p50 > P50_BUDGET || during.longTaskMax > LONG_BUDGET;
          if (overBudget) over.push(`${gesture} p50 ${stats.p50} p95 ${stats.p95} long ${during.longTaskMax}`);
          await page.waitForTimeout(300);
        }
      } finally {
        await context.close();
      }
      test.info().annotations.push({ type: "interaction-over-budget", description: over.join("; ") || "none" });
      if (STRICT) expect(over, `${layer.id} @ ${view} gestures over budget`).toEqual([]);
    });
  }
}
