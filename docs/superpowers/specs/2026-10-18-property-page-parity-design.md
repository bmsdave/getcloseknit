# Property page: full area360 parity plus our layers

Date: 2026-10-18 · Branch: `claude/property-cards-feature-1f27f9` · Status: approved in chat (approach A), spec for review

## Goal

Every home in London gets one page, `/property/{id}`. The page covers everything area360's property profile shows and adds every Close Knit layer that applies to the home's area (road collisions, green and trees, noise, air, flood and more).

Restricted data is built in full behind default-off flags. We don't cut it (see [FLAGS.md](../../../FLAGS.md) and root [AGENTS.md](../../../AGENTS.md)).

Reference: area360, 120 Meadvale Road, W5 1LR, compared on 2026-10-18 against our `/postcode/W5-1LR?address=120+Meadvale+Road`. Earlier scan: `docs/area-clarity-2026-10/area360-coverage.md` (rows P1–P5, S1–S4, S9).

### What the owner asked for
- One `/property` page for every address, sold or not. The postcode page stays a list of homes plus the area.
- 100% coverage of area360's property page.
- Our map layers on the page too: road collisions, greenery and the rest.
- Restrictions become flags.

### Assumptions (correct me)
- Section order follows the 2026-10-15 canonical order in `docs/area-card-2026-10/decisions.md`. The home blocks come first, then the area in that order.
- Ratings are shown as a score out of 10 against London with a trend arrow, following the area-card direction. Census figures stay descriptive while `CLOSE_KNIT_CENSUS_RANKED` is off.
- Tools (investor calculator, stamp duty) sit in a Tools block near the end, not inline.

## Approach

**A (chosen): rebuild `/property` from the area page's existing sections plus a home block.**

Most area data already has an endpoint and a component: `AreaFullPage` sections, `PlacesSection`, `SafetyBody`, `PeopleSection`, `MarketSection`, `NearbySalesSection`, `SchoolPhaseRows`. The property page renders them for the home's LSOA. Where an endpoint accepts a home origin (places does, via the UPRN point), distances are measured from the home.

New API code is written only for what doesn't exist: the unsold-home route, a one-call layers scorecard, a road-collisions area metric, and the flagged home features.

Rejected:
- **B, one server-side "dossier" endpoint:** 2–3× the code, duplicates existing endpoints.
- **C, home block plus the whole area card embedded:** long and unfocused.

## Page, top to bottom

🚩 marks a block behind a default-off flag. Each one has a fallback, used while its flag is off.

### Home
1. **Header.**
   - Address, breadcrumbs: London › borough › area › postcode.
   - A mini map with a layer switch, matching area360's map with its 5 layers.
   - Links to Google Maps and Google Street View; Share; Save; Watch new listings; Report or hide this home.
2. **Price.**
   - 🚩 `CLOSE_KNIT_PER_HOME_VALUATION`: an estimated price with a range, £/m² against the local same-type median, and the estimate against the local same-type median.
   - Fallback, today's behaviour: "Prices in this area today" by type, plus the coarse band of the last sale.
   - The asking-price check stays in both cases.
3. **About the home.**
   - Type and tenure are always shown.
   - 🚩 `CLOSE_KNIT_EPC_PER_HOME`: construction period, floor area (m² and sq ft), habitable/heated rooms, floor level, current and potential EPC band, certificate date.
   - Fallback: "Not shown per home yet". This copy is already on the `claude/postcode-epc-flood` branch.
4. **Recorded sales.**
   - HMLR history, change since the last sale, and annualised change against the borough's same-type change.
   - When there are no sales: "No recorded sale", the same as area360.
   - 🚩 `CLOSE_KNIT_PER_HOME_PRICE_PER_SQM`: £/m² per sale.
5. **Other homes at this postcode.**
   - Every home with its tenure, last sale, and 🚩 floor area.
   - 🚩 `CLOSE_KNIT_EPC_ADDRESSES`: homes with no sale are listed too.
   - A link to "all homes at {postcode}".

### Area (the home's LSOA, canonical order)
6. **Overview.**
   - One row of rating tiles out of 10, each with a trend arrow, one per ranked layer: price, crime, station access, noise, green & trees, food hygiene, deprivation, income, social renting, the **new road-collisions layer**, and the 3 custom presets where this area rates highest. Flood, air and broadband have no map metric, so they show as band chips (e.g. "Flood: very low") next to the tiles, not as /10.
   - Each tile links to the map with that layer on.
   - A plain one-paragraph summary goes first, the way area360 opens its area block.
7. **Price & market.**
   - Median, £/m² (with sq ft alongside), sales in the last 12 months, the middle-50% range.
   - A by-type table: sales, median, £/m², P5/P25/P75/P95.
   - A 10-year trend by type, sale price and £/m².
   - A price-distribution box plot by type.
   - A list of recent sales nearby: date, address, type, tenure, price, from HMLR.
   - Private rents for the borough.
   - Source: `/areas/{id}/market-by-type`, `/recent-sales`, `/rents`.
8. **Getting around.**
   - Stations with distance from the home, zone and lines, plus the station-walk rating.
   - Cycle lanes and EV charging as presets.
9. **Safety.**
   - Crime per 1,000 people against London.
   - Top offences per 1,000, each with its change and London average (`SafetyBody`).
   - **Road collisions:** pedestrians and cyclists hurt within 500 m over 5 years (already in `kids.roadSafety`), with a link to the collisions map overlay.
10. **Schools.**
    - The nearest schools with distance, phase, type and Ofsted (`SchoolPhaseRows`), up to the number area360 shows (16), and the London comparison.
11. **Local places.**
    - Parks with size and distance.
    - Supermarkets, pubs, cafés and restaurants, pharmacies, with distance (`PlacesSection` with the home as origin).
    - Food hygiene.
12. **Environment.**
    - Flood: rivers and sea plus surface water, worst home band first. This uses the `claude/postcode-epc-flood` logic.
    - Noise in dB at the home when known, else the area share.
    - Air quality (`/health`; 🚩 `CLOSE_KNIT_AIR_QUALITY` for the LAEI grid).
    - Green & trees: nature score, canopy, green streets, street trees nearby.
    - Wildlife seen.
13. **Homes.**
    - Tenure and accommodation type (Census).
    - Social housing share.
    - Broadband: gigabit share and full fibre.
    - Planning context.
14. **People.**
    - Population and density.
    - Census tables: ethnic group, religion, qualifications, occupation, economic activity, age, household (`PeopleSection`).
    - Shown as descriptive shares only.
15. **Living costs.**
    - Council tax bands A–H for the borough (`/civic`).
    - 🚩 `CLOSE_KNIT_COUNCIL_TAX_BAND`: the home's own band.
16. **Tools.**
    - Investor calculator: buy-to-let, HMO, BRRR and flip, with yield, cash flow and tax. It extends the cost worksheet.
    - Stamp duty, mortgage costs.
17. **Photos nearby, sources, privacy note.**

## Routes and ids

| Home | Route | Indexed |
|---|---|---|
| Has a UPRN (sold, or EPC-addressed with `EPC_ADDRESSES` on) | `/property/{uprn}` (exists) | yes, in the sitemap |
| No UPRN, found at street level (OS Open Names + neighbouring HMLR numbers) | `/property/at/{POSTCODE}/{house-slug}`, e.g. `/property/at/W5-1LR/120-meadvale-road` | no (`noindex`, not in the sitemap: we don't compile address lists) |

- `/postcode/{code}?address=…&near=…` redirects (308) to the street-level route, so existing links and search results keep working.
- The postcode page drops its searched-home panel and stays a list of homes plus the area.
- The street-level page renders the same view. The home block says "No recorded sale; postcode likely {pc} (numbers {a} and {b} either side)", and every area section works because the area comes from the postcode.

## Flags

- `api/area_api/feature_flags.py` is the single module. It takes the same three functions from the `claude/extension-gaps` branch verbatim, so either merge order is trivial, and adds:
  - `epc_per_home()`: `epc_policy.per_home_epc` now delegates here;
  - `per_home_valuation()`, `per_home_price_per_sqm()` (requires `epc_per_home`), `epc_addresses()`, `council_tax_band()`, `air_quality()`.
- With a flag off, the API sets the withheld keys to null and adds `withheld: ["valuation", "epc", …]` to the payload. The web reads `withheld` and renders the fallback copy. It never guesses from nulls.
- Each flag gets a test with the flag off (payload identical to today) and with it on (field present).
- Flags whose data we don't have yet (`COUNCIL_TAX_BAND`) still get the function, the null key and the fallback. Turning one on with no data shows "Not available".
- FLAGS.md moves those rows from "planned" to "in code".

## New back-end work

1. **`GET /api/v1/areas/{id}/layers`.**
   - One call returns every map metric for the area: id, label, theme, value with unit, London rating out of 10 (from the percentile, the same calibration as the area tiles), trend direction over the metric's timeline, and whether it's ranked or descriptive.
   - Census metrics come back descriptive-only while `CENSUS_RANKED` is off.
   - It feeds the Overview tiles and each section's rating line.
2. **The `road-collisions` metric.**
   - Pedestrian and cyclist casualties from DfT STATS19 within each LSOA, per 1,000 residents per year over 5 years. Lower is better.
   - Loaded by an ETL and registered in `metric_definition`. A migration adds the metric row.
   - It becomes a map layer under Safety, next to the collisions overlay.
   - Never with a date, time or sex (`ROAD_CASUALTY_DETAIL` stays off).
3. **Property profile for street-level homes:** `GET /api/v1/homes/at/{postcode}/{house-slug}` returns the home block (likely postcode, neighbours either side, area id) or 404.
4. **Valuation behind the flag.**
   - With `EPC_PER_HOME` on: same-type local £/m² × floor area, rounded, with a P25–P75 range.
   - Otherwise: the last sale, indexed by the borough's same-type change.
   - Returned only when the flag is on, and never for a hidden home.
   - MCP `get_home_prices` gains the same field under the same flag.

## Out of scope
- Listing price history and days on market. That needs portal data (`PORTAL_LISTINGS` / `LISTING_HISTORY`, extension work).
- New choropleth layers for air, broadband and flood. They show as values in their sections; their map layers are a separate task.
- Borough and ward pages, ratings pages, FAQ (area360-coverage tracks L and J).

## Errors and empty states
- Each section loads independently, with its own empty state: "No data for this area", never a zero.
- When an endpoint fails, its section shows "Couldn't load" with a retry. The rest of the page still renders.
- A hidden home returns 404 with noindex, as today.

## Testing
- **API (pytest):** the layers endpoint, including that census is never ranked with its flag off; the road-collisions metric; the street-level home endpoint; every flag on and off; minimisation (no occupant fields).
- **Web (vitest):** the `withheld` fallbacks, the Overview tiles, the redirect from `?address=`.
- **e2e (Playwright):** a sold home (`/property/{uprn}`) and an unsold street-level home (W5 1LR, 120 Meadvale Road on fixtures). Every section heading is present, in both themes.
- `npm test`, including colour contrast and knit, per DESIGN.md.
- **Parity check:** a table in the PR description mapping each area360 block to our section, checked live in Chrome against the 120 Meadvale page.

## Delivery: themed PRs
1. **Flags and route.**
   - `feature_flags.py`, `withheld`, the street-level route and redirect.
   - Home blocks 1–5 rebuilt with the fallbacks.
   - Google Maps and Street View links.
2. **Area sections on the property page:** blocks 7–15 from the existing components, with distances from the home origin.
3. **Layers:** the `/layers` endpoint, the Overview tiles, and the `road-collisions` metric (ETL, migration, map layer).
4. **Tools:** the investor calculator.
5. **Flagged home features:** valuation, per-sale £/m², EPC-addressed homes, council tax band, LAEI.

Each PR ships when it passes, following the release decisions.
