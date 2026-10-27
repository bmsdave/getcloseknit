-- 098: a sale older than the £/m² index is kept but never restated (issue #249).
--
-- rebuild_stock_values() indexed every dwelling's last sale at
-- GREATEST(sale_month, min(period) of price-per-square-metre): a 1995-2006 sale was restated
-- as if it had completed in June 2006 (the index's first month) and so got only the
-- 2006->latest growth, silently understating it. Those rows still counted in the LSOA
-- stock-value median, sale_pin.value_now and the street-block medians.
--
-- Now a dwelling whose last sale predates the index keeps its recorded facts in
-- property_stock_value (sale_period, nominal_price, floor area, sale £/m²) but its
-- restated_* and index_* columns stay null, unrestated_reason = 'pre-index-sale' and
-- confidence = 'low'. The LSOA median and count, revalue_city_blocks() and
-- rebuild_city_blocks() (006, in place) read restated rows only; sale_pin.value_now is null
-- for such a home. The metric's caveats say so.
--
-- The same bodies are applied in place to 008-sales.sql, so a fresh database and the
-- source-text tests see the fixed versions; this file lets an existing database pick the fix
-- up by applying one migration. Safe to re-run. Rebuild afterwards:
--   SELECT rebuild_stock_values('<sales source_release_id>'); then the rest of the chain
--   (rebuild_sale_pins, revalue_city_blocks, ...) as etl_sales.py runs it.

ALTER TABLE property_stock_value ALTER COLUMN index_carrier DROP NOT NULL;
ALTER TABLE property_stock_value ALTER COLUMN index_at_sale DROP NOT NULL;
ALTER TABLE property_stock_value ALTER COLUMN index_latest DROP NOT NULL;
ALTER TABLE property_stock_value ALTER COLUMN restated_price_per_square_metre DROP NOT NULL;
ALTER TABLE property_stock_value ALTER COLUMN restated_value DROP NOT NULL;
ALTER TABLE property_stock_value ADD COLUMN IF NOT EXISTS unrestated_reason text
    CHECK (unrestated_reason IN ('pre-index-sale'));
-- A row is either restated (all four restatement columns set) or carries a reason.
ALTER TABLE property_stock_value DROP CONSTRAINT IF EXISTS property_stock_value_restated_or_reason;
ALTER TABLE property_stock_value ADD CONSTRAINT property_stock_value_restated_or_reason
    CHECK ((unrestated_reason IS NULL)
           = (index_carrier IS NOT NULL AND index_at_sale IS NOT NULL AND index_latest IS NOT NULL
              AND restated_price_per_square_metre IS NOT NULL AND restated_value IS NOT NULL));

UPDATE metric_definition
   SET definition = jsonb_set(definition, '{caveats}', $json$[
     "Each dwelling counts once at its last recorded sale; homes never sold since 1995 are absent.",
     "A home whose last sale predates the price per m² index (June 2006) is not restated and is left out of the median and the count; it is never moved forward as if it had sold in June 2006.",
     "Areas with fewer than 10 valued dwellings are suppressed.",
     "Restated sales carry no condition, layout or tenure information: they are not valuations."
   ]$json$::jsonb)
 WHERE id = 'stock-value-per-square-metre';

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
    DELETE FROM property_stock_value;
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
           count(*) FILTER (WHERE index_carrier = 'borough'),
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

    -- Area stock value: median restated £/m² of the restated dwellings per LSOA. Unrestated
    -- (pre-index) dwellings are in neither the median nor the count.
    DELETE FROM metric_value WHERE metric_id = 'stock-value-per-square-metre';
    INSERT INTO metric_value (geography_id, metric_id, period, value, london_percentile,
        england_percentile, sample_count, quality, source_release_id)
    WITH medians AS (
        SELECT p.geography_id, v.period,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY v.restated_price_per_square_metre) AS value,
               count(*) AS n
        FROM property_stock_value v JOIN property p ON p.uprn = v.uprn
        WHERE v.restated_price_per_square_metre IS NOT NULL
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
    DELETE FROM city_block b
     WHERE NOT EXISTS (SELECT 1 FROM block_values v WHERE v.id = b.id AND v.dwellings >= 2);
    UPDATE city_block b
       SET dwellings = v.dwellings, median_price_per_square_metre = v.ppm, median_value = v.value,
           period = v.period, source_release_id = p_source_release_id
      FROM block_values v WHERE v.id = b.id;
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$;
