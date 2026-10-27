# Two-block layout (phone and desktop): design and plan

**Date:** 2026-10-05
**Status:** design approved in chat ("yes"); executing.

## Why
The map is covered by up to seven floating parts:
- the header card
- the layer rail or strip
- the colour-scale card, with a half-screen crime list
- the 2D/3D card
- full-screen, zoom and "Map ready"
- the timeline card
- the evidence panel or sheet

The user wants the interface minimal: two blocks.

## Target
Exactly two visible blocks over the map, at any width.
1. **Top bar** (one row).
   - It holds the "A" mark (on desktop also "Close Knit"), the search field and a menu button (≡).
   - The menu holds:
     - Guide, Tools, Privacy
     - Colours (interface theme and map palette, from appearance-menu)
     - Data (Demo/Real, from the layer rail's data-mode radios, including the release line)
     - Map view (2D/3D)
     - Build my match
2. **Map dock**, one component (`MapDock`).
   - **Desktop:** a right panel, 380px wide, full height under the top bar. It collapses to a 44px strip with a "Show panel" toggle.
   - **Phones (≤ 800px):** a bottom sheet with the existing handle and swipe. In its collapsed state it shows the three rows below.
   - Contents, top to bottom:
     1. **Layers:** one scrollable row of chips (Price/m², Stock value, Crime, Deprivation, Income, Social rent).
     2. **Scale line:** a compact legend (gradient, low and high labels), the period with ▶ for price, and a "⋯" button. "⋯" opens scale settings: measured, percentile or change, the change window, "Show individual sales", and the crime-type filter as a compact checklist.
     3. **Area:** today's evidence (tabs and tiles) when an area is selected. Otherwise "Choose an area on the map or search" (the empty state). On phones, the collapsed sheet shows the "Area name · value ›" row that opens it.
     4. **Footer line:** "Real data pilot · release", the map attribution "i" (OSM/OpenMapTiles require it) and Privacy, in one small line.
- **Removed from over the map:**
  - MapLibre zoom and compass, the full-screen toggle and 2D/3D
  - the "Map ready" status, which stays as an sr-only live region
  - the "Colour scale & legend" pill, the separate timeline card, the left rail and the colour-scale card
- Zoom works by wheel, pinch, double-click and keyboard (+/−). Tilt is in the menu.

## Constraints
- **Keep test ids** where elements survive: `scale-mode`, `selected-area`, `evidence-sheet-*`, layer buttons (`layer-*`), `price-timeline` and the crime filter. Update specs for elements that moved.
- **Accessibility:** the menu is a disclosure button with Escape and outside-click closing and focus return (the same pattern as HelpTip and appearance-menu). The layer chips keep their keyboard behaviour. 44px targets. No unstyled buttons.
- **Map space:** desktop map padding for fitBounds and flyTo must account for the dock (right 380px or collapsed 44px). On phones, use the sheet height (existing `--sheet`).
- **CSS:** goes in a new `web/src/styles/layout.css`. Remove the dead rules for the removed parts from `globals.css`.
- **No data or API changes.**

## Files
- New: `web/src/components/map-dock.tsx`, `web/src/components/top-bar-menu.tsx`, `web/src/styles/layout.css`
- Modified: `close-knit.tsx` (composition), `explorer-header.tsx`, `layer-picker.tsx`, `map-legend.tsx`, `price-timeline-control.tsx`, `area-map.tsx` (remove the floating controls; the toolbar becomes the "⋯" settings content), `evidence-panel.tsx` (it renders inside the dock), `appearance-menu.tsx` (content reused inside the menu), `globals.css` (cleanup)

## Tests
- **New `e2e/two-block-layout.spec.ts`**, desktop and mobile:
  - Exactly two visible blocks over the map, `[data-block="top-bar"]` and `[data-block="map-dock"]`.
  - None of these are visible: `.maplibregl-ctrl-group`, `.pitch-controls`, the full-screen toggle, `.map-toolbar`, the left layer rail.
  - The menu opens and closes (Escape returns focus). Its links go to /guide, /tools and /privacy. Colours changes the theme, Data switches mode, and 2D/3D changes pitch in the URL.
  - Layer chips change `layer=` in the URL. "⋯" opens the scale settings, and the crime filter works.
  - The period slider is present for price.
  - The attribution "i" is reachable.
  - No horizontal scroll.
  - Desktop: the dock collapses and expands.
- **Update existing specs** that assumed the old placement: map-controls, map-legend, layer-strip, layer-overflow, crime-controls, motion-zoom, interactive-targets, unstyled-controls, explorer, rendering snapshots (re-capture and inspect).
- **Full suite:** `npm test`, typecheck and the full Playwright run with `--workers=2` all pass.
- **Real data:** screenshots of Brent 026D at 1440×900 and on a phone, in Slate and Night.
