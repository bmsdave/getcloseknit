# Feature flags and their blockers

Owner rule (2026-10-18): a rule that withholds data or a feature becomes a **flag**, not a cut.
Build the full feature behind the flag, default off, and list here what must happen before it can be switched on.
Every blocker will be resolved at some point; nothing should need rebuilding then.

How flags work:
- Server env vars `CLOSE_KNIT_*`, read in one module, `api/area_api/feature_flags.py`. `epc_policy.per_home_epc()` delegates to it. `ADDRESS_MATCH` and `HOME_VALUE` came with the browser extension (PR #99); `LISTING_HISTORY` was removed in extension 0.4 (we never store portal listings; migration 070 drops its table).
- `"1"` means on and `"0"` means off. Unset, a flag follows the site: **on while `CLOSE_KNIT_ACCESS=private`** (the pre-release preview, owner decision 2026-10-19), off once the site is public or when `CLOSE_KNIT_ACCESS` is unset (tests, local runs). Production's compose overlay defaults the API to `public`, the same as Caddy.
- With a flag off, the withheld data never leaves the API. Responses keep their keys with null values and clients render a fallback, so switching a flag is config, not code.
- **Before going public:** every flag whose blocker is not cleared must be off — switching `CLOSE_KNIT_ACCESS` to `public` does that for unset flags; remove any `=1` left in `deploy/.env` for them. Never turn a flag on in a public prod without the owner's explicit decision, after its blocker is cleared.

## Launch set (owner decision 2026-10-27)

The public launch ships with moderate risk: obvious public data is shown even where a licence is not yet confirmed; real legal or personal-data risk stays off. At the switch to `CLOSE_KNIT_ACCESS=public`, set exactly these to `1` in `deploy/.env` (everything else stays unset, so off):

| Flag | Why on | Risk accepted |
|---|---|---|
| `CLOSE_KNIT_ENGLAND` | All of England is loaded on prod (296 LADs, 33,755 LSOAs, checked 2026-10-27) | Data quality outside London |
| `CLOSE_KNIT_MCP_DATA` | The owner's employer approved the role (2026-10-27) | — |
| `CLOSE_KNIT_AIR_QUALITY` | Public GLA data | GLA has not confirmed OGL; off on request |
| `CLOSE_KNIT_SCHOOL_LINKS_GSG`, `CLOSE_KNIT_SCHOOL_LINKS_LOCRATING` | Plain links, none of their data | Sites' terms have no linking clause |

Already shown without a flag: admission distances for all 33 councils (`api/area_api/schools.py`, owner decision 2026-10-15; credited and linked, hidden per council on a takedown).

Released for when they are built (each still needs its board and build; the owner lifted the restriction, so once built they ship on): `PEOPLE_STANDOUTS`, `BLENDED_SCHOOL_SCORE`, `AGENT_RATINGS`, `ADMISSION_ODDS`, `COMMUNITY_OPEN_DAYS`, `PLANNING_PINS` (109,444 applications already on prod; GLA OGL unconfirmed, off on request).

Stays off at launch (real legal or personal-data risk): EPC per home, per-home £/m², EPC addresses, council tax band, unlicensed sources, Geograph images, portal listings, TfL branding, plot outline, ownership, address match, snakes, road-casualty detail, agency officers, per-home valuation and home value, social-housing pins, census ranked, people criteria, similar demographics, display ads. Extension flags don't matter while the extension is unlisted.

Status: **in code**: the flag exists · **planned**: the restriction is in force but the flag isn't built yet; build it with the next feature that touches it.

## Licence

| Flag | Default | Status | What it unlocks | Blocker |
|---|---|---|---|---|
| `CLOSE_KNIT_EPC_PER_HOME` | off | in code (`api/area_api/feature_flags.py`); `epc_policy.py` delegates | Per-home EPC facts: floor area, current/potential rating, certificate date, type, built form, age band, rooms, floor level; property type fallback for area prices (when no standard sale has a priced type); MCP `get_home_prices` `facts` (null and in `withheld` while off) | Counsel confirms EPC open-data terms allow per-address republication (DATA-LICENCES.md, RELEASE-CHECKLIST "Going public") |
| `CLOSE_KNIT_PER_HOME_PRICE_PER_SQM` | off | in code (`api/area_api/feature_flags.py`); needs `EPC_PER_HOME` | £/m² per home and per sale (property tile `sppm`, sale pin `ppm`) instead of medians over 3+ homes (migration 044) | Same as `EPC_PER_HOME` |
| `CLOSE_KNIT_EPC_ADDRESSES` | off | in code (`api/area_api/feature_flags.py`, `property_profile.py`); data: `property_epc_home` (migration 089, `deploy/tools/etl_epc.py extract` + `load`), not loaded on prod yet | Homes with no recorded sale, addressed from their EPC: a postcode list row (`addressId` and `lastSale` null, `addressSource: "epc"`), a `/property/{uprn}` page, a place among a recorded home's other homes and in the sitemap. Off, nothing reads the table and payloads differ only in `withheld`; the web demo honours the same env var | Royal Mail/OS rights in EPC address fields: an AddressBase/PAF licence, or counsel's confirmation |
| `CLOSE_KNIT_EXTENSION_MODES` | inline everywhere, SpareRoom side-panel | in code (`/api/v1/extension-config`) | Browser extension mode per portal: `inline` / `side-panel` / `off` (JSON) | Kill switch if a portal objects (docs/superpowers/specs/2026-10-18-extension-legal-strategy.md) |
| `CLOSE_KNIT_EXTENSION_FEATURES` | `resultsLine` and `mapPopup` on | in code (`/api/v1/extension-config`) | The line under search results and inside map pin cards (JSON) | Portal terms review; switch off on request |
| `CLOSE_KNIT_ADDRESS_MATCH` | off | in code | Matching a portal listing to a full address | Privacy/legal review (LIA) |
| `CLOSE_KNIT_PLOT_OUTLINE` | off | planned | INSPIRE plot outline and plot size per home | HMLR confirms INSPIRE's "not to identify ownership" condition allows it |
| `CLOSE_KNIT_PLANNING_PINS` | off | planned | Individual planning applications on the map, not only area counts | GLA confirms the Planning Datahub is OGL |
| `CLOSE_KNIT_COUNCIL_TAX_BAND` | off | in code (`api/area_api/feature_flags.py`); wired: `facts.councilTaxBand` and civic `councilTaxBand` are null with `withheld`; no source loaded, so on or off it stays null | Council tax band per home (home facts card, Living costs); MCP `get_home_prices` `facts.councilTaxBand` (null and in `withheld` while off) | An open VOA bulk licence (scraping the GOV.UK lookup isn't allowed) |
| `CLOSE_KNIT_AIR_QUALITY` | off in code; **on in production by owner decision 2026-10-18** | in code (`api/area_api/feature_flags.py`: `air_quality()`, `AIR_METRICS`, `hidden_metrics()`; clients read it as `laeiAir` in `withheld`) | GLA LAEI air pollution: the health route's air figures (`/areas/{id}/health` → `air: null`, `airEnabled: false`, LAEI source and caveat left out, `laeiAir` in `withheld`), the Health "Clean air" rating and its NO₂ / PM2.5 row, the standouts Air tile and its tags, the Overview air chip and `air-no2` tile on `/areas/{id}/layers`, the `air-no2` map layer (metrics list, metric, value packs, `range:air-no2` criteria) and the MCP home-search air text; off, the site leaves the row, rating, tile and chip out. Not gated: migration 069's good-value score still reads `air-no2` in SQL; outside London the health route's air figures are Defra's 1 km PCM map (OGL v3, `src-defra-pcm-*`, `gridMetres: 1000`) and show with the flag off (the mixed `air-no2` layer stays gated as a whole) | GLA has not confirmed OGL v3 for LAEI 2022 (airqualitylondon@london.gov.uk); the owner switched it on in production on 2026-10-18 |
| `CLOSE_KNIT_LA_ADMISSIONS_ALL` | off | planned (today the allow-list `LA_ADMISSIONS_APPROVED` = lambeth, harrow) | Admission distances for all 33 councils | Owner decision 2026-10-15 says show all councils and hide one on a takedown. That conflicts with DATA-LICENCES.md:44 and the code; owner to confirm, then turn on |
| `CLOSE_KNIT_UNLICENSED_SOURCES` | off | planned | GP Patient Survey, School Streets/LTN, GiGL SINCs | Each source needs a reuse licence |
| `CLOSE_KNIT_GEOGRAPH_IMAGES` | off | planned | Geograph photos shown inline (today: links only) | Geograph's permission, plus a fetch route that isn't 403'd from the VPS |
| `CLOSE_KNIT_PORTAL_LISTINGS` | off | planned | Storing or showing portal listings and photos, archived listings | Portal and agent terms: a data partnership |
| `CLOSE_KNIT_TFL_BRANDING` | off | planned | TfL roundel and line colours | TfL trademark permission |
| `CLOSE_KNIT_OWNERSHIP` | off | in code (`api/area_api/feature_flags.py`: `ownership()`) | The area card Company owners block (`/api/v1/areas/{id}/ownership` returns `available: false` while off) and the `ownership-*` map layers (kept out of `REAL_PUBLISHED_LAYERS`) | HM Land Registry CCOD/OCOD need the owner's free Use land and property data account; the owner confirms the licence allows area aggregates, then loads them (REAL-DATA.md) |

## Privacy and legal

| Flag | Default | Status | What it unlocks | Blocker |
|---|---|---|---|---|
| `CLOSE_KNIT_ACCESS` | `private` (dev), `public` (prod overlay) | in code | Public, indexable site | RELEASE-CHECKLIST "Going public" items, incl. `CLOSE_KNIT_ICO_NUMBER` |
| `CLOSE_KNIT_MCP_ACCESS` | `public` | in code (`feature_flags.public_call()`, used by `mcp_server._call_with_codes` and its tool descriptions) | `site` lets `/mcp` tool calls follow `CLOSE_KNIT_ACCESS` (preview flags on). Default: `/mcp` is open without the preview login, so its calls read every flag as off while the site is private, even an explicit `=1` (owner decision 2026-10-22: `AIR_QUALITY` stays off on `/mcp` until the GLA's OK); once the site is public, `=1` applies to `/mcp` too | Local testing only. Never `site` on a host whose `/mcp` is reachable by strangers, nor once listed in ChatGPT/Claude directories (docs/assistants-2026-10/chatgpt-app.md) |
| `CLOSE_KNIT_MCP_DATA` | off in code; **on in production by owner decision 2026-10-27** | in code (`feature_flags.mcp_data()`, `mcp_server._call_with_codes`) | Data from the open `/mcp` tools. Off, every tool except `send_feedback` answers a "coming soon" envelope (`tool-coming-soon.v1`, `value: null`) without reading the database; `tools/list`, instructions and the prompt stay so directories can still index the server. Only `=1` turns it on, also in the private preview (the flag is about strangers) | Owner decision 2026-10-26: no data to strangers until launch (Meta disclosure, going-public checklist) Meta approved 2026-10-27; the owner chose to open the data before the ICO registration and the signed LIA (RELEASE-CHECKLIST, *Privacy and legal*), which follow. Flags with uncleared blockers stay off on `/mcp` (`public_call`) |
| `CLOSE_KNIT_MCP_REQUEST_NOTES` | off | in code (`feature_flags.mcp_request_notes()`, `mcp_server._call_with_codes`, `call_notes.py`) | Call notes from agents on `/mcp`: every tool except `send_feedback` takes `intent` (the agent's own 1-3 sentence summary of what the user wants from the call, never their words) and `rate_previous` (its 1-5 rating of an earlier answer by `callId`, with what was good, bad and the fix it wants); answers carry `callId`, `rate_answer` rates the last one, and the instructions ask for both. Stored in `mcp_call_note` (migration 130) for 90 days, contact details and full postcodes removed; read on the Grafana Agents dashboard or with `python -m area_api.call_notes list`. Off: no extra parameters, no `callId`, nothing stored. Only `=1` turns it on, also in the private preview (text from strangers' agents) | Owner decision 2026-10-27: on in prod with the /privacy paragraph (`privacy-agent-notes`). Agent summary only, not the verbatim prompt (OpenAI and Anthropic directory rules on chat data) |
| `CLOSE_KNIT_HOME_VALUE` | off | in code (needs `ADDRESS_MATCH`) | Value range for a matched listing | See `PER_HOME_VALUATION` |
| `CLOSE_KNIT_SNAKES` | off | planned | Named homes with the biggest gains and losses | LIA review (reputation of identifiable owners) |
| `CLOSE_KNIT_ROAD_CASUALTY_DETAIL` | off | planned | Date, time and sex of road casualties | Re-identification review (LIA) |
| `CLOSE_KNIT_AGENCY_OFFICERS` | off | planned | Companies House officers/PSC for estate agents | LIA review |
| `CLOSE_KNIT_SCHOOL_LINKS_GSG` | off | in code (`api/area_api/feature_flags.py`: `school_links_gsg()`, `school_links.py`) | The Good Schools Guide tile under a school's Visit & links (`links.goodSchoolsGuide`, a counted `/go/school-gsg` name search; "full review is paid"). Off, `href` is null and the page draws no tile | Owner decision: [goodschoolsguide.co.uk/terms](https://www.goodschoolsguide.co.uk/terms) and [/website-access-terms](https://www.goodschoolsguide.co.uk/website-access-terms) have no linking clause; the target is paywalled |
| `CLOSE_KNIT_SCHOOL_LINKS_LOCRATING` | off | in code (`api/area_api/feature_flags.py`: `school_links_locrating()`, `school_links.py`) | The Locrating tile under a school's Visit & links (`links.locrating`, a counted `/go/school-locrating` to its URN page; never their ratings or catchments). Off, `href` is null and the page draws no tile | Owner decision: [locrating.com/terms_of_use.aspx](https://www.locrating.com/terms_of_use.aspx) has no hyperlink clause (bans framing, scraping, commercial reuse); one email to Locrating settles it before going public |
| `CLOSE_KNIT_COMMUNITY_OPEN_DAYS` | off | planned | Visitor-reported open-day dates under a school's Admissions & open days button | Moderation queue, spam limits and an owner decision (board "School page · Visit & links", 2026-10-20) |
| `CLOSE_KNIT_PEOPLE_CRITERIA` | off | planned | Custom criteria about people (religion, ethnicity, language, community), counting places of worship | Legal: UK GDPR Art. 9 special-category data |

## Product choices

| Flag | Default | Status | What it unlocks | Blocker |
|---|---|---|---|---|
| `CLOSE_KNIT_PER_HOME_VALUATION` | off | in code (`api/area_api/feature_flags.py`, `valuation.py`) | Estimated price of a home with a range, the home's indexed last-sale £/m² vs the local median (area360 parity): floor area × local same-type £/m² with EPC per home, else the last sale indexed by the borough same-type trend; `profile.valuation` and MCP `get_home_prices` `valuation` (null and withheld while off); web block 2 "An indicative model estimate, not a valuation" | Owner decision (2026-10-11 rejected it) + legal (AVM, UK GDPR, owner objections) + a validated model |
| `CLOSE_KNIT_ENGLAND` | off (on while `CLOSE_KNIT_ACCESS=private`) | in code (`api/area_api/feature_flags.py`: `england()`; `api/area_api/coverage.py`; ETL list `area_analytics/coverage.py`, `deploy/tools/area_coverage.py`; migration 103; data row `scope_grant` (`CLOSE_KNIT_ENGLAND` → `uk:nation:E92000001`, base `uk:region:E12000007`; migration 123, read from step 4 of [docs/architecture/global-geography.md](docs/architecture/global-geography.md)); map: `api/area_api/map_chunks.py`, `api/area_api/map_tiles.py`, `/api/v1/map/coverage`, `web/src/lib/map-coverage.ts`, layer list's "London only" from the metric catalog's `coverage` (`metric_coverage`, migration 126; web `londonOnlyLayers`)) | Coverage is all of England: any English LAD as carrier `lad` (named `borough` before step R1; ids `uk:lad:<code>` and pages `/area/lad/<code>` since step R2, migration 129, the old `uk:borough:` ids and `/area/borough/` URLs still answering), the England box instead of London's, reason `outside-coverage` instead of `outside-london`, ranks and medians within the area's region (`rankScope` `{code, name}`, copy "of <region>"; London = E12000007, so London numbers do not change). Off: exactly the London behaviour. Words (`web/src/lib/coverage-words.ts`): on, the welcome card, site title, share texts and match words name no city ("What homes really sold for, and which areas fit your budget", ranks "of its region") and promise no commute; off, London's words. Schools (migration 110): each school ranks within its region (`school.region_code`); off, the API lists London's schools only (`schools.scoped`). Postcode sector pages, sector search and the sectors sitemap: off, London's sectors only (`zones_sector.scoped`). Map legend: off, no "England" rank scope (`servedScopes`, web/src/lib/legend-range.ts). London-only sources (TfL, ULEZ/CC, LAEI air, GLA trees/heat/conservation/Datahub/LDD/Opportunity Areas, council admissions, HMO registers, Inside Airbnb, future transport) and per-home data stay London-only either way: null outside London, layer list and legend say "London only"; area tiles and rows (Cycling, Nature, Air), recent sales, homes near a school and a postcode's homes say "London only" too, from the payload's `coverage` reason (`api/area_api/coverage.py` `reason`, metric_coverage or the source's regions; web `lib/coverage-reason.ts`), never 0 km, "No data here" or "none" (outside London no fill; with none of its areas in view a map message "<Layer>: London only · Show London", DESIGN.md §6). Map: zooms out to all of England and loads the pieces in view, London like any region (England's LADs below z6.5, every region as MSOA medians to z9, as LSOAs to z9.5, then one piece per LAD with London's boroughs as one; all painted in one frame); percentile colours are the 9 quantiles of the areas in view (In view, owner decision 24.10), with fewer than 20 valued areas in view the ranks of their one region or England's (`countryPercentile`, stored per release by `rebuild_metric_ranks`, migration 124, and withheld (null) with the flag off; cards and "of <region>" copy stay regional); off, unchunked packs and boxes are London only, the area tiles hold London's areas alone (a release of their own, migration 125; their own static archives, migration 127, `deploy/tools/area_pmtiles.py`) and the map is the London map | Owner order 2026-10-22: cover all of England, white spots hidden. Before public: England data loaded on prod (bundles in ~/data/england-2026-10/bundles), screenshot audit outside London, ICO/LIA re-check for the larger area set (docs/england-2026-10/plan.md) |
| `CLOSE_KNIT_CENSUS_RANKED` | off | in code (`api/area_api/feature_flags.py`; read by `/areas/{id}/layers`) | Census layers as rank, filter, weight or custom criterion (off: the layers scorecard gives Census no standing or London position) | Owner decision + legal (special-category data) |
| `CLOSE_KNIT_PEOPLE_STANDOUTS` | off | planned | People, income and social housing as standout tiles and tags | Owner decision |
| `CLOSE_KNIT_SIMILAR_DEMOGRAPHICS` | off | planned | "Similar areas" comparing demographic composition | Owner decision + legal |
| `CLOSE_KNIT_ADMISSION_ODDS` | off | planned | Admission chance and "catchment" wording | A sound method from council offer data |
| `CLOSE_KNIT_BLENDED_SCHOOL_SCORE` | off | planned | One score mixing Ofsted report-card and legacy grades | Owner decision (methodology) |
| `CLOSE_KNIT_AGENT_RATINGS` | off | planned | Our own ratings of estate agents | Owner decision (neutrality) |
| `CLOSE_KNIT_DISPLAY_ADS` | off | planned | Contextual display ads on global country/city reference pages only; never on the map, area, home or school pages, Find my area, the extension, MCP answers or rankings; no property, mortgage or developer advertisers ([docs/global-2026-10/strategy.md](docs/global-2026-10/strategy.md)) | Global pages reach 100k page views a month; consent check (UK GDPR/PECR) for the ad network; owner's decision to switch on |
| `CLOSE_KNIT_SOCIAL_HOUSING_PINS` | off | planned | Individual social-housing locations | Owner decision + LIA (occupants) |
| `MATCH_CHIP_COLLISIONS` (web, `CHIP_FLAGS` in `web/src/lib/match-ranges.ts`) | `false` | in code | The "Fewer road collisions" chip in My match (v4 Task 21d lists it in the Kids?/Drive? orders) | No per-area collision value: collisions are a Show overlay (points), so the match API has no `road-collisions` range rows and the chip would score nothing. Data: publish a per-LSOA collision rate (STATS19 per 1,000 residents) in a release, then set it `true` |
| `AREA_HOME_COST_ESTIMATE` (web, `PANEL_FLAGS` in `web/src/components/evidence-panel.tsx`) | `false` | in code | "What a home costs here ≈ £…" in the map's area panel and sheet: the area's £/m² × a chosen home size, with the size picker and the "wider-area price" note (v4 Task 12 dropped it from the UI; the area view shows £/m², the area band and the budget fit instead) | Owner decision 2026-10-18 (no per-home valuation: a sum for "a home here" reads as one home's price). Owner unblocks by reversing that decision; then set it `true` |
| `AREA_MARKS` (web, `MATCH_FLAGS` in `web/src/components/match/area-marks.tsx`) | `false` | in code | Like it · Not for me · Note in the area view opened from My match (they were on the old in-list card that v4.4 replaced with the one area view; the marks still feed the search: liked areas on the map, "Not for me" out of the ranking) | Owner taste call: the v4 boards (CUJ06, CUJ13) draw the area view without marks. Owner unblocks by asking for them back; then set it `true` |
| `NEXT_PUBLIC_MATCH_PANEL_EXTRAS` (web build env, read in `web/src/lib/match-extras.ts`; a viewer's `localStorage["close-knit.match-extras"]` = `on`/`off` overrides) | off | in code (v4.6) | My match's older blocks under the ten: Show on the map (Prices vs budget · Neighbouring areas · Schools · Getting around), Tailor: kids, gym, commute, Schools you would consider, Compare places, Saved areas & costs (shortlists and the decision brief), Clear, Your data (usage consent, erase the local profile), and the tray's Needs · Shortlist · Compare · Brief steps. Share search, Compare and the portals stay | Owner taste call: the v4 boards (CUJ01 step 8, V4-21c) draw the ten, Compare · Share search and the portals only (check round 3). Owner unblocks by asking for them back; then build with `NEXT_PUBLIC_MATCH_PANEL_EXTRAS=on` |

## Kill switches

Off by default means the feature is on; the switch turns it off.

| Flag | Default | Status | What it switches off | Blocker / who switches it |
|---|---|---|---|---|
| `CLOSE_KNIT_PORTAL_DRAW_OFF` (API env, comma list: `rightmove`, `zoopla`) | empty: drawn-area and borough portal links on | in code (`api/area_api/portal_zones.py`) | Drawn-area and borough portal links for the named portal (falls back to postcode districts) | The portals' draw-a-search and region URLs are unofficial (v4 Task 9, D1). The weekly `python -m area_api.portal_link_check --record` already sends a failed portal and kind to the postcode-district fallback; this is the manual switch for a portal that breaks between checks or asks us to stop. Owner or on-call sets it in the API env and restarts the api container |

## Release overrides (ETL environment, one run)

Not product flags: they let one data run past a guard that refused it, after someone checked the numbers. Set them
only for that run (RELEASE-CHECKLIST.md "Monthly Price Paid refresh").

| Variable | Default | What it overrides | Who sets it |
|---|---|---|---|
| `CLOSE_KNIT_COVERAGE_DROP_THRESHOLD_PERCENT` | 2 | The coverage guard in `activate_product_release()` (migration 134): a release whose key layers lose more than this share of any region's areas against the active release is refused. Python callers pass it through `deploy/tools/release_guard.py`; psql takes `PGOPTIONS='-c close_knit.coverage_drop_threshold_percent=<n>'` | Release owner, for a drop that is checked and accepted (the refusal names the value to use) |
| `CLOSE_KNIT_ZERO_FLOOR_BLOCK_FAIL_THRESHOLD` | 5 | `etl_sales.py release` fails a sales release with more blocks of 20+ sales and no EPC floor area | Release owner, for a known, accepted count |
| `CLOSE_KNIT_STAGE_ONLY` | unset | Set by `etl.py` for every step of a run (with `PGOPTIONS=-c close_knit.stage_only=on`): loaders stage, nothing activates until the run's end | `etl.py` only; never set it by hand on a serving database except to stage |

## Not flags: safeguards that stay on

These protect people and are required by law or our LIA. They are not restrictions on product scope.
- "Hide my home" objections, hashed objection store, 30-day purge.
- Per-home payload whitelist, with no occupant fields.
- Personalised responses never cached; analytics consent.
- Feedback holds no personal details.
- Rate limits, no bulk address export.
- Missing data shown as "unknown", never 0.
- Attribution and licence terms of the data we do use (ODbL, CC BY-SA, Google Places, robots.txt).

## Stale or conflicting rules in docs

Docs may hold bans the owner has since lifted. **This file and the owner's latest decision win over older docs.**
- Deprivation "never ranked" (v3-spec): lifted 2026-10-17.
- Income and social renting "never ranked" (v3-spec, `NEVER_RANKED_METRIC_IDS`): lifted 2026-10-18, on an unmerged branch.
- TfL commute "blocked by licence" (ROADMAP-research-driven-features.md:51): commute is live.
- Admission distances "never shown" (DATA-LICENCES.md:44) vs owner decision 2026-10-15 (docs/area-card-2026-10/decisions.md:4).

When you add, lift or rename a restriction, update this file in the same change.
