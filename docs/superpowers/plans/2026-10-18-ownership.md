# Plan: company and overseas ownership (CCOD/OCOD), source 4

Spec: `docs/superpowers/specs/2026-10-18-open-data-sources-design.md` § Shared rules, § 4.

1. **Fixture** `deploy/tests/fixtures/ownership/` — tiny synthetic CCOD and OCOD CSVs in the published
   column layout (proprietor columns filled with fake text, never read).
2. **ETL** `deploy/tools/etl_ownership.py`:
   - `download`: with `HMLR_API_KEY`, the Use land and property data API (`/api/v1/datasets/ccod|ocod`,
     latest full file) into `AE_WORK/ownership`; without it, says where to put the owner's zips. sha256 printed.
   - `parse`: reads only Title Number, Tenure, Postcode, District; one row per title; proprietor
     name/address columns are never read.
   - `load <url>`: postcode → LSOA via `postcode_civic` (ONSPD), homes = `property` rows per LSOA;
     titles with no usable postcode are counted as `unmatched` on their borough (by District) and
     logged; writes `area_ownership` LSOA rows, rolls up MSOA/borough, calls the migration's
     `load_ownership_metrics(release)` and stages the release.
3. **Migration 083** `area_ownership(geography_id, titles_company, titles_overseas, homes, unmatched)`,
   `roll_up_area_ownership()`, `load_ownership_metrics(p_source_release_id)` → `metric_definition` +
   `metric_value` for `ownership-company-share`, `ownership-overseas-share` (LSOA, London percentile).
   docker-compose line.
4. **API** `api/area_api/ownership.py` (`area-ownership.v1` envelope: value, confidence, evidence,
   sources, caveats; London share and percentile; words from the percentile), route
   `/api/v1/areas/{id}/ownership`, `available=false` unless `CLOSE_KNIT_OWNERSHIP=1`.
5. **Web** `lib/area-ownership.ts`, `components/ownership.tsx` (two bars vs London, one line of words),
   proxy route, one mount line in `market-section.tsx`; MetricIds, map-topics items in `homes-area`,
   legend/palette entries.
6. **Docs** `FLAGS.md` (created), `DATA-LICENCES.md`, `REAL-DATA.md`, openapi.
7. **Tests first**: parser + no-proprietor guard, LSOA→MSOA→borough agreement (throwaway PostGIS),
   API contract (fake connection), component render, `map-topics.test.ts`.
