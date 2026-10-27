# Estate agents and distribution roadmap

Companion roadmaps: [research-driven features](ROADMAP-research-driven-features.md),
[personal area match](ROADMAP-personal-area-match.md),
[property intelligence](ROADMAP-property-intelligence.md).

## Why

Portals (Rightmove, Zoopla, OnTheMarket) hold nearly every listing because agents send them feeds,
and agents stay because buyers are there. Challengers that overtook a leader came with a hook
useful without full stock (Zillow and Zoopla valuations, Leboncoin's audience, Beike's verified
listings); agent-led portals without one (OnTheMarket, Hjem.no) stayed small. Close Knit does not
try to replace the portals: it is where Londoners decide where to live and whether a home is
worth it, next to wherever they found it. Agents are partners for supply and distribution.

## Items

| # | Item | What it gives | Status |
|---|---|---|---|
| 1 | Estate agents by neighbourhood: directory, homes on offer from agents' own sites (facts and links), Google rating on request | Who works in an area, how many homes, links to them; agents become visible partners | Spec: [2026-10-12 agents directory](docs/superpowers/specs/2026-10-12-london-agencies-directory-design.md) |
| 2 | Area widget for agents' sites | Agents get a free "About this area" block on every listing page; we get links, brand and a reason to talk about feeds | Proposed (below) |
| 3 | Free listing feeds from agents (BLM/RTDF) | The only lawful route to near-complete stock | After demand test |
| 4 | Paste or share a listing | Any home found on a portal or agent's site gets Close Knit's area and price evidence, on the website and from the phone's share sheet | Proposed (below); build first of 4–5 |
| 5 | Browser extension for portals and agents' sites | Close Knit evidence beside the listing the user is viewing on a computer | Proposed (below); after 4 |

### 2. Area widget for agents' sites

- An "About this area" card on the agent's listing page for the home's postcode: schools within
  walking distance, nearest station and minutes to a central hub, crime against the London
  average, nearest park, the price range of recent nearby sales of similar homes; a "Full area
  report" link to Close Knit and the source credit.
- Embedding: one script tag (`data-postcode`) rendering a lightweight embed page; templates or
  plugins for the common agent website platforms (Property Hive, Street, Reapit and others found
  by the crawler spike) so every listing gets it without manual work.
- Honesty rule: the agent picks which sections to show, never the values inside them; no verdict on
  the asking price; the same evidence and caveats as the area page.
- Privacy: no cookies, no visitor identifiers; we keep only view counts per postcode district.
- Load: responses cached per postcode; rate limited per embedding domain.
- Validation: show the widget on their own listings to the 20–30 London agencies in the feed demand
  test; build it when several want it installed.

### 4. Paste or share a listing

- Input: a listing URL plus the text that comes with it. Portal apps share a title such as "3 bed
  house for sale in Elm Road, London W13"; the user may also paste an address or postcode.
- We never fetch the portal page. The place comes from the shared or pasted text: a full postcode,
  else street + district through the existing street-level search (OS Open Names), else the user
  picks from candidates. Price and bedrooms are read from the text when present, otherwise asked.
- Output: the existing `assess_listing` evidence (price against local sales, questions to ask the
  agent) plus the area summary and the user's places (commute, schools); "Add to shortlist".
- Surfaces: a "Check a listing" box on the website and the MCP; Android share target (an
  `ACTION_SEND` intent filter for text); an iOS share extension when the iOS app exists.
- Privacy: the URL and text are used for this request; only the resolved place, price and beds are
  kept, and only if the user saves the home.

### 5. Browser extension for portals and agents' sites

- Desktop Chrome first (Edge uses the same build), Firefox and Safari later. Mobile browsers are out
  of reach (Chrome on Android has no extensions), which item 4 covers.
- Rightmove, Zoopla, OnTheMarket: host permission for these three sites only; on a listing page the
  extension reads what the user's page already shows (postcode or map coordinates, price,
  bedrooms, tenure) and shows a Close Knit side panel with the evidence from item 4.
- Agents' sites and any other page: no "all sites" permission; the user clicks the extension icon
  (`activeTab`) and only then is the page read.
- Rules: the panel is clearly Close Knit's own and does not hide, change or imitate the portal's
  page; nothing from the page is stored by us beyond what item 4 keeps; no browsing history, no
  identifiers; the page is read only in the user's browser, never fetched by our servers.
- Maintenance: one parser per portal tested against synthetic page fixtures; the extension reports
  only a parse-failure count per portal (no page content, no identifiers), so a layout change shows
  up without us fetching portal pages; a broken parser falls back to "click to read the page".
- Before launch: a solicitor's read of the overlay against the portals' terms and trade marks;
  Chrome Web Store privacy disclosure.

## Validation

Before item 3: write to 20–30 independent London agencies offering a free, non-exclusive feed with
buyer enquiries passed on; build feed intake if 5–10 agree.

## Kept non-goals

No scraping of portals; no ratings or scores of our own for agents; no paid placement in area
evidence; no point price for an individual home; no admission probabilities.
