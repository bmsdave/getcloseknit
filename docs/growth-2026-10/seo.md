# SEO: audit, fixes and the keyword-to-page map (October 2026)

Audited on the live getcloseknit.com on 28 October 2026, the day after it went public, with real fetches as
Googlebot (curl and Python scripts; no browser). Google had indexed no pages yet. Search Console is verified
(HTML file) and the sitemap index is submitted; its first status was "Couldn't fetch".

## What the audit found

| # | Finding | Numbers | Fixed in PR |
|---|---------|---------|-------------|
| 1 | **A fast crawl was rate-limited by a person's budget.** The web server forwards the viewer's address to the API, so Googlebot spent the per-person `render` (30/min) and `default` (120/min) budgets. | 6 parallel fetches: 53 of 60 MSOA pages came back 200 with "This area didn't load" and `noindex`. 12 parallel fetches of the 1,140 sitemaps: 1,029 were 404 and 37 were 200 with no URLs. | Yes: Google's and Bing's published ranges get a `crawler` class (1,200/min, 30,000/h, 300,000/day); people and other bots keep their limits (`api/area_api/crawler_ranges.py`). |
| 2 | **Error pages served as 200 + noindex.** A crawler that hit the limit would index the error or drop the page. | 6 page types (area, places, school, home, homes list, street home) plus borough, pack and sector. | Yes: crawlers (by user agent) get a 500, which they retry and which slows their crawl. People keep the Try again page. |
| 3 | **Real pages 404 when the API refused.** | The postcode page 404'd on any 429 (nothing found means not found); the sector page treated 429 as 4xx and 404'd. | Yes: "try again" (500 for crawlers), never 404. |
| 4 | **Sitemaps were fragile.** A failed read became a 404 shard, an empty shard or a smaller `sitemap.xml`. | `sitemap.xml` had 16,117 URLs on one fetch and 36,193 on the next: the 2.8 MB school index timed out at 2.5 s, which dropped 20,076 schools. Each of the 1,130 postcode shards re-read the sector list. | Yes: long timeouts, the sector list held for 10 minutes, and a failed read is a 500 (retried), never a partial sitemap. |
| 5 | **No lastmod** in any sitemap. | 0 of ~290,000 URLs. | Yes: data pages carry the release day (`rel-202610280650…` → 2026-10-28); fixed pages carry none. |
| 6 | **Council school lists were missing from the sitemap**, though self-canonical and linked. | 153 `/schools?borough=` pages ("schools in Lambeth"). | Yes: added. |
| 7 | **Titles and descriptions too long** or without the search words. | Titles: home 71, LAD 69, MSOA 74, school 81 characters. Descriptions: home 195, London 188, rankings 216, school 190. LSOA titles were the name only ("City of London · EC1A"). Pack titles used codes ("LSOA E01000001") and ~16,000 pack pages shared one description. | Yes: see the map below. The site name follows only when it fits in 60 characters; every description is cut to 155 at a sentence. |
| 8 | **Canonical missing.** | /about, /bot, /feedback, /privacy/legitimate-interests. | Yes. |
| 9 | **Structured data gaps.** | No BreadcrumbList on any page; LADs typed Place; the postcode JSON-LD of W5 1AA published `geo` 0,0. | Yes: BreadcrumbList that mirrors the visible crumbs (area, borough, places, pack, postcode, home, school, rankings, schools); LAD typed AdministrativeArea; no point outside the UK. |
| 10 | **Crawl traps.** | Every area page links 7–17 map states (`/?selected=…&layer=…&release=…`), all canonical to `/`; school pages link 6 `/go/` click-outs each. | Yes: robots.txt `Disallow: /?` and `Disallow: /go/` (public site only). |
| 11 | **Home page has 4 crawlable links** (/, /agents, /privacy, /terms) in its server HTML. Areas are reachable only through the sitemap. A LAD page links 10 of its 35 MSOAs. | Depth from home: unreachable without the sitemap. | No: visible. Board item B4. |
| 12 | **Slow or heavy pages.** | Home page: 0.48 s to first byte. LAD: 0.48 s. MSOA: 1.09 s. LSOA: 0.94 s. Postcode: 0.72 s. Home page (`/property/…`): 3.5 s to first byte, 6 s total, 881 KB of HTML. HTML size: /about 1.6 MB, /guide/crime 1.4 MB, /agents 1.4 MB. Main text is in the server HTML on every page type (600–5,000 words). | No: performance work, not in scope. |

Checked and fine: robots.txt allows `/` and keeps out `/api/` and `/mcp`. Each sitemap is under 50,000 URLs (largest:
South East, 17,896; 1.3 MB). Every URL is absolute https. The index lists 1,140 files. Unknown areas, postcodes,
schools, homes and sectors are real 404s with noindex. A trailing slash, another case, `/area/borough/…`, `www.` and
`http://` all redirect (301/308) to the canonical. Query strings keep the clean canonical. `lang="en-GB"` is set,
there is one H1 per page, and Open Graph and Twitter cards are on every page type. The FAQPage on the LAD and London
pages matches Q&A that is visible on the page. hreflang is not needed.

## Indexability by page type

| Page type | Example | Index | Why |
|-----------|---------|-------|-----|
| Home | `/` | index | Entry point; map states (`/?…`) are blocked in robots.txt and canonical to `/`. |
| Region and London | `/area/london`, `/area/england` | index | Borough and region comparison. |
| Local authority, MSOA, LSOA | `/area/lad/E09000022`, `/area/msoa/…`, `/area/lsoa/…` | index | The core answer pages. |
| Places and pack (LSOA) | `/area/lsoa/…/places`, `/pack` | index | Own content (places list; cited pack). MSOA/LAD packs exist and are indexable, not in the sitemap. |
| Postcode sector | `/sector/W5-1` | index | £/m² and the price index. |
| Postcode, homes list | `/postcode/W5-1AA`, `/homes` | index | Sold prices; a hidden home 404s. |
| Home | `/property/{uprn}` | index | Per-home record; hidden homes 404. |
| Street-level home | `/property/at/…` | index, not in sitemap | Found, never listed. |
| School | `/school/{urn}` | index if any result or inspection, else noindex, follow | Thin otherwise. |
| Schools hub and council lists | `/schools`, `/schools?borough=lambeth` | index | Self-canonical per council. |
| Rankings | `/rankings`, `/rankings/{slug}` | index | "best areas" queries. |
| Guide, glossary, tools | `/guide/…`, `/tools/…` | index | Explainers and calculators. |
| Agents, changelog, about, legal | `/agents/…`, `/changelog/…`, `/about`, `/privacy`, `/terms` | index | Brand and trust pages. |
| Brief, compare, save listing, civic | `/brief`, `/compare`, `/save-listing`, `/civic` | noindex, follow | Personal or empty without input. |
| Click-outs | `/go/…` | blocked (robots.txt) | Redirects off the site. |
| API, MCP | `/api/`, `/mcp` | blocked | Data, not pages. |
| Error state | any page whose evidence did not load | 500 for crawlers; 200 + noindex for people | Retried later; never indexed as an error. |

## Keyword-to-page map

Titles shown as rendered (the site name follows only when it fits in 60 characters).

| Query family | Page type | Title / H1 before | Title / meta now | Gap left |
|---|---|---|---|---|
| "is Lambeth a nice place to live", "living in Lambeth" | LAD | "Lambeth · London: prices, crime, schools and deprivation · Close Knit" (69) / H1 "Lambeth" | "Lambeth, London: house prices, crime and schools" · "Lambeth, London: is it a good place to live? See house prices, crime, schools, deprivation and income, and every area inside it." | No visible sentence answers "is it a good place to live" (board B1). The FAQ answers safety, cost, schools and deprivation. |
| "Clapham South nice place to live", "Brixton crime rate" | MSOA / LSOA | "Clapham South · SW4: prices, crime…" (MSOA, 74) / "City of London · EC1A · Close Knit" (LSOA) | "<area>: house prices, crime and schools" · "<area>: is it a good place to live? Typical price £X/m². See house prices, crime, schools, transport and green space." | Neighbourhood names are friendly names, not always the name people search for (Brixton, Peckham). Board B1/B5. |
| "<area> crime rate" | LAD / MSOA / LSOA | as above | "crime" in every area title and meta | No crime-specific page or section anchor. The FAQ "Is Lambeth safe?" is on LAD only. |
| "<area> house prices" | LAD / MSOA / LSOA / sector | Sector: "W5 1 · Pitshanger: £/m², price index and streets" (61) | Sector: "W5 1 · Pitshanger: house prices per m² and streets" | Fine. |
| "<postcode> house prices", "sold prices <postcode>" | Postcode | "W5 1AA · Hanger Hill East · Close Knit" / H1 "W5 1AA" | "W5 1AA house prices, Hanger Hill East · Close Knit" · "W5 1AA, Hanger Hill East: sold house prices and the homes here, with flood risk, crime, schools and stations nearby. Achieved prices, not valuations." | H1 is the postcode only (board B2). |
| "flood risk <postcode>" | Postcode (Living here: rivers and sea, surface water) | as above | "flood risk" in the meta | No flood wording in the title (it would crowd "house prices"); the figure sits mid-page. Board B6. |
| "schools near <area>", "schools in Lambeth" | Council list, school, LAD | "Schools in Lambeth · Close Knit"; not in the sitemap | "Schools in Lambeth: Ofsted and results · Close Knit"; 153 lists in the sitemap | No "schools near <neighbourhood>" page: LSOA pages list nearby schools in a section. |
| "<school name> ofsted", "<school> results" | School | "The Aldgate School – Ofsted Outstanding (2024) · KS2 results 2024/25 · Close Knit" (81) | "The Aldgate School – Ofsted Outstanding · KS2 results" (years drop first when long) | Fine. |
| "best areas to live in London for families" | Rankings | "London area rankings · Close Knit" | "London area rankings: best areas to live · Close Knit" | No "for families" ranking: "most places for families" counts places, not a family score. Board B3. |
| "cheapest areas in London with good transport" | Rankings | single-lens rankings | unchanged | No combined ranking; My match does it but is not a page. Board B3. |
| "London boroughs compared", "best London borough" | London | "London boroughs side by side: prices, crime, schools · Close Knit" (65) / H1 "London" | "London boroughs compared: house prices, crime, schools" | Fine. |
| "<area> vs <area>" | Compare (noindex) | "Compare · Close Knit" | unchanged (noindex, follow) | No indexable pair pages. Board B7. |
| brand, "London house prices map" | Home | "Close Knit: what homes really sold for, and which areas fit your budget" (71) | "Close Knit: what homes sold for, areas that fit your budget" (59) | H1 is the value line; fine for a brand page. |

## Proposals that change what people see (need a design board first)

- **B1. An answer line per area**: one sentence under the H1 on LAD, MSOA and LSOA pages: "Is <area> a good place to live? Safer than 73% of London, homes £4,800/m², 17 schools within 1.5 km." Built from the verdict and tiles the page already has.
- **B2. H1 wording**: "W5 1AA house prices" on the postcode page; "Living in Lambeth" or "Lambeth, London" on LAD pages; the name stays the main text.
- **B3. Ranking pages for real queries**: "Best areas in London for families" (schools, safety, parks) and "Cheapest areas in London with good transport" (price and station walk), as fixed My match presets with their method shown.
- **B4. Internal links**: on the home page, a crawlable footer or section linking London, England, the 33 boroughs, Rankings and Schools; on LAD pages, every MSOA as a link (now 10 of 35 before "Show all"); on MSOA pages, every LSOA.
- **B5. Common names**: an "also known as" line from the friendly-name data (Brixton, Peckham, Clapham), used in titles once it is shown on the page.
- **B6. FAQ block on MSOA, LSOA and postcode pages** ("Is it safe?", "How much do homes cost?", "Flood risk?"), the same honest form as the LAD FAQ, with FAQPage JSON-LD only where it is visible.
- **B7. "<area> vs <area>" pages**: indexable pair pages for neighbouring boroughs (about 80 pairs), built from the compare view.

## What needs the owner

- Search Console is verified with the HTML file (`web/public/google0d3186c4ed53a1ab.html`). Keep it, or move it to a
  meta token through an env var such as `CLOSE_KNIT_GOOGLE_SITE_VERIFICATION`. Bing Webmaster still needs setting up
  (it can import from Search Console).
- Resubmit `sitemap-index.xml` after this ship. The earlier "Couldn't fetch" fits finding 1.
- Crawler ranges change. Refresh `api/area_api/crawler_ranges.py` from Google's and Bing's JSON every few months.
- Decide whether to fix the heavy HTML (/about 1.6 MB, a home page 881 KB and 3.5 s to first byte) before Google
  starts crawling homes at scale.
