# Close Knit site review — Staff Sales / GTM lead

Date 2026-10-10. Local build http://127.0.0.1:4480 (Next dev, fixtures, no CLOSE_KNIT_API_URL); production not accessed. Walk scripts and screenshots: `site-review/sales/` (j1–j5.cjs, *.png); shared capture `site-review/capture/`.

## Goals, users and metrics (as understood)

Close Knit is a free, open, source-linked London decision tool: help a household find the part of London that fits budget, commute and life (DESIGN.md intro; README 'Current vertical slice'). Target users: London buyers and renters, especially movers into unfamiliar areas (london-user-validation-protocol.md Sample). Success = trust (users explain achieved vs asking price and missing evidence), decision usefulness, efficiency vs portals, adoption (return to saved shortlist), commercial signal for a paid one-off decision brief or enhanced comparison (proptech 02-PRIORITIES 'Measures'). Constraints: no demand/payment claims until AE-34 reports (README 'Validation status'); avoid models that bias recommendations, agent lead-gen not prioritised. Secondary channel: agent/MCP consumption (ROADMAP-property-intelligence).

## Journeys (ranked)

| # | id | kind | overall |
|---|---|---|---|
| 1 | cuj-first-visit-value | critical_user_journey | 3.2 |
| 2 | cuj-find-my-area-shortlist | critical_user_journey | 3.4 |
| 3 | cuj-share-referral-loop | critical_user_journey | 2.9 |
| 4 | hp-listing-price-check | happy_path | 3.9 |
| 5 | hp-seo-rankings-to-area | happy_path | 3.4 |
| 6 | hp-use-with-claude | happy_path | 3.7 |
| 7 | cuj-trust-objections | critical_user_journey | 3.4 |

### Cold visitor: first 5 seconds to first area insight (`cuj-first-visit-value`, critical_user_journey, overall 3.2)

**Persona:** London mover arriving from a shared link or search, never heard of Close Knit  
**Goal:** Understand what Close Knit is, why it beats a portal, and get one useful area fact  
**Why critical:** Every acquisition channel lands here; DESIGN.md intro defines the promise; ux-audit-2026-09-06 scored task clarity 4/10 at this stage. If the value proposition fails here, nothing downstream is measured (02-PRIORITIES Efficiency/Adoption).

**Steps walked:**
1. GET / desktop 1440x900 and mobile 390x844 (sales/j1.cjs)
2. Read the intro card and meta (title 'London Close Knit', no og:*, H1 'Choose an area on the map or search')
3. Type 'SW1A' then pick 'SW1A 1AA Westminster' (capture search flow)
4. Read the area evidence panel (/?selected=uk:lsoa:E01000001)
5. Type 'E1 1AA' + Enter, which lands on /postcode/E1-1AA, a bare 404

| axis | score | rationale | evidence |
|---|---|---|---|
| clarity | 3 | One clear line plus 'Find my area', but the Tube overlay dominates the view and the only H1 is the panel prompt. | capture/shots/home-d.png, home-m.png; j1 output h1=['Choose an area on the map or search'] |
| task completion / friction | 4 | Search to selection to evidence works with 0 errors. An unknown postcode is still offered as 'prices and sales' and then dead-ends. | j4 output: 'E1 1AA: prices and sales' option -> /postcode/E1-1AA 404 |
| trust & credibility | 4 | 'Demo data · not for decisions' and Sources & privacy are visible from the first view. There is no 'who we are'. | capture/text/home-d.txt |
| visual & interaction quality | 4 | The knit brand stands out and is warm. Heavy multicolour Tube lines compete with the price layer. | capture/shots/home-d.png |
| performance & robustness | 4 | Warm dev idle is 1.1 s on desktop and 2.0 s on mobile, with 0 console errors. The 404 is the unbranded Next default (no app/not-found.tsx). | j1 timing; find web/src/app -name not-found* -> none |
| accessibility & mobile | 3 | On mobile the intro card takes about a quarter of the screen. The sheet opens on the legend rather than value, and the chips are clipped. | capture/shots/home-m.png |
| value delivered vs. product goals | 3 | An insight arrives quickly, but nothing after it routes the user into Find my area or a save. | j5 PANEL actions: no save/share/match CTA |
| value proposition strength | 2 | Nothing on screen says why this is not Rightmove/Zoopla/Crystal Roof: achieved prices, sourced, no listings bias. The meta description says it better than the page. | first-visit-intro.tsx:65; layout.tsx:46-47 |
| conversion & shareability | 2 | There are no OG/Twitter tags, no share on the area panel, and no email capture or beta waitlist. | grep openGraph web/src/app -> none; j1 og=[] |

**Top issues:** No differentiation statement in the first view; No OG metadata, so shared links have no preview; Unknown postcode offered in search, then a bare 404; Area panel has no next step (match, save, share)

### Find my area: budget + commute to ranked matches to compare (`cuj-find-my-area-shortlist`, critical_user_journey, overall 3.4)

**Persona:** Buyer, £600k, 2-bed, commuting to Westminster  
**Goal:** Get a defensible shortlist with trade-offs and compare two areas  
**Why critical:** This is the core proposition under test in AE-34 (protocol 'Method' step 2: comparison + brief) and the paid hypothesis 'one-off decision brief or enhanced comparison' (02-PRIORITIES Measures).

**Steps walked:**
1. / -> Find my area (intro CTA)
2. Step 1: Buy, budget 600000, 2 bedrooms, place 'Westminster' -> option 'Station: Westminster preview station', Continue
3. Step 2: leave priorities, Show areas
4. Results: 3 matches (North London ~£686k 86 match, South Bank ~£728k, Westminster ~£840k), all 'Fits' with '! Price'
5. Tick 2 match checkboxes -> Compare areas dialog
6. Same flow on mobile 390x844

| axis | score | rationale | evidence |
|---|---|---|---|
| clarity | 4 | Two short steps in plain words. 'Fits' next to a '! Price' compromise when every result is over budget needs one sentence of explanation. | sales/fma-step1-d.png, fma-result-d.png |
| task completion / friction | 4 | Completed on desktop and mobile with no errors. Compare needs a tick, then the tray, then a dialog. The brief is hidden under 'Saved areas & costs', and /brief alone dead-ends ('This brief link is incomplete'). | j2/j3 output; capture/text/brief-d.txt |
| trust & credibility | 3 | Compare shows raw IDs/release codes ('uk:lsoa:E01000002 · observed · preview-price-2026-06'). It says '440,000 budget fit 100/100' while the card says ~£686k over budget, and lists Commute as 'Not published' despite the 24 min on the card. Partly a fixture artefact, but the presentation is not. | sales/compare-d.png |
| visual & interaction quality | 3 | The results panel is polished. The compare dialog reads like a debug table: barcode-striped header cell, default-looking Remove buttons. | sales/compare-d.png |
| performance & robustness | 4 | Results render in about 2 s after Show areas, with no console errors. | j2 errors [] |
| accessibility & mobile | 3 | Results work on mobile. The compare checkbox is a custom role=checkbox. Compare on mobile was not walked. | personal-match-panel.tsx:454; sales/fma-result-m.png |
| value delivered vs. product goals | 4 | Commute minutes, price and trade-off in one ranked list is exactly the unique-value job. | fma-result-d.png |
| value proposition strength | 4 | Clearly something portals do not do, but the result never says so. | fma-result-d.png |
| conversion & shareability | 2 | Share silently writes a 585-char URL to the clipboard: no 'Link copied', no native share sheet, no short link. No 'email me this' and no visible brief export. | personal-match-panel.tsx:561-568; j3 URL len 585 |

**Top issues:** Compare dialog contradicts the cards and leaks internal IDs; Silent share with a huge URL; Decision brief buried; /brief alone is a dead end; No save/return loop (adoption metric)

### Shared match link to recipient to own search (`cuj-share-referral-loop`, critical_user_journey, overall 2.9)

**Persona:** Partner/friend receiving a shortlist link in WhatsApp  
**Goal:** Understand what was shared and start their own search  
**Why critical:** Home moves are joint decisions. Explicit sharing is a core product rule (ROADMAP-personal-area-match Summary: details in URLs only via explicit Share), and AE-27 is about sharing reproducible shortlists. Referral is the only zero-cost growth loop for a free product.

**Steps walked:**
1. From results: Share -> 'Review before sharing' preview (budget, exact place) -> Confirm share
2. Clipboard equals the page URL (585 chars, #profile=v1.…)
3. Open the URL in a fresh context as the recipient
4. Recipient sees 'Your matches' / 'Your search: Buy · up to £600k…'

| axis | score | rationale | evidence |
|---|---|---|---|
| clarity | 2 | The recipient is shown someone else's budget as 'Your search' with no 'Shared with you' framing and no intro to Close Knit. | j3 RECIPIENT text; sales/recipient-d.png |
| task completion / friction | 3 | State restores correctly, but there is no 'make it mine' or 'adjust to my budget' path. | j3 |
| trust & credibility | 4 | The pre-share privacy review (exact location shared) is best-in-class. | j3 PREVIEW output |
| visual & interaction quality | 3 | In chat the link is a bare long URL with no card image or title. | no og:* tags |
| performance & robustness | 4 | Fresh load restores the profile and results with no errors. | j3 |
| accessibility & mobile | 3 | On mobile the copy is silent (no status message), so screen-reader users get no confirmation either. | personal-match-panel.tsx:561-568 (no role=status update) |
| value delivered vs. product goals | 3 | Joint decision-making is supported technically, but not narratively. | recipient-d.png |
| value proposition strength | 2 | The recipient never learns what Close Knit is or why to trust it. | recipient text has no intro |
| conversion & shareability | 2 | No preview card, no short link, no recipient call to action. | j3 |

**Top issues:** No OG card; No 'Shared with you' framing; No feedback on copy; No recipient CTA

### Is this home's price fair? Address to property page (`hp-listing-price-check`, happy_path, overall 3.9)

**Persona:** Buyer who saw a flat on a portal and has its address  
**Goal:** See achieved sales, estimate and local £/m² context, then share it with a partner  
**Why critical:** The research REPORT §1.4 and 02 valuation say professionals price from completed sales and £/sqft, and asking prices are weak evidence. This is the clearest 'job a portal does not do'. The /claude page already promises listing checks.

**Steps walked:**
1. Search 'SW1A' -> '10 Sample Street, SW1A 1AB (2 recorded sales)'
2. /property/100000000001 desktop + mobile
3. Read estimate ~£668k (medium confidence), last sale £570k, £/m² vs MSOA median, sales history
4. Share -> 'Link copied'
5. Search 'Baker Street' -> no options (fixture)

| axis | score | rationale | evidence |
|---|---|---|---|
| clarity | 4 | Headline estimate, 'Estimate, not a valuation', last sale to now: easy to read. | sales/property-m-viewport.png |
| task completion / friction | 3 | You need the exact address. There is no 'enter asking price / paste listing' entry here; the asking-price candidate panel is buried in the area page. | area-full-page.tsx:531; lib/user-candidates.ts:146 |
| trust & credibility | 5 | HMLR/EPC OGL sources, 'achieved prices, never asking prices', confidence label and a hide-home route. | capture/text/property-d.txt |
| visual & interaction quality | 4 | Clean cards and a satin energy chart. | property-m-viewport.png |
| performance & robustness | 4 | Idle at about 0.6-0.8 s, 0 errors. | capture INDEX property row |
| accessibility & mobile | 4 | Mobile layout is clean, with readable type and clear actions. | property-m-viewport.png |
| value delivered vs. product goals | 4 | Comparables-style evidence that buyers use in negotiation. | property-d.txt 'Price per m² nearby' |
| value proposition strength | 4 | Strong but implicit: 'Is this listing overpriced?' is never asked on the page. | property-d.txt |
| conversion & shareability | 3 | Native share or copy with feedback works. No preview card and no 'watch this street' alert. | property-share.tsx:12-20; j3 'Link copied' |

**Top issues:** No asking-price input on the property page; No OG card for the property share; No alert/watch hook

### Organic entry: rankings or area page to map/match (`hp-seo-rankings-to-area`, happy_path, overall 3.4)

**Persona:** Googler searching 'most expensive areas London' or '<area> crime'  
**Goal:** Get the answer, then go deeper into the product  
**Why critical:** A free product needs low-cost acquisition. sitemap.ts lists rankings and areas, and area pages ship JSON-LD and descriptive titles, so SEO/AEO is a designed channel (ROADMAP-property-intelligence AEO; llms.txt).

**Steps walked:**
1. /rankings (index), /rankings/most-expensive
2. Click first area -> /area/msoa/E02000001
3. Inspect title/description/JSON-LD and on-page CTAs
4. Check /robots.txt, /sitemap.xml, /llms.txt

| axis | score | rationale | evidence |
|---|---|---|---|
| clarity | 4 | Good titles and descriptions ('St James's · SW1A: prices, crime, schools and deprivation'). | j4 AREA META |
| task completion / friction | 3 | The only area-page CTA is 'Open on the map'. Nothing prefilled leads into Find my area, Compare or Save. | j4 AREA CTAs |
| trust & credibility | 4 | Lists carry the Demo label and sources. The rankings index says 'same official data as the map' with no label (fine in prod, wrong in demo). | capture/text/rankings-d.txt |
| visual & interaction quality | 4 | Consistent with the rest of the site; tables are readable. | capture/shots/ranking-most-expensive-d.png |
| performance & robustness | 4 | 0.6-0.8 s, SSR text, 0 errors. | capture INDEX |
| accessibility & mobile | 4 | Semantic tables and a single H1. | j4 RANK META h1 |
| value delivered vs. product goals | 3 | Answers the query, then leaks the visitor. | j4 |
| value proposition strength | 3 | No 'what is Close Knit' block on landing pages. | area-lsoa-d.txt |
| conversion & shareability | 2 | No share, no OG image, no CTA into the match. | j4; no openGraph |

**Top issues:** No conversion CTA on area/ranking pages; No social cards; Home is not a crawlable landing (H1 is a panel prompt)

### Use with Claude: connect the MCP and get a guided search (`hp-use-with-claude`, happy_path, overall 3.7)

**Persona:** AI-native mover or relocation professional using Claude  
**Goal:** Add the connector and ask 'help me find a 2-bed under £600k'  
**Why critical:** ROADMAP-property-intelligence repositions toward agent consumption (MCP, AEO). /claude is the only page that promises listing discovery and watches, which are strong differentiators vs portals.

**Steps walked:**
1. Menu -> Use with Claude (/claude)
2. Read 3-step connector setup with Copy buttons
3. Check the URL source: claude/page.tsx:17 falls back to http://127.0.0.1:8080

| axis | score | rationale | evidence |
|---|---|---|---|
| clarity | 4 | Concrete steps, an example prompt, and 'what Claude sees'. | capture/text/claude-d.txt |
| task completion / friction | 3 | Custom-connector setup is technical. The URL depends on CLOSE_KNIT_PUBLIC_URL (local fallback shown here), and there is no check that it is set in prod. | web/src/app/claude/page.tsx:17 |
| trust & credibility | 4 | States that budget/preferences are not stored and that it collects no listings. | claude-d.txt |
| visual & interaction quality | 4 | Consistent page styling. | capture/shots/claude-d.png |
| performance & robustness | 4 | 0.85 s, 0 errors. | capture INDEX |
| accessibility & mobile | 4 | Readable on mobile; copy buttons. | capture/shots/claude-m.png |
| value delivered vs. product goals | 4 | A differentiated channel that fits the roadmap. | ROADMAP-property-intelligence Goal |
| value proposition strength | 4 | 'finds homes on the portals for you and can watch for new ones' is unique. | claude-d.txt |
| conversion & shareability | 2 | Only reachable from the hamburger menu and footer nav. No sample-chat visual and no install measurement. | top-bar-menu.tsx:91-95 |

**Top issues:** Hidden behind the menu; No sample-conversation proof; Prod URL depends on an env var with a localhost fallback

### Objection handling: accuracy, coverage, privacy, who runs this (`cuj-trust-objections`, critical_user_journey, overall 3.4)

**Persona:** Sceptical buyer, or owner who found their own home on the site  
**Goal:** Decide whether to rely on the numbers, and hide or correct a home  
**Why critical:** The AE-34 stop rule is that labels fail if users treat preview as official. The trust measure is comprehension of achieved vs asking and of missing evidence (02-PRIORITIES). Legal groundwork just landed (docs/legal, commit 0c6e141).

**Steps walked:**
1. /guide index and /guide/reading-the-map
2. /privacy (hide a home), /terms
3. Property page footer: 'Wrong, or your home? … report an error or hide it'
4. Look for About/contact/data-freshness

| axis | score | rationale | evidence |
|---|---|---|---|
| clarity | 4 | The guide is plain-English, one article per figure. | capture/text/guide-d.txt |
| task completion / friction | 4 | Hide/report is reachable via the property 'More' menu or map selection. | capture/text/terms-d.txt 'Report or hide this home' |
| trust & credibility | 3 | Terms say 'run by the Close Knit operator' with no named entity, and contact falls back to privacy@close-knit.local. There is no About page or independence statement. | web/src/app/terms/page.tsx:21; terms-d.txt |
| visual & interaction quality | 4 | Calm, readable long-form pages. | capture/shots/guide-d.png |
| performance & robustness | 4 | 0.85 s, 0 errors. | capture INDEX |
| accessibility & mobile | 4 | Long-form pages reflow well. | capture/shots/privacy-m.png |
| value delivered vs. product goals | 3 | The honesty is real but sits in fine print. | property-profile.tsx:319 |
| value proposition strength | 3 | 'Achieved prices, never asking prices' is the best sales line on the site and only appears as a meta footnote. | property-profile.tsx:319 |
| conversion & shareability | 2 | No feedback or contact channel apart from a privacy e-mail. | grep mailto -> privacy/terms only |

**Top issues:** No named operator/About; Honesty not used as a selling point; No general feedback channel

## Proposals

| # | title | impact | effort | confidence | journeys |
|---|---|---|---|---|---|
| 1 | Rewrite the first-view value proposition with a proof strip | high | S | high | cuj-first-visit-value, cuj-share-referral-loop, cuj-trust-objections |
| 2 | Add OpenGraph/Twitter cards with dynamic images for area, property, ranking and match links | high | M | high | cuj-share-referral-loop, hp-listing-price-check, hp-seo-rankings-to-area, cuj-first-visit-value |
| 3 | Make match sharing visible: confirmation, native share sheet, short link | high | S | high | cuj-share-referral-loop, cuj-find-my-area-shortlist |
| 4 | Frame shared links for the recipient: 'Shared with you' plus 'Make it yours' | high | S | medium | cuj-share-referral-loop |
| 5 | Put 'Is the asking price fair?' on the property and postcode pages | high | M | high | hp-listing-price-check, cuj-trust-objections |
| 6 | Make the comparison dialog presentable and consistent | high | M | medium | cuj-find-my-area-shortlist |
| 7 | Add next-step CTAs to area, ranking and postcode pages | medium | S | high | hp-seo-rankings-to-area, cuj-first-visit-value |
| 8 | Branded 404 and honest unknown-postcode handling | medium | S | high | cuj-first-visit-value, hp-listing-price-check |
| 9 | Private-beta conversion: opt-in launch list plus AE-34 study sign-up | high | M | medium | cuj-first-visit-value, cuj-trust-objections, cuj-find-my-area-shortlist |
| 10 | Promote 'Use with Claude' as a first-class entry and verify its prod URL | medium | S | high | hp-use-with-claude, cuj-first-visit-value |
| 11 | About / independence page with a named operator, contact and data freshness | medium | S | high | cuj-trust-objections, cuj-first-visit-value |
| 12 | Make the home a crawlable landing without hurting the map | medium | S | medium | hp-seo-rankings-to-area, cuj-first-visit-value |
| 13 | Surface the decision brief and 'Saved areas' as the output of Find my area | high | M | medium | cuj-find-my-area-shortlist |
| 14 | Shareable 'Explore' chips (Coffee vs kebab, Nightlife…) as social content | medium | M | medium | cuj-first-visit-value, cuj-share-referral-loop |
| 15 | Instrument the funnel with the existing opt-in redacted telemetry | high | M | medium | cuj-first-visit-value, cuj-find-my-area-shortlist, cuj-share-referral-loop, hp-use-with-claude |
| 16 | Low-key 'For teams' page (relocation, API/MCP) as a B2B probe | low | S | low | hp-use-with-claude, cuj-trust-objections |

### 1. Rewrite the first-view value proposition with a proof strip

- **Problem:** The first view says only 'Find a London area that fits your budget, commute and life'. It never says why this beats a portal, and the only H1 is 'Choose an area on the map or search' (j1; first-visit-intro.tsx:65).
- **Change:** In first-visit-intro.tsx, replace the line with a 2-line pitch: 'What London homes really sold for, and which areas fit your budget and commute.' Add a 3-item proof strip under it: 'HM Land Registry sold prices · police.uk crime · Ofsted schools — every figure sourced'. Add 'No listings, no agent fees: nothing here is paid placement'. Make the intro an H1 (visually unchanged) and keep the 'Find my area' CTA. Mirror this in the layout.tsx default title ('London Close Knit — what homes really sold for, area by area').
- **Improves:** cuj-first-visit-value value proposition 2->4 and clarity 3->4; the recipient half of cuj-share-referral-loop; the efficiency/trust measures in 02-PRIORITIES (users can say achieved vs asking)
- **Affects / trade-offs:** Intro card height on mobile (keep it at 3 lines max), SEO title/H1, e2e snapshot baselines (intro text). Copy must avoid demand/payment claims (README Validation status).
- **Impact / effort / confidence:** high / S / high

### 2. Add OpenGraph/Twitter cards with dynamic images for area, property, ranking and match links

- **Problem:** No page has og:* or twitter:* tags (grep openGraph in web/src/app returns none; j1 og=[]). Every share in WhatsApp/iMessage/Slack shows as a bare URL; the match link is 585 characters.
- **Change:** Add a metadata.openGraph default in app/layout.tsx. Add generateMetadata openGraph for area/[carrier]/[code], property/[uprn], postcode/[code] and rankings/[slug]. Add app/**/opengraph-image.tsx (next/og ImageResponse) that renders the area name, £/m², trend and the knit logo, with a demo/real label baked in. For the match link (hash state is invisible to crawlers), the card is the generic 'Someone shared a London shortlist with you'.
- **Improves:** Conversion & shareability on every journey (2->4); click-through on shared links; adoption (joint decision)
- **Affects / trade-offs:** Server render cost for OG images (cache them; Edge runtime). The image must carry the 'Demo data' label in demo mode. A property image must not expose more than the page (privacy objections: hidden homes must 404 for OG too).
- **Impact / effort / confidence:** high / M / high

### 3. Make match sharing visible: confirmation, native share sheet, short link

- **Problem:** shareProfile (personal-match-panel.tsx:561-568) sets the hash and silently writes the URL to the clipboard. There is no 'Link copied' status, no navigator.share on phones, and the URL is 585 characters (j3).
- **Change:** Reuse the PropertyShare pattern (property-share.tsx:9-21): navigator.share first, then clipboard, then a role=status 'Link copied — anyone with it sees your budget and place'. Phase 2: an API endpoint that stores the already-consented fragment server-side, returns /s/<id>, and expires it after 30 days.
- **Improves:** cuj-share-referral-loop conversion 2->4 and accessibility 3->4 (status for screen readers); cuj-find-my-area-shortlist conversion
- **Affects / trade-offs:** Phase 2 is new persistence of profile data, which needs a privacy notice and LIA update and conflicts with 'never persist raw profiles' (ROADMAP-personal-area-match); keep phase 1 only unless legal agrees. Update e2e share tests.
- **Impact / effort / confidence:** high / S / high

### 4. Frame shared links for the recipient: 'Shared with you' plus 'Make it yours'

- **Problem:** A recipient opening #profile=v1.… sees 'Your matches' and 'Your search: Buy · up to £600k…' with no intro (j3 RECIPIENT; recipient-d.png).
- **Change:** When the profile was decoded from the URL hash and not built locally, show a banner above 'Your matches': 'A shared London shortlist · Buy up to £600k · 2-bed · Westminster ≤30 min'. Give it buttons 'Adjust to my budget' (opens Find my area prefilled) and 'What is Close Knit?' (expands the intro pitch from proposal 1). Rename 'Your search' to 'This search' until the recipient edits.
- **Improves:** cuj-share-referral-loop clarity 2->4 and value proposition 2->4; referral-to-activation rate
- **Affects / trade-offs:** personal-match-panel.tsx and match-brief.ts import path; shortlist import dialog (shortlists.tsx:337) for consistency; e2e fixtures
- **Impact / effort / confidence:** high / S / medium

### 5. Put 'Is the asking price fair?' on the property and postcode pages

- **Problem:** The strongest differentiator vs portals (achieved vs asking, comparables, R02 valuation research) needs an exact address, and the asking-price input (lib/user-candidates.ts:146,295) is buried in the area full page (area-full-page.tsx:531).
- **Change:** Add a compact 'Asking price' input on /property/[uprn] and /postcode/[code]/homes. It returns 'X% above/below the latest achieved price and the local £/m² middle half', reusing the user-candidates comparison logic and the existing 'Price per m² nearby' quartiles, and stays client-side only. Add a home-search hint: 'Paste an address from a listing'.
- **Improves:** hp-listing-price-check task completion 3->4 and value proposition 4->5; the AE-34 trust measure (achieved vs asking); a natural share moment ('this flat is 12% over')
- **Affects / trade-offs:** Copy must say 'not a valuation' (terms 'Public records, not advice'). No persistence of the entered price (privacy). Pages stay SSR with a small client island; tests in user-candidates.
- **Impact / effort / confidence:** high / M / high

### 6. Make the comparison dialog presentable and consistent

- **Problem:** Compare shows internal IDs and releases ('uk:lsoa:E01000002 · observed · preview-price-2026-06'), lists weight-0 factors as 'Not published', and says '440,000 budget fit 100/100' while the card shows ~£686k over budget. It also looks unstyled (sales/compare-d.png).
- **Change:** In area-comparison.tsx, show human values first ('~£686k for a 2-bed · £86k over budget'). Move carrier/release/ID into a (?) HelpTip. Collapse weight-0 rows into 'Not in your priorities (6)'. Use the same price number the cards use. Style Remove as knit secondary buttons and drop the striped header cell.
- **Improves:** cuj-find-my-area-shortlist trust 3->4 and visual 3->4. Comparison is a pre-registered AE-34 task area and part of the paid 'enhanced comparison' hypothesis.
- **Affects / trade-offs:** Comparison tests and snapshot, decision-brief.tsx (shares the measures), DESIGN.md button rules; needs a real-data check that affordability values match card prices
- **Impact / effort / confidence:** high / M / medium

### 7. Add next-step CTAs to area, ranking and postcode pages

- **Problem:** The only area-page action is 'Open on the map' (j4 AREA CTAs). The map area panel has no save/share/match action (j5 PANEL actions), so organic visitors leak out.
- **Change:** Below 'At a glance' on area-full-page.tsx and in the map evidence panel, add: 'Find areas like this in my budget' (opens Find my area prefilled with this area's typical 2-bed cost and nearest station), 'Compare with…' (adds to the comparison tray), and 'Share' (PropertyShare component). On ranking rows, add a 'Compare' tick.
- **Improves:** hp-seo-rankings-to-area task completion 3->4 and conversion 2->3; cuj-first-visit-value value delivered 3->4
- **Affects / trade-offs:** Area pages are SSR and SEO-indexed, so the CTA must be a client island. Prefill logic touches preference-panel.tsx. Watch mobile sheet height.
- **Impact / effort / confidence:** medium / S / high

### 8. Branded 404 and honest unknown-postcode handling

- **Problem:** There is no app/not-found.tsx, so the user gets Next's bare 'This page could not be found.' Search offers 'E1 1AA: prices and sales' and Enter leads to that 404 (j4). The coverage gap is partly fixture-only, but any postcode the data does not cover in prod hits the same dead end.
- **Change:** Add app/not-found.tsx with the brand header, a search box, 'We cover Greater London' and links to /area/london and rankings. In postcode/[code]/page.tsx, return a 'We have no records for this postcode yet' page that names the nearest covered area instead of notFound(), when the postcode is valid but uncovered. Only offer 'prices and sales' in search suggestions when the postcode resolves.
- **Improves:** cuj-first-visit-value task completion and performance/robustness; less bounce from out-of-coverage searches
- **Affects / trade-offs:** SEO: keep a 404 status for invalid codes and a soft page with noindex for uncovered ones. RELEASE-CHECKLIST step 6 expects /postcode/nope to be a 404 (keep it).
- **Impact / effort / confidence:** medium / S / high

### 9. Private-beta conversion: opt-in launch list plus AE-34 study sign-up

- **Problem:** The site has no capture point at all: no waitlist, newsletter or feedback (grep for waitlist/signup returns only legal mailto). Production is behind basic auth, and AE-34 needs 8-12 households, mostly from outside the team's network (protocol 'Sample').
- **Change:** Add a small 'Tell me when Close Knit opens to everyone' e-mail form (double opt-in) in the menu and footer, with a separate checkbox: 'I'm moving in London soon and could join a 45-minute research session'. Store only e-mail + consent + date. Record the acquisition channel (utm) per the protocol's recruitment-channel rule.
- **Improves:** Conversion on all journeys; gives AE-34 a recruitment channel beyond friends; first measurable demand signal without making demand claims
- **Affects / trade-offs:** Privacy notice and LIA update (new purpose: marketing/research consent), ICO registration checklist (docs/legal/ico-registration.md), SMTP config (CLOSE_KNIT_SMTP_* already exists), data retention. Sending recruitment messages still needs a separately authorised action (protocol 'Consent').
- **Impact / effort / confidence:** high / M / medium

### 10. Promote 'Use with Claude' as a first-class entry and verify its prod URL

- **Problem:** /claude is the only place that promises listing discovery and new-home watches. It is reachable only from the hamburger menu (top-bar-menu.tsx:91-95), and its connector URL silently falls back to http://127.0.0.1:8080 if CLOSE_KNIT_PUBLIC_URL is unset (claude/page.tsx:17).
- **Change:** Add a secondary link under the intro CTA ('or ask Claude to find it for you →'). Add a sample-conversation screenshot or short loop to /claude. Make the build fail, or log at boot, when NODE_ENV=production and CLOSE_KNIT_PUBLIC_URL is unset, and add a RELEASE-CHECKLIST line: '/claude shows the public MCP URL'.
- **Improves:** hp-use-with-claude conversion 2->3 and task completion 3->4; supports the agent/AEO strategy (ROADMAP-property-intelligence)
- **Affects / trade-offs:** Home intro space on mobile; MCP endpoint load and rate limits (CLOSE_KNIT_RATE_LIMIT); terms already cover the MCP endpoint
- **Impact / effort / confidence:** medium / S / high

### 11. About / independence page with a named operator, contact and data freshness

- **Problem:** Terms say 'Close Knit is run by the Close Knit operator' and the contact falls back to privacy@close-knit.local (terms/page.tsx:21). There is no About page, and no statement that recommendations are not paid placement, which 02-PRIORITIES explicitly warns about.
- **Change:** Add an /about page: who runs it (a legal entity or a named individual, required for UK GDPR controller identity anyway), an independence pledge ('no agent pays to rank'), a data-freshness table (release ID, latest month per source from /api/v1/metrics) and how to report a wrong figure. Link it from the footer next to Sources & privacy.
- **Improves:** cuj-trust-objections trust 3->4; objection handling for 'who is behind this' and 'is it current'
- **Affects / trade-offs:** Legal: the controller identity must match the privacy notice and the ICO registration. Data: freshness pulled from the existing metrics endpoint. Low maintenance if generated.
- **Impact / effort / confidence:** medium / S / high

### 12. Make the home a crawlable landing without hurting the map

- **Problem:** Home H1 is 'Choose an area on the map or search', the title is just 'London Close Knit', and there is no crawlable text linking to rankings or area hubs (j1). Area pages carry JSON-LD (j4: ld=1), the home does not.
- **Change:** Add a visually hidden-until-scroll or bottom-sheet 'About' section to app/page.tsx: an H1 pitch, links to /area/london, the top rankings and /guide, plus WebSite + SearchAction JSON-LD (search by postcode). Keep the map first on screen.
- **Improves:** hp-seo-rankings-to-area acquisition; cuj-first-visit-value clarity
- **Affects / trade-offs:** SEO and AEO (llms.txt already exists); the home's LCP must not regress. The DESIGN.md 'map is real' rule is respected because the copy lives in the sheet.
- **Impact / effort / confidence:** medium / S / medium

### 13. Surface the decision brief and 'Saved areas' as the output of Find my area

- **Problem:** The brief and shortlists sit behind a collapsed 'Saved areas & costs' disclosure (personal-match-panel.tsx:207), and /brief alone says 'This brief link is incomplete' (capture/text/brief-d.txt). The brief is the leading paid hypothesis (02-PRIORITIES).
- **Change:** After results, show a persistent 'Save shortlist' and 'Get my brief (PDF/print)' pair next to Share. Give /brief with no hash an explainer and a 'Start Find my area' button instead of the error state. Reuse the area pack print styles (/area/lsoa/…/pack).
- **Improves:** cuj-find-my-area-shortlist task completion and conversion; the AE-34 adoption measure (voluntary return to a saved shortlist); lets a future paid brief be tested
- **Affects / trade-offs:** decision-brief.tsx, shortlists.tsx and the local storage of shortlists (privacy unchanged, local only); print CSS; e2e
- **Impact / effort / confidence:** high / M / medium

### 14. Shareable 'Explore' chips (Coffee vs kebab, Nightlife…) as social content

- **Problem:** The playful chips ('Good coffee vs cheap kebab', j5) are the most viral-able content on the site, but there is no share action and no social card.
- **Change:** Add a Share button to the custom-layer panel. Give each chip a stable URL (/explore/coffee-vs-kebab, SSR with top-3 lists) and an OG image showing a mini London map in the knit style. Use these in launch posts.
- **Improves:** Top-of-funnel reach (referral/social) and shareability; feeds cuj-first-visit-value with warmer visitors
- **Affects / trade-offs:** New SSR routes and sitemap entries; OG image generation (proposal 2). Data is OSM/ODbL places, so attribution must appear on the image (DATA-LICENCES.md).
- **Impact / effort / confidence:** medium / M / medium

### 15. Instrument the funnel with the existing opt-in redacted telemetry

- **Problem:** There is no way to measure intro CTA → wizard complete → compare → share → recipient open → Claude copy. 02-PRIORITIES requires baselines before thresholds, and analyticsConsent exists but only gates match events (lib/matching.ts:381).
- **Change:** Define 8 redacted event names (no profile values): intro_find, wizard_step2, wizard_done, compare_open, share_confirm, shared_open, brief_open, claude_copy. Emit them only with consent. Add a tiny admin count view or a log export.
- **Improves:** Makes every other proposal measurable (Efficiency, Adoption measures); conversion decisions become evidence-based
- **Affects / trade-offs:** Privacy notice wording, the consent UI (your-search.tsx:335) and API ingestion; keep payloads free of budgets or places (privacy.py rules)
- **Impact / effort / confidence:** high / M / medium

### 16. Low-key 'For teams' page (relocation, API/MCP) as a B2B probe

- **Problem:** ROADMAP-property-intelligence targets lenders, conveyancers and other agents as consumers, but the site has no B2B entry point. 02-PRIORITIES says there is not enough evidence to prioritise agent lead generation, so a probe should be cheap and unbiased.
- **Change:** Add /teams: what the API/MCP returns (evidence + sources), the rate limits, licensing (OGL/ODbL, ODbL download already exists), and a 'Talk to us' e-mail. Explicitly exclude paid ranking or lead sales.
- **Improves:** Commercial-potential measure (requested outputs, reasons for refusal) without biasing the consumer product
- **Affects / trade-offs:** Terms (acceptable use / no bulk extraction vs API access), rate limits, support load. Confidence is low that demand exists.
- **Impact / effort / confidence:** low / S / low

## Caveats

- Fixture artefacts not penalised: 3 preview areas only, 'Baker Street' has no results, E1 1AA has no data, commute/crime rows 'Not published' in compare. The compare price contradiction and raw-ID presentation are judged as design issues and need re-checking on real data.
- Timings come from a warm Next dev server and do not represent production.
- Compare on mobile and the Claude connector end-to-end (needs an MCP host) were not walked.
