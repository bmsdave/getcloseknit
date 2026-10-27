-- London ranks for the area card's Overview ratings (docs/area-card-2026-10/spec.md §2):
-- each London LSOA's place among all London LSOAs (or, for schools, its best
-- nearby primary's place among London primaries), as percent_rank 0-100 over
-- the raw value, lowest value = 0. Read by area_api/places.py (`london_ranks`)
-- into the area-profile.v1 payload.
--
--   quiet          area_noise.any_55_share: share of homes at 55 dB Lden or more (lower is better)
--   park-distance  metres from the LSOA's point on surface to the nearest place_park (lower is better)
--   station-walk   median minutes walk to a station, metric `station-access` (lower is better;
--                  reuses that metric's stored ascending london_percentile)
--   best-primary   among state primaries within 1 km of the point on surface, the one with the
--                  highest share at the expected standard in reading, writing and maths (KS2,
--                  latest year with a cohort of 30+, as personal_places.top_schools ranks them);
--                  the percentile is that school's among London primaries (higher is better)
--
-- An LSOA with no data for a rank has no row: the API says null, never a guess.
-- Derived, so rebuilt rather than loaded: stage_release.stage() calls
-- rebuild_area_london_rank() before activating each release; run it by hand
-- after loading noise, parks, schools or station access outside a release.
-- source_release_id has no foreign key: the school row names the KS2
-- observation's release, which lives in the school's attributes JSON.

CREATE TABLE IF NOT EXISTS area_london_rank (
    geography_id text NOT NULL REFERENCES area_geography(id) ON DELETE CASCADE,
    rank_id text NOT NULL CHECK (rank_id IN ('quiet', 'park-distance', 'station-walk', 'best-primary')),
    value real NOT NULL,
    london_percentile smallint NOT NULL CHECK (london_percentile BETWEEN 0 AND 100),
    ranked integer NOT NULL CHECK (ranked > 0),  -- how many LSOAs (or primaries) were ranked
    detail jsonb,
    source_release_id text,
    PRIMARY KEY (geography_id, rank_id)
);

CREATE OR REPLACE FUNCTION public.rebuild_area_london_rank()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE total integer := 0; affected integer;
BEGIN
    DELETE FROM area_london_rank;

    INSERT INTO area_london_rank (geography_id, rank_id, value, london_percentile, ranked, source_release_id)
    SELECT n.geography_id, 'quiet', n.any_55_share,
           round(100 * percent_rank() OVER (ORDER BY n.any_55_share))::smallint, count(*) OVER (),
           n.source_release_id
    FROM area_noise n JOIN area_geography g ON g.id = n.geography_id AND g.kind = 'lsoa'
    WHERE n.any_55_share IS NOT NULL;
    GET DIAGNOSTICS affected = ROW_COUNT; total := total + affected;

    INSERT INTO area_london_rank (geography_id, rank_id, value, london_percentile, ranked, source_release_id)
    -- The station-access ETL already stores an ascending London LSOA percentile: reuse it.
    SELECT walk.geography_id, 'station-walk', walk.value, walk.london_percentile, count(*) OVER (),
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
           round(100 * percent_rank() OVER (ORDER BY park.metres))::smallint, count(*) OVER (),
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

    -- Primaries ranked as personal_places.top_schools does: latest year, cohort 30+, not suppressed.
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
    ), ranked AS (
        SELECT latest.*, round(100 * percent_rank() OVER (ORDER BY value))::smallint AS pct,
               count(*) OVER () AS schools
        FROM latest
    )
    SELECT DISTINCT ON (area.id) area.id, 'best-primary', r.value, r.pct, r.schools,
           jsonb_build_object('urn', r.urn, 'name', r.name, 'academicYear', r.academic_year,
                              'distanceMetres', round(ST_Distance(r.location::geography, area.point))::integer),
           r.source_release_id
    FROM (SELECT g.id, ST_PointOnSurface(g.geometry) AS geom, ST_PointOnSurface(g.geometry)::geography AS point
          FROM area_geography g WHERE g.kind = 'lsoa') area
    JOIN ranked r ON r.location && ST_Expand(area.geom, 0.02)  -- ~1.4-2.2 km box, then exact metres
                 AND ST_DWithin(r.location::geography, area.point, 1000)
    ORDER BY area.id, r.value DESC, ST_Distance(r.location::geography, area.point), r.urn;
    GET DIAGNOSTICS affected = ROW_COUNT; total := total + affected;

    RETURN total;
END;
$$;

SELECT rebuild_area_london_rank();
