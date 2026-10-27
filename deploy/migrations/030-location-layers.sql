-- Location layers (stream G3), loaded by
-- pipelines/area-analytics-ingest/area_analytics/location_layers.py:
--   conservation_area     Conservation Areas (GLA, London Datastore, OGL v3)
--   charge_zone           ULEZ and Congestion Charge zone boundaries (TfL open data)
--   planning_application  applications validated in the last 24 months, paperwork left
--                         out (Planning London Datahub, GLA, OGL v3)
--   area_location         per LSOA, MSOA and borough: land in a conservation area, in
--                         the ULEZ and in the Congestion Charge zone, and the planning
--                         applications in the window
--   area_conservation     which conservation areas cover each area, and how much
-- All geometry is British National Grid (27700). Places, never people.

CREATE TABLE conservation_area (
    id text PRIMARY KEY,                     -- "gla:<feature id>" (one area may be several features)
    name text NOT NULL,
    borough text,
    geom geometry(MultiPolygon, 27700) NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id)
);
CREATE INDEX conservation_area_geom_gix ON conservation_area USING gist (geom);

CREATE TABLE charge_zone (
    zone text PRIMARY KEY CHECK (zone IN ('ulez', 'congestion-charge')),
    geom geometry(MultiPolygon, 27700) NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id)
);

CREATE TABLE planning_application (
    id text PRIMARY KEY,                     -- Planning London Datahub id ("Islington-P2025_0271_FUL")
    valid_date date NOT NULL,
    application_type text NOT NULL,          -- application_type_full as published
    category text NOT NULL CHECK (category IN ('householder', 'full', 'prior-approval', 'other')),
    lat double precision NOT NULL,           -- the site's centroid as published (WGS84)
    lon double precision NOT NULL,
    location geometry(Point, 27700) GENERATED ALWAYS AS
        (ST_Transform(ST_SetSRID(ST_MakePoint(lon, lat), 4326), 27700)) STORED,
    source_release_id text NOT NULL REFERENCES source_release(id)
);
CREATE INDEX planning_application_location_gix ON planning_application USING gist (location);

CREATE TABLE area_location (
    geography_id text PRIMARY KEY REFERENCES area_geography(id),
    area_m2 double precision NOT NULL CHECK (area_m2 > 0),
    conservation_m2 double precision NOT NULL CHECK (conservation_m2 >= 0),
    ulez_m2 double precision NOT NULL CHECK (ulez_m2 >= 0),
    congestion_m2 double precision NOT NULL CHECK (congestion_m2 >= 0),
    planning_applications integer NOT NULL CHECK (planning_applications >= 0),
    planning_householder integer NOT NULL,
    planning_full integer NOT NULL,
    planning_prior_approval integer NOT NULL,
    planning_window_start date NOT NULL,
    planning_window_end date NOT NULL,
    conservation_release_id text REFERENCES source_release(id),
    zones_release_id text REFERENCES source_release(id),
    planning_release_id text REFERENCES source_release(id)
);

CREATE TABLE area_conservation (
    geography_id text NOT NULL REFERENCES area_geography(id),
    conservation_id text NOT NULL REFERENCES conservation_area(id) ON DELETE CASCADE,
    overlap_m2 double precision NOT NULL CHECK (overlap_m2 > 0),
    PRIMARY KEY (geography_id, conservation_id)
);

-- Rebuild area_location and area_conservation from the three layers. Each LSOA is
-- intersected once (layers cut into small pieces first); MSOAs and boroughs are sums
-- of the LSOAs they contain, so the levels always agree. Overlapping conservation
-- areas are unioned before measuring, so land is never counted twice.
CREATE OR REPLACE FUNCTION public.rebuild_area_location(p_window_start date, p_window_end date)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    n integer;
BEGIN
    CREATE TEMP TABLE location_lsoa ON COMMIT DROP AS
        SELECT id AS geography_id, parent_id, ST_Transform(geometry, 27700) AS geom
        FROM area_geography WHERE kind = 'lsoa';
    CREATE INDEX ON location_lsoa USING gist (geom);
    CREATE TEMP TABLE conservation_piece ON COMMIT DROP AS
        SELECT id, ST_Subdivide(geom, 128) AS geom FROM conservation_area;
    CREATE INDEX ON conservation_piece USING gist (geom);
    CREATE TEMP TABLE zone_piece ON COMMIT DROP AS
        SELECT zone, ST_Subdivide(geom, 128) AS geom FROM charge_zone;
    CREATE INDEX ON zone_piece USING gist (geom);
    ANALYZE location_lsoa;
    ANALYZE conservation_piece;
    ANALYZE zone_piece;

    DELETE FROM area_conservation;
    INSERT INTO area_conservation (geography_id, conservation_id, overlap_m2)
    SELECT l.geography_id, p.id, sum(ST_Area(ST_Intersection(l.geom, p.geom)))
    FROM location_lsoa l JOIN conservation_piece p ON ST_Intersects(l.geom, p.geom)
    GROUP BY l.geography_id, p.id
    HAVING sum(ST_Area(ST_Intersection(l.geom, p.geom))) > 0;

    DELETE FROM area_location;
    INSERT INTO area_location (geography_id, area_m2, conservation_m2, ulez_m2, congestion_m2,
        planning_applications, planning_householder, planning_full, planning_prior_approval,
        planning_window_start, planning_window_end, conservation_release_id, zones_release_id,
        planning_release_id)
    SELECT l.geography_id, ST_Area(l.geom),
        coalesce((SELECT ST_Area(ST_Intersection(l.geom, ST_Union(p.geom)))
                  FROM conservation_piece p WHERE ST_Intersects(l.geom, p.geom)), 0),
        coalesce((SELECT sum(ST_Area(ST_Intersection(l.geom, z.geom)))
                  FROM zone_piece z WHERE z.zone = 'ulez' AND ST_Intersects(l.geom, z.geom)), 0),
        coalesce((SELECT sum(ST_Area(ST_Intersection(l.geom, z.geom)))
                  FROM zone_piece z WHERE z.zone = 'congestion-charge' AND ST_Intersects(l.geom, z.geom)), 0),
        coalesce(pa.total, 0), coalesce(pa.householder, 0), coalesce(pa.full_count, 0), coalesce(pa.prior, 0),
        p_window_start, p_window_end,
        (SELECT min(source_release_id) FROM conservation_area),
        (SELECT min(source_release_id) FROM charge_zone),
        (SELECT min(source_release_id) FROM planning_application)
    FROM location_lsoa l
    LEFT JOIN LATERAL (
        SELECT count(*) AS total,
               count(*) FILTER (WHERE a.category = 'householder') AS householder,
               count(*) FILTER (WHERE a.category = 'full') AS full_count,
               count(*) FILTER (WHERE a.category = 'prior-approval') AS prior
        FROM planning_application a
        WHERE ST_Intersects(l.geom, a.location)
          AND a.valid_date >= p_window_start AND a.valid_date <= p_window_end) pa ON true
    WHERE ST_Area(l.geom) > 0;

    -- MSOAs, then boroughs: sums of their children.
    FOR n IN 1..2 LOOP
        INSERT INTO area_location (geography_id, area_m2, conservation_m2, ulez_m2, congestion_m2,
            planning_applications, planning_householder, planning_full, planning_prior_approval,
            planning_window_start, planning_window_end, conservation_release_id, zones_release_id,
            planning_release_id)
        SELECT g.parent_id, sum(c.area_m2), sum(c.conservation_m2), sum(c.ulez_m2), sum(c.congestion_m2),
            sum(c.planning_applications), sum(c.planning_householder), sum(c.planning_full),
            sum(c.planning_prior_approval), p_window_start, p_window_end, min(c.conservation_release_id),
            min(c.zones_release_id), min(c.planning_release_id)
        FROM area_location c JOIN area_geography g ON g.id = c.geography_id
        WHERE g.kind::text = CASE n WHEN 1 THEN 'lsoa' ELSE 'msoa' END AND g.parent_id IS NOT NULL
        GROUP BY g.parent_id;
        INSERT INTO area_conservation (geography_id, conservation_id, overlap_m2)
        SELECT g.parent_id, c.conservation_id, sum(c.overlap_m2)
        FROM area_conservation c JOIN area_geography g ON g.id = c.geography_id
        WHERE g.kind::text = CASE n WHEN 1 THEN 'lsoa' ELSE 'msoa' END AND g.parent_id IS NOT NULL
        GROUP BY g.parent_id, c.conservation_id;
    END LOOP;
    SELECT count(*) INTO n FROM area_location;
    RETURN n;
END;
$$;
