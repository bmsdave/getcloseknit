# Future transport (source 9) — plan

Spec: `docs/superpowers/specs/2026-10-18-open-data-sources-design.md`, "Shared rules" and section 9.

1. `deploy/tools/future_transport.yaml`: curated new stations, each scheme with mode, status
   (under construction, consented, funded, proposed), expected year only where published, and a
   tfl.gov.uk / london.gov.uk / gov.uk source URL; points placed from the official pages.
2. `deploy/migrations/088-future-transport.sql`: `future_transport` (one row per station) and
   `area_future_transport` (nearest station per LSOA, MSOA, borough).
3. `deploy/tools/etl_future_transport.py`: stdlib parser for the YAML subset, validation,
   `download` (fetch every source page, print sha256, write a manifest), `load <db-url>`:
   stations, nearest station per area (MSOA/borough = closest of their LSOAs), metric
   `future-station-distance` (km from the LSOA's middle to the nearest under-construction or
   consented station; MSOA/borough home-weighted means; ascending London percentile), its
   `metric_definition` (upserted by load: the row needs a source release), product release.
4. `api/area_api/future_transport.py` + route `/api/v1/areas/{id}/future-transport`: evidence
   envelope with the nearest station within 2 km and a card note; proposed reads "proposed".
5. Web: `lib/future-transport.ts`, `components/future-transport.tsx` mounted in
   `AreaLocationSection`; `MetricId`, demo fixture, `REAL_PUBLISHED_LAYERS`, map-topics item in
   `getting-around`, help text.
6. Docs: `DATA-LICENCES.md`, `REAL-DATA.md` rows; openapi `MetricId` + path.

Tests first: parser + validation on a fixture, real YAML validity, aggregate + roll-up agreement,
API contract, component render, `map-topics.test.ts`.
