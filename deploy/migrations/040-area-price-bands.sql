-- 040: area price bands; no per-home restated value leaves the database.
--
-- Owner decision 2026-10-11: the site stops stating what any single home is
-- worth. The property page's per-home figure (the last sale restated by the
-- area index) is replaced by area-level price bands, and the map's homes are
-- coloured by their recorded sale only.
--
-- `area_price_band` holds, per area (LSOA, MSOA, borough) and Price Paid type
-- (F/T/S/D, '*' for all four), the 10th–90th percentiles of standard sales
-- since 1 January three years before the latest index month, each sale
-- adjusted to that month by its carrier's rolling price index (the index the old
-- per-home figure used): the LSOA's own index when both months are observed, else the
-- fallback carrier's own index when both months fell back to the same carrier (#185);
-- a sale whose two ends are different geographies is dropped, not mixed.
-- No per-home floor area is involved.
--
-- `area_price_year` holds the same percentiles of nominal sale prices per
-- area, type and calendar year, so a recorded sale can be placed in a coarse
-- band (top 10%, top quarter, …) against its own year. Only the band leaves
-- the API, never a percentile.
--
-- rebuild_area_price_bands() rebuilds both after a sales load and publishes
-- the "Typical home price" map layer: five LSOA metrics (typical-price and
-- one per type), each the median adjusted price of the first level with 20
-- sales (LSOA, then MSOA), else the borough with at least 5, else suppressed.
--
-- The property and sale tiles are redefined without the restated value:
-- parcels and dwellings keep the recorded sale's own £/m² (sppm), sale pins
-- keep the recorded sale, street blocks keep their median £/m² only when they
-- hold three or more homes. Safe to re-run.

CREATE TABLE IF NOT EXISTS area_price_band (
    geography_id text NOT NULL REFERENCES area_geography(id),
    property_type char(1) NOT NULL CHECK (property_type IN ('D', 'S', 'T', 'F', '*')),
    window_start date NOT NULL,
    -- The index month every sale is adjusted to.
    period date NOT NULL,
    sales integer NOT NULL CHECK (sales > 0),
    p10 integer, p25 integer, p50 integer, p75 integer, p90 integer,
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (geography_id, property_type)
);

CREATE TABLE IF NOT EXISTS area_price_year (
    geography_id text NOT NULL REFERENCES area_geography(id),
    property_type char(1) NOT NULL CHECK (property_type IN ('D', 'S', 'T', 'F')),
    year smallint NOT NULL,
    sales integer NOT NULL CHECK (sales > 0),
    p10 integer, p25 integer, p50 integer, p75 integer, p90 integer,
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (geography_id, property_type, year)
);

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

-- The layer was first published as "Typical price today": rename definitions already
-- built, so a re-run renames it without waiting for the next sales load.
UPDATE metric_definition
   SET definition = definition || jsonb_build_object(
           'label', replace(definition->>'label', 'Typical price today', 'Typical home price'),
           'shortLabel', 'Typical home price')
 WHERE id IN ('typical-price', 'typical-price-flat', 'typical-price-terraced',
              'typical-price-semi', 'typical-price-detached')
   AND definition ? 'label';

-- Property tile without the restated value (compare migration 022).
CREATE OR REPLACE FUNCTION public.property_tile(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
    WITH bounds AS (
        SELECT ST_TileEnvelope(z, x, y) AS geometry,
               ST_Transform(ST_TileEnvelope(z, x, y), 4326) AS geometry_4326
    ), active AS NOT MATERIALIZED (
        SELECT member.source_release_id
        FROM active_product_release active
        JOIN product_release_member member ON member.release_id = active.release_id
    ), block_features AS (
        SELECT b.id, b.dwellings,
               CASE WHEN b.dwellings >= 3 THEN round(b.median_price_per_square_metre) END AS ppm,
               round(b.area_square_metres) AS area,
               ST_AsMVTGeom(
                   CASE WHEN z <= 12 THEN b.geometry_coarse
                        WHEN z = 13 THEN b.geometry_medium
                        ELSE ST_SimplifyPreserveTopology(b.geometry_3857, 2) END,
                   bounds.geometry) AS geometry
        FROM city_block b, bounds
        WHERE z BETWEEN 12 AND 14
          AND b.source_release_id IN (SELECT source_release_id FROM active)
          AND b.geometry && bounds.geometry_4326
          AND b.area_square_metres >= CASE WHEN z <= 12 THEN 5000 WHEN z = 13 THEN 800 ELSE 0 END
          AND NOT (b.area_square_metres > 200000 AND b.dwellings < b.area_square_metres / 10000)
    ), tile_parcels AS (
        SELECT parcel.id, parcel.geometry
        FROM parcel, bounds
        WHERE z >= 15 AND parcel.geometry && bounds.geometry_4326
    ), valued AS NOT MATERIALIZED (
        SELECT p.uprn, p.parcel_id, p.address_id, p.location, p.address,
               v.sale_price_per_square_metre AS sppm, v.sale_period
        FROM property p
        JOIN property_stock_value v ON v.uprn = p.uprn
        WHERE v.source_release_id IN (SELECT source_release_id FROM active)
          AND NOT EXISTS (SELECT 1 FROM suppressed_dwelling s
                          WHERE s.uprn = p.uprn OR s.address_id = p.address_id)
    ), parcels AS (
        SELECT tp.id, tp.geometry,
               count(valued.uprn) AS dwellings,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY valued.sppm) AS sppm,
               max(valued.sale_period)::text AS latest_sale,
               (array_agg(valued.address_id ORDER BY valued.uprn))[1] AS address_id,
               (array_agg(valued.uprn ORDER BY valued.uprn))[1] AS uprn,
               (array_agg(valued.address ORDER BY valued.uprn))[1] AS address
        FROM tile_parcels tp
        JOIN valued ON valued.parcel_id = tp.id
        GROUP BY tp.id, tp.geometry
    ), parcel_features AS (
        SELECT parcels.id::bigint AS feature_id, parcels.id, parcels.dwellings,
               round(parcels.sppm) AS sppm, parcels.latest_sale, parcels.address_id, parcels.uprn,
               CASE WHEN z >= 16 THEN parcels.address END AS address,
               ST_AsMVTGeom(
                   CASE WHEN z <= 15 THEN ST_SimplifyPreserveTopology(ST_Transform(parcels.geometry, 3857), 1.5)
                        ELSE ST_Transform(parcels.geometry, 3857) END,
                   bounds.geometry) AS geometry
        FROM parcels, bounds
    ), point_features AS (
        SELECT valued.uprn::bigint AS feature_id, valued.uprn, valued.address_id,
               CASE WHEN z >= 16 THEN valued.address END AS address,
               round(valued.sppm) AS sppm, valued.sale_period::text AS latest_sale,
               ST_AsMVTGeom(ST_Transform(valued.location, 3857), bounds.geometry) AS geometry
        FROM valued, bounds
        WHERE z >= 15 AND valued.parcel_id IS NULL
          AND valued.location && bounds.geometry_4326
    )
    SELECT coalesce((SELECT ST_AsMVT(block_features, 'blocks', 4096, 'geometry') FROM block_features), ''::bytea)
        || coalesce((SELECT ST_AsMVT(parcel_features, 'parcels', 4096, 'geometry', 'feature_id') FROM parcel_features), ''::bytea)
        || coalesce((SELECT ST_AsMVT(point_features, 'dwellings', 4096, 'geometry', 'feature_id') FROM point_features), ''::bytea);
$$;

-- Sale tile without the restated value (compare migration 008).
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
                   pin.repeat_sale_growth AS growth,
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
