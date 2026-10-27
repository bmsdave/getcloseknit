# Layer load time

How long a map layer takes to show, tracked per layer and view as two metrics with their own budgets:

| Metric | From | Budget | Strict flag |
| --- | --- | --- | --- |
| **switch** | a click in the Layers menu (item, view chip or pick), on a map already open | **1 s**, switching to it again (`switch-again`); the first switch is recorded too | `PERF_STRICT_SWITCH=1` |
| **open** | navigation start of `/?layer=…` (page boot included) | **1 s warm**, **1.5 s cold** (since phase C; 1.5 s warm before) | `PERF_STRICT_OPEN=1`, `PERF_STRICT_COLD=1` |
| **repeat** | navigation start of an F5 after a cold open, service worker on, until the colours show (painted and the fill's tiles loaded) | **300 ms** (reported) | `PERF_STRICT_REPEAT=1` |
| **zoom cycle** | the same zoom cycle (out 3 levels, in 2 past the view, back) done a second time after the F5 | **0** area tiles from the network | `PERF_STRICT_ZOOM=1` (on in `npm run perf:layers`) |

Each strict flag holds on the views in `PERF_STRICT_SWITCH_VIEWS`, `PERF_STRICT_OPEN_VIEWS` and
`PERF_STRICT_COLD_VIEWS` (default every view). `npm run perf:layers` enforces the warm open and the switch back on
every view, where every layer passes since phase C; the cold open is reported only (7 of 345 over): see
[analysis-2026-10-23-phase-c.md](analysis-2026-10-23-phase-c.md). Set a flag to `0` for a report-only run.

## The metric

**Layer load time** = from opening the map on a layer (navigation start, `/?layer=…`) or switching to it in the
Layers menu, until its colours are applied and the map is settled:

- the map's colours are applied (`.map-stage[data-painting="false"]`: every value pack and shape piece in view
  fetched and painted),
- MapLibre is `idle` after that (every source and tile in view loaded, nothing left to draw),
- and, in the spec, no same-origin request is still open for 750 ms (a late coverage or piece request repaints).

Two ways to read it:

| Where | What | How |
| --- | --- | --- |
| In the app (every build after this PR) | `window.__ckLayerTimings` (last 50) and `performance` measure `ck:layer-load`, one per open or switch | `web/src/lib/layer-load-timing.ts`, wired in `web/src/components/area-map.tsx`. Stays on the device: no request, no listener while nothing is pending. |
| Playwright perf spec | per layer × view: open cold and warm, switch and switch-again, with per-request breakdown | `web/e2e-perf/layer-load.spec.ts` (own config `web/playwright.perf.config.ts`, never part of `npm run test:e2e`) |

The spec measures on its own (data-painting + MapLibre idle through `?diagnostics=1`), so it works on builds
without the hook; on builds with it, `hookMs` records the app's own figure next to it.

**Renderer.** Since phase C the spec runs Chromium's new headless mode (`channel: "chromium"`), which draws WebGL on
the machine's GPU as a visitor's browser does. Every run before it used the headless shell, which draws WebGL on the
CPU (SwiftShader): its first frames alone cost about a second, so those numbers were mostly the software renderer's.
`PERF_GL=swiftshader` measures the old way; `history.csv` says which in its `gl` column (rows before phase C:
`swiftshader`), and GPU runs are saved as `<date>-<sha>-gpu.json`.

**Cold** = a fresh browser profile (empty HTTP cache, service worker blocked). **Warm** = the same URL again in that
profile (disk cache filled; the server's caches warmed by the cold run). Both include the page boot, since a
visitor opening a link pays for it.

**Switch** = one page per view (opened on Noise), then every layer picked in Layers the way a visitor does: search its
item, click it, or its view chip or pick (for a view or a pick the item is clicked first, untimed). `switch` is the
first time (browser caches cold for that layer), `switch-again` the second pass through every layer. It is what
`__ckLayerTimings` with `trigger: "switch"` records in the app.

## Repeat visit and zoom cycle

Once a layer has loaded, F5 and zooming back to tiles already seen should use the browser's caches, with no
round trip. `PERF_MODE=repeat` (part of the default run) measures it for `PERF_REPEAT_LAYERS` (typical price, crime,
income) on every view, each in a fresh profile **with the service worker on** (the other runs block it):

- **repeat** = a cold open, then F5; `colouredMs` from navigation start to the frame where the map is painted and
  the fill's tile source is loaded (`ms` is the idle after it, as for the other runs);
- **zoom-cycle** = then `jumpTo` out three levels, in two past the view and back, twice; the result's `zoom` counts
  the area-tile requests of each cycle (however answered) and those of the second that crossed the network (bytes
  transferred, by the page or by the service worker): the budget is none.

What keeps them in the browser (2026-10-26):

| Request | Kept by |
| --- | --- |
| Area tiles: static archives `/tiles/areas-<release>-<kind>.pmtiles` (Range requests: a header, then one per tile), or the API's `/api/v1/tiles/areas/<release>/…` | immutable; the service worker serves them cache-first (`close-knit-data-tiles-<release>`), an archive's range by range |
| Value packs and area boxes `?v=<release>` (London's chunk too since 2026-10-26) | immutable; service worker cache-first (`close-knit-data-v-<release>`) |
| Coverage `/api/v1/map/coverage?release=` | a day, then a week stale-while-revalidate, when the release is the API's (it also follows server flags) |
| Tiles kept in memory | MapLibre keeps 8 zoom levels of the view (`MAP_TILE_CACHE_ZOOM_LEVELS`), and the fill's opacity is one expression over zoom (`opacityOverZoom`): a changed data-driven paint property makes MapLibre reload the source and drop its cached tiles |

Production, 2026-10-26 (tunnel; the laptop's load average was 40+, so times are noisy), `prod-pre-cache` →
`d21977ba` in `history.csv`: a repeated zoom cycle asked for 14–34 area tiles again (from the HTTP cache) → 0 in
London and Manchester (England's view: 40, all from the service worker, none from the network). F5 more than 5
minutes after the last visit painted in 1.2 s, the coverage revalidating first → 0.95 s with every map request from
a cache. The repeat budget (300 ms) is not met: on a quiet F5 the colours are applied at about 300–370 ms (HTML
~100 ms, scripts and map set-up ~200 ms) and drawn at 400–780 ms (MapLibre's workers start and parse the tiles).

The service worker drops a release's data cache when a newer release of its kind answers, keeps at most 4,000
entries per cache, and stores only answers the server calls immutable. The page itself (HTML, server-rendered) and
`/api/v1/health` still go to the network on every F5.

## Views

| id | centre | zoom |
| --- | --- | --- |
| london | 51.5074, -0.1278 | 11 |
| england | 52.9, -1.5 | 6 |
| manchester | 53.4808, -2.2426 | 11 |

## Layers

Every layer the Layers menu offers (`MAP_TOPIC_GROUPS`): each item's own layer and its views, and the first of a long
pick list (one census country, one ethnic group: the same mechanism). Metrics missing from the release's
`/api/v1/metrics` are recorded as `unpublished` and skipped. `PERF_ALL_LAYERS=1` adds every pick (~700 layers).

## Run it

```sh
cd web
npm run perf:layers                                   # local site on http://127.0.0.1:4180
PERF_BASE_URL=http://127.0.0.1:4195 PERF_SHA=<deployed sha> npm run perf:layers   # production, see below
PERF_LAYERS=crime,income PERF_VIEWS=london npm run perf:layers                    # a subset
PERF_MODE=switch npm run perf:layers                  # only the switch metric (PERF_MODE=open: only opens)
PERF_MODE=repeat npm run perf:layers                  # only F5 and the zoom cycle (PERF_REPEAT_LAYERS=crime to narrow)
PERF_STRICT_SWITCH=1 npm run perf:layers              # fail a switch-again over PERF_SWITCH_BUDGET_MS (1000)
PERF_STRICT_OPEN=1 npm run perf:layers                # fail a warm open over PERF_OPEN_BUDGET_MS (1000)
PERF_STRICT_COLD=1 npm run perf:layers                # fail a cold open over PERF_COLD_BUDGET_MS (1500)
PERF_GL=swiftshader npm run perf:layers               # draw on the CPU, as every run before phase C
```

Each run writes `perf/layer-load/<date>-<sha>.json` (summary + every run with its slowest API requests: URL, time,
TTFB, bytes) and appends one row per layer × view to `history.csv` (cold, warm, switch and switch-again ms, their
statuses, the budgets and whether each metric is over; rows from before 2026-10-23 have the open columns only). Other knobs: `PERF_TIMEOUT_MS` (90 000 per load),
`PERF_PAUSE_MS` (1 000 between loads), `PERF_JSONL=<file>` (continue an interrupted run: keep its lines, add the
missing layers with `PERF_LAYERS`).

### Production

Production is behind basic auth; measure the web container through a tunnel (no credentials typed):

```sh
ssh ubuntu@vps-b714062b.vps.ovh.net 'sudo docker inspect -f "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}" deploy-web-1'
ssh -N -L 127.0.0.1:4195:<that IP>:4180 ubuntu@vps-b714062b.vps.ovh.net &
PERF_BASE_URL=http://127.0.0.1:4195 PERF_SHA=<deployed sha> npm run perf:layers
kill %1
```

Runs are sequential (one page at a time) because everyone shares the API rate limiter; a full run is ~350 layer ×
view pairs and takes about 70 min for opens plus about 30 min for switches. Check nobody is shipping first (`pgrep -fl deploy/ship.sh`): a restart mid-run
drops the server caches and shows up as cold outliers. Baselines and their analysis: `analysis-<date>.md`.

**Caveats of the tunnel:** it skips Caddy, so answers arrive **uncompressed** (Caddy's `encode zstd gzip` shrinks
JSON 5–40×) and every request pays the laptop ↔ OVH round trip. Byte counts in the results are therefore decoded
sizes; times are an upper bound on what a visitor near the server sees, but comparable run to run. Main-thread
time (`longTaskMs`) depends on the measuring machine.

Not hooked into `deploy/ship.sh`: it needs a tunnel and a local Playwright, so it stays a manual post-deploy step.

## Interaction

How smoothly the map follows a drag, the wheel and a fly, per view × layer: `web/e2e-perf/map-interaction.spec.ts`
(same config and GPU Chromium as the load spec), `npm run perf:interaction` → `interaction-<date>-<sha>[-gpu][-cpu4][-dpr2].json`
and one row per view × layer × gesture in `interaction-history.csv`.

**Gestures** (synthetic input timed by the wall clock, so the hand moves on whatever the frames do): **pan** — three
600 px drags of 1 s each (left, right, left); **zoom** — the wheel in trackpad-sized steps (~3 levels a second) to the
far end of z6 ↔ z11 and back; **fly** — a place search (London → Birmingham, Manchester → Leeds, England → London two
levels in). **Views**: London z11 and z9.6, England z6 and z7.5, Manchester z11. **Layers**: typical price, crime, a
census layer (flats), a custom place layer (good coffee) and price on the reader's own range (`&range=300000,900000`).

**Per gesture**: frame times (requestAnimationFrame deltas) p50/p95/p99/max, dropped frames % (against 60 Hz), long
tasks during the gesture (count, total, max) and after it until settled, main-thread busy % (CDP `TaskDuration` over
the gesture), DOM mutations (React re-renders), `setData` / `updateData` calls on GeoJSON sources, requests by kind
(tiles, rasters, API: count, cached, bytes), time from the gesture's end to settled (painted, idle, nothing open for
500 ms) and the JS heap.

**Per settled view (census)**: sources and style layers (visible by type), and per source and in total, **loaded**
(GeoJSON data, or tile features for vector sources) and **rendered** (`queryRenderedFeatures`) features by kind:
polygons (parts, rings, vertices), lines (vertices), points; tiles in view and cached per source with raw tile bytes;
GPU vertices per style layer from the tiles' buckets (what is drawn). The JSON keeps the full census per view
(`opens`), the CSV the totals.

| Budget | Value | Enforced |
| --- | --- | --- |
| Frame p50 | ≤ 17 ms (60 fps) | `PERF_STRICT_INTERACTION=1` |
| Frame p95 | ≤ 33 ms (30 fps) | `PERF_STRICT_INTERACTION=1` |
| Longest task during a gesture | ≤ 100 ms | `PERF_STRICT_INTERACTION=1` |
| Rendered polygon vertices per view | ≤ 400k | reported (`counts_over`) |
| GPU vertices per view | ≤ 1.5M | reported |
| Area source: features / vertices | ≤ 30k / 600k | reported |
| Rendered points (symbols, dots) | ≤ 1,000 | reported |
| Visible style layers | ≤ 60 | reported |

The strict flag is off by default. Knobs: `PERF_VIEWS`, `PERF_LAYERS`, `PERF_GESTURES`, `PERF_CPU_THROTTLE=4` (CDP CPU
throttling of the page's main thread: a mid-range laptop next to the M-series Mac that measures), `PERF_DPR=2` (a
Retina canvas, four times the pixels), `PERF_TRACE=<view>/<layer>/<gesture>` (a Chrome trace of that gesture with the
JS sampling profiler, to `PERF_TRACE_OUT`; production serves source maps, so the profile resolves to source lines).

```sh
cd web
PERF_BASE_URL=http://127.0.0.1:4195 PERF_SHA=<deployed sha> npm run perf:interaction            # production (tunnel above)
PERF_CPU_THROTTLE=4 PERF_DPR=2 PERF_VIEWS=england-z7.5 npm run perf:interaction                # the laptop profile
PERF_VIEWS=england-z7.5 PERF_LAYERS=typical-price PERF_GESTURES=pan PERF_TRACE=england-z7.5/typical-price/pan npm run perf:interaction
```

### What it found (2026-10-25)

The map was smooth while nothing loaded (still map and most frames: p50 8.3 ms at 120 Hz) and stalled **between**
gestures, when the pieces of the new view landed:

1. **Every paint that changed the areas sent all of them to MapLibre's worker again** (`setData` on one growing
   GeoJSON source). At England z7.5 the source holds 27k LSOAs, 0.53M vertices, 13 MB of GeoJSON: copying it for the
   worker (`web_worker_transfer.serialize`) was a 125–147 ms task on the M-series Mac, up to 498 ms at 4× CPU, three times
   per pan, right as the next drag began. Now the source gets `updateData` with the areas that left and the ones that
   came in or changed shape (`web/src/lib/area-source-diff.ts`); the worker reloads only the tiles they touch.
2. **Feature state for areas the map does not draw.** MapLibre replays every feature state it holds into each tile
   that loads. A custom place layer's pack carries all 34k LSOAs in England while ~5k are drawn: every tile loaded
   during a zoom replayed 34k states (5 long tasks up to 155 ms per London zoom at 4× CPU). The morph now writes
   state only for the drawn areas.
3. Side effect fixed: a custom layer never resent its shapes after a pan (the old check compared the pack's ids, which
   for a custom layer are all of England), so areas in newly panned pieces stayed undrawn (41 at London z11).

Rejected with evidence: colours are feature-state reads, not a giant `match` expression (style-expression evaluation
is a few ms per gesture); React does not update on `move` (DOM mutations happen on `moveend` only: 17–27 during a
zoom); the in-view scale and histogram recompute on `moveend`, not `move`; area boundaries are drawn by one fill and
no outline layer (the selection outline holds one area); point layers are all zoom-gated (places z14, schools z12
and clustered, collisions heatmap z10, parcels z15, trees z15). Remaining cost at 4× CPU: each analytics tile that
loads replays the drawn areas' states (27k at England z7.5: 50–90 ms per tile batch), and the first appearance of a
region still copies its shapes once (~150 ms at 4× CPU). Next step: one source per region piece (states and copies
per region), or vector tiles for the boundaries.

### Before / after (2026-10-25)

Worst over the layers per view and gesture. Before: production at 2e39c455; after: this change (a97191dd) built
locally against production's API through the tunnel. Files: `interaction-2026-10-25-<sha>-gpu[-cpu4-dpr2].json`.

**This Mac (M-series, 120 Hz, 1× CPU, DPR 1)**: gestures over budget 4 of 75 → 0 of 75.

| View | Gesture | p50 ms | p95 ms | p99 ms | Dropped % | Long tasks (n / max ms) | Long task after (max) | setData / updateData |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| london-z11 | pan | 8.3 → 8.3 | 9.3 → 9.4 | 16.7 → 10.2 | 1.2 → 0.1 | 0 / 0 → 0 / 0 | 0 → 0 | 24/0 → 0/15 |
| london-z11 | zoom | 8.3 → 8.3 | 15.9 → 9.6 | 17.2 → 10.3 | 0.5 → 0.1 | 0 / 0 → 0 / 0 | 0 → 0 | 8/0 → 0/5 |
| london-z11 | fly | 8.3 → 8.3 | 11.2 → 10 | 17.3 → 10.4 | 0.0 → 0.0 | 0 / 0 → 0 / 0 | 0 → 0 | 8/0 → 5/0 |
| london-z9.6 | pan | 8.3 → 8.3 | 9.2 → 9.9 | 9.4 → 10.4 | 2.6 → 0.9 | 10 / 70 → 0 / 0 | 64 → 0 | 24/0 → 0/15 |
| london-z9.6 | zoom | 8.3 → 8.3 | 9 → 9.9 | 16.7 → 10.4 | 0.3 → 0.0 | 0 / 0 → 0 / 0 | 75 → 0 | 8/0 → 0/5 |
| london-z9.6 | fly | 8.3 → 8.3 | 9.1 → 9.9 | 9.4 → 10.4 | 0.2 → 0.0 | 0 / 0 → 0 / 0 | 79 → 67 | 8/0 → 5/0 |
| england-z6 | pan | 8.3 → 8.3 | 9.2 → 9.5 | 9.4 → 10.2 | 1.1 → 0.0 | 0 / 0 → 0 / 0 | 0 → 0 | 24/0 → 0/15 |
| england-z6 | zoom | 8.3 → 8.3 | 9.2 → 9.4 | 9.4 → 10.1 | 0.0 → 0.0 | 0 / 0 → 0 / 0 | 0 → 0 | 2/0 → 0/1 |
| england-z6 | fly | 8.3 → 8.3 | 9.2 → 10 | 9.3 → 10.4 | 0.0 → 0.0 | 0 / 0 → 0 / 0 | 171 → 210 | 10/0 → 5/0 |
| england-z7.5 | pan | 8.3 → 8.3 | 9.2 → 9.8 | 16.7 → 16.7 | 6.8 → 1.6 | 9 / 147 → 1 / 52 | 132 → 0 | 24/0 → 0/15 |
| england-z7.5 | zoom | 8.3 → 8.3 | 9.2 → 9.7 | 16.7 → 16.6 | 0.5 → 0.4 | 0 / 0 → 0 / 0 | 0 → 0 | 0/0 → 0/0 |
| england-z7.5 | fly | 8.3 → 8.3 | 9.1 → 10 | 16.6 → 16.7 | 0.3 → 0.0 | 0 / 0 → 0 / 0 | 120 → 110 | 18/0 → 15/0 |
| manchester-z11 | pan | 8.3 → 8.3 | 9.1 → 9.5 | 9.4 → 10.2 | 0.5 → 0.0 | 0 / 0 → 0 / 0 | 0 → 0 | 24/0 → 0/15 |
| manchester-z11 | zoom | 8.3 → 8.3 | 9.2 → 9.6 | 16.7 → 10.2 | 0.8 → 0.0 | 1 / 55 → 0 / 0 | 0 → 0 | 6/0 → 0/3 |
| manchester-z11 | fly | 8.3 → 8.3 | 9.1 → 9.7 | 9.4 → 10.3 | 0.0 → 0.0 | 0 / 0 → 0 / 0 | 0 → 0 | 8/0 → 5/0 |

**Laptop profile (4× CPU, DPR 2; price and good coffee)**: gestures over budget 7 of 30 → 5 of 30 (England z7.5
pan and fly; London z9.6 pan at 101 ms).

| View | Gesture | p50 ms | p95 ms | p99 ms | Dropped % | Long tasks (n / max ms) | Long task after (max) | setData / updateData |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| london-z11 | pan | 8.3 → 8.3 | 9.3 → 10.1 | 32.6 → 24.4 | 5.2 → 2.2 | 3 / 119 → 1 / 51 | 121 → 54 | 6/0 → 0/6 |
| london-z11 | zoom | 8.3 → 8.3 | 33.3 → 16.2 | 100.1 → 39.9 | 14.4 → 5.4 | 5 / 155 → 0 / 0 | 120 → 0 | 2/0 → 0/1 |
| london-z11 | fly | 8.3 → 8.3 | 9.3 → 10.3 | 66.6 → 33.7 | 8.1 → 3.2 | 1 / 75 → 0 / 0 | 66 → 73 | 2/0 → 2/0 |
| london-z9.6 | pan | 8.3 → 8.4 | 10.1 → 10.3 | 34.2 → 35 | 9.3 → 7.5 | 3 / 219 → 4 / 101 | 195 → 66 | 6/0 → 0/6 |
| london-z9.6 | zoom | 8.4 → 8.3 | 23.5 → 10.3 | 101 → 43.4 | 14.8 → 8.2 | 11 / 134 → 0 / 0 | 199 → 0 | 2/0 → 0/2 |
| london-z9.6 | fly | 8.3 → 8.3 | 10.2 → 10.2 | 33.3 → 33.1 | 7.1 → 4.0 | 1 / 70 → 0 / 0 | 183 → 181 | 2/0 → 2/0 |
| england-z6 | pan | 8.3 → 8.3 | 10.1 → 10.1 | 41.6 → 25.2 | 5.0 → 2.2 | 2 / 124 → 0 / 0 | 108 → 0 | 6/0 → 0/6 |
| england-z6 | zoom | 8.3 → 8.3 | 10.1 → 10.2 | 24.3 → 18.2 | 1.5 → 1.3 | 0 / 0 → 0 / 0 | 0 → 0 | 0/0 → 0/0 |
| england-z6 | fly | 8.3 → 8.3 | 10.3 → 10.2 | 34.9 → 49.3 | 7.2 → 6.5 | 0 / 0 → 0 / 0 | 616 → 592 | 4/0 → 2/0 |
| england-z7.5 | pan | 8.3 → 8.4 | 26.9 → 10.1 | 125 → 66.5 | 23.2 → 12.4 | 11 / 498 → 8 / 137 | 437 → 70 | 6/0 → 0/6 |
| england-z7.5 | zoom | 8.4 → 8.4 | 18.4 → 18.3 | 90.3 → 83.3 | 18.2 → 15.7 | 1 / 77 → 2 / 77 | 0 → 0 | 0/0 → 0/0 |
| england-z7.5 | fly | 8.5 → 8.5 | 33 → 41.5 | 67.9 → 65.6 | 21.1 → 21.1 | 2 / 68 → 2 / 57 | 329 → 322 | 6/0 → 6/0 |
| manchester-z11 | pan | 8.3 → 8.3 | 10.1 → 10.2 | 34.1 → 33.3 | 4.0 → 2.0 | 2 / 73 → 0 / 0 | 56 → 0 | 6/0 → 0/6 |
| manchester-z11 | zoom | 8.4 → 8.3 | 18.3 → 10.1 | 100.3 → 17.8 | 10.3 → 0.9 | 4 / 156 → 0 / 0 | 84 → 0 | 2/0 → 0/2 |
| manchester-z11 | fly | 8.4 → 8.3 | 10.1 → 10.1 | 24.3 → 10.3 | 0.6 → 0.0 | 0 / 0 → 0 / 0 | 88 → 92 | 2/0 → 2/0 |

**What each settled view holds** (typical price, the same before and after; all other layers alike):

| View | Sources / layers (visible: fill, line, symbol) | Rendered polygons (vertices) | Rendered lines (vertices) | Rendered points | Loaded points | Area source: features, vertices, MB | GPU vertices | Tiles in view |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| london-z11 | 10 / 87 (53: 13, 25, 14) | 3,323 (191,210) | 558 (39,859) | 312 | 5,425 | 4,994, 136,634, 3.4 | 669,769 | 36 |
| london-z9.6 | 10 / 87 (40: 12, 19, 8) | 7,822 (355,335) | 413 (71,551) | 85 | 4,653 | 7,711, 269,355, 6.4 | 1,235,777 | 30 |
| england-z6 | 10 / 87 (39: 14, 14, 10) | 6,958 (159,594) | 38 (48,532) | 68 | 4,221 | 6,855, 118,287, 3.1 | 503,123 | 24 |
| england-z7.5 | 10 / 87 (39: 14, 14, 10) | 14,577 (297,868) | 38 (86,888) | 80 | 3,448 | 27,079, 527,603, 13.3 | 1,183,636 | 24 |
| manchester-z11 | 10 / 87 (53: 13, 25, 14) | 1,423 (128,996) | 328 (32,334) | 173 | 7,281 | 1,893, 77,032, 1.8 | 593,782 | 72 |

### Production after the deploy (b7b7a0c5, PR #358)

Measured on production through the tunnel after `deploy/ship.sh`, same harness, before = 2e39c455.

**1× CPU, DPR 1**: gestures over budget 4 of 75 → 0 of 75.

| View | Gesture | p50 ms | p95 ms | p99 ms | Dropped % | Long tasks (n / max ms) | Long task after (max) | setData / updateData |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| london-z11 | pan | 8.3 → 8.3 | 9.3 → 8.8 | 16.7 → 9.3 | 1.2 → 0.0 | 0 / 0 → 0 / 0 | 0 → 0 | 24/0 → 0/15 |
| london-z11 | zoom | 8.3 → 8.3 | 15.9 → 9.1 | 17.2 → 9.3 | 0.5 → 0.2 | 0 / 0 → 0 / 0 | 0 → 0 | 8/0 → 0/4 |
| london-z11 | fly | 8.3 → 8.3 | 11.2 → 9.2 | 17.3 → 9.4 | 0.0 → 0.0 | 0 / 0 → 0 / 0 | 0 → 0 | 8/0 → 5/0 |
| london-z9.6 | pan | 8.3 → 8.3 | 9.2 → 9 | 9.4 → 9.4 | 2.6 → 0.9 | 10 / 70 → 0 / 0 | 64 → 0 | 24/0 → 0/15 |
| london-z9.6 | zoom | 8.3 → 8.3 | 9 → 9.2 | 16.7 → 9.3 | 0.3 → 0.0 | 0 / 0 → 0 / 0 | 75 → 0 | 8/0 → 0/5 |
| london-z9.6 | fly | 8.3 → 8.3 | 9.1 → 9.1 | 9.4 → 9.4 | 0.2 → 0.0 | 0 / 0 → 0 / 0 | 79 → 65 | 8/0 → 5/0 |
| england-z6 | pan | 8.3 → 8.3 | 9.2 → 9.8 | 9.4 → 10.2 | 1.1 → 0.0 | 0 / 0 → 0 / 0 | 0 → 0 | 24/0 → 0/15 |
| england-z6 | zoom | 8.3 → 8.3 | 9.2 → 9.8 | 9.4 → 10.3 | 0.0 → 0.0 | 0 / 0 → 0 / 0 | 0 → 0 | 2/0 → 0/0 |
| england-z6 | fly | 8.3 → 8.3 | 9.2 → 9.7 | 9.3 → 10 | 0.0 → 0.0 | 0 / 0 → 0 / 0 | 171 → 195 | 10/0 → 5/0 |
| england-z7.5 | pan | 8.3 → 8.3 | 9.2 → 9.7 | 16.7 → 16.7 | 6.8 → 1.9 | 9 / 147 → 3 / 62 | 132 → 0 | 24/0 → 0/15 |
| england-z7.5 | zoom | 8.3 → 8.3 | 9.2 → 9.9 | 16.7 → 16.7 | 0.5 → 0.6 | 0 / 0 → 0 / 0 | 0 → 0 | 0/0 → 0/0 |
| england-z7.5 | fly | 8.3 → 8.3 | 9.1 → 9.9 | 16.6 → 16.7 | 0.3 → 0.3 | 0 / 0 → 0 / 0 | 120 → 111 | 18/0 → 15/0 |
| manchester-z11 | pan | 8.3 → 8.3 | 9.1 → 9.9 | 9.4 → 10.3 | 0.5 → 0.0 | 0 / 0 → 0 / 0 | 0 → 0 | 24/0 → 0/15 |
| manchester-z11 | zoom | 8.3 → 8.3 | 9.2 → 9.5 | 16.7 → 10.2 | 0.8 → 0.1 | 1 / 55 → 0 / 0 | 0 → 0 | 6/0 → 0/5 |
| manchester-z11 | fly | 8.3 → 8.3 | 9.1 → 9.9 | 9.4 → 10.4 | 0.0 → 0.0 | 0 / 0 → 0 / 0 | 0 → 0 | 8/0 → 5/0 |

**Laptop profile (4× CPU, DPR 2)**: gestures over budget 7 of 30 → 5 of 30. Still over: England z7.5 fly (p95 ~42 ms;
this gesture ranged 33–50 ms across baseline runs, so the change is within run-to-run spread) and pan (longest task
135 ms), London z9.6 pan (105 ms). Cause and next step: "What it found" above.

| View | Gesture | p50 ms | p95 ms | p99 ms | Dropped % | Long tasks (n / max ms) | Long task after (max) | setData / updateData |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| london-z11 | pan | 8.3 → 8.3 | 9.3 → 10.2 | 32.6 → 23.6 | 5.2 → 1.5 | 3 / 119 → 1 / 53 | 121 → 57 | 6/0 → 0/6 |
| london-z11 | zoom | 8.3 → 8.3 | 33.3 → 16.2 | 100.1 → 34.6 | 14.4 → 5.8 | 5 / 155 → 0 / 0 | 120 → 0 | 2/0 → 0/2 |
| london-z11 | fly | 8.3 → 8.4 | 9.3 → 10.3 | 66.6 → 33.7 | 8.1 → 4.7 | 1 / 75 → 0 / 0 | 66 → 65 | 2/0 → 2/0 |
| london-z9.6 | pan | 8.3 → 8.3 | 10.1 → 10.3 | 34.2 → 33.9 | 9.3 → 7.9 | 3 / 219 → 4 / 105 | 195 → 69 | 6/0 → 0/6 |
| london-z9.6 | zoom | 8.4 → 8.3 | 23.5 → 10.4 | 101 → 50.3 | 14.8 → 7.0 | 11 / 134 → 1 / 51 | 199 → 0 | 2/0 → 0/2 |
| london-z9.6 | fly | 8.3 → 8.3 | 10.2 → 10.2 | 33.3 → 32.9 | 7.1 → 4.5 | 1 / 70 → 0 / 0 | 183 → 185 | 2/0 → 2/0 |
| england-z6 | pan | 8.3 → 8.3 | 10.1 → 10.2 | 41.6 → 25.9 | 5.0 → 3.5 | 2 / 124 → 0 / 0 | 108 → 0 | 6/0 → 0/6 |
| england-z6 | zoom | 8.3 → 8.3 | 10.1 → 10.1 | 24.3 → 18.3 | 1.5 → 1.1 | 0 / 0 → 0 / 0 | 0 → 0 | 0/0 → 0/0 |
| england-z6 | fly | 8.3 → 8.4 | 10.3 → 10.1 | 34.9 → 41.3 | 7.2 → 7.2 | 0 / 0 → 0 / 0 | 616 → 597 | 4/0 → 2/0 |
| england-z7.5 | pan | 8.3 → 8.4 | 26.9 → 10.2 | 125 → 73.4 | 23.2 → 11.9 | 11 / 498 → 8 / 135 | 437 → 68 | 6/0 → 0/6 |
| england-z7.5 | zoom | 8.4 → 8.3 | 18.4 → 23.9 | 90.3 → 93 | 18.2 → 15.2 | 1 / 77 → 1 / 76 | 0 → 0 | 0/0 → 0/0 |
| england-z7.5 | fly | 8.5 → 8.3 | 33 → 42.2 | 67.9 → 67.4 | 21.1 → 23.2 | 2 / 68 → 2 / 56 | 329 → 309 | 6/0 → 6/0 |
| manchester-z11 | pan | 8.3 → 8.3 | 10.1 → 10.1 | 34.1 → 26.4 | 4.0 → 2.0 | 2 / 73 → 0 / 0 | 56 → 56 | 6/0 → 0/6 |
| manchester-z11 | zoom | 8.4 → 8.3 | 18.3 → 10.2 | 100.3 → 24.6 | 10.3 → 1.7 | 4 / 156 → 0 / 0 | 84 → 0 | 2/0 → 0/1 |
| manchester-z11 | fly | 8.4 → 8.3 | 10.1 → 10 | 24.3 → 10.3 | 0.6 → 0.0 | 0 / 0 → 0 / 0 | 88 → 92 | 2/0 → 2/0 |

## Area tiles (2026-10-25, branch map/area-vector-tiles)

The area boundaries are vector tiles now (migration 116, `api/area_api/map_tiles.py`, `web/src/lib/area-tiles.ts`):
one tile set per kind of area (`lsoa`, `msoa`, `borough`), zoom 5-12 over England (12 overzoomed further in), built
once per boundary set into `area_tile` by `deploy/tools/build_area_tiles.sql` (16,687 tiles, 37 MB of tiles, 42 MB on
disk; 1 min 39 s on ae-pgold) and served immutable at `/api/v1/tiles/areas/<release>/<kind>/{z}/{x}/{y}.mvt` (gzip
from the web route). A feature's id is the area's ONS code as a number (E01000001 → 1000001), so the colours stay
feature-state with no lookup table; tiles carry no values and no properties. Shapes are simplified to 3 units of 4096
(0.375 px, what MapLibre does to GeoJSON). The map still needs each area's box (the in-view scale, the view's region,
fitting an area): `?format=boxes` per piece instead of the polylines. The selected area's outline is its own
full-detail shape (`?id=`). The GeoJSON path stayed for demo data, the London map with `CLOSE_KNIT_ENGLAND` off and
an API without `areaTiles` in its coverage, behind the kill switch `CLOSE_KNIT_AREA_TILES=off`, until review #7 removed
it: the tiles are now the only way area shapes reach the browser (the London map's hold London's areas alone, demo
data's its fixtures), the boxes come from `/api/v1/areas/boxes`.

What went: every pan's `updateData` to MapLibre's worker, and the per-paint copies of up to 27k area features. What
stayed and was trimmed: MapLibre replays the feature-state it holds into each tile that loads, so an area with nothing
left (out of the view's pieces) has its state removed, not set to null; a paint reuses each piece's box features
instead of copying them (`real-geometry.ts mergeBoxes`), which took the England z7.5 pan's longest task from 102-110 ms
to 70 ms at 4× CPU.

Measured locally (this Mac, M-series; the web built from this branch, production's API through the tunnel for
everything but tiles, boxes and outlines, which came from a local API with the same areas; before = the same build
with `areaTiles` left out of the coverage, i.e. the GeoJSON pieces). Files: `interaction-2026-10-25-{geojson,tiles}-local-gpu-cpu4-dpr2.json`,
`2026-10-25-{geojson,tiles}-local-gpu.json`.

**Laptop profile (4× CPU, DPR 2; typical price and good coffee), worst over the two layers**: gestures over budget
5 of 30 → 0 of 30. `npm run perf:interaction` is strict by default since (`PERF_STRICT_INTERACTION=0` reports only).

| View | Gesture | p95 ms | p99 ms | Dropped % | Long tasks (n / max ms) | Long task after (max) |
| --- | --- | --- | --- | --- | --- | --- |
| london-z11 | pan | 10.1 → 10.2 | 25.7 → 15.1 | 4 → 2 | 1 / 53 → 0 / 0 | 61 → 0 |
| london-z11 | zoom | 16.3 → 10.3 | 34.9 → 18.1 | 5.8 → 1.6 | 0 / 0 → 0 / 0 | 0 → 0 |
| london-z11 | fly | 10.3 → 10.2 | 32.3 → 18.6 | 6.4 → 2.3 | 0 / 0 → 1 / 67 | 74 → 0 |
| london-z9.6 | pan | 10.3 → 10.1 | 35.1 → 18.5 | 7.9 → 2 | 2 / 106 → 1 / 51 | 69 → 0 |
| london-z9.6 | zoom | 10.3 → 10.2 | 49.1 → 24.8 | 7.2 → 2.2 | 1 / 51 → 1 / 54 | 0 → 0 |
| london-z9.6 | fly | 10.2 → 10.2 | 32.3 → 10.3 | 5.3 → 2.7 | 0 / 0 → 1 / 72 | 182 → 55 |
| england-z6 | pan | 10.2 → 10.1 | 25.1 → 16.3 | 3 → 1 | 1 / 51 → 0 / 0 | 0 → 0 |
| england-z6 | zoom | 10.2 → 10.1 | 16.6 → 10.3 | 1.3 → 0.9 | 0 / 0 → 0 / 0 | 0 → 0 |
| england-z6 | fly | 10.3 → 10.1 | 42.9 → 10.3 | 7.2 → 0 | 0 / 0 → 0 / 0 | 634 → 225 |
| england-z7.5 | pan | 10.3 → 10.2 | 66.2 → 25.8 | 15.3 → 4.5 | 5 / 151 → 2 / 60 | 73 → 0 |
| england-z7.5 | zoom | 17.6 → 16.7 | 83.2 → 59 | 17.1 → 12 | 1 / 77 → 1 / 91 | 0 → 0 |
| england-z7.5 | fly | 41 → 31.3 | 68.7 → 58.7 | 22.5 → 17.1 | 1 / 58 → 1 / 73 | 336 → 108 |
| manchester-z11 | pan | 10.2 → 10.1 | 26.8 → 15.9 | 3 → 0.5 | 1 / 55 → 0 / 0 | 0 → 0 |
| manchester-z11 | zoom | 10.3 → 10.2 | 25.1 → 17.2 | 2.1 → 1.7 | 0 / 0 → 0 / 0 | 0 → 0 |
| manchester-z11 | fly | 10.1 → 10.2 | 10.2 → 10.3 | 0 → 0 | 0 / 0 → 0 / 0 | 93 → 0 |

What each settled view holds (typical price; "loaded area features" counts tile features, a feature per tile it
touches, against the GeoJSON source's areas):

| View | Tiles in view | Rendered polygons (vertices) | Loaded area features (vertices) | GPU vertices |
| --- | --- | --- | --- | --- |
| london-z11 | 36 → 36 | 2,643 (150,654) → 2,651 (150,257) | 5,209 (146,124) → 3,272 (80,605) | 563,889 → 492,802 |
| london-z9.6 | 30 → 30 | 5,421 (284,528) → 5,460 (279,559) | 6,707 (228,855) → 9,852 (236,338) | 1,135,465 → 1,039,379 |
| england-z6 | 32 → 28 | 4,817 (182,729) → 4,655 (186,192) | 5,923 (103,155) → 7,741 (116,941) | 696,628 → 624,339 |
| england-z7.5 | 24 → 22 | 7,368 (197,775) → 7,377 (195,424) | 22,512 (451,207) → 31,184 (366,302) | 1,053,903 → 921,130 |
| manchester-z11 | 54 → 54 | 935 (91,566) → 914 (89,362) | 1,792 (77,374) → 1,392 (48,808) | 381,881 → 337,607 |

**Open and switch** (`npm run perf:layers`, typical price, crime, census flats, good coffee × London, England,
Manchester; strict budgets): every one within budget before and after. Medians: cold open 811 → 768 ms, warm open
568 → 507 ms, switch 518 → 515 ms, switch again 348 → 348 ms.

**Parity** (`web/scripts/map-parity.mjs`: the same view and layer on both builds, pixels whose colour moved by more
than 30/765): London z11, z9.6, Home Counties z8.5, England z6, z7.5 and Manchester z11 × typical price, crime,
census flats and good coffee differ by 0-5.1% of pixels, all along area edges (the tiles' simplification and
antialiasing); every area has the same colour. Rendered areas match within 0.1% (England z6 crime: 6,416 → 7,033,
the tiles also draw, clear, the MSOAs without a value).

### Production after the deploy (367581c3, PR #360)

Migration 116 applied and the tile store built on production (16,687 tiles, 37 MB, 4 min 48 s, same release
a1-632ef58648dc as ae-pgold), then `deploy/ship.sh`. Measured through the tunnel, before = production at b7b7a0c5.
Files: `interaction-2026-10-25-367581c3-gpu-cpu4-dpr2.json`, `2026-10-25-367581c3-gpu.json`.

**Laptop profile (4× CPU, DPR 2)**: gestures over budget 5 of 30 → 0 of 30 (strict run passed).

| View | Gesture | p95 ms | p99 ms | Dropped % | Long tasks (n / max ms) | Long task after (max) |
| --- | --- | --- | --- | --- | --- | --- |
| london-z11 | pan | 10.2 → 10.1 | 23.6 → 16.6 | 2 → 1 | 1 / 53 → 0 / 0 | 57 → 0 |
| london-z11 | zoom | 16.2 → 10.3 | 34.6 → 18 | 7 → 1.6 | 0 / 0 → 0 / 0 | 0 → 0 |
| london-z11 | fly | 10.3 → 10.1 | 33.7 → 18.2 | 4.7 → 2.9 | 0 / 0 → 1 / 64 | 65 → 0 |
| london-z9.6 | pan | 10.3 → 10.1 | 33.9 → 16.4 | 8.4 → 2 | 2 / 105 → 1 / 50 | 69 → 0 |
| london-z9.6 | zoom | 10.4 → 10.2 | 50.3 → 25 | 7.8 → 2.2 | 1 / 51 → 0 / 0 | 0 → 0 |
| london-z9.6 | fly | 10.2 → 10.1 | 32.9 → 10.3 | 5.3 → 2.7 | 0 / 0 → 1 / 71 | 185 → 0 |
| england-z6 | pan | 10.2 → 10.1 | 25.9 → 10.3 | 3.9 → 1 | 0 / 0 → 0 / 0 | 0 → 0 |
| england-z6 | zoom | 10.1 → 10 | 18.3 → 10.3 | 1.3 → 0.9 | 0 / 0 → 0 / 0 | 0 → 0 |
| england-z6 | fly | 10.1 → 10.1 | 41.3 → 15.5 | 7.2 → 0 | 0 / 0 → 0 / 0 | 597 → 219 |
| england-z7.5 | pan | 10.2 → 10.2 | 73.4 → 25 | 13.9 → 4.4 | 4 / 135 → 2 / 62 | 68 → 0 |
| england-z7.5 | zoom | 23.9 → 17 | 93 → 56.5 | 15.3 → 10.6 | 1 / 76 → 2 / 67 | 0 → 0 |
| england-z7.5 | fly | 42.2 → 26.2 | 67.4 → 49.6 | 24 → 14.5 | 1 / 56 → 1 / 69 | 309 → 102 |
| manchester-z11 | pan | 10.1 → 10.1 | 26.4 → 15.5 | 2.5 → 1 | 0 / 0 → 0 / 0 | 56 → 0 |
| manchester-z11 | zoom | 10.2 → 10.1 | 24.6 → 16.4 | 1.7 → 1.3 | 0 / 0 → 0 / 0 | 0 → 0 |
| manchester-z11 | fly | 10 → 10.1 | 10.3 → 10.3 | 0 → 0 | 0 / 0 → 0 / 0 | 92 → 0 |

**Open and switch** (4 layers × 3 views, strict): 0 of 12 over on warm open, cold open and switch again. Medians:
cold 1,122 ms (the tunnel serves tiles uncompressed and the tile cache was cold), warm 564 ms, switch 510 ms,
switch again 346 ms.

## Area pages (2026-10-25, PRs #366, #367)

The server's whole answer for an area page (HTML read to its end), per level, five areas in five regions (North
East, North West, West Midlands, London, South West). **first** = an area not asked for recently, **warm** = the
same page again straight after. Budgets: **warm ≤ 600 ms**, **first ≤ 1 s**, every area.

`web/e2e-perf/page-load.spec.ts`, run with `npm run perf:pages` (`PERF_STRICT_PAGES=1` by default; `0` reports
only; `PERF_PAGE_LEVELS=lsoa,msoa,borough,region`, `PERF_PAGE_WARM_MS`, `PERF_PAGE_FIRST_MS`). Each page is read
as its own visitor (a fresh `X-Forwarded-For`), as production's API rate limit counts visitors; rows go to
`test-results/page-load.jsonl`. On production, run it inside `deploy-web-1` against `http://127.0.0.1:4180` or
through an SSH tunnel to `deploy-web-1:4180` (`PERF_BASE_URL`).

Production, measured in `deploy-web-1` (node fetch), areas never read before each run:

| Level | Before (main 986fdc72): first / warm | After (#367): first median, max / warm median, max |
| --- | --- | --- |
| LSOA | 574–1,545 / 342–409 ms | 571, 705 / 155, 189 ms |
| MSOA | 828–4,253 / 2,881–2,921 ms (602–627 once the API's standouts were warm) | 525, 669 / 166, 223 ms |
| Borough | 978–1,655 ms, 3 of 5 "Page not found" / 740–2,946 ms | 125, 172 / 131, 307 ms |
| /area/london | 184 / 53 ms | 224 / 97 ms |
| /area/england | not measured | 85 / 53 ms |

Causes, with the evidence:

- **Standouts timed out on every MSOA and borough render** (fetch timing in a second Next process): the API's
  `/areas/{id}/standouts` needs England-wide inputs, ~7 s cold; the web gives up at 2.5 s and the API cancelled
  the shared load with the request, so it was never kept. Now never cancelled, single-flight, and warmed per
  region in the API's warm loop.
- **~300 ms CPU per borough and MSOA render** (CPU profile): `buildIndex` sorted ~35,000 names with
  `localeCompare(…, "en-GB")`, a new collator per comparison, on every call. One `Intl.Collator`, one index
  per load.
- **Borough pages 404 under load**: each region's load was ~35 untagged API reads charged to the web container's
  own 120 a minute; a few regions ran it out, the tree read got a 429, fell back to London's tree and 404'd.
  Reads are now one render per load, a 429 is "didn't load", and all 9 regions stay loaded (reloaded behind).
- **A big borough's profile took 2 s** (EXPLAIN): schools within 1 km scanned all ~20k schools and recomputed the
  borough's point per school. Migration 118 indexes `school (location::geography)`: 0.6 ms.
- **`/property/at/…` was a 500**: the street lookup scanned ~760k streets (630 ms; migration 117 indexes
  `street(borough_id)`: 50 ms) and an outage threw; it is now a "didn't load" page.
- **The home it redirects to (/property/5300057575) said "didn't load"**: its profile's same-type £/m² quartiles
  matched the area on every sale of the type in England (1.2 s for a borough, 2.6 s cold). The area's
  neighbourhoods are listed first and the answer is kept per release, area and type.
