# Close Knit — Staff UX Designer review (2026-10-10)

Reviewed the local build at http://127.0.0.1:4480 (Next dev, in-process fixtures, no `CLOSE_KNIT_API_URL`). Production was not accessed. Where a problem may only be a fixture artefact, the text says so.

Evidence roots:
- `UX/` = `<scratchpad>/site-review/ux/` (my scripts `j1*.cjs`–`j6.cjs`, `audit.cjs`; results `audit-d.jsonl`, `audit-m.jsonl`; screenshots in `shots/`)
- `CAP/` = the shared capture folder (`capture/shots`, `capture/text`)
- Repo paths are relative to `web/src` unless stated otherwise.

## 1. Goals, users, metrics (as I read them)

- **Product:** a map-first, source-linked London tool for people moving home. It aims to be a "trustworthy real-data decision service" that links budget, commute, achieved prices and area comparison into a household shortlist and a decision brief (README "Current vertical slice"; `docs/proptech-gap-analysis-2026-09-06/README.md`; `ROADMAP-personal-area-match.md` Summary).
- **Users:** London buyers and renters. The study deliberately includes people **moving to an unfamiliar area**, not only locals (`docs/london-user-validation-protocol.md` § Sample). Secondary users: owners of homes shown on the site (objection rights; RELEASE-CHECKLIST § Privacy and legal), and Claude/MCP users (`/claude`; RELEASE-CHECKLIST § Going public).
- **Success measures** (`02-PRIORITIES-AND-DELIVERY.md` § Measures; protocol § Measures):
  - task completion: reaching a shortlist with stated reasons;
  - comprehension of uncertainty: achieved vs asking price, source carrier, missing evidence;
  - time and external tabs needed, compared with portals;
  - return to a saved shortlist and use of the comparison or brief;
  - willingness to pay.
  - Pre-registered stop rule: participants treating preview fixtures as official.
- **Current design intent:**
  - "a buyer understands an area at a glance" (`docs/area-clarity-2026-10/TASKS.md`);
  - a visible staged sequence: discover → needs → shortlist → compare → evidence → brief (`docs/ux-audit-2026-09-06/README.md` P1.1);
  - visual rules: snow-white or navy grounds, real stitches, no olive, one primary action per screen (`DESIGN.md` §1, §7, §8).

## 2. Journeys (ranked by importance)

| # | id | kind | journey | overall |
|---|---|---|---|---|
| 1 | cuj-find-my-area | CUJ | Find my area → matches → compare → decision brief | **2.8** |
| 2 | cuj-postcode-check | CUJ | Search a postcode or address → area at a glance → full area page | **3.8** |
| 3 | cuj-first-visit | CUJ | First visit: understand what this is and pick a way in | **3.3** |
| 4 | cuj-home-objection | CUJ | A homeowner finds their home and reports or hides it | **3.0** |
| 5 | hp-property-check | Happy path | Check a specific home: estimate, sales history, stamp duty | **4.0** |
| 6 | hp-lifestyle-lens | Happy path | Explore by lifestyle chip ("Good coffee") → add to my match | **3.4** |
| 7 | hp-claude-setup | Happy path | Connect Close Knit to Claude from /claude | **3.9** |

Each journey is scored from 1 to 5 on these axes: clarity, task completion, trust, visual quality, performance, accessibility & mobile, value, learnability and emotional tone.

### J1 cuj-find-my-area — CUJ (overall 2.8)

**Why it is critical:** this is the proposition under test. The protocol exercises "shortlist comparison, tradeoff relaxation, and decision brief" (protocol § Method), and the roadmap's core is a personal match. A comprehension failure here blocks product claims.

**Steps walked** (desktop 1440 and mobile 390; `UX/j1c.cjs`, `j1d.cjs`, `j1e.cjs`, `j5.cjs`):
1. `/` → click **Find my area**. A two-step wizard opens ("Your basics, Step 1 of 2").
2. Click **Continue** with nothing filled in. Inline validation reads "Enter your budget, for example £600,000." (good).
3. Enter budget 600000 and commute place "SW1A" (pick SW1A 1AA) → Continue → "What matters" (Off / Matters / Must have per factor) → **Show areas**. Wall time is about 9 s scripted. The URL becomes `layer=personal-match`.
4. Results: "Top matches · 3 areas meet your must-haves". The cards show ~£686k / ~£728k / ~£840k, all over the £600k limit, each carrying a **Fits** badge plus "! Price" (`UX/shots/j1-results-d.png`, `j1-results-m.png`).
5. Tick two compare checkboxes → **Compare areas**. A dialog opens (`UX/shots/j1-compare-d.png`, `j1-compare-m.png`).
6. Open the collapsed **Saved areas & costs** → **Preview decision brief** (`UX/shots/j5-saved-d.png`, `j5-brief-d.png`).

| axis | score | rationale | evidence |
|---|---|---|---|
| clarity | 3 | The wizard is clear: step count, plain factor names, inline validation. Results get muddier: the legend says "Your top 50 matches" while only 3 areas are listed (fixture), and an over-budget area is labelled "Fits". | `UX/shots/j1-s2-d.png`, `j1-results-d.png` |
| task completion | 3 | Completed end to end with no errors. But the brief, the key output, is hidden inside the collapsed "Saved areas & costs" section and was not visible until expanded (Playwright: element not visible). Compare needs checkbox discovery. | `UX/j1e.cjs` log ("Preview decision brief … element is not visible"); `components/decision-brief.tsx:99` |
| trust | 2 | Figures contradict each other within one session. A card shows North London ~£686k, but the compare table shows "440,000 budget fit". A card shows "SW1A 1AA 26 min", but compare shows "Commute · Not published … no Commute evidence". The brief claims "target budget £480,000", "Weighted toward Affordability (weight 3) — weights you set" and "Schools: primary phase, aiming to shortlist 3", none of which the user entered. Internal IDs are exposed ("uk:lsoa:E01000002 · observed · preview-price-2026-06"). | `UX/j1e.cjs` output; `UX/shots/j1-compare-d.png`; `UX/j5.cjs` output; `lib/matching.ts:154`; `components/area-comparison.tsx:100-108` |
| visual quality | 2 | The wizard is polished. The compare dialog looks unfinished: browser-default grey "Close" and "Remove" buttons, a striped texture behind the "Measure" header cell, default bullets. On mobile the dialog is translucent and the page behind bleeds through the cards. | `UX/shots/j1-compare-d.png`, `j1-compare-m.png`; `components/area-comparison.tsx:106` |
| performance | 4 | 0 console errors on desktop and mobile. Validation and empty states are present. Results render in about 3.5 s on the dev server. | `UX/j1*.cjs` "ERR []" |
| accessibility & mobile | 3 | Factors are proper fieldsets with legends (`components/preference-panel.tsx:331`). Compare toggles are named role=checkbox controls. On mobile the compare cards read badly through the transparent backdrop, and the factor table stacks into very long single-column cards. | `UX/shots/j1-compare-m.png` |
| value | 3 | It delivers the intended shortlist → compare → brief chain, but the contradictions above would fail the protocol's "comprehension of uncertainty" measure. | protocol § Measures |
| learnability | 2 | Budget behaves as a soft preference with no explanation: #1 can be £240k over the limit and still "Fit". "weight 3" and "weight 0" appear without the user ever setting weights. The legend paints "Not in your top 50" in black, and `brief-blocks.tsx:130` says "green best" although the ramp is azure. | `components/brief/brief-blocks.tsx:130`; `lib/fixtures.ts:119-121` |
| emotional tone | 3 | The wizard is warm and brief. Compare and the brief switch into a cold, engineering register ("Unknown stays unknown — never ranked above an observed value", "hard utility limits"). | `UX/j5.cjs` output |

**Top issues:**
- Contradictory numbers between the card, compare and the brief.
- The brief attributes defaults to the user.
- The compare dialog is unstyled.
- The brief is buried.
- Over-budget areas are labelled "Fits".

### J2 cuj-postcode-check — CUJ (overall 3.8)

**Why it is critical:** the most common entry for movers who already have a candidate (portal listing → postcode). It carries the area-clarity goal, "understands an area at a glance" (`docs/area-clarity-2026-10/TASKS.md`), and the audit P0.4 commitment to search correctness.

**Steps walked:**
1. `/` → type "SW1A". Options: SW1A 1AA / 10 Sample Street / St James's.
2. Pick SW1A 1AA. The map selects the LSOA and the panel shows St James's (`CAP/shots/search-landed-*.png`, `CAP/shots/home-selected-m.png`).
3. **Open full area page** → `/area/lsoa/E01000001` (`UX/shots/area-m-top.png`).
4. `/postcode/SW1A-1AA`.
5. Edge cases:
   - "Camden" → "No areas or addresses match" (fixture).
   - "ZZ9 9ZZ" → the dropdown offers "ZZ9 9ZZ: prices and sales — Every home and recorded sale in this postcode"; Enter → `/postcode/ZZ9-9ZZ` → bare Next "404 This page could not be found." (`UX/j4.cjs`).

| axis | score | rationale | evidence |
|---|---|---|---|
| clarity | 4 | The at-a-glance cards (price vs London, trend, crime, flood, getting around, schools, home cost by size) use plain words with (?) help. | `CAP/text/area-lsoa-d.txt`; `UX/shots/area-m-top.png` |
| task completion | 4 | One search plus one click gets to the evidence, and the full page is one more click. Any postcode-shaped string is offered as a result and leads to a dead-end 404. | `lib/postcode-search.ts:157-169`; `UX/j4.cjs` "ENTER -> /postcode/ZZ9-9ZZ 404" |
| trust | 4 | Every figure names its source, and the area page has a "Demo data · not for decisions" banner. The postcode page shows the same fixture figures with no demo label. The crime caveat "shops and stations included" appears on the postcode page but not on the area card. | `UX/audit-d.jsonl` (`/postcode/SW1A-1AA` demo:false); `CAP/text/postcode-d.txt` |
| visual quality | 4 | Strong card system and clean snow ground. The "Getting around" donut clips its "10/10" label on mobile. The Tube overlay crosses area labels ("W1J · Mayfair") on the map. | `UX/shots/area-m-top.png`; `CAP/shots/home-selected-m.png` |
| performance | 3 | 0 console errors and warm idle 0.6–1.5 s. There is no `app/not-found.tsx`, `error.tsx` or `loading.tsx` anywhere, so misses are unbranded dead ends with no way back. The noise card shows a bare italic "unknown". | `find web/src/app -name 'not-found*'` → none; `UX/shots/area-m-top.png` |
| accessibility & mobile | 3 | No horizontal overflow on any of the 24 pages at 390 px. The focus ring on explore chips and layer options is `rgb(accent / 0.55)` yellow on white, about 1.3:1, which fails WCAG 1.4.11 and 2.4.13. Smallest text is 6.72 px on the mobile area page. On mobile the legend sits above the evidence, leaving only two cards above the fold. | `styles/layout.css:29,99,137,231`; `UX/j4.cjs` TAB log; `UX/audit-m.jsonl` minFont |
| value | 4 | Directly meets the area-clarity goal; it links to stamp duty, similar areas and the evidence pack. | `CAP/text/area-lsoa-d.txt` |
| learnability | 4 | Card → tab ("Opens Price & market") is a consistent pattern. Postcode, LSOA and MSOA naming is handled with friendly names. | same |
| emotional tone | 4 | Calm and confident: "Among London's priciest", "rough guide". | same |

**Top issues:**
- The synthesised postcode option leads to a default 404.
- No branded not-found or error pages.
- No demo label on the postcode page.
- Low-contrast focus ring.
- Clipped donut and the "unknown" empty state.

### J3 cuj-first-visit — CUJ (overall 3.3)

**Why it is critical:** going public (RELEASE-CHECKLIST § Going public) means cold visitors, and the audit scored task clarity 4/10 because there was "no clear staged journey". The landing page has to explain the map and route people to J1 or J2.

**Steps walked:**
1. `/` on desktop and mobile (`CAP/shots/home-d.png`, `home-m.png`).
2. Tab through the first 8 controls (`UX/j4.cjs`).
3. Open the Menu: Guide / Tools / Use with Claude / Sources & privacy / Terms.
4. Dismiss the intro.

| axis | score | rationale | evidence |
|---|---|---|---|
| clarity | 3 | One hero line ("Find a London area that fits your budget, commute and life") with one CTA. The document h1 is "Choose an area on the map or search", not the value proposition. Nothing explains what the coloured shapes are beyond "Price per m² · grey = no data". | `UX/audit-d.jsonl` h1; `CAP/text/home-d.txt` |
| task completion | 4 | Three clear ways in (search, Find my area, chips) with a skip link. | `CAP/search-results.json` |
| trust | 3 | "Demo data · not for decisions" is present but in 10 px footer text. There are no links to methodology or sources from the hero. | `UX/audit-m.jsonl` minFont 10 |
| visual quality | 3 | The yarn Tube overlay dominates the overview: dozens of coloured lines and beads compete with the price choropleth and labels. The owner's "clean snow" ground is cluttered at zoom 11. The basemap has no streets locally (likely missing tiles). | `CAP/shots/home-d.png`, `home-m.png` |
| performance | 4 | 0 errors; idle about 1.1 s warm. | `CAP/INDEX.md` |
| accessibility & mobile | 3 | On mobile the explore chips are cut off at the right edge ("Gy…") with no overflow cue. The intro card takes about 30% of the viewport. The chip focus ring has low contrast (see J2). | `CAP/shots/home-m.png` |
| value | 3 | It routes people to the proposition but does not set expectations (preview data, London only, free and open). | — |
| learnability | 3 | Map, sheet and chip metaphors are familiar. The legend jargon ("Price / m²", "London typical £7.5k") is unexplained until (?) is used. | `CAP/text/home-d.txt` |
| emotional tone | 4 | The knitted logo, yarn icons and warm copy are distinctive. | `CAP/shots/home-d.png` |

**Top issues:**
- Tube overlay clutter.
- h1 and value proposition hierarchy.
- Mobile chip overflow cue and intro card height.
- Demo label too small.

### J4 cuj-home-objection — CUJ (overall 3.0)

**Why it is critical:** a legal gate before going public. RELEASE-CHECKLIST lines 128–131 require "select a home → 'Report or hide this home' → e-mail …". The privacy notice and LIA depend on objection being easy.

**Steps walked:**
1. `/property/100000000001`. The footer says "Wrong, or your home? Select it on the map to report an error or hide it". The "map" link goes to `/` with no address.
2. On `/`, search "10 Sample" → pick the address. The map URL has `selected=uk:lsoa:…` but **no address parameter**.
3. The panel shows **Report or hide this home** → inline form (e-mail, details, "Send confirmation link") (`UX/shots/j6-address-d.png`, `j6-report-d.png`).
4. Not submitted: submitting is out of scope, and SMTP is not configured locally.

| axis | score | rationale | evidence |
|---|---|---|---|
| clarity | 3 | The copy is clear, but the property page gives an instruction ("select it on the map") instead of an action. | `components/property-profile.tsx:94`; `app/postcode/[code]/page.tsx:129` |
| task completion | 2 | The owner must leave the page that shows their home, re-search the address and find the control in the panel. The context is lost because the link is to `/`. | `UX/j6.cjs` URL output |
| trust | 4 | "only a hash is kept" and "Confirming removes this home from search, history and the map" are honest and specific. | `UX/j6.cjs` FLOW output |
| visual quality | 3 | The inline form sits in the evidence panel above the area cards. It is functional but not visually distinct as a privacy action. | `UX/shots/j6-report-d.png` |
| performance | 3 | The form renders without errors. Submission and the e-mail round trip were not verified locally. | — |
| accessibility & mobile | 3 | Labelled e-mail field. Not walked on mobile; the sheet would need scrolling past the legend. | — |
| value | 3 | It exists and works, but discoverability risks complaints and ICO exposure once the site is public. | RELEASE-CHECKLIST § Privacy and legal |
| learnability | 3 | Owners arrive from search engines on `/property/…`, not on the map, so the mental model does not fit. | — |
| emotional tone | 3 | "Wrong, or your home?" is respectful, neither cute nor cold. | — |

**Top issues:**
- No objection action on the property and postcode pages.
- The map deep link loses the address.

### J5 hp-property-check — Happy path (overall 4.0)

**Why it matters:** the roadmap's property-intelligence work and the protocol's "achieved versus asking price" comprehension measure.

**Steps walked:**
1. `/property/100000000001` → estimate "~£668k · medium confidence · Estimate, not a valuation"; last sale; £/m² vs MSOA; EPC; sales history.
2. From the area page "Stamp duty on this price" → `/tools/stamp-duty?price=…` (`CAP/text/property-d.txt`, `tools-stamp-duty-m.txt`).

| axis | score | rationale | evidence |
|---|---|---|---|
| clarity | 4 | The estimate, last sale and change are explained in one line. | `CAP/text/property-d.txt` |
| task completion | 4 | The price prefills the tool ("Price filled in. Change it to try other numbers."). The property page itself has no direct stamp duty or mortgage link; that path goes through the area page. | `CAP/text/tools-stamp-duty-m.txt` |
| trust | 5 | "Achieved prices from HM Land Registry, never asking prices"; EPC caveat; rates "Checked against gov.uk on 5 October 2026"; not financial advice. | same |
| visual quality | 4 | Clean EPC bar and table. | `CAP/shots/property-d.png` |
| performance | 4 | 0 errors; idle about 0.7 s. | `CAP/INDEX.md` |
| accessibility & mobile | 3 | Smallest text 9 px. Tables are fine at 390 px with no overflow. | `UX/audit-m.jsonl` |
| value | 4 | Directly serves the comprehension measure for achieved vs asking price. | protocol § Measures |
| learnability | 4 | Estimate vs valuation is spelled out. | — |
| emotional tone | 4 | Reassuring and factual. | — |

**Top issues:**
- No direct money-tool CTA on the property page.
- Small chart text.
- No privacy action (see J4).

### J6 hp-lifestyle-lens — Happy path (overall 3.4)

**Why it matters:** discovery for movers to unfamiliar areas (protocol § Sample), and the roadmap's "extensible lifestyle and amenity signals". It feeds My match via "Add to my match".

**Steps walked:** `/` → **Good coffee** → `layer=custom:good-coffee`, ranked "Most / Fewest" list and **Add to my match** → **More** reveals 20 lenses (`UX/j3.cjs`; `UX/shots/j3-coffee-d.png`, `j3-more-d.png`).

| axis | score | rationale | evidence |
|---|---|---|---|
| clarity | 3 | The "0 – 50 places" scale and "Across London: 3 areas scored" (fixture) need a sentence on what counts. "How this works" is at the bottom. | `UX/j3.cjs` output |
| task completion | 4 | One tap to a lens; "← Back to Price / m²" is clear. | same |
| trust | 3 | Lens names such as "Coffee vs kebab", "Pret vs Greggs" and "Bakeries vs betting shops" read as class-coded proxies and use brand names. DESIGN §8 says "never cute in data". | `UX/j3.cjs` MORE output; `DESIGN.md` §8 |
| visual quality | 4 | Yarn icons are consistent per lens. | `UX/shots/j3-coffee-d.png` |
| performance | 4 | About 3.5 s to switch on dev; 0 errors. | `UX/j3.cjs` |
| accessibility & mobile | 3 | Chips are cut off on mobile with no cue; low-contrast focus ring. | `styles/layout.css:137` |
| value | 3 | A good hook. The link to match helps, but its effect on the score is not previewed. | — |
| learnability | 3 | "vs" lenses are a ratio concept that is not explained up front. | — |
| emotional tone | 4 | Playful, but the tone risk is noted under trust. | — |

**Top issues:**
- Lens naming tone and brand names.
- Scale meaning.
- Mobile chip overflow.

### J7 hp-claude-setup — Happy path (overall 3.9)

**Why it matters:** RELEASE-CHECKLIST § Going public requires that "/claude shows the `claude mcp add` command"; it is a distribution channel (`agents/`, the find-a-home skill).

**Steps walked:** `/claude` on desktop and mobile (`CAP/text/claude-d.txt`). The URL shown is `http://127.0.0.1:8080/mcp` locally, which is an environment artefact.

| axis | score | rationale | evidence |
|---|---|---|---|
| clarity | 4 | A three-step connector recipe plus a Claude Code command. | `CAP/text/claude-d.txt` |
| task completion | 4 | Copy buttons are present. The skill download is mentioned with no visible download CTA in the text dump. | same |
| trust | 4 | "What Claude sees, and what it doesn't" and "not stored" are explicit. | same |
| visual quality | 4 | Consistent subpage style. | `CAP/shots/claude-d.png` |
| performance | 4 | 0 errors. | `CAP/INDEX.md` |
| accessibility & mobile | 4 | No overflow; 12 px minimum font. | `UX/audit-m.jsonl` |
| value | 4 | A cheap channel for the guided interview. | — |
| learnability | 3 | "Connectors" and "Capabilities → Skills" are product jargon for non-technical movers, with no screenshots. | — |
| emotional tone | 4 | Friendly headline. | — |

**Top issues:**
- Jargon and no visual guide.
- The skill download is not obvious.

## 3. Cross-site findings (measured)

- **Footer and legal:** Privacy and Terms links appear only on `/`, `/postcode`, `/property`, `/claude`, `/privacy` and `/terms`. They are missing on area, rankings, tools, guide, glossary, civic, brief and pack pages (`UX/audit-d.jsonl`).
- **No branded error handling:** no `app/not-found.tsx`, `error.tsx` or `loading.tsx`. The 404 title is "404: This page could not be found."
- **Doubled brand in titles:** "Glossary · Close Knit · London Close Knit" (`app/glossary/page.tsx:7`, `app/brief/page.tsx:4`, `app/claude/page.tsx:12`, `app/privacy/page.tsx:13`). Brand naming is also inconsistent: "close knit" / "Close Knit" / "London Close Knit".
- **`/brief` opened directly** shows "This brief link is incomplete." as its h1, which is a sensible error state.
- **Rankings index** says "from the same official data as the map" with no demo label, while the ranking list shows the demo label (`CAP/text/rankings-d.txt`).
- **Layout:** 0 horizontal overflow on 24 routes × 2 viewports; 0 console errors except the intended 404.

## 4. Proposals

| # | title | impact | effort | confidence |
|---|---|---|---|---|
| P1 | Make card, compare and brief figures agree, and stop attributing defaults to the user | high | M | high |
| P2 | Restyle and simplify the compare dialog | high | S | high |
| P3 | Treat the budget honestly in match results | high | M | medium |
| P4 | Persistent shortlist tray with "Compare" and "Make my brief" | high | M | medium |
| P5 | Only suggest postcodes that exist; add branded not-found and error pages | high | S | high |
| P6 | "Report or hide this home" on property and postcode pages, plus an address deep link | high | M | high |
| P7 | One shared site footer on every subpage | medium | S | high |
| P8 | Quieter Tube overlay at overview zoom | medium | S | medium |
| P9 | WCAG-grade focus ring everywhere | medium | S | high |
| P10 | Mobile home ergonomics: chip overflow cue and a compact intro | medium | S | high |
| P11 | Value-proposition hierarchy on the landing page | medium | S | medium |
| P12 | One shared preview/demo label component | medium | S | high |
| P13 | Neutral naming for lifestyle lenses | medium | S | medium |
| P14 | Fix small evidence-card defects | low | S | high |
| P15 | My-match legend and copy fixes | low | S | high |
| P16 | Clean page titles and brand naming | low | S | high |

### P1. Make card, compare and brief figures agree, and stop attributing defaults to the user
- **Problem:**
  - In one session, a card shows ~£686k while compare shows "440,000 budget fit".
  - A card shows "SW1A 1AA 26 min" while compare shows "Commute · Not published".
  - The brief says "target budget £480,000", "weights you set (weight 3)" and "Schools: primary phase, aiming to shortlist 3", none of which the user entered (`UX/j1e.cjs`, `UX/j5.cjs` outputs).
- **Change:**
  - Feed compare and brief from the same per-area figures as the result card: the same ballpark price, the same commute minutes.
  - Label the affordability value "~£686k vs your £600k limit" instead of a bare "budget fit" number (`lib/matching.ts:154`, `components/area-comparison.tsx`, `components/decision-brief.tsx`).
  - In the brief, print only values the user set. List defaults under "Assumed (you didn't set these)". Drop the schools line when schools were never touched.
- **Improves:** J1 on trust (2→4), learnability and value. Directly targets the protocol's "comprehension of uncertainty" measure and its stop rule.
- **Affects:** matching and comparison libs, brief export format, e2e snapshots of compare and brief, `api/` scoring response if compare reads it. Risk: in fixtures the figures may be inherently different carriers, so the fix needs a contract decision on which figure is canonical.
- **Rating:** impact high · effort M · confidence high.

### P2. Restyle and simplify the compare dialog
- **Problem:**
  - Browser-default "Close" and "Remove" buttons, a striped header cell, and a translucent mobile background that makes text bleed (`UX/shots/j1-compare-d.png`, `j1-compare-m.png`).
  - Internal IDs are exposed ("uk:lsoa:E01000002 · observed · preview-price-2026-06").
  - Six "weight 0 · Not published" rows.
- **Change:**
  - Use the knit secondary button for Close and Remove (`components/area-comparison.tsx:106`), and give the dialog an opaque `--surface` with a dimmed backdrop.
  - Collapse weight-0 factors into "Not in your score (6) ▸".
  - Move carrier and release IDs into a "Sources" disclosure per column.
  - Rewrite the intro line as "Same data and the same priorities for every area. Missing data is never counted as good."
  - Extend `e2e/unstyled-controls.spec.ts` to the compare dialog.
- **Improves:** J1 on visual quality (2→4), clarity, emotional tone and accessibility & mobile.
- **Affects:** comparison CSS, the e2e visual baseline, and the mobile factor-card view (UX-50). Low risk.
- **Rating:** impact high · effort S · confidence high.

### P3. Treat the budget honestly in match results
- **Problem:** with a £600k maximum, every result is £86k–£240k over budget but shows "Fits" and "3 areas meet your must-haves". #1 was the most expensive in one run (`UX/shots/j1-results-d.png`).
- **Change:**
  - When the ballpark is above the maximum, replace the "Fits" badge with "Over budget · ~£240k".
  - Offer a toggle, "Hide areas over my budget", on by default for buyers. Optionally show the size you could afford ("≈ 50 m² for £600k").
  - Header copy: "3 areas · 0 within budget".
- **Improves:** J1 on learnability (2→4), trust and value (defensible shortlist).
- **Affects:** ranking presentation (not the scoring maths unless the toggle filters), the brief "Hard constraints" section, and fixtures/tests for match cards. Trade-off: fewer results in expensive searches, so pair it with "relax budget by 10%".
- **Rating:** impact high · effort M · confidence medium (some of this may be fixture-driven; the badge logic is not).

### P4. Persistent shortlist tray with "Compare" and "Make my brief"
- **Problem:** the decision brief is inside the collapsed "Saved areas & costs" section, and Playwright found the CTA not visible until that was expanded (`components/decision-brief.tsx:99`). The audit P1.1 and P1.3 ask for a visible staged sequence and a persistent tray.
- **Change:**
  - Once one area is ticked, show a sticky tray at the bottom of the results panel or sheet: "2 areas · Compare · Make my brief". The brief is the single stitched primary.
  - Show stage chips "Needs ✓ · Shortlist 2 · Compare · Brief".
  - Move cost inputs into the brief preview as an optional step.
- **Improves:** J1 on task completion (3→4) and value. Supports the adoption measure: use of comparison or brief.
- **Affects:** personal-match panel layout, mobile sheet heights (snap points), DESIGN §1.6 one-primary rule. Needs a visual baseline update.
- **Rating:** impact high · effort M · confidence medium.

### P5. Only suggest postcodes that exist; add branded not-found and error pages
- **Problem:**
  - `lib/postcode-search.ts:157-169` always injects "<postcode>: prices and sales" for any postcode-shaped query, even with zero results (`center: [0,0]`).
  - Enter on "ZZ9 9ZZ" goes to a default Next 404 with no header, no search and no way back.
  - The app has no `not-found.tsx`, `error.tsx` or `loading.tsx`.
- **Change:**
  - Inject the postcode row only when the API or postcode lookup confirms the postcode. Otherwise show inline: "We can't find ZZ9 9ZZ. Check it, or try a street or area name."
  - Add `app/not-found.tsx` using the subpage header, with a search box, "Back to the map" and Guide links. Add `app/error.tsx` with a retry, and a skeleton `loading.tsx` for area and postcode routes.
- **Improves:** J2 on task completion and performance (3→4), J3 robustness. Audit P0.4 search correctness.
- **Affects:** search UX tests; SEO (proper 404 status kept); `/postcode/*` routes in production when a postcode has no sales yet, which needs a separate "no sales yet" state already present on SW1A 1AA. Locally E1 1AA 404s because of fixtures.
- **Rating:** impact high · effort S · confidence high.

### P6. "Report or hide this home" on property and postcode pages, plus an address deep link
- **Problem:** `components/property-profile.tsx:94` and `app/postcode/[code]/page.tsx:129` tell owners to "select it on the map", linking to `/` with no context. The map URL after selecting an address carries no address parameter (`UX/j6.cjs`). This is a legal gate (RELEASE-CHECKLIST lines 128–131).
- **Change:**
  - Add a secondary button "Report or hide this home" on `/property/[uprn]` that opens the same objection form inline, reusing the component from `evidence-panel.tsx`.
  - On postcode pages, link each address row to it.
  - Add `&address=<id>` to map state so "Open on the map" restores the selected home.
- **Improves:** J4 on task completion (2→4), value and learnability. Supports the ICO and LIA readiness items.
- **Affects:** privacy API rate limits (more traffic to the objection endpoint), the privacy notice text ("select it on the map"), e2e for the objection flow, URL state schema and shared links. Risk: abuse, which the existing e-mail confirmation and rate limit mitigate.
- **Rating:** impact high · effort M · confidence high.

### P7. One shared site footer on every subpage
- **Problem:** Privacy and Terms links are missing on area, rankings, tools, guide, glossary, civic and pack pages (`UX/audit-d.jsonl`). RELEASE-CHECKLIST line 124 requires a working footer link.
- **Change:** a `SiteFooter` in the subpage layout with Sources & privacy, Terms, data licences/attribution (OGL, ODbL download), the data mode label, and "Report or hide a home".
- **Improves:** trust in all journeys; legal readiness; J3 and J5 trust.
- **Affects:** all subpages, print CSS for `/pack` (hide or keep), visual baselines. Minimal risk.
- **Rating:** impact medium · effort S · confidence high.

### P8. Quieter Tube overlay at overview zoom
- **Problem:** at zoom 11 the yarn Tube lines and beads dominate the price choropleth and cross area labels (`CAP/shots/home-d.png`, `home-selected-m.png`). This conflicts with DESIGN §1.3 "The map is real" and the owner's "clean snow" taste.
- **Change:**
  - Below zoom 13, render lines at 1.5 px with 45% opacity and no station beads, or make the overlay off by default with a "Tube" toggle in Map settings.
  - Give choropleth labels a snow halo, and keep full yarn styling at street zoom or when "Getting around" is open.
- **Improves:** J3 on visual quality (3→4) and clarity; J2 map readability; J1 rank colours read better.
- **Affects:** MapLibre style contract (`contracts/`), native apps that share the style, rendering snapshots. Trade-off: less "wow" on first paint.
- **Rating:** impact medium · effort S · confidence medium.

### P9. WCAG-grade focus ring everywhere
- **Problem:** `styles/layout.css:99,137,231` use `outline: 3px solid rgb(var(--accent-rgb) / 0.55)`, a translucent yellow of about 1.3:1 on snow, for Find my area, explore chips and layer options (Tab log in `UX/j4.cjs`). DESIGN §7 says "Focus is a visible `--focus` outline".
- **Change:** replace those rules with `var(--focus)` (`#2f5bd3`, or `#7fb8f0` at night) and add a `colour-contrast` unit test asserting that focus-ring contrast is ≥3:1 in both themes.
- **Improves:** accessibility & mobile in J2, J3 and J6 (WCAG 2.4.7, 1.4.11, 2.4.13).
- **Affects:** layout.css only, plus the contrast test. No risk.
- **Rating:** impact medium · effort S · confidence high.

### P10. Mobile home ergonomics: chip overflow cue and a compact intro
- **Problem:** at 390 px the explore chips cut off ("Gy…") with no affordance, and the intro card takes about 30% of the viewport above the map (`CAP/shots/home-m.png`). The audit P2.2 flagged the same pattern for layers.
- **Change:**
  - Add a right-edge fade mask with a "More ›" chip pinned at the end.
  - Make the intro a single-line pill on mobile ("Find my area ›") that can be dismissed, and remember the dismissal in localStorage.
- **Improves:** J3 and J6 on accessibility & mobile and clarity; more map is visible.
- **Affects:** layout.css mobile breakpoints, home e2e snapshots.
- **Rating:** impact medium · effort S · confidence high.

### P11. Value-proposition hierarchy on the landing page
- **Problem:** the page h1 is "Choose an area on the map or search", and the value line is a dismissible card. There is no hint of the three-step flow or the preview status (`UX/audit-d.jsonl`).
- **Change:**
  - Make the hero line the h1.
  - Add a 3-step micro-row under it ("Tell us budget & commute → see matching areas → compare & save a brief").
  - Make "Choose an area…" an h2 in the panel.
  - Add a "What's this map?" (?) next to the legend linking `/guide/reading-the-map`.
- **Improves:** J3 on clarity and learnability (3→4); SEO for "/".
- **Affects:** home layout, accessibility tree tests, metadata. Low risk.
- **Rating:** impact medium · effort S · confidence medium.

### P12. One shared preview/demo label component
- **Problem:**
  - `/postcode/SW1A-1AA`, `/rankings` and `/tools/*` show no demo label while showing fixture-derived figures, or the rankings index claims "official data" (`UX/audit-d.jsonl`; `CAP/text/rankings-d.txt`).
  - On the map the label is 10 px footer text.
  - The protocol's stop rule is "participants treat preview fixtures as official".
- **Change:** a `DataModeBadge` in the shared header of every data page, driven by the same mode/release state (UX-11). It disappears in Real mode. On the map, raise it to 12 px with the (?).
- **Improves:** trust in J2, J3 and J5; protects the validation study.
- **Affects:** all data subpages, real-mode regression tests (UX-02, UX-03).
- **Rating:** impact medium · effort S · confidence high.

### P13. Neutral naming for lifestyle lenses
- **Problem:** "Coffee vs kebab", "Good coffee vs cheap kebab", "Pret vs Greggs" and "Bakeries vs betting shops" are class-coded and name brands (`UX/j3.cjs`). DESIGN §8 says "never cute in data". They risk press or social backlash once public and could imply judgement about the residents of an area.
- **Change:**
  - Rename to describe the data ("Cafés vs takeaways", "Chain vs independent cafés", "Betting shops nearby").
  - Avoid trademarks in labels.
  - Put the definition (which OSM tags) in the lens card's first line.
- **Improves:** J6 on trust and emotional tone; brand safety for going public.
- **Affects:** lens IDs in URLs (`layer=custom:...`), so keep old slugs as aliases. Also guide articles and Claude/MCP tool descriptions if they reuse the names.
- **Rating:** impact medium · effort S · confidence medium.

### P14. Fix small evidence-card defects
- **Problem:**
  - The "Getting around" donut clips "10/10" on mobile.
  - Noise shows a bare italic "unknown".
  - The smallest rendered text is 6.72 px on the mobile area page, and 9 px on the property page (`UX/shots/area-m-top.png`, `UX/audit-m.jsonl`).
- **Change:**
  - Size the donut label with `font-size: clamp()` and `overflow: visible`, or drop the "/10" suffix.
  - Use an empty state of the form "No noise data here yet · Why?" linking `/guide/noise`.
  - Set a minimum of 11 px for any text in charts.
- **Improves:** J2 and J5 on visual quality, performance (empty states) and accessibility & mobile.
- **Affects:** satin and meter components, card snapshots.
- **Rating:** impact low · effort S · confidence high.

### P15. My-match legend and copy fixes
- **Problem:**
  - The legend reads "Your top 50 matches" with black "Not in your top 50" swatches, even when 3 areas are listed.
  - All ranked polygons look the same blue (`UX/shots/j1-results-d.png`).
  - `components/brief/brief-blocks.tsx:130` says "green best" but the ramp is azure.
- **Change:**
  - Legend label "Your top N" with N = min(50, results).
  - Show "not in your top" as a hatched or clear swatch, not black.
  - Give the ranks visibly distinct ramp steps.
  - Fix the brief copy.
- **Improves:** J1 on learnability and clarity.
- **Affects:** `lib/map-legend.ts:28`, `lib/fixtures.ts:119-121`, `lib/palettes.ts:124`, legend snapshot.
- **Rating:** impact low · effort S · confidence high.

### P16. Clean page titles and brand naming
- **Problem:**
  - Titles double the brand: "Glossary · Close Knit · London Close Knit" (`app/glossary/page.tsx:7`, `brief/page.tsx:4`, `claude/page.tsx:12`, `privacy/page.tsx:13`).
  - The UI mixes "close knit", "Close Knit" and "London Close Knit".
  - The 404 title is Next's default.
- **Change:**
  - Drop "· Close Knit" from page titles, because the root template adds the brand.
  - Pick one public name: "Close Knit" with the "London" descriptor.
- **Improves:** search snippets, tab clarity and trust (J3).
- **Affects:** SEO, OG cards, tests asserting titles.
- **Rating:** impact low · effort S · confidence high.

## 5. Not verified or skipped
- Production performance. The dev server timings are not representative, and no Lighthouse or axe run was possible because neither is in `node_modules`. The contrast figure is computed by hand from CSS.
- Objection submission and the e-mail round trip (no SMTP locally; form submission is out of scope).
- Screen-reader testing.
- Night theme.
- Coverage gaps such as Camden, E1 1AA and "3 of top 50" are treated as fixture artefacts.
