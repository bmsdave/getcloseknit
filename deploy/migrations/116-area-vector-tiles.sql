-- 116: area boundaries as vector tiles (the map's fill, 2026-10-25). Safe to run again; apply with
-- psql --single-transaction -v ON_ERROR_STOP=1.
--
-- The map drew its areas from GeoJSON pieces (api/area_api/map_chunks.py): every pan sent shapes to MapLibre's
-- worker and every new tile replayed the colours of up to 27k areas (perf/layer-load/README.md, "Interaction").
-- Now the boundaries are ready-made Mapbox Vector Tiles, one tile set per kind of area; the colours stay
-- feature-state on them.
--
-- area_tile_mvt(kind, z, x, y)  one tile of one kind of area (lsoa, msoa, borough), its layer named after the
--                           kind. Each feature's id is its ONS code as an integer (E01000001 -> 1000001: unique
--                           across kinds; the browser derives the same number from the area id) and it carries
--                           no properties: no values, colours come from the value packs. Shapes are simplified
--                           to 3 units of the tile's 4096 (0.375 px of a 512 px tile, as MapLibre simplifies
--                           GeoJSON) and snapped to the grid; the tile's box is moved to WGS84 once so the GiST
--                           index on area_geography picks the areas.
-- area_tile_release()       the boundary set's id ('a1-' + a hash of every area id): area_geography only grows
--                           (no update or delete), so a new area makes a new release and new tile URLs.
-- area_tile                 the pre-built tiles of one release, zoom 5-12 over England (empty tiles not stored);
--                           the map overzooms 12 further in. Built by deploy/tools/build_area_tiles.sh.
-- area_tile_build           one row per built release: zooms, tiles, bytes. Until it exists the API answers
--                           from area_tile_mvt directly (a fresh database, a local copy).

CREATE OR REPLACE FUNCTION public.area_tile_release()
RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
    SELECT 'a1-' || left(md5(string_agg(id, ',' ORDER BY id)), 12) FROM area_geography
$$;

CREATE OR REPLACE FUNCTION public.area_tile_mvt(area_kind text, z integer, x integer, y integer)
RETURNS bytea
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
    WITH tile AS (
        SELECT ST_TileEnvelope(z, x, y) AS bounds,
               ST_Transform(ST_TileEnvelope(z, x, y, margin => 64.0 / 4096), 4326) AS search,
               (ST_XMax(ST_TileEnvelope(z, x, y)) - ST_XMin(ST_TileEnvelope(z, x, y))) * 3 / 4096 AS tolerance
    )
    SELECT coalesce(ST_AsMVT(f, area_kind, 4096, 'geom', 'fid'), '') FROM (
        SELECT substr(g.official_code, 2)::integer AS fid,
               ST_AsMVTGeom(ST_SimplifyPreserveTopology(ST_Transform(g.geometry, 3857), tile.tolerance),
                            tile.bounds, 4096, 64, true) AS geom
        FROM tile, area_geography g
        WHERE g.geometry && tile.search AND g.kind::text = area_kind
    ) f
    WHERE f.geom IS NOT NULL
$$;

DROP FUNCTION IF EXISTS public.area_tile_mvt(integer, integer, integer);

CREATE TABLE IF NOT EXISTS area_tile (
    release text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('lsoa', 'msoa', 'borough')),
    z smallint NOT NULL CHECK (z BETWEEN 0 AND 22),
    x integer NOT NULL CHECK (x >= 0),
    y integer NOT NULL CHECK (y >= 0),
    tile bytea NOT NULL,
    PRIMARY KEY (release, kind, z, x, y)
);

CREATE TABLE IF NOT EXISTS area_tile_build (
    release text PRIMARY KEY,
    min_zoom smallint NOT NULL,
    max_zoom smallint NOT NULL,
    tiles integer NOT NULL,
    bytes bigint NOT NULL,
    built_at timestamptz NOT NULL DEFAULT now()
);

-- The tiles of one kind and zoom for a release: every tile a LAD's box touches (LSOAs and MSOAs nest in LADs),
-- empty ones dropped. Returns how many were stored.
CREATE OR REPLACE FUNCTION public.build_area_tiles(p_release text, p_kind text, p_zoom integer)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE stored integer;
BEGIN
    DELETE FROM area_tile WHERE release = p_release AND kind = p_kind AND z = p_zoom;
    INSERT INTO area_tile (release, kind, z, x, y, tile)
    SELECT p_release, p_kind, p_zoom, t.x, t.y, t.tile
    FROM (
        SELECT c.x, c.y, area_tile_mvt(p_kind, p_zoom, c.x, c.y) AS tile
        FROM (
            SELECT DISTINCT tx AS x, ty AS y
            FROM area_geography b,
                 LATERAL (SELECT 2 ^ p_zoom AS n) size,
                 LATERAL generate_series(floor((ST_XMin(b.geometry) + 180) / 360 * size.n)::integer,
                                         floor((ST_XMax(b.geometry) + 180) / 360 * size.n)::integer) tx,
                 LATERAL generate_series(
                     floor((1 - ln(tan(radians(ST_YMax(b.geometry))) + 1 / cos(radians(ST_YMax(b.geometry)))) / pi()) / 2 * size.n)::integer,
                     floor((1 - ln(tan(radians(ST_YMin(b.geometry))) + 1 / cos(radians(ST_YMin(b.geometry)))) / pi()) / 2 * size.n)::integer) ty
            WHERE b.kind = 'borough'
        ) c
        OFFSET 0  -- each tile made once (not again for the filter below)
    ) t
    WHERE length(t.tile) > 0;
    GET DIAGNOSTICS stored = ROW_COUNT;
    RETURN stored;
END;
$$;

DROP FUNCTION IF EXISTS public.build_area_tiles(text, integer);
