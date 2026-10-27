# HMO and landlord licensing (source 8) — plan

Spec: `docs/superpowers/specs/2026-10-18-open-data-sources-design.md`, "Shared rules" and "8.".

1. **Configs** `deploy/tools/hmo/boroughs/<slug>.yaml`, one per London authority (33): register
   status (published, search-only, on-request, not-found), URL, format, postcode column, terms,
   retrieval date; licensing schemes (kind, wards or all, start, end, URL).
2. **Migration 087** `087-hmo-licensing.sql`: `hmo_register` (one row per borough, its status),
   `hmo_postcode` (licence counts per postcode), `area_hmo` (LSOA → MSOA → borough sums,
   per 1,000 Census 2021 households), `licensing_scheme` (ward codes, NULL = whole borough),
   `rebuild_area_hmo()` and `load_hmo_metric()` (the `hmo-per-1000` metric_definition and
   metric_value rows; LSOAs of unpublished boroughs are `suppressed`, grey on the map).
3. **ETL** `deploy/tools/etl_hmo.py download|load`: stdlib parsers for CSV, XLSX, HTML tables and
   PDF text (`pdftotext`); only postcodes are kept, counted, and filtered to the borough.
   sha256 per file in `manifest.json`. Fixture tests per format and the roll-up.
4. **API** `api/area_api/hmo.py`, route `/api/v1/areas/{id}/hmo`: evidence envelope with the
   count, per 1,000 homes, London figure and percentile, register status, schemes in force.
5. **Web** `lib/area-hmo.ts`, proxy route, `components/hmo.tsx` mounted in the Homes section;
   `hmo-per-1000` MetricId, map-topics item in `homes-area`, help text.
6. **Docs**: DATA-LICENCES and REAL-DATA rows; borough results table in the PR.

Not done here: loading prod (commands in the PR).
