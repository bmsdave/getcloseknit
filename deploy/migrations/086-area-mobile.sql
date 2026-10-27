-- 086: Mobile coverage per London borough (GET /api/v1/areas/{id}/mobile, api/area_api/mobile.py),
-- loaded by deploy/tools/etl_mobile.py. Renumber at merge if 086 is taken.
--
-- Ofcom Connected Nations publishes mobile coverage for local authorities and constituencies only
-- (no postcode or output-area file), so the finest London grain is the borough: an LSOA or MSOA
-- shows its borough's figure. Shares (0-1) of the borough's premises with predicted coverage:
--   outdoor_4g_all_mno  4G outdoors from all four networks
--   indoor_4g_all_mno   4G indoors from all four networks
--   outdoor_5g_any      5G outdoors from at least one network (Ofcom's high-confidence level)
--   outdoor_5g_all      5G outdoors from all four networks (high confidence)
-- Predicted coverage from the operators' models, not measured speed. Places, never people.
--
-- rebuild_area_mobile_metrics(release, period) writes the two map layers from area_mobile:
--   mobile-4g-indoor   indoor 4G from all four networks, % of premises, per borough
--   mobile-5g-outdoor  outdoor 5G from any network, % of premises, per borough
-- each with its London percentile among the boroughs (percent_rank × 100, 0 = lowest). As
-- published metrics they are map layers and `range:<layer>` match criteria (matching.py).

CREATE TABLE IF NOT EXISTS area_mobile (
    geography_id text PRIMARY KEY REFERENCES area_geography(id) ON DELETE CASCADE,  -- uk:borough:E09…
    premises integer NOT NULL CHECK (premises > 0),
    outdoor_4g_all_mno real NOT NULL CHECK (outdoor_4g_all_mno BETWEEN 0 AND 1),
    indoor_4g_all_mno real NOT NULL CHECK (indoor_4g_all_mno BETWEEN 0 AND 1),
    outdoor_5g_any real NOT NULL CHECK (outdoor_5g_any BETWEEN 0 AND 1),
    outdoor_5g_all real NOT NULL CHECK (outdoor_5g_all BETWEEN 0 AND 1),
    source_release_id text NOT NULL REFERENCES source_release(id)
);

CREATE OR REPLACE FUNCTION public.rebuild_area_mobile_metrics(p_source_release_id text, p_period date)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    n integer;
BEGIN
    INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
    SELECT k.id, 'borough', '%', 'higher-is-better', jsonb_build_object(
            'label', k.label, 'shortLabel', k.short_label, 'description', k.description,
            'sourceId', 'ofcom-connected-nations', 'sourceName', 'Ofcom Connected Nations',
            'methodologyPath', '/guide/people-and-homes', 'freshness', to_char(p_period, 'YYYY-MM'),
            'legend', jsonb_build_array(
                jsonb_build_object('value', 90, 'colour', '#b23a48', 'label', '90%'),
                jsonb_build_object('value', 95, 'colour', '#c96a3b', 'label', '95%'),
                jsonb_build_object('value', 98, 'colour', '#f4d35e', 'label', '98%'),
                jsonb_build_object('value', 99, 'colour', '#7ba05b', 'label', '99%'),
                jsonb_build_object('value', 100, 'colour', '#3a7d44', 'label', '100%')),
            'caveats', jsonb_build_array(
                'Predicted coverage from the networks'' models, not measured speed.',
                'Published per borough only: every neighbourhood shows its borough''s figure.')),
        p_source_release_id
    FROM (VALUES
        ('mobile-4g-indoor', 'Mobile signal: 4G indoors', '4G indoors',
         'Share of the borough''s homes and offices predicted to get 4G indoors from all four networks (Ofcom).'),
        ('mobile-5g-outdoor', 'Mobile signal: 5G outdoors', '5G outdoors',
         'Share of the borough''s homes and offices predicted to get 5G outdoors from at least one network (Ofcom).')
    ) k(id, label, short_label, description)
    ON CONFLICT (id) DO UPDATE SET carrier = EXCLUDED.carrier, unit = EXCLUDED.unit, direction = EXCLUDED.direction,
        definition = EXCLUDED.definition, source_release_id = EXCLUDED.source_release_id;

    DELETE FROM metric_value WHERE metric_id IN ('mobile-4g-indoor', 'mobile-5g-outdoor');
    INSERT INTO metric_value (geography_id, metric_id, period, value, london_percentile, england_percentile,
        sample_count, quality, source_release_id)
    SELECT m.geography_id, v.metric_id, p_period, round(100 * v.share::numeric, 2)::float8,
        round(100 * percent_rank() OVER (PARTITION BY v.metric_id ORDER BY v.share))::smallint,
        NULL, m.premises, 'observed', p_source_release_id
    FROM area_mobile m
    CROSS JOIN LATERAL (VALUES ('mobile-4g-indoor', m.indoor_4g_all_mno), ('mobile-5g-outdoor', m.outdoor_5g_any))
        v(metric_id, share);
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;
