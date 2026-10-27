-- Local market depth per LSOA and MSOA (GET /api/v1/areas/{id}/market and the
-- area evidence pack). Rebuilt by rebuild_market_depth(), which
-- `etl_sales.py load` calls after the area growth rebuild.
--
-- Counts, medians and shares only: no valuation, no listing, no address.
-- Category A (standard market) sales only. The window ends at the latest sale
-- in `sale` (Price Paid lags by months), not at today's date.
--
--   sales_12m            category A sales in the last 12 months
--   dwellings            homes in `property` (EPC-linked UPRNs: not the full stock)
--   dwellings_sold_12m   of those, homes with a category A sale in the 12 months
--   turnover_percent     dwellings_sold_12m / dwellings, same population on both sides
--   leasehold_share_of_sales  share of the 12-month sales (tenure F or L) that
--                        were leasehold: a share of SALES, not of homes
--   new_build_* / resale_*    36 months of sales with a plausible £/m²; a median
--                        is NULL under 10 sales and the premium is NULL unless
--                        both sides have 10
--   growth_*             the LSOA's rolling £/m² index change (area_price_growth);
--                        NULL for MSOAs, which have no index of their own
CREATE TABLE IF NOT EXISTS area_market_depth (
    geography_id text PRIMARY KEY REFERENCES area_geography(id),
    period_end date NOT NULL,
    sales_12m integer NOT NULL CHECK (sales_12m >= 0),
    dwellings integer NOT NULL CHECK (dwellings >= 0),
    dwellings_sold_12m integer NOT NULL CHECK (dwellings_sold_12m >= 0),
    turnover_percent real,
    tenure_known_12m integer NOT NULL CHECK (tenure_known_12m >= 0),
    leasehold_share_of_sales real CHECK (leasehold_share_of_sales BETWEEN 0 AND 1),
    new_build_sample_36m integer NOT NULL CHECK (new_build_sample_36m >= 0),
    resale_sample_36m integer NOT NULL CHECK (resale_sample_36m >= 0),
    new_build_median_ppm integer,
    resale_median_ppm integer,
    new_build_premium_percent real,
    growth_period date,
    growth_1y real,
    growth_3y real,
    growth_5y real,
    growth_10y real,
    source_release_id text NOT NULL REFERENCES source_release(id),
    CHECK (new_build_median_ppm IS NULL OR new_build_sample_36m >= 10),
    CHECK (resale_median_ppm IS NULL OR resale_sample_36m >= 10),
    CHECK (new_build_premium_percent IS NULL OR (new_build_sample_36m >= 10 AND resale_sample_36m >= 10))
);

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
        growth_period, growth_1y, growth_3y, growth_5y, growth_10y, source_release_id)
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
           g.period, g.growth_1y, g.growth_3y, g.growth_5y, g.growth_10y,
           b.source_release_id
    FROM joined j
    CROSS JOIN bounds b
    LEFT JOIN area_price_growth g ON g.geography_id = j.geography_id
    WHERE b.source_release_id IS NOT NULL;
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$;
