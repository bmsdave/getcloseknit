-- 125: vector tiles are the only way area shapes reach the browser (2026-10-26, docs/review-2026-10/review.md #7).
-- Safe to run again; apply with psql --single-transaction -v ON_ERROR_STOP=1. No table or data change, no rebuild.
--
-- area_geometry(z,x,y)                      gone: Martin's tile function (migrations 001, 105), unused since the map
--                                           reads area_tile (116, 119) and Martin left the compose files.
-- area_region_tile_mvt(kind,z,x,y,region)   119's area_tile_mvt keeping only the areas of one region (a region code,
--                                           E12...; NULL keeps every area): the London map's tiles with
--                                           CLOSE_KNIT_ENGLAND off (api/area_api/map_tiles.py), made on request,
--                                           so the flag withholds the shapes outside London as it does their values.
-- area_tile_mvt(kind,z,x,y)                 the same with every area (one body for both).

DROP FUNCTION IF EXISTS public.area_geometry(integer, integer, integer);

CREATE OR REPLACE FUNCTION public.area_region_tile_mvt(area_kind text, z integer, x integer, y integer, region_code text)
RETURNS bytea
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
    WITH tile AS (
        SELECT ST_XMin(b) AS west, ST_YMax(b) AS north, ST_XMax(b) - ST_XMin(b) AS side,
               ST_TileEnvelope(z, x, y, margin => 64.0 / 4096) AS search, area_tile_extent(z) AS extent
        FROM ST_TileEnvelope(z, x, y) b
    )
    SELECT coalesce(ST_AsMVT(f, area_kind, (SELECT extent FROM tile), 'geom', 'fid'), '') FROM (
        SELECT s.fid,
               ST_ForcePolygonCCW(ST_CollectionExtract(ST_ClipByBox2D(
                   ST_SnapToGrid(ST_Affine(s.geom, tile.extent / tile.side, 0, 0, -tile.extent / tile.side,
                                           -tile.west * tile.extent / tile.side, tile.north * tile.extent / tile.side), 1),
                   ST_MakeEnvelope(-tile.extent / 64, -tile.extent / 64, tile.extent * 65 / 64, tile.extent * 65 / 64,
                                   ST_SRID(s.geom))), 3)) AS geom
        FROM tile, area_shape_zoom s
        WHERE s.kind = area_kind AND s.z = least(area_region_tile_mvt.z, 12) AND s.geom && tile.search
          AND (area_region_tile_mvt.region_code IS NULL OR EXISTS (
              SELECT 1 FROM area_region r
              WHERE r.area_id = s.id AND r.region_code = area_region_tile_mvt.region_code))
    ) f
    WHERE NOT ST_IsEmpty(f.geom)
$$;

-- As 119 (see there for why not ST_AsMVTGeom); build_area_tiles stores these.
CREATE OR REPLACE FUNCTION public.area_tile_mvt(area_kind text, z integer, x integer, y integer)
RETURNS bytea
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT area_region_tile_mvt(area_kind, z, x, y, NULL) $$;
