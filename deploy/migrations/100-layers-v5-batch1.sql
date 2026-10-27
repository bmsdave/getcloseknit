-- 100: Layers v5 (PR 3, batch 1): four map layers built from tables already loaded, by
-- deploy/tools/etl_layers_v5.py (it writes each layer's source release, calls the rebuild here, then
-- stages one product release). New functions only: no table is created or changed. Safe to re-run.
--
--   typical-rent, typical-rent-1-bed, typical-rent-3-bed
--       carrier borough: the borough's average (mean) monthly private rent for 2, 1 and 3 bedrooms,
--       latest month in borough_rent (029, ONS PIPR, OGL v3), London percentile among the boroughs.
--       No City of London figure is published.
--   flood-risk
--       LSOA: % of homes whose higher NaFRA2 band (rivers and sea, or surface water) is medium or high,
--       a 1% chance a year or more (dwelling_flood, 018, EA OGL v3); suppressed under 10 homes.
--   good-schools-nearby, good-schools-nearby-secondary
--       LSOA: open London state primaries / secondaries within 1.5 km (straight line) of a point inside
--       the LSOA that rank in England's top 25% in the phase's latest year (school_national_rank, 055,
--       DfE OGL v3), read from the active product release.
--   student-share
--       LSOA: % of residents aged 16+ who were full-time students (Census 2021 TS066, the People
--       counts, 015). Descriptive only like census-*: no London percentile is stored.
--
-- Legends: layer_quantile_legend() puts stops at the 10th..90th percentiles rounded to a step and keeps
-- each value once, so stops are strictly ascending (never two stops on one value); fixed legends are
-- strictly ascending by hand.

CREATE OR REPLACE FUNCTION public.layer_number_label(p_value double precision)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE WHEN p_value = trunc(p_value) THEN to_char(p_value, 'FM999,999,990')
                ELSE to_char(p_value, 'FM999,999,990.0') END;
$$;

CREATE OR REPLACE FUNCTION public.layer_quantile_legend(p_values double precision[], p_step double precision,
    p_colours text[], p_prefix text DEFAULT '', p_suffix text DEFAULT '')
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
    WITH cut AS (
        SELECT c.ord, c.colour,
               round((SELECT percentile_disc((ARRAY[0.1, 0.3, 0.5, 0.7, 0.9])[c.ord]) WITHIN GROUP (ORDER BY v)
                      FROM unnest(p_values) AS v WHERE v IS NOT NULL) / p_step) * p_step AS value
        FROM unnest(p_colours[1:5]) WITH ORDINALITY AS c(colour, ord)
    ), uniq AS (
        SELECT DISTINCT ON (value) value, colour FROM cut WHERE value IS NOT NULL ORDER BY value, ord
    ), stops AS (
        -- Every area on one value: a ramp needs two stops.
        SELECT value, colour FROM uniq
        UNION ALL
        SELECT max(value) + p_step, p_colours[5] FROM uniq HAVING count(*) = 1
    ), numbered AS (
        SELECT value, colour, row_number() OVER (ORDER BY value) AS n, count(*) OVER () AS total FROM stops
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object('value', value, 'colour', colour,
               'label', p_prefix || layer_number_label(value) || p_suffix || CASE WHEN n = total THEN '+' ELSE '' END)
               ORDER BY n), '[]'::jsonb)
    FROM numbered;
$$;

-- The price ramp (YlGnBu, as typical-price and the Census layers): calm and sequential.
CREATE OR REPLACE FUNCTION public.layer_ramp()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$ SELECT ARRAY['#c7e9b4', '#7fcdbb', '#1d91c0', '#253494', '#081d58'] $$;

CREATE OR REPLACE FUNCTION public.rebuild_typical_rent(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    latest date;
    spec record;
    added integer;
    n integer := 0;
BEGIN
    SELECT max(period) INTO latest FROM borough_rent;
    IF latest IS NULL THEN
        RAISE EXCEPTION 'borough_rent is empty: load the ONS PIPR rents first';
    END IF;
    DELETE FROM metric_value WHERE metric_id IN ('typical-rent', 'typical-rent-1-bed', 'typical-rent-3-bed');
    FOR spec IN SELECT * FROM (VALUES
        ('typical-rent', '2 bedrooms', '2-bedroom', 'Typical rent: 2 bedrooms'),
        ('typical-rent-1-bed', '1 bedroom', '1-bedroom', 'Typical rent: 1 bedroom'),
        ('typical-rent-3-bed', '3 bedrooms', '3-bedroom', 'Typical rent: 3 bedrooms')) AS s(id, bedrooms, words, label)
    LOOP
        INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
        VALUES (spec.id, 'borough', '£ a month', 'higher-is-more', jsonb_build_object(
            'label', spec.label, 'shortLabel', 'Typical rent',
            'description', 'Average monthly private rent for a ' || spec.words || ' home in the borough (mean of new '
                || 'and existing tenancies, ONS Price Index of Private Rents, ' || to_char(latest, 'FMMonth YYYY')
                || '). Borough level: every area in a borough shows the same rent. A ballpark, not the rent of any home.',
            'legend', (SELECT layer_quantile_legend(array_agg(r.monthly_rent::float8), 50, layer_ramp(), '£')
                       FROM borough_rent r JOIN area_geography g ON g.id = 'uk:borough:' || r.area_code
                       WHERE r.period = latest AND r.bedrooms = spec.bedrooms),
            'sourceId', 'ons-pipr', 'sourceName', 'ONS Price Index of Private Rents',
            'methodologyPath', '/guide/home-cost', 'freshness', to_char(latest, 'YYYY-MM'),
            'caveats', jsonb_build_array(
                'Borough-wide: every neighbourhood in a borough reads the borough''s rent.',
                'The mean rent of new and existing tenancies, not asking rents for homes on the market today.',
                'Official statistics in development: ONS may revise recent months.',
                'No City of London figures are published.',
                'Source: Office for National Statistics, Price Index of Private Rents. Open Government Licence v3.0.')),
            p_source_release_id)
        ON CONFLICT (id) DO UPDATE SET carrier = EXCLUDED.carrier, unit = EXCLUDED.unit,
            direction = EXCLUDED.direction, definition = EXCLUDED.definition,
            source_release_id = EXCLUDED.source_release_id;

        INSERT INTO metric_value (geography_id, metric_id, period, value, london_percentile, sample_count, quality,
            source_release_id)
        SELECT g.id, spec.id, latest, r.monthly_rent,
               round(100 * percent_rank() OVER (ORDER BY r.monthly_rent))::smallint, NULL, 'observed',
               p_source_release_id
        FROM borough_rent r JOIN area_geography g ON g.id = 'uk:borough:' || r.area_code AND g.kind = 'borough'
        WHERE r.period = latest AND r.bedrooms = spec.bedrooms;
        GET DIAGNOSTICS added = ROW_COUNT;
        n := n + added;
    END LOOP;
    RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.rebuild_flood_risk(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    latest date;
    n integer;
BEGIN
    SELECT date_trunc('month', max(s.release_date))::date INTO latest
    FROM source_release s WHERE s.id IN (SELECT DISTINCT source_release_id FROM dwelling_flood);
    IF latest IS NULL THEN
        RAISE EXCEPTION 'dwelling_flood is empty: run rebuild_flood first';
    END IF;
    INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
    VALUES ('flood-risk', 'lsoa', '%', 'higher-is-more', jsonb_build_object(
        'label', 'Homes at flood risk', 'shortLabel', 'Flood risk',
        'description', 'Share of the area''s homes in a medium or high flood-risk band (a 1% chance a year or more) '
            || 'from rivers and the sea or from surface water, read at each home''s point (Environment Agency NaFRA2, '
            || to_char(latest, 'YYYY') || ').',
        'legend', '[{"value": 0, "colour": "#3a7d44", "label": "0%"},
                    {"value": 5, "colour": "#7ba05b", "label": "5%"},
                    {"value": 15, "colour": "#f4d35e", "label": "15%"},
                    {"value": 30, "colour": "#c96a3b", "label": "30%"},
                    {"value": 50, "colour": "#b23a48", "label": "50%+"}]'::jsonb,
        'sourceId', 'ea-nafra2', 'sourceName', 'Environment Agency National Flood Risk Assessment (NaFRA2)',
        'methodologyPath', '/guide/flood', 'freshness', to_char(latest, 'YYYY-MM'),
        'caveats', jsonb_build_array(
            'Modelled chance of flooding each year, not a record of past floods.',
            'Medium is 1% to 3.3% a year, high more than 3.3%; the higher of the rivers-and-sea and surface-water bands counts.',
            'Areas with fewer than 10 homes with a point show no share.',
            'Contains public sector information licensed under the Open Government Licence v3.0. '
                || '© Environment Agency copyright and/or database right.')),
        p_source_release_id)
    ON CONFLICT (id) DO UPDATE SET carrier = EXCLUDED.carrier, unit = EXCLUDED.unit,
        direction = EXCLUDED.direction, definition = EXCLUDED.definition,
        source_release_id = EXCLUDED.source_release_id;

    DELETE FROM metric_value WHERE metric_id = 'flood-risk';
    INSERT INTO metric_value (geography_id, metric_id, period, value, london_percentile, sample_count, quality,
        source_release_id)
    WITH homes AS (
        SELECT p.geography_id, count(*) AS homes,
               round(100 * avg((greatest(f.rivers_sea_band, f.surface_water_band) >= 3)::int), 1)::float8 AS share
        FROM dwelling_flood f JOIN property p ON p.uprn = f.uprn
        GROUP BY p.geography_id
    ), shares AS (
        SELECT g.id, coalesce(h.homes, 0) AS homes, CASE WHEN h.homes >= 10 THEN h.share END AS share
        FROM area_geography g LEFT JOIN homes h ON h.geography_id = g.id
        WHERE g.kind = 'lsoa'
    ), ranked AS (
        SELECT id, round(100 * percent_rank() OVER (ORDER BY share))::smallint AS pct FROM shares WHERE share IS NOT NULL
    )
    SELECT s.id, 'flood-risk', latest, s.share, r.pct, s.homes,
           CASE WHEN s.share IS NULL THEN 'suppressed' ELSE 'observed' END::metric_quality, p_source_release_id
    FROM shares s LEFT JOIN ranked r ON r.id = s.id;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;

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
                'Only London state schools are counted, so areas near London''s edge may read low.',
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
        SELECT id, spec.id, period, schools, round(100 * percent_rank() OVER (ORDER BY schools))::smallint, NULL,
               'observed', p_source_release_id
        FROM counted;
        GET DIAGNOSTICS added = ROW_COUNT;
        n := n + added;
    END LOOP;
    RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.rebuild_student_share(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE n integer;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM area_census_count WHERE topic = 'economic-activity' AND category = 'student') THEN
        RAISE EXCEPTION 'no Census 2021 TS066 counts in area_census_count: run the People loader first';
    END IF;
    INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
    VALUES ('student-share', 'lsoa', '%', 'higher-is-more', jsonb_build_object(
        'label', 'Full-time students', 'shortLabel', 'Student areas',
        'description', '% of residents aged 16 and over who were full-time students on census day, 21 March 2021 '
            || '(ONS Census 2021, table TS066). It describes the area; it is never ranked or used to match areas.',
        'legend', (SELECT layer_quantile_legend(array_agg(share), 1, layer_ramp(), '', '%') FROM (
            SELECT 100.0 * sum(c.count) FILTER (WHERE c.category = 'student') / nullif(sum(c.count), 0) AS share
            FROM area_census_count c JOIN area_geography g ON g.id = c.geography_id AND g.kind = 'lsoa'
            WHERE c.topic = 'economic-activity' GROUP BY c.geography_id) s),
        'sourceId', 'ons-census-2021', 'sourceName', 'Office for National Statistics, Census 2021',
        'methodologyPath', '/guide/people-and-homes', 'freshness', '2021-03',
        'caveats', jsonb_build_array(
            'Descriptive only: never a filter, weight, rank or custom criterion.',
            'Census day fell during the pandemic: some students were counted at their family home, away from term-time addresses.',
            'Small numbers are adjusted by the ONS to protect privacy (targeted record swapping).',
            'Census 2021: Office for National Statistics. Contains public sector information licensed under the '
                || 'Open Government Licence v3.0.')),
        p_source_release_id)
    ON CONFLICT (id) DO UPDATE SET carrier = EXCLUDED.carrier, unit = EXCLUDED.unit,
        direction = EXCLUDED.direction, definition = EXCLUDED.definition,
        source_release_id = EXCLUDED.source_release_id;

    DELETE FROM metric_value WHERE metric_id = 'student-share';
    INSERT INTO metric_value (geography_id, metric_id, period, value, london_percentile, sample_count, quality,
        source_release_id)
    WITH counts AS (
        SELECT c.geography_id, sum(c.count)::int AS residents,
               (sum(c.count) FILTER (WHERE c.category = 'student'))::int AS students
        FROM area_census_count c WHERE c.topic = 'economic-activity' GROUP BY c.geography_id
    )
    SELECT g.id, 'student-share', DATE '2021-03-01',
           CASE WHEN c.residents > 0 THEN round(100.0 * coalesce(c.students, 0) / c.residents, 1)::float8 END,
           NULL, c.residents,
           CASE WHEN c.residents > 0 THEN 'observed' ELSE 'suppressed' END::metric_quality, p_source_release_id
    FROM area_geography g LEFT JOIN counts c ON c.geography_id = g.id
    WHERE g.kind = 'lsoa';
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;
