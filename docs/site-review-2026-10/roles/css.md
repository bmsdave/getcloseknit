# Close Knit: Staff CSS / Front-end review (2026-10-10)

Reviewed on the local dev build at http://127.0.0.1:4480 (Next dev, in-process fixtures, no `CLOSE_KNIT_API_URL`). Production was not accessed. The repo was read-only. Bundle weights come from the existing production build in `web/.next` (BUILD_ID `5zgjYoDINR_P99HsoeQnyOct`, built today at 11:32). Timings are warm dev numbers, so treat them as proxies, not field data.

Scripts and evidence are in `scratchpad/site-review/css/`: `sweep.cjs` (+ `sweep-light.json`, `sweep-dark.json`), `wizard.cjs`, `results.cjs`, `misc.cjs`, `map.cjs`, `more.cjs`, `tbl.cjs`, `print.cjs`, and screenshots in `css/shots/`.

## 1. Goals, users, metrics (as I read them)

- **Product.** A map-first London neighbourhood decision tool for home movers (README "Current vertical slice"). The accepted journey is **Discover → Set needs → Shortlist → Compare → Inspect → Decide** (docs/ux-remediation-2026-09-06/README.md). The area goal is "a buyer understands an area at a glance" (docs/area-clarity-2026-10/TASKS.md).
- **Users.** London buyers and renters, including people moving to areas they don't know, with different commute and school needs (docs/london-user-validation-protocol.md › Sample).
- **Success metrics.** From the validation protocol › Measures:
  - task completion to a reasoned shortlist;
  - understanding of uncertainty (achieved vs asking price, how coarse the carrier is, missing evidence);
  - time and number of external tabs compared with portals;
  - willingness to pay.
- **Release bar.** Real mode never shows preview data. Preferences work from 320px. Comparison is readable for 2–4 areas. The gate passes (remediation README; RELEASE-CHECKLIST › Gates and Going public).
- **Design contract.** DESIGN.md: tokens only, 44px targets, a visible `--focus` outline, one primary action per screen, Night theme tokens. The 2026-09-06 audit scored Responsive UX at 3.5/10, so layout robustness is the explicit debt this lens checks.

## 2. Site-wide measurements

| Check | Result | Evidence |
|---|---|---|
| Horizontal page overflow, 24 routes × 320/375/768/1024/1440 (light) and 12 routes × 375/1920 (dark) | **0 routes overflow** (`scrollWidth == innerWidth` everywhere) | css/sweep-light.json, sweep-dark.json |
| Off-screen elements | 1 real bug: property "More" menu opens at L=-103px at 320 | css/more.cjs output, shots/320-property-more-open.png |
| Console / hydration errors | 0 on all 200 routes, both themes | sweep logs |
| CLS > 0.05 | Only `/area/lsoa/E01000001`: **0.337 @768**, 0.095 @1024, 0.054 @1440. Shifted nodes: `area-full__sources`, `overview-card overview-home`. Every other route is < 0.01 | sweep-light.json |
| LCP (warm dev) | All < 450ms except civic, which is 1320ms (client fetch) | sweep-light.json |
| Focus | 18 tab stops on home, each with a 3px solid `--focus` outline (globals.css:258) | misc.cjs TAB |
| Reduced motion | Global CSS kill-switch (globals.css:352). The map and timeline check `matchMedia` (area-map.tsx:1069, price-timeline-control.tsx:41) | code |
| Dark mode | Body is `#16203a` on every route. The Night tokens hold up on the map, sheet and tools | shots/dark-*.png |
| No WebGL | Fallback works: "Map unavailable on this device; area evidence below remains usable". The status string shows twice in innerText | map.cjs |
| Font | One variable woff2 (76.9KB), preloaded, `display: swap` with a metric-adjusted fallback. No layout shift came from the font | layout.tsx, misc.cjs |
| Home JS (prod build, gz) | **~503KB**, including a 396KB gz chunk (1.43MB raw, MapLibre). `/area` page is ~135KB gz | .next/server/app/page_client-reference-manifest.js |
| CSS on text pages | 3 stylesheets, ~265KB raw / ~44KB gz, including **maplibre-gl.css (83KB raw / 10.6KB gz, 39 data-URIs)**, on every route | .next/static/chunks/3ql8xhzzuiecf.css; layout.tsx:5 |
| TfL overlay | `public/tfl-network.json` is 555KB raw / 62KB gz GeoJSON | public/, lib/map-transit.ts:43 |
| CSS architecture | 3,546 lines in 30 files, all imported from the root layout. Colours are tokenised. **There are no type, spacing, radius or breakpoint tokens**: 10 distinct breakpoints, 16 px font sizes (4 rules at 8px, 13 at 9px, 40 at 10px), 1 `rem` in total, 28 `overflow-wrap: anywhere` | grep of web/src/**/*.css |

## 3. Journeys (ranked)

Axis key: Clar = clarity, Task = task completion / friction, Trust = trust & credibility, Vis = visual & interaction quality, Perf = performance & robustness, A11y = accessibility & mobile, Value = value delivered vs. product goals, Layout = layout robustness across breakpoints, FE = front-end performance.

### J1. CUJ: search or tap the map, then read an area's evidence (cuj-map-search-select)

- **Why it is critical.** This is the README's map-first proposition and the "Discover/Inspect" step. It is the entry for every validation session.
- **Steps walked.**
  1. `/` at 390×844, 320, 768, 1024, 1440 and 844×390.
  2. Typed SW1A in the combobox and tapped the first option. The map stays put and selects `uk:lsoa:E01000001`.
  3. Read the sheet or panel, then "Open full area page".
  4. Repeated in Night, without WebGL, and with reduced motion.

| Axis | Score | Rationale | Evidence |
|---|---|---|---|
| Clar | 4 | The intro card, search, chips and a legend with the London marker are clear. On a 760px phone, only the title and 2 tiles sit above the sticky CTA | capture/shots/home-selected-m.png |
| Task | 4 | Search → select works by touch and keyboard. Enter on an unknown postcode lands on a bare 404 (likely a fixture artefact) | capture/INDEX.md › Home search flow |
| Trust | 4 | A persistent "Demo data · not for decisions" badge, a London typical marker, and Sources & privacy in the footer | home-selected-1024.png |
| Vis | 4 | A coherent knit system. The Explore chips row runs under the panel at 1024 ("Culture" is cut off) | shots/home-selected-1024.png |
| Perf | 4 | 0 errors. Map ready in 1.1s (warm). The no-WebGL fallback works, though its status text is duplicated | map.cjs |
| A11y | 4 | 44px targets, visible focus on all 18 stops, and a skip link | misc.cjs TAB |
| Value | 4 | Delivers "understand an area at a glance" | area-clarity TASKS goal |
| Layout | 3 | At 844×390 landscape the panel (298px) is filled by the legend, title and CTA bar, so **0 evidence tiles show**. At 768 portrait the sheet takes 45% of the screen | shots/landscape-844x390.png; tab.cjs |
| FE | 3 | ~503KB gz JS on `/`, MapLibre is not deferred, and the TfL GeoJSON is 555KB raw. The INP proxy (chip tap) was 144ms in dev | .next manifests; map.cjs |

**Overall 3.8.**

### J2. CUJ: Find my area → matches → compare (cuj-find-my-area-compare)

- **Why it is critical.** This is "Set needs → Shortlist → Compare". It is the exact surface the validation protocol exercises (personal-match-panel.tsx), and the release bar requires it to work from 320 and to compare 2–4 areas.
- **Steps walked.** At 320×700 and 1440×900: `/` → Find my area → Continue with no budget (blocked) → budget 600000 → Continue → Show areas → tick 3 Compare boxes → Compare areas.

| Axis | Score | Rationale | Evidence |
|---|---|---|---|
| Clar | 3 | The budget placeholder "600,000" looks like a filled value, so Continue fails with "Enter your budget". There are 2 clearly labelled steps | shots/wizard-320-1.png (first run) |
| Task | 4 | Two steps, then ranked results in about 1.7s. Comparison opens full-screen at 320 and at 1000px on desktop. The audit's overflow is fixed | results.cjs |
| Trust | 3 | Compare rows print internal ids (`uk:lsoa:E01000002 · observed · preview-price-2026-06`, `preview-open-data-2026-09`), which reads as debug output, not provenance | shots/compare-320.png |
| Vis | 2 | The comparison dialog's **Close/Remove buttons are browser-default** (2px outset, `#efefef`, radius 0). The dialog background is 96% alpha, so the map shows through. The ranking and explanation text uses 8–9px sizes (globals.css:155-196) | results.cjs STY; compare-320.png |
| Perf | 4 | 0 errors and no stalls | results.cjs |
| A11y | 3 | Wizard fields are 44px. The must-have checkbox is 17×20. School shortlist checkboxes are 13×13, the school search is 25px tall, and admission selects are 23px. All are below DESIGN §7's 44px | wizard.cjs, results.cjs |
| Value | 4 | The core decision journey completes | remediation README |
| Layout | 4 | No overflow at 320. The dialog is 320×700 full-bleed | results.cjs |
| FE | 4 | Interactions respond and there are no long tasks in dev | map.cjs events |

**Overall 3.4.**

### J3. CUJ: land directly on an area page from a shared link (cuj-area-page-direct)

- **Why it is critical.** This is the "Inspect" step. Area pages are what Claude/MCP and shares link to (`/claude`; the sitemap). It is the "glance" surface.
- **Steps walked.** `/area/lsoa/E01000001` at 320, 375, 768, 1024, 1440 and 1920, light and dark. Opened cards. Print emulation.

| Axis | Score | Rationale | Evidence |
|---|---|---|---|
| Clar | 4 | Title, Open on map, demo notice, then the tile scorecard | shots/320-area.png |
| Task | 4 | Cards expand, hash deep links open a card (area-full-page.tsx:204) | code |
| Trust | 4 | A sources footer and per-card source folds | area-full-page.tsx:186 |
| Vis | 3 | At 320 the "Getting around" value breaks mid-word as **"Excelle / nt"**, and the 10/10 ring crowds the text (`overflow-wrap: anywhere`, overview-tiles.css:37) | shots/320-area.png |
| Perf | 4 | 0 errors, about 135KB gz JS | manifest |
| A11y | 4 | Cards are buttons controlling regions, with focus restored on reveal | code |
| Value | 4 | Directly serves the glance goal | area-clarity TASKS |
| Layout | 3 | A fixed 2-column tile grid gives ~140px tiles at 320. Print shows 9 collapsed cards, 25 buttons and the nav | print.cjs |
| FE | 2 | **CLS 0.337 @768** (fails the 0.25 "poor" threshold), 0.095 @1024. Overview and section figures fill in after hydration (`useSectionValue` returns null while loading, area-full-page.tsx:401) | sweep-light.json |

**Overall 3.6.**

### J4. CUJ: postcode → homes → property due diligence (cuj-postcode-homes-property)

- **Why it is critical.** This is "Inspect/Decide" at address level. README: "an address can expose known transaction and EPC history". The validation protocol's comprehension metric covers achieved vs asking price.
- **Steps walked.** `/postcode/SW1A-1AA` → `/postcode/SW1A-1AB/homes` → `/property/100000000001` → More menu, at 320, 375 and 1440, light and dark.

| Axis | Score | Rationale | Evidence |
|---|---|---|---|
| Clar | 4 | Clear headings, plus "Estimate, not a valuation" | capture/text/postcode-homes-m.txt |
| Task | 3 | At 320 the **More menu opens 103px off-screen left**, so the Google Maps and Street View links are cut off. The homes table (647px inside a 288px box) needs sideways scrolling with no cue | more.cjs; tbl.cjs |
| Trust | 4 | HM Land Registry and EPC attribution | homes text |
| Vis | 3 | Wide tables with no sticky first column. Inline links are 13px tall on the postcode page | tbl.cjs; sweep small targets |
| Perf | 5 | Server-rendered, CLS 0, 0 errors | sweep |
| A11y | 3 | The scroll wrapper `.property-table-wrap` is not focusable and has no role or label (keyboard users can't scroll it). There is no `<caption>` | tbl.cjs; property.css:67 |
| Value | 4 | Strong address-level evidence | README |
| Layout | 3 | Menu anchoring and the table pattern both break at 320 | above |
| FE | 5 | Very light pages | manifest |

**Overall 3.8.**

### J5. Happy path: property → stamp duty → mortgage / buy-to-let tools (hp-money-tools)

- **Why it counts.** Affordability is the first need in the wizard (budget). The tools feed "Decide" (area-clarity Wave 3 M).
- **Steps walked.** `/tools`, `/tools/stamp-duty?price=295000`, `/tools/mortgage-rates`, `/tools/investor?price=250000`, at 320–1440, light and dark.

| Axis | Score | Rationale | Evidence |
|---|---|---|---|
| Clar | 4 | The price is filled in and there is a "Not financial advice" callout | shots/dark-stamp-390.png |
| Task | 4 | The price carries over via `?price` | capture |
| Trust | 4 | Clear advice disclaimer | same |
| Vis | 4 | Sticky result bar on mobile and good Night theming | same |
| Perf | 5 | 0 errors, CLS 0 | sweep |
| A11y | 4 | Fields are 44px. The tables fit at 320 | tbl.cjs |
| Value | 3 | Supporting, not differentiating | protocol › portal vs unique value |
| Layout | 4 | `.tools-layout__result` uses `100vh`, not `dvh` (tools.css:37), which is minor on iOS | code |
| FE | 5 | About 14 JS requests, light | misc.cjs |

**Overall 4.1.**

### J6. Happy path: rankings → ranking list → area (hp-rankings-to-area)

- **Why it counts.** A discovery path for people new to London. README: rankings "stay labelled discovery surfaces".
- **Steps walked.** `/rankings` → `/rankings/most-expensive` → area link, at 320–1440.

| Axis | Score | Rationale | Evidence |
|---|---|---|---|
| Clar | 4 | Simple index and list | capture |
| Task | 4 | Links go straight to area pages | capture |
| Trust | 3 | The discovery labelling depends on intro copy. With fixtures, the lists are 3 areas (fixture artefact, not penalised further) | capture/text |
| Vis | 3 | Two page templates disagree: `.methodology` pages have a 36px h1 at 320, `.subpage-hero` pages (guide, glossary, claude, privacy, terms) have 28px, with different hero rhythm | sweep h1Size |
| Perf | 5 | 0 errors | sweep |
| A11y | 4 | The table fits 284px | tbl.cjs |
| Value | 3 | Helps discovery but not the core match | README |
| Layout | 4 | Fine at all widths | sweep |
| FE | 5 | Light | manifest |

**Overall 3.9.**

### J7. Happy path: print or save the area evidence pack (hp-evidence-pack-print)

- **Why it counts.** "Decide" output. It is the decision-brief artefact the validation sessions produce.
- **Steps walked.** `/area/lsoa/E01000001/pack` in screen and print media, plus a PDF render (shots/pack.pdf).

| Axis | Score | Rationale | Evidence |
|---|---|---|---|
| Clar | 4 | A clear pack heading | capture |
| Task | 4 | Prints cleanly with links expanded (`a[href^=http]::after`) | globals.css:495-501 |
| Trust | 5 | Citations are printed with their URLs | same |
| Vis | 4 | Black text in print, cards avoid page breaks | same |
| Perf | 5 | Server-rendered | sweep |
| A11y | 4 | Fine | — |
| Value | 4 | A tangible output | protocol › Method 2 |
| Layout | 4 | The print rules are scoped to `.market-pack` only. Area and property pages have no print CSS (9 cards print collapsed) | print.cjs |
| FE | 5 | Light | — |

**Overall 4.3.**

### J8. Happy path: learn via (?) help → guide article → glossary (hp-learn-guide)

- **Why it counts.** The comprehension-of-uncertainty metric. Area clarity moved method text behind (?) and into /guide.
- **Steps walked.** `/guide`, `/guide/reading-the-map`, `/glossary`, `/claude`, `/privacy`, `/terms`, at 320–1440, light and dark.

| Axis | Score | Rationale | Evidence |
|---|---|---|---|
| Clar | 4 | Plain-language hero and lead | capture |
| Task | 4 | Index → article works. Unknown slugs 404 as designed | capture |
| Trust | 4 | Legal pages are present | capture |
| Vis | 4 | `text-wrap: balance/pretty`, 60ch measure (subpage.css:49-51) | code |
| Perf | 5 | 0 errors, CLS 0 | sweep |
| A11y | 4 | 18px lead text. Muted notes elsewhere drop to 10–11px | grep |
| Value | 3 | Supports comprehension | protocol |
| Layout | 4 | Fine | sweep |
| FE | 4 | Render-blocking map CSS (maplibre 83KB) on pure text pages | layout.tsx:5 |

**Overall 4.0.**

## 4. Proposals (ranked by impact ÷ effort)

1. **Style the comparison dialog and extend the unstyled-controls guard (S, high impact, high confidence).**
   - Problem: Close and Remove render as browser-default buttons (2px outset, `#efefef`). The dialog background is 96% alpha (globals.css:328-341). `e2e/unstyled-controls.spec.ts` never opens the comparison.
   - Change:
     - Give `.comparison-dialog__head button` and the remove buttons the existing quiet-button style (`--chip`, radius, 44px).
     - Set the dialog background to `var(--panel-solid)`.
     - Add a "compare 3 areas" step to unstyled-controls.spec.ts.
   - Improves: J2 Vis 2→4 and Trust. This is the core decision surface.
   - Affects: area-comparison.tsx and globals.css only. The e2e runtime goes up by about 3s.
2. **Fix the property "More" menu at narrow widths (S, medium impact, high confidence).**
   - Problem: at 320 the menu sits at L=-103 because `.property-more__menu` uses `right: 0` with `min-width: 200px` and "More" wraps to the start of its row (property.css:24-27).
   - Change: under 400px use `left: 0; right: auto; max-width: calc(100vw - 32px)`, or switch to CSS anchor positioning with `position-try-fallbacks: flip-inline`. Add a 320px e2e assertion that the menu stays inside the viewport.
   - Improves: J4 Task and Layout.
   - Affects: the property page only. Check the same pattern in other `<details>` menus (knit-menu.css).
3. **Remove area-page CLS (M, high impact, high confidence).**
   - Problem: CLS 0.337 at 768, 0.095 at 1024. The overview cards and section figures arrive after hydration (`useSectionValue` returns null while loading).
   - Change: give the tiles and overview card fixed skeleton heights (`min-height` per tile, `aspect-ratio` for the ring and sparkline), or server-render the headline figures into the RSC payload. Add a CLS < 0.1 assertion at 768/1024/1440 to the Playwright gate.
   - Improves: J3 FE 2→4 and perceived quality on shared links. It also helps the "glance" metric.
   - Affects: area-full-page.tsx, overview-tiles.css, and possibly the profile BFF. Low risk.
4. **Stop mid-word breaks and make the tile grid adapt (S, medium impact, high confidence).**
   - Problem: "Excelle/nt" at 320 (overview-tiles.css:37), with 28 `overflow-wrap: anywhere` rules across the CSS.
   - Change:
     - Use `overflow-wrap: break-word; hyphens: auto` (the html is already `lang="en-GB"`) on display values. Keep `anywhere` only for ids and URLs.
     - Make `.area-tiles` a container (`container-type: inline-size`) and switch tiles to one column, or put the ring under the value, below about 150px tile width.
   - Improves: J3 Vis and Layout, J1 sheet tiles.
   - Affects: the overview tiles on the map sheet and the area page, and charts.css labels. Re-baseline the visual snapshots.
5. **Short-viewport and phone-selected panel mode (M, high impact, medium confidence).**
   - Problem: at 844×390 the 298px panel shows 0 tiles. On a 760px phone, only 2 tiles show above the sticky CTA after selection, because the legend block takes about 150px.
   - Change: once an area is selected, collapse the legend to a single line (swatch strip and value marker; full legend on tap). Under `@media (max-height: 500px)`, drop the footer line and shrink the CTA bar.
   - Improves: J1 Clar and Layout, and the time-to-understand metric.
   - Affects: the layer picker and legend (knit-legend.css, layout.css) and the sheet snap points. Needs mobile e2e updates. Make sure the "grey = no data" legend meaning stays reachable (trust).
6. **Type-scale tokens with a 12px floor, in rem (M, high impact, high confidence).**
   - Problem: 16 ad-hoc px sizes, 57 rules at 8–10px (the match ranking and school evidence use 8–9px, globals.css:155-196), and 1 `rem` in total. A user's browser default font size is ignored.
   - Change: define `--fs-2xs…--fs-3xl` in rem on `:root` in globals.css. Map the 8–11px uses to `--fs-xs` (0.75rem) or above. Add a stylelint `declaration-property-unit-allowed-list` for font-size, and document it in DESIGN.md §3.
   - Improves: A11y on J2 and J8, and legibility in validation sessions.
   - Affects: every stylesheet (mechanical). Visual snapshots change. Some dense charts need relayout.
7. **Breakpoint, spacing and radius tokens (M, medium impact, high confidence).**
   - Problem: 10 breakpoints (480, 520, 560, 600, 640, 720, 760, 800, 801, 960) plus 8 radius values, all hard-coded. The phone/desktop switch is split between `max-width: 800px` and `min-width: 801px`.
   - Change: standardise on 3 breakpoints (≤640 phone, ≤800 sheet, ≥1100 wide), using `@custom-media` via postcss-preset-env or documented constants. Add `--radius-s/m/l/pill` and a 4px spacing scale. Do it as a codemod plus a lint rule.
   - Improves: Layout robustness on all journeys and maintenance.
   - Affects: all CSS, DESIGN.md. Do it as one PR after the fixes above to avoid churn.
8. **Responsive, accessible data tables (S, medium impact, high confidence).**
   - Problem: the homes table is 647px inside a 288px box. `.property-table-wrap` is not focusable and has no label. There is no caption and no sticky first column (property.css:67).
   - Change:
     - Below 560px, render rows as stacked `<dl>` cards, or make the address column `position: sticky; left: 0` with a scroll-shadow mask.
     - Give the wrapper `tabindex="0" role="region" aria-label="Homes in SW1A 1AB"` and the `:focus-visible` style already used for `.market-table-wrap` (market.css:24).
     - Add `<caption class="sr-only">`.
   - Improves: J4 Task and A11y (axe scrollable-region-focusable).
   - Affects: the postcode homes, property history and sales tables via knit-tables.css.
9. **Scope map CSS and stop importing every stylesheet in the root layout (M, medium impact, high confidence).**
   - Problem: `maplibre-gl.css` (83KB raw / 10.6KB gz, 39 data-URIs) is render-blocking on 23 non-map routes (layout.tsx:5). All 30 stylesheets are imported globally (layout.tsx:6-36), about 265KB raw of CSS on a guide page.
   - Change: import the MapLibre CSS from the map component (area-map / places map). Move page-specific sheets (tools, guide, property, market, civic) into their route layouts or the component that uses them.
   - Improves: FE on J4–J8 (FCP/LCP on slow 3G), and maintenance.
   - Affects: CSS order and specificity (watch the knit overrides in map-knit.css). Needs a visual snapshot pass.
10. **Defer MapLibre and the Tube overlay on the home page (M/L, high impact, medium confidence).**
    - Problem: about 503KB gz JS on `/`, including a 396KB gz MapLibre chunk on the critical path. The TfL GeoJSON is 555KB raw.
    - Change:
      - Render the search, intro and sheet shell server-side.
      - Load the map with `next/dynamic({ ssr: false })` behind a static paper-coloured poster of the same size, so there is no CLS.
      - Fetch `tfl-network.json` after `map.on('idle')`. Pre-simplify and quantise it (or serve it as Martin vector tiles).
    - Improves: J1 FE (LCP/INP on mid-range Android), and time to first interaction with search.
    - Affects: area-map.tsx init, the e2e "Map ready" waits, the service worker shell list. Trade-off: the map paints a little later.
11. **Make the wizard budget field read as empty (S, medium impact, high confidence).**
    - Problem: the placeholder "600,000" next to the £ prefix looks like a value, so the first Continue fails (shots/wizard-320-1.png).
    - Change: an empty placeholder or "e.g. 600,000" in muted italic, `inputmode="numeric"`, and helper text under the label. Validate on blur as well as on Continue.
    - Improves: J2 Clar and Task, and wizard completion (the protocol's task completion).
    - Affects: the wizard Needs stage and its tests.
12. **Touch-target pass on the match panel (S/M, medium impact, high confidence).**
    - Problem: school shortlist checkboxes are 13×13, the school search 25px, admission selects 23px, and the must-have checkbox 17×20. These violate DESIGN §7 (44px) and WCAG 2.5.8 (24px).
    - Change: a 44px label hit area via padding and `min-block-size: 44px` on inputs and selects. Add a target-size check (≥24px, warn under 44) to the e2e helper used in unstyled-controls.spec.ts.
    - Improves: J2 A11y and mobile completion.
    - Affects: match-panel.css and the globals.css school-shortlist rules. The panel gets slightly taller.
13. **One page shell for content pages (M, medium impact, medium confidence).**
    - Problem: two hero systems. `.methodology` (a legacy name from the retired /methodology route) gives a 36px h1 at 320, `.subpage-hero` gives 28px. They have different top margins and lead styles.
    - Change: a single `<PageShell>` with one h1 clamp, lead and measure. Rename `.methodology` to `.page`.
    - Improves: J6 and J8 Vis, consistency, and maintenance.
    - Affects: about 15 routes (area, rankings, tools, postcode, civic, guide). Visual baselines change.
14. **Print styles for area and property pages (S/M, medium impact, high confidence).**
    - Problem: printing `/area/...` outputs 9 collapsed cards, 25 buttons and the nav. Only `.market-pack` has `@media print`.
    - Change: in print, hide `header`, `nav` and toggle buttons, force `.area-card` bodies open, and reuse the pack's URL-append rule. Optionally add `beforeprint` to mount closed cards.
    - Improves: J3 and J7 Decide output (brief sharing).
    - Affects: area-full-page.tsx (it mounts cards lazily, so print needs them mounted), area-brief.css.
15. **Version and prune the service-worker cache (S, low impact, high confidence).**
    - Problem: `CACHE_NAME = "close-knit-shell-v3"` is constant (public/sw.js:1), so hashed `/_next/static` chunks pile up across deploys with no eviction. The 1.4MB map chunk is stored again on every deploy.
    - Change: inject the BUILD_ID into the cache name at build time, or prune `/_next/static` entries not referenced by the current manifest during `activate`. Cap the number of entries.
    - Improves: robustness and storage on returning mobile users.
    - Affects: the PWA offline shell. Test offline navigation.
16. **Add a layout/CLS CI sweep (M, high impact, high confidence).**
    - Problem: the regressions found here (menu off-screen, CLS 0.34, mid-word wrap, unstyled dialog buttons) are not covered by the gate.
    - Change: port css/sweep.cjs into a Playwright spec covering:
      - every sitemap route × 320/768/1024/1440 × day/night;
      - an assertion of no horizontal overflow;
      - no element outside the viewport when opened;
      - CLS < 0.1;
      - zero console errors.
      Run it in `gate.sh --mobile`.
    - Improves: Layout and FE on every journey, and keeps the release bar ("works from 320px").
    - Affects: gate runtime (+1–2 min). Use fixtures, so it is deterministic.
17. **Keep the Explore chips row inside the visible map (S, low impact, high confidence).**
    - Problem: at 1024 and 844 the chips row runs under the evidence panel ("Culture" is cut off; shots/home-selected-1024.png).
    - Change: set the chips row's `right` to the panel width plus the gutter when the panel is docked, with a fade mask on the overflow edge as a scroll cue (the audit already flagged the missing scroll cue).
    - Improves: J1 Vis and discoverability of the intent chips.
    - Affects: layout.css explore-row rules.

## 5. What is already good (keep it)

- No horizontal overflow at any width tested.
- No console or hydration errors.
- Strong focus outlines, 44px main controls, and full Night theming.
- A reduced-motion kill-switch plus JS checks.
- A working no-WebGL fallback.
- Metric-adjusted self-hosted font.
- The comparison overflow from the 6 September audit is fixed (full-screen at 320).
- Server-rendered postcode, property and tools pages with zero CLS.
