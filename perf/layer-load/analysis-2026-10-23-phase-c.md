# Layer load time: phase C, 2026-10-23

Production before: 42668762 (phase B). After: 7a332f89, PR #350. Both measured the same evening with the same
harness on the GPU ([2026-10-23-42668762-gpu.json](2026-10-23-42668762-gpu.json),
[2026-10-23-7a332f89-gpu.json](2026-10-23-7a332f89-gpu.json)): 117 layers × 3 views, 345 published pairs, each
opened cold and warm and switched to twice. The tunnel caveats of [README.md](README.md) still apply.

## The harness now draws on the GPU

Profiling the warm open showed the main thread idle most of the time and the GPU process busy: the headless shell
Playwright launched draws WebGL on the CPU (SwiftShader). Its first frames cost about a second whatever the map holds
(an empty map with every layer hidden still took 1.1 s to idle). No visitor's browser draws that way. Since phase C
the spec runs Chromium's new headless mode, which uses the machine's GPU (`gl` column in `history.csv`;
`PERF_GL=swiftshader` for the old way). 42668762 was measured again that way, so the table below compares like with
like. A SwiftShader sample of 5 layers (crime, income, census-birth-uk, noise, custom:good-coffee) fell too: warm
median 1.51–1.62 s → 1.11–1.16 s, cold 2.13–2.29 s → 1.80–1.86 s.

## Before → after (ms; median / p90 / worst)

| Metric | View | Before (42668762) | After (7a332f89) |
| --- | --- | --- | --- |
| open, cold | London | 1726 / 4447 / 5384 | **1078 / 1306 / 2349** |
| | England z6 | 2131 / 4639 / 4836 | **1161 / 1339 / 1591** |
| | Manchester | 1752 / 4451 / 4819 (+1 timeout) | **1132 / 1304 / 1566** |
| open, warm | London | 897 / 1024 / 1248 | **617 / 659 / 719** |
| | England z6 | 878 / 1135 / 1452 | **598 / 632 / 801** |
| | Manchester | 883 / 1003 / 1791 | **582 / 619 / 747** |
| switch (first) | London | 542 / 727 / 860 | **536 / 718 / 809** |
| | England z6 | 532 / 726 / 1118 | **530 / 672 / 798** |
| | Manchester | 485 / 728 / 772 | **485 / 705 / 906** |
| switch again | London | 345 / 374 / 454 | **342 / 373 / 459** |
| | England z6 | 342 / 379 / 623 | **340 / 379 / 402** |
| | Manchester | 342 / 370 / 468 | **340 / 365 / 464** |

Criterion layers (custom:\*) at England z6, median / worst: warm 1254 / 1452 → **632 / 643**, cold 2154 / 2979 →
**1358 / 1591**, first switch 766 / 1118 → **730 / 798**, switch again 379 / 623 → **385 / 402**.

Over budget, out of 345:

| | Before | After |
| --- | --- | --- |
| warm open > 1 s | 46 | **0** |
| cold open > 1.5 s | 285 | **7** |
| cold open > 2.5 s | 147 | **0** |
| switch first > 1 s | 1 | **0** |
| switch again > 1 s | 0 | **0** |

The before run's cold tail (p90 about 4.5 s) is mostly the API's hourly rate limit, 2000 default-class requests per
client: the harness drained it about halfway through, and the later cold opens waited on Retry-After. After phase C
an open spends fewer of those tokens (below), and no cold open passed 2.5 s.

## What changed (PR #350)

- **The map takes its layers at the first `style.load`, not at `load`.** `load` waits until every basemap tile is
  parsed and drawn; the areas' shapes and colours started only after it, and two React commits later. They now load
  and tile alongside the basemap. ("Map ready" still waits for `load`.)
- **The first view's requests start with the HTML** (`web/src/lib/map-preload.ts`): `<link rel=preload>` for the
  metric catalogue, the coverage, MapLibre's worker, the basemap style (and a preconnect to its host), London's shapes
  and the layer's pack on a London start, and elsewhere the shapes of the pieces a phone's view holds (the pack too
  when a phone and a laptop see the same pieces, as for all of England at z6). They used to wait for every script, the
  explorer's boot and then the catalogue and coverage.
- **MapLibre's worker is served immutable** from `/maplibre/<version>/` (and cache-first in the service worker): a
  returning visitor no longer revalidates its two modules, two round trips before any tile was parsed.
- **Area labels load after the map's first idle**, as the Tube network does, and are cacheable (they were 0.45 MB on
  every open). The map page no longer prefetches itself (`/?_rsc`, a second server render during boot).
- **The web shares the catalogue, coverage and labels for a minute** (`fetchSharedEvidence`, and the page render's
  own reads): no API read and no rate-limit token per open for them. Browsers already keep them 5–10 minutes. The
  deploy preflight's rate-limit burst now uses `/api/v1/stations` for that reason.
- **Ready-made criteria are MSOAs below z7** (`GET /api/v1/custom-criteria/presets/{id}/pack?level=msoa`, warmed on
  deploy): LSOA medians of value and percentile, summed counts, pair-formula cells from the median counts, painted on
  the MSOA pieces every other layer uses there. 6,855 areas instead of 33,000. A household's own criterion keeps its
  LSOAs.

London at z11 draws as before: the same shapes, colours and labels; the labels and the basemap now arrive alongside
the colours, not before them.

## Still over budget, and why

Cold open > 1.5 s, 7 pairs, 1510–2349 ms (custom:late-night-food and road-collisions and deprivation in London,
custom:indie-cafes, custom:culture and canopy at England z6, custom:good-coffee in Manchester):

- server misses: a pack's time to first byte near 1 s (`custom:late-night-food`, `deprivation`) where the same
  requests take 0.1–0.3 s in the other runs;
- a criterion still fetches its 2.6–3.2 MB LSOA pack before it paints (the panel's ranking and the legend read it),
  and that pack is not named in the head. Next: preload the preset pack, and let the map paint the MSOA roll-up at z6
  without waiting for the LSOA pack.

Through the tunnel every cold open also pays for about 40 script chunks over HTTP/1.1 without Caddy's compression
(about 0.5 s); visitors get them over HTTP/2.

## Budgets now enforced

`npm run perf:layers` fails on a warm open over 1 s and on a switch back over 1 s, on every view
(`PERF_STRICT_OPEN`, `PERF_STRICT_SWITCH`). The cold open (1.5 s) is reported until the items above land
(`PERF_STRICT_COLD=1` enforces it).
