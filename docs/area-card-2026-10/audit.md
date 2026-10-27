**Area card audit: sections, rating data, and why text can't be copied**

This is a read-only audit. I checked it with targeted greps only and did not test anything in a browser.

**1. Components that render the area**
- **Map sheet (`evidence-panel.tsx:105`, `AreaBrief` :310).** Shows the title, the wider areas, then six tiles (`BRIEF_TILES` at :284: price, trend, crime, transport, flood, schools) from `OverviewTiles`. Below those come the home cost, highlights, an "Open full area page" link, save actions and "About this data". In this worktree the sheet is only a brief. There is no full card or tabs in the sheet.
- **`/area` page (`area-full-page.tsx:149`, `AreaFullBody` :247).** Top to bottom:
  1. Title, "Open on map", a "…" menu and save buttons.
  2. At a glance (:304): badges, 7 tiles (`TILE_IDS` in `overview-tiles.tsx:168`), home cost.
  3. `HomesHere` (:314): the listings CTA.
  4. "Open all" / "Close all".
  5. Nine folding cards from `AREA_CARDS` (`lib/area-brief.ts:12-23`):
     - **Price & market:** the £/m² section, then "Local market" (price spread, 10-year trend).
     - **Homes sold nearby:** the chosen home's last sale, address history, recent sales.
     - **Safety & services (`living`, :340):** the crime card and crime history, food hygiene, then `PeopleSection` and `LondonContextCard`. `PeopleSection` is headed "Homes here" and covers home type, tenure, household type, age, ethnic group, religion, country of birth, jobs, qualifications and density (`people-profile.ts:78-97`).
     - **Schools:** `AreaSchoolsSection`.
     - **Getting around & nearby:** `PlacesSection` and station access.
     - **Environment:** flood and noise.
     - **Planning & rules:** planning applications.
     - **Council & tax:** Band D council tax.
     - **Plan & check a home (`home`, :371):** `PropertyTools`, `CostWorksheet`, referencing check, leasehold checklist, viewing checklist and your own candidate homes (`PlanAndCheck` at :518).
  6. "Areas with similar figures" (`similar-areas.tsx:49`), placed after all the cards at :386.
  7. Sources.
- **Name clash:** the listings CTA and the people section (`people-section.tsx:50`) are both called "Homes here".
- **Splitting Safety & services:** `TILE_CARD` sends both `crime` and `people` to `living` (`area-brief.ts:34`), so that mapping changes too.

**2. Which metrics have a London-wide distribution**
Areas carry `londonPercentile` and `englandPercentile` (`contracts.ts:94-101`). The ETL stores a percentile per area in `metric_value` (`schema.sql:59`).

| Metric | London percentile? | Trend direction? |
|---|---|---|
| Price £/m² | Yes: `etl_price_release.py:73`, used in `overview-tiles.tsx:187` | Yes: `priceTimeline` and `area.change` |
| Typical price by home type | Yes: `040-area-price-bands.sql:136` | — |
| Crime | Yes: `etl_crime_release.py:110` | Yes: metric history (`MetricHistory`, :345) |
| Deprivation (IMD) | Yes: `repository.py:30` | No (single release) |
| Income | Yes: `repository.py:48` (MSOA) | — |
| Social renting | Yes: `repository.py:39` | — |
| Market level | Yes: `repository.py:59` | — |
| Station walk | Yes: `etl_station_access.py:454` | — |
| Food hygiene | Yes: `etl_food_hygiene.py:69` | — |
| Getting-around score (1–10) | **No.** The 1–10 comes from a fixed formula (`places.py:130`), not a London ranking. | — |
| Schools | **No.** Only counts within 1 km (`contracts.ts:152`). School results exist, but no area-level score does. | — |
| Noise | **No.** `area_noise` covers every LSOA (`009-noise.sql:12`), so the server could compute one. | — |
| Flood | **No.** `area_flood` is per LSOA (`018-flood.sql:33`); the Environment Agency bands already read like a rating. | — |
| Green space / parks | **No.** Only a nearby-parks list (`places.ts:42`). | — |
| Market depth (sales, turnover, leasehold share) | **No** (`contracts.ts:697-713`). | Yes: `growth1y/3y/5y/10y` give a direction. |
| Census topics (tenure, household, age, ethnic group) | **No, on purpose:** "descriptive only", decided 2026-10-11 (`etl_census_layers.py:20`). Show them as shares beside London, never as a rating. | — |
| Broadband, air quality | **No data** (no matches anywhere). | — |

**3. Why text can't be selected (no `user-select: none` in any CSS; the only hits set `text`/`all`)**
- **Tiles are buttons.** Every overview tile puts its label, value, note and chart inside a `<button>` (`overview-tiles.tsx:79-89`). Text inside a button can't be drag-selected (Firefox's default styles block it; in Chrome and Safari a drag that starts on a button never becomes a selection).
- **Card headers are buttons.** The title and headline figure sit inside `<button class="area-card__toggle">` (`area-full-page.tsx:453-466`), including "Price & market £X/m²".
- **On phones, the whole sheet is a drag handle.**
  - `pointerdown` anywhere in the sheet starts a press (`map-dock.tsx:357-364`). `NOT_A_HANDLE` exempts only `input, select, textarea, .layers-panel` (:244).
  - A vertical move then turns into a sheet drag, which captures the pointer (:354) and calls `preventDefault` on touchmove (:432). Clicks within 500 ms of a drag are swallowed (:436).
  - `layout.css:509` sets `.dock-area { touch-action: pan-x }` below the full snap, so a vertical gesture never reaches selection.
- Chart areas also take pointer events (`market-section.tsx:270`, `market.css:41`). This is minor.
- Fixes: move tiles and card toggles to a separate small chevron or link instead of wrapping the content, and add body text to `NOT_A_HANDLE` (or limit dragging to `.dock-grip`/`.dock-head`).

**Open:** I haven't reproduced the copy failure in a browser. The PO's "full sheet with an overview tab" doesn't exist in this branch, which only has the sheet brief plus the `/area` page.