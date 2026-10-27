# Close Knit on Rightmove, Zoopla and OnTheMarket: browser extension

Decided with the user on 2026-10-13/14. Goal: **acquisition**. People already search on the portals,
so Close Knit shows up where they look, beside the listing, and leads them to the site.

## Scope (v1)

- **Area card on a listing page** (Rightmove, Zoopla, OnTheMarket): area name, crime / station /
  park / schools / noise in plain words against London, and a coarse asking-price comparison
  (never a figure for the home, see the no-per-home-valuation rule).
- **Personalisation through the site.** Without a saved search the card invites "Personalise",
  which opens Close Knit's own onboarding. On the site, the extension offers "Use it" for the
  saved search (`close-knit.preference-profile.v1`). After that it keeps the copy in step; "Stop
  using my search" in the popup ends that and the offer.
- **Save to Close Knit**: the listing becomes an AE-29 user candidate on the site
  (`/save-listing#listing=v1.…`), every field unverified, kept on the device.
- **Platforms**: Chrome and Chromium browsers (Manifest V3), Safari on macOS and iOS through the
  Xcode wrapper in `extension/safari/`, which is built from the same `dist/`.

Out of v1: badges on search results, drawing search zones (a separate spike on portal
polygon URLs), and Share from the portals' mobile apps.

## Architecture: the server describes the card, the extension draws it

```
portal page ──adapter──▶ ListingFacts ──background──▶ POST /api/v1/listing-card ──▶ blocks[]
                (extension/src/adapters)        (+ saved search)     (api/area_api/listing_card.py)
```

- **Adapters** read each portal's data, not its layout:
  - Rightmove: `window.__PAGE_MODEL`, flattened in `data`.
  - Zoopla: RealEstateListing JSON-LD plus the streamed point.
  - OnTheMarket: `__NEXT_DATA__` › initialReduxState.property.

  A model that belongs to another listing (client-side navigation) is ignored.
- **The card is `listing-card.v1` blocks**: header, cta, match, facts, price, actions and footnote.
  The extension skips any type it does not know, so wording and blocks change without a store
  release. Links are kept only when they point at Close Knit.
- **The server** finds the area with `EvidenceReader.area_at` (the LSOA containing the point) and
  falls back to the full postcode. It reuses the area pack, Getting around and `_price_check`.
  With a saved search it runs the match pack and reports the score, the rank, and the strengths
  and weaknesses (utilities 0–100).
- **Privacy.** The extension sends only the listing's public facts: portal, id, URL, address,
  point, price, bedrooms, floor area, tenure. With the saved search, it sends that too.
  - Never sent: photos, descriptions, agents, page HTML.
  - Responses are `no-store`.
  - The API counts `extension_card` events without an id.
  - Visits from the card are counted as `page_view` with source `extension`.
- **Rate limit**: `/api/v1/listing-card` is an expensive path (cost 10), like `/matches`.

## Verified

- API unit tests and the route through the fake evidence connection.
- Web: `listing-save` tests and the typecheck.
- Extension: adapter tests on synthetic pages in each portal's format, and the typecheck.
- End to end in Playwright Chromium with the unpacked extension against the local stack (real
  data), on live Rightmove (sale and rent) and OnTheMarket listings. Covered: the plain card, the
  offer and "Use it" on the site, the personalised card, Save, and the popup.
- The iOS Safari wrapper builds for the simulator.

Not verified:

- Zoopla in an automated browser: its bot check stops headless Chromium.
- Safari at runtime.

## Open before release

- Production is private (basic auth), so `/api/v1/listing-card` and the pages the card links to
  are closed to the public until going public, or until an exemption is decided.
- A privacy-page section for the extension; the store listings need a privacy policy URL.
- Store accounts: the Chrome Web Store, and an Apple developer team for Safari signing.

## Status 2026-10-18 (extension 0.2.5)

0.2.x closes every gap against the 16 competitor extensions. Research:
`docs/growth-2026-10/research/09-extension-competitors.md`. Contract:
`docs/superpowers/specs/2026-10-18-extension-gaps.md`.

**Card**
- Shown whole, with no "More". The `sections` panel is one column.
- The listing's own facts:
  - property type, council tax band, service charge, ground rent and years left on the lease
    (Rightmove, Zoopla, OnTheMarket);
  - EPC as listed;
  - added-on date and price changes (Rightmove, Zoopla).
- Device memory: when the listing was first seen, and at what price.
- Price strip: the asking price against the area's sales of the same type.
- Days on the market, and the change since the first known price.
- Costs: mortgage, council tax, stamp duty.
- Flags: flood, conservation, ULEZ, lease under 80 years.
- Minutes to your places.
- Stations with their lines, connectivity, park size, schools by Ofsted grade.
- Deprivation, income and social housing. The owner lifted the never-ranked rule on 2026-10-18.
- Listed buildings, Article 4 and planning applications.

**Search results**
- A badge line under each result on Rightmove, Zoopla, OnTheMarket and OpenRent
  (`/api/v1/listing-badges`).

**Behind server flags, all off: `feature_flags.py`**
- `CLOSE_KNIT_ADDRESS_MATCH`: the home's full address.
- `CLOSE_KNIT_HOME_VALUE`: a value range.
- `CLOSE_KNIT_LISTING_HISTORY`: shared asking-price history (migration 068).

## Open after 0.2.5

**Before any home flag is switched on**
- **The address match disagrees with Area360.** On Rightmove 89289420 (NW6 1DQ), Area360 shows a
  last sale of 16 Aug 2013 at £1.0M; our match found sales in 2007 and 2012. Find out which house
  is right. Measure the match rate and the false matches on a sample of listings.
- **Shared price history accepts any posted price.** Count a price only when it comes from several
  distinct clients, or only when the portal's own page confirms it.
- **Privacy and legal review** of showing a listing's address, a value range per home and per-home
  EPC (see the no-per-home-valuation decision). Get the owner's decision.
- **A hidden home can be inferred** from a missing match. Decide whether that is acceptable.

**Presentation**
- Done in 0.3.x:
  - a `summary` panel inside the page under the price, 2×2 groups "only Close Knit" plus a row of
    area pills, with the side card collapsed;
  - a three-row results line: ours, area pills, before you offer.

  Both verified live on Rightmove.
- Each area costs about 36 queries on the first results load, then is cached for an hour. Watch
  latency on production.
- The listing-date keys for Zoopla and OnTheMarket results are unverified on live pages.
- **The collapsed pill shows the coloured number:** the match score, or else the area /10. The
  area /10 is the mean of the station, safety, schools, quiet and green ratings, needs 3 or more
  of them, and is already used by the badges. The owner still has to confirm the method.
- **After "Not now", the offer never comes back.** "Personalise" and the popup should ask again.

**Coverage**
- **SpareRoom results** give only an outcode, so no badge can be placed. This needs an `outcode`
  field in the badges contract, or an area-level badge.
- **OnTheMarket** shows no added-on date or price changes; the page only says "Added > 14 days".
- **Zoopla** has only the date of the latest price change, so earlier prices come from device
  memory.
- **Bungalow and "other" homes** get no price strip, because Land Registry has no matching type.
- **Council tax band I** has no amount.
- **The Safari Xcode project** does not list `results.js` yet.

**Release**
- **Production deploy:** API, web proxy, the Caddy exemption for `/api/v1/listing-badges` and
  migration 068 (an empty table while its flag is off).
- **Store listings** (Chrome Web Store, Safari) and the privacy page, as in "Open before release"
  above.
- **Bump the manifest version on every extension change.**

## Legal posture and roadmap (2026-10-18)

The decisions, the 0.4.0 backlog (kill switch per portal, side panel, first-run screen, lazy results
line, compute in the browser, drop the shared price history) and the plan for money and the company
are in `2026-10-18-extension-legal-strategy.md`.

The research behind them is in `docs/growth-2026-10/research/`:
- `09-extension-competitors.md`;
- `10-extension-legal-risk.md`;
- `11-portal-links-and-zones.md`.
