# Area panel as infographics: design

**Date:** 2026-10-05.
**Status:** approved direction ("tiles + charts everywhere"); spec awaiting review.

## Why
Users like the amount of data but find the panel text-heavy:
- tables (flood bands, stations)
- paragraphs (Overview summary, score sentences)
- inline licence and method notes

Goal: understand an area from pictures and numbers in seconds. Text shrinks to labels, one-line answers and (?) bubbles.

## Success criteria
- Every tab shows at least one chart above the fold. No tab opens with a table or a paragraph.
- No visible paragraph over 25 words in the area panel. Method, caveats and licences sit in (?) bubbles or in one folded "Sources" line per tab.
- **Overview:** an 8-tile dashboard answers price, trend, crime, income, flood, getting around, noise and schools without scrolling on a 1280×720 desktop. On phones, the first 4 tiles are visible after the header.
- **Accessibility:** every chart has `role="img"` with an `aria-label` sentence that carries the numbers. Charts that replace a table keep a "Show as table" toggle. Colour is never the only signal: labels and patterns also carry the meaning. 44px targets.
- Charts use theme tokens only (Slate, Paper, Plum, Mono, Night, plus the map palettes), so they work in every theme and in dark mode.
- Missing data shows "unknown" in place of the chart; never an empty chart, never 0.

## 1. Chart kit: `web/src/components/charts/` (shared, built first)
Small, pure SVG React components. No chart library. Props hold data and labels, never fetching. Each comes with unit tests for its pure geometry helpers and a Storybook-like demo page at `/dev/charts` (development only).

| Component | Shows | Used by |
|---|---|---|
| `ScaleMarker` | a value's position on a low→high bar, with an optional London marker and end labels ("cheap"/"dear") | price vs London, income, noise vs London |
| `SegmentScore` | a 1–10 score as 10 segments; coloured by "worse" direction or neutral | crime, deprivation, income, connectivity |
| `Sparkline` (exists) | trend line | price trend |
| `StackedBar` | 100% bar of ordered parts, with a legend and an optional "Show as table" | flood bands, Census topics, tenure, property types |
| `Waffle` | a 10×10 grid for one share | homes at 55 dB+, social renting |
| `RingScore` | a score ring (n of 10) with a big number | getting around, Overview tiles |
| `DistanceRings` | places plotted on 500 m / 1 km / 1.5 km rings by bearing and distance, with a label for each point | stations, schools, parks |
| `IconCount` | n icons with a count ("3 primary · 1 secondary") | schools, amenities |
| `BarList` | horizontal bars, area vs London marker (the current People bars, generalised) | Census details, crime types, market by type |
| `BandScale` | an A–G style band scale with this item's band highlighted | EPC rating, flood band at an address |
| `ChartFrame` | title row with HelpTip, the chart, the unknown state, the table toggle, and the folded sources line | wraps every chart |

Colours come from new tokens in `globals.css`, defined per theme:
- **Categorical:** `--chart-1` to `--chart-6`
- **Diverging, worse/better:** `--chart-bad`, `--chart-good`
- **Neutral and track:** `--chart-neutral`, `--chart-track`

Contrast is checked in `tests/colour-contrast.test.ts`, extended for these tokens.

## 2. Overview: tile dashboard
- **Header:** area name. A badge row with three headline badges built from the profile (price level, 1-year trend, the most notable topic) replaces the summary paragraph. The paragraph stays in `<details>` "Read as text" for screen readers and SEO, and in the FAQ.
- **Tiles:** a grid of 8 tiles, 2 columns on phones and in the desktop sheet. Each tile has an icon, a label, a big value and a mini chart. A tap opens the matching tab.

  | Tile | Mini chart | Opens tab |
  |---|---|---|
  | Price vs London | `ScaleMarker` | Housing |
  | Price trend | `Sparkline`, ▲/▼ % | Housing |
  | Crime | `SegmentScore` | Overview (crime card) |
  | Income | `SegmentScore` | People |
  | Flood | `StackedBar` mini | Environment |
  | Getting around | `RingScore` and nearest station | Transport |
  | Noise | `Waffle` | Environment |
  | Schools | `IconCount` | Schools |

- **Home cost card** stays: size chips, the big price and the stamp-duty link. The formula moves to a single caption line.
- **Civic** becomes a compact card: ward and MP names, council tax Band D as a big number with a mini bar of bands A–H.
- **FAQ and "About this data"** stay folded at the bottom.
- **Data:** flood and connectivity tiles reuse the existing hooks (`useAreaFlood`, the places loader), so no contract change is needed. Each tile renders "unknown" on its own.

## 3. Tabs

**Housing**
- Price-per-m² chart (exists) with 1Y–20Y.
- Market: summary tiles (median price, sales count, middle-50% range as a `ScaleMarker` range).
- By type: `BarList` of median prices with sales count labels, plus the existing box plot.
- 10-year trend lines (exist).
- Recent sales: a compact list of 5, with "Show all".
- Price-sample explanation behind (?).

**People**
- Residents and density as two big numbers.
- Each topic as one `StackedBar` (top 5 + other) with London marker ticks, a legend, and "Show all" opening the `BarList`.

**Schools**
- `DistanceRings` of nearby schools, coloured by phase.
- Then cards: name, rating badge, a distance bar and the phase icon.
- Search and filters stay.

**Environment**
- Flood: two `StackedBar`s (rivers and sea; surface water) and a `BandScale` for the selected address.
- Noise: a `Waffle` for homes at 55 dB+ with London's share as a caption, and a `ScaleMarker` for the median road dB.
- Demo-only screening stays as is.

**Transport**
- `RingScore` and nearest-station card.
- `DistanceRings` of stations, with line colour chips.
- Amenities as `IconCount` per group, with the nearest named.
- The station table moves behind "Show as table".

**Planning (demo)**
- A timeline strip of applications by status.

**Property**
- Value card: the last sale and the restated value as two points on a line with % change.
- EPC as a `BandScale` (current and potential).
- Facts as an icon grid: type, age band, rooms, floor area, floor level.
- Applies in the tab and on `/property/[uprn]`.

**Every tab:** one folded "Sources & method" line at the bottom, replacing inline licence paragraphs. Licence text stays word for word inside it.

## 4. Copy rules
- Labels are at most 4 words, and answers sit beside a number in one line.
- (?) bubbles keep their 1–3 sentences.
- No inline paragraphs, except the empty-area state and errors.

## 5. Testing
- **Unit:** geometry helpers (scale positions, waffle cell counts, ring angles, stacked widths summing to 100, band lookup), aria-label text, and "unknown" handling.
- **E2E:**
  - each tab has a chart (`[role=img]`) visible without scrolling, at 1280×720 and on mobile
  - no `.evidence-panel p` over 25 words, except allowed testids
  - "Show as table" toggles
  - existing specs updated
  - `unstyled-controls` and `interactive-targets` stay green
- **Visual:** re-capture the rendering snapshots, and check screenshots on real data (Brent 026D) at both sizes, in Slate and Night.

## 6. Out of scope
- New data sources or API changes. The tiles use existing endpoints.
- The `/guide`, `/tools` and `/rankings` pages, beyond reusing the chart kit where it already fits.
- Map behaviour (centring is a separate task).
