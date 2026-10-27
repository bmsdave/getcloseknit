# Short lets (Inside Airbnb London) — plan

Spec: `docs/superpowers/specs/2026-10-18-open-data-sources-design.md`, section 5 and Shared rules.

Source as published: `insideairbnb.com/get-the-data` links the latest London snapshot as
`data.insideairbnb.com/united-kingdom/england/london/<YYYY-MM-DD>/data/listings.csv.gz`
(2026-09-17: 91,954 listings). Only `latitude`, `longitude`, `room_type` and
`number_of_reviews_ltm` are read; ids, names, hosts and prices are never kept.

1. **Migration 084** `deploy/migrations/084-short-lets.sql`: `area_short_let(geography_id, listings,
   entire_home, active_12m, homes, per_1000_homes, source_release_id)` and
   `rebuild_area_short_let(release)`: points in a temp table → LSOA (ST_Covers), homes = Census 2021
   households (TS044 accommodation, `area_census_count`), MSOA/borough as sums, then the
   `short-lets-per-1000` `metric_definition` row and LSOA `metric_value` rows (London percentile,
   suppressed under 50 homes). Mounted in `docker-compose.yml`.
2. **ETL** `deploy/tools/etl_short_lets.py download|load <url>`: finds the latest snapshot, sha256,
   stdlib parse, psycopg load, product release staged. Tests on a checked-in fixture.
3. **API** `api/area_api/short_lets.py` + `GET /api/v1/areas/{id}/short-lets` (area-short-lets.v1
   envelope: per 1,000 homes with London percentile, entire-home share, active share vs London).
4. **Web** `MetricId` + openapi enum, demo fixture metric, `map-topics` item in `homes-area`,
   `lib/short-lets.ts` + `components/short-lets.tsx` mounted in `market-section.tsx`, sources in the
   price section's ⓘ, help text.
5. **Docs** `DATA-LICENCES.md`, `REAL-DATA.md` rows (CC BY 4.0, "Inside Airbnb, insideairbnb.com, CC BY 4.0.").
6. Tests: deploy + api unittest, web `npm test` + typecheck; rebase on main; one PR.
