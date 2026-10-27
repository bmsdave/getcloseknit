# London estate agents by neighbourhood: directory, homes on offer, ratings

Date: 2026-10-12 (v2). Branch: `claude/london-agencies-by-zone-67d274`.

## Goal

For each London neighbourhood, show which estate agents work there, whether they have homes on
offer in its postcodes and how many, links to those homes on the agents' own sites, and the agents'
Google rating with a sort by it. Available on the area page and through the MCP server.

Built in four steps, data first, each its own PR:

1. Directory data (offices from the maps and Companies House, verified websites, opt-outs, Google place ids).
2. Crawler (facts and links of homes on agents' own sites, counts per postcode).
3. API and MCP.
4. Website.

Success: an area page and `get_area_agents` list the agent offices in and around the neighbourhood;
for each, how many homes it offers for sale and to rent in the area's postcodes (when its site can
be read), links to those homes, and a Google rating on request; an agency can be corrected or
removed and stays removed.

## Decisions already made

- "Zone" = our neighbourhoods (the areas behind area pages), not TfL fare zones.
- Homes come from agents' own websites only: facts and a link, never photos or descriptions.
  Portals (Rightmove, Zoopla, OnTheMarket) are linked, never read.
- Ratings: Google rating via the official Places API, fetched live when the user asks, never
  stored; sort by it within one area page only. Trustpilot and redress schemes are links only.
- No agency map layer; no ratings of our own; no user reviews.
- This replaces the rule in `agents/claude/plugin/skills/find-a-home/references/listings.md` that
  "Close Knit never fetches, stores or ranks listings" with the crawler rules below.

## Evidence from the spike (2026-10-12, throwaway, not in the repo)

OpenStreetMap: 2,864 estate agent offices in the London bounding box, 1,053 with a website (666
domains); twelve chains hold about 230 of them (Hamptons 45, Bairstow Eves 35, Dexters 22,
Winkworth 19, KFH 19, John D Wood 16, Savills 15, Knight Frank 14, Your Move 13, Foxtons 13,
Marsh & Parsons 11, Chestertons 10). Of 100 sampled domains: robots.txt blocked listing pages on
none; 12 answered 403 to a polite client; about 15 were dead; 65 homepages loaded, 61 linking to
listings, 30 on a recognisable platform (Property Hive 10, Starberry 4, Acquaint 3, Expert Agent 3,
Street 3, Eurolink 3, others 1-2); 1 carried structured listing data. There is no open, complete
register of agencies, so the directory is "offices the map sources know about" and says so.

## Step 1: directory data

### Offices: the existing unified `place` table

`place` (migration 034) already conflates OSM, Overture and Foursquare and maps their estate agent
categories to `category = 'estate_agent'`. An office is a `place` row with that category: name,
brand (`tags->>'brand'`), sources, confidence, location and stable id (`osm:n123`, `ovt:<gers>`,
`fsq:<id>`) come from it. No separate office ingest. Caveat to state: Overture's
`real_estate_service` also holds some letting-only and property management offices.

### Websites

- OSM: `place_poi.tags->>'website'` (or `contact:website`) via `place.osm_id`.
- Overture: `overture_places.py` keeps the first website only for categories that map to
  `estate_agent`, in a new nullable `overture_place.website`; every other category still drops it.
- Foursquare websites stay dropped. OSM wins when both exist.
- Normalisation: lower-case host, `www.` dropped for the domain key; path, query, fragment removed
  for the domain; the homepage URL keeps its scheme.

### Companies House: firms the maps miss

Every estate agency must belong to a redress scheme, but those registers are not licensed for bulk
reuse; Companies House is (OGL, free monthly "Free Company Data Product" CSV). Module
`area_analytics/agency_companies.py`:

- Load active companies with SIC 68310 (real estate agencies) or 68320 (management of real estate:
  many letting agents) whose registered postcode is in London (`postcode_civic.region_code =
  'E12000007'`): number, name, status, SIC codes, registered postcode, incorporation date. Officers
  and people with significant control are not read. The registered address is often an
  accountant's, so it is never shown as an office.
- Website verification. UK companies must show their company number on their website (Company,
  LLP and Business (Names and Trading Disclosures) Regulations 2015). For each known domain (step 1
  websites) fetch the homepage and at most two more pages linked as contact, terms or privacy, and
  extract company numbers (8 digits or two letters + 6 digits next to "company", "registered" or
  "no."). A number found on the site ties domain and company: `agency_site_company`.
- Domain guessing for companies with no known domain: at most four candidates from the name
  (`<slug>.co.uk`, `<slug>.com`, `<slug>.london`, `<slug>estates.co.uk`, where slug drops "ltd",
  "limited", "estate agents", "lettings"); a candidate is kept only if its pages carry the
  company's number, so a guess never creates a false match.
- Offices the maps miss: a verified site whose contact page prints a London postcode becomes an
  office at that postcode (LSOA centroid, `location_precision = 'postcode'`, source `website`),
  unless an existing `place` office of the same domain is within 300 m.
- The same pages are read for the redress scheme the agency names (TPO, PRS) and stored as text
  found on its site, not as a verified membership.
- All fetching goes through the crawler's `fetch.py` (same user agent, robots.txt, back-off); it and
  the `/bot` page therefore ship in step 1.
- Later steps read offices from one view, `agency_office` (migration 051): `place` estate agents
  with their OSM-or-Overture website and domain, plus website offices (confidence 0.6), minus
  `everything` opt-outs. A website office is not created for a domain with three or more `place`
  offices: chains print their head office on contact pages.
- Coverage report after each load: London active companies, share with a verified site, share with
  an office location; companies with neither are counted, not shown.

### Migration 051

```sql
CREATE TABLE IF NOT EXISTS agency_company (
    company_number text PRIMARY KEY,  -- e.g. 01234567 or SC123456
    name text NOT NULL,
    sic_codes text[] NOT NULL,
    registered_postcode text,
    incorporated date,
    source_release_id text NOT NULL REFERENCES source_release(id)
);

CREATE TABLE IF NOT EXISTS agency_site_company (
    domain text NOT NULL,
    company_number text NOT NULL REFERENCES agency_company(company_number),
    page_url text NOT NULL,           -- where the number was found
    redress_scheme text,              -- 'TPO', 'PRS' or NULL, as named on the site
    office_postcode text,             -- London postcode printed on the contact page, if any
    verified_at timestamptz NOT NULL,
    PRIMARY KEY (domain, company_number)
);

CREATE TABLE IF NOT EXISTS agency_opt_out (
    id serial PRIMARY KEY,
    domain text,                      -- normalised website domain, e.g. foxtons.co.uk
    place_id text,                    -- one office, e.g. osm:n123
    scope text NOT NULL CHECK (scope IN ('listings', 'everything')),
    requested_at timestamptz NOT NULL DEFAULT now(),
    note text NOT NULL,               -- how the request was verified
    CHECK (domain IS NOT NULL OR place_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS agency_google_place (
    place_id text PRIMARY KEY,        -- our place.id
    google_place_id text,             -- NULL when no confident match was found
    matched_at timestamptz NOT NULL
);

ALTER TABLE overture_place ADD COLUMN IF NOT EXISTS website text;
```

- `agency_opt_out` is never rebuilt by an ingest. `everything` hides the office (or every office on
  the domain) everywhere; `listings` stops crawling the domain and hides its homes. Operators add
  rows with a documented `INSERT` (REAL-DATA.md).
- `agency_google_place` stores only Google place ids, which Google allows to be kept indefinitely.
  Filled once by `area_analytics.agency_google match`: Places Text Search (New) with the field mask
  `places.id,places.displayName,places.location` for "<name>, <lat,lon>" biased to 100 m; accepted
  within 150 m when the names agree: lower-cased letters and digits of one name begin the other's
  (at least 6 characters: "Property World" and "Propertyworld - Sydenham"); or, after dropping
  generic words (estate, estates, agent, agents, letting, lettings, sales, property, properties, ltd,
  limited, llp, the, and, branch, office), the rest reads the same without spaces ("JH" and "J H"),
  every word of the shorter is in the longer ("Foxtons" and "Foxtons Ealing Estate Agents"), or the
  rest is trigram-similar (≥ 0.5); a name that is all generic words is compared whole. Otherwise
  NULL. Measured on 2,667 OpenStreetMap offices with an Overture office within 150 m (2026-10-14):
  1,698 matched; comparing only the non-generic rest removed false matches such as "AA Estate
  Agents" and "J K Estate Agents". Offices with no name are not asked. Before any id is stored,
  `agency_google review` asks Google for 50 offices and prints them for a person to read (nothing
  written); then run `--limit 50` and stop if unmatched dominates; `DELETE FROM agency_google_place WHERE google_place_id IS
  NULL;` asks unmatched offices again. Re-run monthly for new offices only. No other Google content
  is stored.

## Step 2: crawler

### Shape

Package `pipelines/area-analytics-ingest/area_analytics/agency_crawl/`:

- `fetch.py` (shipped in step 1, used there for website verification): the only HTTP client. User agent
  `CloseKnitBot/1.0 (+https://getcloseknit.com/bot)`; robots.txt honoured including `Crawl-delay`;
  at most one request per 5 s per domain; plain HTTP, no JavaScript, no logins, no cookies kept
  between runs. Any 403, 429, CAPTCHA or challenge page stops the domain for this run and marks it
  `blocked`; it is retried after 30 days, never worked around.
- `adapters/`: one module per chain (the twelve above) and per platform (Property Hive, Starberry,
  Acquaint, Expert Agent, Street, Eurolink). Interface:
  `detect(domain, home_html) -> bool`, `index_urls(domain, market) -> list[str]`,
  `parse_index(html, page_url) -> list[ListingFact]`, `next_page(html, page_url) -> str | None`.
  At most 40 index pages per domain per run. Detail pages are not fetched in v1: index cards carry
  price, beds, type, address and status on every adapter in scope (to confirm per adapter while
  writing it; an adapter that needs detail pages fetches at most 200 per run).
- `run.py`: weekly. For each domain from step 1 not opted out: detect the adapter (cached in
  `agency_site.adapter`, re-detected monthly), crawl, upsert facts, write a run row.
- The `/bot` page (what the bot collects, how often, how to opt out) ships in step 1, before any fetch.

### Tables (migration 052)

```sql
CREATE TABLE IF NOT EXISTS agency_site (
    domain text PRIMARY KEY,
    adapter text,                     -- 'foxtons', 'propertyhive', ... or NULL (link only)
    crawl_state text NOT NULL CHECK (crawl_state IN ('ok', 'blocked', 'dead', 'robots', 'opted_out', 'no_adapter')),
    retry_after timestamptz,
    detected_at timestamptz,
    last_crawled_at timestamptz
);

CREATE TABLE IF NOT EXISTS agency_listing (
    url text PRIMARY KEY,             -- canonical: scheme+host+path, tracking params and fragment dropped
    domain text NOT NULL REFERENCES agency_site(domain),
    market text NOT NULL CHECK (market IN ('sale', 'rent')),
    price_pence bigint,               -- NULL for POA
    price_period text CHECK (price_period IN ('week', 'month')),  -- rent only
    bedrooms smallint,
    property_type text,               -- flat, house, maisonette, bungalow, land, other
    status text NOT NULL CHECK (status IN ('available', 'under_offer', 'let_agreed')),
    postcode text,                    -- full postcode or district as printed
    location_precision text NOT NULL CHECK (location_precision IN ('postcode', 'street', 'district')),
    location geometry(Point, 4326),
    geography_id text REFERENCES area_geography(id),  -- LSOA; NULL for district precision
    district text NOT NULL,           -- postcode district, e.g. W13
    first_seen timestamptz NOT NULL,
    last_seen timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS agency_crawl_run (
    id serial PRIMARY KEY,
    domain text NOT NULL,
    started_at timestamptz NOT NULL,
    finished_at timestamptz,
    pages integer NOT NULL DEFAULT 0,
    listings integer NOT NULL DEFAULT 0,
    outcome text NOT NULL             -- ok, blocked, dead, robots, suspect, error
);
```

### Rules

- Location: a full postcode → its LSOA through `postcode_civic` (ONSPD, migration 019; it holds no
  point, so `location` is the LSOA centroid), precision `postcode`. Street + district → OS Open Names street point (as in street-level address
  search), precision `street`. District only → no point, precision `district`.
- Never stored: photos, descriptions, agent or vendor names, phone numbers, page HTML.
- Freshness: the API shows a home only if `last_seen` is within 10 days.
- Layout change guard: if a domain that had ≥ 5 homes yields 0, the run is `suspect`, its homes'
  `last_seen` is not touched (they expire after 10 days anyway) and the run report lists it.
- A home is tied to the office of its domain nearest to the home (or to the domain's only office).
- Schedule: a systemd timer on the production host, weekly (new: no scheduler exists today);
  `--domain` runs one site by hand. Coverage is measured on the first run from the production host,
  since some sites block data-centre addresses.

## Step 3: API and MCP

Module `api/area_api/agencies.py`, following `photos.py` (empty, not an error, when tables are not
loaded; unknown area → 404).

`GET /api/v1/areas/{geographyId}/agents?market=sale|rent`:

- Offices in the area geometry (`area_geography`) or within 1 km, minus opt-outs, ordered by
  distance (0 inside) then name; at most 40.
- Per office: `id`, `name`, `brand`, `website`, `distanceMetres`, `inArea`, `sources`,
  `confidence`, `companyNumber` (with its Companies House link, when verified), `redressScheme` (as named on the site), `hasGoogleRating` (a place id is on file), and `homes`:
  `{forSale, toRent, inArea, nearby, checkedAt, readable}`. `inArea` counts homes with
  `postcode`/`street` precision inside the area; `nearby` counts homes in the area's postcode
  districts outside it or with `district` precision. `readable=false` (site blocked, dead or without
  an adapter) means "count unknown", never zero.
- `searchLinks`: portal searches per district from `home_search.listing_searches` for `market`.
- Envelope `sources` (OSM ODbL, Companies House OGL, Overture CDLA-Permissive-2.0, Foursquare Apache-2.0, agents' own
  sites with crawl dates) and `caveats` (not a complete register; offices, not every street an agent
  sells in; counts as of the last check and only for sites we can read; some letting or management
  offices included).

`GET /api/v1/areas/{geographyId}/agents/homes?office=<id>&market=&limit=50`: the homes behind the
counts: price, period, beds, type, status, postcode as printed, precision, `url`, `lastSeen`.

`GET /api/v1/areas/{geographyId}/agents/ratings`: for the area's offices with a Google place id,
Place Details (New) with the field mask `rating,userRatingCount,googleMapsUri`, in parallel, live.
Response `Cache-Control: no-store`; nothing is written to the database, the evidence cache or logs
beyond counts. Guarded by the existing rate limiter (per client) and a daily call budget
(`CLOSE_KNIT_GOOGLE_PLACES_DAILY_CALLS`, default 2,000); over budget → 503 with a message, the page
keeps working without ratings. Server-side key `CLOSE_KNIT_GOOGLE_PLACES_KEY`; no key → endpoint
returns `available: false`.

MCP: `get_area_agents(area_id, market?, include_homes?)` returns the office payload, and with
`include_homes` up to 20 homes per office (facts + URL) for `assess_listing`. No ratings through MCP
(live per-view Google content stays on the website). `listings.md`: "Also check estate agents
directly" uses this tool; the "never fetches" rule is replaced by a pointer to the crawler rules.

## Step 4: website

"Estate agents here" on the area full page (`area-full-page.tsx`), fetched server-side like the
Geograph photos (short timeout, hidden when empty):

- Up to 5 offices shown, "Show all N"; in-area first.
- Per office: name, brand when different, distance or "In area"; "Their homes (17)" → expands the
  homes list (price, beds, type, postcode, "On agent's site ↗"); "count unknown — see their site"
  when unreadable; no link without a website.
- Ratings: a "Show Google ratings" button calls the ratings endpoint from the browser; each office
  with a rating gets a star icon with the rating and review count, linking to its Google Maps page,
  with the Google Maps attribution and a link to Google's review policy. Then a sort switch
  "Distance | Google rating" appears; sorting by rating puts unrated offices last and says
  "Sorted by Google rating; offices without a Google rating last".
- Reviews elsewhere: per office a "Trustpilot" search link; once per section "Check redress
  scheme membership" (TPO, PRS) links.
- "Search the portals" with Buy/Rent: district searches.
- Footer: sources, caveats, "Is this your agency? Correct or remove" →
  `contactMailto("Correct or remove agency: <name> (<id>)")`.
- Privacy page: a paragraph on the agency directory (sole traders' names), the crawler and the
  Google ratings call (the user's browser asks our server; our server asks Google; nothing kept).
- DATA-LICENCES.md: OSM, Overture, Foursquare entries extended; Google Places terms; agents' sites
  (facts and links only).

## Out of scope

Agency map layer, TfL zones, our own scores, user reviews, feed intake (BLM/RTDF), AI extraction
for unknown sites, Trustpilot data, a London-wide ranking.

## Testing

- Step 1: `overture_places` keeps `website` for estate-agent categories only; Google matching
  accepts and rejects on name similarity and distance (mocked HTTP).
- Step 2: each adapter against a small synthetic HTML fixture shaped like that site (no copied
  pages in the repo); `fetch.py` stops a domain on 403/429/challenge and honours robots.txt and
  Crawl-delay (local test server); canonical URLs; location precision; suspect-run guard; opt-out
  `listings` skips the domain.
- Step 3: `api/tests/test_agencies.py` for ordering, 1 km cut, opt-outs, counts in area vs nearby,
  `readable=false`, 10-day freshness, homes endpoint; ratings endpoint with mocked Google (no-store
  header, budget exhausted → 503, no key → unavailable, nothing persisted); MCP tool registration.
- Step 4: component tests (hidden when empty, counts and "unknown", ratings button and sort,
  attribution present, mailto subject).
- `gate.sh` green except the known preflight/test failures recorded in project memory.
- After each production load: office count and share with website (step 1), Google match rate
  (step 1), domains `ok / blocked / dead / no_adapter` and homes found (step 2), spot-check three
  areas (step 3), reported in the PR.

## Open checks before step 3 ships

- Current Google Places prices for Text Search IDs-only and Place Details with rating fields, and
  the full Service Specific Terms text (the policies page confirms: no storage except place ids;
  display without a map needs the Google logo or "Google Maps"; tell users about Google's review
  policy and how results are ranked).
- A UK solicitor's read of the crawler rules and the directory before launch.
