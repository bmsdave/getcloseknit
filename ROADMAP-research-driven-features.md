# Research-driven features roadmap

Source: [London housing search and valuation criteria research](docs/research/london-housing-criteria-2026-10/REPORT.md)
(October 2026, 784 read sources; sections 01–04 cited below as R01–R04).
Companion roadmaps: [personal area match](ROADMAP-personal-area-match.md),
[property intelligence](ROADMAP-property-intelligence.md). Nothing here
overrides their non-goals; each item below was checked against them.

## Why

Portals answer "what is listed in my radius at my price". The research shows
people decide on other questions, which they answer by hand across many
tools: the full monthly cost, what the home is really worth (sales in the
building, £/sqft), hidden risks (lease length, service charge, cladding,
flood, subsidence), whether a renter will pass referencing, and where else
in London fits (REPORT §1, §10; R01 §1–3; R03 §4).

## Segments

| Segment | Primary questions (research) |
|---|---|
| Buyers | Full cost of ownership, tenure and lease, building safety, sold evidence on the street (R01, R02) |
| Renters | Passing referencing (≈30× monthly rent), Renters' Rights Act from 1 May 2026, damp, real vs advertised rent (R01 §3) |
| Newcomers to London | £/m², walking minutes to a station, unit-level comparables, UK terms (leasehold, gazumping, chain, SDLT surcharge) (R04) |
| Local-market professionals | Estate and letting agents, buying and relocation agents, developers, investors: comparables, turnover, new-build premium, tenure mix, evidence packs, API/MCP access (R02, raw/uk-data-tools.md §5) |

## Wave 1 — build now (open data already licensed)

| # | Feature | Segment | Research basis | Data |
|---|---|---|---|---|
| 1 | Station access: walking minutes from homes to the nearest rail/tube/DLR/Overground/tram station; metric and 10th match factor | All | +8.0% for 500 m vs 1,500 m from a station in London, about twice Manchester (REPORT §1.5); walking minutes are the newcomer's default metric (R04) | OSM network (ODbL, aggregates only) + UPRN points |
| 2 | Up to three search zones (station + walk minutes, borough, LSOA set) and "Areas like this" | All | Over half of drawn Rightmove searches are ≤5 km² and often non-contiguous; the tool shapes search breadth (R01 §1, raw/acad-search.md) | Existing factor utilities |
| 3 | Sales in the same building and street; leasehold checklist upgrades (lease bands, service charge as % of value, EWS1/BSA questions by height) | Buyers | Comparables are the agent's primary evidence; lease <80 years cliff; service charge ≤1% vs ≥2% of value → 50% higher sale chance; no EWS1 → practically unmortgageable (R02, REPORT §2) | HMLR Price Paid; floor area only as aggregates (n ≥ 5) |
| 4 | Referencing check (30×/36× rent), Renters' Rights Act explainer, damp/mould viewing question, explicit rent-index label | Renters | RRA 2026; 44% of renters met damp or mould; asking rents run 20–35% above achieved (R01 §3, REPORT §6.2) | User input; ONS rent label |
| 5 | Inline glossary of UK terms; £/m² or £/sqft display preference | Newcomers | Home-market metrics and surprise at leasehold, gazumping, chains (R04) | Static, gov.uk links |
| 6 | Local market pack: turnover, new-build vs resale £/m² premium, leasehold share of sales, growth; printable street/area evidence pack; MCP tools | Professionals | Professionals screen on comparables, turnover and tenure; material-information duty under DMCC Act 2024 (R02, raw/uk-data-tools.md §5–6) | HMLR Price Paid, existing area evidence |

## Wave 2 — after wave 1; verify licences first

- Replace the preview fixtures for deprivation, income, social renting and schools with the registered sources (IMD 2025, ONS income, Census 2021 tenure, DfE), showing components, not a composite score.
- Crime: per-resident percentile, "visible disorder" categories (criminal damage, ASB) shown separately, warning for central LSOAs with large daytime populations (REPORT §2; raw/uk-data-tools.md §8).
- Full monthly cost by area: council tax band mix (VOA CTSOP, check OGL), borough Band D rates, TfL fares by zone.
- Risks: finish EA flood loading; Heathrow noise contours (CAA, licence to check); shrink–swell subsidence (BGS, licence to check); an overheating question in the viewing checklist.
- Schools: last distance offered and value-added. No admission probabilities.
- Developer site screening: PTAL (London Datastore, check OGL), conservation areas (planning.data.gov.uk), planning history beyond the pilot.
- Newcomers: Census 2021 map layers (ethnic makeup, religion, residents' age, household type; tenure and accommodation type under Homes & area) are shipped as descriptive map layers only: factual labels with the source, the neutral palette, the full breakdown on the area page, no ranking pages or "top areas for a group" lists, and never a Find my area or agent match criterion. A community infrastructure layer from OSM (places of worship, specialist shops, national schools) would follow the same rules.
- "What is changing": council tax surcharge for £2m+ homes from 2028, EPC C for lettings by 2030, leasehold reform status, transport schemes.

## Blocked or deferred

- Door-to-door commute: needs the TfL licence (`tfl-timetables` is blocked), then the R5 matrix in `deploy/routing/README.md`.
- Liquidity from listings (days on market, reductions) and rents below borough level: need a licensed feed.
- Free-hand polygon drawing: after wave-1 zones show use.
- Multilingual UI.

## Kept non-goals

No point price or valuation for an individual home; area price ranges and the
coarse position of recorded sales are allowed. No admission probabilities,
no "best neighbourhood" wording, no listings from portals, no ethnic ranking of areas.
(Owner decision 2026-10-12: facts and links of homes from estate agents' own sites are
allowed under the rules in [ROADMAP-agents-and-distribution.md](ROADMAP-agents-and-distribution.md).)

(Owner decision 2026-10-11: the property page's "Estimated price", the map's
"value now" colouring and the `get_stock_value` agent tool were removed; see
"Prices in this area today" in DESIGN.md and migration 040.)

## Risk to resolve (owner decision)

`get_address_history` already serves floor area and £/m² per sale
(`api/area_api/evidence.py`, `AddressSection` in
`web/src/components/evidence-panel.tsx`, `HISTORY_FIELDS` in
`api/tests/test_minimisation.py`). Whether that is allowed under the EPC
licence is the open legal question in `DATA-LICENCES.md`. Wave-1 features do
not copy this pattern: floor area appears only in aggregates of five or more
sales.

## Validation

Run `docs/london-user-validation-protocol.md` (AE-34) with added hypotheses:
people widen their zone when shown similar areas; the referencing check and
building sales are used; plus 4–6 interviews with agents and a developer.
