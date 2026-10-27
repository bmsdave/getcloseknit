# Close Knit site review: October 2026

Four staff-level reviews of the Close Knit website (UX design, CSS/front end, product, sales/GTM), merged into one report.

- Date: 2026-10-10
- Build reviewed: the local Next dev server at `http://127.0.0.1:4480`. It ran from the `site-launch-prep-3bc234` worktree with in-process fixtures and no `CLOSE_KNIT_API_URL`.
- Production (`getcloseknit.com`) sits behind private-beta basic auth. No reviewer accessed it.
- Role reports: [UX](roles/ux.md) · [CSS / front end](roles/css.md) · [Product](roles/pm.md) · [Sales / GTM](roles/sales.md)

---

## 1. Executive summary

**Verdict.** Close to ready for the AE-34 validation study, not yet for going public. The evidence surfaces are strong: postcode to area 3.9/5, property check 3.9, evidence pack 4.3. There is no horizontal page overflow at 320–1440 px and there are no console errors (one menu does open off-screen at 320 px, see #22). The core proposition, **Find my area → compare → brief, scores 3.1**, and sharing scores **2.9**.

**Biggest risks**
1. **The numbers contradict each other.** Card, compare and brief disagree on budget and commute; over-budget areas are listed as "3 areas meet your must-haves" with a green commute "Fits" chip beside the over-budget price and only a small "! Price" mark; and the brief credits the user with defaults. Trust averages 2.5, which threatens the AE-34 stop rule.
2. **Gaps before going public.** "Report or hide" is reachable only from the map panel. The per-home "Estimated price" conflicts with the no-AVM non-goal. There is no branded 404.
3. **Nothing is measured.** There are no funnel events, and saved shortlists are never surfaced when a user returns.

**Biggest opportunities**
1. Make compare and brief agree (S/M work), lifting C1, the weakest CUJ scored by all four roles, by about 1 point (C6 is lower at 2.9 but has a single rater).
2. A sharing loop: OG cards, visible share and a "Shared with you" view.
3. The value proposition as the h1 with a source proof strip, plus next-step CTAs on area and property pages.

---

## 2. Product goals: the reviewers' shared reading

All four roles read the goals the same way. The differences are in emphasis only.

| Topic | Shared reading | Emphasis by role |
|---|---|---|
| Proposition | A map-first London tool that links budget, commute, achieved prices and area evidence into a **shortlist and a decision brief**, using source-linked evidence rather than listings (README, DESIGN.md, proptech-gap) | Sales: "free, open, source-linked"; PM: "help a household find the part of London that fits" |
| Journey | Discover → Set needs → Shortlist → Compare → Inspect → Decide (ux-remediation README) | UX adds visible staging (ux-audit P1.1). CSS adds the area-at-a-glance goal (area-clarity TASKS) |
| Users | London buyers and renters, especially movers to unfamiliar areas (validation protocol › Sample). Secondary: homeowners who object to being shown, Claude/MCP users | PM also lists local-market professionals |
| Success measures | Proposed, with **no baseline yet**: comprehension of achieved vs asking price and of missing data; decision usefulness; time and tabs compared with portals; **voluntary return** to a saved shortlist; **willingness to pay** for a brief (02-PRIORITIES › Measures, AE-34) | UX adds the stop rule: users treating preview data as official |
| Constraints | RELEASE-CHECKLIST: works from 320 px, compare 2–4 areas readable, Real mode never shows preview data, gate passes. Kept non-goals: **no per-home AVM, no listings, no admission odds**. No demand or payment claims until AE-34 reports. No business model that biases rankings | CSS adds DESIGN.md rules: tokens only, 44 px targets, `--focus` outline, Night parity |

How this report reconciles them: "success" means passing AE-34 comprehension first (trust), then adoption (return, compare, brief), then a commercial signal. Proposals that would weaken the first, such as ranking over-budget areas or demand claims, rank below fixes that protect it.

---

## 3. Canonical journeys (ranked by importance)

The roles found 29 journeys between them; these merge into 11. CUJ = critical user journey; HP = happy path.

| # | Journey | Kind | Found by (role ids) | Why it ranks here |
|---|---|---|---|---|
| **C1** | **Find my area → matches → compare → save → decision brief** | CUJ | UX `cuj-find-my-area`, CSS `cuj-find-my-area-compare`, PM `cuj-find-my-area` + `cuj-compare-brief`, Sales `cuj-find-my-area-shortlist` | The proposition under test in AE-34. All four roles found it |
| **C2** | **Search a postcode/address or tap the map → area at a glance → full area page** | CUJ | UX `cuj-postcode-check`, CSS `cuj-map-search-select`, PM `cuj-postcode-area-check` | The most common entry with a listing in hand. It feeds C1 |
| **C3** | **First visit: understand what this is and choose a way in** | CUJ | UX `cuj-first-visit`, Sales `cuj-first-visit-value` | Gates every journey once the site is public |
| **C4** | **Check a specific home: sales history, price fairness, stamp duty and money tools** | HP | UX `hp-property-check`, CSS `cuj-postcode-homes-property` + `hp-money-tools`, PM `hp-sold-price-property`, Sales `hp-listing-price-check` | High-intent due diligence. It carries the AVM non-goal risk |
| **C5** | **Trust and objections: homeowner reports or hides a home; sceptic checks who runs this** | CUJ | UX `cuj-home-objection`, Sales `cuj-trust-objections` | A legal launch gate (ICO, LIA) |
| **C6** | **Shared shortlist link → recipient → their own search** | CUJ | Sales `cuj-share-referral-loop` | Joint household decisions and the referral loop |
| **C7** | **Use with Claude: connect the MCP, guided search, brief link back to the site** | HP / CUJ (PM) | UX `hp-claude-setup`, PM `cuj-claude-agent`, Sales `hp-use-with-claude` | A first-class second channel (ROADMAP-property-intelligence) |
| **C8** | **Direct or organic landing: an area page from a shared link, or rankings → area** | CUJ / HP | CSS `cuj-area-page-direct` + `hp-rankings-to-area`, PM `hp-rankings-seo`, Sales `hp-seo-rankings-to-area` | Acquisition and SEO/AEO once public |
| **C9** | **Explore by lifestyle chip → layer → add to my match** | HP | UX `hp-lifestyle-lens`, PM `hp-intent-explore` | A discovery hook for newcomers |
| **C10** | **Print or save the area evidence pack** | HP | CSS `hp-evidence-pack-print` | The "Decide" output for sharing |
| **C11** | **(?) help → guide article → glossary** | HP | CSS `hp-learn-guide` | Supports comprehension |

All 29 role journeys were walked with headless Playwright on desktop and mobile. See §6 for what was not verified.

---

## 4. Score matrix (1–5; each cell is the mean across the roles that scored it)

**Overall** is the mean of each role's own overall score, and each role's overall also includes its role-specific axes (learnability, tone, time-to-value, retention, value-proposition strength, conversion; listed below the table). It is therefore not the mean of the seven shared columns. For example, C6's shared columns average 3.1, but Sales value-proposition 2 and conversion 2 pull its overall to 2.9.

When one role scored two sub-journeys that merge into the same canonical journey, those two are averaged first, so each role carries the same weight. ⚠ marks a role-level spread of 2 points or more.

| Journey | Clarity | Task / friction | Trust | Visual & interaction | Perf & robustness | A11y & mobile | Value vs goals | **Overall** | Roles |
|---|---|---|---|---|---|---|---|---|---|
| C1 Find my area → brief | 3.1 | 3.5 | **2.5** | **2.5** | 4.0 | 3.0 | 3.8 | **3.1** | 4 |
| C2 Postcode → area | 4.0 | 4.0 | 4.0 | 4.0 | 3.7 | 3.7 | 4.0 | **3.9** | 3 |
| C3 First visit | 3.0 | 4.0 | 3.5 | 3.5 | 4.0 | 3.0 | 3.0 | **3.2** | 2 |
| C4 Property check | 4.0 | 3.6 | 4.2 ⚠ | 3.9 | 4.2 | 3.6 | 3.6 | **3.9** | 4 |
| C5 Trust & objection | 3.5 | 3.0 ⚠ | 3.5 | 3.5 | 3.5 | 3.5 | 3.0 | **3.2** | 2 |
| C6 Share / referral | **2.0** | 3.0 | 4.0 | 3.0 | 4.0 | 3.0 | 3.0 | **2.9** | 1 |
| C7 Use with Claude | 4.0 | 3.3 | 4.0 | 4.0 | 4.0 | 4.0 | 4.0 | **3.8** | 3 |
| C8 Direct / organic landing | 4.0 | 3.7 | 3.5 | 3.3 | 4.2 | 4.0 | 2.8 | **3.4** | 3 |
| C9 Lifestyle lens | 3.5 | 4.5 | 3.0 | 4.0 | 4.0 | 3.0 | 3.0 | **3.5** | 2 |
| C10 Evidence pack print | 4.0 | 4.0 | 5.0 | 4.0 | 5.0 | 4.0 | 4.0 | **4.3** | 1 |
| C11 Help → guide | 4.0 | 4.0 | 4.0 | 4.0 | 5.0 | 4.0 | 3.0 | **4.0** | 1 |

**Disagreements (⚠)**
- **C4 trust (UX 5, Sales 5, CSS 4, PM 3).** PM marks it down for the per-home "Estimated price", which conflicts with the no-AVM non-goal and needs legal sign-off. UX and Sales scored the sourcing (HM Land Registry links). Both are right: the sourcing is excellent, but the estimate is a policy risk.
- **C5 task (UX 2, Sales 4).** UX walked the homeowner objection path, which has no action on the property or postcode pages. Sales walked the sceptic's path (sources, privacy, terms), which works.
- **Hidden inside C1 means:** at sub-journey level, PM rated the wizard's visuals 4 but the compare/brief 2, and UX and CSS rated compare 2. Clarity ranges from PM compare/brief 2 to Sales 4. The low scores sit on the **compare dialog and brief**, not on the wizard.

### Role-specific axes and key evidence

**C1 Find my area → brief (3.1)**
- Role axes: UX learnability **2**, emotional tone 3. CSS layout robustness 4, front-end performance 4. PM time-to-value 3 / 2, retention **2 / 2**. Sales value-proposition strength 4, conversion **2**.
- Evidence: with a £600k budget, every card shows about £686k–£840k, the header says "3 areas meet your must-haves", and each card carries a "Fits" chip. The chip is the commute check (`personal-match-panel.tsx:493`), but it sits right after the over-budget price, and price is flagged only by a small "! Price" mark (`ux/shots/j1-results-d.png`, re-checked by the critic). The compare dialog shows "440,000 budget fit" and "Commute · Not published" where the card says 26 min. The brief claims "target budget £480,000 … weights you set" and shows £0 known costs ([ux J1](roles/ux.md), [pm J2](roles/pm.md)). The dialog has browser-default buttons and is see-through on mobile (`area-comparison.tsx:106`, `globals.css:328-341`). Match-panel text is 8–9 px, with 13 px checkboxes ([css J2](roles/css.md)). The brief is hidden inside the collapsed "Saved areas & costs" section (`decision-brief.tsx:99`). Share gives no feedback and makes a huge URL ([sales](roles/sales.md)).

**C2 Postcode → area (3.9)**
- Role axes: UX learnability 4, tone 4. CSS layout 3, front-end perf 3. PM time-to-value **5**, retention **1**.
- Evidence: search suggests a postcode row even when the postcode is unknown, which ends on the bare Next 404 (no `app/not-found.tsx`). In landscape and short viewports the sheet shows no evidence tiles, and the legend takes about 150 px of the phone sheet. The home page loads about 503 KB of gzipped JS (396 KB of it MapLibre). Nothing lets you save, compare or watch from area or postcode pages.

**C3 First visit (3.2)**
- Role axes: UX learnability 3, tone 4. Sales value-proposition strength **2**, conversion **2**.
- Evidence: the h1 is a panel prompt, not the value proposition, and there is no 3-step explanation. The Tube overlay clutters the overview zoom. The demo label is small. Nothing on mobile shows that the chip row scrolls, and the intro card is tall. There is no OG metadata.

**C4 Property check (3.9)**
- Role axes: UX learnability 4. CSS layout 3 / 4, front-end perf 5. PM time-to-value 5, retention **1**. Sales value-proposition strength 4, conversion 3.
- Evidence: the "More" menu opens at L = −103 px at 320 px. The 7-column table has no mobile pattern, and its scroll region cannot be focused by keyboard (the axe rule `scrollable-region-focusable`, judged by hand; axe itself was not run). There is no asking-price check, no report/hide action on the page, and no save or watch.

**C5 Trust & objection (3.2)**
- Role axes: UX learnability 3. Sales value-proposition strength 3, conversion 2.
- Evidence: the objection entry point exists only in the map evidence panel (`evidence-panel.tsx:642`). "Open on the map" drops the selected address. There is no About page or named operator, and no general feedback channel. The submission round trip was not verified because there is no local SMTP.

**C6 Share / referral (2.9)**
- Role axes: Sales value-proposition strength **2**, conversion **2**.
- Evidence: there is no OG card, no "Shared with you" framing for the recipient, and no feedback when the link is copied. The recipient gets no call to action ([sales](roles/sales.md)).

**C7 Use with Claude (3.8)**
- Role axes: UX learnability 3. PM retention **4**, which is the only working "watch" loop. Sales conversion 2.
- Evidence: the entry sits behind the menu. Connector setup is manual and full of jargon, with no screenshots or sample conversation. **The /claude MCP URL falls back to `http://127.0.0.1:8080/mcp` when `CLOSE_KNIT_PUBLIC_URL` is unset** (`app/claude/page.tsx:17`; seen on the local page). The brief landing ranks an over-budget area #1, the same root cause as C1.

**C8 Direct / organic landing (3.4)**
- Role axes: CSS front-end perf **2** on the area page and 5 on rankings, layout 3. PM retention 1. Sales conversion 2.
- Evidence: the area page has a **CLS of 0.34 at 768 px** (`area-full__sources`, `overview-home`). This is one dev-server sample on one fixture area; the other widths measured ≤ 0.095, so re-measure on a prod build before relying on the score of 2. `overflow-wrap:anywhere` breaks words mid-word. There is no canonical, JSON-LD or OG image, and the sitemap omits guide, tools, glossary and /claude (`app/sitemap.ts` lists only /, London, rankings and area pages; the local count of 17 URLs is a fixture artefact). Area and ranking pages have no conversion CTA. Rankings have a plural bug ("1 neighbourhoods").

**C9 Lifestyle lens (3.5)**
- Role axes: UX learnability 3, tone 4. PM time-to-value 5, retention 2.
- Evidence: some lens names carry tone or trademark risk. The scale and definition are not explained up front, and the source is not named inline.

**C10 Evidence pack (4.3) and C11 Help → guide (4.0)**
- Role axes (CSS): layout 4, front-end perf 5 / 4.
- Evidence: there is no print CSS outside the pack. Map CSS (83 KB raw) loads on text pages. Content pages use two different templates.

---

## 5. Improvement proposals (deduplicated and ranked)

The roles made 64 proposals between them; deduplicated, they come to 34. Ordering is in bands. First come High-impact items with effort up to M (#1–17): H/S before H/M, ties broken on cross-role agreement then confidence, and two H/M items (#2, #3) promoted into the top tier because together they close the main AE-34 trust risk. Then come Medium-impact Small items (#18–27), then items with an impact ÷ effort ratio of about 1 (#28–34; H = 3, M = 2, L = 1; S = 1, M = 2, L = 3). A pure impact ÷ effort sort would place the M/S items (ratio 2) above the H/M items #10–17 (ratio 1.5); the bands deliberately keep high-impact work first.

### Do first (top 5)

| # | Proposal | Owner | I / E / C | Why first |
|---|---|---|---|---|
| 1 | Style and humanise the comparison dialog | CSS + UX | H / S / high | Flagged by all 4 roles; about 1 day; C1 visual quality 2 → 4 |
| 2 | One set of figures across card, compare and brief; state only inputs the user set | PM + UX | H / M / high | Removes the contradictions behind C1 trust 2.5 and the AE-34 stop-rule risk |
| 3 | Honest budget in ranking and labels | PM + UX | H / M / high | Over-budget areas read as matches ("3 areas meet your must-haves", commute "Fits" chip) in C1 and rank #1 in the C7 brief landing |
| 4 | Branded 404, error and loading pages; suggest only postcodes that resolve | UX + PM + Sales | H / S / high | Removes a dead end in C2 and C3; keeps the 404 status the RELEASE-CHECKLIST needs |
| 5 | "Report or hide this home" on property and postcode pages | UX + PM | H / S–M / high | A legal launch gate (C5 task 2 → 4) |

Owner decision to take alongside the top 5: **#6, the per-home "Estimated price"**.

### Ranked list

| # | Proposal | Owner(s) | Impact | Effort | Conf. | Journeys |
|---|---|---|---|---|---|---|
| 1 | Style and humanise the comparison dialog | CSS, UX, PM, Sales | H | S | high | C1 |
| 2 | One set of figures; only real inputs in the brief | PM, UX, Sales | H | M | high | C1, C7 |
| 3 | Honest budget in ranking and labels | PM, UX, Sales | H | M | high | C1, C7 |
| 4 | Branded 404, error and loading pages + postcodes that resolve | UX, PM, Sales | H | S | high | C2, C3, C4 |
| 5 | Report or hide this home on property and postcode pages | UX, PM | H | S–M | high | C5, C4 |
| 6 | Decide on the per-home "Estimated price" | PM | H | S | medium | C4 |
| 7 | Value-proposition h1 and proof strip on the first view | UX, Sales | H | S | medium | C3, C6 |
| 8 | Visible match sharing + "Shared with you" for the recipient | Sales | H | S | medium | C6, C1 |
| 9 | "Welcome back" resume card | PM | H | S | high | C1 |
| 10 | Shortlist tray; brief as the output of Find my area | UX, Sales | H | M | medium | C1 |
| 11 | Storage-free funnel counter | PM, Sales | H | M | medium | all |
| 12 | Save / compare / next-step CTAs on area, postcode and property pages | PM, Sales | H | M | high | C2, C4, C8 |
| 13 | OpenGraph cards + SEO readiness | Sales, PM, UX | H | M | high | C6, C8, C3 |
| 14 | Remove the area-page CLS; add a layout/CLS sweep to the gate | CSS | H | M | high | C8, C2 |
| 15 | Type-scale tokens with a 12 px floor + touch-target pass | CSS, UX | H | M | high | C1, C11 |
| 16 | "Is the asking price fair?" on property and postcode pages | Sales | H | M | high | C4 |
| 17 | Opt-in launch list + AE-34 research sign-up | Sales | H | M | medium | C3, C5 |
| 18 | Trust shell: shared footer, About page, data-mode badge | UX, Sales | M | S | high | C2–C5 |
| 19 | Focus-ring contrast audit | UX (CSS) | M | S | high | C2, C3, C9 |
| 20 | Mobile ergonomics bundle | UX, CSS, PM | M | S–M | high | C2, C3, C9 |
| 21 | Quieter Tube overlay at overview zoom | UX | M | S | medium | C3, C2, C1 |
| 22 | Responsive, accessible tables + "More" menu at 320 px | CSS | M | S | high | C4 |
| 23 | Wizard on-ramp: example match + empty budget field | PM, CSS | M | S | medium | C1 |
| 24 | Promote "Use with Claude" and guard its production URL | Sales, UX | M | S | high | C7, C3 |
| 25 | Neutral names for the lifestyle lenses | UX | M | S | medium | C9 |
| 26 | Print styles for area and property pages | CSS | M | S | high | C10, C8 |
| 27 | Stop mid-word breaks; container-query tiles | CSS | M | S | high | C8, C2 |
| 28 | Defer MapLibre and the TfL overlay; per-route CSS | CSS | H | L | medium | C2, C4, C11 |
| 29 | Breakpoint, spacing and radius tokens + one PageShell | CSS | M | M | high | all |
| 30 | Offer the watch on the web | PM | M | M | medium | C7, C2 |
| 31 | Shareable Explore chip pages | Sales | M | M | medium | C3, C6 |
| 32 | Copy, legend, evidence-card and title fixes | UX, PM | L–M | S | high | C1, C8 |
| 33 | Version and prune the service-worker cache | CSS | L | S | high | C2 |
| 34 | Low-key "For teams" page (API/MCP) | Sales | L | S | low | C7 |

### Proposal details

**1. Style and humanise the comparison dialog.** Owner: CSS, UX. Flagged by all 4 roles.
- **Change:** in `area-comparison.tsx`, use the knit or quiet-button style (`--chip`, radius, 44 px) for Close and Remove. Set `.comparison-dialog` to an opaque `--panel-solid`/`--surface` background with a dimmed backdrop, and drop the striped header cell. Collapse weight-0 rows into "Not in your score (6)". Move carrier, release and ID strings behind a per-column "Sources" disclosure. Format money as £600k and write the intro in plain words. Add a "compare 3 areas" step to `e2e/unstyled-controls.spec.ts`.
- **Improves:** C1 visual quality 2 → 4, clarity and trust; mobile readability. Compare is a pre-registered AE-34 task and part of the paid "enhanced comparison" hypothesis.
- **Affects:** `area-comparison.tsx`, `globals.css:328-341`, the UX-50 mobile factor cards, visual baselines; e2e runs about 3 s longer. No data or API impact.
- **Evidence:** [ux P2](roles/ux.md), [css P1](roles/css.md), [pm P12](roles/pm.md), [sales P6](roles/sales.md). Screenshots `UX/shots/j1-compare-d.png` and `j1-compare-m.png`.

**2. One set of figures across card, compare and brief; state only inputs the user set.** Owner: PM, UX.
- **Change:** feed compare and brief from the same per-area figures the result card uses, with commute minutes from `lib/journeys.ts`, labelled the same way everywhere (estimate vs routed). Label affordability as "~£686k vs your £600k limit". In the brief, print only values the user set, list defaults under "Assumed (you didn't set these)", and omit untouched schools. When all costs are unknown, show "Add a price to see monthly costs" instead of £0.
- **Improves:** C1 trust 2 → 4, learnability and value; the C7 brief landing; the AE-34 comprehension-of-uncertainty measure.
- **Affects:** `lib/matching.ts:154`, `area-comparison.tsx`, `decision-brief.tsx`, the Markdown export format, brief-model parity with `api/area_api/share_links.py`, AE-09 brief redaction (the destination label stays redacted unless the user opts in), snapshot tests. Needs a decision on which figure is canonical across carriers.
- **Evidence:** [ux P1](roles/ux.md), [pm P2, P3](roles/pm.md).

**3. Honest budget in ranking and labels.** Owner: PM, UX.
- **Change:** in `web/src/lib/matching.ts` and `api/area_api/matching.py`, treat a ballpark above the maximum budget as an unmet soft limit that caps the score, or sort within-budget areas first. Rename the commute chip to "Commute fits" and add a budget chip such as "Over budget · ~£86k (14%)" in place of the small "! Price" mark. Group the list into "Within budget" and "Stretch". Add a "Relax budget 10%" action and a header such as "3 areas · 0 within budget".
- **Improves:** C1 learnability 2 → 4 and trust; C7, because MCP `find_areas` output stops ranking over-budget areas #1.
- **Affects:** web/API scorer parity (`agents/smoke_mcp_http.py`), MCP output, the brief's hard-constraints section, my-match e2e. Expensive searches risk returning nothing, so the relax control is required. Part of the gap may come from fixtures; the badge logic does not.
- **Evidence:** [pm P1](roles/pm.md), [ux P3](roles/ux.md), `UX/shots/j1-results-d.png`.

**4. Branded 404, error and loading pages; suggest only postcodes that resolve.** Owner: UX, PM, Sales.
- **Change:** add the postcode suggestion row only when the lookup confirms the postcode. Otherwise show inline "We can't find ZZ9 9ZZ — check it or try a street", plus the nearest covered area where one is known. Add `app/not-found.tsx` (subpage header, search, Back to the map, Guide, "We cover Greater London"), `app/error.tsx` with a retry, and loading skeletons for the area and postcode routes. A valid postcode outside coverage gets a noindex soft page.
- **Improves:** C2 task and robustness 3 → 4; C3 robustness; ux-audit P0.4.
- **Affects:** search tests and the route contract. RELEASE-CHECKLIST step 6 needs `/postcode/nope` to keep its 404 status, so only the page body changes. Locally E1 1AA returns 404 because of fixtures.
- **Evidence:** [ux P5](roles/ux.md), [pm P9](roles/pm.md), [sales P8](roles/sales.md).

**5. "Report or hide this home" on property and postcode pages.** Owner: UX, PM.
- **Change:** add a secondary button on `/property/[uprn]` that reuses the objection form from `evidence-panel.tsx`, and add the same action to each row in `/postcode/[code]/homes`. Add `&address=<id>` to the map URL state so "Open on the map" restores the selected home.
- **Improves:** C5 task 2 → 4; C4 trust; readiness for the ICO and LIA launch gate.
- **Affects:** objection API traffic and rate limits, privacy-notice anchors, objection e2e, the URL state schema. The existing e-mail confirmation mitigates abuse. SMTP is not verified locally.
- **Evidence:** [ux P6](roles/ux.md), [pm P11](roles/pm.md).

**6. Decide on the per-home "Estimated price".** Owner: PM, with an owner and legal decision.
- **Change:** before going public, either rename it to "Last sale restated by the area index (not an estimate of value)" and move it below the sales history, or remove it. Show per-sale £/m² only once the licence question is answered.
- **Improves:** C4 trust, which is where the matrix disagreement comes from; legal readiness.
- **Affects:** the property page, MCP `get_stock_value` wording, the map's "value today" tooltip, /claude copy, and #16, which must use the same framing. Keep per-home pages out of the index until this is decided.
- **Evidence:** [pm P10](roles/pm.md).

**7. Value-proposition h1 and proof strip on the first view.** Owner: UX, Sales.
- **Change:** make the hero line the h1, for example "What London homes really sold for, and which areas fit your budget and commute", and make the panel heading an h2. Add a 3-step micro-row (budget & commute → matching areas → compare & brief). Add a proof strip: "HM Land Registry · police.uk · Ofsted — every figure sourced · nothing here is paid placement". Put a (?) next to the legend linking to `/guide/reading-the-map`. Mirror the line in the default `<title>`.
- **Improves:** C3 clarity 3 → 4 and Sales value-proposition strength 2 → 4; the recipient's first view in C6; SEO for `/`.
- **Affects:** the intro card height on mobile (keep it to 3 lines at most), accessibility-tree and snapshot tests. The copy must make no demand or payment claim.
- **Evidence:** [ux P11](roles/ux.md), [sales P1](roles/sales.md).

**8. Visible match sharing + "Shared with you" for the recipient.** Owner: Sales.
- **Change:** reuse the `property-share.tsx:9-21` pattern: `navigator.share`, falling back to the clipboard, then a `role=status` message ("Link copied — anyone with it sees your budget and place"). When the profile comes from the URL hash, show a "A shared London shortlist · Buy up to £600k · …" banner with "Adjust to my budget" and "What is Close Knit?", and say "This search" until the recipient edits it. A server-side short link is phase 2 and needs legal review, because it conflicts with "never persist raw profiles".
- **Improves:** C6 clarity 2 → 4 and conversion 2 → 4; the referral-to-activation rate.
- **Affects:** `personal-match-panel.tsx`, `match-brief.ts` import, the `shortlists.tsx:337` import dialog, share e2e.
- **Evidence:** [sales P3, P4](roles/sales.md).

**9. "Welcome back" resume card.** Owner: PM.
- **Change:** if saved shortlists or a non-default profile exist, replace the intro with a dismissible "Welcome back: Test move (2 areas) · Open · Brief". Render nothing when storage is blocked.
- **Improves:** C1 retention 2 → 3+; the voluntary-return adoption measure.
- **Affects:** the intro-dismissed logic and the mobile sheet layout. Low risk.
- **Evidence:** [pm P6](roles/pm.md).

**10. Shortlist tray; brief as the output of Find my area.** Owner: UX, Sales.
- **Change:** once one area is ticked, show a sticky tray, "2 areas · Compare · Make my brief", with the brief as the single stitched primary button. Add stage chips (Needs ✓ · Shortlist · Compare · Brief). Move cost inputs into an optional brief step. `/brief` with no hash shows an explainer and "Start Find my area" instead of an error. Reuse the pack's print styles.
- **Improves:** C1 task 3 → 4 and conversion; adoption (use of compare or brief); makes a future paid brief testable.
- **Affects:** the match-panel layout, mobile sheet snap points, the DESIGN.md one-primary rule, `decision-brief.tsx`, `shortlists.tsx`, baselines.
- **Evidence:** [ux P4](roles/ux.md), [sales P13](roles/sales.md).

**11. Storage-free funnel counter.** Owner: PM, Sales.
- **Change:** add `POST /api/v1/events` taking only an enum event name plus release and mode. No identifiers, no stored IP, no cookies or device storage. Aggregate per day in Postgres. Events: landing, wizard_step1_done, results_shown, compare_opened, shortlist_saved, brief_previewed, brief_exported, shared_open, claude_copy, objection_started. Add a small private dashboard.
- **Reconciled:** PM proposed aggregate counts with no storage, so no consent banner; Sales proposed opt-in redacted telemetry. Adopt PM's no-storage design and take Sales's event names. Optional opt-in is not needed for aggregate counts.
- **Improves:** makes the Efficiency and Adoption measures observable outside moderated sessions, and makes every other proposal measurable.
- **Affects:** the privacy notice and LIA, API schema and migration, the rate limiter. Payloads must never carry budgets or places (`privacy.py`).
- **Evidence:** [pm P4](roles/pm.md), [sales P15](roles/sales.md), `matching.ts:380` (never called).

**12. Save / compare / next-step CTAs on area, postcode and property pages.** Owner: PM, Sales.
- **Change:** in the `area-full-page.tsx` header and the map evidence panel, add "Save area" (the saved-shortlists store), "Add to compare" (the tray from #10) and "Find areas like this in my budget" (prefills Find my area). On property pages add "Save this home" (`user-candidates.tsx`). Add a Compare tick to ranking rows.
- **Improves:** C2, C4 and C8 retention 1 → 3 and conversion 2 → 3; more entries into C1.
- **Affects:** client islands inside server-rendered pages, the `lib/saved-shortlists.ts` store, `preference-panel.tsx` prefill, mobile sheet height. No API change.
- **Evidence:** [pm P5](roles/pm.md), [sales P7](roles/sales.md).

**13. OpenGraph cards + SEO readiness.** Owner: Sales, PM, UX.
- **Change:** add a default `metadata.openGraph`, plus `generateMetadata` (canonical and OG) for area, property, postcode and rankings. Add `opengraph-image.tsx` (`next/og`) showing the area name, £/m², trend and the knit logo, with the demo label baked in. Shared match links get a generic card, because the hash is invisible to crawlers. Add JSON-LD (Place, Dataset, WebSite + SearchAction) and a sitemap index covering guide, tools, glossary, /claude and every area. Drop the duplicate "· Close Knit" from titles. Keep noindex until the going-public step.
- **Improves:** shareability on every journey (C6 2 → 4); C8 value; agent (AEO) discoverability.
- **Affects:** OG render cost (cache on Edge). Hidden homes must 404 for OG too. Sitemap build time (stream from the API). The RELEASE-CHECKLIST going-public step. Per-home pages wait for #6.
- **Evidence:** [sales P2, P12](roles/sales.md), [pm P14](roles/pm.md), [ux P16](roles/ux.md).

**14. Remove the area-page CLS; add a layout/CLS sweep to the gate.** Owner: CSS.
- **Change:** reserve space with per-tile `min-height`, aspect-ratio boxes for the ring and sparkline, and a "What a home costs" skeleton, or server-render the headline figures. Port the review's `css/sweep.cjs` to a Playwright spec: sitemap routes × 320/768/1024/1440 × day/night, asserting no horizontal overflow, no menu or dialog off-screen, CLS < 0.1 and zero console errors. Run it in `gate.sh --mobile`.
- **Improves:** C8 front-end perf 2 → 4 (Core Web Vitals); protects the "works from 320 px" release bar on every journey.
- **Affects:** `area-full-page.tsx`, `overview-tiles.css`, perhaps the profile BFF; gate runtime +1–2 min (deterministic with fixtures).
- **Evidence:** [css P3, P16](roles/css.md). CLS 0.337 at 768 in `sweep-light.json`.

**15. Type-scale tokens with a 12 px floor + touch-target pass.** Owner: CSS, UX.
- **Change:** define `--fs-2xs … --fs-3xl` in rem and codemod every font-size to them; 8–11 px becomes ≥ 0.75 rem. Add a stylelint unit rule. Give labels and inputs in `match-panel.css` and the school shortlist a 44 px hit area. Add a target-size e2e helper (fail < 24 px, warn < 44 px). Raise chart text to at least 11 px.
- **Improves:** C1 accessibility 3 → 4; legibility for validation participants (today there are 4 rules at 8 px, 13 at 9 px and 40 at 10 px).
- **Affects:** every stylesheet (a mechanical change), dense chart layouts, DESIGN.md §3, snapshots; the match panel gets slightly taller.
- **Evidence:** [css P6, P12](roles/css.md), [ux P14](roles/ux.md).

**16. "Is the asking price fair?" on property and postcode pages.** Owner: Sales.
- **Change:** add a client-only asking-price input. It answers "X% above/below the latest achieved price and the middle half of local £/m²", reusing the `user-candidates` comparison and the existing quartiles. The entered price is never stored. Add the hint "Paste an address from a listing" to search.
- **Improves:** C4 task 3 → 4 and value-proposition strength 4 → 5; the AE-34 achieved-vs-asking comprehension measure; a natural moment to share.
- **Affects:** must say "not a valuation" and follow the #6 framing (no-AVM non-goal); `user-candidates` tests.
- **Evidence:** [sales P5](roles/sales.md).

**17. Opt-in launch list + AE-34 research sign-up.** Owner: Sales.
- **Change:** add a double opt-in "Tell me when Close Knit opens to everyone" form and a separate research-session checkbox. Store only the e-mail, the consent and the date, and record the utm channel.
- **Improves:** the first measurable demand signal, without making a demand claim; an AE-34 recruitment channel beyond friends.
- **Affects:** privacy notice, LIA and ICO registration (`docs/legal/ico-registration.md`), SMTP config (`CLOSE_KNIT_SMTP_*`), retention. Sending recruitment e-mails is a separately authorised action.
- **Evidence:** [sales P9](roles/sales.md).

**18. Trust shell: shared footer, About page, data-mode badge.** Owner: UX, Sales.
- **Change:** add a `SiteFooter` on every subpage (Sources & privacy, Terms, licences and ODbL download, data mode, "Report or hide a home"). Add `/about`: the named operator (needed for UK GDPR controller identity), an independence pledge, a data-freshness table from `/api/v1/metrics`, and how to report a wrong figure. Add a `DataModeBadge` component on every data page, hidden in Real mode, and raise the map label to 12 px.
- **Improves:** trust on C2–C5; the stop rule against treating preview data as official.
- **Affects:** all subpages, `/pack` print CSS, real-mode tests (UX-02/03). The controller identity must match the privacy notice and the ICO entry.
- **Evidence:** [ux P7, P12](roles/ux.md), [sales P11](roles/sales.md).

**19. Focus-ring contrast audit.** Owner: UX, verified by CSS.
- **Change:** switch the chip and layer-option focus rules to `var(--focus)` (#2f5bd3 by day, #7fb8f0 at night). Add a contrast test asserting focus rings are at least 3:1 in both themes.
- **Note:** the roles partly disagree. CSS measured a 3 px `--focus` outline on all 18 home tab stops; UX found low contrast on chips and layer options. Treat this as a targeted override audit, not a rewrite.
- **Improves:** WCAG 2.4.7, 1.4.11 and 2.4.13 on C2, C3 and C9.
- **Affects:** `layout.css` and the contrast test.
- **Evidence:** [ux P9](roles/ux.md), [css §2](roles/css.md).

**20. Mobile ergonomics bundle.** Owner: UX, CSS, PM.
- **Change:** add a right-edge fade and a pinned "More ›" chip on the chip row. On mobile, collapse the intro into a "Find my area ›" pill and remember the dismissal (localStorage in try/catch). Once an area is selected, collapse the legend to one line. Under `max-height:500px`, compact the CTA bar. Keep the Explore chips clear of the docked panel at 1024. Keep a "Find my area" chip in the sheet header while no profile exists.
- **Improves:** C2 clarity and layout; C3 and C9 accessibility and mobile; landscape devices stop showing no evidence tiles.
- **Affects:** `layout.css`, `knit-legend.css`, sheet snap points, UX-20 control collisions, mobile e2e. Keep "grey = no data" reachable.
- **Evidence:** [ux P10](roles/ux.md), [css P5, P17](roles/css.md), [pm P15](roles/pm.md).

**21. Quieter Tube overlay at overview zoom.** Owner: UX.
- **Change:** below z13, draw lines at about 1.5 px and 45% opacity with no station beads, or turn the overlay off by default behind a toggle. Add snow halos to area labels. Keep the full yarn styling at street zoom.
- **Improves:** C3 visual quality 3 → 4; rank colours readable in C1.
- **Affects:** the MapLibre style contract (`contracts/`), native apps that share the style, render snapshots; less first-paint "wow".
- **Evidence:** [ux P8](roles/ux.md).

**22. Responsive, accessible tables + "More" menu at 320 px.** Owner: CSS.
- **Change:** below 560 px, render table rows as stacked `<dl>` cards, or use a sticky address column with a scroll shadow. Give the table wrapper `tabindex=0 role=region aria-label` and an sr-only caption. Below 400 px, anchor the menu with `left:0; max-width:calc(100vw - 32px)` and add a 320 px e2e check.
- **Improves:** C4 task and accessibility (the axe rule `scrollable-region-focusable`, judged by hand).
- **Affects:** `knit-tables.css`, the postcode homes and property history tables, `knit-menu.css`.
- **Evidence:** [css P2, P8](roles/css.md), `shots/320-property-more-open.png`.

**23. Wizard on-ramp: example match + empty budget field.** Owner: PM, CSS.
- **Change:** add "Show me an example" to step 1, which renders results under an "Example — edit to make it yours" banner and never saves them as the user's profile. Leave the budget placeholder empty (or "e.g. 600,000" in muted text), add `inputmode=numeric`, and validate on blur.
- **Improves:** C1 time-to-value and clarity; wizard completion.
- **Affects:** wizard unit and e2e tests.
- **Evidence:** [pm P8](roles/pm.md), [css P11](roles/css.md).

**24. Promote "Use with Claude" and guard its production URL.** Owner: Sales, UX.
- **Change:** add "or ask Claude to find it for you →" under the intro CTA. Add a sample-conversation screenshot or loop and setup screenshots to `/claude`, and make the skill download prominent. When `NODE_ENV=production` and `CLOSE_KNIT_PUBLIC_URL` is unset, fail the build or log at boot. Add a RELEASE-CHECKLIST line: "/claude shows the public MCP URL".
- **Improves:** C7 task 3 → 4 and conversion; protects against shipping a localhost MCP URL.
- **Affects:** home intro space on mobile, MCP rate limits (`CLOSE_KNIT_RATE_LIMIT`).
- **Evidence:** [sales P10](roles/sales.md), [ux J7](roles/ux.md).

**25. Neutral names for the lifestyle lenses.** Owner: UX.
- **Change:** use descriptive names ("Cafés vs takeaways", "Betting shops nearby"), drop trademarks, and put the definition and source tags in the card's first line. Keep the old slugs as aliases.
- **Improves:** C9 trust 3 → 4 and tone; brand safety at launch.
- **Affects:** `layer=custom:` URLs, guide articles, MCP tool descriptions.
- **Evidence:** [ux P13](roles/ux.md).

**26. Print styles for area and property pages.** Owner: CSS.
- **Change:** in print, hide header, nav and toggles; force `.area-card` bodies open; reuse the pack's URL-append rule. Mount closed cards on `beforeprint`, because they mount lazily.
- **Improves:** C10 and C8 Decide output.
- **Affects:** `area-full-page.tsx` lazy mount, `area-brief.css`, `property.css`; printing triggers card fetches.
- **Evidence:** [css P14](roles/css.md).

**27. Stop mid-word breaks; container-query tiles.** Owner: CSS.
- **Change:** use `overflow-wrap:break-word` plus `hyphens:auto` (the page is `lang=en-GB`), keeping `anywhere` only for IDs and URLs. Make `.area-tiles` a container (`container-type:inline-size`) and drop to one column below about 150 px tile width.
- **Improves:** C8 and C2 visual quality and layout at 320–375 px.
- **Affects:** tiles on the sheet and the area page, `charts.css`, snapshots.
- **Evidence:** [css P4](roles/css.md).

**28. Defer MapLibre and the TfL overlay; per-route CSS.** Owner: CSS.
- **Change:** server-render the search, intro and sheet shell. Load the map with `next/dynamic({ssr:false})` behind a same-size static poster in `--canvas` colour. Fetch the TfL overlay after map `idle`, simplified or as Martin vector tiles. Import `maplibre-gl.css` from the map components and move page-specific sheets into their route layouts.
- **Improves:** LCP and INP on mid-range Android (home JS is about 503 KB gz); FCP on text pages (C4, C8, C11).
- **Affects:** `area-map.tsx` init, e2e "Map ready" waits, the `sw.js` shell list, cascade order (`map-knit.css` overrides), the TfL pipeline. The map paints slightly later.
- **Evidence:** [css P9, P10](roles/css.md).

**29. Breakpoint, spacing and radius tokens + one PageShell.** Owner: CSS.
- **Change:** standardise on 3 breakpoints via `@custom-media` (≤ 640 / ≤ 800 / ≥ 1100; there are 10 today). Add `--radius-*` and a 4 px spacing scale. Build one `<PageShell>` (breadcrumb, eyebrow, h1, lead, measure) and rename `.methodology` to `.page`.
- **Improves:** layout robustness and visual rhythm (C8, C11); maintainability.
- **Affects:** all CSS, about 15 routes and DESIGN.md. Schedule after the targeted fixes to avoid merge churn.
- **Evidence:** [css P7, P13](roles/css.md).

**30. Offer the watch on the web.** Owner: PM.
- **Change:** phase 1 adds a "Watch new listings here" modal with a copyable Claude prompt or deep link. Phase 2 is an opt-in weekly e-mail digest of portal search links, using the objection SMTP path.
- **Improves:** C2 and C7 retention.
- **Affects:** phase 2 stores e-mail addresses, so it needs consent, unsubscribe, privacy notice, LIA and ICO updates, and must stay free of listings (non-goal).
- **Evidence:** [pm P7](roles/pm.md).

**31. Shareable Explore chip pages.** Owner: Sales.
- **Change:** add stable server-rendered `/explore/<lens>` pages with top-3 lists and a knit-style OG image, plus a Share button in the custom-layer panel.
- **Improves:** top-of-funnel reach into C3; C6.
- **Affects:** new routes and sitemap entries; the image must carry OSM/ODbL attribution; depends on #13 and #25 (neutral names first).
- **Evidence:** [sales P14](roles/sales.md).

**32. Copy, legend, evidence-card and title fixes.** Owner: UX, PM.
- **Change:** use "Your N matches" (N = min(50, results)); show non-top areas as a clear or hatched swatch rather than black; give ranks distinct ramp steps. Fix "green best" (`brief-blocks.tsx:130`; the ramp is azure). Use sentence-case factor names and "The walk to a station is longer than you allow". Fix the rankings plurals. Clamp the donut label. Use the empty state "No noise data here yet · Why?".
- **Improves:** C1 learnability; C8 trust.
- **Affects:** `lib/map-legend.ts:28`, `lib/fixtures.ts:119-121`, `lib/palettes.ts:124`, test strings.
- **Evidence:** [ux P14, P15](roles/ux.md), [pm P13](roles/pm.md).

**33. Version and prune the service-worker cache.** Owner: CSS.
- **Change:** inject `BUILD_ID` into the cache name, prune stale `/_next/static` entries, and cap the number of entries.
- **Improves:** robustness for returning mobile users.
- **Affects:** the PWA offline shell; add an offline test.
- **Evidence:** [css P15](roles/css.md).

**34. Low-key "For teams" page (API/MCP).** Owner: Sales.
- **Change:** add `/teams` covering what the API and MCP return, rate limits, OGL/ODbL licensing and a contact e-mail, stating that there is no paid ranking and no lead selling.
- **Improves:** the commercial-potential signal without biasing the consumer product.
- **Affects:** acceptable-use terms vs API access, support load. Confidence in demand is low.
- **Evidence:** [sales P16](roles/sales.md).

---

## 6. Caveats

- **Fixture data, not production.** The local build has about 3 preview areas, so "3 of top 50", Camden gaps, E1 1AA returning 404 and "Baker Street" finding nothing are fixture artefacts and were not penalised. Price gaps in C1 (cards at £686k–£840k against a £600k budget) may be partly fixture-driven. The **"Fits" badge logic and the contradictions between surfaces are code-level** and will appear in production too.
- **Performance** figures come from the dev server, apart from bundle sizes measured from the prod build output (`.next`). There was no Lighthouse or axe run (neither is installed), and contrast was computed by hand from CSS. Production CWV are unknown.
- **Not verified:** objection submission and its e-mail round trip (no SMTP locally), screen readers, the MCP connector end to end inside Claude, OG rendering on real social platforms, and production basic auth or the ops items in RELEASE-CHECKLIST (ICO number, LIA). UX did not review Night theme; CSS swept 12 routes in dark mode and found them fine.
- **Journeys not walked or not scored separately:** the **renter path** (a Rent mode exists in `preference-panel.tsx`, but every walk used a Buy profile, although renters are a named primary segment); the **return visit** to a saved shortlist (seen only through the retention axes and #9, with no journey row); **beta access** for an invited AE-34 participant (behind production basic auth, so not reviewable here).
- **Single-role journeys** (C6, C10, C11) have means from one rater. Treat them as indicative.
- **The scores are expert heuristics**, not user data. AE-34 sessions remain the source of truth for comprehension and willingness to pay.
- **Evidence paths** in the role reports, such as `UX/shots/...` and `css/sweep-light.json`, are relative to the session scratchpad. The scratchpad is temporary and was not copied into the repo.

---

## 7. Role reports

| Role | Report | Journeys | Proposals |
|---|---|---|---|
| Staff UX Designer | [roles/ux.md](roles/ux.md) | 7 | 16 |
| Staff CSS / Front-end Engineer | [roles/css.md](roles/css.md) | 8 | 17 |
| Staff Product Manager | [roles/pm.md](roles/pm.md) | 7 | 15 |
| Staff Sales / GTM lead | [roles/sales.md](roles/sales.md) | 7 | 16 |

---

## 8. Review notes (completeness critic)

**Corrected**
- The "Fits" claim (§1, C1 evidence, #3): in the code and the screenshot, "Fits" is the commute chip. The real defect is that over-budget areas count as "meeting must-haves" and the price is flagged only by "! Price". The finding and its proposal still stand; the wording and fix are now precise.
- §1 said C1 is "the weakest CUJ"; C6 is lower (single rater). Reworded.
- §5's stated rule (pure impact ÷ effort) did not match the list. The rule now describes the bands actually used; numbering is unchanged so cross-references hold.
- §4 now explains that Overall ≠ mean of the 7 shared columns.
- "axe" wording: axe was never run (§6); the rule name is now marked as judged by hand.
- The C8 CLS (0.34) is flagged as a single dev sample; the sitemap count is flagged as a fixture artefact.
- The missing journeys (renter, return visit, beta access) are added to §6.

**Spot-checked against `127.0.0.1:4480` and the code (confirmed):** compare shows "440,000 budget fit" and "Commute · Not published" with browser-default buttons; `/postcode/nope` returns the bare Next 404 and there is no `app/not-found.tsx`; the objection form exists only in `evidence-panel.tsx`; `/claude` shows `127.0.0.1:8080/mcp`; there is no `openGraph` metadata and the home h1 is "Choose an area…"; the sitemap omits guide, tools, glossary and /claude.

**Not verified:** the brief's "£480,000 / weights you set" text, share feedback, the mobile see-through dialog, the per-home "Estimated price" legal risk, the 503 KB JS figure, and the role-specific axis values (taken from the role reports).

