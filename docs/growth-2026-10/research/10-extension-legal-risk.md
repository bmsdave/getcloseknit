# Portal extensions: legal posture, portal terms and risk

Research date: 2026-10-18. Companion to `09-extension-competitors.md`. **Not legal advice.** Get a UK
solicitor's review before any store listing.

How the evidence was gathered:
- Store pages: Chrome Web Store (CWS).
- Companies: Companies House (CH).
- Data controllers: the ICO register. It blocked repeated lookups, so a few entries are unchecked.
- Portal terms: read on 2026-10-18.

Raw page dumps sit in the session scratchpad, not in the repo.

Risk is my judgement of how likely a portal is to act (complaint, takedown, letter, claim), and how
much that would hurt.

**What raises risk**
- storing portal data (a crowd-built price history, listing snapshots, old photos);
- revealing a home's full address;
- heavy changes to the page;
- charging money;
- being an identifiable company with revenue (a target worth pursuing).

**What lowers risk**
- reading only the page the user has open;
- storing nothing;
- a small badge or a popup instead of a page change.

## 1. Competitor extensions

T = trader, NT = non-trader (CWS). RM = Rightmove, ZP = Zoopla, OTM = OnTheMarket, OR = OpenRent.

| Extension (users) | Operator | Sites | Data shown or stored | How it changes the page | Legal posture | Risk |
|---|---|---|---|---|---|---|
| Rightprice (656) | Happy Solutions Ltd 12914173, T, **company dissolved Feb 2025** | RM | Price history, full address, sold and rental prices. Collects data "every few minutes" on its own server | Inline | No privacy policy | **Very high**: scrapes from its server |
| Property Log (100k) | Anonymous (gmail), NT | RM | **Largest crowd price history**; £2.99/mo | Inline list | "Not affiliated" on its site; no named controller. 2018: Rightmove "has not sanctioned" it | **High** |
| Propbar (10k) | Vepler Ltd 13193131, T, ICO ZB535604 | RM, ZP, OTM | Past listings, **old photos and floorplans** ("Time Machine"), comps, planning, AI summary; paid | Panel | Named controller; no disclaimer | **High**: copies photos (copyright) and stores portal data |
| Property Track (3k) | Benns Software 15751857, NT, ICO ZB776907 | RM | Stored price history; Plus £6.99 adds comps | Inline and tabs | Disclaimer, trademark notice | **High** |
| PropertyData (10k) | Liberty Tech Ltd 07689724, T, ICO ZA583081 | RM, ZP, OTM | £/sqft, yield, valuation, title; **keeps listing snapshots**; paid | Sidebar | Named controller | **Medium-high**: a profitable company with stored data |
| Area360 (9k) | Unidentified, NT | RM, ZP | **Full address**, sold history, listing price history, EPC, area data; collects page content | Inline grid | "Not affiliated", trademark notice; anonymous | **Medium-high** |
| Property Previewer (98) | rhettio.com, NT | RM, ZP, OTM, PrimeLocation, PropertyPal, PropertyNews, OR | Crowd price history on its server | Results panel | Privacy policy | Medium-high |
| PaTMa (10k) | Pither Technologies 05892222, T, ICO ZA145246 | RM, ZP, OTM, PropertyPal, PropertyNews | Price history; addresses and comps paid | Panel and popup | Named controller | Medium-high |
| Property Tracker (30k) | Individual, NT, Patreon | RM | Crowd price history (listing ID and price on every visit) | Arrow by the price | Privacy policy on GitHub Pages | Medium-high |
| Address Finder (6k) | Anonymous (gmail), NT | RM | **House number and postcode** on every listing | Inline | Privacy policy on pastebin | Medium-high; broken 6+ times by RM page changes |
| Property Market Intel (3k) | Octo Property SC659721, T, ICO ZB006335 | RM, ZP, OTM | £/sqft, days on market, rent, yield, Airbnb, HMO | Insight block | Terms published as a PDF | Medium |
| Locrating (4k) | Locrating Ltd 07236786, NT, ICO ZA115619 | RM, ZP, OTM | Schools, catchments, flood, noise; stores no portal data | **Whole map on top of the listing** | ICO-registered | Medium |
| Rightmove Property Notes (1k) | Meirion Consulting 10230236, T | RM | Price drops, comps, expected price | Annotations | Generic privacy policy | Medium |
| BrickPal (710) | Property Source Europe 08332577 (operator unclear), T | RM | Deal analysis, comps | Sidebar | Policy cites the 1998 Act; ICO ZA016769 | Medium |
| House Price DNA (51) | Anonymous, NT | RM | Price history | Inline | None | Medium (abandoned) |
| Little Fox insights (581) | Anonymous team, NT | RM, ZP | Area data, commute, £/sqm | On listing | None | Low-medium |
| **Liveable (309)** | Searchbase Ltd 17146810, T, ICO ZC214370 | RM | One area score; **sends only coordinates** | Badge on cards, links to its map | Privacy policy written for the extension | **Low**: the closest analogue to Close Knit |
| Property Picker (1k) | Individual, NT | RM, ZP | Affordability colours | Colours cards | None | Low |
| Show Tenure (229) | Individual, NT | RM | Tenure on results; export | Labels | None | Low |
| Right Size (146) | Individual, NT | RM | Floor area | Labels | None | Low |
| **Lendlord (914)** | Lendlord Ltd 11973095, T | RM, ZP, OTM | Sends the listing URL to its own app | **Toolbar popup only** | — | **Lowest**: leaves the page alone |
| Property Extra | propertyextra.net | RM | Price history | Popup | — | Gone from CWS |

**Patterns**
- **No one claims a portal licence or partnership.** Only a handful state they are "not affiliated".
- **The main stored data is crowd-built price history.** Six extensions keep their own copy of
  listing prices; that is the clearest database-right exposure.
- **Revealing the address is common:** Area360, Address Finder, Rightprice, PaTMa (paid),
  PropertyData.
- **The only public portal reaction found** is a 2018 statement that Rightmove "has not
  sanctioned" Property Log. No lawsuit was found, but the search was shallow.
- **Rightmove fights back by changing its pages.** Address Finder has shipped six or more "works
  again" fixes.
- **Professional operators look alike:** a Ltd, trader status, a named controller and an ICO
  entry. Hobby tools are anonymous.
- **Almost none cover SpareRoom or OpenRent.**

## 2. Portal terms (2026-10-18)

| Portal | What the terms say about extensions |
|---|---|
| **Rightmove** ([terms](https://www.rightmove.co.uk/c/terms-of-use/)) | **5.2:** "must not… adapt, alter, vary, or modify the Platform"; bots, scrapers. **5.5.1/5.5.2:** no extraction except by "direct human interaction"; no "technical means… which… facilitates". **5.6:** no commercial market research. **8.3:** "must not… store, frame, overlay… link to". **13.4:** no links to the Platform "in any other website, application, extension, plug in… includes… deeplinks". English law. robots.txt: listing pages allowed; `draw-a-search`, `map.html?`, `/api/*` disallowed |
| **Zoopla** ([terms](https://www.zoopla.co.uk/terms/)); PrimeLocation is similar | No commercial use "without… a licence". **"No text or data mining, or web scraping"**: no tool "to access, obtain, copy, monitor or republish"; no analysis to find "patterns, trends". No framing; links to the home page only "without prior agreement". English law. robots.txt disallows `/search/`, map pages |
| **OnTheMarket** ([terms](https://www.onthemarket.com/terms/)) | **2.1:** database rights. **2.2:** "must not copy, transmit, modify, republish, store… frame". **3.3:** automated programs must identify themselves and obey robots.txt. **3.4:** no "deep link". **3.5:** home-page link only. **3.6:** no implied endorsement |
| **SpareRoom** ([terms](https://www.spareroom.co.uk/content/default/terms-uk)) | **"will not create any integrations (software or otherwise)… without… written consent"**; no harvesting; content "may not be modified or altered" |
| **OpenRent** ([terms](https://www.openrent.co.uk/terms)) | No harvesting software; no copying without permission. **Has an `/affiliate` programme**: a possible route to a licence. robots.txt doesn't limit listing pages |

**UK law, in brief**
- **Database right** (SI 1997/3032):
  - reg 16 covers a "substantial part" and "repeated and systematic" extraction;
  - *BHB v William Hill*: the right needs investment in *obtaining* the data, and portals receive
    their listings from agents;
  - *Innoweb*: a meta-search engine infringed;
  - *CV-Online* (2021, persuasive only): infringement needs harm to the maker's investment.
- **The terms bind users, not us.** Our exposure is inducing a breach (*OBG v Allan*: needs
  knowledge and intent) and any direct database-right claim if we store data.
- **Computer misuse:** low risk, because the user's own session loads the page.
- **Trade marks:** "Works on Rightmove" is referential use; no logos, no implied endorsement.
- **Chrome Web Store:** a portal's IP complaint can lead to a takedown. Browsing data may only feed
  a feature the user is clearly told about.

## 3. Close Knit's behaviours: risk by portal

| Behaviour | RM | ZP/PL | OTM | SR | OR | Reason |
|---|---|---|---|---|---|---|
| a. Read the open page, send about 10 facts, store nothing (live) | Med | Med | Low-Med | Med | Low | "facilitates", "monitor", SpareRoom "integrations"; a weak database claim |
| b. Panel inside the page under the price (live, 0.3) | **Med-High** | Low-Med | Med | Low-Med | Low | RM 5.2 "alter… modify", 8.3 "overlay"; OTM 2.2 "modify" |
| c. Three-row line under ~25 results (live, 0.3) | **High** | Med-High | Med | Med | Low-Med | Reading 25 listings a page looks systematic |
| d. Shared asking-price history (behind a flag, OFF) | **High** | High | High | Med-High | Med | Repeated and systematic extraction; "store", "trends" |
| e. Matched full address (behind a flag, OFF) | Med | Med | Med | Med | Med | Our own data; mainly a privacy and agent issue |
| f. Links from our site to portal searches (live) | Med | Low-Med | Med | Low | Low | RM 13.4 and OTM 3.4 ban deep links; a plain link is not infringement (*Svensson*). Polygon links hit RM's disallowed `draw-a-search` |
| g. Overlay on the portal's map | High | Med | Med | Low-Med | Low-Med | RM 8.3 "overlay". **Dropped** (owner, 2026-10-18) |

**Where Close Knit sits overall:** medium today. The flags are off, there is no storage and no map
overlay. The results line and the in-page panel on Rightmove are our highest-risk live behaviours.
We look like Liveable (low risk) on data, and like Area360 (medium-high) in how much we change the
page.

## 4. Best path

1. **Store nothing from portals.** Keep `CLOSE_KNIT_LISTING_HISTORY` off for good, or remove it.
   Price memory stays on the device only.
2. **Send the minimum.** Coordinates, price, beds and type, which is close to Liveable's model.
   Drop fields we don't use server-side.
3. **Make the results line lazy.** Fetch a card's line when it scrolls into view or on hover,
   instead of one batch of 25. That is closer to "direct human interaction" and less systematic.
4. **Change the page less on Rightmove.** Default to the side card on Rightmove and the in-page
   panel on the others, with a per-portal setting. Revisit after legal review.
5. **Keep the address and value range off** until a solicitor and the ICO position allow them.
6. **Links:** plain searches only (outcode, price, beds, type). Polygon links only where robots.txt
   allows: Zoopla and OnTheMarket by URL, not Rightmove's `draw-a-search`.
7. **Look like a professional operator** (Propbar, PropertyData, Liveable):
   - a Ltd, or a named controller, with trader status in the store;
   - an ICO registration;
   - a privacy policy written for the extension;
   - an "Independence / not affiliated" section and a trademark notice in the terms;
   - a "Not affiliated" line in every injected panel.

   Not anonymous.
8. **Ask for a licence where one exists:**
   - OpenRent's affiliate programme;
   - Rightmove's `/data-services/`;
   - Zoopla, through Hometrack (B2B);
   - OnTheMarket, which is agent-owned and might value an independent area layer.
9. **Get a UK solicitor's review before the store listing.** Bundle it with ICO and the LIA.
   Questions to ask:
   - inducing breach;
   - database right for behaviours a and c;
   - the in-page panel;
   - deep links.
