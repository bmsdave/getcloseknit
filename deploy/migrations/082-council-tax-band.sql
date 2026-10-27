-- 082: Council tax bands per area, loaded by deploy/tools/etl_council_tax.py.
--
--   area_council_tax_band  homes on the VOA valuation list in each band A-H (CTSOP1.1, OGL v3), per London
--                          LSOA as published (rounded to 10), then MSOAs and boroughs as sums of their LSOAs
--                          (roll_up_area_home, migration 063), so the levels agree. total = A..H summed.
--   council-tax-band-mean  map metric: each LSOA's mean band, A = 1 ... H = 8, with its London percentile;
--                          suppressed under 50 homes (rebuild_council_tax_band()).
--
-- The borough's Band D bill stays in council_tax (migration 019). Safe to run again.

CREATE TABLE IF NOT EXISTS area_council_tax_band (
    geography_id text PRIMARY KEY REFERENCES area_geography(id),
    band_a integer NOT NULL CHECK (band_a >= 0),
    band_b integer NOT NULL CHECK (band_b >= 0),
    band_c integer NOT NULL CHECK (band_c >= 0),
    band_d integer NOT NULL CHECK (band_d >= 0),
    band_e integer NOT NULL CHECK (band_e >= 0),
    band_f integer NOT NULL CHECK (band_f >= 0),
    band_g integer NOT NULL CHECK (band_g >= 0),
    band_h integer NOT NULL CHECK (band_h >= 0),
    total integer NOT NULL CHECK (total >= 0),       -- band_a + ... + band_h
    period date NOT NULL,                            -- the valuation list date's month: 2025-03-01
    source_release_id text NOT NULL REFERENCES source_release(id)
);

-- Sum the LSOAs up to MSOAs and boroughs, then write the mean band metric for the LSOAs.
CREATE OR REPLACE FUNCTION public.rebuild_council_tax_band(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    n integer;
    latest date;
BEGIN
    DELETE FROM area_council_tax_band t USING area_geography g WHERE g.id = t.geography_id AND g.kind <> 'lsoa';
    PERFORM roll_up_area_home('area_council_tax_band',
        ARRAY['band_a', 'band_b', 'band_c', 'band_d', 'band_e', 'band_f', 'band_g', 'band_h', 'total'],
        ARRAY['period', 'source_release_id']);
    SELECT max(period) INTO latest FROM area_council_tax_band;

    INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
    VALUES ('council-tax-band-mean', 'lsoa', 'band', 'higher-is-more', jsonb_build_object(
        'label', 'Council tax band', 'shortLabel', 'Council tax band',
        'description', 'Average council tax band of the area''s homes, A = 1 to H = 8 (VOA valuation list, '
            || to_char(latest, 'FMMonth YYYY') || '). Bands come from 1991 values, not today''s prices.',
        'legend', '[{"value": 2, "colour": "#2a6f97", "label": "B"},
                    {"value": 3, "colour": "#8ecae6", "label": "C"},
                    {"value": 4, "colour": "#f4d35e", "label": "D"},
                    {"value": 5, "colour": "#e07a1f", "label": "E"},
                    {"value": 6, "colour": "#c44536", "label": "F+"}]'::jsonb,
        'sourceId', 'voa-ctsop', 'sourceName', 'VOA Council Tax: stock of properties',
        'methodologyPath', '/guide/local-government', 'freshness', to_char(latest, 'YYYY-MM'),
        'caveats', jsonb_build_array(
            'Homes on the valuation list, rounded by VOA to the nearest 10.',
            'Bands come from 1991 values (England), not today''s prices.',
            'Areas with fewer than 50 homes show no band.',
            'VOA Council Tax: stock of properties, Open Government Licence v3.0.')),
        p_source_release_id)
    ON CONFLICT (id) DO UPDATE SET definition = EXCLUDED.definition, source_release_id = EXCLUDED.source_release_id;

    DELETE FROM metric_value WHERE metric_id = 'council-tax-band-mean';
    INSERT INTO metric_value (geography_id, metric_id, period, value, london_percentile, sample_count, quality,
        source_release_id)
    WITH mean AS (
        SELECT t.geography_id, t.period, t.total,
               CASE WHEN t.total >= 50 THEN round((1 * t.band_a + 2 * t.band_b + 3 * t.band_c + 4 * t.band_d
                   + 5 * t.band_e + 6 * t.band_f + 7 * t.band_g + 8 * t.band_h)::numeric / t.total, 2)::float8 END AS value
        FROM area_council_tax_band t JOIN area_geography g ON g.id = t.geography_id AND g.kind = 'lsoa'
    ), ranked AS (
        SELECT geography_id, round(100 * percent_rank() OVER (ORDER BY value))::smallint AS pct
        FROM mean WHERE value IS NOT NULL
    )
    SELECT m.geography_id, 'council-tax-band-mean', m.period, m.value, r.pct, m.total,
           CASE WHEN m.value IS NULL THEN 'suppressed' ELSE 'observed' END::metric_quality, p_source_release_id
    FROM mean m LEFT JOIN ranked r ON r.geography_id = m.geography_id;

    SELECT count(*) INTO n FROM area_council_tax_band;
    RETURN n;
END;
$$;
