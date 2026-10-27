-- 095: carrier and quality behind the £/m² index and its growth (issue #163).
--
-- `carrier_value` (deploy/tools/price_index.py) falls back to the MSOA, then the borough, when an
-- LSOA has under 20 sales, but stored only the LSOA's own sample count and no carrier id: a
-- fallback row could not say which area and sample it came from. `carrier_geography_id` /
-- `carrier_sample_count` on metric_value record that (NULL for observed rows: the value is the
-- area's own). Written by deploy/tools/etl_price_release.py.
--
-- `rebuild_area_price_growth()` divided the latest value by the value 10 years earlier with no
-- check that both ends are comparable (e.g. 2026-06 a fallback, 2016-06 observed). Each window now
-- carries a quality — 'observed' (both ends observed), 'fallback' (both ends fallback from the
-- same carrier), 'mixed' (different quality or carrier, or an unknown carrier on old rows) — and
-- the growth is computed only for 'observed'/'fallback'. Each window also carries the smaller of
-- the two ends' sample counts, so the API can warn when growth rests on a thin sample.
--
-- Safe to run again. Existing tables only gain nullable columns.
ALTER TABLE metric_value ADD COLUMN IF NOT EXISTS carrier_geography_id text;
ALTER TABLE metric_value ADD COLUMN IF NOT EXISTS carrier_sample_count integer;

ALTER TABLE area_price_growth ADD COLUMN IF NOT EXISTS growth_1y_quality text;
ALTER TABLE area_price_growth ADD COLUMN IF NOT EXISTS growth_1y_n integer;
ALTER TABLE area_price_growth ADD COLUMN IF NOT EXISTS growth_3y_quality text;
ALTER TABLE area_price_growth ADD COLUMN IF NOT EXISTS growth_3y_n integer;
ALTER TABLE area_price_growth ADD COLUMN IF NOT EXISTS growth_5y_quality text;
ALTER TABLE area_price_growth ADD COLUMN IF NOT EXISTS growth_5y_n integer;
ALTER TABLE area_price_growth ADD COLUMN IF NOT EXISTS growth_10y_quality text;
ALTER TABLE area_price_growth ADD COLUMN IF NOT EXISTS growth_10y_n integer;
ALTER TABLE area_price_growth ADD COLUMN IF NOT EXISTS growth_20y_quality text;
ALTER TABLE area_price_growth ADD COLUMN IF NOT EXISTS growth_20y_n integer;

-- area_market_depth (014) mirrors the growth columns from area_price_growth; it needs the new
-- ones too, and rebuild_market_depth() must copy them.
ALTER TABLE area_market_depth ADD COLUMN IF NOT EXISTS growth_1y_quality text;
ALTER TABLE area_market_depth ADD COLUMN IF NOT EXISTS growth_1y_n integer;
ALTER TABLE area_market_depth ADD COLUMN IF NOT EXISTS growth_3y_quality text;
ALTER TABLE area_market_depth ADD COLUMN IF NOT EXISTS growth_3y_n integer;
ALTER TABLE area_market_depth ADD COLUMN IF NOT EXISTS growth_5y_quality text;
ALTER TABLE area_market_depth ADD COLUMN IF NOT EXISTS growth_5y_n integer;
ALTER TABLE area_market_depth ADD COLUMN IF NOT EXISTS growth_10y_quality text;
ALTER TABLE area_market_depth ADD COLUMN IF NOT EXISTS growth_10y_n integer;

-- rebuild_market_depth() (014) copies the growth columns across; teach it the new ones.
CREATE OR REPLACE FUNCTION public.rebuild_market_depth()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE affected integer;
BEGIN
    DELETE FROM area_market_depth;
    INSERT INTO area_market_depth (geography_id, period_end, sales_12m, dwellings, dwellings_sold_12m,
        turnover_percent, tenure_known_12m, leasehold_share_of_sales, new_build_sample_36m,
        resale_sample_36m, new_build_median_ppm, resale_median_ppm, new_build_premium_percent,
        growth_period, growth_1y, growth_1y_quality, growth_1y_n,
        growth_3y, growth_3y_quality, growth_3y_n,
        growth_5y, growth_5y_quality, growth_5y_n,
        growth_10y, growth_10y_quality, growth_10y_n, source_release_id)
    WITH bounds AS (
        SELECT max(completion_date) AS period_end, max(source_release_id) AS source_release_id FROM sale
    ), placed AS (
        -- Category A sales of the last 36 months with the address's LSOA and MSOA.
        SELECT t.address_id, t.tenure, t.new_build, t.price_per_square_metre, lsoa.id AS lsoa_id,
               lsoa.parent_id AS msoa_id,
               t.completion_date > b.period_end - interval '12 months' AS in_12m
        FROM sale t
        CROSS JOIN bounds b
        JOIN address a ON a.id = t.address_id
        JOIN area_geography lsoa ON lsoa.id = a.geography_id AND lsoa.kind = 'lsoa'
        WHERE t.ppd_category = 'A' AND t.completion_date > b.period_end - interval '36 months'
    ), per_area AS (
        SELECT g.geography_id, p.*
        FROM placed p CROSS JOIN LATERAL (VALUES (p.lsoa_id), (p.msoa_id)) g(geography_id)
        WHERE g.geography_id IS NOT NULL
    ), sales AS (
        SELECT geography_id,
               count(*) FILTER (WHERE in_12m) AS sales_12m,
               count(*) FILTER (WHERE in_12m AND tenure IN ('F', 'L')) AS tenure_known_12m,
               count(*) FILTER (WHERE in_12m AND tenure = 'L') AS leasehold_12m,
               count(price_per_square_metre) FILTER (WHERE new_build) AS new_build_n,
               count(price_per_square_metre) FILTER (WHERE NOT new_build) AS resale_n,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY price_per_square_metre)
                   FILTER (WHERE new_build) AS new_build_median,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY price_per_square_metre)
                   FILTER (WHERE NOT new_build) AS resale_median
        FROM per_area GROUP BY geography_id
    ), sold AS (
        SELECT DISTINCT address_id FROM placed WHERE in_12m
    ), stock AS (
        SELECT g.geography_id, count(*) AS dwellings, count(sold.address_id) AS dwellings_sold_12m
        FROM property p
        JOIN area_geography lsoa ON lsoa.id = p.geography_id AND lsoa.kind = 'lsoa'
        LEFT JOIN sold ON sold.address_id = p.address_id
        CROSS JOIN LATERAL (VALUES (lsoa.id), (lsoa.parent_id)) g(geography_id)
        WHERE g.geography_id IS NOT NULL
        GROUP BY g.geography_id
    ), joined AS (
        SELECT coalesce(s.geography_id, d.geography_id) AS geography_id,
               coalesce(s.sales_12m, 0) AS sales_12m, coalesce(d.dwellings, 0) AS dwellings,
               coalesce(d.dwellings_sold_12m, 0) AS dwellings_sold_12m,
               coalesce(s.tenure_known_12m, 0) AS tenure_known_12m, coalesce(s.leasehold_12m, 0) AS leasehold_12m,
               coalesce(s.new_build_n, 0) AS new_build_n, coalesce(s.resale_n, 0) AS resale_n,
               s.new_build_median, s.resale_median
        FROM sales s FULL JOIN stock d ON d.geography_id = s.geography_id
    )
    SELECT j.geography_id, b.period_end, j.sales_12m, j.dwellings, j.dwellings_sold_12m,
           CASE WHEN j.dwellings > 0 THEN round((100.0 * j.dwellings_sold_12m / j.dwellings)::numeric, 2) END,
           j.tenure_known_12m,
           CASE WHEN j.tenure_known_12m > 0 THEN round((j.leasehold_12m::numeric / j.tenure_known_12m), 3) END,
           j.new_build_n, j.resale_n,
           CASE WHEN j.new_build_n >= 10 THEN round(j.new_build_median)::integer END,
           CASE WHEN j.resale_n >= 10 THEN round(j.resale_median)::integer END,
           CASE WHEN j.new_build_n >= 10 AND j.resale_n >= 10 AND j.resale_median > 0
                THEN round((100 * (j.new_build_median / j.resale_median - 1))::numeric, 1) END,
           g.period,
           g.growth_1y, g.growth_1y_quality, g.growth_1y_n,
           g.growth_3y, g.growth_3y_quality, g.growth_3y_n,
           g.growth_5y, g.growth_5y_quality, g.growth_5y_n,
           g.growth_10y, g.growth_10y_quality, g.growth_10y_n,
           b.source_release_id
    FROM joined j
    CROSS JOIN bounds b
    LEFT JOIN area_price_growth g ON g.geography_id = j.geography_id
    WHERE b.source_release_id IS NOT NULL;
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$;

-- One growth window: the value only when both ends are comparable, else a 'mixed' flag.
CREATE OR REPLACE FUNCTION public.price_growth_window(
    now_value double precision, now_quality text, now_carrier text, now_n integer,
    base_value double precision, base_quality text, base_carrier text, base_n integer,
    OUT growth real, OUT quality text, OUT n integer)
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
    IF base_value IS NULL THEN
        growth := NULL; quality := NULL; n := NULL;
    ELSIF now_quality = 'observed' AND base_quality = 'observed' THEN
        growth := round((100 * (now_value / base_value - 1))::numeric, 1);
        quality := 'observed'; n := least(now_n, base_n);
    ELSIF now_quality = 'fallback' AND base_quality = 'fallback'
          AND now_carrier IS NOT NULL AND now_carrier = base_carrier THEN
        growth := round((100 * (now_value / base_value - 1))::numeric, 1);
        quality := 'fallback'; n := least(now_n, base_n);
    ELSE
        -- Different quality or carrier at the two ends (or an unknown carrier on rows written
        -- before 095): the two values are not comparable, so no growth, only the flag.
        growth := NULL; quality := 'mixed'; n := least(now_n, base_n);
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.rebuild_area_price_growth()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE affected integer;
BEGIN
    DELETE FROM area_price_growth;
    INSERT INTO area_price_growth (
        geography_id, period,
        growth_1y, growth_1y_quality, growth_1y_n,
        growth_3y, growth_3y_quality, growth_3y_n,
        growth_5y, growth_5y_quality, growth_5y_n,
        growth_10y, growth_10y_quality, growth_10y_n,
        growth_20y, growth_20y_quality, growth_20y_n)
    WITH latest AS (
        SELECT geography_id, max(period) AS period
        FROM metric_value WHERE metric_id = 'price-per-square-metre'
        GROUP BY geography_id
    ),
    vals AS (
        SELECT v.geography_id, v.period, v.value,
               v.quality::text AS quality, v.carrier_geography_id, v.carrier_sample_count
        FROM metric_value v
        JOIN latest l ON l.geography_id = v.geography_id
        WHERE v.metric_id = 'price-per-square-metre'
          AND v.value > 0
          AND v.period > l.period - interval '21 years'
    )
    SELECT
        l.geography_id, l.period,
        (w1.growth), (w1.quality), (w1.n),
        (w3.growth), (w3.quality), (w3.n),
        (w5.growth), (w5.quality), (w5.n),
        (w10.growth), (w10.quality), (w10.n),
        (w20.growth), (w20.quality), (w20.n)
    FROM latest l
    LEFT JOIN vals now_v ON now_v.geography_id = l.geography_id AND now_v.period = l.period
    LEFT JOIN vals v1 ON v1.geography_id = l.geography_id AND v1.period = l.period - interval '1 year'
    LEFT JOIN vals v3 ON v3.geography_id = l.geography_id AND v3.period = l.period - interval '3 years'
    LEFT JOIN vals v5 ON v5.geography_id = l.geography_id AND v5.period = l.period - interval '5 years'
    LEFT JOIN vals v10 ON v10.geography_id = l.geography_id AND v10.period = l.period - interval '10 years'
    LEFT JOIN vals v20 ON v20.geography_id = l.geography_id AND v20.period = l.period - interval '20 years'
    CROSS JOIN LATERAL public.price_growth_window(
        now_v.value, now_v.quality, now_v.carrier_geography_id, now_v.carrier_sample_count,
        v1.value, v1.quality, v1.carrier_geography_id, v1.carrier_sample_count) AS w1
    CROSS JOIN LATERAL public.price_growth_window(
        now_v.value, now_v.quality, now_v.carrier_geography_id, now_v.carrier_sample_count,
        v3.value, v3.quality, v3.carrier_geography_id, v3.carrier_sample_count) AS w3
    CROSS JOIN LATERAL public.price_growth_window(
        now_v.value, now_v.quality, now_v.carrier_geography_id, now_v.carrier_sample_count,
        v5.value, v5.quality, v5.carrier_geography_id, v5.carrier_sample_count) AS w5
    CROSS JOIN LATERAL public.price_growth_window(
        now_v.value, now_v.quality, now_v.carrier_geography_id, now_v.carrier_sample_count,
        v10.value, v10.quality, v10.carrier_geography_id, v10.carrier_sample_count) AS w10
    CROSS JOIN LATERAL public.price_growth_window(
        now_v.value, now_v.quality, now_v.carrier_geography_id, now_v.carrier_sample_count,
        v20.value, v20.quality, v20.carrier_geography_id, v20.carrier_sample_count) AS w20;
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$;
