-- 083: Company and overseas ownership, loaded by deploy/tools/etl_ownership.py from HM Land Registry's
-- UK companies that own property (CCOD) and Overseas companies that own property (OCOD) full files.
--
--   area_ownership  per LSOA, MSOA and borough: land titles held by UK companies (CCOD) and by overseas
--                   companies (OCOD), the homes there (rows in `property`), and on borough rows the
--                   titles whose postcode could not be placed in an LSOA (by the file's District).
--                   Each title's postcode is placed with ONSPD (postcode_civic); MSOAs and boroughs
--                   are sums of their LSOAs (roll_up_area_ownership), so the levels agree.
--   metric_value    `ownership-company-share` and `ownership-overseas-share`: per LSOA, titles per
--                   100 homes (capped at 100) with its London percentile; under 10 homes suppressed.
--                   Written by load_ownership_metrics(); map layers and `range:<layer>` criteria.
--
-- Counts only: never a proprietor's name, company number or address, never a title number.
-- The card block is behind CLOSE_KNIT_OWNERSHIP (FLAGS.md) until the files are loaded under the owner's
-- HMLR account. Safe to run again.

CREATE TABLE IF NOT EXISTS area_ownership (
    geography_id text PRIMARY KEY REFERENCES area_geography(id) ON DELETE CASCADE,
    titles_company integer NOT NULL CHECK (titles_company >= 0),
    titles_overseas integer NOT NULL CHECK (titles_overseas >= 0),
    homes integer NOT NULL CHECK (homes >= 0),
    unmatched integer NOT NULL CHECK (unmatched >= 0),     -- borough rows only; 0 below
    source_release_id text NOT NULL REFERENCES source_release(id)
);

-- Sum the LSOA rows up to MSOAs, then the MSOAs up to boroughs (unmatched stays as loaded on boroughs).
CREATE OR REPLACE FUNCTION public.roll_up_area_ownership()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    child text;
    n integer;
BEGIN
    FOREACH child IN ARRAY ARRAY['lsoa', 'msoa'] LOOP
        INSERT INTO area_ownership (geography_id, titles_company, titles_overseas, homes, unmatched, source_release_id)
        SELECT g.parent_id, sum(o.titles_company), sum(o.titles_overseas), sum(o.homes), 0, min(o.source_release_id)
        FROM area_ownership o JOIN area_geography g ON g.id = o.geography_id
        WHERE g.kind::text = child AND g.parent_id IS NOT NULL
        GROUP BY g.parent_id
        ON CONFLICT (geography_id) DO UPDATE
            SET titles_company = EXCLUDED.titles_company, titles_overseas = EXCLUDED.titles_overseas,
                homes = EXCLUDED.homes, source_release_id = EXCLUDED.source_release_id;
    END LOOP;
    SELECT count(*) INTO n FROM area_ownership;
    RETURN n;
END;
$$;

-- The two map layers from the LSOA rows: definitions (labels, legend, caveats) and one value per LSOA
-- for the period (the file's month). Returns the metric_value rows written.
CREATE OR REPLACE FUNCTION public.load_ownership_metrics(p_source_release_id text, p_period date)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    n integer;
    caveats jsonb := jsonb_build_array(
        'Counts land titles, not homes: one title can hold a whole block, and a home can sit on more than one title.',
        'Includes commercial titles whose address looks residential.',
        'Titles are placed by the postcode in their address; titles with none are counted on the borough only.',
        'Areas with fewer than 10 homes show no share.',
        'Contains HM Land Registry data © Crown copyright and database right ' || to_char(p_period, 'YYYY') || '.');
BEGIN
    INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
    SELECT m.id, 'lsoa', '%', 'higher-is-more', jsonb_build_object(
        'label', m.label, 'shortLabel', m.short,
        'description', m.description,
        'legend', m.legend,
        'sourceId', 'hmlr-ccod-ocod', 'sourceName', 'HM Land Registry company and overseas ownership (CCOD, OCOD)',
        'methodologyPath', '/guide/local-market', 'freshness', to_char(p_period, 'YYYY-MM'),
        'caveats', caveats), p_source_release_id
    FROM (VALUES
        ('ownership-company-share', 'Company-owned homes', 'Company owned',
         'Land titles held by UK companies (HM Land Registry CCOD) per 100 homes in the area.',
         '[{"value": 0, "colour": "#f2f0f7", "label": "0"}, {"value": 2, "colour": "#cbc9e2", "label": "2"},
           {"value": 5, "colour": "#9e9ac8", "label": "5"}, {"value": 10, "colour": "#756bb1", "label": "10"},
           {"value": 20, "colour": "#54278f", "label": "20+"}]'::jsonb),
        ('ownership-overseas-share', 'Overseas-owned homes', 'Overseas owned',
         'Land titles held by overseas companies (HM Land Registry OCOD) per 100 homes in the area.',
         '[{"value": 0, "colour": "#f2f0f7", "label": "0"}, {"value": 0.5, "colour": "#cbc9e2", "label": "0.5"},
           {"value": 1, "colour": "#9e9ac8", "label": "1"}, {"value": 2, "colour": "#756bb1", "label": "2"},
           {"value": 5, "colour": "#54278f", "label": "5+"}]'::jsonb)
    ) m(id, label, short, description, legend)
    ON CONFLICT (id) DO UPDATE SET definition = EXCLUDED.definition, source_release_id = EXCLUDED.source_release_id,
        unit = EXCLUDED.unit, direction = EXCLUDED.direction;

    DELETE FROM metric_value WHERE metric_id IN ('ownership-company-share', 'ownership-overseas-share');
    INSERT INTO metric_value (geography_id, metric_id, period, value, london_percentile, sample_count, quality,
        source_release_id)
    WITH shares AS (
        SELECT o.geography_id, k.metric_id, o.homes,
               CASE WHEN o.homes >= 10
                    THEN round(least(100, 100.0 * CASE k.metric_id WHEN 'ownership-company-share' THEN o.titles_company
                                                                  ELSE o.titles_overseas END / o.homes), 1)::float8
               END AS share
        FROM area_ownership o
        JOIN area_geography g ON g.id = o.geography_id AND g.kind = 'lsoa'
        CROSS JOIN (VALUES ('ownership-company-share'), ('ownership-overseas-share')) k(metric_id)
    ), ranked AS (
        SELECT geography_id, metric_id,
               round(100 * percent_rank() OVER (PARTITION BY metric_id ORDER BY share))::smallint AS pct
        FROM shares WHERE share IS NOT NULL
    )
    SELECT s.geography_id, s.metric_id, p_period, s.share, r.pct, s.homes,
           (CASE WHEN s.share IS NULL THEN 'suppressed' ELSE 'observed' END)::metric_quality, p_source_release_id
    FROM shares s LEFT JOIN ranked r USING (geography_id, metric_id);
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;
