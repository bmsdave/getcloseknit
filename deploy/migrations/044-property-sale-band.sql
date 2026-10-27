-- 044: a sold home's coarse sale band on the map; no per-home value or £/m².
--
-- Owner decision 2026-10-11: at house zoom the price layer colours a home with a
-- recorded sale by the coarse band its last sale fell in (bottom 10%, bottom
-- quarter, lower middle, upper middle, top quarter, top 10%) against same-type
-- standard sales in its area that year: the position the property page states
-- (api/area_api/price_bands.py). Only the band leaves the database, never a
-- percentile or a price. Homes without a band keep the clear outline over their
-- area's colour.
--
-- property_sale_band holds the band per UPRN, rebuilt after each sales load by
-- rebuild_property_sale_bands() from area_price_year (migration 040), with the
-- page's rules: the last sale must be a standard sale (Price Paid category A)
-- of F/T/S/D; the geography is the page's one (the range's level is the first of
-- LSOA, MSOA, borough with 20 same-type sales, else the largest with 5; the
-- position's the first from there up whose year has 5 sales and whose range is
-- the range's own or has 20). Below 5 sales there is no band.
--
-- The property tile gains `band` (0 = bottom 10% … 5 = top 10%) on parcel-less
-- dwellings and on parcels of exactly one home; a parcel with any hidden home
-- on it (suppressed_dwelling) never takes one, and hidden homes stay out of
-- the tile as before.
--
-- Owner decision 2026-10-11, while the EPC licence is pending: no single
-- home's price per m² is published. The property tile drops `sppm` (each
-- plot's recorded sale £/m², from the EPC floor area) and carries no floor
-- area; street blocks keep their median £/m² over three or more homes. The
-- sale tile is redefined as in migration 040 without the pin's `ppm`; its
-- cells keep their median £/m² over three or more homes.
--
-- Safe to re-run: the bands are rebuilt at the end when area_price_year
-- already holds a sales release.

CREATE TABLE IF NOT EXISTS property_sale_band (
    uprn text PRIMARY KEY,
    -- 0 bottom 10%, 1 bottom quarter, 2 lower middle, 3 upper middle, 4 top quarter, 5 top 10%.
    band smallint NOT NULL CHECK (band BETWEEN 0 AND 5),
    source_release_id text NOT NULL REFERENCES source_release(id)
);

CREATE OR REPLACE FUNCTION public.rebuild_property_sale_bands(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    affected integer;
BEGIN
    DELETE FROM property_sale_band;
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
        LEFT JOIN area_geography b ON b.id = m.parent_id AND b.kind = 'borough'
        WHERE last.ppd_category = 'A' AND last.property_type IN ('D', 'S', 'T', 'F') AND last.price > 0
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

-- Property tile with the sold home's band and without sppm (compare migration 040).
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
               sold.band,
               v.sale_period
        FROM property p
        JOIN property_stock_value v ON v.uprn = p.uprn
        LEFT JOIN property_sale_band sold ON sold.uprn = p.uprn
        WHERE v.source_release_id IN (SELECT source_release_id FROM active)
          AND NOT EXISTS (SELECT 1 FROM suppressed_dwelling s
                          WHERE s.uprn = p.uprn OR s.address_id = p.address_id)
    ), parcels AS (
        SELECT tp.id, tp.geometry,
               count(valued.uprn) AS dwellings,
               max(valued.sale_period)::text AS latest_sale,
               -- The band only for a parcel of one home with no hidden home on it.
               CASE WHEN count(valued.uprn) = 1 AND NOT EXISTS (SELECT 1 FROM suppressed_dwelling s
                   JOIN property hidden ON hidden.uprn = s.uprn OR hidden.address_id = s.address_id
                   WHERE hidden.parcel_id = tp.id) THEN max(valued.band) END AS band,
               (array_agg(valued.address_id ORDER BY valued.uprn))[1] AS address_id,
               (array_agg(valued.uprn ORDER BY valued.uprn))[1] AS uprn,
               (array_agg(valued.address ORDER BY valued.uprn))[1] AS address
        FROM tile_parcels tp
        JOIN valued ON valued.parcel_id = tp.id
        GROUP BY tp.id, tp.geometry
    ), parcel_features AS (
        SELECT parcels.id::bigint AS feature_id, parcels.id, parcels.dwellings,
               parcels.band,
               parcels.latest_sale, parcels.address_id, parcels.uprn,
               CASE WHEN z >= 16 THEN parcels.address END AS address,
               ST_AsMVTGeom(
                   CASE WHEN z <= 15 THEN ST_SimplifyPreserveTopology(ST_Transform(parcels.geometry, 3857), 1.5)
                        ELSE ST_Transform(parcels.geometry, 3857) END,
                   bounds.geometry) AS geometry
        FROM parcels, bounds
    ), point_features AS (
        SELECT valued.uprn::bigint AS feature_id, valued.uprn, valued.address_id,
               CASE WHEN z >= 16 THEN valued.address END AS address,
               valued.band,
               valued.sale_period::text AS latest_sale,
               ST_AsMVTGeom(ST_Transform(valued.location, 3857), bounds.geometry) AS geometry
        FROM valued, bounds
        WHERE z >= 15 AND valued.parcel_id IS NULL
          AND valued.location && bounds.geometry_4326
    )
    SELECT coalesce((SELECT ST_AsMVT(block_features, 'blocks', 4096, 'geometry') FROM block_features), ''::bytea)
        || coalesce((SELECT ST_AsMVT(parcel_features, 'parcels', 4096, 'geometry', 'feature_id') FROM parcel_features), ''::bytea)
        || coalesce((SELECT ST_AsMVT(point_features, 'dwellings', 4096, 'geometry', 'feature_id') FROM point_features), ''::bytea);
$$;

-- Sale tile without the pin's per-sale £/m² (compare migration 040); cells keep their median.
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

-- Build the bands now when the area bands exist (a fresh database has none until its sales load).
SELECT rebuild_property_sale_bands(built.source_release_id)
FROM (SELECT source_release_id FROM area_price_year LIMIT 1) built;
