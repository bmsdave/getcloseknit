-- HMO and landlord licensing (open data sources wave A, source 8), loaded by deploy/tools/etl_hmo.py
-- from each borough's public HMO licence register (Housing Act 2004 s.232) and its licensing pages:
--   hmo_register      one row per London authority: whether its register was published in bulk,
--                     where, when, and how many licences were counted
--   hmo_postcode      licensed HMOs per postcode, from the registers' property postcodes only
--   area_hmo          per LSOA, MSOA and borough: licensed HMOs, Census 2021 households, per 1,000
--                     homes, and how many boroughs with a published register the area covers
--   licensing_scheme  additional (HMO) and selective licensing schemes; wards NULL = whole borough,
--                     '{}' with streets = a scheme on named streets
-- Counts by postcode and area only: names, licence holders and full addresses are never stored.
-- Areas in a borough with no published register have no area_hmo row ("not published", never zero).

CREATE TABLE IF NOT EXISTS hmo_register (
    borough_code text PRIMARY KEY CHECK (borough_code ~ '^E09[0-9]{6}$'),
    status text NOT NULL CHECK (status IN ('published', 'search-only', 'on-request', 'not-found', 'failed')),
    url text,
    page text,
    format text CHECK (format IN ('csv', 'xlsx', 'html', 'pdf')),
    licences integer CHECK (licences >= 0),          -- rows with a property postcode in the borough
    unmatched integer CHECK (unmatched >= 0),        -- rows without one (or outside the borough)
    updated date,                                    -- as the file says, when it says
    retrieved date,
    terms text,
    note text,
    source_release_id text NOT NULL REFERENCES source_release(id)
);

CREATE TABLE IF NOT EXISTS hmo_postcode (
    borough_code text NOT NULL REFERENCES hmo_register(borough_code) ON DELETE CASCADE,
    postcode text NOT NULL,                          -- "SW1A 1AA" (ONSPD pcds)
    licences integer NOT NULL CHECK (licences > 0),
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (borough_code, postcode)
);

CREATE TABLE IF NOT EXISTS area_hmo (
    geography_id text PRIMARY KEY REFERENCES area_geography(id) ON DELETE CASCADE,
    licensed_hmos integer NOT NULL CHECK (licensed_hmos >= 0),
    homes integer NOT NULL CHECK (homes >= 0),       -- Census 2021 households (TS044 total)
    per_1000_homes real CHECK (per_1000_homes >= 0), -- NULL when homes = 0
    boroughs_covered smallint NOT NULL CHECK (boroughs_covered >= 0),
    source_release_id text NOT NULL REFERENCES source_release(id)
);

CREATE TABLE IF NOT EXISTS licensing_scheme (
    id text PRIMARY KEY,                             -- "<borough_code>:<kind>:<n>"
    borough_code text NOT NULL CHECK (borough_code ~ '^E09[0-9]{6}$'),
    kind text NOT NULL CHECK (kind IN ('additional', 'selective')),
    wards text[],                                    -- ward codes (wd26cd); NULL = whole borough
    ward_names text[],                               -- as the council wrote them
    streets text[],                                  -- a scheme on named streets: wards '{}', these names
    start_date date,
    end_date date,
    url text NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id)
);
CREATE INDEX IF NOT EXISTS licensing_scheme_borough ON licensing_scheme (borough_code);

-- Rebuild area_hmo from hmo_postcode: postcodes to LSOAs through postcode_civic (live or terminated:
-- registers keep old postcodes), every LSOA of a published borough gets a row (zero when none), then
-- MSOAs and boroughs are sums of their LSOAs, so the levels agree.
CREATE OR REPLACE FUNCTION public.rebuild_area_hmo(p_source text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    n integer;
BEGIN
    DELETE FROM area_hmo;
    WITH pc AS (
        SELECT DISTINCT ON (postcode) postcode, lsoa_code
        FROM postcode_civic WHERE lsoa_code IS NOT NULL
        ORDER BY postcode, terminated DESC NULLS FIRST
    ), counted AS (
        SELECT 'uk:lsoa:' || pc.lsoa_code AS geography_id, sum(h.licences)::int AS licensed
        FROM hmo_postcode h JOIN pc ON pc.postcode = h.postcode
        GROUP BY 1
    ), homes AS (
        SELECT geography_id, sum(count)::int AS homes
        FROM area_census_count WHERE topic = 'accommodation' GROUP BY geography_id
    )
    INSERT INTO area_hmo (geography_id, licensed_hmos, homes, boroughs_covered, source_release_id)
    SELECT l.id, coalesce(c.licensed, 0), coalesce(h.homes, 0), 1, p_source
    FROM area_geography l
    JOIN area_geography m ON m.id = l.parent_id
    JOIN hmo_register r ON 'uk:borough:' || r.borough_code = m.parent_id AND r.status = 'published'
    LEFT JOIN counted c ON c.geography_id = l.id
    LEFT JOIN homes h ON h.geography_id = l.id
    WHERE l.kind = 'lsoa';

    INSERT INTO area_hmo (geography_id, licensed_hmos, homes, boroughs_covered, source_release_id)
    SELECT g.parent_id, sum(a.licensed_hmos), sum(a.homes), 1, p_source
    FROM area_hmo a JOIN area_geography g ON g.id = a.geography_id
    WHERE g.kind = 'lsoa' GROUP BY g.parent_id;
    INSERT INTO area_hmo (geography_id, licensed_hmos, homes, boroughs_covered, source_release_id)
    SELECT g.parent_id, sum(a.licensed_hmos), sum(a.homes), 1, p_source
    FROM area_hmo a JOIN area_geography g ON g.id = a.geography_id
    WHERE g.kind = 'msoa' GROUP BY g.parent_id;

    UPDATE area_hmo SET per_1000_homes = round((1000.0 * licensed_hmos / homes)::numeric, 2)
    WHERE homes > 0;
    SELECT count(*) INTO n FROM area_hmo;
    RETURN n;
END;
$$;

-- The `hmo-per-1000` map metric (MetricId, map-topics `homes-area`): its definition and one
-- metric_value row per LSOA. LSOAs of boroughs without a published register are `suppressed`
-- with no value, so the map shows them grey ("not published"), never zero.
CREATE OR REPLACE FUNCTION public.load_hmo_metric(p_source text, p_period date, p_definition jsonb)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    n integer;
BEGIN
    INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
    VALUES ('hmo-per-1000', 'lsoa', 'per 1,000 homes', 'higher-is-more', p_definition, p_source)
    ON CONFLICT (id) DO UPDATE SET unit = EXCLUDED.unit, direction = EXCLUDED.direction,
        definition = EXCLUDED.definition, source_release_id = EXCLUDED.source_release_id;
    DELETE FROM metric_value WHERE metric_id = 'hmo-per-1000';
    INSERT INTO metric_value (geography_id, metric_id, period, value, london_percentile, sample_count,
        quality, source_release_id)
    SELECT g.id, 'hmo-per-1000', p_period, a.per_1000_homes,
        CASE WHEN a.per_1000_homes IS NOT NULL
             THEN round(100 * percent_rank() OVER (PARTITION BY a.per_1000_homes IS NOT NULL
                                                   ORDER BY a.per_1000_homes))::smallint END,
        a.licensed_hmos,
        CASE WHEN a.per_1000_homes IS NULL THEN 'suppressed' ELSE 'observed' END::metric_quality,
        p_source
    FROM area_geography g LEFT JOIN area_hmo a ON a.geography_id = g.id
    WHERE g.kind = 'lsoa';
    SELECT count(*) INTO n FROM metric_value WHERE metric_id = 'hmo-per-1000';
    RETURN n;
END;
$$;
