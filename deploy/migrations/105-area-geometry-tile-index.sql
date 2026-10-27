-- 105: Martin's area_geometry tiles read through the geometry index, and only the kinds a zoom can show
--      (England map, 2026-10-22).
--
--   area_geometry(z, x, y)  migration 001 filtered with ST_Transform(g.geometry, 3857) && tile, which no
--                           index can serve: every tile transformed every area (5,000 London ones; with
--                           all of England's 40,907 rows a tile became a full scan). The tile's envelope is
--                           now transformed once to 4326 and tested against area_geography_geometry_gix.
--                           Kinds follow the map's levels: LADs (borough) at every zoom, MSOAs from z9,
--                           LSOAs from z11, so a zoomed-out tile never carries 33,755 neighbourhoods.
--
-- No table or data change. Safe to run again.

CREATE OR REPLACE FUNCTION public.area_geometry(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
    WITH bounds AS (
        SELECT ST_TileEnvelope(z, x, y) AS geometry
    ), tile_features AS (
        SELECT
            g.id,
            g.kind::text,
            g.name,
            ST_AsMVTGeom(ST_Transform(g.geometry, 3857), bounds.geometry) AS geometry
        FROM area_geography g, bounds
        WHERE g.geometry && ST_Transform(bounds.geometry, 4326)
          AND (g.kind = 'borough' OR (g.kind = 'msoa' AND z >= 9) OR (g.kind = 'lsoa' AND z >= 11))
    )
    SELECT ST_AsMVT(tile_features, 'area_geometry', 4096, 'geometry')
    FROM tile_features;
$$;
