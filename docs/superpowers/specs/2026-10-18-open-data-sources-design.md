# Open data sources, wave A — design

Date: 2026-10-18. Status: approved in chat, awaiting written-spec review.

## Goal

Add nine open-data sources we do not have yet (or have only in part) to the area card, the map
and matching. Each source is one PR from its own session, all built in parallel.

Success: every source below has a loaded table, an API block with sources and caveats, a line or
small chart in an existing card section, a map layer with a London percentile, and works as a
`range:<layer>` criterion in My match and MCP `find_areas`. Anything blocked by a licence, an
account or personal data ships behind a default-off flag with its blocker in `FLAGS.md`.

Out of scope: per-home council tax band (no open bulk source; recorded as a blocker only),
scrapers of sites whose terms forbid it, changes to `area_london_rank`, new `FACTOR_IDS`.

## Shared rules (every PR)

- **Pipeline:** `deploy/tools/etl_<src>.py` with `download` and `load <database-url> [part]`
  subcommands, stdlib for download/parse, psycopg for load, `AE_WORK` for files, sha256 of every
  downloaded file printed and recorded (same shape as `etl_home.py`).
- **Migration:** its own reserved number (table below). Before merge, re-check numbers against
  main; renumber only your own file.
- **Grain:** load at the finest open grain (point, postcode, OA or LSOA); MSOA and borough are sums
  or home-weighted means of LSOAs, so levels agree. Borough-only sources say so in the caveat.
- **Map layer and match:** each headline metric gets a `MetricId` (append to the enum in
  `contracts/openapi.yaml` and `web/src/lib/contracts.ts`), a `metric_definition` row (in the migration) and rows in
  `metric_value` (`deploy/schema.sql`), and one item
  in `web/src/lib/map-topics.ts` (append inside the named group). That makes it a `range:<layer>`
  criterion automatically; no `FACTOR_IDS` change. Census-style descriptive-only rules do not
  apply to these sources.
- **API:** its own module `api/area_api/<src>.py`, returning the evidence envelope (value,
  confidence, evidence[], sources[], caveats[]); wired into `app.py` with one route or one block
  on the existing area payload.
- **UI:** its own component `web/src/components/<src>.tsx`, mounted with one line in the named
  section. Fast-scan: a number with its London percentile, a sparkline or bar where there is a
  series, terse labels, sources in the section's existing sources menu.
- **Shared files:** append-only edits to `contracts/openapi.yaml`, `web/src/lib/contracts.ts`,
  `map-topics.ts`, `help-texts.ts`, `DATA-LICENCES.md`, `REAL-DATA.md`, `FLAGS.md`, section
  mount points. Rebase on main before asking for merge.
- **Flags:** server flags in `api/area_api/feature_flags.py` (`CLOSE_KNIT_<NAME>`, default off)
  plus a `FLAGS.md` row: flag, default, what it hides, blocker, who unblocks. The first PR to land
  creates `FLAGS.md` at the repo root with the header `| Flag | Default | Hides | Blocker | Unblocks |`;
  later PRs append rows.
- **Licences:** a `DATA-LICENCES.md` row per file (source, publisher, licence, use, attribution,
  caveats) and a `REAL-DATA.md` load note.
- **Tests:** parser on a small checked-in fixture, roll-up agreement (LSOA → MSOA → borough), API
  contract test, component render test, `map-topics.test.ts` passes. Run the relevant suites;
  report anything skipped.
- **Prod:** not loaded by the session. The PR states the exact download/load commands; loading
  follows the normal release process.

## Sources

| # | Session | Migration | Section | Flag |
|---|---|---|---|---|
| 1 | UK HPI | 080 | `market-section` | — |
| 2 | Rent trend (PIPR) | 081 | `market-section` | — |
| 3 | Council tax bands (VOA CTSOP) | 082 | `market-section` | — |
| 4 | Company and overseas ownership (CCOD/OCOD) | 083 | `market-section` | `CLOSE_KNIT_OWNERSHIP` until files are loaded |
| 5 | Short lets (Inside Airbnb) | 084 | `market-section` | — |
| 6 | Development pipeline (LDD) + Opportunity Areas | 085 | `planning-context` | — |
| 7 | Mobile coverage (Ofcom) + LAEI flag | 086 | `area-home` | `CLOSE_KNIT_AIR_QUALITY` (LAEI) |
| 8 | HMO and landlord licensing | 087 | `area-home` | — |
| 9 | Future transport (TfL) | 088 | `area-location` | — |

### 1. UK HPI

- **Source:** HM Land Registry UK House Price Index, full file (monthly, from January 1995), OGL v3.
- **Grain:** local authority × property type (detached, semi, terraced, flat) and all; average
  price and index.
- **Store:** `borough_hpi(borough, month, property_type, average_price, index)`.
- **Card:** borough price line since 1995 by type (one small chart, type switch), change over
  1, 5 and 10 years against London.
- **Layer:** `hpi-change-5y`, `hpi-change-10y` (borough values painted on all levels; caveat says
  borough-wide). Group: `cost`.
- **Caveat:** mix-adjusted official index, borough level; our own £/m² stays the local figure.

### 2. Rent trend (PIPR)

- **Source:** ONS Price Index of Private Rents, monthly workbook (already used for the latest
  month in `borough_rent`, migration 029), OGL v3.
- **Grain:** borough × bedroom count and property type, monthly series (from the start of the
  series in the workbook).
- **Store:** `borough_rent_series(borough, month, category, rent, index)`; `borough_rent` stays.
- **Card:** rent sparkline for the household's bedroom count, change over 1 and 5 years.
- **Layer:** `rent-change-1y`, `rent-change-5y`. Group: `cost`.
- **Caveat:** official statistics in development; mean of new and existing tenancies; no City
  of London.

### 3. Council tax bands (VOA CTSOP)

- **Source:** VOA Council Tax: stock of properties (CTSOP), by band and LSOA, latest year, OGL v3.
- **Store:** `area_council_tax_band(geography_id, band_a … band_h, total)`, rolled up.
- **Card:** band distribution bar A–H, most common band, and the borough's Band D already shown,
  turned into an estimated typical bill (band ratio × Band D).
- **Layer:** `council-tax-band-mean` (mean band as 1–8). Group: `cost`.
- **Blocker row in `FLAGS.md`:** "Council tax band per home: VOA publishes no open bulk file;
  per-address lookup only. No flag, no code." Unblocks: a licensed bulk source.

### 4. Company and overseas ownership (CCOD/OCOD)

- **Source:** HM Land Registry UK companies that own property (CCOD) and Overseas companies
  (OCOD), monthly full files from Use land and property data; free account and licence acceptance
  by the owner. Attribution per the HMLR licence.
- **Matching:** each title's property address → postcode → ONSPD LSOA; titles with no usable
  postcode are counted as unmatched and reported in the load log.
- **Store:** `area_ownership(geography_id, titles_company, titles_overseas, homes, unmatched)`;
  never stores proprietor names or addresses beyond the load.
- **Card:** share of homes on company-owned titles and on overseas-company titles, against London;
  words: "mostly owner/tenant homes" vs "high company ownership" from the London percentile.
- **Layer:** `ownership-company-share`, `ownership-overseas-share`. Group: `homes-area`.
- **Flag:** `CLOSE_KNIT_OWNERSHIP` default off; blocker: owner downloads the files under their
  account and confirms the licence terms allow display of aggregates. The session builds and tests
  against a synthetic fixture in the published column layout.
- **Caveat:** titles, not homes (one title can hold a block); includes commercial titles where
  the address is residential-looking.

### 5. Short lets (Inside Airbnb)

- **Source:** Inside Airbnb London `listings.csv.gz`, latest quarterly snapshot, CC BY 4.0.
- **Store:** `area_short_let(geography_id, listings, entire_home, active_12m, per_1000_homes)`;
  listing points are aggregated, not stored.
- **Card:** listings per 1,000 homes, share that are entire homes, active in the last 12 months
  (reviews in 12 months > 0), against London.
- **Layer:** `short-lets-per-1000`. Group: `homes-area`.
- **Caveat:** locations are jittered by Airbnb up to about 150 m; one platform only; a snapshot.
- **Attribution:** "Inside Airbnb, insideairbnb.com, CC BY 4.0."

### 6. Development pipeline (LDD) + Opportunity Areas

- **Source A:** London Development Database via Planning London Datahub (the API already used for
  applications, migration 030): permissions with net new homes, status (not started, under
  construction, completed) and dates. OGL v3 (same confirmation note as the applications row).
- **Source B:** London Plan Opportunity Areas and GLA Housing Zones boundaries, London Datastore,
  OGL v3.
- **Store:** `development_pipeline(site point, net_homes, status, permitted_on, completed_on)`
  (no applicant or description); `area_pipeline(geography_id, homes_not_started,
  homes_under_construction, homes_completed_5y, homes_within_1km)`; `opportunity_area(name,
  geometry)` with area overlap shares.
- **Card:** "≈ N new homes permitted or being built within 1 km", split by status; "inside the
  <name> Opportunity Area" line with a link to the GLA page.
- **Layer:** `pipeline-homes-per-1000`. Group: `homes-area`. Opportunity Areas also as an overlay
  outline if the map has an overlay slot; otherwise card only.
- **Caveat:** permissions are not completions; dates slip.

### 7. Mobile coverage (Ofcom) + LAEI flag

- **Source:** Ofcom Connected Nations mobile coverage files (same release family as the broadband
  data in migration 063), OGL v3. The session uses the finest London grain Ofcom publishes
  (postcode or output area if available, else local authority) and states which in the caveat.
- **Store:** `area_mobile(geography_id, outdoor_4g_all_mno, indoor_4g_all_mno, outdoor_5g_any,
  outdoor_5g_all)` as shares of premises or area.
- **Card:** next to broadband: 4G indoor from all four networks, 5G outdoor from any network.
- **Layer:** `mobile-4g-indoor`, `mobile-5g-outdoor`. Group: `homes-area`.
- **Caveat:** predicted coverage, not measured speed.
- **LAEI:** data already loaded (migration 061). Add `CLOSE_KNIT_AIR_QUALITY` gating the Health
  "Clean air" rating and its layer, default off, and the `FLAGS.md` row: blocker "GLA has not
  confirmed OGL v3 for LAEI 2022 (airqualitylondon@london.gov.uk)"; unblocks: owner on GLA reply.

### 8. HMO and landlord licensing

- **Source:** each borough's public HMO licence register (Housing Act 2004 s.232) and its
  additional and selective licensing scheme pages. Formats differ (CSV, XLSX, PDF, web table);
  one config per borough under `deploy/tools/hmo/boroughs/<slug>.yaml` with URL, format, terms
  and retrieval date, like the school-admissions configs.
- **Store:** `area_hmo(geography_id, licensed_hmos, per_1000_homes, boroughs_covered)` from
  postcodes only; `licensing_scheme(borough, kind, wards[], start, end, url)` mapped to areas via
  ward codes. Names, licence holders and full addresses are never stored.
- **Card:** licensed HMOs per 1,000 homes against London; "selective licensing in force (until
  <date>)" or "additional HMO licensing" line with the borough link.
- **Layer:** `hmo-per-1000`. Group: `homes-area`. Boroughs with no published register are grey,
  "not published", never zero.
- **Done means:** all 33 authorities attempted; the PR lists which loaded and why any did not.
- **Caveat:** licensed HMOs only (unlicensed and small HMOs outside additional licensing are
  missing); registers are updated at different times.

### 9. Future transport (TfL)

- **Source:** a curated `deploy/tools/future_transport.yaml`: each scheme (new station, line
  extension, major upgrade) with name, mode, station points or route line, status (under
  construction, consented, funded, proposed), expected year if published, and a TfL, GLA or DfT
  source URL. Points and dates are taken from those official pages; no third-party geometry.
- **Store:** `future_transport(scheme, station, point, status, expected_year, source_url)`;
  `area_future_transport(geography_id, nearest_station, distance_m, status, expected_year)`.
- **Card:** "New station <name> ≈ X km away, <status>, expected <year>" (closest one within
  2 km), with the source link.
- **Layer:** `future-station-distance` (lower is closer; only under construction and consented
  count). Group: `getting-around`.
- **Caveat:** plans change; proposed schemes are shown with that word, never as coming.
- **ULEZ:** already loaded (migration 030); no change.

## Risks

- Shared-file conflicts across nine PRs: kept to appends; each session rebases before merge.
- Migration collisions with v4 work: numbers reserved above main's 069 with a gap; re-check.
- Sources whose finest grain turns out coarser than planned (Ofcom mobile, HMO registers): the
  session ships the coarser grain with the caveat rather than stopping.
- CCOD/OCOD cannot be loaded until the owner has an account; the code ships behind its flag.

## Execution

Nine sessions, each in its own worktree, each given its source section plus "Shared rules". Each
session writes its own short implementation plan from its section, builds with tests, and opens
one PR. Review and merge as they pass.
