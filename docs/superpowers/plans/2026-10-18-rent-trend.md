# Rent trend (PIPR) — plan

Spec: `docs/superpowers/specs/2026-10-18-open-data-sources-design.md` § 2 and Shared rules.

Real grain (checked on the 16 Sep 2026 workbook, Table 1): 32 boroughs (no City of London) and London,
monthly January 2015 – August 2026, index and mean rent for all homes, 1–4+ bedrooms, detached,
semi-detached, terraced and flat/maisonette. Matches the spec.

1. **Migration 081** `borough_rent_series(borough, month, category, rent, index, source_release_id)`;
   `borough_rent` (029) untouched.
2. **ETL** `deploy/tools/etl_rent_trend.py download | load <url>`: reuses `area_analytics.rents`
   (workbook reader, month parser, URL); writes the series, metric definitions and values for
   `rent-change-1y` / `rent-change-5y` (all homes, index change, carrier borough, every month that has
   a base, London percentile among boroughs), then stages a product release.
   Definitions are written by the loader, like the other metric ETLs: `metric_definition` needs a
   loaded `source_release`, so the migration cannot hold the row.
3. **API** `api/area_api/rent_trend.py`, route `/api/v1/areas/{id}/rent-trend`: envelope with the
   borough's monthly rent per category, 1y/5y change, London's, and the borough's London percentile.
4. **Web** `web/src/lib/rent-trend.ts`, route proxy + demo fixture, `components/rent-trend.tsx`
   (rent, sparkline for the household's bedrooms, 1y/5y change, London percentile), mounted in the
   Price section; `MetricId`s, `map-topics` item "Rent change" (1y/5y views) in `cost`.
5. **Docs** DATA-LICENCES, REAL-DATA rows; openapi path + enum.
6. **Tests** parser on a checked-in fixture, change/percentile maths, borough carrier paints LSOAs
   (range join), API contract, component render, map-topics.
