# Real data (local review stack)

Local-only Postgres + API + web serving the first validated release:
official 2021 London boundaries and a rolling 12-month recorded-crime metric
(Metropolitan + City of London police, 2025-08..2026-07, ONS mid-2024
denominators). Full provenance and validation record:
[`deploy/tools/real-data-manifest.json`](deploy/tools/real-data-manifest.json).

## Run

```sh
./start-real.sh    # postgres :5433, api :8080, web http://127.0.0.1:4180
./stop-real.sh
```

The READY line prints the full review URL (`?mode=real&release=…`); a bare
`/` also opens in Real mode while the API is configured, so demo fixtures
never surface in this stack.

Double-click `start-real.command` for the same with a browser window.
The web runs in dev mode for fast reloads; production deploys build the
standalone image through `deploy/docker-compose.yml`. Runtime state
(`.pgdata/`, `.ae-venv/`, logs) is git-ignored.

To run against a Docker database instead of a native `.pgdata` cluster
(e.g. Apple Silicon without a Postgres 18 + PostGIS build), start any
`postgis/postgis:18-3.6` container holding the release and point the stack at
it: `AE_DB_URL=postgresql://close_knit@127.0.0.1:5434/close_knit ./start-real.sh`.

## What's real, what's not

- Real: LSOA/MSOA/borough boundaries, crime rates and monthly category
  history, rolling 12-month median achieved price per m² (Price Paid joined
  to EPC floor area, 20-sale carrier fallback), area search, value packs,
  personal-match crime, market-level, and affordability evidence.
- Real (house level): 1.31 M dwellings with EPC-derived UPRNs, OS Open UPRN
  coordinates and INSPIRE freehold parcels; restated stock values per dwelling
  and the LSOA *Stock value* layer (`rel-2026-09-london-7m-v1`).
- Real (sales): every Greater London Price Paid sale since 1995 as a
  sold-price map (one pin per home, last and previous sale, value today,
  area growth 1–20 years).
- Real (environment): London state-funded schools (Ofsted, DfE KS4 2024/25)
  near each area; Defra Round 4 (2022) road and rail noise at each home and
  per area.
- Not loaded: forecasts, commute routing, flood screening, planning,
  aircraft noise, KS2 results. Real mode says so instead of showing
  preview fixtures.

## Rebuild

The ETL runs here, against the local PostGIS (`ae-pgold`, port 5434), from one manifest:
[`deploy/tools/etl_manifest.py`](deploy/tools/etl_manifest.py) lists every load step, its theme, what it waits
for, the release it stages and the production bundle it writes. Run it with `deploy/tools/etl.py` (the venv's
Python; `python -m deploy.tools.etl` from the checkout works too):

```sh
PY=.ae-venv/bin/python
$PY deploy/tools/etl.py themes                      # steps per theme, London-scoped ones named
$PY deploy/tools/etl.py plan --theme prices         # the order, nothing runs
$PY deploy/tools/etl.py run --theme prices          # dependencies outside the theme are taken as done
$PY deploy/tools/etl.py run --step crime.release --with-deps --dry-run
$PY deploy/tools/etl.py bundle                      # every bundle + ~/data/england-2026-10/bundles/manifest.json
$PY deploy/tools/etl.py london-diff --theme crime --probe
```

- **One loader per theme.** Loaders take their scope from `area_coverage.from_env()`: every English LAD by
  default, `CLOSE_KNIT_ETL_COVERAGE=london` for London alone. London is rows inside the England build; ranks are
  within the area's region, so London's numbers do not move.
- **London-scoped steps** say why in the manifest (`scope="london"`, `why`): London-only sources (TfL, the GLA,
  council admissions, HMO registers, Inside Airbnb, the curated future-transport list) and per-home data
  (`property`, `sale`, `property_epc`, per-home noise and flood), which stays London-only by the owner's
  decision. They run under the same CLI.
- **EPC** is read from `~/Downloads/domestic-csv.zip` or its unzipped folder alike (`deploy/tools/epc_bulk.py`;
  `AE_EPC` points elsewhere). Steps that read it say `needs EPC` and stop early without it.
- **Release lock.** Steps that stage a product release hold `~/data/england-2026-10/release.lock` while they run.
- **Manual steps** (an owner login, paid or days-long requests) run only when named with `--step`.
- **London diff.** `deploy/tools/london-snapshot.json` keeps 200 London cells of the map metrics.
  `london-diff` compares them with the database; `--probe` first runs a theme's loaders with every write rolled
  back (one transaction on the shared database), so a loader change is checked against London before it is
  loaded; `--take` rewrites the snapshot after an accepted refresh. Intended differences are listed in
  `etl_manifest.INTENTIONAL_LONDON_DIFFS` and do not fail the check.
- Each loader's docstring documents its stages, inputs and outputs. After a release adds a map layer, add its id
  to `REAL_PUBLISHED_LAYERS` (`web/src/lib/map-state.ts`).

### Estate agent directory (migration 051)

Like the rest of the ETL this runs here, against the local PostGIS, and reaches production only through the
snapshot (see "Shipping the release to production"). Run from `pipelines/area-analytics-ingest` with
`DB=<local database-url>`, in this order (each stage prints its own summary; a stage can be re-run):

1. `psql "$DB" -v ON_ERROR_STOP=1 -f ../../deploy/migrations/051-agency-directory.sql` (migration 051).
2. Overture places, now with estate agents' websites: `python -m area_analytics.overture_places extract "$DB"`,
   then `build`, then `load "$DB"`. **Re-run `extract` before `build`:** an extract made before ETL version
   `close-knit-overture-places-2` has no `website` column, and `build` would load no websites.
3. `python -m area_analytics.places_unified load "$DB"` (the OSM website of an estate agent wins over Overture's).
4. `python -m area_analytics.agency_companies fetch YYYY-MM-01`, `build "$DB"`, `load "$DB"` (Companies House
   bulk file; London agencies with SIC 68310 or 68320).
5. Copy production's opt-outs into the local database, replacing the local rows, so `verify` and `match` skip
   every agency that asked (opt-outs are recorded only in production; see below). The production export goes
   to a file first, so a failed `ssh` truncates nothing; the load is one transaction:

   ```sh
   ssh ubuntu@<host> "cd /srv/close-knit/deploy && docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T database psql -U close_knit -d close_knit -v ON_ERROR_STOP=1 -c '\copy agency_opt_out TO STDOUT'" > ~/data/aework/agency_opt_out.tsv \
     && psql "$DB" -v ON_ERROR_STOP=1 -1 -c 'TRUNCATE agency_opt_out' -c '\copy agency_opt_out FROM ~/data/aework/agency_opt_out.tsv' \
     && psql "$DB" -c 'SELECT count(*) FROM agency_opt_out'
   ```

   The count must match `SELECT count(*) FROM agency_opt_out` on production. Before the first release with
   migration 051 production has no such table: the `ssh` step fails, nothing is copied, and there is nothing to
   copy.
6. `python -m area_analytics.agency_companies verify "$DB" [--limit N] [--workers 8]`: CloseKnitBot reads each
   agency website (robots.txt honoured, one request per 5 s per domain; portals and social networks such as
   Rightmove or Facebook, and private network addresses, are never requested). It prints a progress line every
   500 domains, then the domains whose robots.txt refuses it (record an opt-out if they also asked by e-mail),
   and its last line counts verified, no number, blocked, refused by robots.txt, dead and opted-out domains
   (also on Ctrl-C); those counts are not stored. A robots.txt refusal keeps no new row and deletes none.
7. Google place ids (place ids only; the owner checks the current Places API prices first, since every office
   is one Text Search request). First `CLOSE_KNIT_GOOGLE_PLACES_KEY=... python -m area_analytics.agency_google
   review "$DB"`: it asks Google for 50 offices spread across the table, writes nothing, and prints one line each
   (our name | Google's name | distance | accepted). Read all 50: a "yes" on a different business, or a "no" on
   the same one, means the rule needs a change before any id is stored. Then `match "$DB" --limit 50`. A
   candidate within 150 m is accepted when one name begins the other, or, ignoring generic words (estate,
   agents, lettings, ltd ...), the rest reads the same, every word of the shorter is in the longer, or the rest
   is trigram-similar (≥ 0.5) (`names_agree`). **If unmatched outnumbers matched in those 50, stop** and look
   at a few offices before paying for the full run (no `--limit`). An unmatched office is stored as NULL and not asked again; to ask those
   offices again after a rule change: `psql "$DB" -c 'DELETE FROM agency_google_place WHERE google_place_id IS NULL;'`.
8. `python -m area_analytics.agency_companies check "$DB"`: prints the coverage report and exits 1 when any
   `agency_office.domain` differs from the Python `site_domain(website)`, listing up to 20 of those rows.
9. Snapshot and ship as for any release (`db-snapshot.sh`, then `deploy/ship.sh ubuntu@<host> close-knit.dump`).
   `agency_opt_out` stays production-only: the snapshot carries none of its rows and the restore keeps the
   server's table.

Agencies that ask to be left out (by e-mail, or a `CloseKnitBot` rule in their robots.txt, as the public page
`/bot` explains) are recorded by hand **in production** (run the SQL through
`docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T database psql -U close_knit -d close_knit`
in `/srv/close-knit/deploy`); no ingest rebuilds `agency_opt_out`, the daily `backup-prod-data.sh` backs it up,
and step 5 brings it to the local ETL. `domain` is lower-case without `www.` (the table refuses anything else;
or use `place_id` for one office, e.g. `osm:n123`); `scope` is `'listings'` (stop crawling the domain, hide its
homes) or `'everything'` (also hide the office); `note` says how the request was verified:

```sql
INSERT INTO agency_opt_out (domain, scope, note)
VALUES ('elmestates.co.uk', 'everything', 'e-mail from info@elmestates.co.uk, 2026-10-13, reply received from the domain');
INSERT INTO agency_opt_out (place_id, scope, note)
VALUES ('osm:n123', 'listings', 'phone call to the office, confirmed by e-mail from the same domain');
-- undo: remove the row (the office and its homes come back at once; the next ETL run copies the change and
-- verify crawls the domain again)
DELETE FROM agency_opt_out WHERE domain = 'elmestates.co.uk';
```

## Shipping the release to production

The ETL runs here, against the local PostGIS; production never rebuilds it.
`deploy/tools/db-snapshot.sh /path/close-knit.dump` writes a custom-format
dump (schema + data, minus objections / correction reports / analytics events)
with a sha256 manifest; `deploy/tools/db-restore.sh` on the server restores
it into the compose database and verifies the active release. Objections made
in production live only in production: the snapshot carries no rows of
`property_objection`, `correction_report`, `profile_analytics_event`, `access_invite`,
`mcp_feedback` or `product_event`, and
once those tables exist on the server the restore leaves them out entirely
(it fails if the objection count changes). `agency_opt_out` (estate agent
opt-outs) is production-only in the same way. `deploy/tools/backup-prod-data.sh`
backs those rows up.

### Sitemap of per-address pages (PR 8)

No data load: `/sitemap-index.xml` lists `/sitemap.xml` and one shard per postcode sector
(`/postcode/sitemap/W5-1.xml`, 1,129 sectors), each built from `GET /api/v1/homes/index?sector=W5-1`
(postcodes and UPRNs of the active release, hidden homes left out; about 0.2 s and at most ~6,500 URLs
per sector on the 2026-10 release). Deploy the API with the web, then on the server:

```sh
curl -s https://getcloseknit.com/robots.txt | grep -i sitemap        # Sitemap: …/sitemap-index.xml (public only)
curl -s https://getcloseknit.com/sitemap-index.xml | grep -c '<loc>'  # 1 + sectors
curl -s https://getcloseknit.com/postcode/sitemap/W5-1.xml | grep -c '<loc>'
```

Once the site is public, submit `/sitemap-index.xml` in Google Search Console and Bing Webmaster Tools.
A home hidden later ("Report or hide this home") drops out of its shard and its page answers 404 with noindex.

## Limits of this stack

- Crime coordinates are anonymised by the publisher; City of London rates use
  the small resident population (daytime footfall is far higher).
- British Transport Police records are excluded; anti-social behaviour is
  counted separately and excluded from the headline rate.
- Crime percentiles are within the area's region (England coverage); force areas with a missing or partial
  police.uk month in a window show no crime figure for that window.
