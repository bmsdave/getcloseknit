#!/usr/bin/env node
// npm run perf:layers -- [playwright args]: measures layer load times (open, switch, and the repeat visit with its zoom cycle) against PERF_BASE_URL
// (default the local http://127.0.0.1:4180) with e2e-perf/layer-load.spec.ts, then writes
// perf/layer-load/<date>-<sha>.json and appends one row per layer × view to perf/layer-load/history.csv.
// PERF_SUMMARIZE=<jsonl> only summarises an existing results file. See perf/layer-load/README.md.
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(web, "..", "perf", "layer-load");
const base = process.env.PERF_BASE_URL ?? "http://127.0.0.1:4180";
const openBudget = Number(process.env.PERF_OPEN_BUDGET_MS ?? 1000);
const coldBudget = Number(process.env.PERF_COLD_BUDGET_MS ?? 1500);
const switchBudget = Number(process.env.PERF_SWITCH_BUDGET_MS ?? 1000);
// Repeat visit (F5, service worker on): colours within 300 ms; a zoom cycle done again takes no area tile from the network.
const repeatBudget = Number(process.env.PERF_REPEAT_BUDGET_MS ?? 300);
const zoomNetworkBudget = Number(process.env.PERF_ZOOM_NETWORK_BUDGET ?? 0);
const sha = process.env.PERF_SHA
  ?? execFileSync("git", ["rev-parse", "--short=8", "HEAD"], { cwd: web, encoding: "utf8" }).trim();
const started = new Date();
const date = started.toISOString().slice(0, 10);
// PERF_JSONL: continue an interrupted run (its lines are kept and the new ones appended).
const lines = resolve(process.env.PERF_SUMMARIZE ?? process.env.PERF_JSONL
  ?? join(web, "test-results", `layer-load-${started.getTime()}.jsonl`));

// Strict where the budget holds (perf/layer-load/analysis-2026-10-23-phase-c.md): the switch (1 s, switching back)
// and the warm open (1 s) on every view, and no area tile from the network in a repeated zoom cycle. The repeat
// visit's 300 ms is reported, not enforced: the page boot alone takes about that (perf/layer-load/README.md). The cold open (1.5 s) is reported, not enforced: 7 of 345 pairs are over
// (server misses and the criteria's 2.6 MB LSOA packs). Override with PERF_STRICT_SWITCH=0 or other PERF_STRICT_* values.
const STRICT_DEFAULTS = {
  PERF_STRICT_SWITCH: "1", PERF_STRICT_SWITCH_VIEWS: "london,england,manchester",
  PERF_STRICT_OPEN: "1", PERF_STRICT_OPEN_VIEWS: "london,england,manchester",
  PERF_STRICT_ZOOM: "1",
};

let status = 0;
if (!process.env.PERF_SUMMARIZE) {
  const run = spawnSync("npx", ["playwright", "test", "-c", "playwright.perf.config.ts", "e2e-perf/layer-load.spec.ts", ...process.argv.slice(2)], {
    cwd: web, stdio: "inherit", env: { ...STRICT_DEFAULTS, ...process.env, PERF_OUT: lines, PERF_BASE_URL: base },
  });
  status = run.status ?? 1;
}
if (!existsSync(lines)) {
  console.error("perf:layers: no results were written");
  process.exit(status || 1);
}
const results = readFileSync(lines, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
// How the map was drawn (e2e-perf/layer-load.spec.ts GL): results from before phase C have no gl and were SwiftShader.
const gl = results.find((entry) => entry.gl)?.gl ?? "swiftshader";
if (!process.env.PERF_JSONL && !process.env.PERF_SUMMARIZE) rmSync(lines);

const rows = new Map();
for (const entry of results) {
  const key = `${entry.layer}|${entry.view}`;
  const row = rows.get(key) ?? { layer: entry.layer, view: entry.view };
  row[entry.run] = entry;
  rows.set(key, row);
}
const over = (entry, budget) => (!entry || entry.status === "unpublished" ? null : entry.status !== "ok" || entry.ms > budget);
const summary = [...rows.values()].map((row) => ({
  layer: row.layer, view: row.view,
  coldMs: row.cold?.ms ?? null, warmMs: row.warm?.ms ?? null,
  switchMs: row.switch?.ms ?? null, switchAgainMs: row["switch-again"]?.ms ?? null,
  repeatMs: row.repeat?.colouredMs ?? null, repeatStatus: row.repeat?.status ?? "",
  zoomTiles: row["zoom-cycle"]?.zoom?.secondTiles ?? null, zoomNetwork: row["zoom-cycle"]?.zoom?.secondNetwork ?? null,
  coldStatus: row.cold?.status ?? "", warmStatus: row.warm?.status ?? "",
  switchStatus: row.switch?.status ?? "", switchAgainStatus: row["switch-again"]?.status ?? "",
  openOver: over(row.warm, openBudget), coldOver: over(row.cold, coldBudget), switchOver: over(row["switch-again"], switchBudget),
  repeatOver: !row.repeat || row.repeat.status === "unpublished" ? null : row.repeat.status !== "ok" || (row.repeat.colouredMs ?? Infinity) > repeatBudget,
  zoomOver: row["zoom-cycle"]?.zoom ? row["zoom-cycle"].zoom.secondNetwork > zoomNetworkBudget : null,
}));

mkdirSync(outDir, { recursive: true });
// GPU runs (phase C on) are named apart from the SwiftShader runs of the same build.
const file = join(outDir, `${date}-${sha}${gl === "gpu" ? "-gpu" : ""}.json`);
writeFileSync(file, `${JSON.stringify({
  schema: "layer-load.v3", baseUrl: base, sha, gl, openBudgetMs: openBudget, coldBudgetMs: coldBudget, switchBudgetMs: switchBudget,
  repeatBudgetMs: repeatBudget, zoomNetworkBudget,
  startedAt: started.toISOString(), finishedAt: new Date().toISOString(),
  openOverBudget: summary.filter((row) => row.openOver).length,
  coldOverBudget: summary.filter((row) => row.coldOver).length,
  switchOverBudget: summary.filter((row) => row.switchOver).length,
  repeatOverBudget: summary.filter((row) => row.repeatOver).length,
  zoomOverBudget: summary.filter((row) => row.zoomOver).length,
  summary, results,
}, null, 1)}\n`);

// history.csv: one row per layer × view and run date. v1 rows (open only, budget 1000 on the warm open) and v2 rows
// (no gl column: drawn by SwiftShader) and v3 rows (no repeat columns) are carried over into the v4 columns once.
const V2_HEADER = "date,sha,base,layer,view,cold_ms,warm_ms,switch_ms,switch_again_ms,cold_status,warm_status,switch_status,"
  + "switch_again_status,open_budget_ms,switch_budget_ms,open_over,switch_over";
const V3_HEADER = `${V2_HEADER},gl`;
const REPEAT_COLUMNS = "repeat_ms,repeat_status,zoom_cycle_tiles,zoom_cycle_network,repeat_budget_ms,repeat_over,zoom_over";
const HEADER = `${V3_HEADER},${REPEAT_COLUMNS}`;
const NO_REPEAT = REPEAT_COLUMNS.split(",").map(() => "").join(",");
const history = join(outDir, "history.csv");
if (!existsSync(history)) writeFileSync(history, `${HEADER}\n`);
const existing = readFileSync(history, "utf8").split("\n").filter(Boolean);
if (existing[0] !== HEADER) {
  const migrated = existing.slice(1).map((line) => {
    if (existing[0] === V3_HEADER) return `${line},${NO_REPEAT}`;
    if (existing[0] === V2_HEADER) return `${line},swiftshader,${NO_REPEAT}`;
    const [d, s, b, layer, view, cold, warm, coldStatus, warmStatus, budget, overBudget] = line.split(",");
    return [d, s, b, layer, view, cold, warm, "", "", coldStatus, warmStatus, "", "", budget, "", overBudget, "", "swiftshader", NO_REPEAT].join(",");
  });
  writeFileSync(history, `${[HEADER, ...migrated].join("\n")}\n`);
}
const flag = (value) => (value === null ? "" : value ? 1 : 0);
appendFileSync(history, summary.map((row) => [
  date, sha, base, row.layer, row.view, row.coldMs ?? "", row.warmMs ?? "", row.switchMs ?? "", row.switchAgainMs ?? "",
  row.coldStatus, row.warmStatus, row.switchStatus, row.switchAgainStatus, openBudget, switchBudget,
  flag(row.openOver), flag(row.switchOver), gl,
  row.repeatMs ?? "", row.repeatStatus, row.zoomTiles ?? "", row.zoomNetwork ?? "", repeatBudget, flag(row.repeatOver), flag(row.zoomOver),
].join(",")).join("\n") + "\n");

console.log(`perf:layers: ${file}`);
for (const [label, key, budget, overKey, unit = " ms"] of [["warm open", "warmMs", openBudget, "openOver"], ["cold open", "coldMs", coldBudget, "coldOver"],
  ["switch again", "switchAgainMs", switchBudget, "switchOver"], ["repeat visit (F5)", "repeatMs", repeatBudget, "repeatOver"],
  ["zoom cycle again", "zoomNetwork", zoomNetworkBudget, "zoomOver", " tiles from the network"]]) {
  const measured = summary.filter((row) => row[overKey] !== null);
  if (!measured.length) continue;
  const worst = [...measured].sort((a, b) => (b[key] ?? Infinity) - (a[key] ?? Infinity)).slice(0, 5);
  console.log(`${measured.filter((row) => row[overKey]).length} of ${measured.length} layer × view over ${budget}${unit} (${label}); worst:`);
  for (const row of worst) console.log(`  ${row.layer} @ ${row.view}: ${row[key] ?? "not settled"}`);
}
process.exit(status);
