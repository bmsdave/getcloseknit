-- Fix #190: the noise data includes aircraft, the repo schema did not.
--
-- The live release (src-defra-noise-round4-2022-road-rail-air) merges Defra
-- airport noise into area_noise: e.g. Richmond 006A shows any55Share 0.89
-- while road (0.386) and rail (0.15) alone cap the union at 0.536. The API
-- already reads n.air_55_share (api/area_api/quick_criteria.py NOISE_SQL),
-- which 009 never created. This migration adds the column, stores per-home
-- aircraft levels, and folds aircraft into the "loudest of" aggregates.
--
-- The air-inclusive Defra load itself is built prod-side (see
-- RELEASE-CHECKLIST 6p and deploy/tools/etl_noise.py: aircraft tiles are
-- optional there); the repo schema simply carries the levels once present.
--
-- NOTE: this file replaces rebuild_area_noise wholesale, so it is written
-- self-contained: it includes the 090 road-median fix (median over mapped
-- homes only, null when under half are mapped) and stays correct whether or
-- not 090 lands.
--
-- No automatic rebuild here: rebuilding without the aircraft load would zero
-- the air-inclusive shares on databases whose dwelling_noise has no
-- aircraft_lden. The next etl_noise.py load rebuilds.

ALTER TABLE dwelling_noise ADD COLUMN IF NOT EXISTS aircraft_lden real;
ALTER TABLE area_noise ADD COLUMN IF NOT EXISTS air_55_share real;
-- Self-contained: rebuild_area_noise below writes the 090 column too.
ALTER TABLE area_noise ADD COLUMN IF NOT EXISTS road_lden_mapped_share real;

-- Aggregate dwelling levels to LSOAs, MSOAs and boroughs (the dwelling's
-- LSOA and its parents). Shares are over every dwelling with a point.
CREATE OR REPLACE FUNCTION public.rebuild_area_noise(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE affected integer;
BEGIN
    DELETE FROM area_noise;
    INSERT INTO area_noise (geography_id, dwellings, road_55_share, rail_55_share, air_55_share,
        any_55_share, any_65_share, road_lden_median, road_lden_mapped_share, source_release_id)
    WITH homes AS (
        SELECT l.id AS lsoa, l.parent_id AS msoa, m.parent_id AS borough, n.road_lden, n.rail_lden,
               n.aircraft_lden,
               GREATEST(coalesce(n.road_lden, 0), coalesce(n.rail_lden, 0),
                        coalesce(n.aircraft_lden, 0)) AS loudest
        FROM dwelling_noise n
        JOIN property p ON p.uprn = n.uprn
        JOIN area_geography l ON l.id = p.geography_id
        JOIN area_geography m ON m.id = l.parent_id
    ), levels AS (
        SELECT lsoa AS geography_id, * FROM homes
        UNION ALL SELECT msoa, * FROM homes
        UNION ALL SELECT borough, * FROM homes
    )
    SELECT geography_id, count(*),
           round((avg((coalesce(road_lden, 0) >= 55)::int))::numeric, 3),
           round((avg((coalesce(rail_lden, 0) >= 55)::int))::numeric, 3),
           round((avg((coalesce(aircraft_lden, 0) >= 55)::int))::numeric, 3),
           round((avg((loudest >= 55)::int))::numeric, 3),
           round((avg((loudest >= 65)::int))::numeric, 3),
           CASE WHEN avg((road_lden IS NOT NULL)::int) >= 0.5
                THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY road_lden)
                     FILTER (WHERE road_lden IS NOT NULL) END,
           round((avg((road_lden IS NOT NULL)::int))::numeric, 3),
           p_source_release_id
    FROM levels GROUP BY geography_id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$;
