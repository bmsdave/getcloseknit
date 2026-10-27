-- UK House Price Index (HM Land Registry, OGL v3), loaded by deploy/tools/etl_uk_hpi.py.
--
-- borough_hpi     the full file's London rows: each borough (E09) and London (E12000007), monthly
--                 from January 1995, average price and index for all homes and each type
-- rebuild_hpi_layers(release)
--                 the map layers `hpi-change-5y` and `hpi-change-10y`: the borough's change in the
--                 all-homes index over 5 and 10 years to the latest month. The index is published
--                 for boroughs only, so every MSOA and LSOA carries its borough's figure (quality
--                 'fallback') and the London percentile ranks the 33 boroughs: the levels agree.

CREATE TABLE IF NOT EXISTS borough_hpi (
    borough text NOT NULL CHECK (borough ~ '^E(09|12)[0-9]{6}$'),  -- E09 borough code, or London E12000007
    month date NOT NULL CHECK (extract(day FROM month) = 1),
    property_type text NOT NULL CHECK (property_type IN ('all', 'detached', 'semi', 'terraced', 'flat')),
    average_price integer NOT NULL CHECK (average_price > 0),
    index real NOT NULL CHECK (index > 0),
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (borough, property_type, month)
);

CREATE OR REPLACE FUNCTION public.rebuild_hpi_layers(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    latest date;
    written integer;
BEGIN
    SELECT max(month) INTO latest FROM borough_hpi WHERE property_type = 'all';
    DELETE FROM metric_value WHERE metric_id IN ('hpi-change-5y', 'hpi-change-10y');
    IF latest IS NULL THEN
        RETURN 0;
    END IF;

    INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
    SELECT k.metric_id, 'lsoa', '%', 'neutral', jsonb_build_object(
               'label', 'Price change over ' || k.years || ' years',
               'shortLabel', 'Price change ' || k.years || 'y',
               'description', 'Change in the borough''s official house price index (all homes) over ' || k.years
                   || ' years to ' || to_char(latest, 'Mon YYYY') || ' (HM Land Registry UK HPI). Borough-wide.',
               'sourceId', 'hmlr-uk-hpi', 'sourceName', 'HM Land Registry UK House Price Index',
               'methodologyPath', '/guide/local-market', 'freshness', to_char(latest, 'YYYY-MM'),
               'legend', jsonb_build_array(
                   jsonb_build_object('value', k.step * -1, 'colour', '#b2182b', 'label', (k.step * -1) || '%'),
                   jsonb_build_object('value', 0, 'colour', '#f4a582', 'label', '0%'),
                   jsonb_build_object('value', k.step, 'colour', '#d1e5f0', 'label', '+' || k.step || '%'),
                   jsonb_build_object('value', k.step * 2, 'colour', '#67a9cf', 'label', '+' || k.step * 2 || '%'),
                   jsonb_build_object('value', k.step * 4, 'colour', '#2166ac', 'label', '+' || k.step * 4 || '%+')),
               'caveats', jsonb_build_array(
                   'Borough-wide: every neighbourhood in a borough shows the same figure.',
                   'The official mix-adjusted index, not our own £/m², which stays the local figure.',
                   'The latest months are first estimates and are revised as more sales are registered.',
                   'Contains HM Land Registry data © Crown copyright and database right. Licensed under the Open Government Licence v3.0.')),
           p_source_release_id
    FROM (VALUES ('hpi-change-5y', 5, 5), ('hpi-change-10y', 10, 10)) k(metric_id, years, step)
    ON CONFLICT (id) DO UPDATE SET definition = EXCLUDED.definition, unit = EXCLUDED.unit,
        direction = EXCLUDED.direction, carrier = EXCLUDED.carrier, source_release_id = EXCLUDED.source_release_id;

    INSERT INTO metric_value (geography_id, metric_id, period, value, london_percentile,
        england_percentile, sample_count, quality, source_release_id)
    WITH changes AS (
        SELECT 'uk:borough:' || cur.borough AS borough_id, k.metric_id,
               round((100 * (cur.index / past.index - 1))::numeric, 1)::double precision AS value
        FROM (VALUES ('hpi-change-5y', 5), ('hpi-change-10y', 10)) k(metric_id, years)
        JOIN borough_hpi cur ON cur.month = latest AND cur.property_type = 'all' AND cur.borough LIKE 'E09%'
        JOIN borough_hpi past ON past.borough = cur.borough AND past.property_type = 'all'
         AND past.month = (latest - make_interval(years => k.years))::date
    ), ranked AS (
        SELECT *, round(100 * percent_rank() OVER (PARTITION BY metric_id ORDER BY value))::smallint AS pct
        FROM changes
    ), geo AS (
        SELECT g.id, g.kind,
               CASE g.kind WHEN 'borough' THEN g.id WHEN 'msoa' THEN g.parent_id ELSE m.parent_id END AS borough_id
        FROM area_geography g LEFT JOIN area_geography m ON m.id = g.parent_id
    )
    SELECT geo.id, r.metric_id, latest, r.value, r.pct, NULL, NULL,
           CASE WHEN geo.kind = 'borough' THEN 'observed' ELSE 'fallback' END::metric_quality, p_source_release_id
    FROM ranked r JOIN geo ON geo.borough_id = r.borough_id;
    GET DIAGNOSTICS written = ROW_COUNT;
    RETURN written;
END;
$$;
