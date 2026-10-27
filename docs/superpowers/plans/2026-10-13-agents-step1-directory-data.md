# Estate agents, step 1: directory data — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load every London estate agent office we can evidence (map sources plus Companies House firms with a verified website), with websites, opt-outs and Google place ids, into the database — no UI yet.

**Architecture:** Offices stay in the existing unified `place` table; migration 051 adds websites for Overture estate agents, Companies House firms, website↔company verification, opt-outs, Google place ids and one view `agency_office` that later steps read. All fetching of agents' sites goes through one polite client (`agency_crawl/fetch.py`) whose user agent points at a new `/bot` page.

**Tech Stack:** Python 3 stdlib (urllib, robotparser, csv, zipfile, unittest) in `pipelines/area-analytics-ingest`; psycopg and duckdb as the existing loaders use them (`uv run --with ...`); PostgreSQL/PostGIS migration; Next.js page + `tsx --test` in `web/`.

**Spec:** `docs/superpowers/specs/2026-10-12-london-agencies-directory-design.md` (step 1 sections). Roadmap: `ROADMAP-agents-and-distribution.md`.

## Global Constraints

- User agent, exactly: `CloseKnitBot/1.0 (+https://getcloseknit.com/bot)`.
- robots.txt honoured including `Crawl-delay`; at most one request per 5 s per domain; plain HTTP, no JavaScript, no logins, no cookies kept.
- Any 403, 429, CAPTCHA or challenge page stops the domain for the run, marked `blocked`, never worked around.
- Overture keeps a website only for categories mapping to `estate_agent` (`real_estate_agent`, `real_estate_service`); every other category still drops it.
- OSM website wins over Overture when both exist.
- Companies House: active companies, SIC 68310 or 68320, registered postcode in London (`postcode_civic.region_code = 'E12000007'`); officers and PSCs never read; the registered address is never shown as an office.
- Company website verification: homepage plus at most two more pages linked as contact, terms or privacy; domain guessing at most four candidates; a guess is kept only if its pages carry the company's number.
- Website office: a London postcode on a verified site's contact page, unless a `place` office of the same domain is within 300 m.
- Google: only place ids are stored; Text Search field mask `places.id,places.displayName,places.location`, bias radius 100 m, accept within 150 m when the names agree (`names_agree`; rule as in the spec's `agency_google_place` bullet, revised 2026-10-14 after measuring it on OpenStreetMap and Overture offices).
- Never stored: photos, descriptions, people's names, phone numbers, page HTML.
- Migration file `deploy/migrations/051-agency-directory.sql`, safe to run again, mounted in `deploy/docker-compose.yml` as `151-agency-directory.sql`.

## Review Focus

1. Websites written as `WWW.Foxtons.co.uk/branches/ealing`, `foxtons.co.uk`, `http://foxtons.co.uk?ref=osm` must all give domain `foxtons.co.uk` — Task 1 test `test_site_domain_forms`.
2. Company numbers printed without leading zeros (`Company No. 1234567`) must read as `01234567`; a VAT number (`VAT Reg No. 123 4567 89`) must never be read as a company number — Task 6 tests `test_company_numbers_pad_leading_zeros`, `test_vat_numbers_are_not_company_numbers`.
3. A site that redirects to another domain (agency rebranded) must be recorded under the final domain, not the old one — Task 4 test `test_cross_domain_redirect_reports_final_domain`.
4. A reCAPTCHA on a contact form (seen on ~a quarter of sampled sites) must not mark the domain blocked; only challenge pages do — Task 4 test `test_recaptcha_widget_is_not_a_block`.
5. Non-HTML or oversized responses (PDF brochures, 50 MB pages) must be skipped, not parsed — Task 4 test `test_non_html_and_oversized_are_skipped`.

---

### Task 1: Site URL helpers

**Files:**
- Create: `pipelines/area-analytics-ingest/area_analytics/agency_crawl/__init__.py` (empty docstring module)
- Create: `pipelines/area-analytics-ingest/area_analytics/agency_crawl/urls.py`
- Test: `pipelines/area-analytics-ingest/tests/test_agency_urls.py`

**Interfaces:**
- Produces: `site_domain(url: str | None) -> str | None` (lower-case host without `www.`; None for empty, non-http(s) or hostless input); `homepage(url: str | None) -> str | None` (`scheme://host/`, scheme kept, default `https` when missing); `SITE_DOMAIN_SQL: str` — a SQL expression over a column named `website` returning the same domain, used verbatim by migration 051.

- [ ] **Step 1: Write the failing tests**

```python
class SiteDomainTests(unittest.TestCase):
    def test_site_domain_forms(self):
        for raw in ("WWW.Foxtons.co.uk/branches/ealing", "foxtons.co.uk", "http://foxtons.co.uk?ref=osm",
                    "https://www.foxtons.co.uk/#top", " https://foxtons.co.uk:443/ "):
            self.assertEqual(urls.site_domain(raw), "foxtons.co.uk", raw)

    def test_site_domain_rejects_non_web(self):
        for raw in (None, "", "mailto:a@b.com", "tel:0207", "https://"):
            self.assertIsNone(urls.site_domain(raw), raw)

    def test_homepage_keeps_scheme(self):
        self.assertEqual(urls.homepage("http://www.kfh.co.uk/sales"), "http://www.kfh.co.uk/")
        self.assertEqual(urls.homepage("kfh.co.uk"), "https://kfh.co.uk/")

    def test_sql_twin_names_the_website_column(self):
        self.assertIn("website", urls.SITE_DOMAIN_SQL)
        self.assertIn("www", urls.SITE_DOMAIN_SQL)
```

- [ ] **Step 2: Run to verify failure**

Run: `cd pipelines/area-analytics-ingest && python3 -m unittest tests.test_agency_urls -v`
Expected: FAIL — `ModuleNotFoundError: area_analytics.agency_crawl`

- [ ] **Step 3: Implement `site_domain`, `homepage`, `SITE_DOMAIN_SQL` in `urls.py`**

`urllib.parse.urlsplit` after prefixing `https://` when there is no `://`; drop port. `SITE_DOMAIN_SQL` must agree with `site_domain` for the forms in the test (the Task 8 `check` command compares the two on production data):

```python
SITE_DOMAIN_SQL = (
    "nullif(regexp_replace(regexp_replace(lower(btrim(website)), '^[a-z]+://', ''), "
    "'^www\\.|[:/?#].*$', '', 'g'), '')"
)
```

- [ ] **Step 4: Run to verify pass** — same command, Expected: `OK`

- [ ] **Step 5: Commit** — `git commit -m "Agents: site domain and homepage helpers"`

---

### Task 2: Migration 051

**Files:**
- Create: `deploy/migrations/051-agency-directory.sql`
- Modify: `deploy/docker-compose.yml` (after the `048-school-history.sql` mount, line ~90)
- Test: `deploy/tests/test_agency_directory_schema.py`

**Interfaces:**
- Consumes: `SITE_DOMAIN_SQL` (Task 1), pasted verbatim once into the view: an inner query yields each office with a column named `website`, the outer query computes `domain` from it.
- Produces: tables `agency_opt_out`, `agency_google_place`, `agency_company`, `agency_site_company` exactly as in the spec; column `overture_place.website text`; view `agency_office(id, name, brand, website, domain, location, sources, confidence, company_number)`.

`agency_office` rows:
1. Every `place` with `category = 'estate_agent'`: `id = place.id`; `website = coalesce(OSM tags website/contact:website via place_poi on place.osm_id, overture_place.website via place.overture_id)`; `domain` from `SITE_DOMAIN_SQL`; `sources = place.sources`; `confidence = place.confidence`.
2. Every `agency_site_company` row with `office_postcode`, whose domain has no `place` office within 300 m of that postcode's LSOA centroid (`postcode_civic` → `area_geography` `'uk:lsoa:' || lsoa_code`) and fewer than 3 `place` offices in total (chains list head offices on contact pages): `id = 'web:' || domain || ':' || replace(office_postcode, ' ', '')`; `name = agency_company.name`; `location` = LSOA centroid; `sources = '{website}'`; `confidence = 0.6`.
3. `company_number` on both kinds from `agency_site_company` by domain (NULL when none or more than one).
4. Excluded: any row whose `id` or `domain` has an `agency_opt_out` with scope `everything`.

- [ ] **Step 1: Write the failing tests** (text checks, as `test_geograph_photo_schema.py` does)

```python
def test_every_statement_is_safe_to_run_again(self):
    for statement in STATEMENTS:
        self.assertRegex(statement, r"IF NOT EXISTS|CREATE OR REPLACE VIEW")
def test_compose_mounts_the_migration(self):
    self.assertIn("./migrations/051-agency-directory.sql:/docker-entrypoint-initdb.d/151-agency-directory.sql:ro", COMPOSE)
def test_view_uses_the_python_domain_twin(self):
    self.assertIn(urls.SITE_DOMAIN_SQL, VIEW)
def test_opt_out_scope_values(self):
    self.assertIn("CHECK (scope IN ('listings', 'everything'))", MIGRATION)
def test_nothing_personal_is_stored(self):
    for word in ("officer", "phone", "photo", "description", "html"):
        self.assertNotIn(word, TABLE_COLUMNS.lower())
def test_view_drops_opted_out_offices(self):
    self.assertRegex(VIEW, r"agency_opt_out[\s\S]*'everything'")
```

(`TABLE_COLUMNS` = the text of every `CREATE TABLE` body; `VIEW` = the `CREATE OR REPLACE VIEW agency_office` statement. Import `urls` via `sys.path` to `pipelines/area-analytics-ingest`, as other deploy tests reach across the repo.)

- [ ] **Step 2: Run to verify failure** — `cd deploy && python3 -m unittest tests.test_agency_directory_schema -v` → FAIL (file missing)

- [ ] **Step 3: Write the migration and the compose mount.** Header comment in the style of 048: what each table holds, the licences (Companies House OGL, Overture CDLA, OSM ODbL), "only Google place ids are stored". Indexes: `agency_site_company (domain)`, `agency_opt_out (domain)`, `agency_opt_out (place_id)`.

- [ ] **Step 4: Run to verify pass** — same command → `OK`

- [ ] **Step 5: Commit** — `git commit -m "Agents: migration 051, opt-outs, companies, verification, Google ids, agency_office view"`

---

### Task 3: Overture websites for estate agents only

**Files:**
- Modify: `pipelines/area-analytics-ingest/area_analytics/overture_places.py` (docstring lines 9-10, `COLUMNS`, `SELECT`, `place_row`, `ETL_VERSION`)
- Test: `pipelines/area-analytics-ingest/tests/test_overture_places.py`

**Interfaces:**
- Produces: `AGENT_CATEGORIES = frozenset({"real_estate_agent", "real_estate_service"})`; `COLUMNS` gains `"website"` before `"location"`; `place_row` returns `website` only when `category` or `basic_category` is in `AGENT_CATEGORIES`, else None.

- [ ] **Step 1: Write the failing tests**

```python
def test_keeps_website_only_for_estate_agents(self):
    agent = overture_places.place_row({**RECORD, "category": "real_estate_agent", "website": "https://kfh.co.uk"})
    self.assertEqual(agent["website"], "https://kfh.co.uk")
    self.assertIsNone(overture_places.place_row({**RECORD, "website": "https://kebab.example"})["website"])

def test_select_never_reads_other_websites(self):
    self.assertIn("CASE WHEN", overture_places.SELECT)
    self.assertIn("real_estate_agent", overture_places.SELECT)
```

Update `test_keeps_only_the_table_columns` expectations for the new column.

- [ ] **Step 2: Run to verify failure** — `cd pipelines/area-analytics-ingest && python3 -m unittest tests.test_overture_places -v` → FAIL

- [ ] **Step 3: Implement.** In `SELECT` add `CASE WHEN taxonomy.primary IN ('real_estate_agent','real_estate_service') OR basic_category IN ('real_estate_agent','real_estate_service') THEN websites[1] END AS website`, so other websites are never fetched from S3. Bump `ETL_VERSION` to `close-knit-overture-places-2`. Docstring: "websites are dropped except for estate agents (agent directory, migration 051)".

- [ ] **Step 4: Run to verify pass** → `OK`

- [ ] **Step 5: Commit** — `git commit -m "Overture: keep websites for estate agents only"`

---

### Task 4: Polite fetch client and the /bot page

**Files:**
- Create: `pipelines/area-analytics-ingest/area_analytics/agency_crawl/fetch.py`
- Create: `web/src/lib/bot.ts`, `web/src/app/bot/page.tsx`
- Test: `pipelines/area-analytics-ingest/tests/test_agency_fetch.py`, `web/tests/bot.test.ts`

**Interfaces:**
- Consumes: `site_domain` (Task 1).
- Produces:
  - `USER_AGENT = "CloseKnitBot/1.0 (+https://getcloseknit.com/bot)"`, `MIN_INTERVAL = 5.0`, `MAX_BYTES = 2_000_000`, `TIMEOUT = 20`.
  - `@dataclass(frozen=True) class Page: url: str; final_url: str; domain: str; status: int; text: str | None; outcome: str` where outcome ∈ `ok | blocked | robots | dead | skipped | error`.
  - `class Fetcher: __init__(self, opener=None, clock=time.monotonic, sleep=time.sleep)`; `get(self, url: str) -> Page`; `blocked: set[str]` (domains stopped this run).
  - `web/src/lib/bot.ts`: `export const BOT_USER_AGENT = "CloseKnitBot/1.0 (+https://getcloseknit.com/bot)"`.

Rules: robots.txt fetched once per domain (`urllib.robotparser`), unreachable robots → allowed; interval per domain = `max(MIN_INTERVAL, crawl_delay)`; status 403/429, or a body with a challenge marker (`cf-chl`, `challenge-platform`, `<title>just a moment`, `attention required! | cloudflare`) → `blocked`, domain added to `blocked`, later calls for it return `blocked` without a request; DNS/connection/timeout → `dead`; content type not `text/html` or body over `MAX_BYTES` → `skipped`; redirects followed, `domain` is the final URL's domain; no cookie jar.

- [ ] **Step 1: Write the failing tests** — a `http.server` on `127.0.0.1` in a thread serving fixed routes; inject `sleep` to record waits.

```python
def test_sends_the_bot_user_agent(self): ...            # handler records User-Agent == fetch.USER_AGENT
def test_robots_disallow_is_respected(self): ...        # robots "Disallow: /private" → get(/private).outcome == "robots", no request logged
def test_crawl_delay_raises_the_interval(self): ...     # "Crawl-delay: 9" → recorded sleep ≥ 9 before 2nd request
def test_403_blocks_the_domain_for_the_run(self): ...   # first 403 → "blocked"; next get on same host makes no request
def test_challenge_page_blocks(self): ...               # 200 with "challenge-platform" → "blocked"
def test_recaptcha_widget_is_not_a_block(self): ...     # 200 page containing "g-recaptcha" and "www.google.com/recaptcha" → "ok"
def test_cross_domain_redirect_reports_final_domain(self): ...  # 301 to second server name → page.domain == final host
def test_non_html_and_oversized_are_skipped(self): ...  # application/pdf → "skipped"; 3 MB html → "skipped"
def test_unreachable_host_is_dead(self): ...            # closed port → "dead"
```

Web: `web/tests/bot.test.ts` asserts `BOT_USER_AGENT` equals the Python constant read from `../pipelines/area-analytics-ingest/area_analytics/agency_crawl/fetch.py` (regex on `USER_AGENT = "..."`).

- [ ] **Step 2: Run to verify failure** — `cd pipelines/area-analytics-ingest && python3 -m unittest tests.test_agency_fetch -v` and `cd web && npx tsx --test tests/bot.test.ts` → both FAIL

- [ ] **Step 3: Implement `fetch.py`, `bot.ts`, and `app/bot/page.tsx`.** Page follows `app/about/page.tsx` (SiteHeader, SubpageHero; static, no `force-dynamic`), title "CloseKnitBot". Copy, in plain sentences: who runs it (link to /about); what it reads — estate agents' own websites only, the homepage and contact/terms/privacy pages to confirm the company, later listing pages for price, bedrooms, type, postcode and the link; what it never takes — photos, descriptions, names, phone numbers; how often — at most once a week, one request every 5 seconds or slower if robots.txt asks; it obeys robots.txt and stops at the first block; how to opt out or correct — `contactMailto("CloseKnitBot opt-out: <your domain>")`, or a robots.txt rule for `CloseKnitBot`; the user agent string from `BOT_USER_AGENT`.

- [ ] **Step 4: Run to verify pass** — both commands → `OK` / `pass`; `cd web && npm run typecheck`

- [ ] **Step 5: Commit** — `git commit -m "Agents: polite fetch client and /bot page"`

---

### Task 5: Companies House firms

**Files:**
- Create: `pipelines/area-analytics-ingest/area_analytics/agency_companies.py`
- Test: `pipelines/area-analytics-ingest/tests/test_agency_companies.py`

**Interfaces:**
- Produces:
  - `SIC_CODES = ("68310", "68320")`, `LONDON_REGION = "E12000007"`, `CH_URL = "https://download.companieshouse.gov.uk/BasicCompanyDataAsOneFile-{month}.zip"` (month `YYYY-MM-01`), source id `src-companies-house-basic-{month}`, licence `OGL-UK-3.0`.
  - `company_row(record: dict, london_postcodes: set[str]) -> dict | None` → keys `company_number, name, sic_codes, registered_postcode, incorporated` (sic_codes a Postgres `text[]` literal of the 5-digit codes; incorporated ISO date from `dd/mm/yyyy`); None unless status `Active`, one SIC text starts with a code in `SIC_CODES`, and the normalised postcode is in `london_postcodes`. Header names are stripped (the file has `" CompanyNumber"`).
  - CLI stages: `fetch MONTH` (download to `~/data/companies-house/`), `build URL` (stream the zip's CSV, London postcodes read from `postcode_civic` where `region_code = LONDON_REGION AND terminated IS NULL`, write `agency_company.tsv` + `sources.json`), `load URL` (insert `source_release`, replace rows of that release, COPY).

- [ ] **Step 1: Write the failing tests**

```python
ROW = {"CompanyName": "ELM ESTATES LTD", " CompanyNumber": "01234567", "CompanyStatus": "Active",
       "RegAddress.PostCode": "w13 9ab", "IncorporationDate": "05/03/2011",
       "SICCode.SicText_1": "68310 - Real estate agencies", "SICCode.SicText_2": "", "SICCode.SicText_3": "",
       "SICCode.SicText_4": "", "Officer": "never read"}
def test_keeps_active_london_agencies(self):
    row = agency_companies.company_row(strip(ROW), {"W13 9AB"})
    self.assertEqual(row, {"company_number": "01234567", "name": "ELM ESTATES LTD", "sic_codes": '{"68310"}',
                           "registered_postcode": "W13 9AB", "incorporated": "2011-03-05"})
def test_drops_other_sic_dissolved_and_outside_london(self): ...  # 70100 / "Dissolved" / postcode not in set → None
def test_letting_management_code_counts(self): ...               # SicText_2 "68320 - Management of real estate..." → kept
def test_header_with_leading_space_is_read(self): ...            # raw header " CompanyNumber" via the module's header normaliser
```

- [ ] **Step 2: Run to verify failure** — `python3 -m unittest tests.test_agency_companies -v` → FAIL

- [ ] **Step 3: Implement** following `geograph.py` / `overture_places.py`: pure row shaping + `tsv_line`, `source_release(sources)`, `main(argv)`; `csv.DictReader` over `zipfile.ZipFile(...).open(name)` wrapped in `io.TextIOWrapper(..., encoding="utf-8", newline="")`; postcode normalised to upper case with one space before the last three characters.

- [ ] **Step 4: Run to verify pass** → `OK`

- [ ] **Step 5: Commit** — `git commit -m "Agents: Companies House estate and letting agencies in London"`

---

### Task 6: Website verification by company number

**Files:**
- Create: `pipelines/area-analytics-ingest/area_analytics/agency_crawl/verify.py`
- Modify: `pipelines/area-analytics-ingest/area_analytics/agency_companies.py` (stage `verify URL [--limit N] [--workers 8]`)
- Test: `pipelines/area-analytics-ingest/tests/test_agency_verify.py`

**Interfaces:**
- Consumes: `Fetcher`, `Page` (Task 4); `site_domain`, `homepage` (Task 1); `agency_company`, `agency_office` (Task 2).
- Produces:
  - `company_numbers(text: str) -> set[str]` — 8-character numbers next to "company", "registered" or "no."/"number": digits padded to 8 with leading zeros (6–8 digits, internal single spaces removed), or two letters + 6 digits (`SC123456`, `OC301234`, `NI…`); never numbers after "VAT".
  - `uk_postcodes(text: str) -> list[str]` — normalised postcodes in page order.
  - `redress_scheme(text: str) -> str | None` — `"TPO"` for "The Property Ombudsman"/"TPO", `"PRS"` for "Property Redress Scheme"/"PRS", None otherwise; first found wins.
  - `verification_links(html: str, base_url: str) -> list[str]` — at most 2 same-domain links whose href or text matches `contact|terms|privacy|legal`, contact first.
  - `candidate_domains(company_name: str) -> list[str]` — at most 4: `<slug>.co.uk`, `<slug>.com`, `<slug>.london`, `<slug>estates.co.uk`; slug = lower-case letters and digits of the name after dropping `ltd`, `limited`, `llp`, `estate agents`, `estates`, `lettings`, `property`, `properties`, `the`, `&`/`and`; empty slug → `[]`.
  - `verify_site(fetcher, url, known_numbers: set[str], london_postcodes: set[str]) -> list[dict]` — rows for `agency_site_company` (domain = final domain, company_number, page_url, redress_scheme, office_postcode = first London postcode on the contact page, else on any fetched page); `[]` when no known number is found.

Verify stage: domains = distinct `agency_office.domain` where website is not NULL, plus `candidate_domains` for companies with no `agency_site_company` row; skip domains with an `agency_opt_out` row of either scope; `ThreadPoolExecutor(workers)` over domains (the `Fetcher` already serialises per domain); per domain replace its rows in one transaction; print counts `verified / no number / blocked / dead`.

- [ ] **Step 1: Write the failing tests**

```python
def test_company_numbers_pad_leading_zeros(self):
    self.assertEqual(verify.company_numbers("Registered in England, Company No. 1234567"), {"01234567"})
def test_scottish_and_llp_prefixes(self):
    self.assertEqual(verify.company_numbers("Company number SC123456. LLP no OC301234"), {"SC123456", "OC301234"})
def test_vat_numbers_are_not_company_numbers(self):
    self.assertEqual(verify.company_numbers("VAT Reg No. 123 4567 89"), set())
def test_postcodes_and_redress(self):
    text = "Visit us at 12 Elm Road, London W13 9AB. Members of The Property Ombudsman."
    self.assertEqual(verify.uk_postcodes(text), ["W13 9AB"]); self.assertEqual(verify.redress_scheme(text), "TPO")
def test_verification_links_same_domain_contact_first(self): ...   # links to /privacy, /contact-us, https://other.com/contact → ["…/contact-us", "…/privacy"]
def test_candidate_domains(self):
    self.assertEqual(verify.candidate_domains("ELM ESTATES LTD"),
                     ["elm.co.uk", "elm.com", "elm.london", "elmestates.co.uk"])
    self.assertEqual(verify.candidate_domains("THE PROPERTIES LTD"), [])
def test_verify_site_keeps_only_known_numbers(self): ...   # fake fetcher returning pages; unknown number → []; known → one row with office_postcode
def test_guess_without_number_creates_nothing(self): ...   # parked page "This domain is for sale" → []
```

- [ ] **Step 2: Run to verify failure** — `python3 -m unittest tests.test_agency_verify -v` → FAIL

- [ ] **Step 3: Implement `verify.py` and the `verify` stage**

- [ ] **Step 4: Run to verify pass** → `OK`

- [ ] **Step 5: Commit** — `git commit -m "Agents: verify agency websites by company number"`

---

### Task 7: Google place ids

**Files:**
- Create: `pipelines/area-analytics-ingest/area_analytics/agency_google.py`
- Test: `pipelines/area-analytics-ingest/tests/test_agency_google.py`

**Interfaces:**
- Consumes: `agency_office`, `agency_google_place` (Task 2).
- Produces:
  - `SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"`, `FIELD_MASK = "places.id,places.displayName,places.location"`, `BIAS_METRES = 100`, `MAX_METRES = 150`, `MIN_SIMILARITY = 0.5`, key from env `CLOSE_KNIT_GOOGLE_PLACES_KEY`.
  - `request_body(name: str, lat: float, lon: float) -> dict` — `{"textQuery": name, "locationBias": {"circle": {"center": {"latitude": lat, "longitude": lon}, "radius": 100.0}}, "maxResultCount": 3}`.
  - `name_similarity(a: str, b: str) -> float` — pg_trgm-style: lower-case, words padded with two leading spaces and one trailing, trigram sets, `|A∩B| / |A∪B|`.
  - `metres(lat1, lon1, lat2, lon2) -> float` (haversine).
  - `accept(places: list[dict], name: str, lat: float, lon: float) -> str | None` — id of the first candidate with similarity ≥ 0.5 and distance ≤ 150 m.
  - `match(url: str, post=None, limit: int | None = None) -> dict` — offices with no `agency_google_place` row; writes one row each (`google_place_id` or NULL, `matched_at = now()`); returns counts `{matched, unmatched, errors}`; `post(url, headers, body) -> dict` injectable, default urllib. No other field from Google is written anywhere, including logs.

- [ ] **Step 1: Write the failing tests**

```python
def test_body_biases_to_100_metres(self): ...                      # request_body(...)["locationBias"]["circle"]["radius"] == 100.0
def test_similarity_matches_pg_trgm_shape(self):
    self.assertEqual(agency_google.name_similarity("Foxtons", "Foxtons"), 1.0)
    self.assertGreaterEqual(agency_google.name_similarity("Foxtons Ealing", "Foxtons - Ealing Estate Agents"), 0.5)
    self.assertLess(agency_google.name_similarity("Foxtons", "Dexters"), 0.5)
def test_accept_needs_name_and_distance(self): ...                 # same name 400 m away → None; similar name 80 m → its id
def test_match_stores_only_ids(self): ...                          # fake post + fake connection: inserted tuples are (place_id, google_place_id|None) only
def test_no_key_refuses_to_run(self): ...                          # env unset → SystemExit with a message naming CLOSE_KNIT_GOOGLE_PLACES_KEY
```

- [ ] **Step 2: Run to verify failure** — `python3 -m unittest tests.test_agency_google -v` → FAIL

- [ ] **Step 3: Implement**; headers `X-Goog-Api-Key`, `X-Goog-FieldMask: FIELD_MASK`, `Content-Type: application/json`; on HTTP error count it, write no row (retried next run).

- [ ] **Step 4: Run to verify pass** → `OK`

- [ ] **Step 5: Commit** — `git commit -m "Agents: Google place ids for agency offices (ids only)"`

---

### Task 8: Coverage check and documentation

**Files:**
- Modify: `pipelines/area-analytics-ingest/area_analytics/agency_companies.py` (stage `check URL`)
- Modify: `DATA-LICENCES.md`, `REAL-DATA.md`, `RELEASE-CHECKLIST.md`, `pipelines/area-analytics-ingest/DATA-CATALOGUE.md`
- Test: `pipelines/area-analytics-ingest/tests/test_agency_companies.py` (report shaping)

**Interfaces:**
- Consumes: everything above.
- Produces: `coverage_report(counts: dict) -> list[str]` (pure) and `check URL`, printing:
  `offices` (total `agency_office`, by first source, with website %), `companies` (active London 68310/68320; % with a verified site; % with an office), `sites` (verified / blocked / dead from the last verify run's printout is not stored — report verified domains and website offices only), `google` (% of offices with an id), and `domain twin mismatches` — count of `agency_office` rows whose SQL `domain` differs from Python `site_domain(website)`; non-zero exits 1.

- [ ] **Step 1: Write the failing test** — `test_coverage_report_lines`: given counts, the lines include `"offices 2900 (website 41%)"`, `"companies 8000: verified site 30%, office 12%"`, `"google ids 85%"`, `"domain twin mismatches 0"`.
- [ ] **Step 2: Run to verify failure** → FAIL
- [ ] **Step 3: Implement `coverage_report` and `check`; write the docs:**
  - DATA-LICENCES.md: Companies House basic company data (OGL v3.0, attribution "Contains public sector information licensed under the Open Government Licence v3.0"); Overture websites kept for estate agents only; Google Places — ids stored, content never stored; agents' websites — company number, redress scheme name and a postcode only.
  - REAL-DATA.md: load order `migration 051 → overture_places extract/build/load → places_unified load → agency_companies fetch/build/load → agency_companies verify → agency_google match → agency_companies check`; the opt-out `INSERT` (domain lower-case without `www.`, scope, note) and how to undo it.
  - RELEASE-CHECKLIST.md: one step for the agency directory with the `check` thresholds that must be reported in the PR.
  - DATA-CATALOGUE.md: rows for `agency_company`, `agency_site_company`, `agency_google_place`, `agency_opt_out`.
- [ ] **Step 4: Run all unit suites** — `./gate.sh` → unit suites `OK` except the known failures recorded in project memory; web `pass`, typecheck and build ok.
- [ ] **Step 5: Commit** — `git commit -m "Agents: coverage check and data docs"`

---

### Task 9: Production load and report (needs the owner's go-ahead)

Not code. Runs locally after the branch merges, like the rest of the ETL (REAL-DATA.md "Estate agent directory", RELEASE-CHECKLIST 6m), then reaches production through the usual snapshot and `deploy/ship.sh`; confirm with the owner before shipping and before each Google run (it costs money).

- [ ] Apply migration 051 locally; re-run Overture extract/build/load and `places_unified load`.
- [ ] `agency_companies fetch 2026-10-01 && build && load`.
- [ ] Copy production's `agency_opt_out` rows into the local database (REAL-DATA step 5: `ssh <host> "... psql ... -c '\copy agency_opt_out TO STDOUT'"` to a file, then one transaction `TRUNCATE agency_opt_out` + `\copy agency_opt_out FROM` that file); the local count matches production's. Before `verify` and `match`.
- [ ] `agency_companies verify --limit 50` first; look at the printed counts (and the robots.txt refusals); then the full run.
- [ ] Owner checks current Places prices and sets `CLOSE_KNIT_GOOGLE_PLACES_KEY`; `agency_google match --limit 50` and stop if unmatched outnumbers matched; then full. To ask unmatched offices again: `DELETE FROM agency_google_place WHERE google_place_id IS NULL;`.
- [ ] `agency_companies check` → paste the report into the PR; `domain twin mismatches` must be 0.
- [ ] Snapshot (`db-snapshot.sh`) and `deploy/ship.sh` as usual; `agency_opt_out` stays production-only (no rows in the snapshot, the restore keeps the server's table).
- [ ] Spot-check three areas (one central, one outer, one with a chain cluster) with a SQL query on `agency_office` within 1 km of the area; note anything wrong in the PR.
