# Close Knit site review — Staff Product Manager lens

Date: 2026-10-10. Build reviewed: local Next dev at http://127.0.0.1:4480 (fixtures, no `CLOSE_KNIT_API_URL`); production (getcloseknit.com, basic-auth beta) was not accessed. Area names ending "preview", the 3-polygon map, 404 for non-SW1A postcodes, and "Not published" for some factors are fixture artefacts and are not penalised as coverage gaps; where the *behaviour* around them is wrong (e.g. dead ends, contradictory copy) it is.

Evidence dir: `scratchpad/site-review/pm/` (scripts `j1*.cjs`–`j5.cjs`, screenshots in `pm/shots/`), shared capture in `scratchpad/site-review/capture/`.

## 1. Product goals, users, success metrics (as I read the docs)

- **Thesis**: help a London household find the part of London that fits it — budget, commute and life — with source-linked evidence rather than listings (DESIGN.md intro; README "home-moving analytics"; ROADMAP-research-driven-features "Why": portals answer "what is listed", people decide on full cost, real worth, hidden risk, where else fits).
- **Accepted journey**: Discover → Set needs → Shortlist → Compare → Inspect → Decide (docs/ux-remediation-2026-09-06/README.md).
- **Segments**: buyers, renters, newcomers, local-market professionals (ROADMAP-research §Segments); agents/AI clients are a first-class channel (ROADMAP-property-intelligence: API + MCP, "map is one client among others"; /claude page).
- **Success metrics** (proposed, not yet baselined): trust/comprehension, decision usefulness (trade-off + next investigation), efficiency (time and tabs to a defensible shortlist), **adoption = voluntary return to a saved shortlist and use of comparison/brief**, willingness to pay for a one-off brief or enhanced comparison (proptech-gap-analysis 02 §Measures; london-user-validation-protocol §Measures/§Success rules). The validated surface is shortlist comparison, trade-off relaxation and the decision brief (protocol §Method).
- **Launch gates**: RELEASE-CHECKLIST real-data walk, privacy/legal (ICO, LIA, objection flow), going-public (noindex lifted, /claude, find-a-home.zip). Kept non-goals: no per-property valuation/AVM, no admission probabilities, no "best neighbourhood", no listings (ROADMAP-research §Kept non-goals).

## 2. Journeys (ranked by importance)

Scale 1–5 (5 best-in-class, 3 acceptable with gaps, 1 broken). Axes: clarity, task completion, trust, visual, performance, accessibility & mobile, value, time-to-value, retention.

### J1 · cuj-find-my-area — Personal shortlist via "Find my area" (CUJ) — overall 3.1
Persona: couple buying a 2-bed, ≤£650k, one commute. Goal: a ranked list of areas that fit.
Why critical: it is "the product's one big action" (styles/knit-ui.css:66, layout.css:93) and the Set needs → Shortlist steps; AE-08/AE-16 are P0/P1 in the gap analysis.
Steps walked (desktop 1440 and mobile 390, `pm/j1c.cjs`): `/` → Find my area → budget 650000, 2 bedrooms, place "Westminster" (option) → Continue → Safer streets = Matters, Near a station = Must have → Show areas → `/?layer=personal-match…`. 9 interactions, ~6.4 s scripted; 0 console errors.

| Axis | Score | Rationale | Evidence |
|---|---|---|---|
| clarity | 3 | 2-step wizard is plain; results header "Your top 50 matches" with 2 results, jargon "station-access fit 22/100 is below your minimum of 50" | pm/shots/j1-results-d.png, j1-step2-d.png |
| task completion | 3 | Completes; but place search "Bank" returns Bankside, not Bank station; must-have relax works | j1b output (PLACE-OPTS) |
| trust | 2 | Areas ~£840k and ~£728k shown as "Fits" under a £650k budget (only "Compromise: Price"); agent brief link ranks a 29%-over-budget area #1 at "82 match" | j1c RESULTS; pm/shots/j3-brief-link-d.png |
| visual | 4 | Calm knitted modal, clear segmented controls | j1-step2-d.png |
| performance | 4 | Results ~2 s after submit, no errors | j1c timing |
| accessibility | 3 | Works at 390 px; floating compare tray overlaps the ruled-out list text on mobile | pm/shots/j1-results-m.png |
| value | 4 | Directly delivers the thesis (budget + commute + priorities → areas) | ROADMAP-personal-area-match §Web journey |
| time-to-value | 3 | ~9 inputs before any personalised result; no example/default to see the aha first | j1c clicks=9 |
| retention | 2 | Profile only in localStorage; no prompt to save/return | LS keys in j1e |

Top issues: over-budget areas reported as fits / ranked first; empty "top 50" framing; factor-ID jargon; no instant example.

### J2 · cuj-compare-brief — Compare 2–4 areas, save shortlist, export decision brief (CUJ) — overall 2.7
Persona: same household narrowing to two areas before viewings. Goal: a defensible, sourced shortlist they can share.
Why critical: this is exactly the surface AE-34 tests and the proposed paid output (protocol §Method; gap-analysis 02 "paid one-off decision brief"); "Adoption" = return to saved shortlist.
Steps walked (`pm/j1d.cjs`, `pm/j1e.cjs`, desktop + mobile): from J1 → tick Compare on both → Compare areas → close → Saved areas & costs → name "Test move" → Save shortlist → Preview decision brief → reload. 16 interactions, ~12 s scripted.

| Axis | Score | Rationale | Evidence |
|---|---|---|---|
| clarity | 2 | Comparison shows `uk:lsoa:E01000001 · observed · preview-price-2026-06`, "weight 0 · Not published" rows, release IDs; headline tie 73/73 | j1d COMPARE; pm/shots/j1-compare-m.png |
| task completion | 3 | Save, share, Markdown download and print all present; brief is behind a collapsed "Saved areas & costs" disclosure | j1e BTNSB |
| trust | 2 | List shows "Westminster station 14 min", compare says "Commute · Not published", brief says "No commute destinations recorded"; brief states "target budget £500,000" the user never set; "Known monthly total £0" right after "never zeroed"; compare uses "600,000 budget fit" while list says ~£840k | j1d/j1e output |
| visual | 2 | Close/Remove look like browser-default grey buttons; translucent dialog shows the page through on mobile | pm/shots/j1-compare-m.png |
| performance | 4 | Instant, no errors | j1e |
| accessibility | 3 | Proper checkbox roles for compare; mobile stacks rows but dense | personal-match-panel.tsx:452-458 |
| value | 4 | Strongest differentiator vs portals when it works (trade-off sentences are good) | brief "Trade-offs" section |
| time-to-value | 2 | 16 interactions from landing to brief | j1e clicksToBrief |
| retention | 2 | Shortlist persists only in this browser; after reload it is hidden (not surfaced) | j1e RELOAD-HAS-SAVED false |

Top issues: contradictory commute/budget between list, compare and brief; internal IDs in user copy; unstyled dialog controls; shortlist invisible on return.

### J3 · cuj-postcode-area-check — Search a postcode/address → area evidence → full area page (CUJ) — overall 4.2
Persona: someone with a listing or viewing in hand. Goal: "what is this area like and what does a home cost here?"
Why critical: Discover/Inspect; area-clarity goal "a buyer understands an area at a glance" (docs/area-clarity-2026-10/TASKS.md); release walk items 3, 5, 6.
Steps walked: capture search flow (type "SW1A" → SW1A 1AA → panel), `/postcode/SW1A-1AA`, `/area/lsoa/E01000001`; unknown postcode "NW3 2AB" + Enter (`pm/j4.cjs`).

| Axis | Score | Rationale | Evidence |
|---|---|---|---|
| clarity | 4 | At-a-glance scorecard in plain words; "what a home costs here" with size chips | capture/text/home-selected-d.txt, area-lsoa-d.txt |
| task completion | 4 | 2–3 interactions; but an unmatched postcode is offered as an option and Enter lands on a bare Next 404 | j4 ENTER-> "This page could not be found." |
| trust | 4 | "Rough guide", per-card sources, demo label; minor inconsistency (station walk 4 min on postcode page vs 5 min on area page) | postcode-d.txt vs area-lsoa-d.txt |
| visual | 4 | Clean cards and charts | capture/shots/area-lsoa-d.png |
| performance | 4 | Warm idle 0.6–1.5 s, 0 console errors | capture/INDEX.md |
| accessibility | 4 | Skip link, mobile layout works | capture/shots/area-lsoa-m.png |
| value | 4 | Answers the newcomer/buyer questions (cost, crime, station walk, flood, schools) | ROADMAP-research Wave 1 |
| time-to-value | 5 | Aha in one search | search-results.json |
| retention | 1 | Area page CTAs are only "Back to the map"/"Open on map": no save, compare, like, share or watch | j2 output vis list |

Top issues: no save/compare/watch on area and postcode pages; dead-end 404 for unmatched postcodes.

### J4 · cuj-claude-agent — Use with Claude → brief link back to the site (CUJ) — overall 3.8
Persona: AI-native searcher who prefers to talk to Claude. Goal: install once, get a shortlist and a watch for new listings.
Why critical: ROADMAP-property-intelligence repositions toward API/MCP ("map is one client"); the watch for new homes is the product's only alert mechanism; RELEASE-CHECKLIST going-public checks /claude and the zip.
Steps walked: `/claude` (copy buttons, `/downloads/find-a-home.zip` → 200, 8.6 KB), agent brief fragment `/brief#brief=v1.<payload>` (`pm/j3.cjs`) → redirects to `/?layer=personal-match&selected=…` in ~2.6 s; `/brief#brief=v1.broken` → "This brief link is incomplete." Not walked: a live Claude conversation (out of scope; MCP not reachable from this session).

| Axis | Score | Rationale | Evidence |
|---|---|---|---|
| clarity | 4 | Clear 3-step setup for app and Claude Code; "what Claude sees" section | capture/text/claude-d.txt |
| task completion | 3 | Manual custom-connector setup (Settings → Connectors → paste URL) is high-friction for non-developers | claude-d.txt |
| trust | 4 | States preferences not stored, no listings collected, ballparks are not valuations | claude-d.txt |
| visual | 4 | Consistent with site | capture/shots/claude-d.png |
| performance | 4 | Brief link resolves to map in 2.6 s, 0 errors | j3 T |
| accessibility | 4 | Copy buttons labelled | j2 vis |
| value | 4 | Strategic channel; brief link lands with search summary, Like/Not for me/Note, monthly cost | pm/shots/j3-brief-link-d.png |
| time-to-value | 3 | Value only after install + conversation | — |
| retention | 4 | Watch runs as a scheduled task in the user's Claude — a real return hook, but invisible on the site and no link back | agents/README.md:41 (`build_watch_spec`) |

Top issues: over-budget #1 on landing (same as J1); site never offers the watch to web-only users.

### J5 · hp-sold-price-property — Address → property page (sales, estimate, stamp duty) (happy path) — overall 3.6
Persona: buyer checking whether an asking price is fair. Goal: achieved prices in the building/street.
Why: research Wave 1 #3 "sales in the same building and street"; release walk items 3, 7, 8.
Steps walked: capture search "10 Sample Street" option, `/property/100000000001`, `/tools/stamp-duty?price=295000`.

| Axis | Score | Rationale | Evidence |
|---|---|---|---|
| clarity | 4 | Last sale → restated value, £/m² vs median, sales table | capture/text/property-d.txt |
| task completion | 4 | Direct; stamp duty link from area page | area-lsoa-d.txt |
| trust | 3 | Headline "Estimated price ~£668k" per home sits against the kept non-goal "no individual property valuation or AVM figure"; per-sale floor area/£/m² is the open EPC-licence question; hiding a home requires "Select the address on the map" | ROADMAP-research §Kept non-goals and §Risk; property-d.txt |
| visual | 4 | EPC band graphic, clean table | capture/shots/property-d.png |
| performance | 4 | 0.6–0.8 s idle | INDEX.md |
| accessibility | 4 | Table semantics | property-d.txt |
| value | 3 | Portals already show sold prices; differentiation is £/m² context | gap-analysis 01 |
| time-to-value | 5 | One search | — |
| retention | 1 | Only "Share"; no "watch this street/building" | j2 vis |

### J6 · hp-intent-explore — Intent chip ("Good coffee") → layer → Add to my match (happy path) — overall 3.7
Persona: newcomer browsing for lifestyle fit. Goal: see where the thing they care about is.
Why: home's first visible controls (capture INDEX "Home primary controls"); bridges Discover → Set needs.
Steps walked (`pm/j5.cjs`): `/` → Good coffee → `?layer=custom%3Agood-coffee` in ~3.1 s → Most/Fewest lists → "Add to my match" present.

| Axis | Score | Rationale | Evidence |
|---|---|---|---|
| clarity | 4 | Most/fewest lists, "How this works" | j5 output |
| task completion | 5 | One click | j5 |
| trust | 3 | Counts of "specialty coffee" with method link; source not named inline | j5 |
| visual | 4 | Clean legend | pm/shots/j5-coffee-d.png |
| performance | 4 | ~3 s to repaint | j5 ms |
| accessibility | 3 | Not deeply tested; chip row scrolls off-screen on mobile with no affordance | pm/shots/home-fold-m.png |
| value | 3 | Engagement more than decision; good bridge via "Add to my match" | j5 |
| time-to-value | 5 | Instant | — |
| retention | 2 | Nothing to keep | — |

### J7 · hp-rankings-seo — Rankings → list → area page (happy path, acquisition) — overall 3.2
Persona: organic searcher ("most expensive areas London"). Goal: a credible list that leads into the product.
Why: the only SEO-shaped content plus guide; ROADMAP-property-intelligence success criterion "stable property/area URLs serve structured HTML + JSON-LD".
Steps walked: `/rankings`, `/rankings/most-expensive` (links to `/area/msoa/E02000001`), meta/robots/sitemap checks (`pm/j2.cjs`, curl sitemap.xml).

| Axis | Score | Rationale | Evidence |
|---|---|---|---|
| clarity | 4 | Simple table, borough column | capture/text/ranking-most-expensive-d.txt |
| task completion | 4 | Rows link to area pages | j4 RANK-LINKS |
| trust | 3 | "middle of 1 neighbourhoods" grammar (fixture count but real string bug) | ranking-most-expensive-d.txt |
| visual | 3 | Plain table, little hierarchy | capture/shots/ranking-most-expensive-d.png |
| performance | 4 | 0.6–0.8 s | INDEX.md |
| accessibility | 4 | Real table | — |
| value | 2 | noindex is correct for beta, but no canonical, OG image or JSON-LD on any page; sitemap has 17 URLs (no guide, tools, glossary, /claude, postcode pages) | j2 output; sitemap count |
| time-to-value | 4 | Immediate list | — |
| retention | 1 | No path to save/compare from a ranking | — |

## 3. Cross-cutting findings

- **No funnel instrumentation at all.** `telemetryProfile()` exists (web/src/lib/matching.ts:380) but nothing calls it; the privacy notice promises no cookies and no third-party analytics (app/privacy/page.tsx:162-164). The gap-analysis measures (efficiency, adoption, reuse) cannot be observed outside moderated sessions.
- **Retention hooks are local-only and hidden.** Saved shortlists, likes and notes live in localStorage (`close-knit.saved-shortlists.v1`, etc.); after reload nothing surfaces them. The only alerting is the Claude scheduled-task watch, which the website never offers.
- **Contradictions between surfaces erode trust** (budget fit, commute, station walk minutes, £0 totals) — the exact "comprehension of uncertainty" measure AE-34 uses to block claims.
- **Launch readiness**: legal items in RELEASE-CHECKLIST (ICO number, LIA, SMTP for objection) are ops items not verifiable here; on the site the objection entry point exists only inside the map evidence panel (evidence-panel.tsx:642).

## 4. Proposals (ranked)

| # | Title | Impact | Effort | Confidence |
|---|---|---|---|---|
| 1 | Respect the budget in ranking and labels | high | M | high |
| 2 | One commute truth across list, compare and brief | high | M | high |
| 3 | Humanise comparison and brief copy; no phantom inputs | high | S | high |
| 4 | Cookieless first-party funnel counter | high | M | medium |
| 5 | Save / compare / like on area, postcode and property pages | high | M | high |
| 6 | "Welcome back" resume card | high | S | high |
| 7 | Offer the watch on the web | medium | M | medium |
| 8 | Instant example match (time-to-aha) | medium | S | medium |
| 9 | Unmatched postcode and branded 404 | medium | S | high |
| 10 | Resolve per-home "Estimated price" vs non-goal | high | S | medium |
| 11 | Direct "Report or hide this home" on property/postcode pages | medium | S | high |
| 12 | Style and solidify the comparison dialog | medium | S | high |
| 13 | Match-result copy fixes | medium | S | high |
| 14 | SEO readiness for going public | medium | M | medium |
| 15 | Persistent mobile "Find my area" entry | low | S | medium |

### P1 Respect the budget in ranking and labels
- Problem: with a £650k budget, results show ~£840k and ~£728k areas tagged "Fits" (only "Compromise: Price"); the agent brief link ranks a 29%-over-budget area #1 with "82 match" (pm/shots/j3-brief-link-d.png). Gap analysis 01 already calls out "production score does not react to budget" (AE-08).
- Change: in lib/matching.ts and api/area_api/matching.py treat ballpark > max budget as an unmet soft limit that caps the score (or sort within-budget first); row label "Over budget by 29%" instead of "Fits"; group "Within budget" / "Stretch" in the list.
- Improves: J1, J2, J4 trust and value; AE-34 comprehension measure.
- Affects: web + API scorer parity (agents/smoke_mcp_http.py parity check), MCP `find_areas` output, Playwright my-match specs and snapshots; risk of empty result sets in expensive boroughs → needs "Relax budget" control (exists for other limits).

### P2 One commute truth across list, compare and brief
- Problem: list shows "Westminster station 14 min", comparison shows "Commute · weight 0 · Not published", brief says "No commute destinations recorded" (j1d/j1e output).
- Change: feed the same journey minutes the list uses into area-comparison.tsx and decision-brief.tsx; if the minutes are an estimate, label it the same way everywhere; record destination label (redacted by default) in the brief.
- Improves: J2 trust and clarity; J1 value.
- Affects: brief redaction rules (AE-09 privacy: destination stays redacted unless opted in), lib/journeys.ts, brief-model encoding parity with api/area_api/share_links.py.

### P3 Humanise comparison and brief copy; no phantom inputs
- Problem: user-facing `uk:lsoa:E01000001 · observed · preview-price-2026-06`, "weight 0" rows, "600,000 budget fit"; brief invents "target budget £500,000" (DEFAULT_PROFILE) and prints "Known monthly total £0" after "never zeroed".
- Change: move IDs/releases behind a "Sources" disclosure; collapse unpublished factors into one line "Not available yet: commute, schools, market, growth"; format money (£600k); only state inputs the user set; when all costs are unknown show "Add a price to see monthly costs" instead of £0.
- Improves: J2 clarity/trust; J4 brief landing.
- Affects: decision-brief Markdown export (snapshot tests), area-comparison.tsx, i18n-free copy; low risk.

### P4 Cookieless first-party funnel counter
- Problem: no measurement of activation, compare, save, brief export or return; `telemetryProfile` unused (lib/matching.ts:380); privacy page promises no analytics.
- Change: POST `/api/v1/events` with an enum event name + release + mode only (no IDs, no IP stored, no cookies), aggregated per day in Postgres; events: landing, wizard_step1_done, results_shown, compare_opened, shortlist_saved, brief_previewed/exported, brief_link_opened, claude_copy, objection_started. Small private dashboard.
- Improves: every journey's measurability; gap-analysis "Efficiency" and "Adoption" measures; prioritisation.
- Affects: privacy notice + LIA update (docs/legal), rate limiter, API schema/migration; PECR: strictly no device storage so no consent banner; must not log raw profiles (gap-analysis 02 rule).

### P5 Save / compare / like on area, postcode and property pages
- Problem: /area, /postcode and /property pages offer only "Back to the map"/"Open on map"/"Share" (j2 vis); the most-viewed evidence surface cannot feed the shortlist.
- Change: add "Save area" (same `saved-shortlists` store and profile marks.liked) and "Add to compare" buttons to the area-full-page header and postcode "Living here" card; on property pages "Save this home" into user candidates (user-candidates.tsx).
- Improves: J3, J5, J7 retention; J2 entry; Adoption metric.
- Affects: shared store module (lib/saved-shortlists.ts), area-full-page.tsx, postcode page; server components need a client island; no API change.

### P6 "Welcome back" resume card
- Problem: after reload the saved shortlist "Test move" is not visible anywhere (j1e RELOAD-HAS-SAVED false) although localStorage holds it.
- Change: on load, if saved shortlists or a non-default profile exist, show a dismissible card in the panel/intro slot: "Welcome back — Test move (2 areas) · Open · Brief"; replaces the first-visit intro.
- Improves: J1/J2 retention and time-to-value on return; Adoption metric (observable via P4).
- Affects: intro-dismissed logic (`close-knit.intro-dismissed.v1`), home layout on mobile sheet; storage-denied fallback must render nothing.

### P7 Offer the watch on the web
- Problem: the only retention mechanism (Claude scheduled-task watch via `build_watch_spec`, agents/README.md:41) is invisible on the site.
- Change: on saved shortlist and area page, "Watch new listings here" → modal with a copyable prompt/deep link for Claude (phase 1); phase 2 opt-in double-confirmed e-mail digest reusing the SMTP path built for objections.
- Improves: J3, J4 retention; return-visit metric.
- Affects: phase 2 needs consent text, unsubscribe, storage of e-mail (privacy notice, LIA, ICO), and a listings-free design (portal search links only, per non-goal "no listings").

### P8 Instant example match (time-to-aha)
- Problem: 9 inputs before any personalised result (j1c).
- Change: in step 1 add "Show me an example" (e.g. buy, 2-bed, £600k, King's Cross ≤30 min) that renders results immediately with an "Edit to make it yours" banner; or allow "Show areas" after budget alone.
- Improves: J1 time-to-value and clarity; wizard completion rate (P4).
- Affects: example must be clearly labelled as an example, not saved as the user's profile; e2e for the wizard.

### P9 Unmatched postcode and branded 404
- Problem: typing "NW3 2AB" offers "NW3 2AB: prices and sales" and Enter lands on Next's bare "This page could not be found." (j4). With real data the same happens for out-of-London or new postcodes.
- Change: only offer the postcode row when the search API returns it; otherwise inline "We don't have NW3 2AB yet — nearest covered area: …"; add `app/not-found.tsx` with search box, map link and guide.
- Improves: J3 task completion, robustness.
- Affects: search route contract, RELEASE-CHECKLIST item 6 (`/postcode/nope` must still 404 — keep status, change body).

### P10 Resolve per-home "Estimated price" vs the non-goal
- Problem: `/property/100000000001` headlines "Estimated price ~£668k · medium confidence" while ROADMAP-research keeps "no individual property valuation or AVM figure" and the EPC floor-area-per-sale licence question is open (DATA-LICENCES.md, ROADMAP-research §Risk).
- Change: owner decision before going public: either rename to "Last sale restated by the area index (not an estimate of value)" and demote below sales history, or remove; gate per-sale £/m² behind the licence answer.
- Improves: J5 trust; legal launch readiness.
- Affects: property page, MCP `get_stock_value` wording, map tooltip "value today", /claude copy ("Ballpark prices are never valuations"); possible SEO/PR risk if left.

### P11 Direct "Report or hide this home" on property and postcode pages
- Problem: property and postcode pages say "Select the address on the map to report an error or hide it"; the button only exists in the map evidence panel (evidence-panel.tsx:642). It is a privacy launch gate (RELEASE-CHECKLIST "Objection flow end to end").
- Change: render the same objection form/button on `/property/[uprn]` and each home row on `/postcode/[code]/homes`.
- Improves: trust axis in J3/J5; legal readiness.
- Affects: objection API quotas, e2e for objection, privacy notice links.

### P12 Style and solidify the comparison dialog
- Problem: Close/Remove render as browser-default grey buttons and the dialog is translucent on mobile so page text shows through (pm/shots/j1-compare-m.png), despite area-clarity "14 browser-default buttons styled".
- Change: apply knit button classes in area-comparison.tsx; opaque `--surface` dialog background and a backdrop; extend e2e/unstyled-controls.spec.ts to open the dialog.
- Improves: J2 visual, accessibility (contrast), perceived quality.
- Affects: snapshot baselines; DESIGN.md §7 compliance.

### P13 Match-result copy fixes
- Problem: "Your top 50 matches" with 2 results; "station-access fit 22/100 is below your minimum of 50"; "Relax Station Access limit"; rankings "middle of 1 neighbourhoods".
- Change: "Your 2 matches"; "Walk to a station is longer than you allow"; sentence-case factor names; pluralise rankings.
- Improves: J1, J7 clarity and trust.
- Affects: copy only; test string updates.

### P14 SEO readiness for going public
- Problem: no canonical, OG image or JSON-LD on any page (j2); sitemap has 17 URLs and omits guide, tools, glossary, /claude and postcode/area pages beyond fixtures; the property-intelligence roadmap requires structured HTML + JSON-LD on stable URLs.
- Change: `generateMetadata` canonical + OG image per route; JSON-LD (`Place` for areas, `Dataset`/`citation` for evidence); sitemap index including guide/tools/glossary and all area pages from the API.
- Improves: J7 value; future acquisition; agent (AEO) discoverability.
- Affects: must stay noindex until going public (RELEASE-CHECKLIST); build time for large sitemaps (stream from API); avoid indexing per-home pages until P10 resolved.

### P15 Persistent mobile "Find my area" entry
- Problem: on mobile the top-bar "Find my area" is hidden (offsetParent null, j4 MOBILE-HOME); after dismissing the intro it lives only in the ≡ menu.
- Change: show a compact "Find my area" chip in the bottom sheet header on mobile when no profile exists.
- Improves: J1 discoverability on mobile.
- Affects: sheet layout, map control collision rules (UX-20).
