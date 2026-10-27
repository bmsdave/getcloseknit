# Calculation audit and competitor cross-check (19 October 2026)

Third pass after `report.md` (1 Oct: crime, £/m², Ofsted, noise on 8 areas) and GitHub #147 (19 Oct: 5 homes vs
Rightmove / Zoopla / CrystalRoof / Area360). This pass covers what those two left out: ratings and London ranks,
match weights, the £/m² index dependency chain, rents, UK HPI, council tax, deprivation, commute, air, noise, schools
and the theme layers; plus a live cross-check on four new areas (Clapham SW4 017A, Stratford E15 009B, Richmond TW9
006A, Brixton SW9 011B) against ONS/UKHPI, MHCLG IMD 2025, Rightmove and the Close Knit MCP tools themselves.
Release checked live: `rel-202610190546-open-data-a`. Code read at `567307d9` (this branch); main `b4a08998` was
diffed for the files involved.

Not re-reported: anything already in #147–#164.

## Headline

Where an external figure exists, Close Knit reconciles once definitions are aligned: IMD 2025 deciles match MHCLG
4/4; typical prices sit on the portal *flat* averages (65–100 % leasehold sales); growth1y/3y/5y agree with the
served price series 4/4; percentiles are monotonic with values across areas. The bugs found are internal: a rate
shown with the wrong count, an index ratio that mixes geographies, nulls counted as zero, and copy that describes a
different method than the number uses.

## Bugs (ranked)

| # | Sev | Where | What is wrong | Example |
|---|---|---|---|---|
| C1 (#184) | **High** | `deploy/tools/etl_crime_release.py:104-121` → `api/area_api/safety.py:79,100-106` | A snap-gap LSOA takes its MSOA's crime **rate** but keeps its own tiny `sample_count` and category breakdown. The safety card then shows the MSOA rate next to the LSOA's 4 offences and per-type rates built from the LSOA count; the Overview hides the trend arrow (`sampleCount < 10`). | 1,500 residents, 4 own offences, MSOA rate 98 → "98 per 1,000 · 4 offences · Violence 1.3 (London 25.0)". No test covers a fallback row's count. |
| C2 (#185) | **Medium** | `deploy/migrations/040-area-price-bands.sql:79-89`, `008-sales.sql:116-135` | Price bands and stock values restate a sale by `now_v.value / at_sale.value` of the LSOA's £/m² rows with no quality check, so an observed LSOA median is divided by a borough fallback (or vice versa). Same root cause as #163's growth item, wider blast radius: every band, stock value and good-value `typical_price`. | 2023-03 row is borough fallback £5,800; 2026-06 observed LSOA £7,200: a £500k sale restates to £620k (+24 %) while the borough index moved +6 %. |
| C3 (#186) | **Medium** | `deploy/tools/etl_price_release.py:117-153` | Activating a new £/m² release never reruns `rebuild_area_price_bands`, `rebuild_stock_values`, `rebuild_zone_analytics` or good value (extends #163, which only lists growth/market depth). Bands, typical-price, stock value and good value stay adjusted by the previous index until the next `etl_sales.py load`. | `get_area_metric price-per-square-metre` says 2026-07 while the card's "adjusted to" and `area_good_value` still read 2026-06. |
| C4 (#187) | **Medium** | `deploy/migrations/009-noise.sql:51` | Road Lden median uses `coalesce(road_lden, 0)`: homes below the 40 dB mapping floor count as 0 dB. Shown on the area page and standouts as "Median N dB". | Levels [—, —, 52, 55] → "Median 26 dB"; any LSOA with >50 % unmapped homes → 0 dB. |
| C5 (#188) | **Medium** | `web/src/lib/places.ts:205`, `area-full-page.tsx:660,896` vs `station-access.tsx:2` | "Getting around" headline and station rows are straight-line ÷ 80 m/min with no detour, while the section's ⓘ says "timed along mapped OpenStreetMap paths at 4.8 km/h". The API's own estimate applies DETOUR 1.3 and a routed station walk exists (`facts.stationWalk`). | 800 m crow-fly → page "10 min", API 13 min, routed 12–14. ~25–30 % understated. |
| C6 (#189) | **Medium** | `api/area_api/standouts.py:427-437` | `deprivation_tag` applies ≥90 / ≤10 to the raw percentile of a 10-valued decile with no tie handling (every tile uses the tie-aware `london_rank`). Whole deciles (10–20 % of London) get "Among London's least deprived 10 %". Live: decile 8 → pct 86, so decile 9 likely crosses 90. | Under the ingest's ties-upper rule decile 9 → 90 and decile 10 → 100 both get the pro tag. |
| C7 | Low-med | `deploy/tools/crime_rates.py:62-66`, `etl_price.py:303-309`, `etl_station_access.py:454`, `quick_criteria.py:69-77`, `custom_criteria.py:429-441`, `pipelines/…/analytics.py:94-97`, SQL `percent_rank()` | Four tie conventions (split by code / ties-lower / mid-rank / ties-upper) feed the same /10 ratings and match ranges. Station-walk medians are rounded to 0.1 min so ties are common; two LSOAs at 7.0 min can differ by one /10 score. `match_model._percentile_maps` silently switches rule when any area lacks a stored utility. | rates {0,0,0,5,9}: crime ETL → 0,25,50,75,100; quick_criteria → 0,0,0,75,100; ingest → 60,60,60,80,100. |
| C8 | Low-med | `deploy/tools/school_measures.py:66-69`, `web/src/lib/school-card.ts:448` | Attainment 8 chart starts 2015/16 (old points scale) and runs into the 9-1 scale with no break or caveat; England average fell 49.9 → 46.3 from the scale change alone, so nearly every school shows a spurious first-year drop. | Start at 2016/17 or mark 2015/16. |
| C9 | Low | `api/area_api/commute.py:36-47,262-271` (live, 4/4 areas) | Headline minutes (R5 from the LSOA + last leg) and the listed routes (itinerary from the MSOA) never agree; the p10–p90 range excludes every route. Known cause (#163 commute item) but the symptom is total, not occasional. | Clapham 36 [34–37] vs route 30; Richmond 60 [57–65] vs 72/74. |
| C10 | Low | live: Richmond 006A | Overview centre (−0.2985, 51.4618: "Richmond station 3 min") and commute origin (−0.2854, 51.4564: 26-min walk to Richmond) are 1.1 km apart; the other three areas agree within 300 m. Check which centroid each uses. | |
| C11 | Low | `api/area_api/borough_standouts.py:348-352` | Borough 1-year price trend: `now` is the median over LSOAs with both prices, `ago` the median over all LSOAs priced at newest−12; the labelled 1 year can span 1–12 months for a stale LSOA. LSOA tile is correct. | |
| C12 | Low | `api/area_api/market.py:62-68` | `recent_sales.since/until` are table-wide min/max, not the area's, and the query scans the whole table per page. No web consumer today. | |
| C13 | Low | `deploy/migrations/014-market-depth.sql:58-93` | Turnover numerator placed by `address.geography_id`, denominator by `property.geography_id`; no upper bound, and one `address_id` with several UPRNs marks them all sold. Prevalence not measurable without the DB. | 3 dwellings, 4 sales → 133 %. |
| C14 | Low | `api/area_api/council_tax.py:32-39` vs `082-council-tax-band.sql:64-75` | Card percentile ranks all rows (float8), layer ranks `total >= 50` (2 dp): same LSOA can differ by a point across the card and the map. | |
| C15 | Low | `api/area_api/rent_trend.py:35-39`, `area_rents.py:31-35` | Rent series read without the active-release filter every other series uses; a staged-but-inactive reload mixes series and percentiles. | |
| C16 | Low | `deploy/migrations/057-postcode-sector.sql:256-271` | Real zone index: newest bucket deflates 12 sale months by the mean of the 10–11 CPIH months that exist (≈ +0.25 pt overstatement). | |
| C17 | Low | `api/area_api/safety.py:16-17,109-121` | `trend()` docstring says ~3 years; ETL writes 12 periods so it can only span 11 months, and the 15 % "stable" threshold was tuned for 3 years. Page wording is honest. | |
| C18 | Low | `deploy/tools/etl.py:125-135` | Legacy ETL ranks no-population areas as rate −1 and lets them take percentile slots. Only matters if still run. | |

## Copy that contradicts the data

- **Noise includes aircraft; the captions say it does not.** Live release `src-defra-noise-round4-2022-road-rail-air`
  ("airports, 2021 operations"), Richmond 006A any55 0.89 vs road 0.386 + rail 0.15 (impossible without a third
  source). But `get_area_evidence_pack`'s description and `schools.noise_payload` caveats say "road and rail", and
  the repo's `etl_noise.py` (also on main) says "aircraft noise is not included". The air loader is a prod-side
  bundle (RELEASE-CHECKLIST.md:334), not in the repo. **#157's premise ("data is road + rail only") is wrong** (filed as #190):
  the fix is the opposite direction, and `quiet` rank / My match noise already include Heathrow.
- Live user-facing but legitimate (caveat, not bug): Richmond→Bank 60 min because National Rail is excluded (SWR
  would be ~32); Brixton 011B crime 1,188 per 1,000 on 87 dwellings (town-centre, resident denominator); Richmond
  growth1y −10.6 % on ~2 sales/month; rent quoted is the ONS 2-bed figure (£2,222) where ONS's headline is
  all-property (£2,333).

## Checked and found correct

SDLT and council-tax ratios; HPI and rent percent-change math; CPIH formula; good-value direction; crime/air/nature
percentile orientation; mid-2024 denominators on both sides of the crime rate; ROC match weights sum to 1, Musts
weightless, soft edge < exact hit; ratings/10 formula; London-rank tie rule; flood band order; NO2 vs 40 µg/m³;
school radius/limit; IMD 2025 deciles 4/4; growth vs series 4/4; percentile monotonicity across six metrics;
overview NO2 percentile = metric percentile.

## Not verified

No DB in this worktree: prevalence of C2, C6, C13 and of LSOAs with >50 % unmapped noise homes. The IMD/income
percentile loader and the air-noise loader are outside the repo. Web ratings/arrows not checked live (basic auth);
TfL Journey Planner and CrystalRoof NO2 pages were unreachable. Tests: `api` 88 and `deploy` 67 in-scope tests pass
on this branch; none of them cover C1–C6.

## Suggested order

C1 (one ETL change + safety.py reading `quality`), C2+C3 together (same index chain), C4 (one SQL line), C5 (use
`facts.stationWalk`), C6 (reuse `london_rank`), then C7 as one shared percent-rank helper. Each is one issue = one PR
per #147's convention.
