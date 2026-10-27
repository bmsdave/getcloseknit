-- 096: restate by a same-carrier £/m² index (issue #185).
--
-- `adjusted` in rebuild_area_price_bands() and rebuild_stock_values() restated every sale by
-- price * now_v.value / at_sale.value, joining the LSOA's price-per-square-metre rows at the
-- sale month and at latest with no quality check. metric_value holds fallback rows (the MSOA's
-- or borough's median) whenever the LSOA has under 20 sales in the window, so the ratio
-- routinely divided an observed LSOA median by a borough median or vice versa — e.g. a £500k
-- 2023 sale restated to £620k (+24%) although the borough index moved +6%.
--
-- Both rebuilds now restate only when both ends come from the same carrier: the LSOA's own
-- index when both months are observed, else the fallback carrier's own index when both months
-- fell back to the same carrier area (carrier_geography_id, migration 095). A mixed pair is
-- dropped, not mixed. property_stock_value.index_carrier/index_geography_id now name the
-- carrier actually used, and both rebuilds RAISE NOTICE the carrier mix.
--
-- The carrier columns are added defensively: 096 applies cleanly whether or not 095 has, but
-- rows written before the ETL carries carrier ids (deploy/tools/etl_price_release.py, #193)
-- read as mixed and are withheld until the next price release.
--
-- The same bodies are applied in place to 008-sales.sql and 040-area-price-bands.sql, so a
-- fresh database and the source-text tests see the fixed versions; this file lets an existing
-- database pick the fix up by applying one migration. Safe to re-run.

ALTER TABLE metric_value ADD COLUMN IF NOT EXISTS carrier_geography_id text;
ALTER TABLE metric_value ADD COLUMN IF NOT EXISTS carrier_sample_count integer;

CREATE OR REPLACE FUNCTION public.rebuild_area_price_bands(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    latest date;
    first_period date;
    window_start date;
    affected integer;
    n_window integer;
    n_adjusted integer;
    c_lsoa integer;
    c_msoa integer;
    c_borough integer;
BEGIN
    SELECT max(period), min(period) INTO latest, first_period
    FROM metric_value WHERE metric_id = 'price-per-square-metre';
    IF latest IS NULL THEN
        RETURN 0;
    END IF;
    window_start := make_date(EXTRACT(YEAR FROM latest)::integer - 3, 1, 1);
    DELETE FROM area_price_band;
    DELETE FROM area_price_year;

    DROP TABLE IF EXISTS located_sale;
    -- Standard market sales of the four Price Paid types, with their LSOA, MSOA and borough.
    CREATE TEMP TABLE located_sale ON COMMIT DROP AS
    SELECT s.price, s.property_type, s.sale_month, EXTRACT(YEAR FROM s.completion_date)::smallint AS year,
           l.id AS lsoa_id, m.id AS msoa_id, m.parent_id AS borough_id
    FROM sale s
    JOIN address a ON a.id = s.address_id
    JOIN area_geography l ON l.id = a.geography_id AND l.kind = 'lsoa'
    JOIN area_geography m ON m.id = l.parent_id AND m.kind = 'msoa'
    WHERE s.source_release_id = p_source_release_id
      AND s.ppd_category = 'A' AND s.property_type IN ('D', 'S', 'T', 'F') AND s.price >= 20000;

    -- Each in-window sale adjusted to the latest month by its carrier's £/m² index, but only when both ends come
    -- from the same carrier (#185): the LSOA's own index when both months are observed, else the
    -- fallback carrier's own index when both months fell back to the same carrier area
    -- (carrier_geography_id, migration 095). A mixed pair — observed at one end and fallback at
    -- the other, or fallbacks from two different carriers — would divide an observed LSOA median
    -- by a borough median or vice versa, so the sale is dropped from the band, not mixed.
    DROP TABLE IF EXISTS adjusted_sale;
    CREATE TEMP TABLE adjusted_sale ON COMMIT DROP AS
    SELECT ls.lsoa_id, ls.msoa_id, ls.borough_id, ls.property_type,
           ls.price * now_v.value / at_sale.value AS price,
           CASE WHEN at_sale.quality = 'observed' THEN 'lsoa'
                ELSE split_part(at_sale.carrier_geography_id, ':', 2) END AS carrier
    FROM located_sale ls
    JOIN metric_value at_sale ON at_sale.metric_id = 'price-per-square-metre'
         AND at_sale.geography_id = ls.lsoa_id AND at_sale.period = GREATEST(ls.sale_month, first_period)
    JOIN metric_value now_v ON now_v.metric_id = 'price-per-square-metre'
         AND now_v.geography_id = ls.lsoa_id AND now_v.period = latest
    WHERE ls.sale_month >= window_start AND ls.sale_month <= latest
      AND at_sale.value > 0 AND now_v.value > 0
      AND now_v.value / at_sale.value BETWEEN 0.25 AND 6
      AND (at_sale.quality = 'observed' AND now_v.quality = 'observed'
           OR (at_sale.quality = 'fallback' AND now_v.quality = 'fallback'
               AND at_sale.carrier_geography_id IS NOT NULL
               AND at_sale.carrier_geography_id = now_v.carrier_geography_id));

    SELECT count(*) INTO n_window FROM located_sale
     WHERE sale_month >= window_start AND sale_month <= latest;
    SELECT count(*) FILTER (WHERE carrier = 'lsoa'),
           count(*) FILTER (WHERE carrier = 'msoa'),
           count(*) FILTER (WHERE carrier = 'borough')
      INTO c_lsoa, c_msoa, c_borough FROM adjusted_sale;
    n_adjusted := c_lsoa + c_msoa + c_borough;
    RAISE NOTICE 'rebuild_area_price_bands: adjusted % of % in-window sales to % by same-carrier index (lsoa %, msoa %, borough %); % dropped as mixed-carrier',
        n_adjusted, n_window, latest, c_lsoa, c_msoa, c_borough, n_window - n_adjusted;

    INSERT INTO area_price_band (geography_id, property_type, window_start, period, sales,
        p10, p25, p50, p75, p90, source_release_id)
    WITH by_level AS (
        SELECT lsoa_id AS geography_id, property_type, price FROM adjusted_sale
        UNION ALL SELECT msoa_id, property_type, price FROM adjusted_sale
        UNION ALL SELECT borough_id, property_type, price FROM adjusted_sale WHERE borough_id IS NOT NULL
    )
    SELECT geography_id, coalesce(property_type, '*'), window_start, latest, count(*),
           round(percentile_cont(0.10) WITHIN GROUP (ORDER BY price))::integer,
           round(percentile_cont(0.25) WITHIN GROUP (ORDER BY price))::integer,
           round(percentile_cont(0.50) WITHIN GROUP (ORDER BY price))::integer,
           round(percentile_cont(0.75) WITHIN GROUP (ORDER BY price))::integer,
           round(percentile_cont(0.90) WITHIN GROUP (ORDER BY price))::integer,
           p_source_release_id
    FROM by_level
    GROUP BY GROUPING SETS ((geography_id, property_type), (geography_id));
    GET DIAGNOSTICS affected = ROW_COUNT;

    INSERT INTO area_price_year (geography_id, property_type, year, sales, p10, p25, p50, p75, p90,
        source_release_id)
    WITH by_level AS (
        SELECT lsoa_id AS geography_id, property_type, year, price FROM located_sale
        UNION ALL SELECT msoa_id, property_type, year, price FROM located_sale
        UNION ALL SELECT borough_id, property_type, year, price FROM located_sale WHERE borough_id IS NOT NULL
    )
    SELECT geography_id, property_type, year, count(*),
           round(percentile_cont(0.10) WITHIN GROUP (ORDER BY price))::integer,
           round(percentile_cont(0.25) WITHIN GROUP (ORDER BY price))::integer,
           round(percentile_cont(0.50) WITHIN GROUP (ORDER BY price))::integer,
           round(percentile_cont(0.75) WITHIN GROUP (ORDER BY price))::integer,
           round(percentile_cont(0.90) WITHIN GROUP (ORDER BY price))::integer,
           p_source_release_id
    FROM by_level
    GROUP BY geography_id, property_type, year;

    -- "Typical home price": the median adjusted price of a whole home per LSOA, by type.
    DELETE FROM metric_value WHERE metric_id IN ('typical-price', 'typical-price-flat',
        'typical-price-terraced', 'typical-price-semi', 'typical-price-detached');
    INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
    SELECT k.metric_id, 'lsoa', '£', 'higher-is-more', '{}'::jsonb, p_source_release_id
    FROM (VALUES ('typical-price'), ('typical-price-flat'), ('typical-price-terraced'),
                 ('typical-price-semi'), ('typical-price-detached')) k(metric_id)
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO metric_value (geography_id, metric_id, period, value, london_percentile,
        england_percentile, sample_count, quality, source_release_id)
    WITH kinds(code, metric_id) AS (
        VALUES ('*', 'typical-price'), ('F', 'typical-price-flat'), ('T', 'typical-price-terraced'),
               ('S', 'typical-price-semi'), ('D', 'typical-price-detached')
    ), chosen AS (
        SELECT l.id AS geography_id, k.metric_id,
               CASE WHEN bl.sales >= 20 THEN bl.p50 WHEN bm.sales >= 20 THEN bm.p50
                    WHEN bb.sales >= 5 THEN bb.p50 END AS value,
               CASE WHEN bl.sales >= 20 THEN bl.sales WHEN bm.sales >= 20 THEN bm.sales
                    WHEN bb.sales >= 5 THEN bb.sales ELSE coalesce(bl.sales, 0) END AS n,
               CASE WHEN bl.sales >= 20 THEN 'observed' WHEN bm.sales >= 20 OR bb.sales >= 5 THEN 'fallback'
                    ELSE 'suppressed' END::metric_quality AS quality
        FROM area_geography l
        JOIN area_geography m ON m.id = l.parent_id
        CROSS JOIN kinds k
        LEFT JOIN area_price_band bl ON bl.geography_id = l.id AND bl.property_type = k.code
        LEFT JOIN area_price_band bm ON bm.geography_id = m.id AND bm.property_type = k.code
        LEFT JOIN area_price_band bb ON bb.geography_id = m.parent_id AND bb.property_type = k.code
        WHERE l.kind = 'lsoa'
    ), ranked AS (
        SELECT geography_id, metric_id,
               round(100 * percent_rank() OVER (PARTITION BY metric_id ORDER BY value))::smallint AS pct
        FROM chosen WHERE value IS NOT NULL
    )
    SELECT c.geography_id, c.metric_id, latest, c.value, r.pct, NULL, c.n, c.quality, p_source_release_id
    FROM chosen c
    LEFT JOIN ranked r ON r.geography_id = c.geography_id AND r.metric_id = c.metric_id;

    -- Definitions: a five-step legend at the 10th–90th percentiles of each layer's LSOA values.
    UPDATE metric_definition d
       SET source_release_id = p_source_release_id,
           definition = jsonb_build_object(
               'label', 'Typical home price' || q.suffix,
               'shortLabel', 'Typical home price',
               'description', 'Median price of standard sales' || q.words || ' since ' || EXTRACT(YEAR FROM window_start)
                   || ', each adjusted to ' || to_char(latest, 'Mon YYYY') || ' by the local price index. '
                   || 'Area-level only: not a valuation of any home.',
               'sourceId', 'hmlr-price-paid', 'sourceName', 'HM Land Registry Price Paid',
               'methodologyPath', '/guide/typical-price', 'freshness', to_char(latest, 'YYYY-MM'),
               'legend', CASE WHEN q.c1 IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(
                   jsonb_build_object('value', q.c1, 'colour', '#c7e9b4', 'label', '£' || round(q.c1 / 1000) || 'k'),
                   jsonb_build_object('value', q.c2, 'colour', '#7fcdbb', 'label', '£' || round(q.c2 / 1000) || 'k'),
                   jsonb_build_object('value', q.c3, 'colour', '#1d91c0', 'label', '£' || round(q.c3 / 1000) || 'k'),
                   jsonb_build_object('value', q.c4, 'colour', '#253494', 'label', '£' || round(q.c4 / 1000) || 'k'),
                   jsonb_build_object('value', q.c5, 'colour', '#081d58', 'label', '£' || round(q.c5 / 1000) || 'k+')) END,
               'caveats', jsonb_build_array(
                   'Areas with fewer than 20 sales of the type use their MSOA, then their borough (at least 5 sales); below that no value is shown.',
                   'Standard market sales only (Price Paid category A). The index adjusts for the market, not for condition or improvements.',
                   'Contains HM Land Registry data © Crown copyright and database right. Licensed under the Open Government Licence v3.0.'))
      FROM (
        SELECT k.metric_id,
               CASE k.metric_id WHEN 'typical-price' THEN '' WHEN 'typical-price-flat' THEN ': flats'
                    WHEN 'typical-price-terraced' THEN ': terraced' WHEN 'typical-price-semi' THEN ': semi-detached'
                    ELSE ': detached' END AS suffix,
               CASE k.metric_id WHEN 'typical-price' THEN '' WHEN 'typical-price-flat' THEN ' of flats'
                    WHEN 'typical-price-terraced' THEN ' of terraced houses'
                    WHEN 'typical-price-semi' THEN ' of semi-detached houses' ELSE ' of detached houses' END AS words,
               round(percentile_cont(0.1) WITHIN GROUP (ORDER BY v.value) / 5000) * 5000 AS c1,
               round(percentile_cont(0.3) WITHIN GROUP (ORDER BY v.value) / 5000) * 5000 AS c2,
               round(percentile_cont(0.5) WITHIN GROUP (ORDER BY v.value) / 5000) * 5000 AS c3,
               round(percentile_cont(0.7) WITHIN GROUP (ORDER BY v.value) / 5000) * 5000 AS c4,
               round(percentile_cont(0.9) WITHIN GROUP (ORDER BY v.value) / 5000) * 5000 AS c5
        FROM (VALUES ('typical-price'), ('typical-price-flat'), ('typical-price-terraced'),
                     ('typical-price-semi'), ('typical-price-detached')) k(metric_id)
        LEFT JOIN metric_value v ON v.metric_id = k.metric_id AND v.value IS NOT NULL
        GROUP BY k.metric_id
      ) q
     WHERE d.id = q.metric_id;
    RETURN affected;
END;
$$;

CREATE OR REPLACE FUNCTION public.rebuild_stock_values(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    affected integer;
    c_lsoa integer;
    c_msoa integer;
    c_borough integer;
BEGIN
    DELETE FROM property_stock_value;
    -- The dwelling's last standard sale restated by its carrier's £/m² index, but only when
    -- both ends come from the same carrier (#185): the LSOA's own index when both months are
    -- observed, else the fallback carrier's own index when both months fell back to the same
    -- carrier area (carrier_geography_id, migration 095). A mixed pair is dropped, not mixed:
    -- index_carrier/index_geography_id always name the carrier actually used.
    DROP TABLE IF EXISTS restated_stock;
    CREATE TEMP TABLE restated_stock ON COMMIT DROP AS
    WITH bounds AS (
        SELECT max(period) AS latest, min(period) AS first
        FROM metric_value WHERE metric_id = 'price-per-square-metre'
    ), last_sale AS (
        SELECT DISTINCT ON (p.uprn) p.uprn, p.geography_id, s.sale_month, s.completion_date, s.price,
               s.floor_area_square_metres, s.price_per_square_metre
        FROM property p
        JOIN sale s ON s.address_id = p.address_id
        WHERE s.ppd_category = 'A' AND s.property_type <> 'O' AND s.price >= 20000
          AND s.price_per_square_metre IS NOT NULL
        ORDER BY p.uprn, s.completion_date DESC, s.price DESC
    ), indexed AS (
        SELECT l.*, b.latest, GREATEST(l.sale_month, b.first) AS index_period FROM last_sale l, bounds b
    )
    SELECT i.uprn, i.latest AS period, i.sale_month AS sale_period, i.completion_date,
           i.price AS nominal_price, i.floor_area_square_metres,
           i.price_per_square_metre AS sale_price_per_square_metre,
           CASE WHEN at_sale.quality = 'observed' THEN 'lsoa'
                ELSE split_part(at_sale.carrier_geography_id, ':', 2) END AS index_carrier,
           COALESCE(at_sale.carrier_geography_id, i.geography_id) AS index_geography_id,
           at_sale.value AS index_at_sale, now_v.value AS index_latest,
           round((i.price * now_v.value / at_sale.value / i.floor_area_square_metres)::numeric, 2)
               AS restated_price_per_square_metre,
           round(i.price * now_v.value / at_sale.value)::integer AS restated_value,
           stock_value_confidence(i.sale_month, i.latest,
               CASE WHEN at_sale.quality = 'observed' THEN 'lsoa'
                    ELSE split_part(at_sale.carrier_geography_id, ':', 2) END) AS confidence
    FROM indexed i
    JOIN metric_value at_sale ON at_sale.metric_id = 'price-per-square-metre'
         AND at_sale.geography_id = i.geography_id AND at_sale.period = i.index_period
    JOIN metric_value now_v ON now_v.metric_id = 'price-per-square-metre'
         AND now_v.geography_id = i.geography_id AND now_v.period = i.latest
    WHERE at_sale.value > 0 AND now_v.value > 0
      AND now_v.value / at_sale.value BETWEEN 0.25 AND 6
      AND (at_sale.quality = 'observed' AND now_v.quality = 'observed'
           OR (at_sale.quality = 'fallback' AND now_v.quality = 'fallback'
               AND at_sale.carrier_geography_id IS NOT NULL
               AND at_sale.carrier_geography_id = now_v.carrier_geography_id));

    SELECT count(*) FILTER (WHERE index_carrier = 'lsoa'),
           count(*) FILTER (WHERE index_carrier = 'msoa'),
           count(*) FILTER (WHERE index_carrier = 'borough')
      INTO c_lsoa, c_msoa, c_borough FROM restated_stock;
    RAISE NOTICE 'rebuild_stock_values: restated % dwellings by same-carrier index (lsoa %, msoa %, borough %); mixed-carrier sales dropped',
        c_lsoa + c_msoa + c_borough, c_lsoa, c_msoa, c_borough;

    INSERT INTO property_stock_value (uprn, period, sale_period, completion_date, nominal_price,
        floor_area_square_metres, sale_price_per_square_metre, index_carrier, index_geography_id,
        index_at_sale, index_latest, restated_price_per_square_metre, restated_value, confidence,
        source_release_id)
    SELECT uprn, period, sale_period, completion_date, nominal_price, floor_area_square_metres,
           sale_price_per_square_metre, index_carrier, index_geography_id, index_at_sale, index_latest,
           restated_price_per_square_metre, restated_value, confidence, p_source_release_id
    FROM restated_stock;
    GET DIAGNOSTICS affected = ROW_COUNT;

    -- Area stock value: median restated £/m² of the valued dwellings per LSOA.
    DELETE FROM metric_value WHERE metric_id = 'stock-value-per-square-metre';
    INSERT INTO metric_value (geography_id, metric_id, period, value, london_percentile,
        england_percentile, sample_count, quality, source_release_id)
    WITH medians AS (
        SELECT p.geography_id, v.period,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY v.restated_price_per_square_metre) AS value,
               count(*) AS n
        FROM property_stock_value v JOIN property p ON p.uprn = v.uprn
        GROUP BY p.geography_id, v.period
    ), ranked AS (
        SELECT *, round(100 * percent_rank() OVER (ORDER BY value))::smallint AS pct FROM medians WHERE n >= 10
    )
    SELECT g.id, 'stock-value-per-square-metre', m.period,
           CASE WHEN m.n >= 10 THEN round(m.value::numeric, 2) END, r.pct, NULL, m.n,
           CASE WHEN m.n >= 10 THEN 'observed'::metric_quality ELSE 'suppressed'::metric_quality END,
           p_source_release_id
    FROM area_geography g
    JOIN medians m ON m.geography_id = g.id
    LEFT JOIN ranked r ON r.geography_id = g.id
    WHERE g.kind = 'lsoa';
    UPDATE metric_definition
       SET definition = jsonb_set(definition, '{freshness}',
               to_jsonb(to_char((SELECT max(period) FROM property_stock_value), 'YYYY-MM'))),
           source_release_id = p_source_release_id
     WHERE id = 'stock-value-per-square-metre';
    RETURN affected;
END;
$$;
