-- 119: area shapes that fit together at every zoom (2026-10-26). Safe to run again; apply with
-- psql --single-transaction -v ON_ERROR_STOP=1, then build with deploy/tools/build_area_tiles.sql.
--
-- 116 simplified each area on its own (ST_SimplifyPreserveTopology per feature): Douglas-Peucker dropped a vertex
-- of a shared border on one side and kept it on the other, so neighbours overlapped (a darker wedge) or left a
-- sliver of basemap between them (docs/review-2026-10/review.md, "Почему полигоны не стыкуются": 864 overlapping
-- pairs on LSOA tile 9/256/169). The boroughs came from ONS's LAD product, 23-72 m off the union of their LSOAs.
-- Now every shape is cut from one coverage, the ONS 2021 LSOAs:
--
-- area_shape                 full detail (WGS84): LSOAs as area_geography, MSOAs, boroughs (LADs) and regions as
--                            ST_CoverageUnion of their LSOAs (via the ONS LSOA -> MSOA -> LAD lookup in parent_id,
--                            regions from area_region). The ONS LAD shapes in area_geography stay as metadata only.
-- area_shape_zoom            per zoom 5-12 and kind (lsoa, msoa, borough), in 3857: the LSOA coverage simplified
--                            as one (ST_CoverageSimplify ... OVER (), 3 tile units below 12, none at 12), its edges
--                            snap-rounded to the zoom's tile grid and noded (ST_UnaryUnion with a grid size), the
--                            faces given back to the LSOA they lie in (faces in none, sea the rounding closed off,
--                            and an LSOA's sub-pixel crumbs go to the neighbour sharing the longest edge); MSOAs and
--                            boroughs are the union of those LSOAs. Every vertex sits on the tile grid and
--                            neighbours share identical edges: no overlap, no gap, each parent exactly the union of
--                            its children at every zoom (ST_CoverageClean would do this but needs GEOS 3.14 at
--                            build time; prod's PostGIS is built against 3.13).
-- area_tile_extent(z)        4096 units a tile, 8192 at zoom 12 (MapLibre's own precision), the top zoom the map
--                            overzooms: with no simplification there, a vertex is off by at most 0.6 m.
-- area_tile_mvt(kind,z,x,y)  as 116, from area_shape_zoom, moved to tile units and clipped without ST_AsMVTGeom
--                            (which simplifies each feature by half a unit): the tile holds the grid vertices as is.
-- area_tile_release()        'a2-' + the hash of every area id: these shapes are a new tile set (new URLs).

CREATE TABLE IF NOT EXISTS area_shape (
    id text PRIMARY KEY,
    kind text NOT NULL CHECK (kind IN ('lsoa', 'msoa', 'borough', 'region')),
    official_code text NOT NULL,
    parent_id text,
    geometry geometry(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS area_shape_kind_idx ON area_shape (kind, parent_id);
CREATE INDEX IF NOT EXISTS area_shape_geometry_gix ON area_shape USING gist (geometry);

CREATE TABLE IF NOT EXISTS area_shape_zoom (
    kind text NOT NULL CHECK (kind IN ('lsoa', 'msoa', 'borough')),
    z smallint NOT NULL CHECK (z BETWEEN 5 AND 12),
    id text NOT NULL,
    fid integer NOT NULL,
    geom geometry(MultiPolygon, 3857) NOT NULL,
    PRIMARY KEY (kind, z, id)
);
CREATE INDEX IF NOT EXISTS area_shape_zoom_geom_gix ON area_shape_zoom USING gist (geom);

CREATE OR REPLACE FUNCTION public.area_tile_extent(z integer)
RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT CASE WHEN z >= 12 THEN 8192 ELSE 4096 END $$;

-- One unit of zoom z's tile grid in 3857 metres (the grid starts at the projection's corner).
CREATE OR REPLACE FUNCTION public.area_tile_cell(z integer)
RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT 40075016.68557849 / (2 ^ z) / area_tile_extent(z) $$;

-- The full-detail shapes (seconds). Returns how many were stored.
CREATE OR REPLACE FUNCTION public.build_area_shapes()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE stored integer;
BEGIN
    DELETE FROM area_shape;
    INSERT INTO area_shape (id, kind, official_code, parent_id, geometry)
    WITH l AS (
        SELECT g.id, g.official_code, g.parent_id AS msoa_id, m.parent_id AS borough_id, r.region_code, g.geometry
        FROM area_geography g
        JOIN area_geography m ON m.id = g.parent_id
        LEFT JOIN area_region r ON r.area_id = m.parent_id
        WHERE g.kind = 'lsoa'
    )
    SELECT id, 'lsoa', official_code, msoa_id, geometry FROM l
    UNION ALL
    -- ST_CoverageUnion drops the SRID.
    SELECT msoa_id, 'msoa', split_part(msoa_id, ':', 3), min(borough_id),
           ST_SetSRID(ST_Multi(ST_CoverageUnion(geometry)), 4326)
    FROM l GROUP BY msoa_id
    UNION ALL
    SELECT borough_id, 'borough', split_part(borough_id, ':', 3), 'uk:region:' || min(region_code),
           ST_SetSRID(ST_Multi(ST_CoverageUnion(geometry)), 4326)
    FROM l GROUP BY borough_id
    UNION ALL
    SELECT 'uk:region:' || region_code, 'region', region_code, NULL,
           ST_SetSRID(ST_Multi(ST_CoverageUnion(geometry)), 4326)
    FROM l WHERE region_code IS NOT NULL GROUP BY region_code;
    GET DIAGNOSTICS stored = ROW_COUNT;
    ANALYZE area_shape;
    RETURN stored;
END;
$$;

-- One zoom's shapes of every kind (~30 s for England). Returns how many were stored.
CREATE OR REPLACE FUNCTION public.build_area_shape_zoom(p_zoom integer)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    cell constant double precision := area_tile_cell(p_zoom);
    -- Moved by this much the zoom's tile grid starts at 0, the grid ST_UnaryUnion rounds to.
    origin constant double precision := 20037508.342789244;
    stored integer;
BEGIN
    DROP TABLE IF EXISTS shape_simple, shape_face, shape_lsoa;
    CREATE TEMP TABLE shape_simple ON COMMIT DROP AS
    SELECT id, ST_SetSRID(CASE WHEN p_zoom >= 12 THEN g ELSE ST_CoverageSimplify(g, cell * 3) OVER () END, 3857) AS g
    FROM (SELECT id, ST_Translate(ST_Transform(geometry, 3857), origin, origin) AS g
          FROM area_shape WHERE kind = 'lsoa') s;
    CREATE INDEX ON shape_simple USING gist (g);
    -- Every edge snap-rounded to the grid and noded, then cut into faces.
    CREATE TEMP TABLE shape_face ON COMMIT DROP AS
    SELECT row_number() OVER () AS n, ST_SetSRID(f.g, 3857) AS g, NULL::text AS id, NULL::text AS was
    FROM (SELECT (ST_Dump(ST_Polygonize(l.geom))).geom AS g
          FROM (SELECT (ST_Dump(ST_UnaryUnion(ST_Collect(ST_Boundary(g)), cell))).geom FROM shape_simple) l) f;
    CREATE INDEX ON shape_face USING gist (g);
    CREATE INDEX ON shape_face (n);
    -- Each face to the LSOA it lies in.
    UPDATE shape_face f SET id = (SELECT s.id FROM shape_simple s
                                  WHERE s.g && f.g AND ST_Intersects(s.g, ST_PointOnSurface(f.g)) ORDER BY s.id LIMIT 1);
    FOR round IN 0..3 LOOP
        -- Then an LSOA's crumbs (a part under 64 grid units², a pixel, beside a bigger one) go to a neighbour: a
        -- crumb in a neighbour's hole that touches its shell is a ring ST_CoverageInvalidEdges reports.
        IF round > 0 THEN
            UPDATE shape_face f SET was = f.id, id = NULL
            FROM (SELECT p.id, p.part
                  FROM (SELECT id, (ST_Dump(ST_SetSRID(ST_CoverageUnion(g), 3857))).geom AS part
                        FROM shape_face WHERE id IS NOT NULL GROUP BY id) p
                  WHERE ST_Area(p.part) < 64 * cell * cell) c
            WHERE f.id = c.id AND f.g && c.part AND ST_Intersects(c.part, ST_PointOnSurface(f.g))
              AND EXISTS (SELECT 1 FROM shape_face o WHERE o.id = c.id AND NOT ST_Intersects(c.part, ST_PointOnSurface(o.g)));
            EXIT WHEN NOT FOUND;
        END IF;
        -- Faces in no LSOA (sea the rounding closed off: England's LSOAs leave no hole) and crumbs go to the
        -- neighbour they share the longest edge with (a crumb: another than its own), a pass at a time (a face may
        -- touch only others like it).
        FOR pass IN 1..10 LOOP
            UPDATE shape_face o SET id = pick.id
            FROM (SELECT DISTINCT ON (u.n) u.n, k.id
                  FROM shape_face u JOIN shape_face k ON k.g && u.g AND k.n <> u.n AND k.id IS NOT NULL
                  WHERE u.id IS NULL
                  ORDER BY u.n, k.id IS NOT DISTINCT FROM u.was,
                           ST_Length(ST_Intersection(ST_Boundary(u.g), ST_Boundary(k.g))) DESC, k.id) pick
            WHERE o.n = pick.n;
            EXIT WHEN NOT FOUND;
        END LOOP;
    END LOOP;
    CREATE TEMP TABLE shape_lsoa ON COMMIT DROP AS
    SELECT id, ST_CoverageUnion(g) AS g FROM shape_face WHERE id IS NOT NULL GROUP BY id;

    DELETE FROM area_shape_zoom WHERE z = p_zoom;
    INSERT INTO area_shape_zoom (kind, z, id, fid, geom)
    SELECT kind, p_zoom, id, substr(split_part(id, ':', 3), 2)::integer,
           ST_SetSRID(ST_Multi(ST_Translate(g, -origin, -origin)), 3857)
    FROM (
        SELECT 'lsoa' AS kind, id, g FROM shape_lsoa
        UNION ALL
        SELECT 'msoa', a.parent_id, ST_CoverageUnion(l.g)
        FROM shape_lsoa l JOIN area_shape a ON a.id = l.id GROUP BY a.parent_id
        UNION ALL
        SELECT 'borough', m.parent_id, ST_CoverageUnion(l.g)
        FROM shape_lsoa l JOIN area_shape a ON a.id = l.id JOIN area_shape m ON m.id = a.parent_id
        GROUP BY m.parent_id
    ) k;
    GET DIAGNOSTICS stored = ROW_COUNT;
    ANALYZE area_shape_zoom;
    RETURN stored;
END;
$$;

CREATE OR REPLACE FUNCTION public.area_tile_release()
RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
    SELECT 'a2-' || left(md5(string_agg(id, ',' ORDER BY id)), 12) FROM area_geography
$$;

CREATE OR REPLACE FUNCTION public.area_tile_mvt(area_kind text, z integer, x integer, y integer)
RETURNS bytea
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
    -- Not ST_AsMVTGeom: it drops every vertex within half a unit of its neighbours' chord, per feature, which on
    -- shapes already on the grid opens slivers between neighbours again. The shapes go to tile units as they are
    -- (an exact affine map: their vertices land on whole units), are cut to the tile and its 64-unit margin (a
    -- clip moves nothing inside it) and turned to the MVT winding (exterior rings positive with y down).
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
        WHERE s.kind = area_kind AND s.z = least(area_tile_mvt.z, 12) AND s.geom && tile.search
    ) f
    WHERE NOT ST_IsEmpty(f.geom)
$$;

-- As 116, the tiles a borough's box touches, its box now from area_shape (the union of its LSOAs).
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
            FROM area_shape b,
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
