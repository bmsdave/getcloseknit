-- 115: fixes after the England deploy (2026-10-22). Safe to run again; apply with psql -1 -v ON_ERROR_STOP=1.
--
-- metric_value_metric_release_period_idx   the index prod got by hand on 2026-10-22: the metric catalogue
--     (evidence.METRICS_SQL) lists each metric's periods per release; without it a cold catalogue took ~28 s
--     on prod's 9M+ rows and ran into the statement timeout (503).
-- rebuild_area_london_rank()   as 103, except best-primary: the best primary within 1 km may be across a region
--     border (London LSOAs by Herts, Kent...), and its percentile is now the share of the AREA's region's ranked
--     primaries below it, with that region's pool size, never the school's region's (decision 2). An area whose
--     best school is in its own region keeps the school's percent_rank, as before.
--
-- After applying on a loaded database: SELECT rebuild_area_london_rank(); SELECT rebuild_area_good_value();
-- (bundles/fix-ranks/load.sql.gz does both in one transaction).

CREATE INDEX IF NOT EXISTS metric_value_metric_release_period_idx
    ON metric_value (metric_id, source_release_id, period);

-- from 103-england-geography.sql (best-primary ranked within the area's region)
CREATE OR REPLACE FUNCTION public.rebuild_area_london_rank()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE total integer := 0; affected integer;
BEGIN
    DELETE FROM area_london_rank;

    INSERT INTO area_london_rank (geography_id, rank_id, value, london_percentile, ranked, source_release_id)
    SELECT n.geography_id, 'quiet', n.any_55_share,
           round(100 * percent_rank() OVER (PARTITION BY area_rank_region(n.geography_id) ORDER BY n.any_55_share))::smallint,
           count(*) OVER (PARTITION BY area_rank_region(n.geography_id)),
           n.source_release_id
    FROM area_noise n JOIN area_geography g ON g.id = n.geography_id AND g.kind = 'lsoa'
    WHERE n.any_55_share IS NOT NULL;
    GET DIAGNOSTICS affected = ROW_COUNT; total := total + affected;

    INSERT INTO area_london_rank (geography_id, rank_id, value, london_percentile, ranked, source_release_id)
    -- The station-access ETL already stores an ascending LSOA percentile within the region: reuse it.
    SELECT walk.geography_id, 'station-walk', walk.value, walk.london_percentile,
           count(*) OVER (PARTITION BY area_rank_region(walk.geography_id)),
           walk.source_release_id
    FROM (
        SELECT DISTINCT ON (mv.geography_id) mv.geography_id, mv.value, mv.london_percentile, mv.source_release_id
        FROM metric_value mv JOIN area_geography g ON g.id = mv.geography_id AND g.kind = 'lsoa'
        WHERE mv.metric_id = 'station-access' AND mv.value IS NOT NULL AND mv.london_percentile IS NOT NULL
        ORDER BY mv.geography_id, mv.period DESC
    ) walk;
    GET DIAGNOSTICS affected = ROW_COUNT; total := total + affected;

    -- Nearest park as personal_places.NEAREST_PARK_SQL finds it (geography KNN, exact metres).
    INSERT INTO area_london_rank (geography_id, rank_id, value, london_percentile, ranked, source_release_id)
    SELECT park.geography_id, 'park-distance', park.metres,
           round(100 * percent_rank() OVER (PARTITION BY area_rank_region(park.geography_id) ORDER BY park.metres))::smallint,
           count(*) OVER (PARTITION BY area_rank_region(park.geography_id)),
           park.source_release_id
    FROM (
        SELECT area.id AS geography_id, nearest.metres, nearest.source_release_id
        FROM (SELECT g.id, ST_PointOnSurface(g.geometry)::geography AS point
              FROM area_geography g WHERE g.kind = 'lsoa') area
        CROSS JOIN LATERAL (
            SELECT round(ST_Distance(p.geometry::geography, area.point)) AS metres, p.source_release_id
            FROM place_park p ORDER BY p.geometry::geography <-> area.point LIMIT 1
        ) nearest
    ) park;
    GET DIAGNOSTICS affected = ROW_COUNT; total := total + affected;

    -- Primaries as personal_places.top_schools reads them: latest year, cohort 30+, not suppressed. The area's best
    -- within 1 km may stand across a region border; its percentile is always within the AREA's region (decision 2):
    -- the share of that region's ranked primaries below it, the school's own percent_rank when it is in the region.
    INSERT INTO area_london_rank (geography_id, rank_id, value, london_percentile, ranked, detail,
                                  source_release_id)
    WITH latest AS (
        SELECT DISTINCT ON (s.urn) s.urn, s.name, s.location, (o->>'value')::real AS value,
               o->>'academicYear' AS academic_year, o->>'sourceRelease' AS source_release_id
        FROM school s
        CROSS JOIN LATERAL jsonb_array_elements(coalesce(s.attributes->'observations', '[]'::jsonb)) o
        WHERE s.phase = 'primary'
          AND o->>'measure' = 'Expected standard in reading, writing and maths (%)'
          AND jsonb_typeof(o->'value') = 'number'
          AND coalesce((o->>'cohortSize')::numeric, 0) >= 30
          AND NOT coalesce((o->>'suppressed')::boolean, false)
        ORDER BY s.urn, o->>'academicYear' DESC, (o->>'value')::real DESC
    ), located AS (
        SELECT latest.*, point_rank_region(latest.location) AS region FROM latest
    ), ranked AS (
        SELECT located.*, round(100 * percent_rank() OVER (PARTITION BY region ORDER BY value))::smallint AS pct
        FROM located
    ), pool AS (
        SELECT region, count(*) AS schools FROM located GROUP BY region
    ), area AS (
        SELECT g.id, area_rank_region(g.id) AS region, ST_PointOnSurface(g.geometry) AS geom,
               ST_PointOnSurface(g.geometry)::geography AS point
        FROM area_geography g WHERE g.kind = 'lsoa'
    ), best AS (
        SELECT DISTINCT ON (area.id) area.id, area.region AS area_region, area.point, r.*
        FROM area
        JOIN ranked r ON r.location && ST_Expand(area.geom, 0.02)  -- ~1.4-2.2 km box, then exact metres
                     AND ST_DWithin(r.location::geography, area.point, 1000)
        ORDER BY area.id, r.value DESC, ST_Distance(r.location::geography, area.point), r.urn
    )
    SELECT best.id, 'best-primary', best.value,
           CASE WHEN best.region IS NOT DISTINCT FROM best.area_region THEN best.pct
                ELSE round(100 * least(1.0, (SELECT count(*) FROM located other
                                             WHERE other.region = pool.region AND other.value < best.value)::numeric
                                            / greatest(pool.schools - 1, 1)))::smallint END,
           pool.schools,
           jsonb_build_object('urn', best.urn, 'name', best.name, 'academicYear', best.academic_year,
                              'distanceMetres', round(ST_Distance(best.location::geography, best.point))::integer),
           best.source_release_id
    FROM best JOIN pool ON pool.region IS NOT DISTINCT FROM best.area_region;
    GET DIAGNOSTICS affected = ROW_COUNT; total := total + affected;

    RETURN total;
END;
$$;
