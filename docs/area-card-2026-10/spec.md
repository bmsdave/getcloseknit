# Area card redesign spec

## 1. Section order (one scrolling page with sticky tab chips, used in the full sheet and on `/area`)

| # | Section | Why it is here |
|---|---|---|
| 1 | **Overview** | A grid of ratings answers "is this area worth a look?" in about 5 seconds. |
| 2 | **Price & market** | Buyers rank price first. Sold-homes evidence moves in here. |
| 3 | **Getting around** | Transport is the top priority in London. |
| 4 | **Safety** | Crime only: rate, history, trend. 9 in 10 buyers won't compromise on it. |
| 5 | **Schools** | Matters a lot to families. Shows the best nearby school, not a count of schools. |
| 6 | **Environment** | Green space, noise and flood. Air quality is a gap: no data. |
| 7 | **People & homes** | Tenure, households, age, ethnic group and density. Neutral shares beside London, never rated, never under Safety. Rename it from "Homes here" to end the clash with the listings CTA. |
| 8 | **Living costs** | Council tax and food hygiene. |
| 9 | Footer | Big links: "Check a home → Tools", "Similar areas →" (one link), "Planning applications", "Sources". |

**What moves out**
- "Plan & check a home" (`PlanAndCheck`, `PropertyTools`, `CostWorksheet`, checklists, candidate homes) moves to a new page, `/tools/check-a-home`.
- "Areas with similar figures" shrinks to one footer link that opens the existing list on the map.
- Planning becomes a footer link.

## 2. Overview header (7 tiles, plus 1 optional)

Each tile shows: label, **score /10 + band word**, percentile bar, optional trend arrow, and at most one key fact.

| Tile | Rating source | Trend | Data today |
|---|---|---|---|
| **Price** | `facts.price.londonPercentile`. Neutral colour, no score: "pricier than X% of London". | `area.change` 12-month %, neutral arrow | Yes |
| **Getting around** | Station-walk London percentile (`etl_station_access.py:454`). Fact: "7 min to X". | — | Yes (station walk only). **Gap:** the `places.py:130` score is a formula, so it is not shown as /10 until it is ranked across London. |
| **Safety** | Crime `londonPercentile` (flipped, so 10 = safest) | vs last year, from `MetricHistory`. Good/bad colour. | Yes |
| **Schools** | Best primary within 1 km by its London rank, from the `results` ranking already used for "top N schools". Fact: school name. | — | **Partial:** school ranks exist. Needs a server field `bestPrimaryLondonPercentile`. Drop "6 primary, 1 secondary". |
| **Green space** | Distance to nearest park, London decile | — | **Gap:** a per-area distribution is not computed yet. Show "No rating" until it is. |
| **Quiet** | `area_noise` per LSOA, London percentile | — | **Gap:** a server-side percentile is needed (the data covers every LSOA). |
| **Flood** | Environment Agency band as a 4-step rating (not /10) | — | Yes |
| *(optional)* **Market activity** | — | Sales volume ▲/▼ from `growth1y` | Yes. Hidden when the sample is too small. |

Shops & cafés is left out: there is no distribution yet (OSM counts exist only as custom presets). Deprivation and income stay out of the header because they are context, not buyer criteria.

**Rule:** a tile with no London distribution shows **"No rating"** and its raw fact. It never shows a guessed score.

## 3. One component, `<Rating>`

```
props: { label, percentile: number|null, higherIsBetter: boolean|null,
         trend?: { pct, period, goodWhenUp: boolean|null, n? }, fact?, sourceHref }
score = percentile==null ? null : clamp(ceil((higherIsBetter ? p : 100-p)/10), 1, 10)
band  = 1–2 "Well below London" · 3–4 "Below" · 5–6 "Middle" · 7–8 "Above" · 9–10 "Top 20%"
```

- **Colour:** a 5-step diverging ramp from `--chart-bad` to `--chart-neutral` to `--chart-good`, mixed with `color-mix`. It runs red to blue, so it is colour-blind safe and has no olive or green. Day and Night use the existing tokens. Price and People pass `higherIsBetter: null`, which gives `--chart-neutral` only.
- **Visual:** `SatinSteps(10, score)` in the band colour, then a large number "8/10", then the band word. Below that sits the existing scale marker (`charts/scale-marker.tsx`) with a `Dot` at the percentile.
- **Trend:** `KnitIcon` `rise`/`fall` plus "▲4% vs 2025". Its colour comes from `goodWhenUp`. The arrow is suppressed below the market section's existing minimum sample. If no such rule exists, the PO must approve a number before one is added.
- **Accessibility:** an `aria-label` such as "Safety 8 out of 10, safer than 74% of London, down 6% vs last year". Colour is never the only signal. The stitching is `aria-hidden`.
- **Info:** an ⓘ link to the source opens the method and caveats.

## 4. Section anatomy (the same everywhere)

1. A row of `<Rating>` for the section's rated metrics.
2. **At most one chart**, reusing what exists: price trend `Sparkline`, crime history, price band strip, `SatinStacked` for the People shares.
3. A key-numbers list (`dl`, two columns, plain text, copyable), at most 6 rows.
4. Caveats and methods go behind ⓘ (`<details>`). No paragraphs in the body.

People & homes uses rows of shares (area vs London) and has no Rating.

## 5. Text-selection fix

- **Tiles:** content becomes a `<div>`. One small "Details ›" `<a href="#section">` per tile replaces the wrapping `<button>` (`overview-tiles.tsx:79-89`).
- **Card toggles:** the title and figure become plain text. The toggle is a separate chevron button (`area-full-page.tsx:453-466`). The folding cards are dropped where sections become always-open.
- **Sheet:** dragging is limited to `.dock-grip, .dock-head` (`map-dock.tsx:243/357`), so a press in body text never starts a drag.
- **CSS:** `.dock-area { touch-action: pan-y }` in the body region (`layout.css:509`).
- **Charts:** pointer handlers are only on the chart SVG, not on the text beside it (`market.css:41`).

## 6. Parallel slices (separate files; the `<Rating>` props above are frozen first)

| Slice | Files | Acceptance |
|---|---|---|
| **A. Rating** | new `components/rating.tsx`, `rating.css`, `rating.test.ts` | Unit tests cover score/band mapping (p=0, 50, 100, null), flip, trend suppression and the aria-label text. Both themes render. |
| **B. Server scores** | `places.py`, `repository.py`, new migration (noise percentile, best-school percentile, park-distance percentile, getting-around London rank), `contracts.ts` fields | Fields are nullable. API tests check that values are 0–100. The source is listed in Sources. |
| **C. Overview** | `overview-tiles.tsx`, `overview-badges.tsx` | 7 tiles using `<Rating>`. Gaps show "No rating". No `<button>` wraps any text. e2e: `explorer.spec`/`decision-brief.spec` updated. |
| **D. Card structure** | `lib/area-brief.ts`, `area-full-page.tsx`, `people-section.tsx` (rename) | Tabs and sections follow §1. `TILE_CARD` sends `crime` to `safety` and `people` to `people`. The PlanAndCheck and SimilarAreas blocks are replaced by footer links. |
| **E. Tools page** | new `app/tools/check-a-home/page.tsx`, new `components/plan-and-check.tsx`, `app/tools/page.tsx` | The page renders the moved tools and is listed on `/tools`. `tools.spec` passes. |
| **F. Selection/drag** | `map-dock.tsx`, `layout.css`, `market.css` | Playwright test: drag-select a paragraph in the sheet, and `getSelection()` is not empty. Dragging the grip still snaps the sheet. |
| **G. Sheet = full card** | `evidence-panel.tsx` | At the full snap the sheet renders the `/area` body (Overview first). The peek state keeps the brief. |

**Order:** A and B start first. C needs A. D and E can run alongside A. F and G are independent. Before merge: `npm run lint`, `tsc`, unit tests, then the e2e suite once all slices land.

**Open:** the copy failure has not been reproduced in a browser. Shops & cafés, Green space, Quiet and the Getting-around /10 need slice B before they can show a rating. The PO must confirm the trend-arrow sample threshold.

**Code referenced:** `/Users/vadim/project/close-knit/.claude/worktrees/free-postcode-photos-fc9e7e/web/src/components/{overview-tiles,area-full-page,map-dock,evidence-panel}.tsx`, `web/src/lib/area-brief.ts`, `web/src/components/knit/satin.tsx`, `DESIGN.md`.