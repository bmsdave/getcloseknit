# London Personal Area Match and Open-Data Plan

## Summary

Extend [London Close Knit](README.md) from separate analytics layers into an explainable, user-configured area-ranking product. Whether London households understand the explanations, reach a better shortlist with them, or would pay for the output is unvalidated until the [AE-34 study protocol](docs/london-user-validation-protocol.md) reports.

- Rank London LSOAs using the user’s own limits and 0–5 importance weights.
- Support buying and renting, multiple commute destinations, school discovery and shortlists, crime, deprivation, income, social renting, present prices, affordability, and growth outlook.
- Produce one 0–100 personal match score, but always expose raw values, component contributions, true source geography, missing evidence, and methodology.
- Keep profiles locally without login. Send them transiently to the self-hosted scoring API. Persist only explicitly opted-in, redacted aggregate usage events for product analytics and debugging; never persist raw profiles, exact destinations, or request bodies. Include sensitive details in URLs only through an explicit Share action.
- Preserve the five existing map layers and `/api/v1` compatibility. This plan supersedes only the earlier prohibition on composite scoring.
- Continue using MapLibre; leave the frozen custom renderer untouched.

## Data and Analytics

| Evidence | Authoritative sources | Reliable carrier and cadence |
|---|---|---|
| Sale price and affordability | HM Land Registry Price Paid Data, EPC floor area, ONS CPIH and UK HPI | Rolling 12-month LSOA median with existing 20-sale MSOA/borough fallback; monthly |
| Private rent | ONS Price Index of Private Rents | Borough/local authority by bedroom count; monthly and explicitly low precision |
| Crime | police.uk records plus ONS population denominators | Published LSOA, rolling 12-month rate per 1,000 and category history; monthly |
| Deprivation | English Indices of Deprivation 2025 | LSOA; release-based |
| Income | ONS small-area income estimates and confidence intervals | MSOA; release-based |
| Social renting | Census 2021 tenure tables | LSOA; census release |
| Commute | OSM street network and registered open TfL timetable feeds | LSOA-origin travel matrices; network version weekly |
| Schools | DfE GIAS, Explore Education Statistics, Ofsted, Parent View, DfE applications/offers, council admissions publications | School point plus source-specific observations; daily to annual |
| Environmental noise | DEFRA strategic noise maps, TfL road and rail noise data, Network Rail noise information, CAA aircraft noise contours and flight-path data | LSOA or raster-derived exposure by road traffic, rail traffic, and aircraft; release-based with source-specific updates |
| Extensible lifestyle and amenity signals | Versioned open-data adapters for OSM, TfL, local authorities, NHS, Sport England, environmental agencies, and other redistribution-compatible sources | Source-specific geography, provenance, confidence, and cadence; examples include coffee/kebab venue ratios, gyms, shops, community facilities, access to parks and rivers, and running, cycling, or rowing amenities |

The sources above are reusable but have materially different precision. HMLR publishes monthly OGL price-paid data, police.uk publishes monthly anonymised locations, IMD 2025 is LSOA-level, ONS income is MSOA-level, and official rent values are local-authority-level. [HMLR](https://www.gov.uk/government/statistical-data-sets/price-paid-data-single-file), [police.uk](https://data.police.uk/about/), [IMD 2025](https://www.gov.uk/government/statistics/english-indices-of-deprivation-2025), [ONS income](https://www.ons.gov.uk/peoplepopulationandcommunity/personalandhouseholdfinances/incomeandwealth/bulletins/smallareamodelbasedincomeestimates/financialyearending2023), [ONS rents](https://www.ons.gov.uk/economy/inflationandpriceindices/bulletins/privaterentandhousepricesuk/latest)

Implementation rules:

- Make every ingest immutable and reproducible: source URL, retrieval and release dates, checksum, licence, attribution, geography vintage, transformation version, caveats, and validation result.
- Target 2021 LSOAs for ranking. Use official crosswalks only where aggregation is mathematically valid; never interpolate incompatible geography into false precision.
- Project coarser values onto candidate LSOAs only for scoring and rendering, while retaining `carrierGeographyId`, carrier label, source version, and a visible resolution warning.
- Keep raw values and derived utilities separate in PostGIS. Add school entities/observations, admission evidence, route-network releases, LSOA travel matrices, forecast runs, and backtest results. Store no user profiles.
- Do not scrape or reuse competitor ratings. Unofficial data may enter only through a stable bulk interface with an explicit redistribution-compatible licence.

### Personal scoring

Define nine factors: affordability, present market level, growth outlook, crime, deprivation, income, social renting, commute, and schools.

- Apply must-have limits first. Missing evidence for a must-have excludes that area.
- Convert available soft factors to 0–100 utilities and calculate a weighted arithmetic mean.
- Weight zero means “ignore.” Missing soft evidence is omitted and remaining weights are renormalised.
- Return `evidenceCompleteness` separately from the match score; never substitute missing values with an average.
- Observational metrics use London empirical percentiles with the chosen higher/lower/target-range direction.
- Affordability compares the relevant purchase or bedroom-specific rent value with the user’s target and maximum budget.
- Commute combines destination-specific scores using their weights and target durations.
- Rank by match score, using evidence completeness only as a tie-breaker.
- Every result explains the raw value, utility, weight, contribution, carrier, source, and any failed limit. Wording must say “match for your priorities,” never “best neighbourhood.”

### Forecasting

- Forecast area-level £/m², never an individual property value.
- Model log price trends at the reliable LSOA/MSOA/borough carrier using hierarchical shrinkage toward parent and London trends.
- Compare seasonal-naive, no-change, and damped-trend candidates through rolling-origin backtests; publish the selected model, training window, error, and interval coverage.
- Provide 10th/50th/90th percentile ranges for one year and downside/base/upside real-price scenarios for five years.
- Permit either horizon in the growth priority. Rank on the conservative 20th-percentile real-growth outcome so uncertainty reduces, rather than inflates, the score.
- Suppress the factor when history is insufficient, a backtest does not beat the naive baseline, or interval calibration fails. The ordinary historical chart remains available.

## Schools and Commute

### School evidence

Create `SchoolId` as `uk:school:<URN>` and join predecessor/successor URNs without silently merging historical observations.

School profiles expose factual, separately sourced facets:

- Phase, age range, type, gender, faith, selectivity, capacity, location, and SEN provision.
- KS2 or KS4 progress and attainment with cohort size and published confidence intervals.
- Current Ofsted report-card aspects; retain historical overall grades only as explicitly legacy observations because Ofsted no longer issues one overall judgement. [Ofsted report cards](https://www.gov.uk/guidance/understanding-ofsted-report-cards-and-grades)
- Attendance, persistent absence, exclusions, pupil characteristics, applications, offers, and Parent View results where the official minimum response count is met.
- Each user chooses which quality facets matter. The product does not manufacture one house-defined school rating.

For area matching:

- Filter eligible schools by phase and user-selected characteristics.
- Calculate journey access using the school arrival window.
- Average the best user-selected number of reachable options, defaulting to three; missing option slots score zero.
- Treat named shortlisted schools as explicit weighted targets.
- Keep admissions evidence outside the comparable London-wide school score.

Admissions presentation has three evidence states:

1. `verified-boundary`: an official reusable priority/catchment polygon with year and source.
2. `historical-reach`: at least three comparable official annual last-offer distances under the same admissions rule, school site, and measurement method; display “within the published distance in X of Y years” and every underlying cutoff.
3. `unavailable`: show criteria and journey distance, but make no admission approximation.

Never call a circle a catchment, never display a numerical admission probability, and never infer faith, sibling, EHCP, aptitude, or feeder eligibility. Archived GLA pupil-flow data may appear as historical context only. DfE school-level applications are openly available, while council cutoff and polygon coverage remains patchy. [DfE applications/offers](https://explore-education-statistics.service.gov.uk/find-statistics/primary-and-secondary-school-applications-and-offers/2025-26/explore), [GLA historical flows](https://www.data.gov.uk/dataset/4db243fa-4c4c-4761-bc5e-6aac9c64fa9e/london-schools-atlas1)

### Routing

- Pin and self-host both R5 and OpenTripPlanner using the same versioned OSM and converted timetable releases.
- Use R5 for one-to-many LSOA matrices across a typical weekday time window; it is designed for matrix analysis, whereas OTP2 deliberately excludes that workload. [R5](https://github.com/conveyal/r5), [OTP analysis guidance](https://docs.opentripplanner.org/en/v2.7.0/Analysis/)
- Use OTP for detailed itineraries from a selected area/address to a destination and for sampled consistency checks against R5.
- Support public transport, walking, and cycling. Exclude driving and live disruption claims.
- Snap cache keys to a coarse destination grid and time band; retain exact coordinates only for the active request.
- Return median and variability bands, unreachable status, transfers, walking duration, network version, and timetable date.
- For an uncached matrix, return an asynchronous job with partial non-commute results. Weight changes reuse the cached matrix and must not rerun routing.
- Load National Rail timetables once the operator registration completes (Rail Data Marketplace; see deploy/routing/README.md). Until then, National Rail-only areas are flagged in commute and find_areas: get_commute reports confidence "low" with a caveat naming the station, and find_areas scores them as unknown rather than excluded under must place limits (#210).

## Public Contracts and Product Experience

Add backward-compatible `/api/v1` contracts:

- `FactorDefinition`: factor ID, unit, allowed directions, carrier policy, utility definition, periods, caveats, and scoring eligibility.
- `PreferenceProfile`: version, buy/rent housing inputs, factor weights and limits, forecast horizon, commute destinations, school criteria/facet weights, shortlist URNs, and desired school count.
- `POST /api/v1/matches`: transient profile input; returns `MatchPack` or a `202 MatchJob`.
- `MatchResult`: geography, score, rank, evidence completeness, unmet limits, source release set, and component explanations.
- `GET /api/v1/schools` and `/schools/{urn}`: discovery and fully sourced school evidence.
- `GET /api/v1/areas/{id}/schools`: accessible and shortlisted schools plus admissions evidence.
- `POST /api/v1/journeys`: OTP itinerary details for one selected origin/destination.
- `GET /api/v1/areas/{id}/price-forecast?horizon=1y|5y`: forecast range, scenarios, carrier, model version, backtest metrics, and suppression reason.
- Extend map state with `personal-match`; explicit profile sharing uses a versioned compressed URL fragment so browsers do not send it automatically with ordinary page requests.

Add a dedicated API service inside the repository root; Next.js remains the web application and fixture/test façade, while web and native clients consume the same production API. Extend the existing analytics pipeline for all acquisitions, feature construction, forecasts, school matrices, and immutable releases.

The web journey is:

1. Open individual layers without an automatic score.
2. Start guided setup: buy/rent, budget and bedrooms, destinations, school needs, then priorities.
3. Adjust limits and weights from a persistent priority panel; debounce recomputation and show route-job progress.
4. Render the personal match through MapLibre feature state, with confidence/resolution styling and a non-colour ranked list.
5. Selecting an LSOA opens right-side or mobile-sheet tabs for Match explanation, Trends, Schools, Commutes, and the LSOA→MSOA→borough→London hierarchy.
6. Address selection adds known transaction/EPC history and surrounding-area evidence, but no live listing or property valuation.
7. Charts show crime categories and history, prices and forecast ranges, available socioeconomic history, school facets/admissions evidence, and commute variability.

## Delivery and Verification

1. Add failing contract and pipeline tests, source adapters, production PostGIS migrations, and a public data catalogue; replace preview values only after source validation.
2. Ship the scoring engine using the existing five evidence families, guided profile UI, explanations, local persistence, and explicit sharing.
3. Add R5 matrices, OTP itinerary details, routing caches, multiple destinations, and partial-result jobs.
4. Add the school registry, official quality facets, discovery/shortlists, council admissions-source registry, verified polygons, and historical-reach evidence.
5. Add forecast/backtest releases, one- and five-year charts, and selectable growth scoring.
6. Stabilise OpenAPI, generated TypeScript/Swift/Kotlin models, deep links, methodology, and accessibility before extending native clients.

Required tests:

- Fixture-based ingest tests for every source, licence manifest, geography vintage, joins, denominators, rolling windows, category totals, and deterministic outputs.
- Scoring vectors covering zero weights, directions, target ranges, limits, coarse carriers, missing evidence, multiple destinations, school shortlists, and exact contribution totals.
- School tests proving that fewer than three comparable cutoff years never produce historical reach, admissions-regime changes invalidate comparison, and no evidence becomes a probability.
- Synthetic OSM/GTFS routing tests for time windows, transfers, unreachable areas, daylight-saving changes, cache isolation, and R5/OTP spot agreement.
- Leakage-free forecast tests, naive-baseline comparison, interval calibration, sparse-data fallback, and suppression.
- OpenAPI validation plus generated-model conformance across web, Swift, and Kotlin.
- Playwright journeys that operate every setup step, limit, weight, direction, horizon, destination, school filter, shortlist, chart, share action, deep link, and mobile sheet.
- Accessibility coverage for keyboard sliders, screen-reader score explanations, textual legends, reduced motion, focus management, and non-colour confidence/missing-data presentation.
- Rendering tests retain the repository’s 10 ms p95 frame-work budget; ranking runs off the render cadence and feature-state updates are diffed and chunked.
- Tests use committed government-style fixtures and synthetic transport networks, never live APIs.

## Assumptions

- London and 2021 LSOAs are the initial ranking universe; England remains the comparison population.
- Profiles are local, account-free, and processed ephemerally by a self-hosted API with request-body logging disabled.
- Typical weekday schedules are used; live disruption and driving are out of scope.
- Official coarse rental data is preferable to commercially licensed listing data.
- School admissions evidence is helpful context, not a guarantee and not part of the London-wide school score.
- Five-year output is a scenario distribution, even when selected as a growth priority.
- Conditional expansion and forecast/agent features advance only where study evidence connects them to a household decision; anything participants cannot connect to a decision is narrowed or stopped per the evidence summary.
- Hosting, timetable registration, and data processing have operating costs even though the product and code remain free and MIT-licensed.
