-- 133: London's price rebuilds replace London's rows only (the October Price Paid refresh incident).
--
-- The rebuilds the London per-home build runs (etl_sales.py load, then again after every £/m² index,
-- etl_price_release.py) deleted whole tables: every area_price_band, area_price_year, area_price_growth,
-- area_market_depth, zone and postcode-sector row, and every typical-price and stock-value value, England's
-- included. rebuild_area_price_bands then wrote a suppressed (null) typical price for every English LSOA, so
-- outside London every typical price and £/m² was null until the England prices bundle ran again.
--
-- Each rebuild now deletes and writes only its own scope:
--   London geographies   every area not in outside_london_area (the England bundle's OUTSIDE_LONDON: an area
--                        whose region is not London), so an area without a region stays London's as before;
--   London sources       the zone tables and city blocks, whose England rows carry a source ending '-england'.
-- Per-home tables (property_stock_value, sale_pin, property_sale_band) hold London homes only; they are scoped
-- by the home's area all the same. Where a London row and an England row share a key (a postcode sector or zone
-- on the boundary) London's wins, as the England bundle's ON CONFLICT DO NOTHING already assumes.
-- rebuild_area_good_value() is England-wide (every bundle runs it) and reads complete inputs now: unchanged.
-- Bodies are the live ones (after 129's borough -> lad rewrite) with the scope added. Safe to run again.

CREATE OR REPLACE VIEW outside_london_area AS
SELECT area_id FROM area_region WHERE region_code <> 'E12000007';

CREATE OR REPLACE FUNCTION public.rebuild_stock_values(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    affected integer;
    c_lsoa integer;
    c_msoa integer;
    c_borough integer;
    c_pre_index integer;
BEGIN
    DELETE FROM property_stock_value v
    WHERE NOT EXISTS (SELECT 1 FROM property p JOIN outside_london_area o ON o.area_id = p.geography_id
                      WHERE p.uprn = v.uprn);
    -- The dwelling's last standard sale restated by its carrier's £/m² index, but only when
    -- both ends come from the same carrier (#185): the LSOA's own index when both months are
    -- observed, else the fallback carrier's own index when both months fell back to the same
    -- carrier area (carrier_geography_id, migration 095). A mixed pair is dropped, not mixed:
    -- index_carrier/index_geography_id always name the carrier actually used.
    -- A sale before the index's first month (June 2006) is kept with its recorded facts but
    -- never restated (#249): its restated_* and index_* columns stay null and
    -- unrestated_reason = 'pre-index-sale', so it is left out of every median and count
    -- instead of being moved forward as if it had sold in the index's first month.
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
          AND NOT EXISTS (SELECT 1 FROM outside_london_area o WHERE o.area_id = p.geography_id)
        ORDER BY p.uprn, s.completion_date DESC, s.price DESC
    ), indexed AS (
        SELECT l.*, b.latest, b.first FROM last_sale l, bounds b
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
                    ELSE split_part(at_sale.carrier_geography_id, ':', 2) END) AS confidence,
           NULL::text AS unrestated_reason
    FROM indexed i
    -- The index at the sale's own month: a sale before the first index month has no row here
    -- and takes the unrestated branch below, never the first month's index.
    JOIN metric_value at_sale ON at_sale.metric_id = 'price-per-square-metre'
         AND at_sale.geography_id = i.geography_id AND at_sale.period = i.sale_month
    JOIN metric_value now_v ON now_v.metric_id = 'price-per-square-metre'
         AND now_v.geography_id = i.geography_id AND now_v.period = i.latest
    WHERE i.sale_month >= i.first
      AND at_sale.value > 0 AND now_v.value > 0
      AND now_v.value / at_sale.value BETWEEN 0.25 AND 6
      AND (at_sale.quality = 'observed' AND now_v.quality = 'observed'
           OR (at_sale.quality = 'fallback' AND now_v.quality = 'fallback'
               AND at_sale.carrier_geography_id IS NOT NULL
               AND at_sale.carrier_geography_id = now_v.carrier_geography_id))
    UNION ALL
    SELECT i.uprn, i.latest, i.sale_month, i.completion_date, i.price, i.floor_area_square_metres,
           i.price_per_square_metre, NULL, i.geography_id, NULL, NULL, NULL, NULL, 'low',
           'pre-index-sale'
    FROM indexed i
    WHERE i.sale_month < i.first;

    SELECT count(*) FILTER (WHERE index_carrier = 'lsoa'),
           count(*) FILTER (WHERE index_carrier = 'msoa'),
           count(*) FILTER (WHERE index_carrier = 'lad'),
           count(*) FILTER (WHERE unrestated_reason = 'pre-index-sale')
      INTO c_lsoa, c_msoa, c_borough, c_pre_index FROM restated_stock;
    RAISE NOTICE 'rebuild_stock_values: restated % dwellings by same-carrier index (lsoa %, msoa %, borough %); mixed-carrier sales dropped; % pre-index sales kept unrestated',
        c_lsoa + c_msoa + c_borough, c_lsoa, c_msoa, c_borough, c_pre_index;

    INSERT INTO property_stock_value (uprn, period, sale_period, completion_date, nominal_price,
        floor_area_square_metres, sale_price_per_square_metre, index_carrier, index_geography_id,
        index_at_sale, index_latest, restated_price_per_square_metre, restated_value, confidence,
        unrestated_reason, source_release_id)
    SELECT uprn, period, sale_period, completion_date, nominal_price, floor_area_square_metres,
           sale_price_per_square_metre, index_carrier, index_geography_id, index_at_sale, index_latest,
           restated_price_per_square_metre, restated_value, confidence, unrestated_reason,
           p_source_release_id
    FROM restated_stock;
    GET DIAGNOSTICS affected = ROW_COUNT;

    -- Area stock value: median restated £/m² of the restated dwellings per London LSOA. Unrestated
    -- (pre-index) dwellings are in neither the median nor the count.
    DELETE FROM metric_value v
    WHERE v.metric_id = 'stock-value-per-square-metre'
      AND NOT EXISTS (SELECT 1 FROM outside_london_area o WHERE o.area_id = v.geography_id);
    INSERT INTO metric_value (geography_id, metric_id, period, value, region_percentile,
        country_percentile, sample_count, quality, source_release_id)
    WITH medians AS (
        SELECT p.geography_id, v.period,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY v.restated_price_per_square_metre) AS value,
               count(*) AS n
        FROM property_stock_value v JOIN property p ON p.uprn = v.uprn
        WHERE v.restated_price_per_square_metre IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM outside_london_area o WHERE o.area_id = p.geography_id)
        GROUP BY p.geography_id, v.period
    ), ranked AS (
        SELECT *, round(100 * percent_rank() OVER (PARTITION BY area_rank_region(geography_id) ORDER BY value))::smallint AS pct
        FROM medians WHERE n >= 10
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

CREATE OR REPLACE FUNCTION public.rebuild_area_price_growth()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE affected integer;
BEGIN
    -- London's areas only: England's growth rows come from the England prices bundle.
    DELETE FROM area_price_growth g
    WHERE NOT EXISTS (SELECT 1 FROM outside_london_area o WHERE o.area_id = g.geography_id);
    INSERT INTO area_price_growth (
        geography_id, period,
        growth_1y, growth_1y_quality, growth_1y_n,
        growth_3y, growth_3y_quality, growth_3y_n,
        growth_5y, growth_5y_quality, growth_5y_n,
        growth_10y, growth_10y_quality, growth_10y_n,
        growth_20y, growth_20y_quality, growth_20y_n)
    WITH latest AS (
        SELECT v.geography_id, max(v.period) AS period
        FROM metric_value v
        WHERE v.metric_id = 'price-per-square-metre'
          AND NOT EXISTS (SELECT 1 FROM outside_london_area o WHERE o.area_id = v.geography_id)
        GROUP BY v.geography_id
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

CREATE OR REPLACE FUNCTION public.rebuild_market_depth()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE affected integer;
BEGIN
    -- London's areas only: England's rows come from the England prices bundle.
    DELETE FROM area_market_depth d
    WHERE NOT EXISTS (SELECT 1 FROM outside_london_area o WHERE o.area_id = d.geography_id);
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
    WHERE b.source_release_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM outside_london_area o WHERE o.area_id = j.geography_id);
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$;

CREATE OR REPLACE FUNCTION public.rebuild_sale_pins(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE affected integer;
BEGIN
    DELETE FROM sale_pin s
    WHERE NOT EXISTS (SELECT 1 FROM outside_london_area o WHERE o.area_id = s.geography_id);
    INSERT INTO sale_pin (address_id, uprn, geography_id, geom, location_precision, sale_count,
        last_date, last_price, last_price_per_square_metre, property_type, new_build, tenure,
        ppd_category, previous_date, previous_price, repeat_sale_growth, value_now, source_release_id)
    WITH ranked AS (
        SELECT s.*,
               row_number() OVER w AS rn,
               count(*) OVER (PARTITION BY s.address_id) AS sales,
               lag(s.completion_date) OVER w AS next_date,
               lead(s.completion_date) OVER w AS prev_date,
               lead(s.price) OVER w AS prev_price
        FROM sale s
        WINDOW w AS (PARTITION BY s.address_id ORDER BY s.completion_date DESC, s.price DESC)
    ), last_sale AS (
        SELECT * FROM ranked WHERE rn = 1
    )
    SELECT l.address_id, p.uprn, a.geography_id,
           ST_Transform(COALESCE(p.location, ST_SetSRID(ST_MakePoint(a.longitude, a.latitude), 4326)), 3857),
           CASE WHEN p.location IS NOT NULL THEN 'uprn' ELSE 'postcode' END,
           LEAST(l.sales, 32767), l.completion_date, l.price, l.price_per_square_metre, l.property_type,
           l.new_build, l.tenure, l.ppd_category, l.prev_date, l.prev_price,
           CASE WHEN l.prev_date IS NOT NULL AND l.completion_date - l.prev_date >= 365 AND l.prev_price > 0
                THEN round((100 * (power(l.price::numeric / l.prev_price,
                     365.25 / (l.completion_date - l.prev_date)) - 1))::numeric, 1) END,
           v.restated_value, p_source_release_id
    FROM last_sale l
    JOIN address a ON a.id = l.address_id
    LEFT JOIN property p ON p.address_id = l.address_id
    LEFT JOIN property_stock_value v ON v.uprn = p.uprn
    WHERE (p.location IS NOT NULL OR (a.longitude IS NOT NULL AND a.latitude IS NOT NULL))
      AND NOT EXISTS (SELECT 1 FROM outside_london_area o WHERE o.area_id = a.geography_id)
    ON CONFLICT (address_id) DO NOTHING;
    GET DIAGNOSTICS affected = ROW_COUNT;
    ANALYZE sale_pin;
    RETURN affected;
END;
$$;

CREATE OR REPLACE FUNCTION public.revalue_city_blocks(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE affected integer;
BEGIN
    CREATE TEMP TABLE block_values ON COMMIT DROP AS
    SELECT b.id, count(*) AS dwellings,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY v.restated_price_per_square_metre) AS ppm,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY v.restated_value)::bigint AS value,
           max(v.period) AS period
    FROM city_block b
    JOIN property p ON p.location && b.geometry AND ST_Contains(b.geometry, p.location)
    JOIN property_stock_value v ON v.uprn = p.uprn
    WHERE v.restated_value IS NOT NULL  -- pre-index sales are never restated (#249)
    GROUP BY b.id;
    -- London's blocks only: a block from an England build (a source ending -england) is never dropped here.
    DELETE FROM city_block b
     WHERE b.source_release_id NOT LIKE '%-england'
       AND NOT EXISTS (SELECT 1 FROM block_values v WHERE v.id = b.id AND v.dwellings >= 2);
    UPDATE city_block b
       SET dwellings = v.dwellings, median_price_per_square_metre = v.ppm, median_value = v.value,
           period = v.period, source_release_id = p_source_release_id
      FROM block_values v WHERE v.id = b.id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$;

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
    -- London's areas only: England's bands and years come from the England prices bundle.
    DELETE FROM area_price_band b
    WHERE NOT EXISTS (SELECT 1 FROM outside_london_area o WHERE o.area_id = b.geography_id);
    DELETE FROM area_price_year y
    WHERE NOT EXISTS (SELECT 1 FROM outside_london_area o WHERE o.area_id = y.geography_id);

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
      AND s.ppd_category = 'A' AND s.property_type IN ('D', 'S', 'T', 'F') AND s.price >= 20000
      AND NOT EXISTS (SELECT 1 FROM outside_london_area o WHERE o.area_id = l.id);

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
           count(*) FILTER (WHERE carrier = 'lad')
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
    WHERE NOT EXISTS (SELECT 1 FROM outside_london_area o WHERE o.area_id = by_level.geography_id)
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
    WHERE NOT EXISTS (SELECT 1 FROM outside_london_area o WHERE o.area_id = by_level.geography_id)
    GROUP BY geography_id, property_type, year;

    -- "Typical home price": the median adjusted price of a whole home per London LSOA, by type. England's
    -- LSOAs keep the England bundle's values (they used to get a suppressed null here).
    DELETE FROM metric_value v
    WHERE v.metric_id IN ('typical-price', 'typical-price-flat', 'typical-price-terraced', 'typical-price-semi',
                          'typical-price-detached')
      AND NOT EXISTS (SELECT 1 FROM outside_london_area o WHERE o.area_id = v.geography_id);
    INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
    SELECT k.metric_id, 'lsoa', '£', 'higher-is-more', '{}'::jsonb, p_source_release_id
    FROM (VALUES ('typical-price'), ('typical-price-flat'), ('typical-price-terraced'),
                 ('typical-price-semi'), ('typical-price-detached')) k(metric_id)
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO metric_value (geography_id, metric_id, period, value, region_percentile,
        country_percentile, sample_count, quality, source_release_id)
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
          AND NOT EXISTS (SELECT 1 FROM outside_london_area o WHERE o.area_id = l.id)
    ), ranked AS (
        SELECT geography_id, metric_id,
               round(100 * percent_rank() OVER (PARTITION BY metric_id, area_rank_region(geography_id) ORDER BY value))::smallint AS pct
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

CREATE OR REPLACE FUNCTION public.rebuild_property_sale_bands(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    affected integer;
BEGIN
    DELETE FROM property_sale_band b
    WHERE NOT EXISTS (SELECT 1 FROM property p JOIN outside_london_area o ON o.area_id = p.geography_id
                      WHERE p.uprn = b.uprn);
    INSERT INTO property_sale_band (uprn, band, source_release_id)
    WITH last AS (
        -- Each address's last recorded sale, as the property page picks it.
        SELECT DISTINCT ON (s.address_id) s.address_id, s.property_type, s.ppd_category, s.price,
               EXTRACT(YEAR FROM s.completion_date)::smallint AS year
        FROM sale s
        WHERE s.source_release_id = p_source_release_id
        ORDER BY s.address_id, s.completion_date DESC, s.price DESC
    ), homes AS (
        SELECT DISTINCT ON (p.uprn) p.uprn, last.property_type, last.price, last.year,
               l.id AS lsoa_id, m.id AS msoa_id, b.id AS borough_id
        FROM property p
        JOIN last ON last.address_id = p.address_id
        JOIN area_geography l ON l.id = p.geography_id
        LEFT JOIN area_geography m ON m.id = l.parent_id AND m.kind = 'msoa'
        LEFT JOIN area_geography b ON b.id = m.parent_id AND b.kind = 'lad'
        WHERE last.ppd_category = 'A' AND last.property_type IN ('D', 'S', 'T', 'F') AND last.price > 0
          AND NOT EXISTS (SELECT 1 FROM outside_london_area o WHERE o.area_id = p.geography_id)
        ORDER BY p.uprn
    ), placed AS (
        SELECT h.uprn, h.property_type, h.price, h.year,
               CASE WHEN r.level <= 1 AND yl.sales >= 5 AND (r.level = 1 OR bl.sales >= 20) THEN h.lsoa_id
                    WHEN r.level <= 2 AND ym.sales >= 5 AND (r.level = 2 OR bm.sales >= 20) THEN h.msoa_id
                    WHEN r.level <= 3 AND yb.sales >= 5 AND (r.level = 3 OR bb.sales >= 20) THEN h.borough_id
               END AS geography_id
        FROM homes h
        LEFT JOIN area_price_band bl ON bl.geography_id = h.lsoa_id AND bl.property_type = h.property_type
        LEFT JOIN area_price_band bm ON bm.geography_id = h.msoa_id AND bm.property_type = h.property_type
        LEFT JOIN area_price_band bb ON bb.geography_id = h.borough_id AND bb.property_type = h.property_type
        LEFT JOIN area_price_year yl ON yl.geography_id = h.lsoa_id
             AND yl.property_type = h.property_type AND yl.year = h.year
        LEFT JOIN area_price_year ym ON ym.geography_id = h.msoa_id
             AND ym.property_type = h.property_type AND ym.year = h.year
        LEFT JOIN area_price_year yb ON yb.geography_id = h.borough_id
             AND yb.property_type = h.property_type AND yb.year = h.year
        -- The range's level (1 LSOA, 2 MSOA, 3 borough): price_bands.pick_level.
        CROSS JOIN LATERAL (SELECT CASE WHEN bl.sales >= 20 THEN 1 WHEN bm.sales >= 20 THEN 2
                                        WHEN bb.sales >= 20 THEN 3 WHEN bb.sales >= 5 THEN 3
                                        WHEN bm.sales >= 5 THEN 2 WHEN bl.sales >= 5 THEN 1 END AS level) r
        WHERE r.level IS NOT NULL
    )
    SELECT h.uprn,
           -- price_bands.position_band: a price on a boundary belongs to the band above it.
           CASE WHEN h.price >= y.p90 THEN 5 WHEN h.price >= y.p75 THEN 4 WHEN h.price >= y.p50 THEN 3
                WHEN h.price >= y.p25 THEN 2 WHEN h.price >= y.p10 THEN 1 ELSE 0 END,
           p_source_release_id
    FROM placed h
    JOIN area_price_year y ON y.geography_id = h.geography_id
         AND y.property_type = h.property_type AND y.year = h.year;
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$;

CREATE OR REPLACE FUNCTION public.rebuild_zone_analytics(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    latest date;
    affected integer;
BEGIN
    -- Postcode points (one per postcode, in British National Grid) with their modal LSOA.
    DROP TABLE IF EXISTS zone_postcode;
    CREATE TEMP TABLE zone_postcode ON COMMIT DROP AS
    SELECT a.postcode, left(a.postcode, length(a.postcode) - 2) AS sector,
           split_part(a.postcode, ' ', 1) AS district,
           ST_Transform(ST_SetSRID(ST_MakePoint(avg(a.longitude), avg(a.latitude)), 4326), 27700) AS point,
           mode() WITHIN GROUP (ORDER BY a.geography_id) AS lsoa_id
    FROM address a
    WHERE a.postcode ~ '^[A-Z]{1,2}[0-9][0-9A-Z]? [0-9][A-Z]{2}$'
      AND a.longitude IS NOT NULL AND a.latitude IS NOT NULL
    GROUP BY a.postcode;
    CREATE INDEX ON zone_postcode USING gist (point);

    DROP TABLE IF EXISTS zone_london;
    CREATE TEMP TABLE zone_london ON COMMIT DROP AS
    SELECT ST_Transform(ST_Union(geometry), 27700) AS geometry FROM area_geography WHERE kind = 'lad';

    -- Voronoi cells, each given to the postcode point it holds (one postcode per cell).
    DROP TABLE IF EXISTS zone_voronoi;
    CREATE TEMP TABLE zone_voronoi ON COMMIT DROP AS
    SELECT row_number() OVER () AS id, ST_CollectionExtract(ST_MakeValid(d.geom), 3) AS cell
    FROM (SELECT ST_VoronoiPolygons(ST_Collect(point), 0,
                     (SELECT ST_Expand(ST_Envelope(geometry), 2000) FROM zone_london)) AS cells
          FROM zone_postcode) v,
         LATERAL ST_Dump(v.cells) d;
    CREATE INDEX ON zone_voronoi USING gist (cell);
    DROP TABLE IF EXISTS zone_cell;
    CREATE TEMP TABLE zone_cell ON COMMIT DROP AS
    -- Postcodes sharing a point share a cell: it goes to the sector with most of them,
    -- unless that leaves a sector with no cell at all (then both keep it).
    WITH held AS (
        SELECT c.id, c.cell, p.sector, p.district, count(*) AS postcodes
        FROM zone_voronoi c
        JOIN zone_postcode p ON ST_Intersects(p.point, c.cell)
        GROUP BY c.id, c.cell, p.sector, p.district
    ), owner AS (
        SELECT DISTINCT ON (id) id, sector FROM held ORDER BY id, postcodes DESC, sector
    )
    SELECT h.cell, h.sector, h.district
    FROM held h
    WHERE EXISTS (SELECT 1 FROM owner o WHERE o.id = h.id AND o.sector = h.sector)
       OR NOT EXISTS (SELECT 1 FROM owner o WHERE o.sector = h.sector);

    -- London's sectors and districts (a London borough, or none): England's (etl_england_prices.py sectors) stay.
    -- A code both builds have is London's.
    DELETE FROM postcode_sector s
    WHERE NOT EXISTS (SELECT 1 FROM outside_london_area o WHERE o.area_id = s.borough_id);
    INSERT INTO postcode_sector (code, slug, district, name, borough_id, postcode_count, geometry, label_point)
    WITH shapes AS (
        SELECT c.sector, ST_Union(c.cell, 0.01) AS geometry FROM zone_cell c GROUP BY c.sector
    ), clipped AS (
        SELECT s.sector,
               ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Intersection(s.geometry, l.geometry, 0.01)), 3)) AS clip,
               ST_Multi(s.geometry) AS whole
        FROM shapes s, zone_london l
    ), facts AS (
        SELECT p.sector, min(p.district) AS district, count(*) AS postcodes,
               mode() WITHIN GROUP (ORDER BY lsoa.parent_id) AS msoa_id,
               mode() WITHIN GROUP (ORDER BY msoa.parent_id) AS borough_id
        FROM zone_postcode p
        JOIN area_geography lsoa ON lsoa.id = p.lsoa_id
        JOIN area_geography msoa ON msoa.id = lsoa.parent_id
        GROUP BY p.sector
    )
    SELECT f.sector, replace(f.sector, ' ', '-'), f.district,
           coalesce(lab.friendly_name, m.name), f.borough_id, f.postcodes,
           ST_Transform(CASE WHEN ST_IsEmpty(c.clip) THEN c.whole ELSE c.clip END, 4326),
           ST_Transform(ST_PointOnSurface(CASE WHEN ST_IsEmpty(c.clip) THEN c.whole ELSE c.clip END), 4326)
    FROM facts f
    JOIN clipped c ON c.sector = f.sector
    LEFT JOIN area_geography m ON m.id = f.msoa_id
    LEFT JOIN area_label lab ON lab.geography_id = f.msoa_id
    ON CONFLICT (code) DO UPDATE SET slug = EXCLUDED.slug, district = EXCLUDED.district, name = EXCLUDED.name,
        borough_id = EXCLUDED.borough_id, postcode_count = EXCLUDED.postcode_count, geometry = EXCLUDED.geometry,
        label_point = EXCLUDED.label_point;

    DELETE FROM postcode_district d
    WHERE NOT EXISTS (SELECT 1 FROM outside_london_area o WHERE o.area_id = d.borough_id);
    INSERT INTO postcode_district (code, slug, name, borough_id, postcode_count, geometry, label_point)
    WITH facts AS (
        SELECT p.district, count(*) AS postcodes,
               mode() WITHIN GROUP (ORDER BY lsoa.parent_id) AS msoa_id,
               mode() WITHIN GROUP (ORDER BY msoa.parent_id) AS borough_id
        FROM zone_postcode p
        JOIN area_geography lsoa ON lsoa.id = p.lsoa_id
        JOIN area_geography msoa ON msoa.id = lsoa.parent_id
        GROUP BY p.district
    ), shapes AS (
        -- The district's shape from the sectors built above, not England's sectors of the same district.
        SELECT district, ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Union(geometry)), 3)) AS geometry
        FROM postcode_sector WHERE code IN (SELECT sector FROM zone_cell) GROUP BY district
    )
    SELECT f.district, f.district, coalesce(lab.friendly_name, m.name), f.borough_id, f.postcodes,
           s.geometry, ST_PointOnSurface(s.geometry)
    FROM facts f
    JOIN shapes s ON s.district = f.district
    LEFT JOIN area_geography m ON m.id = f.msoa_id
    LEFT JOIN area_label lab ON lab.geography_id = f.msoa_id
    ON CONFLICT (code) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name, borough_id = EXCLUDED.borough_id,
        postcode_count = EXCLUDED.postcode_count, geometry = EXCLUDED.geometry, label_point = EXCLUDED.label_point;

    -- Sales with a £/m², placed in their sector, district and borough.
    DROP TABLE IF EXISTS zone_sale;
    -- "year" is a 12-month period ending at the latest sale month (2026 = Aug 2025 to
    -- Jul 2026 when the latest is July), so the newest year is never a part year.
    SELECT max(sale_month) INTO latest FROM sale WHERE source_release_id = p_source_release_id;
    CREATE TEMP TABLE zone_sale ON COMMIT DROP AS
    SELECT s.address_id, s.sale_month,
           (EXTRACT(YEAR FROM latest) - ((EXTRACT(YEAR FROM latest) * 12 + EXTRACT(MONTH FROM latest))
               - (EXTRACT(YEAR FROM s.sale_month) * 12 + EXTRACT(MONTH FROM s.sale_month)))::int / 12)::smallint AS year,
           s.price_per_square_metre AS ppm, s.floor_area_square_metres AS floor_area,
           CASE WHEN s.property_type = 'F' THEN 'flat' ELSE 'house' END AS kind,
           left(s.postcode, length(s.postcode) - 2) AS sector, split_part(s.postcode, ' ', 1) AS district,
           msoa.parent_id AS borough_id
    FROM sale s
    JOIN address a ON a.id = s.address_id
    JOIN area_geography lsoa ON lsoa.id = a.geography_id
    JOIN area_geography msoa ON msoa.id = lsoa.parent_id
    WHERE s.source_release_id = p_source_release_id
      AND s.ppd_category = 'A' AND s.property_type IN ('D', 'S', 'T', 'F')
      AND s.price_per_square_metre IS NOT NULL
      AND s.postcode ~ '^[A-Z]{1,2}[0-9][0-9A-Z]? [0-9][A-Z]{2}$';

    -- Zone rows from London's sales sources only: England's carry a source ending '-england' and stay.
    DELETE FROM zone_ppm_distribution WHERE source_release_id NOT LIKE '%-england';
    INSERT INTO zone_ppm_distribution (zone_kind, zone_code, period_end, sales, p09, p25, p50, p75, p91,
        bucket_edges, bucket_counts, source_release_id)
    WITH recent AS (
        SELECT z.kind AS zone_kind, z.code AS zone_code, s.ppm
        FROM zone_sale s
        CROSS JOIN LATERAL (VALUES ('sector', s.sector), ('district', s.district)) z(kind, code)
        WHERE s.sale_month > (latest - interval '24 months') AND s.sale_month <= latest
    ), q AS (
        SELECT zone_kind, zone_code, count(*) AS sales,
               percentile_cont(ARRAY[0.01, 0.09, 0.25, 0.5, 0.75, 0.91, 0.99])
                   WITHIN GROUP (ORDER BY ppm) AS p
        FROM recent GROUP BY zone_kind, zone_code HAVING count(*) >= 20
    ), counted AS (
        SELECT r.zone_kind, r.zone_code,
               CASE WHEN q.p[7] > q.p[1]
                    THEN least(greatest(width_bucket(r.ppm, q.p[1], q.p[7], 20), 1), 20) ELSE 1 END AS bucket,
               count(*) AS n
        FROM recent r JOIN q USING (zone_kind, zone_code)
        GROUP BY 1, 2, 3
    )
    SELECT q.zone_kind, q.zone_code, latest, q.sales,
           round(q.p[2]), round(q.p[3]), round(q.p[4]), round(q.p[5]), round(q.p[6]),
           ARRAY(SELECT round(q.p[1] + i * (q.p[7] - q.p[1]) / 20)::integer FROM generate_series(0, 20) i),
           ARRAY(SELECT coalesce(c.n, 0)::integer FROM generate_series(1, 20) b
                 LEFT JOIN counted c ON c.zone_kind = q.zone_kind AND c.zone_code = q.zone_code AND c.bucket = b
                 ORDER BY b),
           p_source_release_id
    FROM q
    ON CONFLICT (zone_kind, zone_code) DO UPDATE SET period_end = EXCLUDED.period_end, sales = EXCLUDED.sales,
        p09 = EXCLUDED.p09, p25 = EXCLUDED.p25, p50 = EXCLUDED.p50, p75 = EXCLUDED.p75, p91 = EXCLUDED.p91,
        bucket_edges = EXCLUDED.bucket_edges, bucket_counts = EXCLUDED.bucket_counts,
        source_release_id = EXCLUDED.source_release_id;
    GET DIAGNOSTICS affected = ROW_COUNT;

    DELETE FROM zone_price_index WHERE source_release_id NOT LIKE '%-england';
    INSERT INTO zone_price_index (zone_kind, zone_code, "group", year, sales, median_ppm,
        index_nominal, index_real, source_release_id)
    WITH yearly AS (
        SELECT z.kind AS zone_kind, z.code AS zone_code, g.grp, s.year, count(*) AS sales,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY s.ppm) AS median
        FROM zone_sale s
        CROSS JOIN LATERAL (VALUES ('sector', s.sector), ('district', s.district), ('borough', s.borough_id)) z(kind, code)
        CROSS JOIN LATERAL (VALUES ('all'), (s.kind)) g(grp)
        WHERE s.year >= 2004 AND z.code IS NOT NULL
        GROUP BY 1, 2, 3, 4
    ), cpi AS (
        SELECT (EXTRACT(YEAR FROM latest) - ((EXTRACT(YEAR FROM latest) * 12 + EXTRACT(MONTH FROM latest))
                   - (EXTRACT(YEAR FROM month) * 12 + EXTRACT(MONTH FROM month)))::int / 12)::smallint AS year,
               avg(cpih_index) AS cpih
        FROM cpih_month WHERE month <= latest GROUP BY 1
    ), indexed AS (
        SELECT y.*, CASE WHEN y.sales >= 10 AND b.sales >= 10 THEN 100 * y.median / b.median END AS nominal,
               c.cpih / c0.cpih AS deflator
        FROM yearly y
        LEFT JOIN yearly b ON b.zone_kind = y.zone_kind AND b.zone_code = y.zone_code
             AND b.grp = y.grp AND b.year = 2004
        LEFT JOIN cpi c ON c.year = y.year
        LEFT JOIN cpi c0 ON c0.year = 2004
    )
    SELECT zone_kind, zone_code, grp, year, sales, round(median), round(nominal::numeric, 1),
           round((nominal / deflator)::numeric, 1), p_source_release_id
    FROM indexed
    ON CONFLICT (zone_kind, zone_code, "group", year) DO UPDATE SET sales = EXCLUDED.sales,
        median_ppm = EXCLUDED.median_ppm, index_nominal = EXCLUDED.index_nominal, index_real = EXCLUDED.index_real,
        source_release_id = EXCLUDED.source_release_id;

    DELETE FROM zone_street WHERE source_release_id NOT LIKE '%-england';
    INSERT INTO zone_street (sector, street_name, sales_60m, median_floor_area, median_ppm, source_release_id)
    WITH recent AS (
        SELECT * FROM zone_sale WHERE sale_month > (latest - interval '60 months') AND sale_month <= latest
    ), names AS (
        SELECT DISTINCT postcode_district AS district, name FROM street WHERE postcode_district IS NOT NULL
    ), matched AS (
        -- Word-bounded, case-insensitive: the longest street name of the district in the address.
        SELECT DISTINCT ON (a.id) a.id AS address_id, n.name
        FROM (SELECT DISTINCT address_id, district FROM recent) r
        JOIN address a ON a.id = r.address_id
        JOIN names n ON n.district = r.district
         AND strpos(' ' || lower(translate(a.display_address, ',.', '  ')) || ' ', ' ' || lower(n.name) || ' ') > 0
        ORDER BY a.id, length(n.name) DESC, n.name
    )
    SELECT r.sector, m.name, count(*),
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.floor_area)),
           round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.ppm)),
           p_source_release_id
    FROM recent r JOIN matched m USING (address_id)
    GROUP BY r.sector, m.name
    HAVING count(*) >= 5
    ON CONFLICT (sector, street_name) DO UPDATE SET sales_60m = EXCLUDED.sales_60m,
        median_floor_area = EXCLUDED.median_floor_area, median_ppm = EXCLUDED.median_ppm,
        source_release_id = EXCLUDED.source_release_id;

    RETURN affected;
END;
$$;
