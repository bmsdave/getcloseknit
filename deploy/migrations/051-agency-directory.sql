-- 051: London estate agent directory, step 1 (see docs/superpowers/specs/2026-10-12-london-agencies-directory-design.md).
--
--   agency_company        active London companies with a letting or estate agency SIC code, from the
--                         Companies House bulk product (OGL v3). Company name, codes, registered postcode
--                         and incorporation date only; no officers or controlling persons are read.
--   agency_site_company   which company a website belongs to: the domain and the company number found on
--                         its own pages, the redress scheme the site names, and a London postcode printed
--                         on its contact page. Written by area_analytics.agency_companies.
--   agency_opt_out        agencies that asked to be left out. Never rebuilt by an ingest; operators add
--                         rows with the INSERT documented in REAL-DATA.md. scope 'everything' hides the
--                         office (or every office on the domain) everywhere; 'listings' stops crawling
--                         the domain and hides its homes.
--   agency_google_place   only Google place ids, which Google allows to be kept; NULL when no confident
--                         match was found. No other Google content is stored.
--   overture_place.website  the website Overture holds, kept for estate agent categories only.
--   agency_office         the one view later steps read: every estate agent in place (OpenStreetMap or
--                         Overture) with its website and domain, plus offices known only from a verified
--                         website's contact page (confidence 0.6), minus 'everything' opt-outs.
--
-- Sources and licences: Companies House (OGL v3), Overture Maps (CDLA Permissive 2.0), OpenStreetMap
-- (ODbL 1.0; agency_office is a derivative of place and so share-alike). Safe to run again.

CREATE TABLE IF NOT EXISTS agency_company (
    company_number text PRIMARY KEY,           -- e.g. 01234567 or SC123456
    name text NOT NULL,
    sic_codes text[] NOT NULL,
    registered_postcode text,
    incorporated date,
    source_release_id text NOT NULL REFERENCES source_release(id)
);

CREATE TABLE IF NOT EXISTS agency_site_company (
    domain text NOT NULL,
    company_number text NOT NULL REFERENCES agency_company(company_number),
    page_url text NOT NULL,                    -- where the number was found
    redress_scheme text,                       -- 'TPO', 'PRS' or NULL, as named on the site
    office_postcode text,                      -- London postcode printed on the contact page, if any
    verified_at timestamptz NOT NULL,
    PRIMARY KEY (domain, company_number)
);

CREATE TABLE IF NOT EXISTS agency_opt_out (
    id serial PRIMARY KEY,
    domain text,                               -- normalised website domain, e.g. foxtons.co.uk (lower case, no www.)
    place_id text,                             -- one office, e.g. osm:n123
    scope text NOT NULL CHECK (scope IN ('listings', 'everything')),
    requested_at timestamptz NOT NULL DEFAULT now(),
    note text NOT NULL,                        -- how the request was verified
    CHECK (domain IS NOT NULL OR place_id IS NOT NULL),
    CHECK (domain IS NULL OR (domain ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' AND domain !~ '^www\.'))
);

CREATE TABLE IF NOT EXISTS agency_google_place (
    place_id text PRIMARY KEY,                 -- our place.id
    google_place_id text,                      -- NULL when no confident match was found
    matched_at timestamptz NOT NULL
);

ALTER TABLE overture_place ADD COLUMN IF NOT EXISTS website text;

CREATE INDEX IF NOT EXISTS agency_site_company_domain_idx ON agency_site_company (domain);
CREATE INDEX IF NOT EXISTS agency_opt_out_domain_idx ON agency_opt_out (domain);
CREATE INDEX IF NOT EXISTS agency_opt_out_place_idx ON agency_opt_out (place_id);

-- id is place.id for a mapped office and 'web:<domain>:<postcode without space>' for a website office.
-- A website office is added only when the domain has fewer than three mapped offices (chains print their
-- head office on contact pages) and none within 300 m of the postcode's LSOA centroid.
-- company_number is set when exactly one company is tied to the domain.
CREATE OR REPLACE VIEW agency_office AS
WITH mapped AS (
    SELECT w.id, w.name, w.brand, w.website,
           CASE WHEN lower(btrim(website)) ~ '^(https?://|[^:/?#@]*[.][^:/?#@]*([:/?#]|$))' THEN nullif(regexp_replace(regexp_replace(lower(btrim(website)), '^https?://', ''), '^www\.|[:/?#].*$', '', 'g'), '') END AS domain,
           w.location, w.sources, w.confidence
    FROM (
        -- a multi-value tag ("a.co.uk;b.co.uk") keeps its first value, as urls.first_website does
        SELECT p.id, p.name, p.tags->>'brand' AS brand,
               coalesce(nullif(btrim(split_part(o.tags->>'website', ';', 1)), ''),
                        nullif(btrim(split_part(o.tags->>'contact:website', ';', 1)), ''),
                        nullif(btrim(split_part(v.website, ';', 1)), '')) AS website,
               p.location, p.sources, p.confidence
        FROM place p
        LEFT JOIN place_poi o ON o.id = p.osm_id
        LEFT JOIN overture_place v ON v.id = p.overture_id
        WHERE p.category = 'estate_agent'
    ) w
),
from_website AS (
    SELECT DISTINCT ON (id) id, name, brand, website, domain, location, sources, confidence
    FROM (
        SELECT 'web:' || sc.domain || ':' || replace(sc.office_postcode, ' ', '') AS id,
               c.name,
               NULL::text AS brand,
               'https://' || sc.domain AS website,
               sc.domain,
               ST_Centroid(g.geometry) AS location,
               '{website}'::text[] AS sources,
               0.6::real AS confidence,
               sc.company_number
        FROM agency_site_company sc
        JOIN agency_company c ON c.company_number = sc.company_number
        JOIN postcode_civic pc ON pc.postcode = sc.office_postcode
        JOIN area_geography g ON g.id = 'uk:lsoa:' || pc.lsoa_code
        WHERE NOT EXISTS (SELECT 1 FROM mapped m
                          WHERE m.domain = sc.domain
                            AND ST_DWithin(m.location::geography, ST_Centroid(g.geometry)::geography, 300))
          AND (SELECT count(*) FROM mapped m WHERE m.domain = sc.domain) < 3
    ) w
    ORDER BY id, company_number
),
domain_company AS (
    SELECT domain, CASE WHEN count(*) = 1 THEN min(company_number) END AS company_number
    FROM agency_site_company
    GROUP BY domain
)
SELECT o.id, o.name, o.brand, o.website, o.domain, o.location, o.sources, o.confidence, d.company_number
FROM (SELECT * FROM mapped UNION ALL SELECT * FROM from_website) o
LEFT JOIN domain_company d ON d.domain = o.domain
WHERE NOT EXISTS (SELECT 1 FROM agency_opt_out x
                  WHERE x.scope = 'everything' AND (x.place_id = o.id OR x.domain = o.domain));
