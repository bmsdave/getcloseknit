# Layer load time: after phase B, 2026-10-23

Production before: ef7ea892 ([2026-10-23-ef7ea892.json](2026-10-23-ef7ea892.json)). After: 42668762, PR #348
([2026-10-23-42668762.json](2026-10-23-42668762.json)). Both ran on the same day with the same harness: 117 layers × 3
views. Each layer×view was measured as an open (cold and warm) and as a switch (first, then again). The
`ownership-*` pairs are unpublished, so 345 pairs count. As before, the tunnel skips compression and adds the
laptop ↔ OVH round trip (see [README.md](README.md)).

## Before → after (ms; median / p90 / worst)

| Metric | View | Before | After |
| --- | --- | --- | --- |
| open, cold | London | 4173 / 5616 / 9014 | **2266 / 2500 / 3463** |
| | England z6 | 3394 / 4626 / 6476 | **2093 / 2679 / 3697** |
| | Manchester | 3323 / 4329 / 7631 | **2164 / 2415 / 4507** |
| open, warm | London | 2888 / 3460 / 6627 | **1643 / 1715 / 1823** |
| | England z6 | 2227 / 3304 / 5927 | **1486 / 1957 / 2185** |
| | Manchester | 2363 / 3610 / 11574 | **1550 / 1655 / 1804** |
| switch (first) | London | 1312 / 1560 / 2872 | **577 / 776 / 922** |
| | England z6 | 1601 / 1948 / 3992 | **539 / 782 / 1247** |
| | Manchester | 1163 / 1926 / 5601 | **506 / 747 / 885** |
| switch again | London | 416 / 1265 / 2456 | **413 / 472 / 778** |
| | England z6 | 407 / 1397 / 2440 | **404 / 507 / 1067** |
| | Manchester | 403 / 1196 / 2482 | **403 / 457 / 755** |

Over budget, out of 345:

| | Before | After |
| --- | --- | --- |
| switch again > 1 s | 52 | **1** |
| switch first > 1 s | 279 | **4** |
| open warm > 1.5 s | 345 | 250 |
| open cold > 2.5 s | — | 30 |

Never settled: before, one cold open did not settle. After, also one: student-share @ Manchester cold. It settled in
6 of 6 reruns, so it was transient: one request stalled over the tunnel.

## What changed the numbers (PR #348)

- **Price scale off the paint path.** Non-price layers no longer repaint when the breaks arrive. The 10–11 s cold
  scale no longer shows up (it was 11.6 s on Manchester before).
- **The right month first.** No 404 for census or station access, and crime is no longer built twice. The crime
  switch went from 5.6 s worst to under 1 s.
- **On-disk cache per release** for packs, ranks, shapes, price-scale values and preset packs, plus a map-first
  warm-up. Tier 1 took 583 s on the first deploy, with nothing yet on disk. Tiers 2 and 3 then finished in the
  background in about 30 min: 187k files, about 1 GB. A deploy without a new release only reads these back. Server
  time for a pack fell from 1–6 s cold to about 0.1–0.4 s.
- **Ready-made criteria (custom:\*)** now come from a cacheable GET, painted on the LSOA pieces in view (not 8 MB
  of England's LSOAs). Their warm open went from 3.6–6.6 s to 1.5–2.2 s, and switching back from 1.2–2.5 s to
  0.4–1.07 s.
- **Metric catalogue** revalidated by ETag, so a warm load transfers 0 bytes for it.
- **Retries on 429, 503 and network errors** for map payloads; the panels still fail fast.

## Still over budget, and why

1. **Warm open > 1.5 s (250 pairs: every London pair, 42 England, 93 Manchester).** A warm open needs almost no
   network now, so this is page boot:
   - colours are painted at about 1.0–1.2 s (median 1225 ms London, 1039 England, 1144 Manchester);
   - MapLibre's tiling and drawing of the filled areas takes about 0.4 s more before idle;
   - median long tasks are 1.9 s London and 1.0 s elsewhere: 2.7 MB of JS and the MapLibre and WebGL start.

   London is slowest because its 4,994 LSOAs are drawn at full detail, and the Tube network and landmarks load
   with it.

   Next steps:
   - split the explorer bundle so the first paint needs only the map;
   - draw London at the "wide" detail below z12;
   - defer the transit overlay until after the layer is idle.
2. **Cold open > 2.5 s (30 pairs).** Mostly runs whose requests started late:
   - `/api/v1/map/coverage` answered with a 385-byte body (the shared rate limiter, which the harness trips by
     itself), so the retry waited for Retry-After;
   - `custom:cycling` and `custom:culture` at England load 9 regions of LSOA shapes.
3. **Switching to a criterion layer at England z6 (switch-again 1067 ms for custom:good-coffee; first switch
   1.07–1.25 s for cycling, family, good-coffee and nightlife).** These packs carry England's ~33k LSOAs. A CPU
   profile of the switch shows that MapLibre's feature-state and paint-array updates for 33k features dominate.
   - Fix: pre-aggregate preset packs to MSOAs below z7, like the value packs. That needs the bivariate cells and
     counts rolled up server-side.

## Budgets now enforced

`npm run perf:layers` runs the switch strictly (1 s, switching back) on London and Manchester, where every layer
passes: worst 778 and 755 ms. England's switch and both open budgets are reported, not enforced, until the items
above land.
