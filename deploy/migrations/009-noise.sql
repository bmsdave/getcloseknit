-- Strategic noise (Defra Round 4, 2022): modelled road and rail Lden at each
-- dwelling's OS Open UPRN point, and per-LSOA shares of dwellings above the
-- WHO/END reference levels. Levels under the 40 dB mapping threshold are NULL.

CREATE TABLE dwelling_noise (
    uprn text PRIMARY KEY,
    road_lden real,
    rail_lden real,
    source_release_id text NOT NULL REFERENCES source_release(id)
);

CREATE TABLE area_noise (
    geography_id text PRIMARY KEY,
    dwellings integer NOT NULL CHECK (dwellings >= 0),
    road_55_share real,
    rail_55_share real,
    any_55_share real,
    any_65_share real,
    road_lden_median real,
    source_release_id text NOT NULL REFERENCES source_release(id)
);

-- Aggregate dwelling levels to LSOAs, MSOAs and boroughs (the dwelling's
-- LSOA and its parents). Shares are over every dwelling with a point.
CREATE OR REPLACE FUNCTION public.rebuild_area_noise(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE affected integer;
BEGIN
    DELETE FROM area_noise;
    INSERT INTO area_noise (geography_id, dwellings, road_55_share, rail_55_share, any_55_share,
        any_65_share, road_lden_median, source_release_id)
    WITH homes AS (
        SELECT l.id AS lsoa, l.parent_id AS msoa, m.parent_id AS borough, n.road_lden, n.rail_lden,
               GREATEST(coalesce(n.road_lden, 0), coalesce(n.rail_lden, 0)) AS loudest
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
           round((avg((loudest >= 55)::int))::numeric, 3),
           round((avg((loudest >= 65)::int))::numeric, 3),
           percentile_cont(0.5) WITHIN GROUP (ORDER BY coalesce(road_lden, 0)),
           p_source_release_id
    FROM levels GROUP BY geography_id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$;
