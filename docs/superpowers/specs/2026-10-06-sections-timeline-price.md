# Sections panel, yearly timeline, one price layer: design and plan

**Date:** 2026-10-06. **Status:** decisions approved in chat; executing in two parallel tracks.

## Feedback addressed
1. "Is it safe? Unknown" after scrubbing the timeline. Fixed separately in f233b70: the profile follows the layer's newest period.
2. The ▶ timeline plays month by month and too slowly. Old years render almost all one colour on the £4k–£12k scale.
3. "Price / m²" and "Stock value" look like the same data. Decision: merge them into one Price layer.
4. Tabs feel arbitrary (crime and income appear on several tabs). Decision: one scrolling panel of collapsible sections with bold titles. Folding is remembered.

## Track A: timeline, gradient, one price layer
Owns: `area-map.tsx`, `price-timeline-control.tsx`, `map-legend.tsx`, `lib/legend-scale.ts`, `lib/palettes.ts`, `lib/map-property-layers.ts`, layer chips (`layer-picker.tsx` / map-dock chips), `lib/map-state.ts` (URL compat), the metric catalogue entries, and the related tests.

- **Yearly steps.** The timeline steps one per year (June of each year, plus the latest month if it is not June). Play advances every 700 ms. The slider snaps to years. A typed URL period that is not a June month still loads as it is. Keyboard ←/→ moves one year.
- **Gradient.**
  - The price scale is fixed for every year, so growth reads as the map warming.
  - Its range is the 2nd–98th percentile of all LSOA price-per-m² values over the whole history, computed once from the packs and cached per release.
  - The interpolation is logarithmic, over a 7-stop perceptual ramp built from the chosen palette.
  - Legend: low and high labels with the range (e.g. "£2.1k – £15k+"), plus a tick for the London median of the shown year.
  - Acceptance: in 2006 the visible LSOAs span at least 4 of the 7 colour bands. Unit-test the ramp position function and the band spread on fixture data. E2E: two years render different legend ticks.
- **One price layer.**
  - Remove the "Stock value" layer and its chip.
  - "Price / m²" keeps its area colours. At parcel zoom it shows each house's restated £/m², which is what stock value does today, with the existing parcel attribution.
  - **"Colour homes by" switch** in the dock's scale settings ("⋯"), a two-option segmented control:
    - **Value now** (default): the last sale restated to today by the area's index, which is today's stock value.
    - **Sold price**: the £/m² of the recorded sale, in nominal terms.
    - It applies to parcels and individual sale points at house zoom. Area colours stay the 12-month median of sales.
    - Persist it in the URL as `homes=sold` (absent = value now).
    - The legend title says which one is shown.
    - Tests: the switch changes the parcel paint property and the URL; reloading keeps it; the default is Value now.
  - Old URLs with `layer=stock-value-per-square-metre` load as `price-per-square-metre`.
  - Keep the API and metric id (the property page and MCP tools use them). Only the map layer list and the chips change.
  - Update the specs that used the stock-value chip.

## Track B: one panel of sections
Owns: `evidence-panel.tsx` (the tab nav, `ActivePanel`, `SectionPanel`), a new `evidence-sections.tsx`, `styles/sections.css`, `overview-tiles.tsx` (tile → section jump), and e2e helpers (`e2e/evidence.ts` `openEvidenceTab` becomes `openEvidenceSection`).

- **No tabs.** One column:
  1. Summary: the headline badges, then the tiles, the home cost and the council card.
  2. Then sections in this order: **Price & market** (Housing: price chart, market by type, recent sales), **Crime**, **People** (Census), **Schools**, **Environment** (flood, noise), **Transport**, **Planning**, **Property** (only when a home is chosen).
- **Section headers** are bold and full width, with an icon, the title, a one-line key figure ("141.5 per 1,000 · 9/10") and a fold chevron. A header is a `<button aria-expanded>` that controls its region.
- **Crime** becomes its own section, taking the crime card from the Overview.
- **Folding.** Folded sections are remembered in localStorage (key `close-knit.folded-sections`). The default is all open. "Fold all" and "Open all" sit in one small row under the summary.
- **Tiles** scroll to their section and open it if folded. Focus moves to the section header.
- **Lazy loading.** Sections fetch their data only when first opened and on screen (IntersectionObserver). The first view must not fire all 8 section requests. Assert the request count in e2e.
- **Keep the rules.** `text-density` still holds: no paragraph over 25 words, and a chart within the first screen of each opened section. Keep unstyled-controls and interactive-targets green. Phone: same column inside the sheet.
- **Update every spec** that used `openEvidenceTab`. Keep the test ids of section contents.

## Done when
- `npm test`, `npm run typecheck`, API tests and the full Playwright suite (`--workers=2`) pass.
- Rendering snapshots are re-captured and inspected.
- Real-data screenshots of Brent 026D (desktop and phone) show the section list and the timeline at 2006 and 2026.
