# Legitimate interests assessment (LIA) — per-home property data

Published at `/privacy/legitimate-interests` (`web/src/app/privacy/legitimate-interests/page.tsx`);
keep the two in step.

Controller: ______________________ Ltd (company no. __________), trading as Close Knit
Registered office: ______________________
Contact: hello@getcloseknit.com · ICO registration: __________ (`docs/legal/owner-pack/ico-steps.md`)
Assessed by: _____________________ (director)  Signature: __________  Date: __________
Review: every data release, when a per-home field is added, and at least every 12 months
Scope: per-home data is London only; outside London (`CLOSE_KNIT_ENGLAND`) only area figures are served

Processing assessed: publishing, per dwelling in London, the recorded sale
history (HM Land Registry Price Paid), floor area (from the EPC used for
matching), the building facts of the latest EPC (energy rating, certificate
date, property type, built form, age band, habitable rooms, floor level), the
price range of same-type sales in its area with the coarse position of its
last recorded sale (section 4), and the freehold parcel/coordinate of the
dwelling, on a public website, its API, its MCP endpoint and the browser
extension. Since 2026-10-11 no per-home restated value ("stock value",
"Estimated price") is published.

What is switched off when the site is public (FLAGS.md), until counsel clears it:
per-home EPC facts and per-sale £/m² (`CLOSE_KNIT_EPC_PER_HOME`,
`CLOSE_KNIT_PER_HOME_PRICE_PER_SQM`), homes addressed from EPC certificates
(`CLOSE_KNIT_EPC_ADDRESSES`), matching a portal listing to an address and its
value range (`CLOSE_KNIT_ADDRESS_MATCH`, `CLOSE_KNIT_HOME_VALUE`), and any
per-home valuation (`CLOSE_KNIT_PER_HOME_VALUATION`). This assessment covers
them so they can be switched on after review without a new LIA.

## 1. Purpose test — is there a legitimate interest?

- Interest: make already-public property records understandable and
  comparable (price per m², area price ranges, with evidence) for
  people moving home, renters, researchers, journalists and software agents,
  with every figure traceable to its source release.
- The sale price and address are already published by HM Land Registry under
  the OGL precisely so they can be reused; the added value is the
  floor-area match and area statistics, not new personal data. We never
  state what a single home is worth.
- Benefits: informed buying decisions, transparency of the housing market,
  reproducible evidence (every number cites a release and caveat).
- The processing is lawful and ethical (no scraping of private sources, no
  inference about individuals, no profiling).

## 2. Necessity test — is the processing necessary?

- Showing a sale without its address would make it unusable for the purpose
  (comparables are address-specific); aggregation alone (LSOA medians) is
  provided too but does not replace per-home evidence.
- Data minimisation applied: only address, sale date/price, floor area,
  derived £/m² and value, confidence, parcel id and OS coordinate are served
  (`api/tests/test_minimisation.py`); the property page adds only the
  building facts of the latest EPC listed above. EPC tenure (it describes the
  occupant), names, running costs, recommendations and certificate addresses
  are discarded at load time. No names or occupier data are held.
- Retention: a release is immutable and replaced; older releases are not
  served. "Hide my home" requests never confirmed by e-mail are deleted after
  30 days (on each new request, and by `python -m area_api.objections purge`);
  confirmed ones are kept for as long as the home is hidden. Container logs are
  capped by size (`deploy/docker-compose.yml`, `x-logging`) and Caddy access
  logs roll off after 30 days.

## 3. Balancing test — do the individual's interests override?

Nature of the data: not special-category; it concerns a transaction, not a
person's private life, and it is already public. However, a price attached to
an address can reveal a household's wealth and is findable by name via other
public sources.

Reasonable expectations: sellers and buyers are told by HM Land Registry that
Price Paid Data is published; property portals and comparable sites publish the
same data. People would not expect the data to be combined with non-public
sources (we do not), or to be unable to object (they can).

Likely impact: low. No figure states what a home is worth: a home shows its
recorded sales and its area's prices, and its last sale only as one of six
coarse bands. No decisions are made about individuals.

Safeguards:
- Privacy notice at `/privacy`, linked from every page footer and next to
  the figures ("Public-record data … Wrong, or your home?").
- Objection channel with real effect: `POST /api/v1/corrections`
  `kind=privacy-objection`, confirmed by an e-mailed link (double opt-in);
  the dwelling is removed from search, history, property reads, agent tools
  and tiles as soon as the link is opened, and within 30 days in every case.
  Requests store only salted hashes of the e-mail and IP.
- Corrections channel for wrong data, persisted and forwarded to the operator.
- Rate limiting and no bulk address export; per-home data is served one
  dwelling at a time or as map tiles without EPC content.
- No advertising cookies and no third-party analytics. Search details reach
  analytics only with opt-in; site usage is counted first-party under a random
  id not linked to a person or home, can be switched off on `/privacy`, and is
  kept 180 days (`docs/product-analytics.md`).

Conclusion: the legitimate interest is not overridden, provided the safeguards
above stay in place. Lawful basis: Article 6(1)(f) UK GDPR.

## 4. Area price ranges and the coarse position of a public sale (2026-10-11)

Internal assessment by the operator, not legal advice.

**What changes.** The property page, `GET /api/v1/properties/{uprn}/profile`
and the `get_home_prices` agent tool replace the per-home "Estimated price"
(the last sale restated by the area index: in effect an automated valuation of
an identifiable home) with:

- area statistics: the 10th–90th percentiles of standard (category A) sales of
  the home's Price Paid type in its LSOA, else MSOA, else borough, since
  1 January three years back, each adjusted to the latest month by the area's
  price index and rounded to £5,000 (`area_price_band`, migration 040);
- the coarse position of the home's last recorded standard sale among
  same-type sales in the same area that year: one of six bands (bottom 10%,
  bottom quarter, lower middle, upper middle, top quarter, top 10%), never a
  percentile (`area_price_year`), and today's prices of that band in the area.

**Purpose and necessity.** Buyers and renters need to know what homes like
this one sell for nearby; a range for the area answers that without stating a
value for anyone's home. The position adds context to a sale price that is
already public. It is derived only from Price Paid prices by type, never from
the per-home EPC floor area, so it adds no new fact about the home.

**Balancing.** An owner may reasonably not expect a site to state what their
home is worth; that figure is no longer published. A coarse band of a public
sale reveals little beyond the public price. Safeguards:

- **Minimum sample.** No range from fewer than 5 same-type sales, no position
  from fewer than 5 sales in that year's area set; otherwise only the recorded
  sales and "Not enough sales of this type nearby to show a range". The map
  layer "Typical price today" follows the same rule per area.
- **Coarse output only.** Six bands; amounts rounded to £5,000; the top and
  bottom bands are open-ended, so no single sale's adjusted price is shown.
- **Hide my home.** A home hidden through "Report or hide this home" has no
  profile (404 on the page, API and agent tool), so its position disappears
  with everything else; its sale still counts anonymously in area statistics.
- **Wording.** No surface says "worth", "estimate" or "valuation" of a home
  (`api/tests/test_property_profile.py` and `web/tests/property-profile.test.ts`
  guard this); the card says it is about the area's sales, not a valuation of
  this home.

Residual risk: low. **A review by a UK solicitor is recommended before the
site goes public**, in particular of the coarse-position wording and of the
open question about per-sale floor area and £/m² (ROADMAP-research-driven-features.md).

## Actions

- [ ] Fill in controller, company number, registered office, assessor, date; sign.
- [ ] Register with the ICO and record the number (`docs/legal/ico-registration.md`).
- [ ] UK solicitor review of section 4 (area ranges and coarse positions) before going public.
- [ ] Re-run this assessment when a new per-home field is added
      (`api/tests/test_minimisation.py` will fail first).
