-- Kids layers for the area card's "Kids" tiles (api/area_api/kids.py), loaded by
-- deploy/tools/etl_kids.py:
--
--   nursery_setting  Ofsted Early Years management information: London childcare on
--                    non-domestic premises on the Early Years Register (childminders are
--                    left out: Ofsted withholds their addresses). Located at the mean of
--                    the postcode's addresses, else its LSOA's point on surface. well_rated: Good or Outstanding under the
--                    old framework, or a report card with safeguarding met and no area
--                    graded below "Expected standard"; null when not yet inspected.
--   road_casualty    DfT STATS19, the five-year file: London pedestrian and cyclist
--                    casualties at the collision's point. No names, no vehicles.
--   cycle_lane       TfL Cycling Infrastructure Database lanes and tracks (kind
--                    'protected' when segregated or stepped, else 'lane') and the open
--                    TfL Cycleways routes (kind 'cycleway').
--   area_kids        per LSOA and MSOA, around its point on surface: rated nurseries
--                    within 1 km and how many are well rated (ranked: almost all are,
--                    so the share hardly differs between areas); pedestrian and cyclist
--                    casualties within 500 m by year; km of protected lane and of
--                    Cycleway within 1 km (ranked on the two together). Each rank is a
--                    percent_rank 0-100 among areas of the same kind (lowest value = 0).
--
-- Geometry is British National Grid (27700) so radii are plain metres.
-- Derived, so rebuilt rather than loaded: rebuild_area_kids() after each load.
-- Own table, never area_london_rank: the Kids theme keeps its own percentiles.

CREATE TABLE IF NOT EXISTS nursery_setting (
    urn text PRIMARY KEY,
    name text NOT NULL,
    postcode text NOT NULL,
    places integer CHECK (places IS NULL OR places >= 0),
    framework text CHECK (framework IN ('report-card', 'overall-effectiveness')),
    grade text,
    inspection_date date,
    well_rated boolean,
    location geometry(Point, 27700) NOT NULL,
    place_id text,
    source_release_id text NOT NULL REFERENCES source_release(id)
);
CREATE INDEX IF NOT EXISTS nursery_setting_gix ON nursery_setting USING gist (location);

CREATE TABLE IF NOT EXISTS road_casualty (
    collision_index text NOT NULL,
    casualty_reference integer NOT NULL,
    year smallint NOT NULL,
    severity smallint NOT NULL CHECK (severity IN (1, 2, 3)),  -- 1 fatal, 2 serious, 3 slight
    road_user text NOT NULL CHECK (road_user IN ('pedestrian', 'cyclist')),
    child boolean NOT NULL,  -- aged 0-15
    location geometry(Point, 27700) NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (collision_index, casualty_reference)
);
CREATE INDEX IF NOT EXISTS road_casualty_gix ON road_casualty USING gist (location);

CREATE TABLE IF NOT EXISTS cycle_lane (
    id text PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('protected', 'lane', 'cycleway')),
    name text,
    geometry geometry(Geometry, 27700) NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id)
);
CREATE INDEX IF NOT EXISTS cycle_lane_gix ON cycle_lane USING gist (geometry);

CREATE TABLE IF NOT EXISTS area_kids (
    geography_id text PRIMARY KEY REFERENCES area_geography(id) ON DELETE CASCADE,
    nursery_rated integer NOT NULL,
    nursery_good integer NOT NULL,
    nursery_share real,  -- null below 3 rated nurseries
    nursery_percentile smallint CHECK (nursery_percentile BETWEEN 0 AND 100),
    casualty_first_year smallint,
    casualties_by_year integer[] NOT NULL,
    casualties integer NOT NULL,
    child_casualties integer NOT NULL,
    serious_casualties integer NOT NULL,  -- killed or seriously injured
    cyclist_casualties integer NOT NULL,
    casualty_percentile smallint CHECK (casualty_percentile BETWEEN 0 AND 100),
    protected_km real NOT NULL,
    cycleway_km real NOT NULL,
    cycle_percentile smallint CHECK (cycle_percentile BETWEEN 0 AND 100),  -- protected + Cycleway km
    source_release_ids text[] NOT NULL
);

CREATE OR REPLACE FUNCTION public.rebuild_area_kids()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    first_year smallint := (SELECT min(year) FROM road_casualty);
    years integer := coalesce((SELECT max(year) - min(year) + 1 FROM road_casualty), 0);
    sources text[] := ARRAY(
        SELECT DISTINCT s FROM (
            SELECT source_release_id AS s FROM nursery_setting
            UNION SELECT source_release_id FROM road_casualty
            UNION SELECT source_release_id FROM cycle_lane) u ORDER BY 1);
    written integer;
BEGIN
    DELETE FROM area_kids;
    WITH area AS (
        SELECT g.id, g.kind, ST_Transform(ST_PointOnSurface(g.geometry), 27700) AS point
        FROM area_geography g WHERE g.kind IN ('lsoa', 'msoa')
    ), nursery AS (
        SELECT a.id, count(n.urn) FILTER (WHERE n.well_rated IS NOT NULL) AS rated,
               count(n.urn) FILTER (WHERE n.well_rated) AS good
        FROM area a LEFT JOIN nursery_setting n ON ST_DWithin(n.location, a.point, 1000)
        GROUP BY a.id
    ), pair AS (
        SELECT a.id, c.year, c.child, c.severity, c.road_user
        FROM area a JOIN road_casualty c ON ST_DWithin(c.location, a.point, 500)
    ), yearly AS (
        SELECT a.id, array_agg(coalesce(p.n, 0)::integer ORDER BY s.year) AS by_year
        FROM area a
        CROSS JOIN generate_series(first_year, first_year + years - 1) AS s(year)
        LEFT JOIN (SELECT id, year, count(*) AS n FROM pair GROUP BY id, year) p
          ON p.id = a.id AND p.year = s.year
        GROUP BY a.id
    ), casualty AS (
        SELECT a.id, coalesce(y.by_year, '{}') AS by_year,
               count(p.id) AS total,
               count(p.id) FILTER (WHERE p.child) AS child,
               count(p.id) FILTER (WHERE p.severity < 3) AS serious,
               count(p.id) FILTER (WHERE p.road_user = 'cyclist') AS cyclist
        FROM area a LEFT JOIN pair p USING (id) LEFT JOIN yearly y USING (id)
        GROUP BY a.id, y.by_year
    ), lane AS (
        SELECT a.id,
               coalesce(sum(ST_Length(ST_Intersection(l.geometry, ST_Buffer(a.point, 1000))))
                        FILTER (WHERE l.kind = 'protected'), 0) / 1000 AS protected_km,
               coalesce(sum(ST_Length(ST_Intersection(l.geometry, ST_Buffer(a.point, 1000))))
                        FILTER (WHERE l.kind = 'cycleway'), 0) / 1000 AS cycleway_km
        FROM area a LEFT JOIN cycle_lane l ON ST_DWithin(l.geometry, a.point, 1000)
        GROUP BY a.id
    ), joined AS (
        SELECT a.id, a.kind, n.rated, n.good,
               CASE WHEN n.rated >= 3 THEN round(100.0 * n.good / n.rated, 1) END AS share,
               c.by_year, c.total, c.child, c.serious, c.cyclist,
               round(lane.protected_km::numeric, 2) AS protected_km,
               round(lane.cycleway_km::numeric, 2) AS cycleway_km
        FROM area a JOIN nursery n USING (id) JOIN casualty c USING (id) JOIN lane USING (id)
    )
    INSERT INTO area_kids
    SELECT j.id, j.rated, j.good, j.share,
           round(100 * percent_rank() OVER (PARTITION BY j.kind ORDER BY j.good)),
           first_year, j.by_year, j.total, j.child, j.serious, j.cyclist,
           CASE WHEN years > 0 THEN round(100 * percent_rank() OVER (PARTITION BY j.kind ORDER BY j.total)) END,
           j.protected_km, j.cycleway_km,
           round(100 * percent_rank() OVER (PARTITION BY j.kind ORDER BY j.protected_km + j.cycleway_km)),
           sources
    FROM joined j;
    GET DIAGNOSTICS written = ROW_COUNT;
    RETURN written;
END;
$$;

-- Cycle lanes for the map (`cycle_lanes`, zoom 11+, empty below): kind and name only.
CREATE OR REPLACE FUNCTION public.cycle_lane_tile(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE plpgsql
STABLE PARALLEL SAFE
AS $$
DECLARE
    bounds geometry := ST_TileEnvelope(z, x, y);
    tile bytea;
BEGIN
    IF z < 11 THEN
        RETURN NULL;
    END IF;
    SELECT ST_AsMVT(f, 'cycle_lanes', 4096, 'geom') INTO tile FROM (
        SELECT ST_AsMVTGeom(ST_Transform(l.geometry, 3857), bounds, 4096, 64, true) AS geom, l.kind, l.name
        FROM cycle_lane l
        WHERE l.geometry && ST_Transform(bounds, 27700)
          AND (z >= 13 OR l.kind <> 'lane')
    ) f WHERE f.geom IS NOT NULL;
    RETURN tile;
END;
$$;
