-- Individual sales (HM Land Registry Price Paid) and the sold-price map.
--
-- `sale` keeps every London Price Paid transaction with the fields the map
-- filters on (type, new build, tenure, PPD category). `sale_pin` is one point
-- per home that ever sold: its last sale, the sale before it, its restated
-- value today and its area's price growth over 1–20 years, so the tile
-- function reads one indexed table. Both are release data, rebuilt by
-- rebuild_sale_pins() after a sales or price release; privacy objections are
-- applied when tiles are cut (suppressed_dwelling), never baked in.

CREATE TABLE sale (
    transaction_id text PRIMARY KEY,
    address_id text NOT NULL,
    completion_date date NOT NULL,
    sale_month date NOT NULL,
    price integer NOT NULL CHECK (price > 0),
    property_type char(1) NOT NULL CHECK (property_type IN ('D', 'S', 'T', 'F', 'O')),
    new_build boolean NOT NULL,
    tenure char(1) NOT NULL CHECK (tenure IN ('F', 'L', 'U')),
    ppd_category char(1) NOT NULL CHECK (ppd_category IN ('A', 'B')),
    postcode text NOT NULL,
    floor_area_square_metres double precision CHECK (floor_area_square_metres > 0),
    -- Only plausible values (£500–£40,000/m², 15–1,000 m²); NULL otherwise.
    price_per_square_metre double precision,
    source_release_id text NOT NULL REFERENCES source_release(id)
);
CREATE INDEX sale_address_idx ON sale (address_id, completion_date);
CREATE INDEX sale_month_idx ON sale (sale_month);

-- N-year change of each LSOA's rolling £/m² index (price-per-square-metre),
-- in percent, at the index's latest period.
CREATE TABLE area_price_growth (
    geography_id text PRIMARY KEY,
    period date NOT NULL,
    growth_1y real,
    growth_3y real,
    growth_5y real,
    growth_10y real,
    growth_20y real
);

CREATE TABLE sale_pin (
    address_id text PRIMARY KEY,
    uprn text,
    geography_id text,
    geom geometry(Point, 3857) NOT NULL,
    location_precision text NOT NULL CHECK (location_precision IN ('uprn', 'postcode')),
    sale_count smallint NOT NULL,
    last_date date NOT NULL,
    last_price integer NOT NULL,
    last_price_per_square_metre double precision,
    property_type char(1) NOT NULL,
    new_build boolean NOT NULL,
    tenure char(1) NOT NULL,
    ppd_category char(1) NOT NULL,
    previous_date date,
    previous_price integer,
    -- Compound annual change between the previous and the last sale, percent;
    -- NULL when the two are under a year apart.
    repeat_sale_growth real,
    value_now integer,
    source_release_id text NOT NULL REFERENCES source_release(id)
);
CREATE INDEX sale_pin_geom_gix ON sale_pin USING gist (geom);
CREATE INDEX sale_pin_uprn_idx ON sale_pin (uprn);

-- Stage -> sale. `staging_sale` is the temp table etl_sales.py fills.
CREATE OR REPLACE FUNCTION public.load_sales(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE affected integer;
BEGIN
    DELETE FROM sale;
    INSERT INTO sale (transaction_id, address_id, completion_date, sale_month, price, property_type,
        new_build, tenure, ppd_category, postcode, floor_area_square_metres, price_per_square_metre,
        source_release_id)
    SELECT s.transaction_id, s.address_id, s.completion_date, date_trunc('month', s.completion_date)::date,
           s.price, s.property_type, s.new_build, s.tenure, s.ppd_category, s.postcode,
           s.floor_area_square_metres,
           CASE WHEN s.floor_area_square_metres BETWEEN 15 AND 1000
                 AND s.price / s.floor_area_square_metres BETWEEN 500 AND 40000
                THEN round((s.price / s.floor_area_square_metres)::numeric, 2) END,
           p_source_release_id
    FROM staging_sale s
    ON CONFLICT (transaction_id) DO NOTHING;
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$;

-- Stock value per dwelling: its last standard market sale (category A, same
-- sanity gates as the £/m² index) restated by its carrier's index — the LSOA's own when both
-- months are observed, else the fallback carrier's own when both months fell back to the same
-- carrier (#185); a mixed-carrier sale is dropped, and index_carrier/index_geography_id name
-- the carrier used. A sale older than the index itself is kept but never restated (#249).
-- Replaces the address_transaction-based block of tools/property-load.sql.
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

CREATE OR REPLACE FUNCTION public.rebuild_area_price_growth()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE affected integer;
BEGIN
    DELETE FROM area_price_growth;
    INSERT INTO area_price_growth (geography_id, period, growth_1y, growth_3y, growth_5y, growth_10y, growth_20y)
    WITH latest AS (
        SELECT max(period) AS period FROM metric_value WHERE metric_id = 'price-per-square-metre'
    ), v AS (
        SELECT geography_id, period, value FROM metric_value
        WHERE metric_id = 'price-per-square-metre' AND value > 0
    )
    SELECT now_v.geography_id, now_v.period,
           round((100 * (now_v.value / y1.value - 1))::numeric, 1),
           round((100 * (now_v.value / y3.value - 1))::numeric, 1),
           round((100 * (now_v.value / y5.value - 1))::numeric, 1),
           round((100 * (now_v.value / y10.value - 1))::numeric, 1),
           round((100 * (now_v.value / y20.value - 1))::numeric, 1)
    FROM latest l
    JOIN v now_v ON now_v.period = l.period
    LEFT JOIN v y1 ON y1.geography_id = now_v.geography_id AND y1.period = (l.period - interval '1 year')::date
    LEFT JOIN v y3 ON y3.geography_id = now_v.geography_id AND y3.period = (l.period - interval '3 years')::date
    LEFT JOIN v y5 ON y5.geography_id = now_v.geography_id AND y5.period = (l.period - interval '5 years')::date
    LEFT JOIN v y10 ON y10.geography_id = now_v.geography_id AND y10.period = (l.period - interval '10 years')::date
    LEFT JOIN v y20 ON y20.geography_id = now_v.geography_id AND y20.period = (l.period - interval '20 years')::date;
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
    DELETE FROM sale_pin;
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
    WHERE p.location IS NOT NULL OR (a.longitude IS NOT NULL AND a.latitude IS NOT NULL)
    ON CONFLICT (address_id) DO NOTHING;
    GET DIAGNOSTICS affected = ROW_COUNT;
    ANALYZE sale_pin;
    RETURN affected;
END;
$$;

-- Street blocks keep their geometry (migration 006, rebuilt only when the
-- parcels or roads change); after a stock-value rebuild their medians are
-- recomputed in place from the dwellings inside them.
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

-- Sold-price tiles.
--   z15+   layer `sales`: one point per home, with the attributes the map
--          colours and filters by. Suppressed homes are left out.
--   z11–14 layer `sale_cells`: homes whose last sale is in the latest five
--          years, merged on a grid (64 cells per tile edge) into medians;
--          a cell needs three homes, so no single sale can be read off it.
CREATE OR REPLACE FUNCTION public.sale_tile(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE plpgsql
STABLE PARALLEL SAFE
AS $$
DECLARE
    bounds geometry := ST_TileEnvelope(z, x, y);
    cell double precision := (ST_XMax(ST_TileEnvelope(z, x, y)) - ST_XMin(ST_TileEnvelope(z, x, y))) / 64;
    tile bytea;
BEGIN
    IF z >= 15 THEN
        SELECT ST_AsMVT(f, 'sales', 4096, 'geom') INTO tile FROM (
            SELECT ST_AsMVTGeom(pin.geom, bounds, 4096, 0, true) AS geom,
                   pin.address_id AS id, pin.uprn, pin.last_price AS price,
                   round(pin.last_price_per_square_metre)::integer AS ppm,
                   to_char(pin.last_date, 'YYYY-MM-DD') AS date,
                   EXTRACT(YEAR FROM pin.last_date)::integer AS year,
                   pin.property_type AS type, pin.new_build::integer AS new_build, pin.tenure,
                   pin.ppd_category AS category, pin.sale_count AS sales,
                   pin.previous_price, to_char(pin.previous_date, 'YYYY-MM-DD') AS previous_date,
                   pin.repeat_sale_growth AS growth, pin.value_now AS value,
                   g.growth_1y AS g1, g.growth_3y AS g3, g.growth_5y AS g5,
                   g.growth_10y AS g10, g.growth_20y AS g20,
                   pin.location_precision AS precision, pin.geography_id AS area
            FROM sale_pin pin
            LEFT JOIN area_price_growth g ON g.geography_id = pin.geography_id
            WHERE pin.geom && bounds
              AND NOT EXISTS (SELECT 1 FROM suppressed_dwelling d
                              WHERE d.address_id = pin.address_id OR (pin.uprn IS NOT NULL AND d.uprn = pin.uprn))
        ) f WHERE f.geom IS NOT NULL;
    ELSIF z >= 11 THEN
        SELECT ST_AsMVT(f, 'sale_cells', 4096, 'geom') INTO tile FROM (
            SELECT ST_AsMVTGeom(ST_Centroid(ST_Collect(pin.geom)), bounds, 4096, 0, true) AS geom,
                   count(*)::integer AS n,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY pin.last_price)::integer AS price,
                   round(percentile_cont(0.5) WITHIN GROUP (ORDER BY pin.last_price_per_square_metre))::integer AS ppm,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY pin.value_now)::integer AS value,
                   round(avg(g.growth_1y)::numeric, 1) AS g1, round(avg(g.growth_3y)::numeric, 1) AS g3,
                   round(avg(g.growth_5y)::numeric, 1) AS g5, round(avg(g.growth_10y)::numeric, 1) AS g10,
                   round(avg(g.growth_20y)::numeric, 1) AS g20,
                   max(EXTRACT(YEAR FROM pin.last_date))::integer AS year
            FROM sale_pin pin
            LEFT JOIN area_price_growth g ON g.geography_id = pin.geography_id
            WHERE pin.geom && bounds
              AND pin.last_date >= (SELECT max(last_date) - interval '5 years' FROM sale_pin)
              AND NOT EXISTS (SELECT 1 FROM suppressed_dwelling d
                              WHERE d.address_id = pin.address_id OR (pin.uprn IS NOT NULL AND d.uprn = pin.uprn))
            GROUP BY floor(ST_X(pin.geom) / cell), floor(ST_Y(pin.geom) / cell)
            HAVING count(*) >= 3
        ) f WHERE f.geom IS NOT NULL;
    END IF;
    RETURN tile;
END;
$$;
