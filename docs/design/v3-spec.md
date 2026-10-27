# v3 fixes — spec for canvas artboards (round 1 of user feedback, 2026-10-16)

Canvas: https://claude.ai/artifact/NcG73Hv8e8BAYDZ4JS5fWJ. Write files into
/private/tmp/claude-501/-Users-vadim-project-close-knit--claude-worktrees-server-security-check-0975fd/c3942a69-0b89-4682-9149-3c7c632e4394/scratchpad/canvas/project/
with file tools only. Don't publish, don't edit canvas.json. Read format first (Artifact read paths SKILL.md, artifact-type/reference/format.md).
Look: copy HomeDesktop-v2.dc.html / HomePhone-v2.dc.html in that folder (real Close Knit look, Bricolage, tokens). Very few words; no helper descriptions. Each board: small header "v3 · Fix N · title", a "Today" strip with the user's screenshot where given (img src verbatim), then "After" frames (desktop 1440 wide frame scaled to fit, plus phone 390 where relevant). Interactive where useful (state + onClick).

User screenshots (assets): today empty panel `/_blob/84b534fc498d1cfc5294b2b25b4ed042` (1.webp), today area panel `/_blob/b41eb2de6d658814d4bd63a3132fd967` (2.webp), collision point under a street label `/_blob/015eb9dbee0f78921e173e999510e23b` (3.png).

## Fix 1 — empty side panel (file V3-1-empty-panel.dc.html)
Problem: with no area chosen, the right panel is a mostly empty card ("Choose an area on the map or search · Try an example" + footer links), and the round buttons hang at its left edge over the map; looks odd, wastes space.
After:
- No area chosen: no panel. A small hint chip under the search pill: "Choose an area · Try an example". Sources & privacy · Terms move to the map's attribution corner (ⓘ).
- Round buttons (My match cherry, Layers, Show) sit on the map's right edge (12px in), my-location and +/− bottom-right.
- Area chosen: panel slides in on the right; the round buttons move to the panel's left edge with the same 12px gap (show both states side by side, and a toggle to switch).
- Phone: empty = peek bar only (already PR 2), circles bottom-right above it.

## Fix 2 — Road collisions on top + popup (V3-2-collisions.dc.html)
- Collision dots draw ABOVE street names and labels (today they hide under "…dvale Road").
- Hover (desktop) / tap (phone) on a dot opens a small popup: severity chip (Fatal / Serious / Slight), year, who (Pedestrian · child 0–15 / Cyclist / Driver…), "Dark" if dark, and links: "STATS19 data" (DfT road safety data) — note on the board: police.uk has no page per road collision, so no police.uk deep link; if the record has a police force, show "Met Police" text only.
- Clustered points: popup lists count + "Zoom in".

## Fix 3 — plain map layer (V3-3-plain-map.dc.html)
- Layers list starts with "None" (plain map, no colouring) so Show items like Cycle lanes and collisions stand out. Show the map with None + cycle lanes visible vs. with Price colouring.

## Fix 4+5 — flat Cost group with timeline (V3-4-cost-layers.dc.html)
Today (from user screenshots): Cost › two items, each opens its own nested buttons: Price per m² → Actual · Rank in London · Change (+ "Change over 5 years"), Typical home price → All homes · Flats · Terraced · Semi · Detached. The timeline (Jun 2026, ▶) sits at the top of the whole Layers card.
After: Cost shows everything at once in three rows, no second level:
1. Price per m² · [Actual] [Rank] [Change] — and the timeline (▶ + slider 2006 → 2026) on this row's line below it, because only Price per m² has monthly history (241 months 2006–2026 in the data); Change shows its "over 1 · 5 · 10 years" pills inline.
2. Typical price · [All] [Flats] [Terraced] [Semi] [Detached] — no timeline (one period only); a muted "Latest" tag.
3. (if another Cost item exists later it gets the same row shape)
- One selected button across the whole group (it is the map's single layer).
- Apply the same flat pattern note: any group with ≤ 3 items and ≤ 6 views each is shown flat.

Final reply: files written with w×h, anything uncertain.

## Fix 6 — Layers as a floating menu (V3-6-layers-menu.dc.html) — added later
Today (screenshot `/_blob/8f5d7b171d0567f63d33b7b548603ea7`, 4.png): the Layers card is a full-height panel; picking a group "goes into" it (← Transport) and the card stays tall and mostly empty (Station walk · Top 10, Cycling, EV charging).
After: Layers is a compact FLOATING menu next to the Layers button, height = content (max ~70% of the viewport, then scrolls):
- First row: search field (small).
- Groups are rows (None, Cost, Transport, Crime, Food & drink, Going out, Everyday life, Nature, Homes & area, People, My criteria). A tap EXPANDS the group in place (accordion, one open, chevron), no "← back" step.
- Inside an open group, items are rows/buttons as in Fix 4 (flat rows with their view buttons, Top 10 → on the selected one, timeline only on Price per m²).
- Closes on outside click / Esc; the chosen layer name shows on the Layers button tooltip.
- Phone: same menu as a bottom sheet sized to content.
Make Fix 4's Cost board consistent with this (Cost is one expanded group of this menu).

## Fix 7 — broken selected-layer row (show inside V3-6, no new board needed)
Today (5.png, upload pending): a selected item with no extra views ("Specialty coffee ✓") draws as a pill PLUS an empty light strip under it (the li's selected background wraps an empty "more" block). After: a selected row is one pill (chip fill + check, Top 10 → inside the same pill if any); the light group background appears only when the item really has view buttons/controls below. Show both cases (with and without views) in the Fix 6 board.

## Fix 8 — explain Nature (V3-8-nature.dc.html)
Facts (deploy/migrations/064-nature.sql): the "Nature" layer (metric nature-score) is the mean of three London LSOA percentiles, re-ranked: green share of land (Sentinel-2 summer NDVI ≥ 0.4, 10 m grid), street trees per hectare (GLA public realm trees: council, TfL, Royal Parks; no private gardens), distance to the nearest Local Nature Reserve or SSSI (Natural England; nearer = higher). No score if any part is missing. "Wildlife seen" layers (Hedgehog, Bats, Fox, …) = GBIF open-licence records of birds, mammals, amphibians within 1 km of the area over 5 years; presence only, depends on how much people record.
After:
- Rename the layer "Nature" → "Green & trees" (group stays "Nature").
- The legend's "?" opens a short breakdown: three equal parts with their sources (Green land · Street trees · Nature site nearby), each with this area's percentile when an area is selected.
- Wildlife layers: one muted line under the scale "Seen, not absent" with "?" → records come from people's sightings (GBIF), more where more people look.
Show: the Layers menu row (Nature group open: Green & trees · Wildlife seen [Hedgehog][Bats][Fox]…), the legend with "?" open for Green & trees, and the Wildlife legend line.

## Fix 10 — bug, code only (no board): switching layer re-centres on the selected area
Repro: select an area, pan/zoom away, pick another layer → the map flies back to the selected area. Expected: the camera stays where the user left it; only an explicit select/"Show on map"/search may move it.
Suspects (web/src/components/area-map.tsx): the wider-area outline fit (`fittedWiderArea` is reset to null when the shape is briefly missing during a layer reload, then refits at ~:1199–1206); `fitPendingArea` after each value-pack load (:512) if a pending fit survived; `focusMap` effect on `props.focus` (:267). Fix: fit only on a new selection (id change) or explicit zoomTo nonce, never on a layer/pack reload. Add an e2e: select area → pan → switch layer → center unchanged.

## Fix 9 — street trees and green streets (V3-9-trees.dc.html)
Facts: GLA public realm trees, 1,136,049 trees; size known for most: height 71%, canopy 64%, trunk girth (DBH) 76% (source fields height_m, canopy_m, girth_dbh, age_cat; today our DB keeps only point, species, owner). We have no street line geometry yet (streets are OS Open Names points); OS Open Roads (OGL) would give road links.
After:
1. Show › "Street trees": every tree a green dot, dot size by canopy (unknown size = small hollow dot), visible from zoom ~15; a cluster count below that. Tap/hover → popup: species (common name), height · canopy · girth, age if given, owner (council/TfL/Royal Parks), ♡ not needed.
2. Layers › Nature › "Green streets": street lines coloured from bare (grey) to leafy (deep green) by trees per 100 m and canopy share along the street; legend "Trees per 100 m". Mark on the board: needs OS Open Roads load (data step).
3. Optional "Canopy" (Nature): fine 10 m satellite greenness overlay, shows private gardens too.
Show a street-level desktop crop: Green streets on + Street trees dots + one tree popup open; and the Layers menu Nature group (Green & trees · Green streets · Canopy · Wildlife seen).

## Fix 11 — code only: map header is a full-width bar, the design is a compact pill
Today (6.webp): on the map the top bar spans the whole width (logo + Search left, ≡ far right, empty white in between). Design (canvas Navigation › Home, desktop; HomeDesktop-v2.dc.html): one compact floating pill top-left "≡ · close knit · Search" (≡ inside the pill, left), ♡ N as its own small chip, map visible across the rest of the top; phone: controls in the bottom sheet (HomePhone-v2). Files: web/src/components/explorer-header.tsx + its CSS (styles/layout.css / map css).

## Fix 12 — layer explainer from the legend "?" (V3-12-layer-explainer.dc.html)
Decision (owner): no 5th round button. The legend chip (scale + "?") opens a small panel above it for the CURRENT layer:
- Layer name + one plain line what it measures (e.g. Green & trees: "Green land, street trees and a nature site nearby, as one score").
- How it's counted: 2–4 short bullets with sources and date (for Green & trees: the three parts from Fix 8).
- The scale with two markers: "London average" (▲) and, if an area is selected, "Highbury East" (●) with its value.
- "More in the guide →" link to /guide/<slug>.
- Close ×; Esc closes. Phone: same panel as a small sheet above the legend.
Show it for 3 layers side by side: Price per m² (with average £/m²), Crime (per 1,000), Green & trees (score). Make Fix 8's board point to this as the place where Nature is explained.

## Fix 13 — menu foot (Map view, Colours, links, theme) looks unfinished (V3-13-menu-foot.dc.html)
Today (`/_blob/41f892f18bc5dc9cc9d933f3a1cd0157`, 7.png, night theme): "MAP VIEW" caps heading with tall narrow 2D/3D pills; Colours as a big full-width fold row; a dashed yellow divider; Privacy · Terms · Feedback as large links; Auto/Day/Night as three big boxes pushed right on their own line. Sizes and alignment all differ.
After (one tidy block, both themes):
- Row "Map" — label left, compact segmented control right [2D | 3D].
- Row "Colours" — label left, current palette as a small swatch strip + chevron right (opens the palette list in place).
- Row "Theme" — label left, segmented control right [Auto | Day | Night], same height as 2D/3D (36px), same style.
- Thin rule (no dashed yellow), then one small muted line: Privacy · Terms · Feedback.
- On subpages (no map) only Theme + links show.
Show day and night versions, desktop menu and phone sheet.

## Fix 14 — menu groups (owner decision): no "Homes & schools" group
Homes and schools are different things; school lists already live in Rankings (Top schools). Menu A becomes:
- Find a place: Map, My match, Explore, Boroughs, Rankings
- Homes: Check a home (the Search pill already finds postcodes and addresses, so no "Search…" item)
- Tools: All tools, Stamp duty, Mortgage, Investor
- Learn: Guide, Glossary, AI agents, About, Teams
- (map only) Map: 2D·3D, Colours — per Fix 13; foot: Theme + Privacy · Terms · Feedback
Remove "Top secondary schools" from the menu. Apply to every Menu A instance on the canvas (MenuA-v2, HomeDesktop-v2, HomePhone-v2, SubpageHeader-v2, V3-6 if it shows the menu) and to web/src/lib/site-nav.ts at implementation.

## Fix 15 — Rankings index page (V3-15-rankings.dc.html)
Today (`/_blob/30aeec5a7d87f32ce90e31f703ac1415`, 8.webp, night): huge "London rankings" title, each ranking a full-width tall card holding one underlined link; ~44 rankings in 8 groups → endless scroll.
Real list (web/src/lib/area-pages.ts RANKINGS, groups): Cost 11 (Most/Least expensive areas, Boroughs by £/m², highest/lowest typical flat · terraced · semi · detached prices), Safety 3 (most/least crime areas, boroughs by crime), Schools 8 (most primary/secondary schools, Outstanding primary/secondary, Attainment 8, Progress 8, grade 5+ Eng & maths, areas graded exceptional), Income and housing 5, Getting around 3, Going out 7, Everyday life 7.
After (compact, grouped, attractive, both themes, desktop + phone):
- Small page title "Rankings" + one line; a sticky row of group chips (Cost · Safety · Schools · Income · Getting around · Going out · Everyday life) that jump to sections.
- Each group = a section with a 3-column grid (1 column on phone) of compact tiles (~110 px tall).
- Merge mirror pairs into ONE tile with a toggle: e.g. "Price per m²  [Highest | Lowest]", "Recorded crime [Most | Least]", "Flat prices [Highest | Lowest]" with a small [Flat | Terraced | Semi | Detached] switch instead of 8 tiles; "Income [Highest | Lowest]", "Deprivation [Most | Least]".
- A tile shows: title, level tag (Areas / Boroughs / Schools), and a mini preview of the top 3 (name + value) with a satin mini bar; whole tile clickable → full ranking.
- Borough rankings as a tag on the same tile where a pair exists ("Areas | Boroughs").
Result: Cost becomes ~3 tiles, the whole page fits ~2 screens on desktop.

## Fix 16 — remove /explore (owner decision): duplicate of Layers
/explore and /explore/[lens] show the same custom-criteria lenses the Layers menu already offers. Remove both pages; 308-redirect /explore → /?layer=… (Layers open) and /explore/<lens> → /?layer=custom:<lens> so old links keep working. Remove "Explore" from the ≡ menu (site-nav.ts), sitemap (lib/seo.ts), llms.txt, and any explore links (grep "/explore"); keep lens rankings in Rankings. Canvas: drop "Explore" from every Menu A instance.

## Fix 17 — menu & pages cleanup (owner approved; supersedes Fix 14/16 menu lists) (V3-17-cleanup.dc.html)
Final ≡ menu (10 items):
- Find a place: My match · Rankings · Boroughs
- Tools: Check a home · Stamp duty · Mortgage · Investor   (no "All tools"; no Homes group)
- Learn: Guide · AI agents · About   (Glossary lives inside Guide; Teams is a section of About)
- Map (map only): 2D/3D · Colours (Fix 13 rows)
- Foot: Theme; Privacy · Terms · Feedback only on the map (subpages have them in the page footer)
Removed: Map (logo/"Map →" do it), Search (the pill), Explore (Fix 16), Top schools (Rankings), All tools, Glossary, Teams.
Pages:
- /claude → redirect to /agents (Claude tab).
- Borough rankings (Boroughs by price / crime / income / families / bars) → /area/london becomes one sortable boroughs table (columns: £/m², crime, income, schools, families, going out); Rankings shows one "Boroughs" tile linking there.
- /brief: no own entry; reached only via Compare › Brief.
- /save-listing: the extension saves the home straight into ♡ Saved; the page becomes a short "Saved" confirmation with "Open Saved" and the area link.
- /explore*: removed with redirects (Fix 16).
Board: before/after menu side by side (19 → 10 items), plus mini wireframes of the new /area/london sortable table and the /save-listing confirmation; a small table "page → what happens". Update every Menu A instance (MenuA-v2, HomeDesktop-v2, HomePhone-v2, SubpageHeader-v2) to this final menu.

## Fix 18 — tools pages jump in width (V3-18-tools-width.dc.html)
Today (`/_blob/201958c21913b3756838883ae2ac7e60` buy-to-let, `/_blob/cb32d24dae5be6475e26d96ca0018ca7` mortgage rates, `/_blob/cc23a6b882c22815c59df09e5a50feeb` check a home): switching tool tabs, the whole page (header, Search, tabs) changes width. Cause: web/src/styles/tools.css:35 gives 1120px only to pages that contain .tools-layout; the others fall back to the narrower .methodology width.
After: every tools page (and every subpage) uses the same container width, so header, Search and the tool tabs never move. Also tighten: tool tabs without "All tools" (Tools title links to /tools) and "Calculator" words dropped (Stamp duty · Mortgage rates · Buy-to-let · Check a home); smaller page title (~44px), the "not advice" note as one short muted line with "?" instead of a big box.
Board: three tool pages stacked with identical header/tab positions (show a guide line at the container edges), desktop + phone.

## Fix 19 — My match colours the whole map; list is top 10 with paging (V3-19-my-match.dc.html)
Today (13.webp, night): only the top 50 matches are drawn (small purple zones) and the rest of London is blank; numbered price pins 1–6 crowd the east; legend "Your top 50 matches" (web/src/lib/map-legend.ts:35).
After:
- Every area is coloured by its fit on the match ramp (match-0 pale → match-100 strong azure, tokens). Areas that break a hard limit (over budget, outside a drawn zone) are shown faint grey with a small "over budget" hatch, not hidden.
- Legend: "Fit · low → high" + "?".
- The My match list shows the top 10 with rank, name, fit /10 and typical price; below it "11–20 ›" paging (and ‹ back), or "Show 10 more". Map pins (numbered) only for the 10 rows on the current page; hovering a row highlights its area.
- Phone: same list in the sheet, paging at the bottom.
Implementation note: check whether the match job already scores every LSOA (MatchPack) and only the client cuts to 50; if the API returns only the top N, return all scores (compact) for the map colouring.

## Fix 20 — My match "ruled out / relaxed" block is broken (V3-20-relaxed.dc.html)
Today (14.png, night; blob id in the message): "0 areas ruled out ?" then a wall of sentences: "Relaxed: place:any-park — the original evidence above still applies. [Restore]" with RAW ids (place:any-park, place:a-top-50-primary-s), native grey unstyled Restore buttons, and a long list "Now included: Plashet East · E12 — A top-50 primary school: about 18 min, over your 15" repeated for every area.
After (compact, plain words, tokens, both themes):
- Header "Relaxed to show more areas" + count.
- One row per relaxed rule as a chip with a friendly name: "Park nearby", "Top-50 primary ≤ 15 min", "Crime fit ≥ 50", each with a small ghost "Restore" button (design-system secondary button, 32px).
- "Now included · 12" folded by default; open = compact rows: area name · postcode district, and a short muted reason tag ("school 18 min", "crime 46"), max 5 then "Show all".
- Drop the repeated "the original evidence above still applies" text; one "?" explains it.
- If nothing was ruled out and nothing relaxed, the block is hidden (no "0 areas ruled out").

## Fix 21 — custom criterion panel repeats the legend (add as a small section on the V3-12 board)
Today (15.png legend 9 steps "0 … 9+", 16.png panel "Gyms and sports centres"): the side panel repeats the same scale as the legend (and with 5 steps, so they even disagree), and shows raw "OpenStreetMap tags: … leisure=fitness_centre/sports_centre".
After: the panel has no scale (the legend is the one scale, one step count); the OSM tags move into the legend "?" explainer (Fix 12) as "Counted from OpenStreetMap: gyms, sports centres"; panel keeps title, ← Back to My match, "Add to my match", "Share". Code: web/src/components/match/criterion-focus.tsx.

## Fix 22 — one entry per feature (owner approved) (V3-22-duplicates.dc.html)
Remove UI duplicates found in code:
1. Compare: keep /compare + "Compare · N" tray (PR 6); remove the old comparison dialog in the My match panel (components/area-comparison.tsx, personal-match-panel.tsx).
2. Brief: only Compare › Brief → /brief; remove the in-map brief dialog (components/match/brief-dialog.tsx).
3. Save: only ♡ on the area card; remove the text "Save" button (components/area-save-actions.tsx).
4. Similar areas: one "Like this" item in What's next › Nearby (and on the map card); remove "Find areas like this" duplicates (area-save-actions, preference-panel, similar-areas, ranking-view) and the extra "Similar areas" links.
5. Feedback: per-figure "Report" (PR 4) + /feedback from the menu only; remove 👍/👎 "Looks wrong" quick vote (components/quick-vote.tsx) and the global feedback prompt (components/feedback-prompt.tsx in app/layout.tsx).
6. Privacy · Terms: on the map only via ⓘ attribution + menu foot; remove from the area panel footer (components/map-dock.tsx). Subpages keep the page footer.
7. Returning visitor: remove the "Welcome back" card (components/first-visit-intro.tsx); ♡ N is the reminder.
8. Help: one "?" in the legend (Fix 12); remove the Layers card help link and the panel's "About this data" fold (move its content into the legend explainer; "Report" stays at figures).
Board: a grid of 8 small before → after pairs (one feature per row: "Today: 3 entries" → "After: 1"), plus the resulting map area card (♡, Watch, Compare, Like this, Open full page) desktop + phone.

## Fix 23 — school hover popup on the map (V3-23-school-popup.dc.html)
Show › Schools dots: on hover (desktop) / tap (phone) a small popup:
- School name (bold) + small "›" to its page.
- Ofsted as an ICON only (no words): 4 shapes/colours for the legacy single-word grade (Outstanding ★, Good ●, Requires improvement ◐, Inadequate ○) with aria-label/tooltip text; schools under the new report-card framework (no single grade) show a small "report card" icon instead. Data: school.attributes.observations kind "inspection-legacy" (value Outstanding/Good/…), attributes.reportCard.
- Up to 3 tags, most useful for parents first: "Top 10%" (school_national_rank.top_percent ≤ 10; also Top 5% / Top 25%), phase "Primary"/"Secondary"/"All-through", "Grammar" (attributes.selectivity = Selective), faith ("Catholic", "C of E"…, attributes.faith), "Sixth form" (attributes.sixthForm), "Girls"/"Boys" if single-sex (if in data). All are state schools (no independent schools in the data) — so no State/Private tag; note it on the board.
- Popup never covers the dot; one popup at a time; keyboard focus shows it too.
Show 4 example popups (top primary, grammar, faith secondary, new report-card school) + map crop desktop and phone.
Also: V3-15 must show ONE "Boroughs" tile linking to /area/london (Fix 17), not borough toggles on tiles — fix it.

## Fix 24 — Road collisions filters: "All" / "None" (add to V3-2 board)
The collisions panel (web/src/components/collision-panel.tsx) has many tick boxes (severity, road user, age, dark…) and no quick way to tick or clear them. Add two small text buttons at the top of each filter group, same as Crime's "Show all / Clear all": "All" · "None". "None" leaves the map without dots and shows a hint "Pick at least one".

## Fix 25 — single-sex school with a mixed sixth form (code; tag shown in V3-23)
Example /school/136551 Newstead Wood School: GIAS gender "Girls" (school_profile), census 2024/25 boys 9.11% of 1,347 pupils (rising 6.4 → 7.8 → 9.1), "Has a sixth form". The census counts Year 12–13; boys join the sixth form.
Rule: gender Girls/Boys + has sixth form + other-sex share > 0 → label "Girls · mixed sixth form" (or Boys …); the girls/boys percentages get the caption "all pupils, incl. sixth form". Same tag in the map school popup (Fix 23). Code: api/area_api/school_card.py (profile), web/src/lib/school-card.ts, components/school/school-card.tsx.

## Fix 26 — school card "Destinations · 2023/24 leavers" looks clickable but is not
It is a static section heading (web/src/components/school/school-card.tsx Section, SECTION_ICON destinations: "arrow-out"); the ↗ glyph reads as an external link. Fix: a non-link icon (graduation cap / fork), audit the other section icons; if the owner wants it to expand, make it a real <details> fold with ˅ like sc-more. Owner decision: icon change only (no fold).

## Fix 27 — area page: 5 layout variants (owner picks one)
Today /area/lsoa/E01000757 (Crofton · BR6) is one long scroll of 11 always-open sections (web/src/components/area-full-page.tsx: overview, price, getting-around, safety, schools, local-places, environment, health, homes, people, living-costs), each with a ratings row, chart, rows and ⓘ notes, plus action buttons (Open on map · Save · Watch · Compare · Find similar), tabs and What's next. Owner: "impossible to read". Goal: answer "is this area for me?" in 5 seconds, details on demand.
Real data to use (rel-202610161805):
- Price: resale £6,524/m² (44 sales, 36 mo), 1y −0.3%, 3y −1.4%, 5y +4.4%, 10y +36.2%; trend 2016 £4,560 → 2026-06 £6,210/m²; 5 sales in 12 mo of 279 homes (1.8% turnover), 0% leasehold. No per-home valuation (memory rule): show £/m² and a band, never "£587k".
- Safety: 19.8 crimes / 1,000 residents, 12 mo to 2026-08; London percentile 2 (safer than 98%).
- Getting around: Orpington 13 min walk (zone 6, Southeastern, Thameslink); Petts Wood 28 min; Chelsfield 33 min; connectivity 3/10.
- Green: Darrick & Newstead Woods LNR, 1 min walk.
- Schools within 1.5 km: 8 (6 primary, 2 secondary). Newstead Wood (secondary, Outstanding, 164 m), Tubbenden Primary (Good, 389 m), Darrick Wood Infant (Outstanding, 1.1 km), Warren Road Primary (Outstanding, 1.4 km).
- Quiet: 8.2% of homes over 55 dB (road), 0.4% over 65; road median 49.9 dB; no rail.
- Health: cool summer nights (16.1 °C, London pct 5.5); no GP within 1 km (nearest 1.3 km).
- Location: inside ULEZ, outside C-charge, no conservation area; 12 planning applications in 2 yrs (London median 18).
Variants (one board each, desktop 1440 + phone 390, same data, terse labels, Close Knit DS):
A "Verdict + tiles": header with name, borough, 1-line verdict chips (Very safe · Top schools · Quiet · 13 min to rail); 8 rating tiles x/10 with trend arrows in a 4×2 grid; tap a tile → that section opens in a side drawer (desktop) / sheet (phone). No long scroll.
B "Scorecard vs London": one horizontal bar per topic (Safety, Schools, Price, Transport, Green, Quiet, Health, Homes) showing this area's dot on a London 0–100 strip with the London median tick; rows expand inline for numbers + source. Like a report card.
C "Sticky index + story": left sticky rail with section icons + ratings; right column short sections, each = headline number + one chart + 3 rows; ⓘ method folded. Phone: chip rail sticky on top. (Closest to today, but each section capped at one screen.)
D "Map + facts": split view — map of the area left (station, park, schools as dots, 13-min walk line), facts panel right in 3 groups Live · Learn · Move; phone: map on top 40%, sheet below.
E "Bento": a grid of differently sized cards — big Price card with the 10-year sparkline, Safety gauge, Schools list (top 3 with Ofsted icons), Transport card with walk minutes, Green card, Quiet card, small Health/Location cards; "More data" link at the bottom opens the evidence pack.
Each board: a small caption "Good for / Cost" (2 lines) to help the owner choose. Keep actions in one row: ♡ · Compare · On map · ⋯ (Watch, Find similar in ⋯).

## Fix 28 — area page: one sticky tab bar, not two
Today two bars: AreaPageTabs (entity-nav.tsx: Overview · Homes · Schools · Places · Evidence pack; rendered in area-full-page.tsx:188, places/page.tsx:50, pack/page.tsx:62) and the sticky section chips SectionTabs (area-full-page.tsx:443, AREA_CARDS). Homes and Schools appear in both; Overview is a link to itself. Owner likes the sticky chips under the header and wants the duplicate bar gone.
After: remove AreaPageTabs. Keep one sticky chip bar (SectionTabs) stuck under the site header. Chip active on scroll (scroll-spy) and the section lands just under the bar (scroll-margin = header + bar). Phone: horizontal scroll with the active chip kept in view.
Places: the "Local places" section ends with "All places →" (/area/…/places). Evidence pack: in ⋯ of the actions row + footer of the page. /places and /pack get Breadcrumbs only plus "← Crofton".
Tests: e2e that expect area-page-tabs (grep area-page-tab) move to section chips.
Apply to all Fix 27 variants: where a variant has sections, it uses this one sticky bar.

## Fix 29 — People section: readable charts (board V3-29-people)
Today (screenshot images/18, blob /_blob/078c3d12b48cc740e8d577ef8a27afa4; web/src/components/people-section.tsx): per topic two stacked bars (area, London) with gaps; segments start at different x so area vs London can't be compared; each row reuses the same 5 colours for different categories; legend shows only the top 3 in another order; hatching is noisy; "London" label only at the row end; ages sorted by size, not in order; facts read badly ("Less deprived than 100% of London areas", "50% less than the London average").
After: one row per category, not stacked.
- Each row: label · bar of this area (one yarn colour per topic, satin stitch, calm) · a thin London tick on the same scale · "39%" · difference chip "+14" / "−14" vs London (only when |diff| ≥ 5 pts, else nothing).
- Show the top 4 by share; the rest fold into "Other n%"; "Show all categories" opens the full list per topic.
- Ordinal topics keep natural order: Age 0–14 · 15–24 · 25–44 · 45–64 · 65+.
- One legend for the whole section: "▮ Crofton  │ London".
- Lead line per topic in plain words from the largest gap: "Older than London: 28% are 65+ (London 12%)".
- Facts row: "2,898 people / km² · half London's density" · "603 households" · "Deprivation: among London's least deprived 10%" (decile wording, never "100%"). Since 2026-10-17 the same words at the 10% ends are also a standouts tag (see Final review decisions).
- Religion: descriptive only, same layout, no lead line (guardrail).
Real data (ONS Census 2021, Crofton E01000757 vs London):
Household: Couple with children 39.0 (24.6) · Couple, no children 35.7 (18.5) · One person 15.8 (29.3) · Lone parent 6.5 (13.3) · Other incl. shared 3.1 (14.4).
Age: 0–14 16.1 (18.1) · 15–24 10.9 (12.3) · 25–44 15.8 (34.1) · 45–64 29.2 (23.7) · 65+ 28.0 (11.9).
Ethnic group: White British 79.0 (36.8) · Other White 4.3 (14.7) · Indian 4.0 (7.5) · rest see people757.txt.
Country of birth: UK 86.3 (59.4) · Middle East & Asia 6.0 (13.0) · Africa 3.2 (7.1) · EU before 2004 1.8 (6.6) · Americas & Caribbean 1.3 (4.2).
Religion: Christian 54.6 (40.7) · No religion 31.5 (27.1) · Chose not to answer 6.4 (7.0) · Hindu 5.2 (5.1) · Muslim 1.3 (15.0).
Board: Today (screenshot) | After desktop | After phone 390. Same row pattern should be reusable for Homes (tenure, accommodation) and Work (qualification, occupation).

## Fix 30 — My match: any layer as a range criterion, live on the map (board V3-30-match-ranges)
Today (screenshot images/19; web/src/components/match/your-search.tsx, my-criteria.tsx; api/area_api/matching.py): few fixed criteria as chips (Buy · up to £1.2m, 3-bed, Lower price per m², Safer streets (must), Quiet streets); places block with native grey selects (80 min · by bike · Very important · Weekday morning), a lone "Must" checkbox misaligned, big "Remove" link, "Done · Priorities · Share" pills read as equal buttons.
After:
1. "+ Add criterion" lists every map layer (same list and groups as Layers). The layer now on the map is offered first: "Use Crime as a filter".
2. Each criterion is one compact card: name · histogram of all London areas (small, the layer's own colours) · two-handle range slider on it · value labels "≤ 25 crimes / 1,000" · toggle [Must | Nice] · ✕.
   - The histogram shows where London's areas sit, so the user sees how much they cut.
   - Live count under the slider: "1,840 of 4,994 areas left".
3. Must: while dragging, areas outside the range disappear from the map (grey, no fill) in real time; match list updates on release. 0 left → "No areas left — widen Crime" with the handle highlighted.
4. Nice (recommended behaviour): soft range. Inside = full score; outside the score falls off smoothly the further away (a fade zone shown on the slider as a lighter band beyond each handle). On the map outside areas fade (lower opacity) rather than vanish, so "almost" areas stay visible. Importance (● ● ● ○ ○, 1–5 dots instead of a select) sets how strongly it counts and how fast it fades. Same engine idea as minimumUtility/weights in matching.py.
5. Map while editing: My match colours the whole map by score (Fix 19); must-cut areas are hidden, nice-miss areas faded.
6. Places reuse the same card: "King's Cross · ≤ 40 min · 🚲 · Weekday 8am" as one line of chips (tap to edit), Must/Nice toggle, importance dots. No native selects.
7. Header: "Your search" with one primary "See matches" and quiet icon buttons Share ↗, Reset; budget/bedrooms stay as the first two chips.
Board: Today | After desktop panel + map (crime slider being dragged, Must, areas disappearing) | After Nice state (faded areas, fade band on slider) | Phone sheet.

## Fix 31 — school map icons (board V3-31-school-icons; extends Fix 23)
Owner comment on V3-23: a set of school icons for the map that tell apart primary/secondary, state/private, Ofsted rating and a "Top 10" badge.
Encoding (one icon = 4 facts, readable at 20–28 px):
- Shape = phase: Primary circle · Secondary rounded square · All-through hexagon (16+ only → square with "6").
- Fill/ring = funding: State solid yarn fill · Private (independent) hollow ring with a thin double outline (no Ofsted; ISI inspected → no rating mark). NB: our data today holds only state schools (2,258); private needs a GIAS independent import first — mark it "needs data".
- Inner mark = Ofsted: ★ Outstanding · ● Good · ◐ Requires improvement · ○ Inadequate · ▣ new report card (2025+) · blank Not yet inspected.
- Badge top-right = rank: small ribbon "10" (Top 10%), "25" (Top 25%) only at zoom ≥ 14; Top 5% gets "5" gold-thread ribbon. From school_national_rank.top_percent.
- Selectivity/faith never on the icon (popup tags only, Fix 23).
Zoom: ≤ 12 plain Dot by phase colour; 13 shape + Ofsted mark; ≥ 14 + badge; hover → Fix 23 popup.
Board: full matrix (phase × funding × Ofsted) + badge variants, at 24 px and 48 px, Day and Night; a map crop with ~12 icons around Crofton (Newstead Wood: secondary, state, ★, Top 10 badge; Tubbenden: primary, ●; Darrick Wood Infant: primary ★); a legend chip for Show › Schools.

## Fix 27G — area page: tags for what stands out + fixed standard tiles (board V3-27g-area-tags)
Owner: pros/cons as small tags; tiles stay a fixed standard set.
Header: name · borough · one-line verdict. Under it a row of small tags (≤ 3 green pros, ≤ 2 amber cons), each tappable → scrolls to its section:
- Picked automatically by London extremes (pro = top 10% of London, con = bottom 10%); ties → topic order Price, Safety, Schools, Transport, Green…
- With a My match profile the user's criteria go first ("Fails: King's Cross 52 min" amber, "Within budget" green) — second state on the board, marked illustrative.
- Crofton real: + Safer than 98% of London · + Outstanding school 164 m · + Nature reserve 1 min · − 13 min walk to rail, zone 6 · − No GP within 1 km.
- People never produce tags (descriptive only).
Tiles: the same 12 on every area, same order, so pages compare at a glance (4×3 desktop; phone 2 columns, first 6 + "Show all 12"): Price · Safety · Schools · Station walk · Cycling · Noise · Nature · Air · GP · Food hygiene · Nightlife · Families. Each tile = 27F style (title + value + arrow, mini London strip). Tiles without data show "—" and stay in place.
Then sticky chips (Fix 28) and sections with all 40 layers as one-line rows in the 9 Layers groups.
27G additions (after Area360 review, images/20 + area360.txt): Income and Social housing are never tiles or tags (descriptive, who-lives-there; since 2026-10-18 they rank, see Final review decisions, but still never tag); Deprivation was released from this rule on 2026-10-17 (see Final review decisions) and is never a tile but may be a tag — they stay as neutral rows in the Homes & area section, no green/red. No per-home price anywhere: £/m², area band, trend only.

## Fix 32 — backlog from Area360 review (not drawn yet)
Area360 = home-first Rightmove/Zoopla extension; area block only crime, deprivation, income, social housing. Candidates for us:
1. School catchment info: link/area on school card and popup (council data, licence check first).
2. Days on market vs area average — area level, from sales/listing data we may lawfully hold (check source before building).
3. Commute from the area page: "To work" row using get_commute / pinned place (TfL) — we have the API, no button.
4. Location finder on any page (they detect addresses on any site) — our equivalent is the AI connector; consider later.
Not taking: per-home valuation (memory rule), listing price-change tracking (needs portal data).

## Fix 33 — area page sections in detail + tailoring (boards V3-33a…d)
Owner (comment on 27G): go through every section, decide what to show; tailor to the user, e.g. prices for terraced if they chose terraced; 3 types → 3 numbers or 3 small charts.
Tailoring source: one page-level chip under the tags "Tailored to: Buy ≤ £1.2m · 3-bed · Terraced, Semi, Detached · King's Cross ✎" (today's TailorChip). Without a profile: "Tailor this page" chip; sections show defaults.
Profile change needed: propertyType today is house | flat | any (api/area_api/matching.py:79, web/src/lib/contracts.ts:417). Add house subtypes terraced | semi | detached as a multi-select; matching treats any subtype as house until it learns subtypes. Optional "Moving with: kids under 5 · school-age" for the Schools section.
Every section = same frame: title row (icon · name · headline number · London chip · "On map ↗") → one chart → ≤ 5 rows → "ⓘ Sources" fold. Max one screen.
Real Crofton data (prod API 2026-10-16) noted per section.

1. Price (V3-33a, desktop + phone, two states)
- Data: market-by-type (12 mo to 2026-07, basis widened to MSOA Bromley 031, min 10 sales): Detached £836k (26 sales, p25–p75 £766k–£948k) · Semi £615k (22, £535k–£740k) · Terraced £474k (17, £430k–£520k) · Flat £325k (5 — too few, show "few sales"); all homes £628k (70). Yearly trend per type, 10 y. £/m² (LSOA) £6,524, 10 y monthly. typical-price-{type} has a London percentile (single period).
- Tailored (Terraced+Semi+Detached): 3 numbers side by side (median, sales n, p25–p75 band bar) — the user's types only; one chart with 3 lines (yarn colours per type) over 10 y; budget fit row "≤ £1.2m buys: Terraced ✓ all · Semi ✓ most · Detached ✓ most" from p25–p95 vs budget. Note "Sales in the wider Bromley 031 area".
- Default: 4 small numbers (Flat · Terraced · Semi · Detached) + all-homes line.
- Rows: £/m² + London chip · 1 y / 5 y change · sales & turnover (5 of 279 homes, 1.8%) · leasehold 0% · new-build share. "Recent sales →" (Homes tab). No per-home valuation.
2. Safety: headline 19.8 / 1,000 · safer than 98%; 3-year monthly line vs London; top 5 offence categories as Fix 29-style rows with London tick (data: metric_value_breakdown per month). Tailored "kids": road casualties within 500 m (9 in 5 y, 3 children) row.
3. Getting around: walk to Orpington 13 min · zone 6 · Southeastern, Thameslink; other stations rows; tailored: "King's Cross 52 min · 1 change" per pinned place (get_commute, TfL); cycle lanes km + percentile.
4. Schools: headline "8 state schools ≤ 1.5 km · 3 Outstanding"; Primary | Secondary toggle (tailored by kids' age); top 5 rows with Fix 31 icons, distance, Top badge; nurseries row for under-5 (2 good-rated within 1 km); catchment note later (Fix 32).
5. Local places: rows per group (Food & drink, Going out, Everyday) "n within 10 min · vs London tick"; nearest essentials (supermarket, pharmacy, GP, gym, pool) with walk minutes; food hygiene % 4–5; tailored: your pinned places.
6. Green & quiet: Darrick & Newstead Woods LNR 1 min; nature score strip; trees/ha; wildlife seen (Seen, not absent); noise ≥55 dB 8.2% strip; flood bands (rivers/sea, surface water).
7. Health: air NO₂ / PM2.5 (null for Crofton → "—"), summer-night heat (cool, pct 5.5), GP: none within 1 km, nearest 1.3 km. Strips only.
8. Homes (descriptive, no colours): accommodation mix + tenure (Fix 29 rows; tailored: highlight the user's type "Terraced: n% of homes"); extending: conservation 0%, Article 4 not published (Bromley), 1 listed building; gigabit broadband 100% (London 91%); settled 94% (London 87%); planning: 12 applications in 2 y (London median 18).
9. People: Fix 29.
10. Living costs: council tax 2026-27 Bromley bands A–H as a small bar, typical band for the user's type highlighted (illustrative until a band-by-type source exists); ULEZ inside, C-charge outside; renting: borough average rent for their bedrooms (ONS) + 30× income note.
Boards: V3-33a Price (2 states, desktop + phone) · V3-33b Safety + Getting around + Schools · V3-33c Local places + Green & quiet + Health · V3-33d Homes + Living costs (+ People link to V3-29). Desktop 1440 section column ~880 px; each section drawn tailored, with a small "default" inset where it differs.
Fix 33 rule (owner, SEO): the page is server-rendered complete for everyone and crawlers — all property types, all sections, all numbers. Tailoring is a client-side layer that only reorders and highlights (the user's types first and bold, others dimmed but present; budget-fit and commute rows added), never hides data. No profile = the full default page.

## Fix 30b — My match: one model, soft edges instead of Must/Nice (board V3-30b-match-soft-edges)
Owner: is Must/Nice needed if Nice with zero tolerance = Must? Answer: yes with a multiplicative score.
Model: each criterion → utility u ∈ [0,1]: inside range 1; across the soft edge falls linearly to 0; beyond 0. Score = weighted geometric mean Π u_i^(w_i/Σw), w = importance dots 1–5. Any u = 0 → score 0 → area grey (out). Soft edge width 0 = strict.
UI per criterion card: name · histogram · slider with 2 range handles + 2 soft-edge handles (lighter band) · one "Must" pill = preset that snaps edges to 0 (lit when edges are 0; dragging an edge out turns it off) · importance dots · "−n areas" impact · ✕. One card expanded; others collapse to chips "Crime ≤ 25 · Must · −3,150".
Map: grey = score 0 (fails a strict range or beyond an edge); others shaded by score; top 10 outlined + numbered. Legend "Score 0–100 · grey = out".
Frames: (1) one criterion Crime strict ("Must" lit) — pass/grey, count 1,840 of 4,994; (2) + Price/m² ≤ £7k with soft edge to £8k, ●●● — shades appear, near-miss areas paler; (3) + Station walk ≤ 10 min strict — fewer areas, chips collapsed, hint "Station walk cuts most — soften it"; (4) area tap popup ✓ Crime 12 · ≈ Price £7.4k (on the edge, 60%) · ✗ Walk 14 min; (5) phone sheet. Small side note comparing to V3-30 (Must/Nice toggle).
Fix 30 superseded by Fix 30b (owner, 2026-10-16); 27A–F archived, 27G is the area-page direction.

## Final review decisions (owner delegated, 2026-10-17)
Charts on the area page (owner: "no meaningless charts"):
1. 33c Nearest essentials: list, no bars. 2. 33b station walk: rows (time · zone · lines), no bars. 3. 33b schools distance scale: removed; distance stays in each row. 4. 33d council tax: one row "Band D £2,140 · A £1,427 … H £4,280" + the user's typical band chip; no bar chart (band ratios are fixed by law).
5. 33b crime line: shown only when the 3-year change is ≥ 15% either way; otherwise a row "Stable over 3 years". Crofton → row.
6–7. Section strips that repeat the top tiles (noise, nature, summer nights) are removed; sections show numbers + London words ("8.2% · London 30%").
8. 33a default price chart: one "All homes" line + 4 numbers above; per-type lines only for the user's chosen types (tailored).
Keep: price p25–p75 band bars, tailored per-type lines, crime categories with London tick, People/Homes rows with London tick, the 12 tile strips, My match histograms.
27G tiles: keep the fixed 12. Every tile exists as a London-wide layer, so "—" on the board was missing fetches, not missing data; draw illustrative values (marked). Only Air is truly empty for Crofton (modelled value null) → "No data here".
Deprivation released (owner, 2026-10-17: "remove the rule that deprivation is never ranked"): the official Index of Multiple Deprivation (metric `deprivation`) behaves like any area metric. It is ranked (/rankings "Least deprived areas" first, then "Most deprived areas", under Homes & area; the map layer's "Top 10 →"; the agent tool rank_areas_by_metric), it is a My match range criterion (+ Add criterion) beside the wizard's "Less deprivation", and it may make a standouts tag ("Among London's least deprived 10%" / "Among London's most deprived 10%", leading to People) and an Overview headline badge. The 12 fixed tiles stay as they are. Income and social housing kept their never-ranked rule until 2026-10-18 (next entry); the Census, religion included, stays descriptive only.
Income and social renting released (owner, 2026-10-18: remove the never-ranked rule for income and social renting, as for deprivation): household income (metric `income`) and social renting (metric `social-renting`, Tenure's Social rent view) behave like any area metric. They are ranked (/rankings under Homes & area: "Areas with the highest household income" first, then "…lowest…", one Household income [Highest | Lowest] tile; "Areas with the most social renting", then "…least…", one Social renting [Most | Least] tile; the map layer's "Top 10 →", Tenure › Social rent included; the boroughs table sorts by Income, and /rankings/borough-income opens it so sorted; the agent tool rank_areas_by_metric), and they are My match range criteria (+ Add criterion: "Income" in £ a year, "Social rent" in % of households; a new range keeps the higher end). Wording stays neutral ("Higher household income", "More social renting"): no colour, word or tag calls either end better. Unlike deprivation they make no standouts tag or Overview badge (a pro or con would judge them), they are not wizard factors (RETIRED_FACTOR_IDS stays) and Find similar does not compare them. The Census, religion included, stays descriptive only.
