-- 042: London street names for street-level search, loaded by
-- pipelines/area-analytics-ingest/area_analytics/streets.py from OS Open Names (OGL v3).
--
-- The address table (003) only holds homes with a recorded HMLR sale, so a home that never
-- sold cannot be found by its address. A full address list needs a paid licence (OS
-- AddressBase or Royal Mail PAF), and EPC address fields are licensed for energy-performance
-- use only. Open Names gives every named road with a point near its middle, so search can find
-- the street and the area around it, never a particular home. One road can have several rows
-- (Open Names splits roads by postcode district and settlement).
-- Safe to run again.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS street (
    id text PRIMARY KEY,                        -- Open Names id, e.g. osgb4000000074553829
    name text NOT NULL,
    locality text,                              -- Open Names populated place, e.g. Kenley
    postcode_district text,                     -- outward code, e.g. CR8
    easting integer NOT NULL CHECK (easting > 0),
    northing integer NOT NULL CHECK (northing > 0),
    geography_id text NOT NULL REFERENCES area_geography(id),  -- LSOA containing the point
    borough_id text NOT NULL REFERENCES area_geography(id),
    source_release_id text NOT NULL REFERENCES source_release(id)
);

CREATE INDEX IF NOT EXISTS street_name_trgm_idx ON street USING gin (name gin_trgm_ops);
