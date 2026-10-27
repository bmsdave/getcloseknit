-- 022: parcels and dwellings carry the recorded sale's own £/m² (sppm).
--
-- The map's "Colour homes by" switch shows either today's restated value
-- (ppm, the default) or the £/m² of the recorded sale in nominal terms
-- (sppm). Same function as migration 007 plus the sppm attribute; street
-- blocks are unchanged (they stay restated medians). Safe to re-run.

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
        SELECT b.id, b.dwellings, round(b.median_price_per_square_metre) AS ppm, b.median_value AS value,
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
               v.restated_price_per_square_metre AS ppm, v.restated_value AS value,
               v.sale_price_per_square_metre AS sppm, v.confidence, v.sale_period
        FROM property p
        JOIN property_stock_value v ON v.uprn = p.uprn
        WHERE v.source_release_id IN (SELECT source_release_id FROM active)
          AND NOT EXISTS (SELECT 1 FROM suppressed_dwelling s
                          WHERE s.uprn = p.uprn OR s.address_id = p.address_id)
    ), parcels AS (
        SELECT tp.id, tp.geometry,
               count(valued.uprn) AS dwellings,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY valued.ppm) AS ppm,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY valued.sppm) AS sppm,
               sum(valued.value)::bigint AS value,
               min(valued.confidence) AS confidence,
               max(valued.sale_period)::text AS latest_sale,
               (array_agg(valued.address_id ORDER BY valued.value DESC))[1] AS address_id,
               (array_agg(valued.uprn ORDER BY valued.value DESC))[1] AS uprn,
               (array_agg(valued.address ORDER BY valued.value DESC))[1] AS address
        FROM tile_parcels tp
        JOIN valued ON valued.parcel_id = tp.id
        GROUP BY tp.id, tp.geometry
    ), parcel_features AS (
        SELECT parcels.id::bigint AS feature_id, parcels.id, parcels.dwellings, round(parcels.ppm) AS ppm,
               round(parcels.sppm) AS sppm, parcels.value, parcels.confidence, parcels.latest_sale, parcels.address_id, parcels.uprn,
               CASE WHEN z >= 16 THEN parcels.address END AS address,
               ST_AsMVTGeom(
                   CASE WHEN z <= 15 THEN ST_SimplifyPreserveTopology(ST_Transform(parcels.geometry, 3857), 1.5)
                        ELSE ST_Transform(parcels.geometry, 3857) END,
                   bounds.geometry) AS geometry
        FROM parcels, bounds
    ), point_features AS (
        SELECT valued.uprn::bigint AS feature_id, valued.uprn, valued.address_id,
               CASE WHEN z >= 16 THEN valued.address END AS address,
               round(valued.ppm) AS ppm, round(valued.sppm) AS sppm, valued.value, valued.confidence, valued.sale_period::text AS latest_sale,
               ST_AsMVTGeom(ST_Transform(valued.location, 3857), bounds.geometry) AS geometry
        FROM valued, bounds
        WHERE z >= 15 AND valued.parcel_id IS NULL
          AND valued.location && bounds.geometry_4326
    )
    SELECT coalesce((SELECT ST_AsMVT(block_features, 'blocks', 4096, 'geometry') FROM block_features), ''::bytea)
        || coalesce((SELECT ST_AsMVT(parcel_features, 'parcels', 4096, 'geometry', 'feature_id') FROM parcel_features), ''::bytea)
        || coalesce((SELECT ST_AsMVT(point_features, 'dwellings', 4096, 'geometry', 'feature_id') FROM point_features), ''::bytea);
$$;
