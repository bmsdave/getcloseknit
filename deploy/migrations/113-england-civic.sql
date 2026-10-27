-- 113: civic and services for all of England (branch england/d7-civic, after 103).
--
-- council_tax: who the Band D goes to outside London. MHCLG Table 10 line 16 is the GLA in London
-- (band_d_gla, unchanged) and the county council in two-tier areas; police, fire and a combined
-- authority are separate major precepts, and parishes add a local precept (an average here). Each is
-- NULL where none is levied, so London rows keep NULL in the new columns.
--
-- Conservation areas now come from two sources: the GLA's for London and planning.data.gov.uk's
-- elsewhere, and some councils publish none. conservation_sources() names, for each LAD ("borough"),
-- the release its conservation areas come from (those whose point-on-surface lies inside it), or none.
-- rebuild_area_location (030) and rebuild_area_restriction (063) are redefined only to take an area's
-- conservation_release_id from its LAD instead of the lowest release overall: NULL = the council has
-- published no conservation areas (unknown, never "none"). London's rows are unchanged (GLA release).
-- Safe to run again.

ALTER TABLE council_tax
    ADD COLUMN IF NOT EXISTS band_d_county numeric(8,2),
    ADD COLUMN IF NOT EXISTS band_d_police numeric(8,2),
    ADD COLUMN IF NOT EXISTS band_d_fire numeric(8,2),
    ADD COLUMN IF NOT EXISTS band_d_combined_authority numeric(8,2),
    ADD COLUMN IF NOT EXISTS band_d_parish numeric(8,2);

COMMENT ON COLUMN council_tax.band_d_gla IS 'London only: the GLA precept (Table 10 line 16)';
COMMENT ON COLUMN council_tax.band_d_county IS 'Two-tier areas: the county council precept (Table 10 line 16)';
COMMENT ON COLUMN council_tax.band_d_parish IS 'Average parish (local) precept: Table 10 line 8 less line 9';
COMMENT ON COLUMN article4_area.borough_code IS 'The LAD (E06/E07/E08/E09) whose council made the direction';
COMMENT ON COLUMN article4_coverage.borough_code IS 'Every covered LAD; areas = 0: no Article 4 data published';

CREATE OR REPLACE FUNCTION public.conservation_sources()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    n integer;
BEGIN
    IF to_regclass('pg_temp.conservation_source') IS NOT NULL THEN
        DROP TABLE pg_temp.conservation_source;
    END IF;
    CREATE TEMP TABLE conservation_source ON COMMIT DROP AS
        WITH point AS (
            SELECT ST_PointOnSurface(geom) AS geom, source_release_id FROM conservation_area
        ), lad AS (
            SELECT id, ST_Transform(geometry, 27700) AS geom FROM area_geography WHERE kind = 'borough'
        )
        SELECT lad.id AS borough_id, min(point.source_release_id) AS source_release_id
        FROM lad JOIN point ON ST_Intersects(lad.geom, point.geom)
        GROUP BY lad.id;
    SELECT count(*) INTO n FROM conservation_source;
    RETURN n;
END;
$$;

-- from 030-location-layers.sql; conservation_release_id from the area's LAD
CREATE OR REPLACE FUNCTION public.rebuild_area_location(p_window_start date, p_window_end date)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    n integer;
BEGIN
    CREATE TEMP TABLE location_lsoa ON COMMIT DROP AS
        SELECT l.id AS geography_id, l.parent_id, m.parent_id AS borough_id, ST_Transform(l.geometry, 27700) AS geom
        FROM area_geography l JOIN area_geography m ON m.id = l.parent_id WHERE l.kind = 'lsoa';
    CREATE INDEX ON location_lsoa USING gist (geom);
    CREATE TEMP TABLE conservation_piece ON COMMIT DROP AS
        SELECT id, ST_Subdivide(geom, 128) AS geom FROM conservation_area;
    CREATE INDEX ON conservation_piece USING gist (geom);
    CREATE TEMP TABLE zone_piece ON COMMIT DROP AS
        SELECT zone, ST_Subdivide(geom, 128) AS geom FROM charge_zone;
    CREATE INDEX ON zone_piece USING gist (geom);
    PERFORM conservation_sources();
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
        (SELECT s.source_release_id FROM conservation_source s WHERE s.borough_id = l.borough_id),
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

-- from 063-area-home.sql; conservation_release_id from the area's LAD
CREATE OR REPLACE FUNCTION public.rebuild_area_restriction()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    n integer;
BEGIN
    CREATE TEMP TABLE restriction_lsoa ON COMMIT DROP AS
        SELECT l.id AS geography_id, m.parent_id AS borough_id, ST_Transform(l.geometry, 27700) AS geom
        FROM area_geography l JOIN area_geography m ON m.id = l.parent_id WHERE l.kind = 'lsoa';
    CREATE INDEX ON restriction_lsoa USING gist (geom);
    CREATE TEMP TABLE restriction_piece ON COMMIT DROP AS
        SELECT 'conservation'::text AS layer, ST_Subdivide(geom, 128) AS geom FROM conservation_area
        UNION ALL
        SELECT 'article4', ST_Subdivide(geom, 128) FROM article4_area WHERE householder;
    CREATE INDEX ON restriction_piece USING gist (geom);
    ANALYZE restriction_lsoa;
    PERFORM conservation_sources();
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
        (SELECT s.source_release_id FROM conservation_source s WHERE s.borough_id = l.borough_id)
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
