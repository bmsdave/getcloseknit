-- Quick My match criteria from data we already hold (deploy/tools/etl_quick_criteria.py).
--
-- area_epc_rating: per LSOA, homes with an EPC on record and how many are rated A-C. Derived
-- from property_epc joined to property (UPRN -> LSOA), so it carries the EPC source release and
-- is served under the same product release membership.
CREATE TABLE IF NOT EXISTS area_epc_rating (
    geography_id text NOT NULL REFERENCES area_geography(id),
    homes_rated integer NOT NULL CHECK (homes_rated >= 0),
    rated_a_to_c integer NOT NULL CHECK (rated_a_to_c >= 0 AND rated_a_to_c <= homes_rated),
    share_a_to_c real CHECK (share_a_to_c BETWEEN 0 AND 1),
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (geography_id, source_release_id)
);

-- Step-free stations: TfL StopPoint accessibility ("AccessViaLift") for the station or one of its
-- entrances, plus every DLR station and tram stop. NULL = not known (no lift can still mean level
-- access), never "has steps".
ALTER TABLE place_station ADD COLUMN IF NOT EXISTS step_free boolean;
CREATE INDEX IF NOT EXISTS place_station_step_free_geog_gix ON place_station USING gist ((location::geography))
    WHERE step_free;

-- Rebuilt after each EPC load (etl_epc.py load) and by etl_quick_criteria.py epc. An area with
-- fewer than 30 rated homes keeps its counts but no share (too few certificates to compare).
CREATE OR REPLACE FUNCTION rebuild_area_epc_rating(source text) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
    loaded integer;
BEGIN
    DELETE FROM area_epc_rating;
    INSERT INTO area_epc_rating (geography_id, homes_rated, rated_a_to_c, share_a_to_c, source_release_id)
    SELECT p.geography_id, count(*), count(*) FILTER (WHERE e.current_rating IN ('A', 'B', 'C')),
           CASE WHEN count(*) >= 30
                THEN (count(*) FILTER (WHERE e.current_rating IN ('A', 'B', 'C')))::real / count(*) END,
           source
    FROM property_epc e
    JOIN property p ON p.uprn = e.uprn
    JOIN area_geography g ON g.id = p.geography_id AND g.kind = 'lsoa'
    WHERE e.source_release_id = source AND e.current_rating IS NOT NULL
    GROUP BY p.geography_id;
    GET DIAGNOSTICS loaded = ROW_COUNT;
    RETURN loaded;
END
$$;
