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
- Facts row: "2,898 people / km² · half London's density" · "603 households" · "Deprivation: among London's least deprived 10%" (decile wording, never "100%").
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
27G additions (after Area360 review, images/20 + area360.txt): Income, Deprivation and Social housing are never tiles or tags (descriptive, who-lives-there) — they stay as neutral rows in the Homes & area section, no green/red. No per-home price anywhere: £/m², area band, trend only.

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

## v4 Task 1 (was Fix 34) — school map icons v2: 5 variants (board V4-01-school-icons; supersedes the zoom rules of Fix 31)
Owner, after seeing prod on a phone (blobs f6bc4dca55d9016b182277ab3009d23f zoom ~12 dense West London, 473ff88f344baefd26a708d1bafe0f7e zoom ~14, a5a1bce6e6dc2ae8739aaba54e89770f zoom ~16):
- Icons must NOT change with zoom: every marker always shows the full information.
- Today's details are invisible: the Ofsted badge is an ~8 px dot, the rank ribbon ~10 px, the tassel "!" reads as noise; the yellow cap has weak contrast on the light map; at zoom 12 hundreds of caps pile up into confetti.
Information each marker must carry: phase (primary / secondary / all-through), state vs private, Ofsted (Outstanding / Good / Requires improvement / Inadequate / report card / not inspected), London rank (Top 5 / 10 / 25 %).
Draw 5 different directions, each judged on: readable at 390 px phone, at zoom 12 (dense), 14 and 16, Day and Night; no zoom-dependent glyph changes (only density handling may vary); tap target ≥ 32 px; works for colour-blind (Ofsted not by colour alone).
A "Ofsted pin": a 30 px map pin whose fill is the Ofsted colour (green ★ / blue ● / amber ◐ / red ○ / grey ▣) with a white cap glyph; phase by a letter on the pin tail (P / S / A); private = white pin with a dark outline; rank = a gold/violet/sky number chip "5" / "10" / "25" on the top-right, 14 px, with a halo.
B "Info chip": a horizontal pill like the My match price pills: [cap] [★] [Top 5]; primary/secondary as P / S text; private shows "Private" instead of Ofsted. Dense zoom: lower-ranked chips yield by collision (symbol-sort-key = rank), hidden ones become 6 px dots so nothing vanishes.
C "Shape + colour": phase by shape (circle primary, rounded square secondary, hexagon all-through), fill = Ofsted colour, white cap glyph, rank as a thick gold/violet/sky outer ring; private = outline-only shape.
D "Big badge, no cap": the cap is dropped on the map (it is only the legend chip): a 26 px disc with the Ofsted symbol large in the centre, phase as a small outside tab, rank as a number in a corner notch. Maximum legibility.
E "Filter first": the marker is the A pin, but density is solved with quick filter chips over the map when Schools is on (Primary · Secondary · Outstanding · Top 10% · Private) and counts in clusters at zoom ≤ 12 ("24" bubble coloured by its best Ofsted); individual markers always full.
Board layout: one row per variant: anatomy (marker at 2× with callouts) · phone crop zoom 12 · phone crop zoom 14 · phone crop zoom 16 · Night sample · legend chip. Top of board: the three owner screenshots as "Today". Use the real schools around South Kensington / Chelsea from the screenshots where possible (positions illustrative). Bottom: a short comparison table (legibility, density, effort) and my recommendation.

## v4 Task 2 (was Fix 35) — phone: which layer is on? 5 variants (board V4-02-layer-indicator)
Owner: on a phone it is not always clear which layer is selected. Evidence (same blobs as Fix 34): the legend reads "Wildlif…" (name cut to 8 chars), the view caption "Seen, not absent" wraps to three lines, the scale "No record … Often" has no unit, and the "?" is the only way to learn more. The layer's view (e.g. Hedgehog) is not shown at all.
Requirement: at 390 px, within one glance, the user sees the layer name in full (with its view, e.g. "Wildlife seen · Hedgehog"), what the colours mean, and how to switch. No truncated names. Works Day and Night; nothing covers the thumb zone more than today.
A "Two-row legend": the legend card gets a title row with the full name + view (wraps to 2 lines max, never ellipsis) and the scale row below; the "?" sits in the title row; ⓘ credits move into the menu foot.
B "Layer pill under search": a chip under the top pill "▤ Wildlife seen · Hedgehog ▾"; tap opens Layers at that item; the legend keeps only the scale and "?".
C "Labelled Layers button": the round Layers button on the right stack becomes a pill with the layer's icon + short name ("🦔 Hedgehog"); legend scale only.
D "Sheet title": the bottom sheet's peek row shows "Wildlife seen · Hedgehog ▾" as its title (tap = switch layer), with "Choose an area" as a secondary action in the same row; the floating legend becomes a thin scale strip above the sheet.
E "Announce + compact": on every layer change a 2 s toast "Now showing: Hedgehog sightings" over the map; the legend is compact (icon + scale) and tapping it expands to the full name, scale and explainer.
Board layout: Today (owner screenshot crop of the legend) on top; one row per variant: phone 390 frames for Wildlife·Hedgehog, Price per m²·Change, and a long name (e.g. "Independent vs chain cafés"), plus one Night frame; bottom: comparison (glance clarity, thumb zone, screen cost) and a recommendation. Desktop unchanged unless a variant needs it (then one small desktop note).

## v4 Task 3 — Street trees as a heat map, not count bubbles (board V4-03-street-trees-heat)
Owner (blob 6ac646bad7901db7e98afbfdca60fccb, phone, Notting Hill, zoom ~15 with Street trees, Road collisions, Cycle lanes and Schools on): the green numbered circles (74, 153, 449…) read badly and clash with the collision dots, school caps and line badges. Suggestion: a heat map like Road collisions.
After (today's code: web/src/components/street-trees-map.ts, API /api/v1/tiles/street-trees with clusters at z13-14 and single trees from z15):
- z ≤ 15: a green heat map of tree density (weight 1 per tree, or by canopy where known), soft and translucent so the basemap and other overlays stay readable; no numbers.
- z ≥ 16: the heat fades out and single trees appear as small plain green dots (Dot, size by canopy; hollow when no size), with the popup unchanged (species · size · source).
- Legend while Street trees is on: "Street trees · fewer → more" with the green ramp; the "?" explainer says GLA street trees, Nov 2025, and that private gardens and parks are not included.
- Stacking with other Show items: heat under everything; collision heat stays red/orange and must be distinguishable (different hue, the legend lists both when both are on). Show the both-on case.
- Green streets (Layers) stays a separate line layer; note how they differ.
Board: Today (blob) · After at z12, z14, z16 on a 390 phone, Day + one Night frame · both-on frame (trees + collisions) · legend · short note for the implementer (heatmap layer params, zoom fade, data from the existing tiles or a new density tile).

## v4 Task 4 — Road collision marker: 5 variants (board V4-04-collision-marker)
Owner: collisions need their own recognisable marker, "something like 💥". Today (blob 6ac646bad7901db7e98afbfdca60fccb): plain orange/red dots that look like Local places dots and blend with cycle lanes. DESIGN.md: icons are plied yarn (knit), never system emoji, so the 💥 idea must be drawn in the knit icon style.
Each marker must show severity (Fatal / Serious / Slight) not by colour alone (shape or size or outline too), stay ≤ 22 px so dense junctions remain readable, be distinct from school caps, place dots, tree dots and station rings, and keep the heat map at lower zooms (markers from z15 as today). Tap target ≥ 32 px (invisible hit area is fine).
A "Knit burst": an 8-point starburst (💥 silhouette) in severity colour, white core; fatal = bigger with dark outline, slight = smaller.
B "Hazard triangle": a rounded warning triangle with a small burst inside; fill by severity; fatal adds a double outline.
C "Who was hurt": a severity-coloured burst with the road-user glyph inside (walking person, bike, car, motorbike); shows the most vulnerable person hurt.
D "Road diamond": a road-sign diamond with an X (two crossing paths); severity by fill and by line weight.
E "Crash spark on a dot": keep a small dot but add 3–4 short spark strokes around it (like a cartoon impact), severity by colour + number of sparks (3 slight, 4 serious, 6 fatal).
Board: Today crop · one row per variant: anatomy 3 severities at 2× · phone 390 at z15 and z17 on a busy junction (with school caps, place dots and trees heat on) · Night sample · legend line · bottom comparison and recommendation. Popup unchanged (Fix 2).

## v4 Task 5 — Road collisions zoomed out: a real heat map, not a polka-dot grid (board V4-05-collision-heat)
Owner (phone, zoom ~11-12, central London; screenshot uploaded as the Today blob): the collision layer zoomed out is a regular grid of separate orange/red dots that reads as a pattern, not as "where it is dangerous". Owner: find the best solution yourself.
Cause (code): the vector tiles snap collisions to a grid (deploy/migrations/065-collision-casualty.sql: cell = tile width / 32 below z12, / 64 above, ST_SnapToGrid + count(*) AS n), and web/src/lib/map-collisions.ts draws a heatmap with radius 16-22 px that does not cover the gap between cells and does not weight by n, so each cell becomes its own blob.
Decision (best solution):
1. A continuous heat map: weight each cell by its casualties `n` × severity (fatal 10, serious 3, slight 1, the same weights in the legend's "?"), a radius of at least 1.6 × the on-screen cell spacing at every zoom (interpolate per zoom), and a finer grid (tile/128) below z13 so blobs merge into smooth corridors along the roads that matter.
2. Normalise intensity by zoom so London's busiest corridors reach the top colour at every zoom, not only when zoomed in.
3. Colour: a single warm ramp (transparent → amber → red → deep red) at max ~0.75 opacity, so the basemap and labels stay readable; distinct from the green trees heat (Task 3).
4. Hand-over: from z14.5 the heat fades and the Task 4 markers take over (as today: heat opacity 0 at 14.5).
5. Legend: "Road collisions · casualties weighted by severity · fewer → more", with the filters (Fix 24) still applying to the heat.
Board: Today (blob) vs After at z10, z11, z12 and z13 on a 390 phone, plus a desktop z11; "Fatal & serious only" filter state; both-on with trees heat; an implementer note with the exact heatmap paint expressions and the SQL cell change.

## v4 Task 6 — Green cover visible at every zoom (board V4-06-green-cover-zoom)
Owner (blob c8d73356aa196dbb4afac7ff8ac79706, phone, zoom ~10): Layers › Nature › Canopy shows nothing zoomed out; the legend says "Green cover, 10 m · Zoom in to see it". Cause: canopy_tile PNGs exist only for z11-14 (migration 066, etl_canopy.py).
Decision: build lower zooms z8-10 by averaging the 10 m cells (share of green per pixel), so London's green belt, parks and leafy suburbs read from far; keep z11-14 as now; above z14 overzoom z14. Same ramp at every zoom; the legend never says "zoom in". Board: Today blob vs After at z9, z10, z11, z13 on a phone + desktop z10; implementer note (etl_canopy.py: add a pyramid step; ~+600 tiles; serve the same way).

## v4 Task 7 — Green structure: Street trees vs Canopy vs Green streets vs Green & trees (board V4-07-green-structure)
Owner: individual trees (Show) and Canopy (Layers) feel like a duplicate. Today four green things: Layers › Nature › Green & trees (area score), Green streets (road links by street trees per 100 m), Canopy (satellite green cover, 10 m), Wildlife seen; Show › Street trees (GLA council street-tree points).
They are different data (Canopy = every green pixel from satellite incl. gardens and parks; Street trees = council-listed street trees only; Green streets = those trees per road; Green & trees = area score combining green land, street trees, nature sites), but the menu doesn't say so.
Decision (rule: Layers colour the map, one at a time; Show puts things on top, many at once):
1. Layers › Nature: one item "Green & trees" with views [Area score · Green cover · Green streets] (like Price per m² Actual/Rank/Change). Canopy and Green streets stop being separate rows. Wildlife seen stays its own item.
2. Show › Street trees stays the only tree overlay (heat → dots per Task 3), renamed "Street trees (council list)" in the explainer only; the row label stays "Street trees".
3. Each view's one-line subtitle says what it is: "Area score · green land, street trees, nature sites" / "Green cover · all greenery from satellite, gardens too" / "Green streets · council street trees per 100 m of road".
4. When Green cover is the layer and Street trees is on, the tree heat is hidden below z16 (it would repeat the cover); dots still show from z16.
Board: Today menu (Nature group open) vs After menu (one item, 3 views), phone + desktop; four map frames (each view + Street trees on top); a small "what each shows" table; implementer note (map-topics.ts items 175-177 become views of nature-score; URL keeps old ?layer=canopy / green-streets working).

## v4 Task 8 — "Areas you drew" → a "Where" criterion in My match (board V4-08-where-zones)
Owner (blobs c2fdde63677eb67812f6d27c6d4ea090 drawing panel, 21655261485bb518b601c45f95034f6e Show sheet) asked why we draw zones and how they are used.
How it works today (api/area_api/matching.py): up to 3 zones = "places the household wants to live in": near a station (≤ N min walk), a borough, a list of areas, or a drawn polygon (3–50 corners in Greater London). In My match, areas outside every zone get the relaxable limit "zone:outside" (hidden unless relaxed) and zones break ties; zones never change a score. UI: drawing lives at the bottom of Show ("Areas you drew", "Draw an area on the map", "Up to 3 zones"), far from My match, so it reads as a map drawing tool with no purpose. The drawing card also says "0 so far" while a finished zone is on screen.
Decision:
1. Move zones into My match as a "Where" criterion card (same pattern as place and range cards): chips "Near Brixton ≤ 10 min walk", "Dulwich (borough)", "Area I drew ✎", "+ Add" with [Station · Borough · Areas · Draw on map]; ✕ per chip; header line "Only areas inside these (up to 3)". Must-style hint: "Outside areas hidden; we relax this if too few match."
2. Remove "Areas you drew" from Show.
3. Drawing mode: a slim top bar over the map "Tap corners · 4 so far · Undo · Done · Cancel" (thumb-reachable Done at the bottom on phones), polygon fills as you go; no big card covering the map.
4. On the map with My match: zones drawn as a thin outline with a light tint. Owner 2026-10-18: Where is a scored, ranked criterion, not a filter — fit 1 inside, falling with distance outside (soft edge, default 1 km / 10 min), 0 beyond; outside areas take the 21e colours (far out = red). Must on the Where card makes it a filter (hatch). Replaces the zone:outside limit.
Board: Today (two blobs) · After: My match editor with the Where card (desktop + phone), drawing mode on phone (3 frames: start, 4 corners, done), result map with the zone outline; short note on the API (unchanged) and URL/profile compatibility.

## v4 Task 9 — Open a zone on the portals (board V4-09-zone-to-portals)
Owner: can drawn zones be carried over to Rightmove, Zoopla and other listing apps?
Today: api/area_api/home_search.py portal_links() builds portal searches by postcode district only (Rightmove /property-for-sale/<outcode>.html, Zoopla /for-sale/property/<outcode>/, OnTheMarket /for-sale/property/<outcode>/), with max price and min bedrooms.
Idea: on each "Where" zone chip (Task 8) and on the My match result, an "Open on ▸ Rightmove · Zoopla · OnTheMarket" row.
- Drawn polygon: Rightmove and Zoopla both have "draw a search" on their map pages; their URLs appear to carry the shape as an encoded polyline (Rightmove locationIdentifier=USERDEFINEDAREA^{"polylines":"…"}, Zoopla polyenc=…). These are undocumented: verify both by building a URL and opening it before any code; if one does not hold, fall back.
- Station zone: Rightmove supports station + radius searches; Zoopla a radius around a place.
- Borough: each portal's borough search page.
- Fallback for anything unsupported: the postcode districts that cover the zone (as today), up to 3 links.
- Always pass budget and bedrooms; open in a new tab; count clicks through /go like other click-outs (product analytics rules).
Board: zone chip with the "Open on" row (phone + desktop); what each portal gets per zone kind (table); fallback state; note that formats are unofficial and must be tested in CI by a weekly link check.

**Task 9 check (D1, 2026-10-18): both draw-search formats hold.** Polygon: a closed box around Clapham Common, (51.4640, −0.1560) → (51.4640, −0.1400) → (51.4560, −0.1400) → (51.4560, −0.1560) → back to the start, as a Google encoded polyline (precision 5, lat then lng, ring closed): `_qbyH~m]?_cB~p@??~bB_q@?`. Budget £800k, 2+ bedrooms.
- Rightmove (holds, plain HTTP): `https://www.rightmove.co.uk/property-for-sale/map.html?locationIdentifier=USERDEFINEDAREA%5E%7B%22polylines%22%3A%22<polyline>%22%7D&maxPrice=800000&minBedrooms=2` (the value is `USERDEFINEDAREA^{"polylines":"<polyline>"}`, URL-encoded). A scripted GET returned 200, title "Properties For Sale in Untitled (Drawn Area)", resultCount 29: all 29 listings inside the box, prices ≤ £800k, 2–3 bedrooms. Rent holds too (review recheck 2026-10-18): `/property-to-rent/map.html` with the same `locationIdentifier` and `minBedrooms=2` returned "Properties To Rent in Untitled (Drawn Area)", resultCount 16, all SW4 around Clapham Common; `maxPrice=3000` (per month) cut it to 2. `/api/_search` with it returns a "couldn't find the place" page: link to the page, never the API.
- Zoopla (holds in a browser; scripted requests get a Cloudflare 403): `https://www.zoopla.co.uk/for-sale/property/london/?polyenc=<polyline URL-encoded>&price_max=800000&beds_min=2&q=London&search_source=for-sale` opened in Chromium listed 28 results, all Clapham Common SW4/SW11, prices ≤ £800k. The map view (`/for-sale/map/property/?polyenc=…`) showed "0 results" behind the cookie banner: link to the list view. Rent holds too (review recheck 2026-10-18, Chromium): `/to-rent/property/london/?polyenc=…&beds_min=2&q=London&search_source=to-rent` listed 15 results, all SW4/SW11 around Clapham Common.
- Encoding rule for Task 9: polygon in WGS84, ring closed, at most ~100 vertices (simplify first; long URLs are untested), precision 5. One drawn zone = one link per portal; several zones = one link each.
- Weekly link check: Rightmove can be checked from CI by plain HTTP (title contains "Drawn Area" and resultCount is a number). Zoopla cannot (403 to scripts): CI only checks that the URL builds; a failing or blocked check sends the zone to the fallback (up to 3 postcode-district links) and alerts. OnTheMarket was not tested: postcode districts as today.

## v4 Task 10 — Map messages hidden behind the legend (board V4-10-map-messages)
Owner (blob ab963e683daa5c425803b406457f0ede, phone): tapping the locate button opens a message that sits behind the legend card, so it can't be read.
Cause (code): web/src/components/map-layers.tsx MapPosition renders `<p class="map-position__status" role="status">` inside the right-hand control stack; on phones the stack is above the bottom sheet next to the legend, so the paragraph lands under the legend card (z-order and position). Messages: "Your location isn't available here." / "Your location isn't available: allow it in the browser to use this." They never dismiss.
Decision: one shared map message pattern (toast) for every short map notice (location, "Pick at least one", copy link, zoom-in hints):
- Phone: a toast just under the top search pill, full width minus gutters, above every map control and the legend; auto-hides after 6 s, with ✕; for location denied it adds a "How to allow" link (opens a short sheet: browser settings steps).
- Desktop: the same toast top-centre of the map.
- Never under a control, never covering the thumb zone; role="status", one at a time (newest replaces).
- While locating: the locate button shows a spinner ring; on success the blue dot + accuracy circle, and no toast.
Board: Today (blob) · After on phone: locating, denied toast, "How to allow" sheet, success; desktop toast; z-order note (toast layer above controls, legend and sheets; below modal dialogs).

## v4 Task 11 — Phone in landscape (short viewport) (board V4-11-landscape)
Owner (blob of the landscape screenshot, ~900×360 CSS px): the layout breaks. Seen: the width passes the desktop breakpoint, so the desktop layout is used on a 360 px tall screen; the right control stack (My match · Layers · Show · locate · + · − · ⓘ) is taller than the screen, so My match is cut and buttons overlap ("︶" stub, black dot); the location message covers the stack; legend tick labels collide ("£840k£1465k+"); "Choose an area · Try an example" pill takes a second row.
Decision: layout keys off height as well as width.
- Short viewport (height < 500 px): top bar = one row [≡ logo · Search · ♡]; "Choose an area" moves into the search pill's placeholder or ≡; right side = the 3 circles (My match, Layers, Show) in one column, and locate in the bottom-right; no +/− (pinch) and ⓘ moves into the menu foot; legend = one slim row (name · ramp with 3 labels · ?) bottom-left, max 50% width.
- Map messages use the Task 10 toast at the top centre.
- Sheets (Layers, Show, My match) open as a right-side panel 360 px wide, full height, not a bottom sheet.
- Legend labels: never more than 3 tick labels when the legend is under 320 px wide; labels never overlap (drop middle ticks first).
Board: Today (blob) · After: landscape phone 844×390 map idle, Layers panel open, legend close-up with label rules, toast; plus the same rules on a small tablet landscape 1024×600 (desktop layout kept).

## v4 Task 12 — One area view in the map sheet; delete the old (board V4-12-one-area-view)
Owner (blobs 04c8078d58bb04f3e668ed5dab427ae1 full sheet, 7d7268f060ce98cf920a135c6519ac1e half sheet; area Beddington, Sutton): the sheet shows two different area views. Expanded it shows the v3 view (verdict, tags, Tailored chip, the 12 fixed tiles with London strips, Show all 12, sticky chips, sections). At half height it shows the old view: OverviewTiles cards "Price · pricier than 25% · Details ›", "Getting around 2/10 · Well below London", "Safety 2/10", "Schools 8/10", and an "Open full area page" button. Two vocabularies (x/10 vs "More crime than 89%") for the same area; they even disagree in wording.
Decision: one view. Delete the old OverviewTiles path in the map sheet (web/src/components/evidence-panel.tsx, overview-tiles.tsx, match/selected-area.tsx where used; area-brief.css leftovers) and use the v3 header + tiles at every sheet height:
- Peek (half): name, breadcrumbs, verdict line, tags, then the first 4 tiles (2×2) and a sticky footer "Open full area page".
- Full: as the expanded screenshot today (tags, Tailored chip, 6 tiles + Show all 12, chips, sections).
- No x/10 ratings anywhere in the sheet; no "Details ›" links (the tile taps scroll to its section in the full sheet, or open the full page from peek).
Board: Today (both blobs) · After: phone peek, phone full, desktop side panel; a "removed" list of components for the implementer.

## v4 Task 13 — One sheet component everywhere (board V4-13-one-sheet)
Owner (Layers sheet screenshot blob, uploaded last): the Layers sheet does not scroll/drag like the area-details sheet; every sheet must behave the same and reuse one sheet class.
Today (code): only the area sheet (web/src/components/map-dock.tsx) uses the shared drag logic (useSheetDrag + lib/sheet-snap.ts SHEET_SNAPS peek/half/full, rubber band, snap after release/tap, handle with an accessible name). Layers (map-layers.tsx / map-data-selector.tsx), Show, My match (match/your-search.tsx) and the explainer sheet have their own fixed-height panels: no snaps, no drag, inner scroll differs.
Decision: one `MapSheet` component (extract from map-dock.tsx) used by every phone sheet: Area, Layers, Show, My match, Saved, Layer explainer (Task 10/12 and Fix 12), Areas/zones (Task 8).
- Same snaps (peek · half · full; a sheet may declare which it allows: e.g. Layers opens at half, can go full, no peek), same handle, same drag + rubber band + velocity snap, same inner scroll (content scrolls only at full; at half the drag moves the sheet), same header row (title · ✕), same Esc/back-gesture close, same focus handling.
- One sheet open at a time; opening another replaces it (the area sheet returns to peek, not lost).
- Desktop: the same component renders as the floating panel/side panel it is today (no behaviour change).
- Landscape (Task 11): MapSheet renders as the right-side panel.
Board: a behaviour diagram (snaps, drag rules, scroll rules) · the five sheets at half and full on a phone, all with the same chrome · a short implementer note (extract MapSheet + useSheetDrag; migrate each sheet; e2e sheet-gestures covers all sheets, also fixing the 1-in-6 flake).

## v4 Task 1b — Keep the yellow cap, draw the information into the cap top; school filters in Show (board V4-01b-school-cap-top)
Owner on V4-01: no pins. Keep our original sun-yellow mortarboard (yellow stands apart from other map items). The small badges/dots are still invisible, so draw the cap's top board differently instead.
Marker: always the same at every zoom, ~24–28 px, sun-yellow cap body with a dark/white halo.
- The flat top board carries Ofsted, big enough to read: fill or pattern by grade (Outstanding green with ★ cut-out, Good blue, RI amber, Inadequate red, report card grey grid, not inspected plain yellow). Not colour alone: each grade also has its own top mark (★ / ● / ◐ / ○ / ▦ / none).
- Phase: primary = plain cap; secondary = tassel; all-through = tassel + "6".
- Private: the top board is white with a yellow outline (no Ofsted).
- Rank Top 5/10/25: a thick border on the top board (gold/violet/sky) — no separate ribbon.
Draw 3 top-board treatments to choose from (fill colour + mark · coloured stripe across the top · coloured top with a white number for rank), each at 1× and 3×, on the dense z12 and z15 phone crops.
Show › Schools filters (phone + desktop): under the Schools row, a sub-list with legend swatches drawn as the real markers and checkboxes: Primary · Secondary · All-through · Private | Outstanding · Good · Requires improvement · Inadequate · Not inspected | Top 10% only (toggle); "All · None" links per group (as Fix 24); counts per item ("Primary 1,840"); filters persist in the URL.

## v4 Task 1c — One visual channel per fact (revises 1b; board V4-01c-school-one-channel)
Owner: one parameter = one change. Not "colour of the top + a mark on it" for Ofsted.
Channels (each fact uses exactly one, and no channel carries two facts):
1. Ofsted → colour of the cap's top board only (Outstanding green, Good blue, RI amber, Inadequate red, report card grey, not inspected = plain sun yellow). No marks on the top. Use a colour-blind-safe set (check deuteranopia/protanopia simulations on the board); the exact grade is in the popup and the filters.
2. Phase → the tassel only: none = primary, cord with fringe = secondary, cord + small "6" plate = all-through.
3. Funding → fill style only: state = solid cap; private = outline cap (white inside, yellow line). A private school has no Ofsted, so its top stays white.
4. London rank → marker size only: Top 5 % = 32 px, Top 10 % = 28 px, Top 25 % = 24 px, others = 20 px (tap area always ≥ 32 px). No border, no ribbon.
Board: the channel table; the full matrix at 1× (and 3× close-ups); deuteranopia + protanopia simulation strips; phone crops at z12 dense and z15; the Show › Schools filter sub-list (from 1b) with legend swatches drawn as the real markers. Mark 1b as superseded.
Task 1c amendment (owner: the tassel coding is unclear): phase is a letter on the cap's yellow band, not a tassel. Primary "P", Secondary "S", All-through "PS"; dark ink, ≥ 9 px bold at 24 px marker size, white halo. No tassel on any marker. Legend reads "P primary · S secondary · PS all-through".
Task 1c amendment 2 (owner: an outline cap will not be seen): funding is the colour of the cap BODY (band + brim), a different part from the Ofsted top. State = sun yellow body; private = deep plum (DS token, high contrast on the light and dark map) body with a white top (no Ofsted). No outline-only caps. Check the plum stays distinct from Ofsted colours in the colour-blind strips.
Task 1c amendment 3 (owner): rank marks only Top 10 / 5 / 3 / 1 % of London, styled like YouTube Creator Awards (Silver < Gold < Diamond < Red Diamond < Ruby), with Top 10 % = Gold. Rank's one channel is an award plaque badge on the cap (top-right, 14 px, white halo), not size: Top 10 % Gold · Top 5 % Diamond (pale blue, faceted) · Top 3 % Red Diamond · Top 1 % Ruby (deep red, faceted). Below Top 10 %: no badge. Marker size is constant (24 px). Legend row shows the four plaques with "Top 10% · 5% · 3% · 1%". Data: school_national_rank.top_percent (London); check counts per tier in the legend (e.g. "Ruby 27 schools").
Task 1c amendment 4 (owner): add Top 25 % = Silver plaque. Tiers: Top 25 % Silver · 10 % Gold · 5 % Diamond · 3 % Red Diamond · 1 % Ruby; below Top 25 % no badge.
Task 1c amendment 5 (owner): the plaque carries the number too: the tier figure 25 / 10 / 5 / 3 / 1 (Top %), bold, white on gold/diamond/red/ruby, dark on silver. Plaque grows to 18 px to fit two digits; same outline + halo. The exact London position ("#12 of 2,256 in London") is in the popup, not on the map.
Task 1c amendment 6 (owner): every marker always shows all its details at every zoom (top colour, P/S/PS letter, body colour, plaque with number); never simplified, never shrunk. Density is handled only by placement: markers never overlap (MapLibre symbol collision with priority Ruby > Red Diamond > Diamond > Gold > Silver > Outstanding > rest); a marker that would overlap folds into a small count bubble ("+3") at that spot, tap = zoom in. Draw z12 dense with this rule.

## v4 Task 14 — Desktop right panel: remove the empty strip above it (board V4-14-desktop-panel-top)
Owner (blob 2cb2d255a5ac35865705f4832c1cf00b, desktop ~1440, My match open): the right panel ("Your matches") starts ~100 px below the top, leaving an empty map strip above it; the round My match button is half under the panel edge and its title is clipped ("…r matches"); the ♡ chip that used to sit there is gone, so the gap has no purpose.
Decision: the right panel runs full height with the same 12 px margin as the left pill (top aligned with the search pill); its header row holds the title, ♡ N and the panel toggle; the round controls stack (My match · Layers · Show) sits 12 px left of the panel, top-aligned with it, never overlapping; when the panel is closed the stack moves back to the map's right edge and ♡ N returns to the top-right. Same rule for every right panel (area details, My match, Saved, Compare).
Board: Today (blob) · After: panel open (My match and area details), panel closed, at 1440 and 1280 widths.

## v4 Task 15 — A map click only selects (code only, no board)
Owner: on desktop a click sometimes selects the area (hand cursor) and sometimes selects AND zooms (magnifier cursor). It must only select.
Cause (code): web/src/components/area-map.tsx ~1253: the street-block summary layer (BLOCK_FILL_LAYER, lib/map-property-layers.ts, shown at mid zooms above the area colours) zooms in by +2 on click ("tapping a block zooms in towards the houses") and sets cursor "zoom-in"; the area under it also takes the click, so both happen. street-trees-map.ts does the same for tree clusters (gone with Task 3's heat).
Decision: every map click selects the area under it, nothing else. Blocks: no click zoom; cursor "pointer"; hover tooltip "n homes · £/m² · zoom in to see homes". Zoom only by wheel, +/−, double-click, pinch, or explicit buttons ("+N" school bubbles and "Zoom to area" in the panel are buttons and may zoom). One cursor rule: pointer over anything clickable. e2e: click a block at z14 → area selected, zoom unchanged.
Task 15 amendment (owner): desktop has no click zoom at all: single click = select, press-and-drag = pan, wheel / trackpad pinch = zoom; disable MapLibre doubleClickZoom (and boxZoom). A click on the map never moves the camera (no fit to the selected area). The camera moves to an area only when it is chosen from UI elsewhere: Search result, Saved, Compare, rankings rows, My match list, "Zoom to area" in the panel, and shared links. +/− buttons stay for keyboard and accessibility.
Task 12 amendment (owner, desktop screenshot blob uploaded last, Greenford North): the desktop side panel shows the same old OverviewTiles (x/10, Details ›, "What a home costs here ≈ £305,000 wider-area price", Watch/Compare/Like this row). Task 12 applies to the desktop side panel too: v3 header + tags + tiles, no x/10, and drop the per-home "≈ £305,000" estimate (no per-home valuation rule; show £/m² and the area band only).

## v4 Task 16 — One content width for every page (board V4-16-one-width)
Owner (blobs 70eabca073384580d6acda342a69ec68 /area/lsoa/E01001266/places, e96ba99e897b6e077d1c29df3573295a the area page): the Places page cards are much narrower (~820 px column) than the area page sections (~1170 px). All cards must have one width.
Also seen: the Places page still uses the old Getting-around design (score ring "6", station radar), which duplicates the area page's Getting around section in a different style.
Decision:
1. One site container width for all content pages (area, places, pack, school, borough /area/london, rankings, tools, guide articles keep a narrower reading column only for long prose): 1120 px max, 24 px gutters, the sticky header and chip bar align to it. Cards always span the container. (Fix 18 already set 1120 for tools/rankings; extend it.)
2. The Places page becomes the full list behind "All places →": same section frame as the area page (title row · one chart max · rows · ⓘ), grouped by Food & drink · Going out · Everyday · Your places; its Getting-around block is removed (it lives on the area page).
Board: Today (two blobs) · After: area page and Places page side by side at 1440 (same width), Places at 390; a width-rules note (container token, which pages keep the reading column).
Task 16 amendment: the borough page /area/borough/E09000009 (blob b4453bb0ecfd9f5b1dc56bf5b9ec0492, Ealing) has the same narrow column; include it.

## v4 Task 17 — Borough page in the v3 style (board V4-17-borough-page)
Owner (blob b4453bb0ecfd9f5b1dc56bf5b9ec0492): the borough page is narrow and in the old design: big title, "Open on map" primary, ♡ + "Watch new listings", tabs At a glance · Areas · Questions · Rankings, then an "Ealing at a glance" table (Topic · Here · London) listing typical price, crime, most-deprived fifth, household income, social renting, schools.
Decision: same frame as the area page (Task 16 width, v3 header): breadcrumbs · name · verdict line · tags (London extremes; deprivation allowed per PR #94; income and social renting stay descriptive rows, never tags) · the same 12 fixed tiles at borough level · one sticky chip bar (At a glance · Areas · Price · Safety · Schools · Getting around · Green & quiet · People · Living costs · Questions) · sections in the area-page frame. "Areas" = a sortable list/table of the borough's neighbourhoods with mini strips (price, crime, schools) linking to each area page. Actions row as on the area page: ♡ · Compare · On map · ⋯ (Watch new listings inside ⋯).
Board: Today (blob) · After at 1440 (header, tiles, chips, Areas section, one topic section) and at 390.
Task 16 width audit (2026-10-18, code): today 6 widths at 1440 px: 820 (.methodology: area guide view, compare, rankings/[slug], pack, area/london, postcode, sector, brief, save-listing, legitimate-interests), 860 (.subpage: about, bot, civic, feedback, privacy, terms, guide*, agents*; .property-page: property, postcode homes; footer on every page), 980 (area full view, school), 1120 (tools*, rankings), ~688 (places), full-bleed (map). Gutters differ (32 vs 36 px). The header sits inside each page's <main>, so it jumps width between pages and never matches the 860 footer.
Rule: one container token --page-width: min(1120px, 100% - 48px) for header, content and footer on every non-map page; all cards span it. Long prose (guide articles, privacy, terms, legitimate-interests, about body text) keeps a 720 px reading measure left-aligned INSIDE the 1120 container, so the header/footer never move. Map page unchanged. One gutter (24 px) everywhere. Implementation: shared .page-shell (or SiteHeader + footer outside page mains) replacing .methodology / .subpage / .property-page / .school-page / .area-full / .places-page widths.

## v4 Task 18 — Remember the map setup on this device; "Default" reset (board V4-18-remember-map)
Owner: when I pick places/layers, go elsewhere and come back, I want the same setup without redoing it; Show needs a "Default" button in its header to reset.
Today (code): lib/map-state.ts already keeps the map as a query string in localStorage (SAVED_MAP_STATE_KEY "close-knit.map-state.v2", persistMapState in components/use-explorer-controller.ts), but it is only adopted in some entries (shouldAdoptSavedState / "Back to the map"), and sub-filters inside Show (place categories, road-collision filters, school filters from 1c, tree heat, cycle lanes) are not all part of MapState.
Decision:
1. Everything the user sets on the map is saved on every change: layer + view + period, Show items and every sub-filter, Colours, 2D/3D, theme stays as today. Camera (centre/zoom) too.
2. Restore on every return to the map: logo, "Map →", browser back, a bare "/" visit, closing a sheet. A link with explicit query params (shared link, ranking "On map ↗") wins for the params it sets; everything else comes from the saved setup.
3. "Default" text button in the Show sheet header (next to ✕) and in the Layers header: resets that sheet's choices to the defaults (Show: Local places + Stations on, others off, all filters All; Layers: Price per m² · Actual · latest), with a toast "Reset to default · Undo" (Task 10 toast) for 6 s.
4. Saved only on this device (no account); "Clear my data" in Privacy also clears it.
Board: phone Show sheet with the header [Show · Default · ✕] (before/after reset + Undo toast); Layers header the same; a flow strip: set filters → open an area page → back to the map → same setup; precedence note (URL > saved > default).

## v4 Task 19 — Show › Recent sales options break the layout (board V4-19-recent-sales-options)
Owner (screenshot, desktop Show panel ~640 px): opening Recent sales shows "COLOUR BY" and "COLOUR SCALE" as left labels with their segmented buttons pushed off the panel's right edge ("Sold price", "Grow…", "Chea…", "Defa…", "Exper…" cut); the legend wraps to two lines; "Filter sales" is a bare disclosure; a 6-line licence paragraph sits in the panel.
Decision (same sub-option pattern for every Show item: Schools 1c filters, Road collisions, Recent sales):
- Sub-options sit indented under the item; each option group = a small label on its own line, then a segmented control that wraps within the panel width (never overflows): Colour by [Sold price · Growth]; Scale [Cheaper · Default · Expensive] (short labels).
- Legend: one row of swatches with 3 labels max (Task 11 rule), "No data" as a grey dot at the end.
- "Filter sales" becomes the same chip list with All · None as Road collisions (type, tenure, new build, years).
- The licence and method text move behind an ⓘ next to the item name (opens the Task 12-style explainer); the panel keeps one muted line max.
- Default button (Task 18) resets these too.
Board: Today (blob) · After: desktop Show panel with Recent sales open, phone sheet, both with Schools filters (1c) open above to prove the shared pattern.
Task 4 decision (owner): variant C "Who was hurt" chosen, but no white core: the burst is filled with the severity colour all the way and the road-user glyph (walking person, bike, car, motorbike) is drawn in white on it. Severity still not by colour alone (keep C's size/outline steps). Update V4-04: mark C chosen, add the refined C at 1×/3× for all severities × road users, on the busy z15/z17 crops.

## v4 Task 20 — Icon atlas: every icon on the map and in the UI, all variants, together (board V4-20-icon-atlas)
Owner: draw the full set of icons we have, on the map and in the UI, with every variant, to see how they sit together and where they clash.
Inventory from code (web/src/components/knit/knit-icon.tsx names; map layers in lib/map-*.ts and components/*-map.ts; DESIGN.md) plus the v4 decisions:
- Map markers: school cap (1c: Ofsted top colours × P/S/PS × state/private body × 5 plaques); collision C (decided, severity × road user); place dots by category (food & takeaway, coffee, pubs & bars, shops, sport & culture, other); stations (Tube, rail, Overground, DLR, Elizabeth line rings, interchange); street tree dot (canopy size / unknown) and trees heat; recent sales pins (colour by price); My places pins; Saved ♡ pins; My match pills (rank number + price) and "+N" bubbles; selected area outline; drawn zone outline; locate dot; cycle lanes; green streets lines.
- UI icons: header (≡, logo, search, ♡ N), map circles (My match, Layers, Show, locate, +, −, ⓘ), legend (?), sheet chrome (handle, ✕, Default), section/tile icons on the area page (price, transport, safety, schools, local places, green, health, homes, people, living costs, cycling, noise, nature, air, GP, food hygiene, nightlife, families), menu icons, action icons (Compare, On map, ⋯, share, reset, edit), status chips (✓ ≈ ✗).
Board layout: 1) Map markers grid: every marker and variant at 1× and 2× on light and dark map tiles; 2) UI icon sheet: every icon at 20/24 px, Day and Night, with its name; 3) "Busy map" stress test: one phone z15 and one desktop z14 crop with every Show item on at once (schools, collisions C, places, stations, trees, sales, my places, saved, match pills) to show overlaps; 4) a clash list: pairs that read alike (shape/colour) with a fix proposal each.
Task 1c decision (owner, 2026-10-18): approved as drawn on V4-01c (top colour = Ofsted, P/S/PS letter, yellow vs ink body, 5 award plaques with tier number, full detail at every zoom, "+N" folding).
Owner decisions 2026-10-18: Task 2 → variant B (layer pill under the search: "▤ <layer> · <view> ▾", tap opens Layers; legend keeps only the scale and ?). Task 12 → drop "What a home costs here ≈ £…" (show £/m², area band and budget fit instead). Task 9 → yes, with fallback to postcode districts and a weekly link check. Implementation: not yet; owner reviews boards and the icon atlas first.
Task 20 decisions (owner 2026-10-18): (1) Ofsted top colours stay as approved in 1c; place-category dots get their own muted palette that never repeats an Ofsted, collision, station or tree colour (places are background, schools are primary). (2) Cycle lanes become sky blue (the Show swatch colour); orange/tangerine is reserved for collisions. (3) Missing icons barbell, swimming, glass-cocktail must be drawn in the knit set (gyms, pools, bars currently fall back to "Other"). Update V4-20 to show the fixed palette and the busy-map stress test again.

## v4 Task 21 — Finish My match on the Fix 30b model (code; board V3-30b is the target)
Owner: prod My match differs from V3-30b. Audit (2026-10-18, prod vs board):
- Built-ins (Safer streets, Lower price per m², Quiet streets, Less disorder) are not range cards: their chip reopens the wizard (criteria-editor.tsx factor chips open: onEdit).
- Wizard "Must" is a hard cut at fit 50 (priority-levels.ts MUST_MINIMUM = 50), not "edges at 0"; non-Must criteria can never put an area out (match-ranges.ts NICE_FLOOR = 0.05).
- "−N areas" shows only on Must chips.
- Place criteria (school, park, commute) have minutes chips + Must + dots, no soft edge.
- Two models side by side: adding Crime via "+ Add criterion" gives a range card next to "Safer streets · Must".
- "+ Add criterion" › Noise: "No values for Noise yet." (loadRangeLayer returns empty).
- Popup shows "fit 70" for factors instead of values with ✓/≈/✗.
- Bugs: a removed range (Crime) still listed in an area popup; an area out by a Must (✗) labelled "Good, 2 gaps".
Decision: one model everywhere, exactly V3-30b:
1. Every criterion, built-in or added, is a range card on its layer (Safer streets = Crime layer, Lower price = Price per m², Quiet streets = Noise, Less disorder = ASB/disorder, Good schools = school score), with histogram, range + soft-edge handles, Must pill (= edges at 0), importance dots, −N impact on every chip.
2. The wizard stays a quick start: its rows (dots + Must) create these range criteria with sensible default ranges (e.g. Safer streets → crime ≤ London median, soft edge to p75); tapping any chip in the editor opens the range card, never the wizard.
3. Places/commute: a range on minutes (≤ N min) with a soft edge (+50% by default) + Must; same card chrome.
4. Utility: inside range 1, linear to 0 across the soft edge, 0 beyond — for every criterion; drop MUST_MINIMUM and NICE_FLOOR. Migrate saved profiles (old factor weights → range defaults; old Must → edges 0).
5. Fix Noise (and any layer without range values) in loadRangeLayer; popup shows real values with ✓/≈/✗; fix the stale-row and "Good while out" bugs.


## v4 Task 21c — My match without a wizard (board V4-21c; CUJ on V4-21b)

Owner asked 2026-10-18 whether a separate quick start is needed; decision drawn on V4-21c, CUJ-01 reworked on V4-21b (7 steps).

1. No wizard. "My match" opens the list with three rows: Budget (Buy/Rent, max price, focused), Travel to (+ place), What matters (one-tap chips: Safer streets, Good schools, Quiet streets, Parks nearby, Less disorder, Clean air, Any layer…).
2. The map colours after the budget (2 taps). Count and top 10 follow every change.
3. Every criterion is a chip with its −N; tap opens its card in place, one at a time. Card has two levels: simple (one handle, soft edge drawn as an automatic fade, Must) and Fine-tune (the 30b card: histogram, soft-edge handles, importance). Phone shows the simple level. Importance dots appear only from the 3rd criterion.
4. Budget card = affordability factor: target = end of range, maximum = end of soft edge (targetBudget / maximumBudget). Buy = typical area price (by type when Flat/House picked), rent = by bedrooms. Never a per-home value. "Lower price" (£/m²) is removed as a chip; Price per m² stays addable via Any layer.
5. Chip defaults table on the board (one place: lib/match-ranges.ts).
6. "X cuts most · Soften": one tap widens that criterion's soft edge by 20% of its range (Must: first tap turns Must off), toast with Undo; hint hides at 300+ areas left.
7. Later, not in this task: "describe it in words" line using the find_areas parser.
Measure: taps to first coloured map (~8 → 2), searches with 2+ criteria, area page / portal clicks per search.

- 21c amendment (owner comment 2026-10-18): the Soften button shows what one tap gives, e.g. "Soften +492 areas" (count of areas the next step would bring back, computed on the client).

- Task 9 amendment (owner comment 2026-10-18): when the Close Knit browser extension (CUJ-17) is installed, the portal links carry the My match search id; the extension draws the zones on the portal map and marks listings inside / outside. Links work without the extension; the extension is the fallback when a portal's draw-search URL cannot be built.
- 21c heavy search (owner comment 2026-10-18, drawn on V4-21d): chips grouped by topic (Money, Getting around, Safety, Green & quiet, Schools) in fixed order, the biggest −N first inside a group; count + "cuts most · Soften +N" stay on top; collapsed sheet shows "15 criteria · N areas" and the 3 that cut most; under 20 full matches the top 10 fills with near misses labelled "≈ what is off". "Good value for its type" = area typical price vs areas with similar scores for the chosen home type (area level, never one home).
- 21c priority (owner comments 2026-10-18 "how to prioritise areas", "crime or schools: the user sets the order"): importance = the chip's place in the list; the user drags to reorder, a new chip joins at the end; no importance dots. Musts sit on top as filters with no weight. Weights from rank (rank-order centroid, w_i = (1/n)·Σ_{k=i..n} 1/k; 13 ranked → 25%, 17%, 13%, 10% … 1%). Score = weighted geometric mean of fits; ties break by the #1 criterion's value, then #2. Reordering re-sorts the top 10 live; each top-10 row says why (top priorities first). Drawn on V4-21d; Fine-tune card shows "Priority #3".

## v4 Task 21d — My match priority order, 15 criteria (board V4-21d)

Owner thread 2026-10-18: show 15 criteria; how areas are prioritised; the user sets crime vs schools order.
1. One ordered list; top = most important; drag ≡ (long-press on phone). A new chip joins at the end. No importance dots.
2. Must = toggle on any chip: no soft edge, no weight, moves to a "Must" block on top; outside it = out.
3. Weights from the place, rank-order centroid w_i = 1/n·Σ_{k=i..n} 1/k (15 ranked: 22%, 15%, 12%, 10% … 0.4%).
4. Score = weighted geometric mean of fits; ties by #1's value, then #2. API returns the top 2 contributing criteria per area for the "why" line.
5. Two inline questions in "What matters" (Kids? Drive?) only pre-order the suggestions (table on the board); not a wizard, never shown elsewhere.
6. Reorder re-sorts the top 10 live with ▲▼ and the reason; Undo toast.
7. "Best value" = separate sort, not a weight: area typical price for the home type vs the 50 areas with the closest score vector; hidden under 20 sales; area level only.
8. Old profiles: dots → order by weight desc; Must stays Must.

## v4 Task 21e — My match map: every area coloured, best to least like your search (board V4-21e)

Owner 2026-10-18: colour all areas, top and "minus top" going to red, to see where not to live.
1. Every scored area gets a colour; 7 bands by score percentile among scored areas (top 5% deep blue … bottom 5% deep red, middle near white), so the map spreads with 2 or 15 criteria. Palette RdBu (colour-blind safe), day and night.
2. Failing a Must = out = grey hatch over the area, never red (red = scored low, hatch = filtered). Replaces the 30b "grey = out" for soft misses.
3. "Top 10 | Bottom 10" toggle in the panel; bottom pins −1 … −10 in deep red; each bottom row names the criteria that sink it in priority order (✗ ≈); popup badge red for the bottom 10%.
4. Wording: "Least like your search", never "avoid"/"worst areas". Per-user only: no bottom list or red map on area pages, rankings or SEO pages.
5. API returns rank + percentile per area and the bottom 10 with their 2 weakest criteria.
- 21d amendment (owner 2026-10-18): Travel to is in the ranked list like any criterion. Any number of places (work, partner's work, grandparents…), each its own card with minutes, soft edge, its own priority or Must. "Good value" stays out of the list (separate sort).

## v4 Task 22 — Broken #profile= link (code only; toast from Task 10)
Owner 2026-10-18 (gap found while redrawing CUJ-08): an unreadable or partly unreadable #profile= link today opens an empty My match with no message.
1. Parse what can be read (budget, places, criteria); drop the rest.
2. Toast (Task 10): "Part of this link couldn't be opened · N criteria skipped" or, when nothing parses, "This link couldn't be opened · Start fresh". Never a blank panel.
3. Log a first-party event (product analytics) with the failure kind, never the link contents.
4. e2e: truncated link → toast + what parsed; garbage link → toast + empty list with the three start rows (21c).

## v4 G5 — Live-site fixes (audit 2026-10-18; board Audit-now-vs-v4 on Overview, -now boards on Journeys/Navigation)
Owner 2026-10-18: add the audit proposals N1–N30 to v4 as group G5, bugs first. Found by 4 staff reviewers (designer, UX engineer, product engineer, PM) walking prod; none was covered by Tasks 1–22.
- **Task 23 · Fix /save-listing area call (422)** (audit N3; 3 bug; UX eng · Product eng · PM) — The page calls /api/v1/areas/{id} without metric and period, so the save confirmation can't name the area. Seen on: CUJ09.
- **Task 24 · Area names, not codes** (audit N1; 2 bug · 1 major; Product eng · PM) — Codes like ‘Haringey 019A’ on Compare, Brief, Rankings, places titles and the agent sample; fix the name once in the API and resolve names when a share link is read. Seen on: CUJ03, 05, 07, 10, 13, 14, Compare.
- **Task 25 · Deep links and error states** (audit N4; 2 bug · 1 major · 2 minor; Designer · UX eng · Product eng) — Deep links ignore ?period and show raw API errors; a 503 leaves a blank area shell or an uncoloured map with no retry. Seen on: Compare, HomeLandscape, SubpageHeader.
- **Task 26 · Overlay and layout clashes** (audit N20; 2 bug · 2 minor; Designer) — Attribution card over controls, button over ♡, empty Search block, phone verdict tags stacked; landscape Show hidden under My location. Seen on: CUJ02, 06, 16, HomePhone.
- **Task 27 · Fix /school and /property 500 (React #441)** (audit N2; 1 bug; UX eng) — Direct loads can fail with HTTP 500 and ‘This page didn't load’; breaks the home and school journeys at their goal page. Seen on: CUJ02, 04.
- **Task 28 · First visit: a labelled start that works** (audit N9; 1 bug · 1 major · 1 minor; PM) — No labelled primary start on desktop; phone ‘Try an example’ lands at zoom 9 south of London; Show badge ‘2’ means nothing yet. Seen on: HomeDesktop, HomePhone, CUJ01, 08.
- **Task 29 · Map choropleth: night and street zoom** (audit N15; 1 bug · 2 major; Designer) — Controls vanish on the night basemap, the night choropleth is muddy, street zoom drowns in solid red. Seen on: CUJ05, HomeDesktop, HomePhone.
- **Task 30 · Compare polish** (audit N19; 1 bug · 1 idea; Designer) — The Places | Schools | Homes switch collapses; bar colour marks the column, not the winner. Seen on: Compare.
- **Task 31 · Knit form controls** (audit N21; 1 bug · 3 minor; Designer · UX eng) — Browser-default checkboxes, radios and grey buttons; type=number price fields; the correction form is unstyled. Seen on: CUJ03, 06, 08, 15, HomePhone.
- **Task 32 · Faster map loads** (audit N7; 4 major · 2 minor · 1 idea; UX eng · Product eng · PM) — Cold map 9.6 MB / 115 requests incl. 3.4 MB LSOA geometry; price scale 5.6 s; zoom-15 deep links ~15 s with no loading state. Seen on: CUJ10, 12, 15, HomeDesktop.
- **Task 33 · Keyboard and screen reader pass** (audit N14; 2 major · 5 minor; UX eng) — Enter can't select a map area; disclosures without aria-expanded; radios without legend; 36 px targets; ‘Show2’ accessible name. Seen on: CUJ15, 16, HomeDesktop, HomePhone.
- **Task 34 · Owner tasks for v4-drawn blocks** (audit N12; 2 major · 1 minor; PM) — v4 boards draw homes at the top of the postcode page, ‘Homes near this school’ and an article ‘Use it’ block, but no task owns them. Seen on: CUJ02, 04, 11.
- **Task 35 · Next step from Brief and Compare** (audit N11; 2 major; PM) — Brief and Compare end the journey: add area-page and homes-for-sale links per area. Seen on: CUJ03, Compare.
- **Task 36 · One primary per screen** (audit N17; 2 major · 1 minor; Designer) — Two stitched primaries on the home panel and match panel; Watch has none. Seen on: CUJ01, 12, HomeDesktop.
- **Task 37 · One chosen state and header lockup** (audit N18; 2 major · 1 minor · 1 idea; Designer) — Chosen tabs and chips are red, ink, with or without stitch; the logo lockup changes between pages. Seen on: CUJ09, HomeDesktop, SubpageHeader.
- **Task 38 · Shortlist share: real redaction + review** (audit N5; 1 major; Product eng) — The link says redacted but carries the budget and pinned coordinates; add the CUJ-08-style review step. Seen on: CUJ03.
- **Task 39 · Go public: index + sitemap** (audit N6; 1 major; Product eng) — Every page is noindex and robots.txt has no Sitemap while the site is private; owner switch CLOSE_KNIT_ACCESS=public at launch. Seen on: CUJ10.
- **Task 40 · Page metadata and URLs** (audit N8; 1 major · 4 minor; Product eng) — Property, postcode, school and 404 pages lack proper titles, canonical, og and JSON-LD; lowercase codes 404. Seen on: CUJ02, 04, 10, 12.
- **Task 41 · Carry one price across tools** (audit N10; 1 major; PM) — Stamp duty → Buy-to-let → My match → Check a home each lose the price; a saved listing's asking price is lost too (?price everywhere). Seen on: CUJ06, 09.
- **Task 42 · Good direction per layer** (audit N13; 1 major; PM) — Top 10 opens on the worst end; define per layer which end is ‘good’ (least crime, cheapest). Seen on: CUJ05.
- **Task 43 · Colour-blind-safe default palette** (audit N16; 1 major; Designer) — Default is the red–green ‘traffic light’; make Yarn or Colour-blind safe the default. Seen on: MenuA.
- **Task 44 · Check a home and postcode card** (audit N25; 1 major · 1 minor; Designer) — Check a home is a raw fieldset with a small grey result; Last sale is an off-token ink card. Seen on: CUJ02.
- **Task 45 · Colours on tokens: tags, charts, legends** (audit N22; 4 minor · 2 idea; Designer) — Alarm red for cons, bars and the last sale; ad-hoc chart colours; lens legend without a key. Seen on: CUJ01, 02, 06, 10, 14.
- **Task 46 · Copy and naming fixes** (audit N27; 3 minor; Designer · PM) — Menu tool names differ from tabs; Brief points to a missing ‘Plan & check’; footer says the product is closed. Seen on: CUJ03, 09, MenuA.
- **Task 47 · Ofsted colours everywhere** (audit N23; 2 minor; Designer) — School page and area school list contradict the Ofsted colours decided for the map cap (Task 1c). Seen on: CUJ04, 15.
- **Task 48 · Stitch and motif discipline** (audit N24; 2 minor · 1 idea; Designer) — Stitches used as decoration (step rings, formula inputs); seasonal snowflake hero on /agents. Seen on: CUJ07, 11.
- **Task 49 · Price labels: type and date** (audit N26; 2 minor; PM) — ‘~£497k’ doesn't say 2-bed or typical; Check this home is prefilled with an undated old sale. Seen on: CUJ01, 02.
- **Task 50 · Owner decision: menu flat or accordion** (audit N30; 1 minor; PM) — v4 boards disagree (CUJ-06/07 flat 10 links vs MenuA-v4 accordion); decide before building. Seen on: MenuA, CUJ06, 07.
- **Task 51 · Watch without an agent** (audit N28; 1 idea; PM) — Watch is agent-only and the digest is paused; fall back to portal alerts with area, price and beds filled in. Seen on: CUJ12.
- **Task 52 · Saved areas: what changed** (audit N29; 1 idea; PM) — No ‘since your last visit’ line (new sales, price moves) to bring visitors back. Seen on: CUJ14.
Notes: Task 39 is an owner launch switch (the site stays noindex while private). Task 50 needs an owner decision before the menu is built.

## v4 build plan — owner approval 2026-10-18 (board V4-plan)
- All groups G1–G5 approved as drawn (owner, 2026-10-18).
- Release in four steps v4.0 → v4.3; each one built, reviewed, merged, deployed and checked on prod autonomously, no owner questions (owner checks the final result).
- G5 overlaps are merged into the v4 tasks listed above; one implementation per topic.
- Data for Noise and Clean air is loaded before v4.1 (task D1); their chips stay behind a flag until the data is live (FLAGS.md).
- Task 50: the ≡ menu stays an accordion (Find a place · Tools · Learn); CUJ-06/07 v4 boards follow it.
- Task 39: go public after v4.3 is verified.
- Portal extension (CUJ-17) is a separate track; v4 only passes the search id in portal links (Task 9).
- v4 copies of Journeys/Navigation/Graph/Gaps are the acceptance reference; where they differ from a task board or the spec, the task wins.
- Restrictions (e.g. the removed home-cost estimate, Task 12) are default-off flags in FLAGS.md, not deleted code.

### v4.0 · Fixes & foundations
- **Bugs** — Tasks 23, 24, 25, 26, 27, 30, 31: save-listing 422, names not codes, deep links/error states, overlay clashes, /school & /property 500, Compare, knit form controls.
- **Foundations** — Tasks 10, 13, 18: MapToast, one MapSheet, MapState + Default — everything later builds on these.
- **Data readiness** — Tasks D1: Noise in Real data, LAEI air, Good-value inputs, portal draw-URL check (Task 9).

### v4.1 · My match
- **Model + API** — Tasks 21, 21d, 21e, 8: one soft-edge model, ROC weights from list order, percentile colours, Where as a scored criterion.
- **Panel + flow** — Tasks 21c, 22, 28, 36, 21b: no wizard, chips + Soften, broken-link toast, labelled first visit, one primary.
- **After the match** — Tasks 9, 35, 38, 41: portal links, next step from Brief/Compare, shortlist share redaction, one price across tools.

### v4.2 · Map
- **Markers & layers** — Tasks 1c, 3, 4, 5, 6, 7, 20, 29, 43: school caps, tree/collision heat, collision marker, green, icon atlas, night choropleth, colour-blind default.
- **Controls** — Tasks 2, 11, 14, 15, 19, 33, 32: layer pill, landscape, panel top, click = select, Recent sales, keyboard/screen reader, faster map.

### v4.3 · Pages & polish
- **Pages** — Tasks 12, 16, 17, 34, 40, 44: one area view, one width, borough page, owned v4 blocks, page metadata, Check a home card.
- **Polish** — Tasks 37, 42, 45, 46, 47, 48, 49, 50, 51, 52: chosen state/header, good direction per layer, colour tokens, copy, Ofsted colours, stitch use, price labels, menu accordion, Watch without agent, what changed.
- **Go public** — Tasks 39: after v4.3 is verified on prod: lift basic auth, index + sitemap (CLOSE_KNIT_ACCESS=public).

### G5 merged into v4 tasks
- 28 first visit → 21c
- 36 one primary → 21c + 14
- 43 colour-blind default → 20 + 21e
- 29 night choropleth → 21e + G1
- 25 error states → 10 (+22)
- 32 faster map → 5 + 21e
- 24 area names → 21e rows, Compare, Brief

### D1 · Data readiness (v4.0)
- Noise: find why the layer is "Unavailable in Real data" on prod and load the road-noise data (Lden) into the release.
- Clean air: load LAEI NO₂ (also fills the empty Air tile).
- Good value (21d sort): inputs per area (typical price by home type, score vector); hide under 20 sales.
- Task 9: build one Rightmove and one Zoopla draw-search URL by hand and open it; record the format or the fallback.
