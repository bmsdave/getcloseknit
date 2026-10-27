-- 065: every road casualty in London for the "Road collisions" map overlay, loaded by
-- deploy/tools/etl_kids.py from the same DfT STATS19 five-year files as road_casualty (OGL v3).
--
--   collision_casualty  one row per person hurt: year, severity, who they were (road_user), child
--                       (0-15), age band, whether it was dark, at the collision's point. No date,
--                       time, sex or vehicle: a child at an exact point on a known day can identify
--                       a family, so the map shows the year and the age band only.
--
-- road_casualty (migration 062) keeps pedestrians and cyclists for the Kids tile; this table is the
-- map's. Safe to run again.

CREATE TABLE IF NOT EXISTS collision_casualty (
    collision_index text NOT NULL,
    casualty_reference integer NOT NULL,
    year smallint NOT NULL,
    severity smallint NOT NULL CHECK (severity IN (1, 2, 3)),  -- 1 killed, 2 serious, 3 slight
    road_user text NOT NULL CHECK (road_user IN
        ('pedestrian', 'cyclist', 'escooter', 'motorcycle', 'car', 'bus', 'goods', 'other')),
    child boolean NOT NULL,          -- aged 0-15
    age_band text,                   -- '0-5' ... '75+', null when not recorded
    dark boolean,                    -- null when the light was not recorded
    location geometry(Point, 27700) NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (collision_index, casualty_reference)
);
CREATE INDEX IF NOT EXISTS collision_casualty_location_idx ON collision_casualty USING gist (location);

-- Vector tiles (`collisions`, zoom 10+). Below zoom 13 casualties sharing a cell (~1.2 km at zoom 10, ~600 m at
-- 11, ~150 m at 12) and the same severity, road user and child are one feature with n = how many, for the
-- heatmap; a London tile stays at 150-250 KB. From zoom 13 each casualty is its own point (n = 1) with its
-- year, light and age band too, so year and light filter the street view only. The map filters on these fields.
CREATE OR REPLACE FUNCTION public.collision_tile(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE plpgsql
STABLE PARALLEL SAFE
AS $$
DECLARE
    bounds geometry := ST_TileEnvelope(z, x, y);
    cell double precision := (ST_XMax(bounds) - ST_XMin(bounds)) / CASE WHEN z < 12 THEN 32 ELSE 64 END;
    tile bytea;
BEGIN
    IF z < 10 THEN
        RETURN NULL;
    END IF;
    IF z < 13 THEN
        SELECT ST_AsMVT(f, 'collisions', 4096, 'geom') INTO tile FROM (
            SELECT ST_AsMVTGeom(ST_SnapToGrid(ST_Transform(c.location, 3857), cell), bounds, 4096, 64, true) AS geom,
                   c.severity, c.road_user, c.child, count(*)::integer AS n
            FROM collision_casualty c
            WHERE c.location && ST_Transform(bounds, 27700)
            GROUP BY 1, 2, 3, 4
        ) f WHERE f.geom IS NOT NULL;
    ELSE
        SELECT ST_AsMVT(f, 'collisions', 4096, 'geom') INTO tile FROM (
            SELECT ST_AsMVTGeom(ST_Transform(c.location, 3857), bounds, 4096, 64, true) AS geom,
                   c.year, c.severity, c.road_user, c.child, c.dark, c.age_band, 1 AS n
            FROM collision_casualty c
            WHERE c.location && ST_Transform(bounds, 27700)
        ) f WHERE f.geom IS NOT NULL;
    END IF;
    RETURN tile;
END;
$$;
