-- Civic geography and local government (track J), loaded by
-- pipelines/area-analytics-ingest/area_analytics/civic.py:
--   postcode_civic   every London postcode in the ONS Postcode Directory with
--                    the areas it sits in (ward, borough, constituency, ...)
--   civic_name       names for those area codes
--   council_tax      average council tax per band A-H for each London borough
--   representative   ward councillors (Democracy Club) and MPs (UK Parliament)
-- An LSOA, MSOA or borough is linked to wards and constituencies through the
-- live postcodes inside it, so an area that straddles a boundary lists both.

CREATE TABLE postcode_civic (
    postcode text PRIMARY KEY,               -- "SW1A 1AA" (ONSPD pcds)
    introduced date NOT NULL,                -- first day of the month ONS gives
    terminated date,                         -- NULL while the postcode is live
    country_code text NOT NULL,
    region_code text NOT NULL,
    borough_code text NOT NULL,              -- lad26cd
    ward_code text,                          -- wd26cd
    parish_code text,                        -- parncp26cd (NULL when unparished)
    constituency_code text,                  -- pcon24cd
    police_code text,                        -- pfa23cd
    msoa_code text,                          -- msoa21cd
    lsoa_code text,                          -- lsoa21cd
    source_release_id text NOT NULL REFERENCES source_release(id)
);
CREATE INDEX postcode_civic_lsoa ON postcode_civic (lsoa_code) WHERE terminated IS NULL;
CREATE INDEX postcode_civic_msoa ON postcode_civic (msoa_code) WHERE terminated IS NULL;
CREATE INDEX postcode_civic_borough ON postcode_civic (borough_code) WHERE terminated IS NULL;

CREATE TABLE civic_name (
    code text PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('country', 'region', 'borough', 'ward', 'parish',
        'constituency', 'police', 'msoa', 'lsoa')),
    name text NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id)
);

-- Average Band D for the borough's area (borough + GLA + any parish precept),
-- and the statutory ratios of Band D for the other bands (6/9 ... 18/9).
CREATE TABLE council_tax (
    borough_code text NOT NULL,
    financial_year text NOT NULL,            -- "2026-27"
    band_d_borough numeric(8, 2),            -- the borough's own share
    band_d_gla numeric(8, 2),                -- Greater London Authority precept
    band_a numeric(8, 2) NOT NULL,
    band_b numeric(8, 2) NOT NULL,
    band_c numeric(8, 2) NOT NULL,
    band_d numeric(8, 2) NOT NULL,
    band_e numeric(8, 2) NOT NULL,
    band_f numeric(8, 2) NOT NULL,
    band_g numeric(8, 2) NOT NULL,
    band_h numeric(8, 2) NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (borough_code, financial_year)
);

CREATE TABLE representative (
    role text NOT NULL CHECK (role IN ('councillor', 'mp')),
    area_code text NOT NULL,                 -- ward GSS for councillors, constituency GSS for MPs
    name text NOT NULL,
    party text,
    elected_on date,
    profile_url text,
    fetched_on date NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (role, area_code, name)
);
