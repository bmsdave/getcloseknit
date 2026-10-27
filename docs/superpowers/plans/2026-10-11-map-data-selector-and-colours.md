# Map data selector and colours: task list

Agreed with the user on 2026-10-11. One place picks the data (what colours the map); one place picks the style
(Map settings: theme + map colours). Read `DESIGN.md` before any UI change. Tokens only, Day and Night.
No olive green. Each task: smallest clear change, focused tests first, one commit per task.

## A. Colours

### 1. Palettes are real colours on every layer
Bug: "Standard (traffic light)" (`id: "current"` in `web/src/lib/palettes.ts`) means "keep each layer's own
colours", and price's own ramp is the blue `PRICE_RAMP`, so price never turns traffic-light.
- Every palette is a real ramp applied to every layer (price included). Remove the "keep own colours" special case.
- Each metric declares a polarity: `good-high`, `good-low` or `neutral` (on the metric definition or a table in
  `palettes.ts`). Crime good-low; deprivation good-high (decile 10 least deprived); station walk good-low;
  food hygiene good-high. Price, income, social rent, custom criteria and all future census layers: neutral.
- Traffic light: green (good) → amber → red (bad) on polar layers; on neutral layers a neutral sequential ramp
  (e.g. the current yarn/ocean ramp). Colour-blind safe: the existing red-blue ramp oriented by polarity; neutral
  layers get a sequential colour-blind-safe ramp (viridis-like). Viridis/Magma/Yarn/Ocean/Ember: low → high on all.
- The Change scale keeps `DIVERGING_RAMP` whatever the palette; the legend says so.
- Remove per-layer colour pills from the layer list (`layer-picker.tsx`); swatches in Map colours
  (`appearance-menu.tsx`) show what the palette really paints. The dock button swatch follows the palette.
- Tests: unit tests in palettes; `colour-contrast`; e2e `price-layer`, `map-legend`, `layers-panel`.

### 2. Remember 2D/3D and map colours after reload
- Map colours already use localStorage (`choosePalette`, `PALETTE_KEY` in `use-explorer-controller.ts`):
  verify with an e2e that a palette survives reload; fix if not.
- 2D/3D (pitch) is not persisted: store the chosen view in localStorage; a link's own pitch still wins; phones
  keep opening flat unless the user chose 3D. Wrap storage in try/catch like existing code. e2e for reload.

### 3. Colour square (A vs B lenses) shows the gradient it promises
Root cause: `api/area_api/custom_criteria.py` builds an 11×11 square (`BIVARIATE_STEPS`) and picks a cell from
each count's London rank; low discrete counts (0,1,2…) jump from grey to ~60% colour, so only ~16 of 121 cells
are used and the map reads as grey/red/blue/purple.
- Make the square 4×4 from the threshold levels the legend already prints (median, upper quartile, top tenth):
  cell = level(A) × 4 + level(B), the same as the web fallback `bivariateCell` in `web/src/lib/custom-criteria.ts`.
- Legend and map use the same cells; API and web agree (keep the existing API↔web parity tests).
- Failing test first (low-count pair must use evenly spaced shades 0, ⅓, ⅔, 1).

### 4. Zoomed in, only buildings are coloured and the ground is grey
User report with a lens (Bakeries vs betting shops) at street zoom in Mayfair/Soho: area colour shows on
buildings only, the rest of the area is grey. Find the root cause first (area-fill opacity by zoom, the
translucent fill for colour squares,
second report: Coworking lens near Charing Cross, buildings painted one flat bright blue everywhere whatever the area's
value (12 coworking spaces) while the ground stays grey; check what colours the building layer and whether it reads the area value; house-zoom building layers in `web/src/components/area-map.tsx` and
`web/src/lib/map-*-layers.ts`). Expected: at street zoom the area is still readably coloured (the map stays real:
streets and labels visible), consistent for every layer. Regression test.

### 4b. Fewer roads over the colours
User report (2026-10-11, zoom ~13, Coworking lens): every street is drawn as a solid white line, chopping the
choropleth into confetti. Keep motorways/trunk/primary (and maybe secondary) roads solid; draw minor and
residential streets much more transparent (or thinner) while a data layer is shown, fuller again only at
street zoom. Second report at city zoom (~11, all London): even there a dense web of white roads (A/B roads
and local streets) cuts every area; at that zoom show only motorways/trunk roads, thin and translucent. Basemap stays real (OpenFreeMap restyled per theme); check Day and Night. Visual check by screenshot.

### 4c. Selected area always shows its key numbers
User report: with a lens/custom layer shown (e.g. Gyms and sports centres) and an area selected (Church End ·
NW10), the side panel shows only the lens detail (`web/src/components/match/criterion-focus.tsx` and its
callers). With price/crime/deprivation layers it shows the area's top metrics. Expected: whatever layer is
shown, the selected area's card always shows its key numbers (price per m², crime, deprivation, income,
station walk, …) plus the shown layer's value. Reuse the existing area summary component, don't duplicate.
Same panel: the "Fewest" list repeats "Barking East · IG11" / "Barking Central · IG11" (different LSOAs with
one name, all tied at 0). Make ties honest: e.g. "312 areas have none" instead of five indistinguishable rows,
and disambiguate repeated names.

### 4d. Price layers in traffic light, and whole-home price
User (2026-10-11, after PR #28 merged): Price per m² and "Typical price today" use traffic light too:
polarity good-low (cheap = green, dear = red); colour-blind safe follows the same polarity. Also show the price
of a whole home, not only £/m²: check whether PR #28's "Typical price today" layer is already a whole-home area
price by property type; if so name it "Typical home price" with views All homes / Flats / Terraced / Semi /
Detached; if not, add one from the area price bands (same rules: at least 5 sales, area range, never one
home's value). Both sit in the Cost group (task 5).

## B. One data selector

### 5. Data catalogue (single source of truth)
New `web/src/lib/map-topics.ts`: groups in decision order, each item = published metric or custom preset, with
an optional set of views. Groups:
1. Cost: Price per m² (views: Actual · Rank in London · Change; Value now / Sold price at house zoom)
2. Safety: Crime (views: All · Rank in London · Choose types)
3. Getting around: Station walk · Cycling · EV charging
4. Homes & area: Income · Deprivation · Social rent (Tenure / Accommodation type join in task 8)
5. People (Census 2021): filled in task 8
6. Food & drink: specialty coffee, coffee vs kebab, independent vs chain cafés, sandwich vs bakery chains,
   kebab shops vs cafés, bakeries vs betting shops, variety of cuisines, takeaways, food hygiene
7. Going out: nightlife, quiet nights, culture
8. Everyday life: families, gyms, dog-friendly, coworking, markets, universities
9. My criteria: the household's custom criteria + Build your own
Overlays (Recent sales, Places) are separate "Show on map" toggles. Every preset in `custom-presets.ts`
appears exactly once (unit test). Short meaning line per item.

### 6. Data selector UI
Replace the Explore chip row, the dock's layer picker and the "Scale" section with one "Colour the map by"
panel opened from the top bar: search box, then groups; desktop = groups left / items right, mobile = drill-down
with back. Choosing an item colours the map and closes; Cost and Safety stay open to pick a view. Views live
inside the item (actual / rank / change + window; crime types). Overlays at the bottom as checkboxes. No colour
on items. Keyboard: arrows, Enter, Escape; accessible names. Right panel keeps legend, timeline, overlays.
Update e2e (`layers-panel`, `map-legend`, `price-layer`, explore chips) and rendering baselines; both themes.

## C. Census layers

### 7. Census ingest: age and household type
Add Census 2021 TS007A (age bands 0–15, 16–24, 25–44, 45–64, 65+) and TS003 (one person, couple no children,
family with children, lone parent, other) at LSOA into `census_category` / `area_census_count` (see
`deploy/migrations/015-people.sql`, `api/area_api/people.py`, ingest in `pipelines/`). Licence note in
`DATA-LICENCES.md`. Area page People section shows them.

### 8. Census map layers
Choropleth layers (% of residents / households, Census 2021, LSOA): Ethnic makeup (Asian, Black, Mixed, White,
Other), Religion (Christian, Muslim, Hindu, Jewish, Sikh, Buddhist, No religion, Other), Residents' age, Household
type (group "People"), Tenure (owner, private rent, social rent) and Accommodation type (group "Homes & area").
The category is a view inside the item. Safeguards (user-approved): neutral polarity always (never traffic
light), factual labels with source on the legend, no ranking lists, not usable in Find my area matching; the
find-a-home agent rule stays; update `ROADMAP-research-driven-features.md` line 46 to match.

### 9. Final verification
`./gate.sh --mobile` (known failures: `test_place_tile_schema`, preflight SMTP/webhook), then web `npm test`,
contracts, Playwright with `PLAYWRIGHT_TEST_PORT=4380`. Check Day and Night, desktop and phone.

## Bug and request tracker (orchestrator, 2026-10-11)

| # | Item | State |
|---|---|---|
| 1-2 | Real palettes; no per-layer colours | fixed 2ba9f7c |
| 3 | Palette and 2D/3D remembered after reload | fixed 67063ea |
| 4 | A-vs-B colour square 4x4 | fixed 3279c8a |
| 5 | Street zoom: only buildings coloured | fixed 83275bc |
| 6 | Too many roads over colours; 3D buildings hide tint | fixed 39cb093 |
| 7-8 | Selected area key numbers on lenses; honest ties | fixed 79f6ace |
| 9-10 | Price layers traffic light; Typical home price | fixed fc2f31f (+ a27e773 checklist) |
| 11 | /claude chevrons | fixed a4dadb1 |
| 12 | Wider area: map, prices, placement | fixed f9a2e9e |
| 13-14 | Find areas like this works; seeds all criteria | fixed 2f0faf4, b3d43ca |
| 15 | Deprivation back as a match criterion | fixed d3bfd6a |
| 16 | Remove "Similar areas" | fixed c1c1093 |
| 17 | House zoom all grey: parcels take area colour | fixed f77323f |
| 18 | Home card "Now ~£" estimate | already gone in source; guard c52dbf6; needs redeploy |
| 19 | Home card: portal listing links + last sold / price paid | fixed b4794dd |
| 20 | Sold homes coloured by PR #28 coarse sale band | fixed 50284a6 (migration renumbered 043 in c320b95) |
| 21 | One "Find areas like this" entry on area page | fixed 9081bbe |
| 22 | Stop sending per-plot sold £/m² (`sppm`) in property tiles while the EPC licence is pending (tile build + migration, idempotent, RELEASE-CHECKLIST step); nothing in web/API/Claude tools may read it | done: 043 drops `sppm` and the sale pin `ppm`; API, web, OpenAPI and the Claude tool stop sending or showing any per-sale £/m²; guard tests in deploy, api and web |
| 23 | Production shows grey plots: live web predates migration 040 (other session's diagnosis); fixed by deploying main, then this branch | owned by site-launch session; this branch via PR after task 9 |
| 24 | Listing links on the full home page | fixed 4a7dc2c |
| 25 | Per-home EPC floor area still shown | user: keep for now; release blocker in RELEASE-CHECKLIST "Going public" |
| — | Per-sale £/m² (EPC) | off (043) until the EPC licence is settled |
| — | Rankings catalogue (docs/superpowers/plans/2026-10-11-rankings.md) | built a7538fa..a8ead7e; review fixes in progress |
