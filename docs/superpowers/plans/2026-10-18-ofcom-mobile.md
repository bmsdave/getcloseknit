# Source 7: Ofcom mobile coverage + LAEI flag — plan

Spec: `docs/superpowers/specs/2026-10-18-open-data-sources-design.md` § 7 and "Shared rules".

## Grain

Ofcom Connected Nations spring 2026 (`202601_mobile_coverage_r1.zip`) publishes mobile coverage for
local authorities, Westminster constituencies and devolved constituencies only; no postcode or
output-area file. Finest London grain = borough (`*_laua_r01.csv`, 33 E09 rows, shares of premises
in %, blank = 0). An LSOA or MSOA shows its borough's figure, said in the caveat.

Columns: `prem_count`, `4G_prem_out_{0..4}`, `4G_prem_in_{0..4}`, `5G_high_confidence_prem_out_{0..4}`
(share of premises served by exactly N of the four networks). Stored as 0–1 shares:
`outdoor_4g_all_mno = 4G_prem_out_4`, `indoor_4g_all_mno = 4G_prem_in_4`,
`outdoor_5g_any = 100 − 5G_…_out_0`, `outdoor_5g_all = 5G_…_out_4`.

## Steps (test first)

1. `deploy/tests/test_area_mobile.py` + fixture `deploy/tests/fixtures/ofcom_mobile_laua.csv`:
   parser (London only, shares, blanks), migration shape, compose mount.
2. `deploy/migrations/086-area-mobile.sql`: `area_mobile` (borough rows) and
   `rebuild_mobile_metrics(release)`: `metric_definition` rows `mobile-4g-indoor`,
   `mobile-5g-outdoor` (carrier borough, %, higher-is-better) and their `metric_value` rows with
   London percentiles. Compose mount line.
3. `deploy/tools/etl_mobile.py download|load <db-url>`: sha256 printed + recorded, source release,
   rebuild metrics, stage product release.
4. `api/area_api/mobile.py` (`area-mobile.v1` envelope: value, confidence, evidence[], sources[],
   caveats[]) + `GET /api/v1/areas/{id}/mobile`; `api/tests/test_area_mobile.py` (levels agree,
   contract).
5. Web: MetricIds, map-topics item (Homes & area, two views), legend/palette/fixtures,
   `lib/area-mobile.ts`, `components/area-mobile.tsx` mounted beside broadband in Homes, sources in
   the section ⓘ, proxy route, tests.
6. `CLOSE_KNIT_AIR_QUALITY` (default off): hides the Health air block (Clean air rating and row),
   the Air standout tile and the `air-no2` layer (metrics list, metric, packs, range criteria; the
   selector drops it when the release does not list it). `FLAGS.md` created with its row.
7. `DATA-LICENCES.md`, `REAL-DATA.md`, openapi; run api, deploy and web suites; PR.

Not touched: `area_london_rank`, `FACTOR_IDS`, migration 069's good-value score (still reads
`air-no2` in SQL; noted in FLAGS.md).
