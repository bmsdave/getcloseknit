-- 110: Schools for all of England (after 103). The school loaders now read every English school
-- (deploy/tools/school_history_common.COVERAGE); "London" pools, ranks and medians become the school's
-- own region, so London's numbers stay as they were:
--   school.region_code, independent_school.region_code   the region the school ranks in: the region of
--       the LAD at (or nearest to) its point, point_rank_region() of 103, as 103's best-primary rank does.
--       A trigger fills it on every insert or move; London's schools all get E12000007.
--   rebuild_area_kids()   as 103, except that the TfL cycle-lane figures (London-only source) are NULL
--       outside London, not "0 km": the API then withholds them (FLAGS.md, decision 4).
--   rebuild_good_schools_nearby()   as 103, with the caveat saying England's schools are counted.
-- Safe to run again.

ALTER TABLE school ADD COLUMN IF NOT EXISTS region_code text;

CREATE OR REPLACE FUNCTION public.school_fill_region()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.region_code := point_rank_region(NEW.location);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS school_region_trg ON school;
CREATE TRIGGER school_region_trg BEFORE INSERT OR UPDATE OF location ON school
    FOR EACH ROW EXECUTE FUNCTION school_fill_region();
UPDATE school SET region_code = point_rank_region(location)
 WHERE region_code IS DISTINCT FROM point_rank_region(location);
CREATE INDEX IF NOT EXISTS school_region_idx ON school (region_code, phase);

-- independent_school (067) is absent on databases that never loaded it.
DO $$
BEGIN
    IF to_regclass('public.independent_school') IS NOT NULL THEN
        ALTER TABLE independent_school ADD COLUMN IF NOT EXISTS region_code text;
        DROP TRIGGER IF EXISTS independent_school_region_trg ON independent_school;
        CREATE TRIGGER independent_school_region_trg BEFORE INSERT OR UPDATE OF location ON independent_school
            FOR EACH ROW EXECUTE FUNCTION school_fill_region();
        UPDATE independent_school SET region_code = point_rank_region(location)
         WHERE region_code IS DISTINCT FROM point_rank_region(location);
        CREATE INDEX IF NOT EXISTS independent_school_region_idx ON independent_school (region_code);
    END IF;
END
$$;

-- As in 103, except the lane figures: London only (TfL Cycling Infrastructure Database), NULL elsewhere.
ALTER TABLE area_kids ALTER COLUMN protected_km DROP NOT NULL;
ALTER TABLE area_kids ALTER COLUMN cycleway_km DROP NOT NULL;

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
        SELECT g.id, g.kind, ST_Transform(ST_PointOnSurface(g.geometry), 27700) AS point,
               area_rank_region(g.id) = 'E12000007' AS london
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
        FROM area a LEFT JOIN cycle_lane l ON a.london AND ST_DWithin(l.geometry, a.point, 1000)
        GROUP BY a.id
    ), joined AS (
        SELECT a.id, a.kind, a.london, n.rated, n.good,
               CASE WHEN n.rated >= 3 THEN round(100.0 * n.good / n.rated, 1) END AS share,
               c.by_year, c.total, c.child, c.serious, c.cyclist,
               CASE WHEN a.london THEN round(lane.protected_km::numeric, 2) END AS protected_km,
               CASE WHEN a.london THEN round(lane.cycleway_km::numeric, 2) END AS cycleway_km
        FROM area a JOIN nursery n USING (id) JOIN casualty c USING (id) JOIN lane USING (id)
    )
    INSERT INTO area_kids
    SELECT j.id, j.rated, j.good, j.share,
           round(100 * percent_rank() OVER (PARTITION BY j.kind, area_rank_region(j.id) ORDER BY j.good)),
           first_year, j.by_year, j.total, j.child, j.serious, j.cyclist,
           CASE WHEN years > 0 THEN round(100 * percent_rank() OVER (PARTITION BY j.kind, area_rank_region(j.id) ORDER BY j.total)) END,
           j.protected_km, j.cycleway_km,
           CASE WHEN j.london THEN round(100 * percent_rank() OVER (PARTITION BY j.kind, area_rank_region(j.id) ORDER BY j.protected_km + j.cycleway_km)) END,
           sources
    FROM joined j;
    GET DIAGNOSTICS written = ROW_COUNT;
    RETURN written;
END;
$$;

-- As in 103, except one caveat: the school table now holds England's state schools (was London's only).
CREATE OR REPLACE FUNCTION public.rebuild_good_schools_nearby(p_source_release_id text,
    p_radius_m double precision DEFAULT 1500, p_top_percent integer DEFAULT 25)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    spec record;
    year text;
    period date;
    added integer;
    n integer := 0;
    active boolean := EXISTS (SELECT 1 FROM active_product_release);
BEGIN
    DELETE FROM metric_value WHERE metric_id IN ('good-schools-nearby', 'good-schools-nearby-secondary');
    FOR spec IN SELECT * FROM (VALUES
        ('good-schools-nearby', 'primary', 'Good primary schools within 1.5 km', 'primaries',
         'KS2 reading, writing and maths at the expected standard'),
        ('good-schools-nearby-secondary', 'secondary', 'Good secondary schools within 1.5 km', 'secondaries',
         'KS4 Attainment 8')) AS s(id, phase, label, plural, measure)
    LOOP
        SELECT max(r.academic_year) INTO year FROM school_national_rank r
        WHERE r.phase = spec.phase AND (NOT active OR r.source_release_id IN (
            SELECT m.source_release_id FROM product_release_member m
            WHERE m.release_id = (SELECT release_id FROM active_product_release)));
        IF year IS NULL THEN
            RAISE EXCEPTION 'no % England ranks in school_national_rank: run etl_school_performance.py first', spec.phase;
        END IF;
        period := make_date(left(year, 4)::int + 1, 7, 1);  -- 2024/25: July 2025, the end of the year

        INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
        VALUES (spec.id, 'lsoa', 'schools', 'higher-is-better', jsonb_build_object(
            'label', spec.label, 'shortLabel', 'Good schools nearby',
            'description', 'Open state ' || spec.phase || ' schools within 1.5 km of the area''s centre that rank in '
                || 'England''s top 25% (' || spec.measure || ', ' || year || ').',
            'legend', '[{"value": 0, "colour": "#c7e9b4", "label": "0"},
                        {"value": 1, "colour": "#7fcdbb", "label": "1"},
                        {"value": 2, "colour": "#1d91c0", "label": "2"},
                        {"value": 4, "colour": "#253494", "label": "4"},
                        {"value": 6, "colour": "#081d58", "label": "6+"}]'::jsonb,
            'sourceId', 'dfe-performance', 'sourceName', 'DfE school performance tables',
            'methodologyPath', '/guide/schools', 'freshness', year,
            'caveats', jsonb_build_array(
                'Straight-line distance from a point inside the area, not walking distance or a catchment.',
                'England rank on one measure in the latest published year; schools with a suppressed figure are not ranked.',
                'England''s state schools are counted (independent schools are not); areas by the Welsh or Scottish border may read low.',
                'A school nearby is not a place offered: admissions follow each school''s own rules.',
                'Department for Education school performance data and Get Information about Schools. '
                    || 'Open Government Licence v3.0.')),
            p_source_release_id)
        ON CONFLICT (id) DO UPDATE SET carrier = EXCLUDED.carrier, unit = EXCLUDED.unit,
            direction = EXCLUDED.direction, definition = EXCLUDED.definition,
            source_release_id = EXCLUDED.source_release_id;

        INSERT INTO metric_value (geography_id, metric_id, period, value, london_percentile, sample_count, quality,
            source_release_id)
        WITH good AS (
            -- The ranks of the active product release only (as the map's Show › Schools reads them).
            SELECT s.location FROM school s JOIN school_national_rank r ON r.urn = s.urn
            WHERE r.phase = spec.phase AND r.academic_year = year AND r.top_percent <= p_top_percent
              AND s.successor_urn IS NULL
              AND (NOT active OR r.source_release_id IN (
                  SELECT m.source_release_id FROM product_release_member m
                  WHERE m.release_id = (SELECT release_id FROM active_product_release)))
        ), counted AS (
            SELECT l.id, (SELECT count(*) FROM good
                          WHERE ST_DWithin(good.location::geography, ST_PointOnSurface(l.geometry)::geography,
                                           p_radius_m))::int AS schools
            FROM area_geography l WHERE l.kind = 'lsoa'
        )
        SELECT id, spec.id, period, schools, round(100 * percent_rank() OVER (PARTITION BY area_rank_region(id) ORDER BY schools))::smallint, NULL,
               'observed', p_source_release_id
        FROM counted;
        GET DIAGNOSTICS added = ROW_COUNT;
        n := n + added;
    END LOOP;
    RETURN n;
END;
$$;
