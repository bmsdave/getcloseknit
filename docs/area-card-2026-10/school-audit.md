**School card audit: what the data and code support**

**Short answer:** the school data for a detailed card is already in Postgres. The API has a full per-school history builder, but no endpoint calls it. There is no school page in the web app, and nothing on the map links to one.

**(1) Tables and loaders**
- **`school`** (`deploy/schema.sql:105`)
  - Columns: urn, name, phase (primary/secondary), location, predecessor_urn/successor_urn.
  - `attributes` jsonb is built at `deploy/tools/etl_schools.py:309-317`. It holds type, ageFrom/ageTo, faith, selectivity, pupils, localAuthority, postcode, sixthForm, reportCard, latest-year `observations[]` and `missingObservations[]`.
  - KS2 is not in `attributes`: `etl_schools.py:306` writes "Key stage 2 results (not loaded yet)".
- **`school_observation`** (`schema.sql:119`): urn, observation_kind, academic_year, value jsonb (value, suppressed, code), cohort_size, confidence_interval.
  - Measure ids are defined in `deploy/tools/school_measures.py:45-88`.
  - Rows loaded locally:

| Measures | Years | Schools |
|---|---|---|
| ks2-rwm-expected/higher, reading/maths/gps scores, gps-expected | 2015/16–2024/25 | 1,695 |
| ks2 progress measures | to 2022/23 | 1,688 |
| ks4-attainment8, em-grade4/5, ebacc-aps | to 2024/25 | 499 |
| ks4-progress8 | to 2023/24 | 495 |
| ks5-alevel-aps/grade/va, ks5-students | 2015/16–2024/25 | ~413–426 |
| pupils (on roll) | 2010/11–2024/25 | 2,255 |

- **"How many leave" is not published.** The nearest figures are the KS4 cohort size (`cohort_size`) and `ks5-students`.
- **`school_inspection`** (`deploy/migrations/048-school-history.sql:25-41`): start/publication date, inspection_type, framework, overall (1–4, NULL for report cards), judgements jsonb (sub-grades), report_url, key_findings, improve_text.
  - Locally: 11,236 inspections; 8,129 have key_findings and 8,513 have improve_text.
  - Frameworks: pre-2015, cif-2015, eif-2019, eif-2024-no-overall, report-card-2025.
- **Report text is stored:** `school_inspection.key_findings` and `improve_text`, from `deploy/tools/etl_ofsted_reports.py:1-25`.
  - It is Crown copyright under OGL v3, kept as a quotation with `report_url`. So a short "what's good / needs to improve" summary is legally fine with attribution.
  - The separate "What does the school do well" section is **not** stored: it is a stop heading at `etl_ofsted_reports.py:202`.
  - It can be extracted offline with `etl_ofsted_reports.py load`, which needs no network. The PDFs are already on disk: 19,631 files in `~/data/ofsted-reports/pdf`.
- **`school_admission_demand`** (`048:47-57`): entry_year, entry_point, first/any preferences, offers, first_preference_offers, pan. 27,972 rows locally, enough for an oversubscription graphic.
- **`school_admission_observation`** (`schema.sql:130`, extended at `048:63-71`): last offer distance, raw_value, all_offered, criterion, applicants/offers/refused, `publishable`. 11,821 rows locally, but only 844 are publishable.
- **Ofsted Parent View is not loaded.** `parentViewResponses` is hard-coded `None` at `api/area_api/schools.py:251`, and only demo fixtures have it (`web/src/lib/fixtures.ts:714`). Because Parent View isn't loaded, nothing exists to build a parent-review rating from.

**(2) API and web**
- **Endpoints** in `api/area_api/app.py`:
  - `:293` `/api/v1/areas/{id}/schools`: schools within 1.5 km, as `school_summary`.
  - `:489` `/api/v1/schools?q=`: search by name.
  - `:494` `/api/v1/schools/{urn}`: returns only `school_summary` from `attributes` (`evidence.py:959-970`).
  - `:499` `/api/v1/school-rankings/{axis}`: KS4 secondary only, plus Ofsted filters.
- **Key gap:** `schools.school_history(connection, urn)` at `api/area_api/schools.py:125-195` builds every measure series, every inspection with keyFindings/improveText/reportUrl, demand, distances and source attributions (`school-history.v1`).
  - It is tested (`api/tests/test_schools.py:243-316`) but no endpoint calls it.
  - Wiring it into a new `/api/v1/schools/{urn}/history` (or into get_school) is the main backend step.
- **Web list** (`web/src/components/area-schools.tsx`):
  - `SchoolItem` (`:94`) has an "Inspections and results" disclosure with external links (`:117-121`), `schoolRating` (`:168`) and `RatingBadge` (`:205`).
  - It has no link to a school page. There is no `app/school*` route (only `app/api/v1/schools/[urn]/route.ts`, a proxy).
- **Other school UI:**
  - `school-discovery.tsx:87` fetches `/api/v1/schools/{urn}`, but in real mode the panel is passed `[]` (`preference-panel.tsx:429`).
  - `areSchoolsAvailableInMode` returns demo only (`lib/map-state.ts:360-362`).
- **Map markers** (`components/match/match-overlays.tsx:264-273`) are drawn only in the match view, for criteria or nearby outstanding schools. Clicking one opens an HTML popup (name, phase, tier, A8) with no link to a card.
- **SEO:** rankings pages already exist via `lib/area-pages.ts:428` (5 axes, no KS2). Per-school pages would need a new route plus a sitemap entry (`app/sitemap.ts`).

**(3) London-wide percentiles**
- None are computed today; there is no percent_rank or percentile anywhere in the school code.
- They are cheap to add from `school_observation`: filter by observation_kind and academic_year (indexed at `048:78-79`), join `school.phase`, apply `cohort_size >= MIN_SCHOOL_COHORT` (30, `personal_places.py:44`), then `percent_rank()`.
- That covers every KS2, KS4 and KS5 measure. Trend arrows come from the per-year series.
- `_performance_rows` (`schools.py:295-306`) ranks from `attributes`, KS4 only and latest year only.

**(4) Local verification**
- The Docker container `ae-pgold` (image ae-postgis:18-3.6-engb) is running on **:5434**, database **`area_explorer`**, release `rel-202610112243-school-history`. All the counts above came from it.
- Command per `start-real.sh:5` and `REAL-DATA.md:28`: `AE_DB_URL=postgresql://<role>@127.0.0.1:5434/<db> ./start-real.sh`. That starts the API on :8080 and Next.js on :4180.
- REAL-DATA.md uses `close_knit@…/close_knit`, but this container's role and database are `area_explorer`. So use `postgresql://area_explorer@127.0.0.1:5434/area_explorer` (not tested; it may need a password).
- No `psql` binary on the host; use `docker exec ae-pgold psql -U postgres -d area_explorer`. Nothing is listening on :5433, so start-real.sh's default cluster isn't running.

**Not checked:** I did not research Locrating (no web access in this read-only audit), did not start the app, and did not inspect `AREA_SCHOOLS_SQL` or `lib/school-evidence.ts` in detail.