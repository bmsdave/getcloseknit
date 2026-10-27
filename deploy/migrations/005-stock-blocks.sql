-- 005: block-level stock value.
--
-- Between the LSOA fill and individual parcels the map needs a street/block
-- scale. Hexagonal cells (100 m and 300 m, British National Grid) carry the
-- median restated £/m² of the dwellings inside them, so zooming out from a
-- house stays a heat map rather than jumping to the postcode's LSOA.

CREATE TABLE stock_block (
    id text PRIMARY KEY,
    size_metres integer NOT NULL CHECK (size_metres IN (100, 300)),
    geometry geometry(Polygon, 4326) NOT NULL,
    dwellings integer NOT NULL CHECK (dwellings > 0),
    median_price_per_square_metre double precision NOT NULL CHECK (median_price_per_square_metre > 0),
    median_value bigint NOT NULL CHECK (median_value > 0),
    period date NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id)
);

CREATE INDEX stock_block_geometry_gix ON stock_block USING gist (geometry);
CREATE INDEX stock_block_size_idx ON stock_block (size_metres);

-- Rebuilds every cell for one source release from the current stock values.
-- The grid is materialised with a spatial index first: joining 1.3 M points
-- against a set-returning grid directly has no index to use.
CREATE OR REPLACE FUNCTION public.rebuild_stock_blocks(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    inserted integer := 0;
    n integer;
    size integer;
BEGIN
    DELETE FROM stock_block WHERE source_release_id = p_source_release_id;
    CREATE TEMP TABLE block_dwellings ON COMMIT DROP AS
        SELECT ST_Transform(p.location, 27700) AS point, v.restated_price_per_square_metre AS ppm,
               v.restated_value AS value, v.period
        FROM property p JOIN property_stock_value v ON v.uprn = p.uprn
        WHERE v.source_release_id = p_source_release_id;
    CREATE INDEX ON block_dwellings USING gist (point);
    FOREACH size IN ARRAY ARRAY[100, 300] LOOP
        CREATE TEMP TABLE block_cells ON COMMIT DROP AS
            SELECT hex.i, hex.j, hex.geom
            FROM ST_HexagonGrid(size, (SELECT ST_SetSRID(ST_Extent(point), 27700) FROM block_dwellings)) AS hex;
        CREATE INDEX ON block_cells USING gist (geom);
        INSERT INTO stock_block (id, size_metres, geometry, dwellings, median_price_per_square_metre,
                                 median_value, period, source_release_id)
        SELECT format('hex%s:%s:%s', size, c.i, c.j), size, ST_Transform(c.geom, 4326),
               count(*), percentile_cont(0.5) WITHIN GROUP (ORDER BY d.ppm),
               percentile_cont(0.5) WITHIN GROUP (ORDER BY d.value)::bigint,
               max(d.period), p_source_release_id
        FROM block_cells c JOIN block_dwellings d ON c.geom && d.point AND ST_Contains(c.geom, d.point)
        GROUP BY c.i, c.j, c.geom
        HAVING count(*) >= 2;
        GET DIAGNOSTICS n = ROW_COUNT;
        inserted := inserted + n;
        DROP TABLE block_cells;
    END LOOP;
    RETURN inserted;
END;
$$;

-- Tile: blocks below parcel zoom (300 m cells to zoom 12, 100 m at 13-14),
-- parcels (simplified at 15) and parcel-less dwellings from zoom 15. Parcel features carry the
-- parcel id as the MVT feature id so hover/selection can address them.
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
               b.size_metres AS size,
               ST_AsMVTGeom(ST_Transform(b.geometry, 3857), bounds.geometry) AS geometry
        FROM stock_block b, bounds
        WHERE z BETWEEN 10 AND 14
          AND b.size_metres = CASE WHEN z <= 12 THEN 300 ELSE 100 END
          AND b.source_release_id IN (SELECT source_release_id FROM active)
          AND b.geometry && bounds.geometry_4326
    ), tile_parcels AS (
        SELECT parcel.id, parcel.geometry
        FROM parcel, bounds
        WHERE z >= 15 AND parcel.geometry && bounds.geometry_4326
    ), valued AS NOT MATERIALIZED (
        SELECT p.uprn, p.parcel_id, p.address_id, p.location, p.address,
               v.restated_price_per_square_metre AS ppm, v.restated_value AS value,
               v.confidence, v.sale_period
        FROM property p
        JOIN property_stock_value v ON v.uprn = p.uprn
        WHERE v.source_release_id IN (SELECT source_release_id FROM active)
    ), parcels AS (
        SELECT tp.id, tp.geometry,
               count(valued.uprn) AS dwellings,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY valued.ppm) AS ppm,
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
               parcels.value, parcels.confidence, parcels.latest_sale, parcels.address_id, parcels.uprn,
               CASE WHEN z >= 16 THEN parcels.address END AS address,
               ST_AsMVTGeom(
                   CASE WHEN z <= 15 THEN ST_SimplifyPreserveTopology(ST_Transform(parcels.geometry, 3857), 1.5)
                        ELSE ST_Transform(parcels.geometry, 3857) END,
                   bounds.geometry) AS geometry
        FROM parcels, bounds
    ), point_features AS (
        SELECT valued.uprn::bigint AS feature_id, valued.uprn, valued.address_id,
               CASE WHEN z >= 16 THEN valued.address END AS address,
               round(valued.ppm) AS ppm, valued.value, valued.confidence, valued.sale_period::text AS latest_sale,
               ST_AsMVTGeom(ST_Transform(valued.location, 3857), bounds.geometry) AS geometry
        FROM valued, bounds
        WHERE z >= 15 AND valued.parcel_id IS NULL
          AND valued.location && bounds.geometry_4326
    )
    SELECT coalesce((SELECT ST_AsMVT(block_features, 'blocks', 4096, 'geometry') FROM block_features), ''::bytea)
        || coalesce((SELECT ST_AsMVT(parcel_features, 'parcels', 4096, 'geometry', 'feature_id') FROM parcel_features), ''::bytea)
        || coalesce((SELECT ST_AsMVT(point_features, 'dwellings', 4096, 'geometry', 'feature_id') FROM point_features), ''::bytea);
$$;
