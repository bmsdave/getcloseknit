#!/usr/bin/env node
// npm run perf:interaction -- [playwright args]: map interaction smoothness (pan, zoom, fly) per view × layer against
// PERF_BASE_URL (default the local http://127.0.0.1:4180) with e2e-perf/map-interaction.spec.ts, then writes
// perf/layer-load/interaction-<date>-<sha>.json and appends one row per view × layer × gesture to
// perf/layer-load/interaction-history.csv. PERF_SUMMARIZE=<jsonl> only summarises an existing results file.
// See perf/layer-load/README.md, "Interaction".
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(web, "..", "perf", "layer-load");
const base = process.env.PERF_BASE_URL ?? "http://127.0.0.1:4180";
const sha = process.env.PERF_SHA
  ?? execFileSync("git", ["rev-parse", "--short=8", "HEAD"], { cwd: web, encoding: "utf8" }).trim();
const started = new Date();
const date = started.toISOString().slice(0, 10);
const lines = resolve(process.env.PERF_SUMMARIZE ?? process.env.PERF_JSONL
  ?? join(web, "test-results", `map-interaction-${started.getTime()}.jsonl`));
export const BUDGETS = {
  p95: Number(process.env.PERF_FRAME_P95_MS ?? 33),
  p50: Number(process.env.PERF_FRAME_P50_MS ?? 17),
  longTask: Number(process.env.PERF_LONG_TASK_MS ?? 100),
};

// What one settled view may hold (report-only, perf/layer-load/README.md "Interaction"): set from the 2026-10-25
// baseline's largest views (England z7.5: 27k LSOAs, 0.53M vertices loaded) with headroom, so growth shows up.
export const COUNT_BUDGETS = {
  renderedPolygonVertices: 400_000, gpuVertices: 1_500_000, areaFeatures: 30_000, areaVertices: 600_000,
  renderedPoints: 1_000, visibleLayers: 60,
};

// Strict by default since the area tiles (2026-10-25: 0 of 30 gestures over on the laptop profile): a gesture over
// budget fails the run. PERF_STRICT_INTERACTION=0 reports only.
let status = 0;
if (!process.env.PERF_SUMMARIZE) {
  const run = spawnSync("npx", ["playwright", "test", "-c", "playwright.perf.config.ts", "e2e-perf/map-interaction.spec.ts", ...process.argv.slice(2)], {
    cwd: web, stdio: "inherit", env: { PERF_STRICT_INTERACTION: "1", ...process.env, PERF_OUT: lines, PERF_BASE_URL: base },
  });
  status = run.status ?? 1;
}
if (!existsSync(lines)) {
  console.error("perf:interaction: no results were written");
  process.exit(status || 1);
}
const results = readFileSync(lines, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
if (!process.env.PERF_JSONL && !process.env.PERF_SUMMARIZE) rmSync(lines);
const gl = results.find((entry) => entry.gl)?.gl ?? "gpu";
const cpu = results.find((entry) => entry.cpu)?.cpu ?? 1;
const dpr = results.find((entry) => entry.dpr)?.dpr ?? 1;

const kind = (totals, name, key) => totals?.[name]?.[key] ?? 0;
const opens = new Map(results.filter((entry) => entry.gesture === "open").map((entry) => [`${entry.layer}|${entry.view}`, entry]));
const rows = results.filter((entry) => entry.gesture !== "open").map((entry) => {
  const census = entry.census ?? opens.get(`${entry.layer}|${entry.view}`)?.census;
  // The areas: the area tiles' sources (lib/area-tiles.ts) summed.
  const areaSources = Object.entries(census?.sources ?? {}).filter(([id]) => id.startsWith("area-tiles-"))
    .map(([, source]) => source);
  const area = areaSources.reduce((sum, source) => ({
    features: sum.features + (source.loaded?.polygon?.features ?? 0), vertices: sum.vertices + (source.loaded?.polygon?.vertices ?? 0),
    bytes: sum.bytes + (source.dataBytes ?? source.tileBytes ?? 0),
  }), { features: 0, vertices: 0, bytes: 0 });
  const over = entry.status !== "ok" || entry.frame.p95 > BUDGETS.p95 || entry.frame.p50 > BUDGETS.p50 || entry.during.longTaskMax > BUDGETS.longTask;
  return {
    layer: entry.layer, view: entry.view, gesture: entry.gesture, status: entry.status,
    frames: entry.frame.frames, p50: entry.frame.p50, p95: entry.frame.p95, p99: entry.frame.p99, max: entry.frame.max, droppedPct: entry.frame.droppedPct,
    longTasks: entry.during.longTasks, longTaskMs: entry.during.longTaskMs, longTaskMax: entry.during.longTaskMax,
    afterLongTaskMax: entry.after.longTaskMax, afterLongTaskMs: entry.after.longTaskMs,
    busyPct: entry.busyPct, scriptPct: entry.scriptPct, setData: entry.during.setDataCalls + entry.after.setDataCalls,
    updateData: (entry.during.updateDataCalls ?? 0) + (entry.after.updateDataCalls ?? 0),
    mutations: entry.during.mutations, settleMs: entry.settleMs, heapMb: entry.heapMb,
    renderedPolygons: kind(census?.renderedTotal, "polygon", "features"), renderedPolygonVertices: kind(census?.renderedTotal, "polygon", "vertices"),
    renderedLines: kind(census?.renderedTotal, "line", "features"), renderedLineVertices: kind(census?.renderedTotal, "line", "vertices"),
    renderedPoints: kind(census?.renderedTotal, "point", "features"),
    loadedPolygons: kind(census?.loadedTotal, "polygon", "features"), loadedPolygonVertices: kind(census?.loadedTotal, "polygon", "vertices"),
    loadedLines: kind(census?.loadedTotal, "line", "features"), loadedPoints: kind(census?.loadedTotal, "point", "features"),
    gpuVertices: census?.gpuVertices ?? 0, visibleLayers: census?.visibleLayers ?? 0, tilesInView: census?.tilesInView ?? 0,
    areaFeatures: area.features, areaVertices: area.vertices, areaBytes: area.bytes,
    over,
  };
}).map((row) => ({ ...row, countsOver: Object.entries(COUNT_BUDGETS).filter(([key, budget]) => row[key] > budget).map(([key]) => key) }));

mkdirSync(outDir, { recursive: true });
const file = join(outDir, `interaction-${date}-${sha}${gl === "gpu" ? "-gpu" : ""}${cpu > 1 ? `-cpu${cpu}` : ""}${dpr > 1 ? `-dpr${dpr}` : ""}.json`);
writeFileSync(file, `${JSON.stringify({
  schema: "map-interaction.v1", baseUrl: base, sha, gl, cpu, dpr, budgets: BUDGETS, countBudgets: COUNT_BUDGETS,
  startedAt: started.toISOString(), finishedAt: new Date().toISOString(),
  overBudget: rows.filter((row) => row.over).length, rows,
  // The settled views' census (sources, layers, per-layer features and vertices) without the per-gesture copies.
  opens: [...opens.values()].map(({ layer, view, openMs, idle, census }) => ({ layer, view, openMs, idle, census })),
}, null, 1)}\n`);

const COLUMNS = ["date", "sha", "base", "gl", "cpu", "dpr", "layer", "view", "gesture", "status", "frames", "p50", "p95", "p99", "max", "dropped_pct",
  "long_tasks", "long_task_ms", "long_task_max", "after_long_task_max", "after_long_task_ms", "busy_pct", "script_pct", "set_data", "update_data", "mutations",
  "settle_ms", "heap_mb", "rendered_polygons", "rendered_polygon_vertices", "rendered_lines", "rendered_line_vertices", "rendered_points",
  "loaded_polygons", "loaded_polygon_vertices", "loaded_lines", "loaded_points", "gpu_vertices", "visible_layers", "tiles_in_view",
  "area_features", "area_vertices", "area_bytes", "over", "counts_over"];
const history = join(outDir, "interaction-history.csv");
if (!existsSync(history)) writeFileSync(history, `${COLUMNS.join(",")}\n`);
appendFileSync(history, rows.map((row) => [
  date, sha, base, gl, cpu, dpr, row.layer, row.view, row.gesture, row.status, row.frames, row.p50, row.p95, row.p99, row.max, row.droppedPct,
  row.longTasks, row.longTaskMs, row.longTaskMax, row.afterLongTaskMax, row.afterLongTaskMs, row.busyPct, row.scriptPct, row.setData, row.updateData, row.mutations,
  row.settleMs ?? "", row.heapMb, row.renderedPolygons, row.renderedPolygonVertices, row.renderedLines, row.renderedLineVertices, row.renderedPoints,
  row.loadedPolygons, row.loadedPolygonVertices, row.loadedLines, row.loadedPoints, row.gpuVertices, row.visibleLayers, row.tilesInView,
  row.areaFeatures, row.areaVertices, row.areaBytes, row.over ? 1 : 0, row.countsOver.join("+"),
].join(",")).join("\n") + "\n");

console.log(`perf:interaction: ${file}`);
console.log(`${rows.filter((row) => row.over).length} of ${rows.length} gestures over budget (p50 ${BUDGETS.p50} / p95 ${BUDGETS.p95} ms, long task ${BUDGETS.longTask} ms)`);
const countsOver = rows.filter((row) => row.countsOver.length);
if (countsOver.length) console.log(`${countsOver.length} gestures end on a view over a count budget: ${[...new Set(countsOver.map((row) => `${row.view} ${row.countsOver.join("+")}`))].join("; ")}`);
// The gestures over budget first, then the slowest frames.
for (const row of [...rows].sort((a, b) => Number(b.over) - Number(a.over) || b.p95 - a.p95 || b.longTaskMax - a.longTaskMax).slice(0, 8)) {
  console.log(`  ${row.layer} @ ${row.view} ${row.gesture}: p50 ${row.p50} p95 ${row.p95} dropped ${row.droppedPct}% long max ${row.longTaskMax} settle ${row.settleMs}`);
}
process.exit(status);
