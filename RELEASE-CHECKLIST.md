# Close Knit — release checklist

Run from a clean checkout of `main`. There is no hosted CI, so `./gate.sh`
is the merge evidence: paste its tail into the PR.

## Gates

```sh
./gate.sh --mobile --smoke   # from the repository root
```

(`gate.sh` = pipeline/api/deploy unit suites, contracts, compose config incl.
the production overlay, web unit + typecheck + build, Playwright desktop;
`--mobile` adds the mobile project — a Chromium Pixel 7 profile, so it runs
wherever desktop runs; `--smoke` the Docker smoke test.)

## Real-data walk (against `start-real.sh` or the compose stack)

1. `/` opens in **Real** mode on the release the API serves (`/api/v1/metrics`
   `productReleaseId` matches the footer and the layer picker).
2. Price / m² layer paints every LSOA; the legend is visible under *Colour scale*.
3. Search a street (e.g. `Baker Street`), choose an address → *Building sale
   history* lists each sale with date, price, floor area and £/m².
4. Housing tab → the £/m² chart shows axis ticks and Latest/First/High/Low;
   the crime layer's history chart does the same and lists categories.
5. *Permanent area page* link from Overview opens `/area/lsoa/…` (200), and
   `/area/lsoa/E01999999` is a 404.
6. `/postcode/EN1-3EZ` lists addresses with sales tables; `/postcode/SW1A-1AA`
   (no sales) still names its area; `/postcode/nope` is a 404.
7. Property tab with an address selected shows the diligence modules, not
   the "needs a property" gate.
8. Price / m² layer: zoom 12–14 shows street blocks between roads (hover:
   dwellings, area, median £/m²; tap: zooms in), from 15 parcels are coloured; hovering a parcel shows its tooltip and outline, the
   attribution beside the legend names HM Land Registry and OS 100026316, and
   tapping a parcel outlines it and opens *Stock value · restated to <period>*
   with the last sale, floor area, index change and confidence, then the
   building's sale history.
9. *Stock value* layer paints LSOAs; `/methodology#stock-value` explains it.
9a. Price / m² → *Show individual sales*: zoom 11–14 shows merged dots, from 15
    one pin per home; hovering a pin shows the last sale, the one before,
    value today and area growth; *Colour by* (sold price, £/m², value today,
    growth 1/3/5/10/20y) and *Colour scale* repaint; *Filter sales* (years,
    type, build, tenure, price) hides pins from zoom 15; tapping a pin opens
    the building sale history; the HM Land Registry OGL attribution shows.
9c. Environment tab (Real mode): *Road and rail noise* shows shares at 55/65 dB
    and, with a home selected, its own road/rail Lden; *Nearby schools* lists
    schools within 1.5 km with Ofsted grades and GCSE results; flood and
    planning say they are not loaded.
9b. Crime layer legend and timeline come from the release (`/api/v1/metrics`,
    rolling 12 months, latest month = police.uk's latest), not the preview.
9d. v4 G5 (Tasks 23–25, 27; no migration, no data load): `/api/v1/areas/names?ids=uk:lsoa:E01002083`
    answers `"Downhills Park · N22"`, never `Haringey 019A`; Compare, a ranking page, `/area/…/places`
    titles and a `/brief#shortlist=` link name areas that way. `/save-listing#listing=v1.…` makes no
    422 (its area call carries `metric` and `period`) and its area link names the area. `/?layer=deprivation&selected=…`
    asks for 2025-01, not 404; a 404 or 503 in the panel reads in words (no `status 404`), a 503 offers
    Try again. `/property/<uprn>` reloaded 5 times in a minute stays 200 (one profile charge per view).
10. Agents: `python3 agents/smoke_mcp_http.py http://<host>:8080` reports
    `parity … IDENTICAL`; `POST /api/v2/tools/get_home_prices` with
    `{"property_ref": "<uprn>"}` returns `dataMode: "release"`.
11. Map markers (v4.2, no migration, no data load): `/api/v1/schools/points`
    carries `regionRank` / `regionPool` for ranked state schools; Show ›
    Schools shows caps with award plaques and "+N" folds at zoom 12, and the
    filter counts. `/api/v1/tiles/collisions/11/1023/681.pbf` returns cells
    with `n1`/`n2`/`n3` (heat at zoom 10–12; keep it under ~400 KB); at zoom
    15 the collision bursts draw with their popups.
12. Polish (v4.3, Tasks 42, 45, 46, 48, 50, 52; no migration, no data load):
    Layers › Crime › Top 10 opens `/rankings/lowest-crime` (Price per m² →
    `/rankings/least-expensive`); a ranking page has Most | Least and each row's
    On map ↗ opens `/?selected=…&layer=<metric>`. `/api/v1/areas/<lsoa>/since?date=2026-06-30`
    answers `area-since.v1` with `newSales` and `pricePerSquareMetre.median`; Saved
    shows "Since <day>: …" under an area from the second day it is opened. The ≡
    menu says Mortgage rates and Buy-to-let; footers say "Tell me what's new on Close Knit".
13. Homes pages (v4.3, no migration, no data load): `/api/v1/homes/near?latitude=51.5390&longitude=-0.1426`
    answers `homes-near.v1` with up to 4 postcodes (postcode, homes, metres; no addresses) in well under
    a second; a school page shows "Homes near this school" under its header with those postcodes linked to
    their homes. A postcode page shows "Homes here" above the chart; `/guide/crime` shows "Use it" under the
    answer; Check a home from a property page says "last sale <Mon YYYY>"; Watch new listings opens the
    portals' searches for the district (through `/go`) with the price and beds typed in.

## Database migrations (journal + runner, issue #182, backlog #19)

`deploy/migrate.sh` applies the files of `deploy/migrations/` and records each one in the
database's journal, `schema_migrations` (file name, number, sha256, when, how). Each file
runs in one transaction with its journal row: a failed migration leaves neither.

- **Fresh database** (first boot of an empty volume): compose's initdb runs
  `schema.sql`, then `migrate.sh init` applies every migration in number order.
- **Prod** (`deploy/ship.sh`): runs `migrate.sh apply` before the new API and web are
  built and started. If a migration fails, or an applied file was edited, the ship
  stops there and the old API keeps serving.
- **Preflight** (`deploy/preflight.sh`): `migrate.sh status` must list nothing pending
  or changed.
- **By hand**, on the server (`cd /srv/close-knit/deploy`) or locally (drop `-f …prod.yml`):

```sh
export CLOSE_KNIT_PSQL="docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T database psql -U close_knit -d close_knit"
./migrate.sh status      # pending / changed files; exit 1 if any
./migrate.sh apply       # apply what is pending; a second run does nothing
```

Adding a migration: take the next free number (check `origin/main` and open PRs; a test
fails when two files share a number), make it safe to run
again (`IF NOT EXISTS`, `CREATE OR REPLACE`), and do not put `CREATE INDEX CONCURRENTLY`,
`VACUUM` or `BEGIN`/`COMMIT` in it, because the runner wraps it in a transaction. Never
edit a file once it is applied anywhere. Fix it with a new migration instead. If an
applied file did change, `apply` refuses: revert the edit, or run it again with
`./migrate.sh redo <file name>`, which records the new checksum.

**One-off bootstrap of a database that predates the journal** (prod, an old local
volume). `apply` refuses to start without a journal, so nothing re-runs by accident:

1. Confirm the last migration applied by hand. Every file up to it must be in place,
   for example `\d` its tables or indexes. When the journal arrived, main ended at 118
   and the old preflight checked the indexes of 115, 117 and 118.
2. Run `./migrate.sh baseline 118`, using that number. It records every file numbered
   118 or lower as applied, without running it.
3. Run `./migrate.sh apply`. It applies only the later ones (119+), each exactly once.

A snapshot restore (`tools/db-restore.sh`) replaces the server's journal with the snapshot's
when the snapshot has one; otherwise the server keeps its own. Run `./migrate.sh status` after it.
A flag that is on but whose table was never applied degrades (the feature reads nothing).
To spot-check, run e.g. `SELECT to_regclass('property_epc_home')`, which must not be NULL while
`CLOSE_KNIT_EPC_ADDRESSES` is on.

## Rebuilding a data release (order matters)

After **every** activation below (`stage_release.py`, an ETL, a bundle, a rollback), build what the release derives
(migration 128, `api/area_api/release_build.py`: school pools, standouts, the sections' region lists, ready-made
criteria and lenses, the area tree, periods, every layer's start pieces) into `release_artifact`, then the rest of the
map in the background:

    cd /srv/close-knit/deploy && compose="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
    $compose exec -T api python -m area_api.release_build --tiers 0,1 --jobs 4 </dev/null   # exit 1 = a task failed
    $compose exec -d api python -m area_api.release_build --tiers 2,3 --jobs 2 --no-prune

The API no longer warms anything itself: without the build, the first visitor of each school region, standouts
region or layer pays the cold build once (then every worker reads it). `deploy/ship.sh` runs it on each deploy.

1. Crime: `AE_WORK=… python3 deploy/tools/ziprange.py WINDOW <YYYY-MM>` then
   `deploy/tools/etl_crime_release.py <YYYY-MM> <db-url>`.
2. Sales extract: `deploy/tools/etl_sales.py extract` (needs `$AE_DATA/hmlr/pp-complete.csv`).
3. £/m² index: `deploy/tools/etl_price_release.py <YYYY-MM> <db-url>`. After activating
   the new index it reruns every index-dependent rebuild in the `etl_sales.py` load order
   (stock values, growth, market depth, pins, blocks, bands, property sale bands, zone
   analytics, good value), so no derived value is left adjusted by the previous release's
   index (issue #186). An existing database needs every migration applied first:
   `deploy/migrate.sh apply` ("Database migrations" above).
4. Sales + derived values: `etl_sales.py emit`, `etl_sales.py load <db-url>`
   (stock values, area growth, street-block medians, pins), `etl_sales.py release <db-url>`.
   `release` records EPC floor-area linkage health in the release's
   `validation_record.epc_linkage` (B3, #153): `buildings_ge20_sales_zero_floor`
   (blocks with ≥ 20 sales and no floor area on any sale — Duval House shipped
   97/0), `buildings_single_floor_area` (≥ 10 sales sharing one area — the
   Pinnacle E14 9JQ 335 m² pattern), and the overall `floor_area_link_rate`.
   Read it before the release goes live: a non-zero `buildings_ge20_sales_zero_floor`
   means a null building median and homes missing from the per-home layers;
   above `ZERO_FLOOR_BUILDING_FAIL_THRESHOLD` (5) the release is recorded as
   `failed` and NOT activated — fix the linkage (tolerant matcher, extract
   vintage) and re-run. For a known, accepted count re-run with
   `CLOSE_KNIT_ZERO_FLOOR_BLOCK_FAIL_THRESHOLD=<count>` so the release is never stuck `failed`.
   An existing database needs `deploy/migrations/013-sale-keys.sql` before the load
   (building/street keys for `/addresses/{id}/nearby-sales`); `load` fills them.
   It also needs `deploy/migrations/014-market-depth.sql` (`area_market_depth` for
   `/areas/{id}/market` and `/areas/{id}/pack`); `load` calls `rebuild_market_depth()`
   after the growth rebuild. On a loaded database, apply 014 and run
   `SELECT rebuild_market_depth();` once (about 5 s; one row per LSOA and MSOA).
5. Schools: `etl_schools.py <db-url>`; noise: `etl_noise.py download`, `etl_noise.py load <db-url>`;
   then `stage_release.py <db-url> schools-noise <ofsted-src> <ks4-src> <noise-src>`.
6. Station access (`station-access` metric and match factor): an existing database needs
   `deploy/migrations/012-station-access.sql`; then `etl_station_access.py download`
   (cuts walkable ways, stations and entrances from `$AE_DATA/osm/greater-london-latest.osm.pbf`
   with the `osmium` CLI) and `etl_station_access.py load <db-url>` (about 20 s; loads the
   station list, `lsoa_station_walk`, metric rows and utilities as
   `src-osm-station-access-*`, then stages and activates a release that replaces any
   earlier station source). Expect ~600–650 stations and every LSOA with dwellings covered.
   ODbL: only the station list and area aggregates leave the ETL.
6b. Area-clarity tables: an existing database needs `deploy/migrations/015-people.sql`
   through `021-guide-methodology-paths.sql`, applied in number order after 012–014.
   Loaders (usage in each module's docstring): `area_analytics.census_people` (015),
   `area_analytics.market_load` (016, after the sales load), `area_analytics.places_load` (017),
   `area_analytics.flood_risk` (018), `area_analytics.civic` (019), `deploy/tools/etl_epc.py load` (020);
   021 only rewrites metric "Read more" paths.
6c. Friendly names and map labels: apply `deploy/migrations/023-area-labels.sql` **before**
   deploying an API that includes it (area, search and hierarchy reads join `area_label`),
   then `python -m area_analytics.area_labels download|build|load URL` (needs the civic
   ONSPD work file). Expect ~6,000 `area_label` and ~300 `map_label` rows.
6d. Food hygiene layer (`food-hygiene` metric): after the FSA register load
   (`area_analytics.food_hygiene build|load`, migration 031) run
   `deploy/tools/etl_food_hygiene.py load <db-url>` (a few seconds; share of rated cafés,
   restaurants, takeaways and pubs within 800 m of each LSOA point rated 4 or 5, suppressed
   below 5 rated places, as `src-fsa-fhrs-hygiene-*`; stages and activates a release that
   replaces any earlier build). Expect ~4,770 observed and ~225 suppressed LSOAs. OGL v3.
6e. Area price bands (no per-home value): on an existing database, first back it up
   (`pg_dump -Fc`). Then, **before** deploying an API that includes it, apply
   `deploy/migrations/040-area-price-bands.sql` with `psql -v ON_ERROR_STOP=1 --single-transaction`,
   and `deploy/migrations/096-same-carrier-restatement.sql` the same way (same-carrier £/m²
   restatement, issue #185; safe to re-run). 096 reads `metric_value.carrier_geography_id`
   (migration 095): run `deploy/tools/etl_price_release.py <YYYY-MM> <db-url>` (step 3 above)
   before the rebuilds below, or every restatement whose index month fell back reads as mixed.
   Apply `deploy/migrations/098-pre-index-sales-unrestated.sql` the same way (a last sale
   older than the index is kept but never restated, issue #249; safe to re-run), then
   `SELECT rebuild_stock_values('<sales source_release_id>')`, `rebuild_sale_pins(...)` and
   `revalue_city_blocks(...)` so the medians, pins and blocks drop the pre-2006 restatements.
   Then run `SELECT rebuild_area_price_bands('<sales source_release_id>')`; the id is the
   latest `sale.source_release_id`, e.g. `src-hmlr-pp-sales-2026-07`. It takes about 2 min.
   A database that already has 040 applies the file again (it is idempotent): that replaces the
   rebuild function and renames the published layer to "Typical home price"; no rebuild is needed.
   Later sales loads run it through `etl_sales.py`. Expect ~25,000 `area_price_band` rows,
   ~546,000 `area_price_year` rows and 4,994 LSOAs for each `typical-price*` metric.
6f. Street search (homes with no recorded sale): apply `deploy/migrations/042-street.sql`
   (idempotent; the API reads nothing from it until it exists). Download OS Open Names (GB CSV,
   ≈100 MB, OGL) into `~/data/os/opname_csv_gb.zip`, then
   `python -m area_analytics.streets build` and `load <db-url>`. Expect ~55,700 London named
   roads and all but ~20 placed in an LSOA. Check that "66 Valley Road, Kenley" offers Croydon's
   Valley Road, likely CR8 5BU.
6g. Postcode photos: apply `deploy/migrations/043-geograph-photo.sql` (idempotent; the API returns
   an empty list until it exists). Download the Geograph dump (≈250 MB, CC BY-SA 2.0) from a machine
   Geograph's CDN lets through (it challenges the server's address):
   `curl -o ~/data/geograph/gridimage_base.tsv.gz https://data.geograph.org.uk/dumps/gridimage_base.tsv.gz`,
   then `python -m area_analytics.geograph build` (~430,000 photos in London's bounding box) and
   `load <db-url>` (~347,000 placed in an LSOA, ~20 s). `/api/v1/photos/nearby?lat=51.5416&lon=-0.0553`
   lists the Nelsons' drinking fountain first. Commons thumbnails need no load step.
6h. Sold-home bands on the map, and no per-home £/m² (EPC licence pending): after 6e, apply
   `deploy/migrations/044-property-sale-band.sql` with `psql -v ON_ERROR_STOP=1 --single-transaction`
   (backup first, as in 6e). It creates `property_sale_band`, redefines `property_tile()` with a
   `band` (0 = bottom 10% … 5 = top 10%) and without `sppm` (each plot's sold £/m²) or any floor
   area, redefines `sale_tile()` without the pin's `ppm` (cells keep their median over three or
   more homes) and, where `area_price_year` is built, fills the bands
   (`rebuild_property_sale_bands`, about 1–2 min); re-running it is safe and rebuilds them.
   Later sales loads run it through `etl_sales.py`. Expect about 1.18M `property_sale_band`
   rows. Check: `SELECT position('sppm'::bytea IN property_tile(15, 16372, 10896)) = 0` and the
   same for `'ppm'` in `sale_tile(15, 16372, 10896)`, both true. Then ship the web app (it reads
   neither, and the API no longer sends a per-sale `pricePerSquareMetre`); old cached tiles (1 h)
   still carry the figures until they expire, but nothing reads or shows them.
6i. Residents' age and household type (Census 2021 TS007A and TS003, OGL v3): apply
   `deploy/migrations/045-census-age-household.sql` (idempotent; it only widens the
   `census_category` topic check, so an API without the topics ignores the rows). Download the
   two Nomis bulk files next to the others:
   `curl -o ~/data/census/census2021-ts007a.zip https://www.nomisweb.co.uk/output/census/2021/census2021-ts007a.zip`
   and `curl -o ~/data/census/census2021-ts003.zip https://www.nomisweb.co.uk/output/census/2021/census2021-ts003.zip`,
   then `python -m area_analytics.census_people check` (every England LSOA of all nine tables adds
   up, nine `check: <topic> 33755 LSOAs, every row adds up` lines; a renamed column stops it) and `load <db-url>` (reloads every census topic, ~1 min).
   Expect 77 `census_category` rows (67 + 5 + 5), 4,994 London LSOAs with 5 `age` and 5
   `household-type` rows each (24,970 LSOA rows per topic), and London totals of about 8.80M
   residents for `age` and 3.42M households for `household-type`:
   `SELECT topic, sum(london_count) FROM census_category WHERE topic IN ('age', 'household-type') GROUP BY 1`.
   **Country of birth (TS004 world regions per LSOA, TS012 countries per borough; OGL v3).** Back up
   (`pg_dump -Fc`), then apply `deploy/migrations/047-census-country-of-birth.sql` with
   `psql -v ON_ERROR_STOP=1 --single-transaction` (idempotent; it widens the topic check with
   `country-of-birth` and `country-of-birth-detailed` and redefines `rebuild_area_people()` so the
   borough-only TS012 rows survive the rebuild; an API without the topic ignores the rows). Download
   `curl -o ~/data/census/census2021-ts004.zip https://www.nomisweb.co.uk/output/census/2021/census2021-ts004.zip`
   and `curl -o ~/data/census/census2021-ts012.zip https://www.nomisweb.co.uk/output/census/2021/census2021-ts012.zip`
   (TS012 holds country, region and local authority csvs only: the loader reads `census2021-ts012-ltla.csv`
   for London's 33 boroughs). `check` then prints eleven lines: ten `… 33755 LSOAs, every row adds up`
   (the tenth `country-of-birth`) and `check: country-of-birth-detailed 33 boroughs, every row adds up`.
   After `load`, expect 146 `census_category` rows (77 + 11 + 58), 54,934 `country-of-birth` LSOA rows
   (4,994 × 11), 1,914 `country-of-birth-detailed` borough rows (33 × 58) and none below a borough,
   and London totals of about 8.80M residents for both:
   `SELECT topic, sum(london_count) FROM census_category WHERE topic LIKE 'country-of-birth%' GROUP BY 1`;
   `SELECT g.kind, count(*) FROM area_census_count c JOIN area_geography g ON g.id = c.geography_id WHERE c.topic = 'country-of-birth-detailed' GROUP BY 1`
   is `borough | 1914` only.
   **Detailed tables (OGL v3), every leaf a category.** Back up, then apply
   `deploy/migrations/059-census-detailed.sql` the same way (idempotent; it adds seven topics to the check and
   redefines `rebuild_area_people()` so the MSOA-only topics keep their MSOA rows and gain borough sums).
   Download the Nomis files `for t in ts013 ts015 ts022 ts028 ts031; do curl -o ~/data/census/census2021-$t.zip
   https://www.nomisweb.co.uk/output/census/2021/census2021-$t.zip; done` (passports held, year of arrival,
   ethnic group, national identity, religion; TS015 per LSOA, the others no lower than MSOA: the loader reads
   `census2021-ts015-lsoa.csv` and the `-msoa.csv` of the rest), then fetch the two the ONS publishes for
   small areas only through its API: `python -m area_analytics.census_api fetch` (country of birth, 190
   categories, per MSOA; main language, 26, per LSOA; London only, about a minute; it needs the TS012, TS021 and
   TS022 zips to list London's areas) writes `census2021-cob190.zip` and `census2021-lang26.zip`.
   `check` adds `check: <topic> 6856 MSOAs, every row adds up` for ethnicity-detailed, passports,
   national-identity and religion-detailed, `country-of-birth-extended 1002 MSOAs`, `main-language 4994 LSOAs`
   and `year-of-arrival 33755 LSOAs`. After `load`, expect 839 `census_category` rows (146 + 287 + 189 + 51 + 72 +
   57 + 25 + 12), 657,312 MSOA rows for the five MSOA topics (1,002 × 656) and 21,648 borough rows (33 × 656),
   184,778 LSOA rows for language and arrival (4,994 × 37), and London totals of about 8.80M residents per
   topic (8.48M aged 3+ for language): `SELECT topic, sum(london_count) FROM census_category GROUP BY 1`.
   Japanese and Korean, for instance: `SELECT topic, category, london_count FROM census_category WHERE
   category ~ 'japan|korea'` (asian-japanese about 16.9k, asian-korean 11.8k).
6j. Census map layers (602 `census-*` metrics: ethnic makeup's 5 groups and 19 detailed groups
   (TS021), religion, residents' age, household type, tenure, accommodation type and country of birth's
   11 world regions (`census-birth-<region>`, TS004), all per LSOA; then one layer per detailed category with
   at least 1,000 London residents, listed in `deploy/tools/census_picks.json`: 232 ethnic groups
   (`census-ethnic-<group>-<name>`, TS022), 149 countries of birth (`census-birth-country-<country>`), 48
   passports (`census-passport-*`, TS013), 63 national identities (`census-identity-*`, TS028) and 15 beliefs
   (`census-belief-*`, TS031), each LSOA painted with its MSOA's share, quality `fallback`, legend "MSOA
   figures"; 23 main languages (`census-language-*`) and 12 years of arrival (`census-arrival-*`, TS015) per
   LSOA; OGL v3). The list is regenerated only when the tables or the floor change:
   `python -m area_analytics.census_picks write` rewrites the json and `web/src/lib/census-picks.ts` together.
   No migration of its own: after 6i (every census topic loaded, 047 and 059 applied) run
   `deploy/tools/etl_census_layers.py load <db-url>` (about a minute; it reads `area_census_count`,
   writes `metric_value` with no London percentile under `src-ons-census-2021-layers*`, deletes the earlier
   build's rows, including TS012's retired borough countries, and stages and activates a release that
   replaces it). Expect `lsoas: 4994`, `rows: 3006388`, `observed: 474430`, `fallback: 2531958`,
   `load: ...: 602 metrics (507 painted from MSOA figures)` and
   every `census-*` metric with a legend: `SELECT id, jsonb_array_length(definition->'legend') FROM metric_definition WHERE id LIKE 'census-%'`
   (five steps, fewer only where nearly every area is at 0%, as for small groups and countries).
   Then ship the web app, which lists them under People (Ethnic makeup: a group, then All or a detailed
   group, or a group from *Pick a group (MSOA level)*; Country of birth: a world region, or a country from
   *Pick a country (MSOA level)*; Religion's beliefs; Year of arrival; Main language; Passports held; National
   identity), every MSOA figure's legend saying "MSOA figures: each MSOA is one colour", and Homes & area.
   `rank_areas_by_metric` refuses them; they are never match criteria. `/api/v1/metrics` grows by the 542
   definitions.
6k. Estate-sized land titles: after 6h (044), apply `deploy/migrations/046-property-tile-parcel-area.sql`
   with `psql -v ON_ERROR_STOP=1 --single-transaction` (safe to re-run; it only redefines
   `property_tile()` so parcels carry `area` in m²). Ship the web app with it: without `area` the map
   treats every parcel with one dwelling as a home's plot. Old cached property tiles (1 h) lack it.
   How 6i and 6j were run on 2026-10-11 (the host has no psycopg; the database URL never leaves the
   server): copy the census zips (eighteen since the detailed tables) and `population/sapelsoabroadage20222024.xlsx` to
   `/srv/close-knit-data/census-load/data/{census,population}`, and `pipelines/area-analytics-ingest/area_analytics`
   plus every `deploy/tools/*.py` (6j imports `stage_release`) to `/srv/close-knit-data/census-load/code`;
   then, in `/srv/close-knit/deploy`, `URL=$($C exec -T api printenv CLOSE_KNIT_DATABASE_URL)` and
   `docker run --rm --network deploy_default -e DB_URL="$URL" -e AE_DATA=/data -v <load>/data:/data:ro -v <load>/code:/code:ro -w /code python:3.12-slim sh -c 'pip install -q "psycopg[binary]" openpyxl && python -m area_analytics.census_people check && python -m area_analytics.census_people load "$DB_URL" && python etl_census_layers.py load "$DB_URL"'`
   (`$C` = `docker compose -f docker-compose.yml -f docker-compose.prod.yml`). Each census load is its own
   source release (`src-ons-census-2021-people-<sha>`); reloading the same files changes nothing.
6l. School history (results by year, every Ofsted inspection, applications and offers, the
   distance of the last place offered; migration 048). Run after step 5, in this order, with
   `DB=<db-url>` and `PY=.ae-venv/bin/python` (psycopg, pdfplumber, pyyaml; `pdftotext` on PATH):
   1. Back up and migrate:
      `pg_dump -Fc -t 'school*' "$DB" > school-pre-048.dump`, then
      `psql "$DB" -v ON_ERROR_STOP=1 --single-transaction -f deploy/migrations/048-school-history.sql`.
   2. Copy the raw mirrors to the server's `$AE_DATA` (the DfE performance site closes in autumn
      2026; council documents come partly from Wayback): `dfe-performance/`, `ofsted-history/`,
      `ofsted-reports/`, `dfe-applications/`, `admissions/`, and `aework/admissions/review/`.
   3. `$PY deploy/tools/school_history_common.py gias "$DB"` (GIAS links; predecessor URNs).
   4. `$PY deploy/tools/etl_school_performance.py load "$DB"`: 37 lines, then
      `school.attributes: 1648 of 1756 primary schools with KS2 2024/25`.
   5. `$PY deploy/tools/etl_ofsted_history.py load "$DB"` (11,236 inspections, 2,249 schools), then
      `AE_DATA=~/data AE_WORK=~/data/aework/schools python3 deploy/tools/etl_schools.py inspections "$DB"`.
   6. `$PY deploy/tools/etl_school_demand.py load "$DB"` (27,972 rows).
   7. Distances: `for la in lambeth harrow; do $PY deploy/tools/etl_school_distances.py parse $la "$DB" &&
      $PY deploy/tools/etl_school_distances.py load $la "$DB"; done` (Lambeth 422, Harrow 422 rows,
      `publishable=true`). Other councils' terms do not confirm re-use; a review database may load
      them with `etl_school_distances.py all "$DB"` (exit 1 lists the years not loaded), and they stay
      `publishable=false`.
   8. `$PY deploy/tools/school_history_common.py stage "$DB"`: one `rel-…-school-history` release
      adding every new history source (78 on a database that had none) and dropping
      `src-dfe-ks2-2024-25-revised`; a second run prints that nothing is left to stage.
   9. Report text, in the background (about 5 h cold, quick from the copied cache):
      `$PY deploy/tools/etl_ofsted_reports.py run "$DB"`; it only updates `school_inspection` text
      columns, so it needs no staging. `etl_ofsted_reports.py load "$DB"` re-extracts offline.
   How 6l was run on production on 2026-10-12 (same 2,258 schools and Ofsted release as the local
   database, so no loader ran on the server): backup `/srv/close-knit-data/pre-048-2026-10-12.dump`,
   048 through `psql --single-transaction`, then one transaction that `\copy`s the rows exported from
   the local database (new `source_release` rows, `school_observation`, `school_inspection`,
   `school_admission_demand`, only `publishable` `school_admission_observation`, and `school`
   attributes and predecessor links), then step 8 (`stage`) in `docker run python:3.12-slim` with
   `deploy/tools` mounted, as in 6i. Bundle and code: `/srv/close-knit-data/school-history/`.
   A full `etl_schools.py "$DB"` (step 5) empties every school history table: re-run 6l after it.
   New Ofsted MI files (the next is "as at 30 Sep 2026"): add the file to `etl_ofsted_history.py`
   SOURCES, then re-run 5, 8 and 9. OGL v3 except council documents (see DATA-LICENCES.md).
6m. London estate agent directory (migration 051; offices, Companies House companies, verified agency
   websites, Google place ids). Runs locally like the rest of the ETL, after step 5 and 6l, following
   "Estate agent directory" in REAL-DATA.md (re-run `overture_places extract` first: old extracts have no
   website column). Before `verify` and `agency_google match`, copy production's `agency_opt_out` rows into
   the local database with the `ssh ... \copy agency_opt_out TO STDOUT` export and the one-transaction
   `TRUNCATE` + `\copy ... FROM` load given there (REAL-DATA step 5), and check the row count matches
   production. Google: the owner checks the current Places prices first; run `agency_google review` and read
   its 50 lines (a wrong "yes" or "no" means fix the rule first), then `match --limit 50` and stop if
   unmatched outnumbers matched; `DELETE FROM agency_google_place WHERE google_place_id IS NULL;` asks the
   unmatched offices again. Finish with `python -m area_analytics.agency_companies check "$DB"` and report
   its output in the PR, then snapshot and ship as usual (`db-snapshot.sh`, `deploy/ship.sh`; REAL-DATA
   "Shipping the release to production"). There is no baseline yet: after the
   first production load, record the numbers here, and investigate a sharp drop from the previous load.
   The only hard gate is `domain twin mismatches 0` (the command exits 1 otherwise and lists up to 20
   rows). `agency_opt_out` is production-only: opt-outs are recorded on the server, backed up daily by
   `backup-prod-data.sh`, never restored from a snapshot (`db-snapshot.sh` leaves its rows out and
   `db-restore.sh` keeps the server's table).
6n. Kids layers (migration 062; nurseries, road safety, cycle lanes). Back up first (`pg_dump -Fc`),
   apply `deploy/migrations/062-area-kids.sql` with `psql -v ON_ERROR_STOP=1 --single-transaction`
   **before** deploying an API that includes it. Download into one folder the Ofsted Early Years MI
   CSV (latest "as at"), the DfT STATS19 `collision` and `casualty` last-5-years CSVs and TfL's
   `cycle_lane_track.json` and `CycleRoutes.json` (URLs and checksums in DATA-LICENCES.md), then run
   `deploy/tools/etl_kids.py load <db-url> <folder>` (about 10 s; needs the `address`, `postcode_civic`
   and `place` tables). It replaces the three tables, runs `rebuild_area_kids()` and stages and
   activates a release that drops the earlier Kids sources. Expect (2026-10-16 load) about 4,150
   nurseries all placed, ~1,270 matched to a map place, ~47,800 casualties, ~25,150 lines and
   5,996 `area_kids` rows (4,994 LSOAs + 1,002 MSOAs). OGL v3 and TfL open data terms. The same run also
   replaces the `road-collisions` metric (no migration; the definition is seeded by the ETL): pedestrians and
   cyclists hurt per 1,000 residents a year for each LSOA, over `area_population` (so run it after the people
   load). Its output ends `"roadCollisionsLsoas": <n>`, about one per LSOA with residents (~4,990); an
   LSOA with none hurt is an observed 0. The Overview tile reads "No data here" until it has run.
   **Order:** run the whole `etl_kids.py load` (all source CSVs) on production **before** the web deploy that
   publishes the `road-collisions` layer: a published layer with no loaded values paints grey with a blank legend.
6o. Independent schools for Show › Schools (migration 067, `independent_school`; GIAS, OGL v3). The API
   reads the table only once it exists, so 067 can go before or after the deploy. Back up
   (`pg_dump -Fc -t 'school*' -t source_release -t 'product_release*'`), apply
   `deploy/migrations/067-independent-school.sql` with `psql -v ON_ERROR_STOP=1 --single-transaction`, then
   load: `deploy/tools/etl_independent_schools.py fetch` (GIAS's daily edubasealldata, slimmed to London's
   open mainstream independent schools; head teachers and other personal fields are never kept) and
   `load <db-url>`, or on production `psql --single-transaction` with the `independent-school-<stamp>.sql`
   that `etl_independent_schools.py sql` writes (no psycopg needed). Then `etl_independent_schools.py stage
   <db-url>` (in `docker run python:3.12-slim` with `deploy/tools` mounted, as in 6i) stages and activates a
   release adding `src-gias-independent-<stamp>` (an earlier one is replaced). Expect (2026-10-17 load) 419
   schools, 139 single-sex, 128 with a sixth form; `GET /api/v1/schools/points` then ends with
   `kind: "independent"` points. State-school tables are untouched.
6p. v4 D1: Noise and Clean air in Real data, good value inputs (migration 069; Defra OGL v3.0, GLA LAEI 2022
   under the London Datastore terms, see DATA-LICENCES.md). Why Noise said "Unavailable in Real data": the web's
   `REAL_PUBLISHED_LAYERS` left `noise` out and production never ran `etl_noise_layer.py` (no `noise` metric;
   `area_noise` itself is loaded). Both are fixed here: the web lists `noise` and `air-no2`, so **load before or
   together with the deploy**. Bundles (built locally from ae-pgold: same Defra load and homes as production) are
   in `~/data/aework/d1-2026-10-18/` (`noise-layer.sql.gz` 46 KB, `air.sql.gz` 82 KB); rebuild them with
   `python3 deploy/tools/etl_noise_layer.py sql <local-db> noise-layer.sql.gz` and
   `AE_WORK=~/data/aework/health python3 deploy/tools/etl_health.py air-sql <local-db> air.sql.gz` (numpy, psycopg).
   On production, with `DB` the database URL inside the stack:
   1. Back up: `pg_dump -Fc -t metric_value -t metric_definition -t source_release -t 'product_release*'
      -t active_product_release -t health_air_lsoa -t area_health > pre-069.dump`.
   2. `psql "$DB" -v ON_ERROR_STOP=1 --single-transaction -f deploy/migrations/069-area-good-value.sql`
      (new tables and `rebuild_area_good_value()`, which it runs once: ~10 s).
   3. Dry run each bundle, then apply it: `(echo 'BEGIN;'; gunzip -c noise-layer.sql.gz; echo 'ROLLBACK;') | psql "$DB" -v ON_ERROR_STOP=1`,
      then `gunzip -c noise-layer.sql.gz | psql "$DB" -v ON_ERROR_STOP=1 --single-transaction`; the same for
      `air.sql.gz`. Each stages and activates a release (`rel-…-noise-layer`, then `rel-…-air`, ~20 s each: the
      stage rebuilds `area_rank` and `area_good_value`). The noise bundle stops if `area_noise` is not
      `src-defra-noise-round4-2022-road-rail-air`; a rerun of either changes nothing.
   4. Ship the web and API.
   Expect: `noise` 4,993 LSOA rows (4,988 with a value, 5 suppressed, median 40.6%); `air-no2` 4,993 (4,988 with a
   value, 13.6–35.9 µg/m³, median 21.2); `health_air_lsoa` 4,993; `area_health` 6,028 with `no2`; `area_score_vector`
   4,994; `area_good_value` ≈ 4,475 all-homes, 2,458 flats, 1,459 terraced, 675 semi and 149 detached rows (local
   2026-10-18 figures; production's own sales may move them slightly). Check: the Layers panel lists Noise and Clean
   air without "Unavailable in Real data"; `uk:lsoa:E01001266` (Greenford) shows Air NO₂ 22.6 / PM2.5 9.4 µg/m³ and
   `GET /api/v1/good-value?homeType=semi&areas=uk:lsoa:E01001266` (API container) gives valueRatio ≈ 0.75.
6q. v4.1 My match model (Tasks 21, 21d, 21e, 8, 22 decoder). No migration (071 stays unused) and no data load: the
   model reads the evidence already there. Needs 069 for `sort=best-value` (without it the sort returns score order)
   and reads Noise from `area_noise` when the `noise` map layer (6p) is not loaded. **Ship the API and the web
   together**: the API now answers `match-pack.v2` (the web reads v1 and v2), and agents' links are `#profile=v3.`
   (the web of this release reads them). Checks on production after the ship:
   1. `POST /api/v1/matches` with `contracts/fixtures/agent-share-links.json` › `v2Cases[0].profile` answers 200,
      `schemaVersion: match-pack.v2`, `criteria[0].id: "zone"`, every value with `rank`/`percentile` (or `excluded`),
      `bottom` with 10 entries; `?sort=best-value` gives `valueRank` 1… on the first rows.
   2. A saved v1 search still matches: the panel's own `POST /api/v1/matches` (preference-profile.v1) answers 200.
   3. `GET /api/v1/match-criteria/disorder` (API container) lists ~4,990 LSOAs with `regionPercentile`;
      `…/noise` too; `…/census-religion-muslim` is 400.
   4. MCP `find_areas` gives a `briefUrl` with `#profile=v3.`; opening it shows My match with the same criteria;
      an old `#profile=v1.` link still opens; a truncated one opens the own search with the toast
      "This link couldn't be opened · Start fresh".
6r. v4.1 after-match (Tasks 9, 35, 38, 41; migration 072, no data load). Portal links: My match zones open on
   Rightmove (drawn area / borough REGION search), Zoopla (drawn area) and OnTheMarket (postcode districts), all
   through `/go`; a weekly check records whether the unofficial formats still hold.
   1. `psql "$DB" -v ON_ERROR_STOP=1 --single-transaction -f deploy/migrations/072-portal-link-check.sql`
      (one empty table `portal_link_check`; safe to run again). Without it the API treats every format as on.
   2. Ship the web and API.
   3. First check by hand, from the api container: `docker compose exec api python -m area_api.portal_link_check --record`
      prints three `ok` lines (rightmove draw "Untitled (Drawn Area)" with a result count, rightmove borough
      "Lambeth", zoopla draw "built only") and stores 3 rows. Then add the weekly cron on the host (deploy/README.md §8a).
   4. Check: `POST /api/v1/portal-links` with `{"market":"buy","maxPrice":800000,"minBedrooms":2,"zones":[{"kind":"borough","id":"uk:lad:E09000022"}]}`
      answers a Rightmove link with `shape=borough&borough=E09000022`, a Zoopla `shape=draw` link and up to 3 districts;
      `GET /go/rightmove?kind=zone&market=buy&max_price=800000&beds=2&from=web&shape=borough&borough=E09000022` is a 302
      to `…/find.html?locationIdentifier=REGION%5E93971…`. A failed check (exit 1) sends that portal and kind to the
      districts on its own; `CLOSE_KNIT_PORTAL_DRAW_OFF=rightmove` does it by hand (FLAGS.md).
   5. Walk: Your search › a zone chip › "Open on ▸"; under the top 10 "Homes for sale in these areas"; Compare's
      "Next" row and the brief's "Next step"; Brief › Copy link shows the review (budget, exact places, notes
      left out) before anything is copied; Stamp duty → Buy-to-let → Check a home keep `?price`.
6s. v4.1 My match panel (Tasks 21c, 21d UI, 21e panel, 8 Where card, 22 toasts, 28, 36, 13 My match sheet). Web only:
   no migration, no data load, no API change but one usage event (`match_edit`, allowlisted in `area_api/usage.py`:
   ship the API with it or the events are dropped, nothing breaks). The panel sends `preference-profile.v2` to
   `POST /api/v1/matches` (needs 6q's API) and shares `#profile=v3.` links. Saved searches migrate on load.
   Walk on production (desktop 1440 and phone 390, Day and Night):
   1. A fresh browser: the first-visit card has a red "Find my area" (the round ✦ is a calm chip meanwhile); it opens
      My match on Budget · Travel to · What matters with the price field focused; £650k + Enter colours the map and
      lists "N of 4,994 areas left" and the ten.
   2. Travel to King's Cross (35 min), + Safer streets, + Good schools: chips with −N and 61% / 28% / 11%; with under
      300 areas left "X cuts most · Soften +N areas" softens and the toast's Undo puts it back.
   3. Drag ≡ (long-press on the phone) Good schools to the top: "Good schools now #1 · top 10 re-sorted", rows show ▲▼.
   4. Bottom 10 shows "Least like your search" and the address gains `list=bottom` (the map's pins, map track).
   5. + Where… › Station or Draw on map: the Where chip; Show has no "Areas you drew".
   6. Phone: Try an example opens the My match sheet lowered (London on screen, not zoom 9); ✕ leaves My match.
   7. An old saved search (from before) opens as the list with its priorities as range chips.
6t. v4.2 match polish (follow-ups of the v4.1 reviews). No migration, no data load. Ship the API with the web: the
   web asks `POST /api/v1/zone-shapes` (new) and reads `valueAreas` on the match pack (new field; an older API just
   hides Best value). Walk on production:
   1. My match with nothing chosen: the map is the plain basemap and the legend says "Add a budget or what matters
      to colour the map" (no ramp, no grey areas). £650k + Enter: chip "Budget ≤ £600k Must", card "Typical price
      here ≤ £600k · stretch to £650k", the map colours.
   2. Best value shows under the top 10 only when some matched area has 20+ sales (migration 069 loaded); without
      `area_good_value` rows there is no Best match | Best value switch at all.
   3. A must that rules an area out: its card's "Out" pill is grey-hatched, never red.
   4. + Where… › Station (e.g. Brixton ≤ 10 min) and a borough: each is outlined on the map like a drawn area.
      Check: `POST /api/v1/zone-shapes` with `{"zones":[{"kind":"borough","id":"uk:lad:E09000022"}]}` answers
      `zone-shapes.v1` with one (Multi)Polygon, `cache-control: no-store`.
   5. Your search › Share › Confirm share: the map toast "Link copied." for 3 s (no second line in the panel).
6u. v4.2 green (Tasks 3 street-tree heat, 6 green cover at every zoom, 7 one Green & trees item). No migration.
   The street-tree heat (zoom 12-14) is an inline API query on migration 064's `street_tree` (no new function).
   Green cover's zoom 8-10 tiles are a data load into migration 066's `canopy_tile`:
   1. On the Mac with the NDVI mosaic (`~/data/aework/nature/ndvi.npy`), in `deploy/tools`:
      `AE_WORK=~/data/aework/nature python3 etl_canopy.py pyramid canopy-pyramid.sql.gz`
      prints zoom 8: 4, zoom 9: 4, zoom 10: 9 tiles; `bundle: … 17 tiles` (~130 KiB).
   2. Copy it to the host, dry run, then apply (it replaces zoom 8-10 only; zoom 11-14 stay as loaded):
      `(echo 'BEGIN;'; gunzip -c canopy-pyramid.sql.gz | sed '/^BEGIN;$/d;/^COMMIT;$/d'; echo 'ROLLBACK;') | psql "$DB" -v ON_ERROR_STOP=1`,
      then `gunzip -c canopy-pyramid.sql.gz | psql "$DB" -v ON_ERROR_STOP=1`.
      Check: `SELECT z, count(*) FROM canopy_tile GROUP BY z ORDER BY z` gives 8: 4, 9: 4, 10: 9 and 11-14 unchanged.
      Before the load the map simply shows no cover below zoom 10 (204s), as today.
   3. Ship the web and API.
   4. Check: `GET /api/v1/tiles/canopy/10/511/340.png` is a 200 PNG; `GET /api/v1/tiles/street-trees/12/2046/1362.pbf`
      is a 200 tile in under a second (local copy: 0.36 s, ~50 KB; zoom 11 is a 204).
   5. Walk (phone 390 and desktop, Day and Night): Layers › Nature has Green & trees and Wildlife seen only; Green & trees
      shows Area score · Green cover · Green streets with one line under them; old `?layer=canopy` and `?layer=green-streets`
      links open those views. Green cover at zoom 9 shows London's green belt and parks with no "Zoom in". Show › Street
      trees at Notting Hill, zoom 12-15: a soft green heat with no numbers, "Street trees Fewer … More" in Show; from 16
      single dots; with Road collisions on too the collision heat sits over the trees'. Green cover + Street trees at
      zoom 14: no tree heat ("Over Green cover: a dot per tree from zoom 16").
6v. v4.2 colour-perf (Tasks 43, 29, 32; the geometry route went with 6zh). No migration, no data load. Ship the
   API with the web: the map asks for
   `GET /api/v1/areas/geometry?carrier=lsoa&format=polyline` and the price scale for `GET /api/v1/metric-values/
   price-per-square-metre?periods=…` (an older API still works: GeoJSON is read as before, and the scale falls back
   to a pack per year). The release build (`area_api.release_build`) builds the price pack and the periods.
   Walk on production (desktop and phone, Day and Night):
   1. `curl -s -o /dev/null -w '%{size_download} %{time_total}\n' "$WEB/api/v1/areas/geometry?carrier=lsoa&format=polyline"`:
      about 680 KB (the GeoJSON was 3.4 MB); a second call answers in milliseconds.
   2. A minute after the API restarted: `curl -s -o /dev/null -w '%{time_total}\n' "$WEB/api/v1/price-scale?mode=real&release=<id>"`
      well under a second (was 5.6 s cold).
   3. A fresh browser opens on blue (cheap) to red (dear) price colours, ≡ › Map › Colours lists "Colour-blind safe"
      first and chosen; a browser that had chosen "Traffic light" (stored `close-knit.palette=current`) keeps it.
   4. Night: the round Layers, Show, locate and ± buttons stand off the navy map with a light rim; no white road-number
      shields; parks are not muddy brown under warm colours.
   5. Zoom 15 deep link (`/?selected=uk:lsoa:E01000001&lat=51.5203&lng=-0.096&zoom=15`): "Loading map" shows top-centre
      until the colours paint; at zoom 15+ the area colour is a tint and the streets read through it.
6x. Combined A-level rank, state and independent (issue #201; migration 094, `school_sixth_form_rank`;
   DfE Compare school and college performance, OGL v3.0, see DATA-LICENCES.md). The ETL's step 4
   (`deploy/tools/etl_school_performance.py load`) now ranks every sector's sixth forms on A level average points
   per entry (20+ A level students; ties share the best rank); independents' figures go in this table only, never
   `school_observation` (state-only FK). The API reads the table only once it exists, so 094 can go before or after
   the deploy. Back up
   (`pg_dump -Fc -t school_sixth_form_rank -t school_observation -t source_release -t 'product_release*'`), apply
   `deploy/migrations/094-schools-ks5-combined-rank.sql` with `psql -v ON_ERROR_STOP=1 --single-transaction`, then
   re-run step 4 (the school performance load) so the ranks are computed for every loaded year. Expect
   `GET /api/v1/schools/points` to carry `aLevelRank` on ranked independent sixth forms and
   `GET /api/v1/school-card/<urn>` to carry `combinedSixthFormRank` with the selection note. State KS2/KS4 ranks
   (`school_national_rank`) are untouched.
6w. v4.3 pages frame (Tasks 16, 17, 40, 37). No migration, no data load. Ship the API with the web: the borough
   page asks `GET /api/v1/areas/uk:lad:<code>/standouts` (an older API answers 400; the page then leaves out
   its verdict, tags and tiles, and the Areas list has no school strip). The first borough request after a
   restart reads every London neighbourhood once (a few seconds); later ones are a lookup.
   Walk on production (desktop 1440 and phone 390, Day and Night):
   1. `curl -s "$WEB/api/v1/areas/uk%3Aborough%3AE09000009/standouts" | jq '.carrier, (.tiles|length), (.neighbourhoods|length), .tags'`:
      `"borough"`, 12, about 196, tags saying "of boroughs" (never income or social renting).
   2. `/area/lad/E09000009` (Ealing): breadcrumbs, verdict, tags, 12 tiles, chips At a glance … Questions, the
      Areas list sorts by Price, Crime, Schools, A–Z (`?sort=` in the address) and each row opens its area page.
   3. `/area/lsoa/<code>`, its `/places`, `/school/<urn>`, `/property/<uprn>`, `/postcode/<pc>`, `/tools`, `/guide`:
      the header, the cards and the footer share one left and right edge (1120 px at 1440).
   4. `curl -sI "$WEB/area/lsoa/e01003998" | grep -i -e '^HTTP' -e '^location'` → 308 to `/area/lsoa/E01003998`;
      `/postcode/sw1a1aa` → 308 to `/postcode/SW1A-1AA`.
   5. `/property/<uprn>`, `/postcode/<pc>` and `/school/<urn>` carry a canonical, og:url, an og:title ending
      "· London Close Knit" and a JSON-LD script; `/area/lsoa/E09999999` is a 404 titled "Page not found".
   6. The chosen chip under the area page's tiles, the tools tab and a pressed filter chip are all the cherry (Night:
      sun) fill with a dashed stitch; the map's bar and every page's header show the same house and "close knit".
6x. Open data wave A data (migrations 080-088, applied 2026-10-18). Loaded on production 2026-10-19 from one
   bundle built from ae-pgold after each `etl_*.py download` + `load` there (REAL-DATA.md): UK HPI, rent trend,
   council tax bands, short lets, development pipeline + Opportunity Areas, Ofcom mobile, HMO registers, future
   transport. Not loaded: ownership (CCOD/OCOD needs an HMLR account). Bundle and table backup (`pre-load.dump`:
   metric_definition, source_release, product_release*) in `/srv/close-knit-data/open-data-a-2026-10-19/`;
   dry run rolled back first, then `--single-transaction`. Release `rel-202610190546-open-data-a` (+9 sources).
   Rows: borough_hpi 63,725, borough_rent_series 41,580, area_council_tax_band 6,029, area_short_let 6,029,
   development_pipeline 18,786, opportunity_area 65, area_opportunity 2,587, area_pipeline 6,029, area_mobile 33,
   hmo_register 33 (15 published), hmo_postcode 11,406, licensing_scheme 57, area_hmo 2,711, future_transport 14,
   area_future_transport 6,029, metric_value 44,785 (11 layers). The web lists all 11 in REAL_PUBLISHED_LAYERS.
6y. v4.5 map fixes (round 2: Tasks 29, 2, 32). No migration, no data load, no API change; web only. The map's
   section reads for one area go to the web's new `POST /api/v1/sections` (one area, at most 40 URLs), which reads
   them in process as one render and streams each back as it is read (NDJSON, so a slow one never holds the rest): `CLOSE_KNIT_INTERNAL_KEY` must be set for web and API (it is, since v3), or the
   API charges each read as before. `NEXT_PUBLIC_SECTION_BATCH=off` at build time, or `close-knit.section-batch=off`
   in a browser's localStorage, sends every section on its own again. Walk on production:
   1. Phone 390, `/?selected=uk:lsoa:E01000001`: the City blocks are a light tint with coloured edges, not solid red;
      the pill under the search reads "Price per m² · Actual ▾"; `?layer=noise` reads "Noise · Road and rail ▾".
   2. A fresh phone visit: the intro card sits under the pill, which still names the layer.
   3. Desktop, `?layer=noise`: the legend reads "Noise · % of homes at 55 dB or more · Dec 2022" (wrapped, no "…");
      Night: the round controls are a lighter navy with a clear rim.
   4. Phone on its side (844 × 390): the slim legend shows "Price per m²" in full.
   5. DevTools › Network on `/?selected=uk:lsoa:E01000001&layer=crime` (desktop): one or two `sections` POSTs instead
      of about 20 `areas/…` reads, no 429; "Back to the map" from the area page the same.
6z. EPC-only homes (`CLOSE_KNIT_EPC_ADDRESSES`, FLAGS.md): apply `deploy/migrations/089-epc-addresses.sql`
   (a new table only; safe before or after the API), then re-run `deploy/tools/etl_epc.py extract` (it now also
   writes `epc-london-addresses.csv`) and `load <url>`, which fills `property_epc_home` with London UPRNs the
   spine does not know whose postcode has a spine home. An older extract without the address file leaves the
   table as it is. The rows carry the EPC source release, so they are served under the active release that
   includes it. Unset, the flag is on while `CLOSE_KNIT_ACCESS=private`: set `CLOSE_KNIT_EPC_ADDRESSES=0` in
   `deploy/.env` before loading if the owner has not decided to show them in the preview. Check:
   `SELECT count(*) FROM property_epc_home` and, with the flag on, a postcode's homes include rows with
   `"addressSource":"epc"`; with it off, `withheld` lists `epcAddresses` and no such row appears.
6za. Layers v5 batch 1 (Typical rent, Flood risk, Good schools nearby, Student areas): apply
   `deploy/migrations/100-layers-v5-batch1.sql` (functions only), then `python3 deploy/tools/etl_layers_v5.py load
   "$PROD_URL"` (no download; it reads borough_rent, dwelling_flood, school_national_rank and the TS066 counts and
   stages one release `rel-…-layers-v5`), then ship the web and API. Check: `SELECT metric_id, count(*) FROM
   metric_value WHERE metric_id LIKE ANY (ARRAY['typical-rent%', 'flood-risk', 'good-schools%', 'student-share'])
   GROUP BY 1` (32 boroughs per rent view, about 4,994 LSOAs for the rest); `/api/v1/metrics` lists the 7 with
   `student-share` carrying `"descriptiveOnly": true`; `/?layer=student-share` at zoom 13+ shows university dots.
6zb. Layers v5 batch 2 (Supermarket, GP, Broadband): apply `deploy/migrations/101-layers-v5-batch2.sql` (functions
   only), then `python3 deploy/tools/etl_layers_v5.py load "$PROD_URL" supermarket-walk gp-walk broadband-gigabit`
   (no download; it reads place, area_health and area_broadband and stages one release `rel-…-layers-v5`), then
   ship the web and API. Check: `SELECT metric_id, count(*), count(value), min(value), max(value) FROM metric_value
   WHERE metric_id IN ('supermarket-walk', 'gp-walk', 'broadband-gigabit') GROUP BY 1` (about 4,994 LSOAs each);
   `/api/v1/metrics` lists the 3; `/?layer=broadband-gigabit` paints Homes & area › Broadband.
6zc. Green streets' band (owner, 2026-10-20, Trees-green-streets board Option 1): apply
   `deploy/migrations/102-green-street-bands.sql` (replaces the `green_street_tile` function only; no table, no
   data load, no `rebuild_green_streets()` needed; safe before or after the web deploy, which until then draws
   the lines without the band; tiles cached up to an hour). Check: `SELECT length(green_street_tile(15, 16377,
   10887))` grows against the old function and `SELECT green_street_tile(14, 8188, 5443)` returns in well under
   a second, and on the map Layers › Nature › Green streets at zoom 16 shades 35 m either side of each
   tree-lined street.
6zd. England map delivery (2026-10-22, branch england/c3-map; after the core's 103 and its geography bundle):
   apply `deploy/migrations/105-area-geometry-tile-index.sql` (replaces the Martin `area_geometry` function only:
   index-backed tile filter, LSOAs from z11 and MSOAs from z9; no data). Ship the API and web together. With
   `CLOSE_KNIT_ENGLAND` off the map is London's as before (unchunked packs and shapes stay London only). Check:
   `SELECT length(area_geometry(11, 1023, 681))` returns the same bytes in about a tenth of the old time;
   `curl $API/api/v1/map/coverage` says `"coverage": "england"` with the flag on (`"london"` and no chunks off);
   `curl "$API/api/v1/value-packs/price-per-square-metre/<period>?chunk=E12000007"` matches the unchunked pack's
   London values; the map at zoom 6 shows England's LADs, at zoom 11 London's neighbourhoods.
6ze. England fixes (2026-10-23, after 103-114 and the England bundles): apply
   `deploy/migrations/115-england-fixes.sql` (`metric_value_metric_release_period_idx`, already on production by
   hand, `IF NOT EXISTS`; `rebuild_area_rank()` ranking best-primary within the area's region), then
   `gunzip -c ~/data/england-2026-10/bundles/fix-ranks/load.sql.gz | psql "$DB" -v ON_ERROR_STOP=1` (one
   transaction, ~6 min: area_rank and area_good_value rebuilt; no source or product release), then ship
   the API (its caches hold the old ranks until it restarts). Remove `CLOSE_KNIT_DB_STATEMENT_TIMEOUT_MS=60000`
   from `deploy/.env`: the catalogue now reads in well under a second. Check: `deploy/preflight.sh` passes the
   index line; `SELECT DISTINCT ranked FROM area_rank WHERE rank_id = 'best-primary' AND geography_id IN
   ('uk:lsoa:E01001551', 'uk:lsoa:E01001552')` is London's pool (1,265 on ae-pgold), not 1,023; a Bolton LSOA's
   `/api/v1/areas/<id>/layers` lists flood-risk and noise. The bundle README lists every London move.
6zf. Area vector tiles (2026-10-25, branch map/area-vector-tiles): back up nothing (new tables and functions
   only), apply `deploy/migrations/116-area-vector-tiles.sql` with `--single-transaction -v ON_ERROR_STOP=1`,
   then build the tile store: `psql ... -v ON_ERROR_STOP=1 -f - < deploy/tools/build_area_tiles.sql` (one
   statement per kind and zoom, ~2 min on ae-pgold, 16.7k tiles, ~40 MB; until it finishes the API makes tiles on
   the fly). Ship the API and web together; rebuild the store whenever area_geography gains areas (a new
   `area_tile_release()`, new URLs). Check: `curl $API/api/v1/map/coverage` carries `areaTiles`;
   `curl -sI "$API/api/v1/tiles/areas/<release>/lsoa/11/1023/681.mvt"` is 200 and immutable; the map at London
   z11 and England z6 is coloured as before. (The kill switch `CLOSE_KNIT_AREA_TILES` went with 6zh: the tiles are
   the only way area shapes reach the map.)
6zg. Area shapes that fit together (2026-10-26, branch fix/coverage-topology; after 6zf): back up the tile tables
   (`pg_dump -Fc -t area_tile -t area_tile_build`), apply `deploy/migrations/119-area-shape-coverage.sql` with
   `--single-transaction -v ON_ERROR_STOP=1`, then rerun `deploy/tools/build_area_tiles.sql` as in 6zf (~5 min of
   shapes, then the tiles of the new `a2-` release; the previous release's tiles stay until the next build, so the
   running API serves them until the ship restarts it). Ship the API and web together. Check:
   `python3 deploy/tools/area_topology.py <db url>` prints no FAIL (coverage, nesting, labels, sample tiles);
   `curl $API/api/v1/map/coverage` carries `areaTiles.release` starting `a2-`; the London/Essex border at z9, z12
   and z16 shows no dark wedge or light sliver.
6zh. Ranks in the country stored (2026-10-26, step 5 of docs/architecture/global-geography.md): `deploy/ship.sh`
   applies `deploy/migrations/124-metric-ranks.sql`, which defines `rebuild_metric_ranks(release)`, makes
   `activate_product_release()` run it and runs it once for the live release: it fills the empty
   `metric_value.country_percentile` (~5 min and 3.65M rows on an ae-pgold copy; the old API keeps serving, it read
   its own ranks). From then on every activation rebuilds them (~50 s on ae-pgold when nothing changed). Nothing to
   back up: the column was empty. Check: `SELECT count(country_percentile) FROM metric_value` equals the count of
   rows with a value and a `region_percentile`; with the flag on, a pack's `countryPercentile` matches the previous
   API's for the same area and month. Rollback: re-create `schema.sql`'s `activate_product_release` and
   `UPDATE metric_value SET country_percentile = NULL WHERE country_percentile IS NOT NULL`, with the previous API.
6zi. Tiles only (review #7, branch claude/b2-tiles-only; after 6zh): `deploy/ship.sh` applies migration 125 (drops
   Martin's `area_geometry(z,x,y)`, adds `area_region_tile_mvt`; no data, no rebuild). Ship the API and web together:
   the geometry route (GeoJSON, polylines, `format=boxes`) is gone, the map reads boxes from `/api/v1/areas/boxes`.
   Martin left the compose files: `docker compose ... rm -sf tiles` on the server if its container is still there.
   Check: `curl -s "$API/api/v1/areas/geometry?carrier=lsoa"` is no FeatureCollection; `curl -s
   "$API/api/v1/areas/boxes?carrier=lsoa&chunk=E12000007" | head -c 200` is `area-boxes.v1`; with
   `CLOSE_KNIT_ENGLAND` off, `curl $API/api/v1/map/coverage` names its own `areaTiles.release` and a tile on the
   London/Essex border (`/lsoa/9/256/169.mvt`) holds London's areas alone; the map at London z11, England z6, demo
   data (`?mode=demo`) and a home page's mini map are coloured as before.
6zj. Metric coverage stored (2026-10-26, step 6 of docs/architecture/global-geography.md, data part; after 6zi):
   `deploy/ship.sh` applies `deploy/migrations/126-metric-coverage.sql`, which creates `metric_coverage`, defines
   `rebuild_metric_coverage(release)`, makes `activate_product_release()` run it after the ranks and runs it once
   for the live release (one pass over the release's `metric_value`, ~16 s on the local copy). Ship the API and web
   together: the API reads the table in `/api/v1/metrics`. Check: `curl $API/api/v1/metrics` carries `coverage` on
   each metric; with the flag on, Layers says "London only" on exactly the metrics whose only region in
   `SELECT DISTINCT metric_id, scope_id FROM metric_coverage WHERE scope_id LIKE 'uk:region:%'` (live release) is
   London: on the local copy short lets, HMO, pipeline, future stations, Green & trees, wildlife, stock value, and
   crime (England's crime rows are not in its release); Clean air and Student areas lose it where England is
   loaded. Rollback: re-create 124's `activate_product_release` and `DROP TABLE metric_coverage`, with the
   previous API.
6zk. Static area tiles (review #8, branch claude/b3-static-pmtiles; after 6zj): `deploy/ship.sh` applies migration
   127 (the `area_pmtiles` table), then, since it records no build, runs `deploy/tools/area_pmtiles.py` in a one-off
   api container into `/srv/close-knit-tiles` (~20 s on ae-pgold: 16.7k tiles, 37.8 MB for England, 2.8 MB for
   London's own set), and recreates Caddy once for its new `/srv/tiles` mount (a second without the site). Nothing to
   back up. Rebuild after new boundaries (or after `build_area_shapes()`):
   `docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm --no-deps --user 0 -v /srv/close-knit-tiles:/out -v /srv/close-knit/deploy/tools:/tools:ro api python /tools/area_pmtiles.py /out [--shapes]`,
   then restart the api (it reads the newest build once per product release). Check: `curl $API/api/v1/map/coverage`
   names `areaTiles.url` `/tiles/areas-<release>-{kind}.pmtiles`; `curl -sI -H 'Range: bytes=0-16383'
   https://<site>/tiles/areas-<release>-lsoa.pmtiles` (with the preview login) is a 206, `immutable`, not
   compressed; `python3 deploy/tools/area_topology.py <db url> --quick --tiles <a copy of the folder>` prints no
   FAIL; the map at London z11, England z6, `?mode=demo` and a home page's mini map are coloured as before, and in
   DevTools the area tiles are Range requests to `/tiles/`. The API's tile route and Next proxy, `area_tile` and
   `build_area_tiles.sql` stay until no cached coverage names them (a day plus a week of stale-while-revalidate):
   their removal is a later PR.
6zl. LAD ids (step R2 of docs/architecture/global-geography.md, migration 129; after 6zk): `deploy/ship.sh` applies
   129 with the new API and web. It renames `uk:borough:<code>` to `uk:lad:<code>` in one transaction and keeps each
   old id in `area_alias` (~3 minutes on ae-pgold, 2.5 of them checking 1.17M foreign-key rows; the renamed tables are
   locked meanwhile, so the old API waits rather than answering). Tiles do not change (they carry the code's number),
   no PMTiles rebuild (the database tile path, the fallback, gets a new `a2-` release id from the renamed ids). The map's stored packs are payload-v4 now: `release_build` (run by the ship) builds them.
   Check: `SELECT count(*) FROM area_geography WHERE id LIKE 'uk:borough:%'` is 0 and `SELECT count(*) FROM
   area_alias` is the number of LADs (296 in England); `curl -sI https://<site>/area/borough/E09000009` is a 301 to
   `/area/lad/E09000009`; `curl $API/api/v1/areas/uk:borough:E09000009/rents` answers for `uk:lad:E09000009`; the
   MCP tool `get_area_metric` with `area_id: uk:borough:E09000009` answers; a `#profile=v1.` link made before the
   ship opens with its borough zone. Then reindex `metric_value` (the rename rewrote its LAD rows) and take a fresh
   dump. Rollback: the previous API and web, and 129 reversed (the prefixes swapped, `DELETE FROM area_alias`).
6zm. Deprecated field names (`londonPercentile`, `englandPercentile`, `london<X>`; owner decision 2026-10-27): they go
   30 days after the browser extension release that reads the new names is published. Until then answers carry
   `Deprecation` only. On the day it is published set `CLOSE_KNIT_ALIAS_SUNSET=<publication date + 30 days,
   YYYY-MM-DD>` in `deploy/.env` and recreate the api: every answer with an old name then says `Sunset`. After that
   date, the next contract version removes the names (step 11).
7. `curl $API/health` is `ready` with the new release id; walk the checks above.
8. Warm the ranking lenses before the pages are visited: `deploy/ship.sh` does it after each
   ship; after a release loaded without a ship, run in `deploy/`, once for each preset in its
   `lenses=` list (one at a time; each reads every matching place):
   `docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T api python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/v1/area-values/lens/<preset>?carrier=msoa', timeout=300).read()"`.
   The public `/api/v1/*` is the web app, which has no lens route (a 404), and the API port
   stays private, so ask the api container itself. Then `/rankings/most-gyms` and
   the Going out column of `/area/london` load; a lens the web could not fetch is retried after 2 minutes.

## Rebuilding the house-level data

`deploy/tools/etl_property.py uprn-map os-uprn inspire emit` (needs the EPC
extract and the address spine; downloads OS Open UPRN ≈620 MB and 33 INSPIRE
zips) then `deploy/migrations/004-property-stock-value.sql` and the generated
`property-load.sql` (which also rebuilds the street blocks of migration 006
from the OSM road extract); stage a product release whose members include
`src-os-open-uprn-*` and `src-hmlr-inspire-*` and activate it. Declare
`assets` as a list including `tiles/property_tile` — the readiness check
(`/health`) returns 503 otherwise. Apply
`deploy/migrations/007-property-objection.sql` last: it creates
`property_objection` / `correction_report` and redefines `property_tile()` to
honour confirmed objections. Then apply 040 and 044 (steps 6e and 6h): 044's
`property_tile()` replaces the one from `022-property-tile-sold-ppm.sql` and
carries each sold home's coarse `band`, never its `sppm` (no per-home £/m²
while the EPC licence is pending).

## Production deployment

- [ ] `deploy/init-env.sh` run; `deploy/.env` filled in (domain, https public
      URL, controller, contact e-mail, SMTP and/or webhook); never committed.
- [ ] Stack up with the production overlay; only Caddy publishes ports.
- [ ] Snapshot restored (`deploy/tools/db-restore.sh`); API restarted; `/health` ready.
- [ ] `deploy/preflight.sh` exits 0 (config, notification self-test, health,
      search, `/privacy` shows the controller, burst → 429). Paste its output here.
      Health says `degraded` / `stale-source` when a source release in the active release was retrieved longer
      ago than its window. The windows live in `api/area_api/fixtures/source-freshness.json` (longest id prefix
      wins): 45 days for HM Land Registry Price Paid (`src-hmlr-pp-`, monthly) and for any source not listed;
      100 days for slow quarterly and annual sources (EPC bulk, OS Open UPRN, INSPIRE, OSM-derived, DfE,
      admissions, Ofsted history, Defra noise, DfT, MHCLG, ONS Census and income, VOA). The fix for a stale
      source is a fresh release of it, not a longer window; change a window only when the publisher's cadence
      changes.
- [ ] `CLOSE_KNIT_AIR_QUALITY` (`FLAGS.md`): off in code, **on in production by owner decision 2026-10-18**,
      so set `CLOSE_KNIT_AIR_QUALITY=1` in `deploy/.env`. Off, it hides the GLA LAEI air: the health air
      figures (`/api/v1/areas/<id>/health` → `air: null`, `airEnabled: false`, `laeiAir` in `withheld`), the
      Health "Clean air" rating and NO₂ / PM2.5 row, the standouts Air tile and its tags, the Overview air
      chip, the `air-no2` map layer (metrics list, packs, `range:air-no2`) and the MCP air text. After the
      ship, check that `air` is on the health route and `air-no2` is in `/api/v1/metrics`.

## Privacy and legal (before the site is public)

- [ ] `/privacy` is live, footer link works, `CLOSE_KNIT_CONTROLLER`,
      `CLOSE_KNIT_CONTACT_EMAIL` and `CLOSE_KNIT_ICO_NUMBER` are set.
- [ ] ICO registration number recorded: ____________ (`docs/legal/ico-registration.md`).
- [ ] LIA signed and dated (`docs/legal/legitimate-interests-assessment.md`).
- [ ] Objection flow end to end on the real stack: select a home → "Report or
      hide this home" → e-mail arrives (`CLOSE_KNIT_SMTP_*`) → open link →
      `/privacy#confirmed`; the address is gone from `/api/v1/search`, the
      property route and the z16 tile; `python -m area_api.objections revoke <id>` restores it.
- [ ] Rate limit answers 429 with `Retry-After` after a burst
      (`for i in $(seq 250); do curl -s -o /dev/null -w "%{http_code}\n" "$API/api/v1/stations?q=bank"; done | sort | uniq -c`,
      then `curl -si "$API/api/v1/stations?q=bank" | grep -i retry-after`; `deploy/preflight.sh` runs the same check).
      Not `/api/v1/metrics`: the web shares that catalogue for a minute, so it never reaches the limit.
- [ ] `DATA-LICENCES.md` covers every `source_release` row
      (`SELECT DISTINCT publisher, licence FROM source_release`).
- [ ] INSPIRE statement shows verbatim on the map and methodology page.

## Going public (dropping the shared login)

- [ ] EPC licence settled (blocker, decided 2026-10-11). Since 2026-10-14 each home's EPC floor
      area and certificate facts are served as null unless `CLOSE_KNIT_EPC_PER_HOME=1`
      (`api/area_api/epc_policy.py`): property page, postcode homes, address history and last
      sale. Check that `deploy/.env` leaves it unset, then
      `curl -s https://<domain>/api/v1/properties/<uprn> | grep -o '"floorAreaSquareMetres":[^,}]*'`
      → `null`. Set it to 1 only once counsel confirms the EPC terms allow per-home publication.
      Per-sale £/m² stays off (migration 044) unless the licence allows it.
- [ ] EPC-only homes stay off (`CLOSE_KNIT_EPC_ADDRESSES` unset or `0`) until an AddressBase/PAF licence or
      counsel clears republishing EPC address fields: `curl -s https://<domain>/api/v1/postcodes/<postcode>/homes | grep -c '"addressSource"'` → `0`
      and `withheld` lists `epcAddresses`.
- [ ] Every item of *Privacy and legal* above is ticked; `deploy/preflight.sh`
      no longer FAILs on the notification channels (SMTP and/or webhook set),
      otherwise "hide my home" and "report an issue" reach nobody.
- [ ] Feature flags: set exactly the **Launch set** in FLAGS.md to `1` in `deploy/.env` (owner decision 2026-10-27; it includes `CLOSE_KNIT_AIR_QUALITY` at accepted moderate risk). Unset flags turn off with `CLOSE_KNIT_ACCESS=public`; remove or set to `0` any other flag in `deploy/.env`, and confirm with `curl …/api/v1/properties/<uprn>/profile` that `withheld` lists them.
- [ ] `deploy/.env`: `CLOSE_KNIT_ACCESS=public`; `CLOSE_KNIT_INVITE_TOKEN`
      can be emptied. Ship (`deploy/ship.sh`), then recreate Caddy so it reads the new access mode (ship only
      reloads its config, and the mode is in Caddy's environment): on the host,
      `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --force-recreate --no-deps caddy`.
- [ ] Still unlisted: `curl -sI https://<domain>/ | grep -i x-robots-tag` →
      `noindex, nofollow`; `/robots.txt` disallows `/api/` and `/mcp`.
- [ ] After the switch (v4 Task 40 readiness): `/robots.txt` names `Sitemap: https://<domain>/sitemap-index.xml`;
      `/area/lad/E09000009` has no robots meta; `/brief`, `/civic`, `/compare` and `/save-listing` stay
      `noindex, follow`; a 404 says "Page not found".
- [ ] `/claude` shows the `claude mcp add` command and
      `/downloads/find-a-home.zip` downloads; `/privacy/legitimate-interests` opens.
- [ ] `/agents` (Claude tab, v4.6) shows `/plugin marketplace add bmsdave/getcloseknit` then
      `/plugin install close-knit@close-knit`. bmsdave/getcloseknit is the public copy of this repository: the current
      tree as one commit, without history (this repository stays private). Refresh it after a plugin change:
      `deploy/tools/publish_public_repo.sh`.
- [ ] `/?mode=demo` stays on Real data (demo only with `?dev=1`).
- [ ] `/claude` shows the public MCP URL (`https://<domain>/mcp`, from
      `CLOSE_KNIT_PUBLIC_URL`), never a localhost or 127.0.0.1 address.

## Deployment notes

- `CLOSE_KNIT_API_URL` must point at the API (compose sets `http://api:8080`);
  without it the web app serves demo fixtures.
- `CLOSE_KNIT_PUBLIC_URL` is what `/llms.txt` and the MCP manifest advertise.
- Run one API worker: MCP sessions live in process memory (the rate limiter
  is per process too).
- `deploy/ship.sh` rebuilds and recreates only `api` and `web`; Caddy stays up
  and retries the upstream for up to 30 s (`lb_try_duration`), so `/mcp` and
  `/api` wait through the restart instead of answering 502 (#275). Caddy is
  reloaded only when `Caddyfile` or `access-*.caddy` changed; a change to
  `docker-compose.prod.yml`'s caddy service still needs
  `docker compose … up -d caddy` by hand.
- Behind a reverse proxy (Caddy/nginx/Cloudflare) set `CLOSE_KNIT_TRUST_PROXY=1`
  so limits and objection quotas key on `X-Forwarded-For`; the web BFF forwards
  the caller's address. Put TLS and an edge rate limit on the proxy as well.
- `CLOSE_KNIT_RATE_LIMIT` / `CLOSE_KNIT_TILE_RATE_LIMIT` (default
  120/minute and 600/minute per client), `CLOSE_KNIT_OBJECTION_SALT`
  (random, secret — hashes of e-mails/IPs depend on it; changing it orphans
  existing daily counters, not the objections themselves).
- The service worker only registers on HTTPS or localhost.
