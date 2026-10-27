-- 101: Layers v5 (PR 3, batch 2): three map layers built from tables already loaded, by
-- deploy/tools/etl_layers_v5.py (it writes each layer's source release, calls the rebuild here, then
-- stages one product release). New functions only: no table is created or changed. Safe to re-run.
--
--   supermarket-walk
--       LSOA: straight-line walking minutes from a point inside the LSOA to the nearest supermarket in the
--       merged places table (place, 034: OpenStreetMap shop=supermarket, confidence 0.6 or more), the same
--       model as the "nearest" ready-made criteria (Markets): 4.8 km/h with a 1.3 detour factor
--       (api personal_places.estimate_minutes), none beyond 5 km. ODbL 1.0.
--   gp-walk
--       LSOA: the same walking minutes to the nearest GP practice, from area_health.gp_nearest_m (061,
--       NHS England practices at their postcode's centre, OGL v3).
--   broadband-gigabit
--       LSOA: % of premises with a gigabit-capable line available (area_broadband, 063, Ofcom Connected
--       Nations, OGL v3); suppressed under 10 premises.
--
-- Legends are fixed and strictly ascending (never two stops on one value).

-- Straight-line metres as walking minutes: personal_places.estimate_minutes(km, "walk") in the API.
CREATE OR REPLACE FUNCTION public.layer_walk_minutes(p_metres double precision)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
AS $$ SELECT round((p_metres / 1000 * 1.3 / 4.8 * 60)::numeric, 1)::float8 $$;

-- Walking minutes, short (green) to long (red), as Station walk's legend.
CREATE OR REPLACE FUNCTION public.layer_walk_legend()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$ SELECT '[{"value": 0, "colour": "#3a7d44", "label": "0 min"},
               {"value": 3, "colour": "#7ba05b", "label": "3 min"},
               {"value": 6, "colour": "#f4d35e", "label": "6 min"},
               {"value": 10, "colour": "#c96a3b", "label": "10 min"},
               {"value": 15, "colour": "#b23a48", "label": "15 min+"}]'::jsonb $$;

CREATE OR REPLACE FUNCTION public.rebuild_supermarket_walk(p_source_release_id text,
    p_max_metres double precision DEFAULT 5000, p_min_confidence real DEFAULT 0.6)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    latest date;
    n integer;
BEGIN
    SELECT date_trunc('month', max(s.release_date))::date INTO latest
    FROM source_release s WHERE s.id IN (
        SELECT DISTINCT source_release_id FROM place WHERE tags @> '{"shop": "supermarket"}');
    IF latest IS NULL THEN
        RAISE EXCEPTION 'no supermarkets in place: load the merged places first';
    END IF;
    INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
    VALUES ('supermarket-walk', 'lsoa', 'minutes', 'higher-is-more', jsonb_build_object(
        'label', 'Walk to a supermarket', 'shortLabel', 'Supermarket',
        'description', 'Walking minutes from a point inside the area to the nearest supermarket on OpenStreetMap '
            || '(shop=supermarket, ' || to_char(latest, 'FMMonth YYYY') || '), along a straight line at 4.8 km/h '
            || 'with a 1.3 detour factor, as the nearest-place criteria estimate a walk.',
        'legend', layer_walk_legend(),
        'sourceId', 'osm', 'sourceName', 'OpenStreetMap',
        'methodologyPath', '/guide/getting-around', 'freshness', to_char(latest, 'YYYY-MM'),
        'caveats', jsonb_build_array(
            'A straight-line estimate, not a walking route.',
            'Large and small supermarkets count alike; corner shops (shop=convenience) do not.',
            'OpenStreetMap is kept by volunteers: a new shop may be missing and a closed one still listed.',
            'Areas with no supermarket within 5 km show no figure.',
            '© OpenStreetMap contributors. Open Database Licence (ODbL) 1.0.')),
        p_source_release_id)
    ON CONFLICT (id) DO UPDATE SET carrier = EXCLUDED.carrier, unit = EXCLUDED.unit,
        direction = EXCLUDED.direction, definition = EXCLUDED.definition,
        source_release_id = EXCLUDED.source_release_id;

    DELETE FROM metric_value WHERE metric_id = 'supermarket-walk';
    INSERT INTO metric_value (geography_id, metric_id, period, value, london_percentile, sample_count, quality,
        source_release_id)
    WITH area AS (
        SELECT id, ST_PointOnSurface(geometry) AS point FROM area_geography WHERE kind = 'lsoa'
    ), near AS (
        SELECT a.id, (SELECT ST_Distance(p.location::geography, a.point::geography) FROM place p
                      WHERE p.tags @> '{"shop": "supermarket"}' AND p.confidence >= p_min_confidence
                      ORDER BY p.location <-> a.point LIMIT 1) AS metres
        FROM area a
    ), walks AS (
        SELECT id, CASE WHEN metres <= p_max_metres THEN layer_walk_minutes(metres) END AS minutes FROM near
    ), ranked AS (
        SELECT id, round(100 * percent_rank() OVER (ORDER BY minutes))::smallint AS pct FROM walks
        WHERE minutes IS NOT NULL
    )
    SELECT w.id, 'supermarket-walk', latest, w.minutes, r.pct, NULL,
           CASE WHEN w.minutes IS NULL THEN 'suppressed' ELSE 'observed' END::metric_quality, p_source_release_id
    FROM walks w LEFT JOIN ranked r ON r.id = w.id;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.rebuild_gp_walk(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    latest date;
    n integer;
BEGIN
    SELECT max(gp_month) INTO latest FROM area_health WHERE gp_nearest_m IS NOT NULL;
    IF latest IS NULL THEN
        RAISE EXCEPTION 'no nearest GP in area_health: run etl_health.py load-gp first';
    END IF;
    INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
    VALUES ('gp-walk', 'lsoa', 'minutes', 'higher-is-more', jsonb_build_object(
        'label', 'Walk to a GP', 'shortLabel', 'GP',
        'description', 'Walking minutes from a point inside the area to the nearest GP practice (NHS England, '
            || 'Patients Registered at a GP Practice, ' || to_char(latest, 'FMMonth YYYY') || '), along a straight '
            || 'line at 4.8 km/h with a 1.3 detour factor.',
        'legend', layer_walk_legend(),
        'sourceId', 'nhs-gp-practices', 'sourceName', 'NHS England, Patients Registered at a GP Practice',
        'methodologyPath', '/guide/getting-around', 'freshness', to_char(latest, 'YYYY-MM'),
        'caveats', jsonb_build_array(
            'A straight-line estimate, not a walking route.',
            'Each practice sits at its postcode''s centre; branch surgeries are not listed separately.',
            'Being near a practice is not registration: each practice sets its own catchment.',
            'Contains information from NHS England, licensed under the current version of the Open Government Licence.')),
        p_source_release_id)
    ON CONFLICT (id) DO UPDATE SET carrier = EXCLUDED.carrier, unit = EXCLUDED.unit,
        direction = EXCLUDED.direction, definition = EXCLUDED.definition,
        source_release_id = EXCLUDED.source_release_id;

    DELETE FROM metric_value WHERE metric_id = 'gp-walk';
    INSERT INTO metric_value (geography_id, metric_id, period, value, london_percentile, sample_count, quality,
        source_release_id)
    WITH walks AS (
        SELECT g.id, layer_walk_minutes(h.gp_nearest_m::float8) AS minutes
        FROM area_geography g LEFT JOIN area_health h ON h.geography_id = g.id
        WHERE g.kind = 'lsoa'
    ), ranked AS (
        SELECT id, round(100 * percent_rank() OVER (ORDER BY minutes))::smallint AS pct FROM walks
        WHERE minutes IS NOT NULL
    )
    SELECT w.id, 'gp-walk', latest, w.minutes, r.pct, NULL,
           CASE WHEN w.minutes IS NULL THEN 'suppressed' ELSE 'observed' END::metric_quality, p_source_release_id
    FROM walks w LEFT JOIN ranked r ON r.id = w.id;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.rebuild_broadband_gigabit(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    latest date;
    n integer;
BEGIN
    SELECT date_trunc('month', max(s.release_date))::date INTO latest
    FROM source_release s WHERE s.id IN (SELECT DISTINCT source_release_id FROM area_broadband);
    IF latest IS NULL THEN
        RAISE EXCEPTION 'area_broadband is empty: run etl_home.py (broadband) first';
    END IF;
    INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
    VALUES ('broadband-gigabit', 'lsoa', '%', 'higher-is-better', jsonb_build_object(
        'label', 'Gigabit broadband', 'shortLabel', 'Broadband',
        'description', 'Share of the area''s premises where a gigabit-capable line (1,000 Mbit/s) can be ordered '
            || '(Ofcom Connected Nations, ' || to_char(latest, 'FMMonth YYYY') || ').',
        'legend', '[{"value": 0, "colour": "#c7e9b4", "label": "0%"},
                    {"value": 50, "colour": "#7fcdbb", "label": "50%"},
                    {"value": 75, "colour": "#1d91c0", "label": "75%"},
                    {"value": 90, "colour": "#253494", "label": "90%"},
                    {"value": 95, "colour": "#081d58", "label": "95%+"}]'::jsonb,
        'sourceId', 'ofcom-connected-nations', 'sourceName', 'Ofcom Connected Nations',
        'methodologyPath', '/guide/people-and-homes', 'freshness', to_char(latest, 'YYYY-MM'),
        'caveats', jsonb_build_array(
            'Availability, not take-up: a line can be ordered, not that a home has it.',
            'Residential output areas summed to neighbourhoods.',
            'Areas with fewer than 10 premises show no share.',
            'Contains Ofcom data licensed under the Open Government Licence v3.0.')),
        p_source_release_id)
    ON CONFLICT (id) DO UPDATE SET carrier = EXCLUDED.carrier, unit = EXCLUDED.unit,
        direction = EXCLUDED.direction, definition = EXCLUDED.definition,
        source_release_id = EXCLUDED.source_release_id;

    DELETE FROM metric_value WHERE metric_id = 'broadband-gigabit';
    INSERT INTO metric_value (geography_id, metric_id, period, value, london_percentile, sample_count, quality,
        source_release_id)
    WITH shares AS (
        SELECT g.id, coalesce(b.premises, 0) AS premises,
               CASE WHEN b.premises >= 10 THEN round(least(100.0, 100.0 * b.gigabit_premises / b.premises), 1)::float8 END AS share
        FROM area_geography g LEFT JOIN area_broadband b ON b.geography_id = g.id
        WHERE g.kind = 'lsoa'
    ), ranked AS (
        SELECT id, round(100 * percent_rank() OVER (ORDER BY share))::smallint AS pct FROM shares WHERE share IS NOT NULL
    )
    SELECT s.id, 'broadband-gigabit', latest, s.share, r.pct, s.premises,
           CASE WHEN s.share IS NULL THEN 'suppressed' ELSE 'observed' END::metric_quality, p_source_release_id
    FROM shares s LEFT JOIN ranked r ON r.id = s.id;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;
