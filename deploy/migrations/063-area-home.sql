-- The area card's Home theme, loaded by deploy/tools/etl_home.py:
--   article4_area      Article 4 direction areas (planning.data.gov.uk, OGL v3)
--   article4_coverage  per London borough: whether it has published Article 4 data there
--   listed_building    Historic England listed buildings as points (planning.data.gov.uk, OGL v3)
--   area_restriction   per LSOA, MSOA and borough: land in a conservation area (migration 030),
--                      under an Article 4 direction, under either, and listed buildings by grade
--   area_broadband     per LSOA, MSOA and borough: residential premises with gigabit broadband
--                      available (Ofcom Connected Nations, output areas summed), and each borough's
--                      full-fibre share (published for local authorities only), OGL v3
--   area_settled       per LSOA, MSOA and borough: usual residents at the same address a year
--                      before Census day (Census 2021 TS019, OGL v3)
-- Aggregates about places and counts, never a person or a home. All geometry is British National
-- Grid (27700). MSOAs and boroughs are sums of their LSOAs, so the levels always agree.

CREATE TABLE IF NOT EXISTS article4_area (
    id text PRIMARY KEY,                     -- "pd:<entity>"
    name text,
    reference text,
    borough_code text NOT NULL,              -- E09…: the borough that made the direction
    householder boolean NOT NULL,            -- removes householder rights (extensions, roofs, porches)
    geom geometry(MultiPolygon, 27700) NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id)
);
CREATE INDEX IF NOT EXISTS article4_area_geom_gix ON article4_area USING gist (geom);

CREATE TABLE IF NOT EXISTS article4_coverage (
    borough_code text PRIMARY KEY,           -- every London borough, E09…
    areas integer NOT NULL CHECK (areas >= 0),
    source_release_id text NOT NULL REFERENCES source_release(id)
);

CREATE TABLE IF NOT EXISTS listed_building (
    id text PRIMARY KEY,                     -- "nhle:<list entry number>"
    name text,
    grade text NOT NULL CHECK (grade IN ('I', 'II*', 'II')),
    location geometry(Point, 27700) NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id)
);
CREATE INDEX IF NOT EXISTS listed_building_location_gix ON listed_building USING gist (location);

CREATE TABLE IF NOT EXISTS area_restriction (
    geography_id text PRIMARY KEY REFERENCES area_geography(id) ON DELETE CASCADE,
    area_m2 double precision NOT NULL CHECK (area_m2 > 0),
    conservation_m2 double precision NOT NULL CHECK (conservation_m2 >= 0),
    article4_m2 double precision NOT NULL CHECK (article4_m2 >= 0),
    restricted_m2 double precision NOT NULL CHECK (restricted_m2 >= 0),   -- either, never twice
    listed_grade_i integer NOT NULL CHECK (listed_grade_i >= 0),
    listed_grade_ii_star integer NOT NULL CHECK (listed_grade_ii_star >= 0),
    listed_grade_ii integer NOT NULL CHECK (listed_grade_ii >= 0),
    article4_release_id text REFERENCES source_release(id),
    listed_release_id text REFERENCES source_release(id),
    conservation_release_id text REFERENCES source_release(id)
);

CREATE TABLE IF NOT EXISTS area_broadband (
    geography_id text PRIMARY KEY REFERENCES area_geography(id) ON DELETE CASCADE,
    premises integer NOT NULL CHECK (premises > 0),
    gigabit_premises integer NOT NULL CHECK (gigabit_premises >= 0),
    -- Ofcom publishes full fibre for local authorities only: boroughs carry it, LSOAs and MSOAs NULL.
    full_fibre_share real CHECK (full_fibre_share BETWEEN 0 AND 1),
    source_release_id text NOT NULL REFERENCES source_release(id)
);

CREATE TABLE IF NOT EXISTS area_settled (
    geography_id text PRIMARY KEY REFERENCES area_geography(id) ON DELETE CASCADE,
    residents integer NOT NULL CHECK (residents > 0),
    same_address integer NOT NULL CHECK (same_address >= 0),
    source_release_id text NOT NULL REFERENCES source_release(id)
);

-- Sum the LSOA rows of one area table up to MSOAs, then boroughs: counts and areas summed, release
-- ids (the same on every row) carried as their min.
CREATE OR REPLACE FUNCTION public.roll_up_area_home(p_table text, p_sum text[], p_min text[])
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    cols text[] := p_sum || p_min;
    names text := (SELECT string_agg(format('%I', col), ', ') FROM unnest(cols) col);
    aggs text := (SELECT string_agg(format('%s(c.%I)', CASE WHEN col = ANY(p_min) THEN 'min' ELSE 'sum' END, col), ', ')
                  FROM unnest(cols) col);
    child text;
BEGIN
    FOREACH child IN ARRAY ARRAY['lsoa', 'msoa'] LOOP
        EXECUTE format('INSERT INTO %I (geography_id, %s) SELECT g.parent_id, %s FROM %I c '
                       'JOIN area_geography g ON g.id = c.geography_id '
                       'WHERE g.kind::text = %L AND g.parent_id IS NOT NULL GROUP BY g.parent_id',
                       p_table, names, aggs, p_table, child);
    END LOOP;
END;
$$;

-- Rebuild area_restriction from conservation_area (030), article4_area and listed_building. Each
-- LSOA is intersected once with the layers cut into small pieces; overlapping areas are unioned
-- before measuring, so land is never counted twice. Only householder Article 4 directions count.
CREATE OR REPLACE FUNCTION public.rebuild_area_restriction()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    n integer;
BEGIN
    CREATE TEMP TABLE restriction_lsoa ON COMMIT DROP AS
        SELECT id AS geography_id, ST_Transform(geometry, 27700) AS geom
        FROM area_geography WHERE kind = 'lsoa';
    CREATE INDEX ON restriction_lsoa USING gist (geom);
    CREATE TEMP TABLE restriction_piece ON COMMIT DROP AS
        SELECT 'conservation'::text AS layer, ST_Subdivide(geom, 128) AS geom FROM conservation_area
        UNION ALL
        SELECT 'article4', ST_Subdivide(geom, 128) FROM article4_area WHERE householder;
    CREATE INDEX ON restriction_piece USING gist (geom);
    ANALYZE restriction_lsoa;
    ANALYZE restriction_piece;

    DELETE FROM area_restriction;
    INSERT INTO area_restriction (geography_id, area_m2, conservation_m2, article4_m2, restricted_m2,
        listed_grade_i, listed_grade_ii_star, listed_grade_ii, article4_release_id, listed_release_id,
        conservation_release_id)
    SELECT l.geography_id, ST_Area(l.geom),
        coalesce((SELECT ST_Area(ST_Intersection(l.geom, ST_Union(p.geom))) FROM restriction_piece p
                  WHERE p.layer = 'conservation' AND ST_Intersects(l.geom, p.geom)), 0),
        coalesce((SELECT ST_Area(ST_Intersection(l.geom, ST_Union(p.geom))) FROM restriction_piece p
                  WHERE p.layer = 'article4' AND ST_Intersects(l.geom, p.geom)), 0),
        coalesce((SELECT ST_Area(ST_Intersection(l.geom, ST_Union(p.geom))) FROM restriction_piece p
                  WHERE ST_Intersects(l.geom, p.geom)), 0),
        coalesce(b.grade_i, 0), coalesce(b.grade_ii_star, 0), coalesce(b.grade_ii, 0),
        (SELECT min(source_release_id) FROM article4_area),
        (SELECT min(source_release_id) FROM listed_building),
        (SELECT min(source_release_id) FROM conservation_area)
    FROM restriction_lsoa l
    LEFT JOIN LATERAL (
        SELECT count(*) FILTER (WHERE grade = 'I') AS grade_i,
               count(*) FILTER (WHERE grade = 'II*') AS grade_ii_star,
               count(*) FILTER (WHERE grade = 'II') AS grade_ii
        FROM listed_building b WHERE ST_Intersects(l.geom, b.location)) b ON true
    WHERE ST_Area(l.geom) > 0;

    PERFORM roll_up_area_home('area_restriction',
        ARRAY['area_m2', 'conservation_m2', 'article4_m2', 'restricted_m2', 'listed_grade_i', 'listed_grade_ii_star',
              'listed_grade_ii'],
        ARRAY['article4_release_id', 'listed_release_id', 'conservation_release_id']);
    SELECT count(*) INTO n FROM area_restriction;
    RETURN n;
END;
$$;
