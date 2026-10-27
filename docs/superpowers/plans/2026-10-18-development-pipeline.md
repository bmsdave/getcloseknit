# Source 6: development pipeline (LDD) + Opportunity Areas — plan

Spec: `docs/superpowers/specs/2026-10-18-open-data-sources-design.md` § 6 and Shared rules.

## Data

- **LDD** through the Planning London Datahub guest search API (`area_analytics.location_layers`
  client, as for `planning_application`). One query per planning authority and status, so no query
  reaches the 10,000-hit cap. Kept: permissions with net new homes > 0 (proposed − existing units)
  whose datahub status is `Approved`/`Allowed` (not started; dropped once `lapsed_date` has passed),
  `Commenced` (under construction) or `Completed` with a completion date in the last five years.
  Stored: site centroid, net homes, status, decision date, completion date. No applicant, address,
  description or conditions.
- **Opportunity Areas** (London Datastore `epr7z`, OGL v3, shapefile with names and GLA page links)
  and **Housing Zones** (`24yxz`, OGL v3, GeoPackage). Both in `opportunity_area`.

## Build (test-first)

1. `deploy/migrations/085-development-pipeline.sql`: `development_pipeline`, `opportunity_area`,
   `area_pipeline`, `area_opportunity`; `rebuild_area_pipeline(period, release)` fills LSOAs (one
   LSOA per site), sums MSOAs and boroughs, homes within 1 km by status, per-1,000-homes rate and
   its London percentile among areas of the same kind, and writes `metric_definition` +
   LSOA `metric_value` rows for `pipeline-homes-per-1000`. Mounted in `docker-compose.yml`.
2. `deploy/tools/etl_pipeline.py` `download` / `load <url> [pipeline|opportunity]`: sha256 of each
   file into `source_release`, then `stage_release` so the layer is in the active release.
3. `api/area_api/pipeline.py` → `GET /api/v1/areas/{id}/pipeline` (area-pipeline.v1 envelope:
   value, confidence, evidence, sources, caveats).
4. Web: `lib/development-pipeline.ts`, `components/development-pipeline.tsx` (number + London
   percentile + status bar + Opportunity Area line), Next proxy route, one-line mount in the real
   planning section (`area-location.tsx`); `MetricId`, `map-topics` item in `homes-area`.
5. `DATA-LICENCES.md`, `REAL-DATA.md`, `openapi.yaml`.

Tests: parser fixtures (datahub hits, tiny shapefile zip, tiny GeoPackage), PostGIS roll-up
agreement (skipped without `CLOSE_KNIT_TEST_DATABASE_URL`), API contract, component render,
`map-topics.test.ts`.

Not in this PR: Opportunity Area outline on the map (Show has no generic outline slot; card only).
