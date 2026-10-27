# Close Knit browser extension

Shows a home's area (England; London in depth) beside its listing on Rightmove, Zoopla, OnTheMarket, SpareRoom and
OpenRent. SpareRoom gives only an approximate point, so its card says so.
Design: [docs/superpowers/specs/2026-10-14-portal-extension-design.md](../docs/superpowers/specs/2026-10-14-portal-extension-design.md).
Legal posture and the 0.4.0 backlog: [2026-10-18-extension-legal-strategy.md](../docs/superpowers/specs/2026-10-18-extension-legal-strategy.md).

## How 0.4.0 decides what to show

- **First run (options page):** per site, "Panel beside the page" or "On the page" (beside by default, OpenRent on
  the page); "Send the open listing's coordinates and price" (on; off means nothing is shown); anonymous
  area-demand statistics (off, stored only); usage analytics (on; off adds `x-close-knit-analytics: off` to requests);
  mortgage assumptions. Kept in `chrome.storage.sync` (local as a fallback). The popup's "Settings" opens it.
- **Mode per site:** `GET /api/v1/extension-config` (cached 5 min) is the kill switch. Server `off` → nothing;
  `side-panel` → the side panel even if the user chose the page; `inline` → the user's choice. Unreachable server:
  on the page everywhere except SpareRoom (side panel). Safari has no side panel, so it gets the floating side card.
- **Side panel (Chrome):** the content script hands the listing to the background; the panel draws the card for the
  active tab. On the page there is only a small "Close Knit ›" pill that opens it.
- **Results line and map popup line (0.4.3):** both show wherever the site's mode is not `off`, whatever the user
  chose for listing pages, behind the config's `features.resultsLine` / `features.mapPopup` (on by default and when
  the server is unreachable; `CLOSE_KNIT_EXTENSION_FEATURES` switches them). The map popup line (Rightmove map.html,
  Zoopla `/map/`, OnTheMarket `?view=map-list`) goes inside the card a pin opens: compact, rows 1-2. The listing comes
  from the card's link; its facts from the page's data (Rightmove geoJson pins, OnTheMarket `maps.list` points, the
  results), else from the listing's own page fetched in the browser. Same badges request and cache as the results line.
- **Send the minimum:** a card request carries portal, listingId, url, lat, lng, postcode, market, askingPrice,
  bedrooms, propertyType and floorAreaSqm; a results request the same minus floorAreaSqm. Costs (mortgage, stamp
  duty, council tax from the server's `councilTaxByBand`, service charge, ground rent), the price story, the lease
  flag and EPC are worked out in the browser and merged into the card (`src/local.ts`).
- **Lazy results line:** a result is fetched once its card comes into view; cards that appear together go in one
  request of at most 30. Results stay cached for an hour.
- No links to the portals inside the extension; every panel says Close Knit is not affiliated with the site.

## Build and try

```bash
cd extension && npm ci
npm run build:dev     # dist/ talks to http://127.0.0.1:4190 (CLOSE_KNIT_EXTENSION_SITE to change)
npm run build         # dist/ talks to https://getcloseknit.com
npm test && npm run typecheck
```

The local stack:
- API with real data: `CLOSE_KNIT_DATABASE_URL=… CLOSE_KNIT_SITE_URL=http://127.0.0.1:4190 uvicorn area_api.app:app --port 8091`
- Web: `CLOSE_KNIT_API_URL=http://127.0.0.1:8091 PORT=4190 npm run dev`

**Chrome, Edge, Brave or Arc:** open `chrome://extensions`, turn on Developer mode, choose
**Load unpacked** and pick `extension/dist`. After each rebuild, press the reload icon on its card.

**Safari (macOS and iOS):** open `safari/Close Knit/Close Knit.xcodeproj`. It uses `dist/` as it
is, so build first. Run the macOS or iOS scheme, then turn the extension on in Safari's settings,
under Extensions. Signing for the App Store needs the team's Apple developer account.

## Layout

- `src/adapters/`: one per portal. Each reads the page's data scripts (OpenRent: its `#map` element
  and title) into `ListingFacts`, or returns null. The tests use synthetic pages in each portal's format; no real listings are stored.
- `src/background.ts`: resolves each site's mode, calls `POST /api/v1/listing-card` (cards cached for an hour),
  adds the local facts, keeps each tab's listing for the side panel, and keeps the saved search.
- `src/settings.ts`, `src/mode.ts`, `src/local.ts`: settings, mode resolution and server config, local computations.
- `src/content/portal.ts`: finds the listing and draws the card (`src/render/`) in a shadow root, or the side panel pill.
- `src/content/results.ts`, `src/content/lazy.ts`: the results line, fetched for cards in view.
- `src/sidepanel/`: Chrome's side panel page. `src/options/`: the first-run screen and Settings.
- `src/content/closeknit.ts`: on the Close Knit site, offers "Use it" for the saved search.
- `src/popup/`: the on/off switch, Settings, "Open panel", the saved search, and what is sent.
- `icons/icon.svg` is a copy of `web/public/icon.svg`. To redraw the PNGs, run `node scripts/icons.mjs`.
