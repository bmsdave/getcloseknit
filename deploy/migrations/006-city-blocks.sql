-- 006: street blocks replace hexagonal cells.
--
-- A block is what a person sees between streets: the OpenStreetMap road
-- network polygonised into street faces, intersected with neighbouring
-- freehold parcels (INSPIRE) merged together; very large single titles
-- (parks, estates over 2 ha) are cut by the faces on their own so they
-- cannot swallow the houses beside them. Each block carries the median stock
-- value of the dwellings inside it and shows from zoom 12 to 14; parcels take
-- over at 15.

DROP TABLE IF EXISTS stock_block;
DROP FUNCTION IF EXISTS rebuild_stock_blocks(text);

CREATE TABLE IF NOT EXISTS osm_road (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    highway text NOT NULL,
    name text,
    geometry geometry(LineString, 27700) NOT NULL
);
CREATE INDEX IF NOT EXISTS osm_road_gix ON osm_road USING gist (geometry);

CREATE TABLE city_block (
    id text PRIMARY KEY,
    authority_code text NOT NULL CHECK (authority_code ~ '^E09[0-9]{6}$'),
    geometry geometry(Polygon, 4326) NOT NULL,
    area_square_metres double precision NOT NULL CHECK (area_square_metres > 0),
    dwellings integer NOT NULL CHECK (dwellings > 0),
    median_price_per_square_metre double precision NOT NULL CHECK (median_price_per_square_metre > 0),
    median_value bigint NOT NULL CHECK (median_value > 0),
    period date NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id)
);

CREATE INDEX city_block_geometry_gix ON city_block USING gist (geometry);

-- Tile-ready copies: Web Mercator, simplified for the outer zooms so a z11
-- tile of a whole district stays small.
ALTER TABLE city_block
    ADD COLUMN geometry_3857 geometry(Polygon, 3857)
        GENERATED ALWAYS AS (ST_Transform(geometry, 3857)) STORED,
    ADD COLUMN geometry_coarse geometry(Geometry, 3857)
        GENERATED ALWAYS AS (ST_SimplifyPreserveTopology(ST_Transform(geometry, 3857), 24)) STORED,
    ADD COLUMN geometry_medium geometry(Geometry, 3857)
        GENERATED ALWAYS AS (ST_SimplifyPreserveTopology(ST_Transform(geometry, 3857), 10)) STORED;

-- Rebuilds every block for one source release. Per authority: node the
-- OpenStreetMap road network (all classes, plus the Greater London boundary
-- so edge blocks close) and polygonise it into street faces; merge the parcels up to
-- 2 ha (1.5 m buffer closes sliver gaps) and intersect them with the faces;
-- large titles (parks, estates) are cut by the faces on their own; keep
-- pieces of at least 150 m²; then attach dwellings.
CREATE OR REPLACE FUNCTION public.rebuild_city_blocks(p_source_release_id text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    authority text;
    inserted integer := 0;
    n integer;
BEGIN
    DELETE FROM city_block WHERE source_release_id = p_source_release_id;
    CREATE TEMP TABLE block_dwellings ON COMMIT DROP AS
        SELECT ST_Transform(p.location, 27700) AS point, v.restated_price_per_square_metre AS ppm,
               v.restated_value AS value, v.period
        FROM property p JOIN property_stock_value v ON v.uprn = p.uprn
        WHERE v.source_release_id = p_source_release_id
          AND v.restated_value IS NOT NULL;  -- pre-index sales are never restated (#249)
    CREATE INDEX ON block_dwellings USING gist (point);
    FOR authority IN SELECT DISTINCT authority_code FROM parcel ORDER BY 1 LOOP
        CREATE TEMP TABLE block_shapes ON COMMIT DROP AS
        WITH parcels AS (
            SELECT ST_Transform(geometry, 27700) AS g FROM parcel WHERE authority_code = authority
        ), extent AS (
            SELECT ST_SetSRID(ST_Expand(ST_Extent(g), 50), 27700) AS e FROM parcels
        ), london AS (
            -- Roads leave the Greater London extract at the boundary, so rings
            -- near the edge close along the boundary itself.
            SELECT (ST_Dump(ST_CollectionExtract(ST_Intersection(
                ST_Boundary(ST_Transform(ST_Union(g.geometry), 27700)), extent.e), 2))).geom AS geometry
            FROM area_geography g, extent WHERE g.kind = 'borough' GROUP BY extent.e
        ), lines AS (
            SELECT ST_Node(ST_Collect(l.geometry)) AS g
            FROM (SELECT r.geometry FROM osm_road r, extent WHERE r.geometry && extent.e
                  UNION ALL SELECT geometry FROM london) l
        ), faces AS (
            SELECT (ST_Dump(ST_Polygonize(g))).geom AS f FROM lines
        ), merged AS (
            -- Subdivided so each face only meets the parcel land near it.
            SELECT ST_Subdivide(ST_Buffer(ST_UnaryUnion(ST_Collect(ST_Buffer(g, 1.5))), -1.5), 128) AS g
            FROM parcels WHERE ST_Area(g) <= 20000
        ), large AS (
            SELECT ST_Subdivide(g, 128) AS g FROM parcels WHERE ST_Area(g) > 20000
        ), numbered AS (
            SELECT row_number() OVER () AS face_id, f FROM faces
        ), pieces AS (
            SELECT face_id, ST_UnaryUnion(ST_Collect(ST_Intersection(n.f, land.g))) AS g
            FROM numbered n
            JOIN (SELECT g FROM merged UNION ALL SELECT g FROM large) land ON n.f && land.g AND ST_Intersects(n.f, land.g)
            GROUP BY face_id
        ), polygons AS (
            SELECT (ST_Dump(g)).geom AS g FROM pieces
        )
        SELECT row_number() OVER () AS n, g FROM polygons WHERE GeometryType(g) = 'POLYGON' AND ST_Area(g) >= 150;
        CREATE INDEX ON block_shapes USING gist (g);
        INSERT INTO city_block (id, authority_code, geometry, area_square_metres, dwellings,
                                median_price_per_square_metre, median_value, period, source_release_id)
        SELECT format('%s:%s', authority, s.n), authority, ST_Transform(s.g, 4326), ST_Area(s.g),
               count(*), percentile_cont(0.5) WITHIN GROUP (ORDER BY d.ppm),
               percentile_cont(0.5) WITHIN GROUP (ORDER BY d.value)::bigint,
               max(d.period), p_source_release_id
        FROM block_shapes s JOIN block_dwellings d ON s.g && d.point AND ST_Contains(s.g, d.point)
        GROUP BY s.n, s.g
        HAVING count(*) >= 2;
        GET DIAGNOSTICS n = ROW_COUNT;
        inserted := inserted + n;
        DROP TABLE block_shapes;
    END LOOP;
    RETURN inserted;
END;
$$;

-- Tile: blocks at zoom 12-14 (simplified for the outer levels), parcels
-- (simplified at 15) and parcel-less dwellings from zoom 15. Parcel id / UPRN
-- ride as MVT feature ids so hover and selection can address them; the
-- address only travels from zoom 16 to keep mid-zoom tiles small.
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
          -- Blocks under a few pixels at the outer zooms are not worth the bytes.
          AND b.area_square_metres >= CASE WHEN z <= 12 THEN 5000 WHEN z = 13 THEN 800 ELSE 0 END
          -- Green-belt faces (over 20 ha with under one dwelling per hectare) stay uncoloured.
          AND NOT (b.area_square_metres > 200000 AND b.dwellings < b.area_square_metres / 10000)
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
