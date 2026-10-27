-- Fix #187: the road Lden median counted unmapped homes as 0 dB.
--
-- Defra does not map levels under 40 dB Lden (NULL in dwelling_noise). The
-- old rebuild_area_noise computed the median as percentile_cont(0.5) ORDER BY
-- coalesce(road_lden, 0), so every unmapped home entered as 0 dB: [null, null,
-- 52, 55] read "Median 26 dB", and any LSOA with more than half its homes
-- unmapped read "Median 0 dB". The median now covers mapped homes only
-- (percentile_cont ignores NULLs) and is NULL when under half the homes are
-- mapped; road_lden_mapped_share reports the mapped share. The 55 dB shares
-- are untouched: coalesce(..., 0) >= 55 is false for unmapped homes, the
-- intended "not loud".

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
    INSERT INTO area_noise (geography_id, dwellings, road_55_share, rail_55_share, any_55_share,
        any_65_share, road_lden_median, road_lden_mapped_share, source_release_id)
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

-- Rebuild existing rows with the current source release (no-op on an empty table).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM area_noise) THEN
        PERFORM rebuild_area_noise((SELECT source_release_id FROM area_noise LIMIT 1));
    END IF;
END;
$$;
