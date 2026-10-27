# Council tax bands (VOA CTSOP) — plan

Source 3 of `specs/2026-10-18-open-data-sources-design.md`.

- **Data:** CTSOP1.1 (VOA, homes by band per LSOA at 31 March 2025, OGL v3): one CSV in a zip, one row
  per LSOA with `band_a … band_i`, counts rounded to 10, `-` for fewer than 5 (read as 0), `..` not
  applicable. Band I is Wales only.
- **Migration 082:** `area_council_tax_band(geography_id, band_a … band_h, total, period, source_release_id)`;
  `rebuild_council_tax_band(release)` rolls LSOAs up to MSOAs and boroughs with `roll_up_area_home` (063),
  writes the `council-tax-band-mean` `metric_definition` and its LSOA `metric_value` rows (mean band
  1–8, London percentile, suppressed under 50 homes).
- **ETL:** `deploy/tools/etl_council_tax.py download | load <db>`: stdlib parse, sha256 printed and stored,
  London LSOAs only, product release staged.
- **API:** `api/area_api/council_tax.py`, `GET /api/v1/areas/{id}/council-tax`: envelope with the band
  mix, most common band, mean band and its London percentile, and a typical bill = the middle home's
  band ratio × the borough's Band D (existing `council_tax`, migration 019).
- **Web:** `lib/council-tax.ts` (types, path, reader, bill words), proxy route, `components/council-tax-bands.tsx`
  (A–H bar, most common band, typical bill) mounted in `market-section`; `MetricId`, fixture metric,
  `map-topics` item in Cost.
- **Docs:** `FLAGS.md` (created; per-home band blocker row), `DATA-LICENCES.md`, `REAL-DATA.md`.
- **Tests:** parser on a fixture, roll-up agreement, API value + contract, component render, map-topics.
