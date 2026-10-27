# Browser extension: legal posture, data and money (decisions 2026-10-18)

Owner decisions from the 2026-10-18 extension thread.

Evidence:
- `docs/growth-2026-10/research/09-extension-competitors.md`: what competitors show, charge and earn.
- `10-extension-legal-risk.md`: 22 extensions, portal terms, risk matrix.
- `11-portal-links-and-zones.md`: deep links, drawn zones, map overlay.

This is not legal advice. A UK solicitor reviews it before the store listing.

## 1. The balance we chose

Do what the market leaders do (Area360, PropertyData, Propbar), minus everything that turns an
extension into a target.

**Why this balance.** Panels on Rightmove and Zoopla pages have run for years at every competitor.
The portals answer with page changes, not lawsuits. Letters and claims follow other things:
- a copy of the portal's database (prices, photos, listing archive);
- server-side scraping;
- revealing addresses;
- reselling portal data for money.

Being visible on the page is our hook, so we keep it. What makes us a target, we drop.

**Do (green)**
- **In-page panel under the price and the results line** on every portal except SpareRoom
  (explicit "integrations" ban): side panel there.
- **Lazy results line:** fetch only for cards in view, not a batch of 25.
- **Compute listing-only facts in the browser:** costs, days on market, price history and lease
  flags. Send our server only coordinates, price, type and beds; store nothing.
- **Compete on our own data:** match, commute, Land Registry sales, area, "Before you offer", new
  open-data layers.
- **Data from our users, with consent:**
  - "what you pay": rent, service charge, council tax;
  - area reviews;
  - search outcome;
  - aggregate demand by area: area id and counts only, never listings.
- **From our site, plain search links;** drawn zones only on Zoopla and OnTheMarket.

**Do with safeguards (amber)**
- **A server-side kill switch per portal** (`inline` / `side-panel` / `off`), changed without a
  release. If a portal writes, we comply within hours. This is the key safeguard.
- **A Chrome Side Panel mode,** built now as the fallback the switch flips to.
- **A professional operator posture:**
  - a named controller, ICO, trader status in the store;
  - an "Independence / not affiliated" section and a trademark notice in the terms;
  - a privacy policy written for the extension;
  - a "Not affiliated" line in every panel we show.
- **Unlisted store distribution** (invite link) until the solicitor's review; the public listing
  comes after.
- **Partnerships:** write to OpenRent (it has an affiliate programme) and OnTheMarket (agent-owned,
  rival to Rightmove). Then Zoopla through Hometrack, then Rightmove data services.

**Never (red)**
- Store portal listings, their prices or photos. The `CLOSE_KNIT_LISTING_HISTORY` flag and table
  068 go.
- Show a full address or a value range until a solicitor and the ICO position allow them (the
  flags stay off).
- Fetch portal pages from our servers.
- Overlay or modify the portal's map. This includes driving their Google Maps instance, which runs
  on their API key and quota.
  - Owner, 2026-10-19: our line inside the card a map pin opens (not on the map, no Maps API calls) is
    allowed behind the server flag `features.mapPopup`, on until the solicitor settles it. The results
    line has its own flag `features.resultsLine` and now shows in every mode but `off`.
    Env `CLOSE_KNIT_EXTENSION_FEATURES` switches either without a release.
- Rightmove `draw-a-search` links, which robots.txt disallows, and links to portals from inside the
  extension.
- Paid features inside the extension on portal pages.

## 2. "Fully legal" is only possible with a licence

Without a licence, Rightmove (5.2, 5.5.2, 8.3, 13.4), OnTheMarket (2.2, 3.4) and SpareRoom
("integrations") forbid almost any extension as written.

The terms bind users, not us. Our exposure is:
- inducing a breach: we know the terms, so "we didn't know" does not work;
- database right, if we extract or store;
- copyright, for photos.

**Modes, from most to least risk**
1. **In-page injection:** today's behaviour.
2. **Chrome Side Panel:** our UI next to the page, nothing injected.
3. **Click to read (`activeTab`):** the user clicks our button, we read that one page once and show
   our panel. This is the closest to "direct human interaction".

**What each portal allows without a licence**

| Portal | Inject into the page | Read the page | Link to the portal | Default mode |
|---|---|---|---|---|
| OpenRent | allowed (no clause) | allowed if not bulk | allowed | inline |
| Zoopla / PrimeLocation | no explicit ban | grey ("monitor", data mining) | home page only | inline, revisit after the solicitor |
| OnTheMarket | no ("modify… frame") | grey | no deep links | inline today; side panel if asked |
| Rightmove | no ("alter, modify, overlay") | grey ("facilitates") | no ("in… extension") | inline today; side panel if asked |
| SpareRoom | no ("integrations") | not without consent | allowed | side panel, or ask permission |

## 3. User choices (first-run screen)

Checkboxes do **not** move liability to users. The portal is not party to our terms, and our own
extraction, storage and knowledge stay ours. A box such as "I understand this may breach
Rightmove's terms" documents our knowledge and is a dark pattern, so we never use one.

They do help:
- the in-page view becomes the user's own browser setting;
- they carry the consents UK GDPR and the Chrome Web Store need.

**Settings on the first-run screen**

| Setting | Default |
|---|---|
| Per portal: **panel beside the page** or **on the page** | on the page; SpareRoom beside (owner, 2026-10-18) |
| Send the open listing's coordinates and price to show area data | on (needed), clearly explained |
| Help anonymous area-demand statistics | off (opt-in) |
| Usage analytics | on, with opt-out (as today) |

The screen ends with: "Close Knit is independent and not affiliated with these sites" and a
privacy link.

Our terms add:
- a licence "for your own use in your own browser";
- "you are responsible for following the terms of sites you visit";
- no warranty;
- limited liability.

## 4. Data: what we may collect to beat competitors

| Source | Examples | Risk | Decision |
|---|---|---|---|
| **A. Open data not yet loaded** | Land Registry CCOD/OCOD (company and overseas owners); Inside Airbnb; ONS private rents + VOA bands; GLA London Development Database and Planning Datahub (pipeline); Ofcom mobile; borough HMO and licensing registers; TfL future stations; UK HPI by type; Opportunity Areas; LAEI air (licence) | none | the owner leads this separately |
| **B. Our users, with consent** | "what you pay", area reviews, search outcome, aggregate demand by area | low | build |
| **C. Aggregates of listings our users view** | supply, asking £/m², asking vs sold, days to sell, share of cuts, asking rent and yield | grey: possibly "repeated and systematic extraction" | only after the solicitor. If allowed: computed in the browser, area/month/median/count only, minimum N, no IDs or addresses |
| **D. Licensed** | Hometrack (Zoopla), Rightmove Data Services, the OpenRent affiliate programme, agents in our directory | none (paid or negotiated) | pursue with traction |

## 5. Money and the company

**Earn on our site, not on portal pages.** The extension stays free and ad-free; it brings people
to Close Knit. This is PropertyData's model, and PropertyData is the only competitor that clearly
makes money.

| Revenue | Where | Clean? |
|---|---|---|
| Partner links (mortgage, conveyancer, surveyor, insurance) at "Before you offer" | our site | yes |
| Home report (Land Registry, EPC, area, your places), within our no-valuation rule | our site | yes |
| Agents and B2B: widget, API, "want to sell" leads | site, API | yes |
| Statistics from open data and consented user data | B2B | yes |
| Paid features inside the extension on portal pages | portal page | no |
| Selling statistics derived from portal listings | B2B | no, until licensed |

**Clean data provenance is company value.** Due diligence checks where data comes from. A copy of
portal listings is a liability the buyer must delete; open, consented and licensed data is an
asset.

**Company sequence**
1. **Employer disclosure** before any revenue (approved 2026-10-27).
2. **A Ltd before the public extension launch,** for limited liability. ILR allows it.
3. **ICO in the Ltd's name,** trader status in the store, the "Close Knit" trade mark (UKIPO).
4. **One solicitor review covering:**
   - ICO and the LIA;
   - terms and privacy;
   - the extension: in-page panel, links, database right;
   - partner links.
5. **Professional indemnity and cyber insurance** once revenue starts.
6. **Licence talks:** OpenRent, then OnTheMarket, then Zoopla/Hometrack.

## 7. Behind feature flags, on by default (owner, 2026-10-19)

`/api/v1/extension-config` carries `features`, which `CLOSE_KNIT_EXTENSION_FEATURES` can change without a release.

- **`resultsLine`:** the line under every search result, in any listing mode except `off`.
- **`mapPopup`:** our line inside the portal's map pin card on Rightmove, Zoopla and OnTheMarket.
  - When the page's data lacks that pin, the extension fetches the listing page in the user's
    browser, one fetch per card the user opened.
  - That is automated access (Rightmove 5.5, Zoopla "scraping"): medium risk.
  - **A question for the solicitor.** If a portal objects, set the flag off.

## 6. Backlog for extension 0.4.0

1. A server-side kill switch per portal (`inline` / `side-panel` / `off`).
   - [x] Server: `GET /api/v1/extension-config`, env `CLOSE_KNIT_EXTENSION_MODES` (branch `claude/ext04-server`).
2. A Chrome Side Panel mode; SpareRoom uses it from the start.
3. The first-run screen from §3.
4. A lazy results line (cards in view only).
5. Listing-only facts computed in the browser; the server gets coordinates, price, type and beds.
   - [x] Server: the card's `costs` block carries `councilTaxByBand` (£ a month, A-H) so the band stays local.
6. Remove `CLOSE_KNIT_LISTING_HISTORY`, `listing_history.py` and table 068 (it is empty).
   - [x] Done: code and tests removed; migration `070-drop-listing-price-observation.sql` (069 was taken).
7. Remove links to portals from inside the extension.
8. "Not affiliated" in every panel. Terms and privacy text for the extension (Independence,
   trademark notice, licence, user responsibility).
   - [x] Server: the not-affiliated line is served as `notice` in `/api/v1/extension-config`.
