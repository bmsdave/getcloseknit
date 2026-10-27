-- 046: parcels in the property tile carry their area (m²).
--
-- Some HM Land Registry titles cover a whole estate: many streets under one
-- polygon. At house zoom the map tinted the whole title when a home on it was
-- hovered or chosen. With its area the map tells a home's plot from such a
-- title (web/src/lib/map-property-layers.ts, SHARED_PARCEL_AREA = 2,500 m²,
-- beyond the largest 0.2% of one-home parcels) and outlines it faintly instead.
--
-- The area is planar in degrees scaled to metres at the parcel's latitude
-- (111,320² m per square degree × cos latitude): within a fraction of a percent
-- of the geodesic area across London, at a twentieth of its cost per tile.
-- Otherwise the tile of migration 044. Safe to run again.

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
               (array_agg(valued.address ORDER BY valued.uprn))[1] AS address,
               round(ST_Area(tp.geometry) * 12392142400 * cos(radians(ST_Y(ST_Centroid(tp.geometry))))) AS area
        FROM tile_parcels tp
        JOIN valued ON valued.parcel_id = tp.id
        GROUP BY tp.id, tp.geometry
    ), parcel_features AS (
        SELECT parcels.id::bigint AS feature_id, parcels.id, parcels.dwellings,
               parcels.band,
               parcels.area,
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
