# Public-mode dry run (2026-10-27)

A local rehearsal of RELEASE-CHECKLIST "Going public": the API and web run with `CLOSE_KNIT_ACCESS=public`,
`CLOSE_KNIT_PUBLIC_URL=https://getcloseknit.com` and no other `CLOSE_KNIT_*` variable, so every FLAGS.md flag is off.

## Setup

- Database: the local Docker PostGIS (`postgres@127.0.0.1:5434/area_explorer`, release `rel-202610221501-layers-v5`).
- API: `uvicorn area_api.app:app --port 8380`; web: `npm run dev` with `PORT=4380`, `CLOSE_KNIT_API_URL=http://127.0.0.1:8380`,
  `NEXT_PUBLIC_AE_DEFAULT_MODE=real`. Other ports (8080, 4180) untouched.
- Checks: curl for the checklist items; a Playwright sweep (Chromium, 1366×900 and 375×812) over 26 routes for console
  errors, 4xx/5xx API calls, `null`/`undefined`/`NaN` text, empty sections and horizontal overflow; text dumps of the
  property, postcode, homes, compare, school, sector and area pages; Find my area and its example search; the extension
  card, badges and config APIs; an MCP session.

## Going public items checked locally

| Item | Result |
|---|---|
| `/robots.txt` disallows `/api/` and `/mcp`, names `Sitemap: https://getcloseknit.com/sitemap-index.xml` | pass |
| `/sitemap-index.xml` 200, lists `sitemap.xml`, `area/sitemap/sectors.xml` and 1,129 postcode shards | pass (sector shard fixed, below) |
| `/` and `/area/borough/E09000009` have no robots meta | pass |
| `/brief`, `/civic?area=…`, `/compare` `noindex, follow` | pass |
| `/save-listing` `noindex, follow` | **was `noindex` only**; fixed |
| 404 says "Page not found" (and status 404) | pass |
| `/claude` → 308 `/agents`; shows `claude mcp add --transport http close-knit https://getcloseknit.com/mcp`; no localhost/127.0.0.1 | pass |
| `/downloads/find-a-home.zip` | pass (200, application/zip, 9.6 kB) |
| `/agents` shows `/plugin marketplace add bmsdave/close-knit` and `/plugin install close-knit@close-knit` | pass (repo visibility not checkable locally) |
| `/?mode=demo` stays on real data | data stays real (only `mode=real` value packs requested), **but the map showed "Conflicting data request (mode demo, release missing); reset to demo defaults."**; fixed |
| `/privacy/legitimate-interests` opens | pass |
| `/llms.txt` advertises `https://getcloseknit.com/mcp` and `/.well-known/mcp` | pass |
| EPC per home off: postcode homes `floorAreaSquareMetres`/`energyRating` null; homes page says "Floor area and energy rating: Not shown per home yet" | pass |
| `/mcp` tools answer `tool-coming-soon.v1` (`CLOSE_KNIT_MCP_DATA` off) | pass, as designed |
| Extension: `/api/v1/extension-config`, `listing-card` (buy and rent), `listing-badges` | pass, 200, no nulls in blocks |

## Fixed in this PR

1. **England's postcode sectors were public with `CLOSE_KNIT_ENGLAND` off.** `/api/v1/sectors`, `/api/v1/sectors/{slug}`
   and so `/sector/AL10-0` (Hatfield) and the sectors sitemap (8,950 sectors, England-wide) ignored the flag, though
   FLAGS.md says off is "exactly the London behaviour". The sector queries now take the served scope
   (`zones_sector.scoped`, `scope.current().sql_filter`): off, 1,280 London sectors, Hatfield 404s and neighbours
   outside London (e.g. WD6 next to EN5) are not linked; on, unchanged. Tests: `api/tests/test_zones_sector.py`
   `SectorScopeTests`.
2. **The map legend offered "England" ranks on a London-only map.** With the flag off the API withholds
   `countryPercentile`, so "England" recoloured by London's own ranks while the legend said "Lowest in England" (and a
   `?scope=england` link did the same). A London coverage now offers In view · London only and reads a saved
   `england` scope as the region's (`servedScopes`/`servedScope` in `web/src/lib/legend-range.ts`, used by
   `legend-range.tsx` and the caption in `close-knit.tsx`). Tests: `web/tests/legend-range.test.ts`.
3. **`/?mode=demo` told visitors it had "reset to demo defaults"** while staying on real data: the notice ignored
   that a real deployment drops `mode`/`release` without `?dev=1`. Now only `?dev=1` (or a demo deployment) sees it
   (`urlModeNotice` in `web/src/lib/map-state.ts`). Tests: `web/tests/real-demo-separation.test.ts`; the e2e in
   `data-trust.spec.ts` keeps `?dev=1`.
4. **`/save-listing` was `noindex` without `follow`**, unlike the checklist's `noindex, follow`. Tests:
   `web/tests/seo.test.ts` (all four unlisted tool pages).

## Left, with why

- **`/property/<uprn>` shows "This home didn't load" locally**: the profile endpoint 500s with
  `relation "area_price_year" does not exist`. The local database lacks migration 040's table; prod has it. Not a code
  bug; the page's fallback works. Property pages could not be reviewed in public mode locally.
- **Area tiles 503 (statement timeout) on first load** at z11, then 200 in ~1 s: the local Docker database was shared
  with another API on :8080 and cold. Prod serves static PMTiles. Not reproduced warm.
- **Compare by place: two LSOAs both named "Clapham Old Town"** (E01003039, E01003042) are indistinguishable in the
  table. Naming, not public mode; worth a design note (board first).
- **Addresses read "…, London, London, SW4 0AA"** in `/api/v1/postcodes/{pc}/homes` `displayAddress` (town and county
  both London in the address table). Data/ETL, not public mode; the web homes list shows a shorter form.
- **`/agents` and the welcome card invite people to add the MCP, whose tools answer "coming soon"** while
  `CLOSE_KNIT_MCP_DATA` is off. Owner decision (FLAGS.md), not changed.
- **Basemap warnings** (`highway-shield-*` filter null, maplibre worker preload) are the OpenFreeMap style and
  Next dev; no console errors from our code on any route.

## Not checkable locally

- Caddy `X-Robots-Tag` and basic-auth removal (`access-public.caddy`), TLS, `deploy/preflight.sh` notification
  channels, `deploy/.env` contents, the public plugin marketplace repository, `/mcp` through Caddy.
- `npm run build` + Playwright e2e (gate full); only `./gate.sh --fast` ran.
- Safari/WebKit and real phones.
