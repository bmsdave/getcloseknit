# Property page parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every London home one page, `/property/…`. It covers everything on area360's property profile, adds every Close Knit layer for the home's area, and puts restricted data behind default-off flags.

**Architecture:** API flags live in one module and withhold data (null keys plus a `withheld` list). A new street-level home endpoint and route serve unsold homes. The property page has home blocks 1–5, then the area page's existing sections, rendered with the home as origin. A new `/layers` endpoint feeds the overview tiles, including a new `road-collisions` metric.

**Tech Stack:** Python 3.12 (stdlib `unittest`, FastAPI, psycopg), Postgres/PostGIS, Next.js (read `web/AGENTS.md`: this Next has breaking changes), TypeScript, `tsx --test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-18-property-page-parity-design.md` (read it with this plan). Flag registry: `FLAGS.md`. Rules: `AGENTS.md`, `DESIGN.md`.

## Global Constraints

- Flags are env vars `CLOSE_KNIT_*`, read only in `api/area_api/feature_flags.py`. `"1"` = on, anything else = off. Default is off.
- With a flag off, the response is identical to today's apart from the added `withheld` list. The withheld keys stay, with null values.
- The web decides fallbacks from `withheld`, never from nulls.
- Census stays descriptive (never rated) while `CLOSE_KNIT_CENSUS_RANKED` is off.
- Street-level home pages are `noindex` and never appear in a sitemap.
- No road casualty date, time or sex anywhere.
- Area section order: Price → Getting around → Safety → Schools → Local places → Environment → Homes → People → Living costs.
- UI uses tokens only, both themes, knit components (DESIGN.md). Text is selectable.
- Every flag added or changed updates its `FLAGS.md` row in the same commit.
- Verify per task:
  - API: `cd api && python3 -m unittest tests.<module> -v`
  - Web: `cd web && npx tsx --test tests/<file>.test.ts`
  - e2e: `cd web && npx playwright test e2e/<file>.spec.ts`
  - Full suite once per PR: `./gate.sh`

## Review Focus

1. **A house slug that doesn't parse or resolve** (`/property/at/W5-1LR/flat-b`, `/property/at/W5-1LR/999-meadvale-road`, a lower-case or spaced postcode). Expect a 404 page with `noindex`, never a 500. Tests: Task 3 and Task 4.
2. **A home the owner hid,** reached by UPRN, by the street route, or by the old `?address=` link. Expect a 404 with `noindex` on every path. Tests: Task 3 and Task 4.
3. **Flag combinations.** `PER_HOME_PRICE_PER_SQM=1` with `EPC_PER_HOME` off keeps per-sale £/m² withheld; the `HOME_VALUE` chain behaves the same. Tests: Task 1.
4. **An area with no data for a layer.** The tile reads "No data", never 0, and is never rated. Tests: Task 8.
5. **One area endpoint failing.** Only that section shows "Couldn't load"; the home blocks still render. Tests: Task 6.

---

## PR 1: flags, street-level route, home blocks

### Task 1: Flags module and `withheld`

**Files:**
- Create: `api/area_api/feature_flags.py`, `api/tests/test_feature_flags.py`
- Modify: `api/area_api/epc_policy.py` (`per_home_epc` delegates), `FLAGS.md` (rows → "in code")

**Interfaces:**
- Produces, in `feature_flags.py`:
  - `address_match() -> bool`, `home_value() -> bool`, `listing_history() -> bool`, copied verbatim from `claude/extension-gaps:api/area_api/feature_flags.py` so a later merge is trivial.
  - `epc_per_home() -> bool` (`CLOSE_KNIT_EPC_PER_HOME`).
  - `per_home_price_per_sqm() -> bool`: requires `epc_per_home()`.
  - `per_home_valuation() -> bool` (`CLOSE_KNIT_PER_HOME_VALUATION`).
  - `epc_addresses() -> bool` (`CLOSE_KNIT_EPC_ADDRESSES`).
  - `council_tax_band() -> bool` (`CLOSE_KNIT_COUNCIL_TAX_BAND`).
  - `air_quality() -> bool` (`CLOSE_KNIT_AIR_QUALITY`, main's one air flag; was `laei_air()`).
  - `withheld() -> list[str]`: the off subset of `["epc", "pricePerSqm", "valuation", "epcAddresses", "councilTaxBand", "laeiAir"]`, in that order.

- [ ] **Step 1: Write failing tests** in `test_feature_flags.py`, with `mock.patch.dict(os.environ, clear=False)` and each var popped in `setUp`:
  - `test_all_off_by_default`: every function is `False`; `withheld()` returns all six names in order.
  - `test_one_means_on`: `"1"` → True, while `"true"`, `"0"` and `" "` → False.
  - `test_price_per_sqm_needs_epc`: `PER_HOME_PRICE_PER_SQM=1` alone → False; together with `EPC_PER_HOME=1` → True.
  - `test_home_value_needs_address_match`: the same check for `home_value`.
  - `test_epc_policy_delegates`: patching `feature_flags.epc_per_home` to return True makes `epc_policy.per_home_epc()` True.
- [ ] **Step 2:** Run `cd api && python3 -m unittest tests.test_feature_flags -v`. Expect FAIL (module missing).
- [ ] **Step 3:** Implement the module and the delegation. Keep `epc_policy`'s public names: `test_epc_policy` must still pass.
- [ ] **Step 4:** Run `tests.test_feature_flags` and `tests.test_epc_policy`. Expect PASS.
- [ ] **Step 5:** Update FLAGS.md (the six flags → "in code"), then commit `feat(api): feature_flags module and withheld list`.

### Task 2: Profile and postcode payloads carry `withheld`; web fallbacks read it

**Files:**
- Modify: `api/area_api/property_profile.py` (`property_profile`, `postcode_homes`), `web/src/lib/property-profile.ts` (type), `web/src/components/property-profile.tsx` (`FactsCard`, `SalesCard`, `OtherHomesCard`)
- Test: `api/tests/test_property_profile.py`, `web/tests/property-profile.test.ts` (create if absent)

**Interfaces:**
- Consumes: `feature_flags.withheld()`.
- Produces:
  - `profile["withheld"]: list[str]` and `payload["withheld"]` on postcode homes.
  - The TS type `Withheld = "epc" | "pricePerSqm" | "valuation" | "epcAddresses" | "councilTaxBand" | "laeiAir"`.
  - `isWithheld(list: readonly Withheld[] | undefined, key: Withheld): boolean` in `web/src/lib/property-profile.ts`. An undefined list means nothing is withheld, for old payloads.

- [ ] **Step 1: Failing API tests.**
  - `test_profile_lists_withheld_when_flags_off`: `profile["withheld"]` contains `"epc"` and `"valuation"`.
  - `test_profile_withheld_empty_with_all_flags_on`.
  - `test_per_sale_price_per_sqm_withheld_without_epc`: with only `PER_HOME_PRICE_PER_SQM=1`, every sale's `pricePerSquareMetre` is None.
- [ ] **Step 2: Failing web tests.**
  - `isWithheld(undefined, "epc") === false`; `isWithheld(["epc"], "epc") === true`.
  - Facts rendering with `withheld: ["epc"]` shows "Not shown per home yet". Reuse the copy constant from `claude/postcode-epc-flood` if that branch has merged; otherwise define `EPC_WITHHELD_COPY = "Not shown per home yet"` in `web/src/lib/property-profile.ts`.
- [ ] **Step 3:** Run both. Expect FAIL.
- [ ] **Step 4:** Implement. The facts card shows type and tenure always and the EPC rows only when `!isWithheld(…, "epc")`. Per-sale £/m² is shown only when `"pricePerSqm"` is not withheld.
- [ ] **Step 5:** Run both. Expect PASS. Commit `feat: property payloads say what they withhold`.

### Task 3: Street-level home endpoint

**Files:**
- Create: `api/area_api/street_home.py`, `api/tests/test_street_home.py`
- Modify: `api/area_api/app.py` (route), `api/area_api/evidence.py` (extract the per-row body of `_street_results` into `street_candidates(connection, number: int, street: str, borough_id: str | None) -> dict`, used by both)

**Interfaces:**
- Produces:
  - `parse_house_slug(slug: str) -> tuple[int, str] | None`: `"120-meadvale-road"` → `(120, "MEADVALE ROAD")`. A slug with no leading number → None.
  - `street_home(connect, postcode: str, house_slug: str, cancel=None) -> dict | None` returns `{"label": "120 Meadvale Road", "postcode": "W5 1LR", "likelyPostcode": "W5 1LR", "neighbours": [116, 124], "areaId": "E01001209", "point": {"lat": …, "lon": …} | None, "withheld": [...]}`. It returns None when the street isn't in that postcode's streets, the number is already a recorded home (the caller should use its UPRN; return `{"uprn": …}` instead), or the home is hidden.
  - Route: `GET /api/v1/homes/at/{postcode}/{house_slug}` → 200 with that dict, or 404 (`errors.not_found`).

- [ ] **Step 1: Failing tests** (fixture connection, following `test_property_profile.FakeConnection`):
  - `test_parse_house_slug`: `"120-meadvale-road"` → `(120, "MEADVALE ROAD")`; `"flat-b"` → None; `"12a-high-street"` → `(12, "HIGH STREET")`.
  - `test_unsold_home_resolves`: W5 1LR, 120 Meadvale Road → `likelyPostcode == "W5 1LR"` and `neighbours == [116, 124]`.
  - `test_unknown_number_on_unrelated_street_is_none`.
  - `test_recorded_home_returns_uprn`: 116 Meadvale Road → `{"uprn": …}`.
  - `test_hidden_home_is_none`.
  - `test_lowercase_spaced_postcode_accepted`: `"w5 1lr"` behaves like `"W5-1LR"`.
- [ ] **Step 2:** Run `tests.test_street_home`. Expect FAIL.
- [ ] **Step 3:** Implement. Reuse `street_numbers` and `likely_postcode` from `evidence.py`.
- [ ] **Step 4:** Run `tests.test_street_home` and `tests.test_property_evidence`. The refactor must not change search. Expect PASS.
- [ ] **Step 5:** Commit `feat(api): street-level home endpoint`.

### Task 4: Web routes: `/property/at/…`, the `?address=` redirect, noindex

**Files:**
- Create: `web/src/app/property/at/[postcode]/[house]/page.tsx`, `web/src/lib/street-home.ts`, `web/tests/street-home.test.ts`, `web/e2e/street-home.spec.ts`
- Modify: `web/src/app/postcode/[code]/page.tsx` (redirect; remove the searched-home panel), `web/src/lib/postcode-search.ts:313` (street results link straight to the new route), `web/src/lib/seo.ts` (excluded from the sitemap; add a test assertion)

**Interfaces:**
- Consumes: the Task 3 route.
- Produces, in `street-home.ts`:
  - `houseSlug(label: string): string` (`"120 Meadvale Road"` → `"120-meadvale-road"`).
  - `streetHomePath(postcode: string, label: string): string` → `/property/at/W5-1LR/120-meadvale-road`.
  - `loadStreetHome(mode, postcode, slug): Promise<StreetHome | { uprn: string } | null>`.

- [ ] **Step 1: Failing unit tests.**
  - `houseSlug` and `streetHomePath` with W5 1LR, 120 Meadvale Road.
  - `postcode-search` street results link to `/property/at/…`.
  - The sitemap builder output contains no `/property/at/`.
- [ ] **Step 2: Failing e2e test.**
  - `/postcode/W5-1LR?address=120+Meadvale+Road&near=116-124` lands on `/property/at/W5-1LR/120-meadvale-road`, with status 308.
  - The page has `meta[name=robots][content*=noindex]` and the heading "120 Meadvale Road".
  - An unknown slug shows the not-found page with noindex.
  - A `{uprn}` answer redirects to `/property/{uprn}`.
- [ ] **Step 3:** Run both. Expect FAIL.
- [ ] **Step 4:** Implement. Use the Next redirect API for this version (`node_modules/next/dist/docs/`). The page renders `HomePage` from Task 5. Until Task 5 lands, render the header and the "No recorded sale" line only.
- [ ] **Step 5:** Run both. Expect PASS. Commit `feat(web): street-level home route and postcode redirect`.

### Task 5: `HomePage`, one view for both routes, blocks 1–5

**Files:**
- Create: `web/src/components/home-page.tsx`
- Modify: `web/src/app/property/[uprn]/page.tsx`, `web/src/app/property/at/[postcode]/[house]/page.tsx`, `web/src/components/property-profile.tsx` (export the cards it already has)
- Test: `web/e2e/property-profile.spec.ts`

**Interfaces:**
- Consumes: `isWithheld`, `StreetHome`, the existing `PropertyProfileView` cards.
- Produces: `HomePage({ home, mode, release }: { home: { kind: "uprn"; profile: PropertyProfile } | { kind: "street"; street: StreetHome }; mode: DataMode; release: string })`.
- Produces: `mapLinks(point: {lat:number;lon:number}) => { maps: string; streetView: string }`, with `maps = https://www.google.com/maps/search/?api=1&query={lat},{lon}` and `streetView = https://www.google.com/maps/@?api=1&map_action=pano&viewpoint={lat},{lon}`.

- [ ] **Step 1: Failing e2e tests.** For both a UPRN fixture home and the street fixture home, these test ids are visible, in this order:
  - `home-header` (address, breadcrumbs, Google Maps, Street View, Share, Save, Watch, Report or hide)
  - `home-price`
  - `home-facts`
  - `home-sales`
  - `home-other-homes`

  The street home's `home-sales` text contains "No recorded sale". `home-other-homes` links to `/postcode/W5-1LR/homes`.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement by moving the existing cards into `HomePage` in that order. Add `HomeMiniMap({ point, geographyId })` in `web/src/components/home-mini-map.tsx`:
  - MapLibre with the main map's style and choropleth tile source;
  - a home pin;
  - a layer select (Price, Crime, Deprivation, Income, Social housing);
  - zoom only;
  - a click opens `/?selected={id}&layer={metric}`.

  Postcode centroid when the street home has no point. Test id `home-mini-map`.
- [ ] **Step 4:** Run `property-profile.spec.ts`, `street-home.spec.ts` and `postcode-page.spec.ts`. Expect PASS. Check both themes.
- [ ] **Step 5:** Commit `feat(web): HomePage view for every home`. **Open PR 1** with the parity table (spec "Testing").

## PR 2: area sections on the home page

### Task 6: `AreaSectionsForHome`

**Files:**
- Modify: `web/src/components/area-full-page.tsx`. Extract `AreaSectionsForHome({ geographyId, mode, release, period, uprn, addressId, origin })` from `AreaFullCard`'s evidence loading plus `AreaFullBody` with `sheet={false}`, without the area header or verdict.
- Modify: `web/src/components/home-page.tsx` (render it after block 5).
- Test: `web/e2e/property-section.spec.ts`

**Interfaces:**
- Consumes: `HomePage`.
- Produces: `AreaSectionsForHome` with `origin: { uprn: string } | { postcode: string }`, passed to `PlacesSection` as `uprn` when present. `HomePage` ends with photos nearby (`PostcodePhotos`, test id `home-photos`) and sources plus the privacy note (`home-sources`), after the sections.

- [ ] **Step 1: Failing e2e tests.**
  - On both fixture homes, the area section headings appear in canonical order: Price, Getting around, Safety, Schools, Local places, Environment, Homes, People, Living costs.
  - With `/api/v1/areas/*/places` routed to 500, only the Local places section shows "Couldn't load", and `home-facts` is still visible.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. `AreaFullPage` and `AreaFullCard` must render exactly as before; `area-full` e2e must not change.
- [ ] **Step 4:** Run `property-section.spec.ts`, `area-pages.spec.ts` and `area-card.spec.ts`. Expect PASS.
- [ ] **Step 5:** Commit `feat(web): area sections on the home page`.

### Task 7: Fill area360's area blocks that our sections lack

**Files:** decided by the audit in Step 1. The candidates, each to be confirmed missing first:
- `web/src/components/market-section.tsx`: box plot by type; £/sq ft beside £/m².
- `web/src/components/places-section.tsx`: the four amenity groups.
- `people-section.tsx`: population and density.
- `area-school-rows.tsx`: up to 16 schools.
- `civic-section.tsx` in Living costs: council tax A–H.

Test: `web/e2e/property-section.spec.ts`.

- [ ] **Step 1: Audit.** On the W5 1LR fixture home, check each area360 item below. Write the missing ones into the commit message.

  | Item | Test id |
  |---|---|
  | Median, £/m² and £/sq ft, sales in 12 months, middle-50% range | `market-summary` |
  | By-type table with P5/P25/P75/P95 | `market-by-type` |
  | 10-year trend by type | `market-trend` |
  | Box plot by type | `market-box` |
  | Recent sales list | `recent-sales` |
  | Private rents | `borough-rents` |
  | Stations with zone and lines | `stations-list` |
  | Crime per 1k by category with London average | `crime-categories` |
  | Road collisions within 500 m | `road-safety` |
  | Up to 16 schools with Ofsted | `schools-list` |
  | Parks with size | `parks-list` |
  | Amenities in 4 groups: supermarkets, pubs, cafés and restaurants, pharmacies | `amenities-list` |
  | Flood, rivers and sea plus surface water | `flood` |
  | Noise dB | `noise` |
  | Air | `air` |
  | Green & trees | `nature` |
  | Tenure and type | `homes-census` |
  | Broadband | `broadband` |
  | Population and density | `population` |
  | Census tables | `people-census` |
  | Council tax A–H | `council-tax` |
- [ ] **Step 2: Failing e2e test.** Every test id above is visible on the fixture home, and no section text reads "0" where data is missing.
- [ ] **Step 3:** Implement only the missing ones, inside their existing components (add the test id to an existing element where the block exists). Don't create new section components.
- [ ] **Step 4:** Run `property-section.spec.ts`, `market.spec.ts` and `places-section.spec.ts`. Expect PASS. Check both themes.
- [ ] **Step 5:** Commit `feat(web): area360 area blocks on the home page`. **Open PR 2.**

## PR 3: layers

### Task 8: `/areas/{id}/layers` and the Overview tiles

**Files:**
- Create: `api/area_api/layers.py`, `api/tests/test_layers.py`, `web/src/lib/area-layers.ts`, `web/tests/area-layers.test.ts`
- Modify: `api/area_api/app.py` (route), `web/src/components/home-page.tsx` (Overview row before Task 6's sections)

**Interfaces:**
- Produces: `area_layers(reader: evidence.EvidenceReader, area_id: str, cancel=None) -> dict` → `{"areaId": str, "layers": [Layer], "chips": [Chip], "withheld": [...]}`.
  - `Layer` has the same shape as the `standouts._tile` output so that `AreaTiles` renders it: `id, label, section, topic, available, value, display, standing (0–100, better end high), londonPercentile, extreme, detail, trend {direction: "up"|"down"|"flat"} | None, period`.
  - There is one Layer per `metric_definition` row with a value for the area. Its value is the newest period. The trend compares the newest period with the one 12 months earlier and is None when there is only one period.
  - Census metrics (`census-*`) have `standing=None` and `available=True`, rendered as descriptive, while `CLOSE_KNIT_CENSUS_RANKED` is off.
  - `Chip = {"id": "flood"|"air"|"broadband", "label": str, "band": str | None}`, read from the existing flood, health and home loaders.
- Route: `GET /api/v1/areas/{area_id}/layers`.
- Web: `useAreaLayers(geographyId, mode): AreaLayersResponse | null | "unknown"`. The Overview renders `AreaTiles standouts={{ tiles: layers }}` and a chip row. Each tile links to `/?selected={id}&layer={metric}`.

- [ ] **Step 1: Failing API tests.**
  - `test_one_layer_per_metric_with_value`.
  - `test_lower_is_better_flips_standing`: crime at the 90th percentile → standing 10.
  - `test_missing_value_is_unavailable_not_zero`: `available=False`, `display=None`.
  - `test_census_never_rated_with_flag_off`: `standing is None`.
  - `test_trend_needs_two_periods`.
  - `test_chips_present`.
- [ ] **Step 2: Failing web tests.**
  - `layerHref("E01001209", "noise") === "/?selected=E01001209&layer=noise"`.
  - The Overview tile for an unavailable layer reads "No data".
- [ ] **Step 3:** Run both. Expect FAIL.
- [ ] **Step 4:** Implement. Reuse `standouts._tile`, imported or factored to a shared helper, rather than duplicating it.
- [ ] **Step 5:** Run `tests.test_layers`, `tests.test_standouts` (if present) and `npx tsx --test tests/area-layers.test.ts`. Expect PASS. Commit `feat: area layers scorecard on the home page`.

### Task 9: The `road-collisions` metric and map layer

**Files:**
- Modify: `deploy/tools/etl_kids.py` (after `collision_casualty` loads, insert `metric_definition` `('road-collisions', 'lsoa', 'per-1000-residents-per-year', 'lower-is-better', …)` and `metric_value` per LSOA, following `etl_nature.py:782-805`).
- Modify: `web/src/lib/contracts.ts` (`METRIC_IDS`), `web/src/lib/map-topics.ts` (Safety topic, label "Road collisions").
- Test: `deploy/tests/test_kids.py` (or the existing ETL test for `etl_kids`), `web/tests/contracts.test.ts`, `web/e2e/layers-panel.spec.ts`.

**Interfaces:**
- Produces: metric id `road-collisions`.
  - value = pedestrians and cyclists hurt (`road_user IN ('pedestrian','cyclist')`, every severity) whose point is in the LSOA, over the 5 STATS19 years ÷ 5 ÷ LSOA residents × 1000.
  - The residents figure is the one the `crime` metric divides by.
  - `london_percentile` is over all London LSOAs; `sample_count` = casualties.
  - No migration: `metric_definition` rows are seeded by ETL in this codebase. That deviates from the spec's wording and is intended.

- [ ] **Step 1: Failing tests.**
  - ETL on a 3-LSOA fixture gives the expected rates, with an LSOA with 0 casualties → value 0.0 (an observed zero, not missing), and percentiles in the expected order.
  - `METRIC_IDS` includes `road-collisions`.
  - In e2e, the Safety topic lists "Road collisions".
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. No date, time or sex columns are read.
- [ ] **Step 4:** Run the ETL test, `npx tsx --test tests/contracts.test.ts` and `npx playwright test e2e/layers-panel.spec.ts`. Expect PASS.
- [ ] **Step 5:** Add the ETL run to `RELEASE-CHECKLIST.md` (the section where the `etl_kids` run is listed). Commit `feat: road-collisions area metric and layer`. **Open PR 3.**

## PR 4: tools

### Task 10: Investor calculator

**Files:**
- Create: `web/src/lib/investor.ts`, `web/tests/investor.test.ts`, `web/src/components/investor-calculator.tsx`
- Modify: `web/src/components/home-page.tsx` (Tools block, folded, after Living costs), plus the existing cost worksheet module (find it via `HomeTools` in `property-profile.tsx`). Reuse its stamp duty and costs.

**Interfaces:**
- Produces, as pure functions:
  - `buyToLet({price, deposit, rate, termYears, rentMonthly, costsMonthly, voidWeeks}) -> {grossYield, netYield, cashFlowMonthly, cashOnCash}`.
  - `hmo({..., rooms, rentPerRoomMonthly, billsMonthly})`, same outputs.
  - `brrr({price, refurb, valueAfter, refinanceLtv, rate, rentMonthly}) -> {moneyLeftIn, cashFlowMonthly, roi}`.
  - `flip({price, refurb, salePrice, months, financeRate}) -> {profit, roi}`.
  - All money is in pounds as numbers. Stamp duty comes from the existing worksheet's function.
- The rent default is the borough rent for the bedroom count from `/rents`, editable. Nothing is stored or sent (the same note as the asking-price check).

- [ ] **Step 1: Failing unit tests.** Hand-computed cases:
  - `buyToLet({price:400000, deposit:100000, rate:0.05, termYears:25, rentMonthly:2000, costsMonthly:200, voidWeeks:2})` gives `grossYield` 6.0% (rounded to 0.1). The net and cash-flow figures are stated in the test from an interest-only calculation: `300000 × 0.05 / 12 = 1250`.
  - One case each for `hmo`, `brrr` and `flip`.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement the functions, then the folded UI with four tabs.
- [ ] **Step 4:** Run `npx tsx --test tests/investor.test.ts` and `npx playwright test e2e/tools.spec.ts`. Expect PASS.
- [ ] **Step 5:** Commit `feat(web): investor calculator on the home page`. **Open PR 4.**

## PR 5: flagged home features

### Task 11: Valuation behind `CLOSE_KNIT_PER_HOME_VALUATION`

**Files:**
- Create: `api/area_api/valuation.py`, `api/tests/test_valuation.py`
- Modify: `api/area_api/property_profile.py` (`profile["valuation"]`), `api/area_api/tools.py` / `evidence.py` (MCP `get_home_prices` adds `valuation` under the same flag), `web/src/components/home-page.tsx` (block 2)

**Interfaces:**
- Produces: `estimate(home: Mapping, area_type_market: Mapping, borough_type_index: Mapping) -> {"value": int, "low": int, "high": int, "method": "floor-area"|"indexed-sale", "vsLocalMedianPerSqm": float|None, "vsLocalTypeMedian": float}` or None.
  - **floor-area:** used when `epc_per_home()` is on and a floor area exists. value = the local same-type median £/m² × floor area. low and high use P25 and P75 £/m².
  - **indexed-sale:** otherwise, the last sale × (borough same-type index now ÷ index at the sale month). The range is ±the middle-half spread of local same-type sales relative to their median.
  - Values are rounded to £5,000. None when neither method has inputs.
- `profile["valuation"]` is None and `"valuation"` is in `withheld` unless the flag is on. A hidden home never reaches this code.

- Also produces, **unflagged**: `annualised_change(last_sale: Mapping, borough_type_index: Mapping) -> {"home": float, "borough": float} | None`, the yearly % change since the last sale for the home and for the borough's same type. It appears in `profile["sales"]` summary as `changeSinceLastSale`, and `SalesCard` shows "+x% a year since {year} · borough {type} +y%" (spec block 4).

- [ ] **Step 1: Failing tests.**
  - `annualised_change` on fixed inputs (exact floats to 0.1), and None with no sale.
  - Both methods on fixed inputs, with exact expected integers in the test.
  - The £5k rounding.
  - None without inputs.
  - Flag off → `profile["valuation"] is None`.
  - Flag on → present.
  - The MCP tool with the flag off has no `valuation` key value.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. The web block 2 shows the estimate card only when `!isWithheld("valuation")`, worded "An indicative model estimate, not a valuation".
- [ ] **Step 4:** Run `tests.test_valuation` and `tests.test_property_profile`. Expect PASS.
- [ ] **Step 5:** Update FLAGS.md (blocker unchanged, status "in code"). Commit `feat: per-home valuation behind a flag`.

### Task 12: EPC-addressed homes, council tax band, LAEI: wiring only

**Files:**
- Modify: `api/area_api/property_profile.py` (`postcode_homes`: when `epc_addresses()` is on, append the postcode's EPC-only homes, from the table that holds matched EPC certificates, carrying `uprn`), `api/area_api/civic.py` (`councilTaxBand: None` per home, plus `withheld`), `api/area_api/health.py` (LAEI grid read only when `laei_air()`)
- Test: `api/tests/test_property_profile.py`, `api/tests/test_civic.py` (create if absent)

- [ ] **Step 1: Failing tests.**
  - Flag off → postcode homes are unchanged.
  - Flag on → an EPC-only fixture home is listed, with `lastSale: None`.
  - `councilTaxBand` is always None, with `"councilTaxBand"` in `withheld` while the flag is off. Turning the flag on with no data still gives None.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. If the matched-EPC table has no address or UPRN column, stop and report it (this needs an ETL change outside this plan) instead of inventing a source.
- [ ] **Step 4:** Run. Expect PASS. Then run `./gate.sh` for the whole branch.
- [ ] **Step 5:** Update FLAGS.md and commit `feat: EPC addresses, council tax band and LAEI behind flags`. **Open PR 5.**
