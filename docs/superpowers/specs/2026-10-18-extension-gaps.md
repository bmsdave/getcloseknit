# Extension gaps: match every competitor feature (frozen contract)

Research 2026-10-18 (16 extensions; canvas board "CUJ-17 research: 5 ways + everything") left these gaps.
All additions are additive to listing-card.v1: old extensions skip unknown blocks, old requests stay valid.

## Slices (one PR each, separate files)

| Slice | Owns | Delivers |
|---|---|---|
| A. Listing facts v2 | `extension/src/adapters/*` (not `results/`), `extension/src/memory.ts`, `extension/tests/adapters.test.ts` + fixtures | Reads the new request fields below on all 5 portals; local first-seen / observed price memory |
| B. Card blocks | `api/area_api/listing_card.py`, `api/area_api/listing_costs.py`, `extension/src/render/*`, `api/tests/test_listing_card.py`, `extension/tests/card.test.ts` | `pricePosition`, `priceStory`, `costs`, `flags`, `sections` blocks and their rendering |
| C. Results pages | `extension/src/adapters/results/*`, `extension/src/content/results.ts`, `api/area_api/listing_badges.py`, route in `app.py`, manifest matches | Badge line under every search result (canvas variant K) |
| D. Flagged home data | `api/area_api/home_match.py`, routes in `app.py` | Full address and value range behind flags, default off. The shared asking-price history was removed in 0.4.0 (owner decision 2026-10-18, migration 070 drops its table) |

Shared contract files (`types.ts`, `ListingCardRequest`, `feature_flags.py`, `contracts/openapi.yaml`) are frozen in
this commit; a slice that needs a change asks the orchestrator.

## Request: new optional fields (`ListingCardRequest`, `ListingFacts`)

- `propertyType`: flat | terraced | semi-detached | detached | bungalow | other | unknown (default unknown)
- `councilTaxBand`: A–I or null, as the listing states it
- `serviceChargeYearly`, `groundRentYearly`: £ a year or null; `leaseYearsRemaining`: years or null
- `epcRating`: A–G or null, as the listing shows it (the page's own figure; no EPC lookup)
- `listedOn`: YYYY-MM-DD or null, when the page says the listing was added
- `priceChanges`: up to 20 `{date, price}` the page itself shows (e.g. "Reduced on"), oldest first
- `firstSeen`: `{date, price}` or null, from the extension's own memory on this device
- `buyer`: `{depositPct, ratePct, years, firstTime, additionalHome}` or null, the user's own assumptions kept on the device

## Response: new blocks

- `pricePosition` `{homeType, bucket: 0-3|null, label, sales, q1, median, q3, perSqm?: {asking, area, band}}`
  Buckets: 0 below the middle half, 1 lower half, 2 upper half, 3 above. Needs >= 5 same-type sales in 12 months,
  otherwise the block is omitted. `band`: "in-line" (±10%), "10-25-above", "over-25-above", "10-25-below", "over-25-below".
- `priceStory` `{listedOn?, daysOnMarket?, changes: [{date, price}], firstSeen?, areaTurnoverPct?, text}`
- `costs` `{monthly, parts: [{label, amount}], upfront: [{label, amount}], assumptions, chips: [text], councilTaxByBand}`
  `councilTaxByBand` (0.4.0): `{"A": £/month, … "H": …}` for the area's borough (civic; bands without an amount are
  left out), so the extension can price the band it reads locally without sending it.
- `flags` `{items: [{text, tone}]}`: things the listing does not say (flood, lease < 80 years, conservation, ULEZ)
- `sections` `{columns: [{title, rows: [{label, value, tone?}]}]}`: the "everything" panel (canvas variant P)
- `home` (only when a flag is on) `{address?, confidence, epc?, sales?: [{date, price}], value?: {low, high, method}}`

## Batch: `POST /api/v1/listing-badges`

Request `{v: 1, portal, items: [<ListingFacts subset: listingId, url, lat, lng, postcode, market, askingPrice,
bedrooms, propertyType>] (max 30), profile?}`. Response `{items: [{listingId, score|null, band: 1-5|null,
excluded, bucket|null, flag?: text}]}`. Cached by area; rate-limited like listing-card.

## Flags (`api/area_api/feature_flags.py`), all default off

- `CLOSE_KNIT_ADDRESS_MATCH=1`: match a listing to a full address (postcode + type + floor area + EPC rating)
- `CLOSE_KNIT_HOME_VALUE=1`: a value range for the matched home (needs ADDRESS_MATCH)
- ~~`CLOSE_KNIT_LISTING_HISTORY`~~: removed in 0.4.0 with `listing_history.py`; we never store portal listings or
  their prices (legal strategy §1). `deploy/migrations/070-drop-listing-price-observation.sql` drops table 068.

Do not enable either on production before the privacy / legal review (see memory: no per-home valuation).

## Kill switch: `GET /api/v1/extension-config` (0.4.0)

`{v: 1, portals: {rightmove|zoopla|onthemarket|spareroom|openrent: {mode: inline|side-panel|off}}, notice}`.
Defaults: inline everywhere except SpareRoom (side-panel). `CLOSE_KNIT_EXTENSION_MODES` (JSON portal -> mode) overrides
them without a release; unknown keys or values are ignored and logged. `Cache-Control: public, max-age=300`; open in
private mode (`deploy/access-private.caddy`). Code: `api/area_api/extension_config.py`, web proxy
`web/src/app/api/v1/extension-config/route.ts`.

## Never

Photos, descriptions, agent details, or anything about the user is never sent. The full address and value range never
appear unless their flag is on. Copy never says "worth", "fair price" or "overpaying by £".
