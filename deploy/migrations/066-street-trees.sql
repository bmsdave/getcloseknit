-- 066: Street trees and Green streets on the map, loaded by deploy/tools/etl_green_streets.py.
--
--   street_tree (064)  gains each tree's size and age as its owner recorded them: height, canopy
--                      spread and trunk girth as tidied text ("8 m", "5-10 m", "under 3 m", "Sapling"),
--                      canopy_m for the dot size (a range's middle, a bound's own value) and age
--                      ("Mature (31-80)"). Null where not recorded.
--   road_link          OS Open Roads (OGL v3) centre lines inside Greater London, without motorways,
--                      slip roads, tunnels and service lanes, with the street trees beside each: every
--                      tree counts once, for its nearest link within 20 m (rebuild_green_streets()).
--   street_tree_tile   vector tiles `street_trees` from zoom 13: counts per cell below zoom 15, then one
--                      point per tree with its kind, size, age and owner
--   green_street_tile  vector tiles `green_streets` from zoom 13: each link's trees per 100 m and the
--                      share of its kerbs under canopy (when most of its trees have a canopy recorded)
--   canopy_tile        PNG map tiles, zoom 11-14, of the Sentinel-2 summer NDVI mosaic (migration 064's
--                      10 m grid): green where NDVI is 0.4 or more, private gardens included, in four
--                      shades; loaded by deploy/tools/etl_canopy.py
--
-- Safe to run again.

ALTER TABLE street_tree
    ADD COLUMN IF NOT EXISTS height text,     -- "13 m", "5-10 m", "under 3 m", "15+ m"
    ADD COLUMN IF NOT EXISTS canopy text,     -- canopy spread, the same forms
    ADD COLUMN IF NOT EXISTS girth text,      -- trunk girth at breast height: "32 cm", "Multi-stemmed", "Sapling"
    ADD COLUMN IF NOT EXISTS canopy_m real CHECK (canopy_m IS NULL OR canopy_m BETWEEN 0 AND 60),
    ADD COLUMN IF NOT EXISTS age text;        -- "Young (0-15)", "Mature (31-80)", "Veteran (over 150)"

CREATE TABLE IF NOT EXISTS road_link (
    id text PRIMARY KEY,                       -- the OS Open Roads link identifier
    name text,                                 -- e.g. "Kyverdale Road"; null when unnamed
    road_function text NOT NULL,               -- "A Road", "B Road", "Minor Road", "Local Road", ...
    length_m real NOT NULL CHECK (length_m > 0),
    trees integer NOT NULL DEFAULT 0 CHECK (trees >= 0),          -- street trees counted on this link
    canopy_trees integer NOT NULL DEFAULT 0 CHECK (canopy_trees >= 0),  -- of them, with a canopy spread recorded
    canopy_sum_m real NOT NULL DEFAULT 0 CHECK (canopy_sum_m >= 0),     -- their canopy spreads added up
    geometry geometry(LineString, 27700) NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id)
);
CREATE INDEX IF NOT EXISTS road_link_geometry_idx ON road_link USING gist (geometry);

-- Counts every street tree once, for the nearest road link within 20 m (street trees stand on the
-- pavement, a few metres from the centre line; park trees deeper than that count for no street).
CREATE OR REPLACE FUNCTION public.rebuild_green_streets()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
    counted integer;
BEGIN
    WITH tree AS (
        SELECT ST_Transform(t.location, 27700) AS at, t.canopy_m FROM street_tree t
    ), nearest AS (
        SELECT l.id, tree.canopy_m
        FROM tree CROSS JOIN LATERAL (
            SELECT r.id FROM road_link r
            WHERE ST_DWithin(r.geometry, tree.at, 20)
            ORDER BY r.geometry <-> tree.at
            LIMIT 1
        ) l
    ), counts AS (
        SELECT id, count(*)::integer AS trees, count(canopy_m)::integer AS canopy_trees,
               coalesce(sum(canopy_m), 0)::real AS canopy_sum_m
        FROM nearest GROUP BY id
    )
    UPDATE road_link r
    SET trees = coalesce(c.trees, 0), canopy_trees = coalesce(c.canopy_trees, 0), canopy_sum_m = coalesce(c.canopy_sum_m, 0)
    FROM road_link r2 LEFT JOIN counts c ON c.id = r2.id
    WHERE r.id = r2.id;
    SELECT coalesce(sum(trees), 0) INTO counted FROM road_link;
    RETURN counted;
END;
$$;

-- Vector tiles of street trees (`street_trees`, zoom 13+; a zoom 12 tile of central London took 0.7 s).
-- Below zoom 15 trees sharing a cell (an eighth of the tile: ~600 m at 13, ~300 m at 14) are one point at
-- their middle with n = how many. From zoom 15 each tree is its own point (n = 1) with its kind, size,
-- age and owner.
CREATE OR REPLACE FUNCTION public.street_tree_tile(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE plpgsql
STABLE PARALLEL SAFE
AS $$
DECLARE
    bounds geometry := ST_TileEnvelope(z, x, y);
    cell double precision := (ST_XMax(bounds) - ST_XMin(bounds)) / 8;
    tile bytea;
BEGIN
    IF z < 13 THEN
        RETURN NULL;
    END IF;
    IF z < 15 THEN
        SELECT ST_AsMVT(f, 'street_trees', 4096, 'geom') INTO tile FROM (
            SELECT ST_AsMVTGeom(ST_Centroid(ST_Collect(t.at)), bounds, 4096, 64, true) AS geom, count(*)::integer AS n
            FROM (SELECT ST_Transform(s.location, 3857) AS at FROM street_tree s
                  WHERE s.location && ST_Transform(bounds, 4326)) t
            WHERE t.at && bounds
            GROUP BY ST_SnapToGrid(t.at, cell)
        ) f WHERE f.geom IS NOT NULL;
    ELSE
        -- Trees just over the edge too (the 64-unit buffer), so a wide crown is never cut at a tile seam.
        SELECT ST_AsMVT(f, 'street_trees', 4096, 'geom') INTO tile FROM (
            SELECT ST_AsMVTGeom(ST_Transform(s.location, 3857), bounds, 4096, 64, true) AS geom,
                   s.common_name AS name, s.height, s.canopy, s.girth, s.canopy_m, s.age, s.owner, 1 AS n
            FROM street_tree s
            WHERE s.location && ST_Transform(ST_TileEnvelope(z, x, y, margin => 64.0 / 4096), 4326)
        ) f WHERE f.geom IS NOT NULL;
    END IF;
    RETURN tile;
END;
$$;

-- Vector tiles of road links coloured by their street trees (`green_streets`, zoom 13+): per_100m is
-- trees per 100 m of link (a link shorter than 50 m counts as 50 m, so a lone tree on a short stub does
-- not read as an avenue), canopy the share of its two kerbs under canopy (0-1), null unless at least
-- four in five of its trees have a canopy spread recorded.
CREATE OR REPLACE FUNCTION public.green_street_tile(z integer, x integer, y integer)
RETURNS bytea
LANGUAGE plpgsql
STABLE PARALLEL SAFE
AS $$
DECLARE
    bounds geometry := ST_TileEnvelope(z, x, y);
    tile bytea;
BEGIN
    IF z < 13 THEN
        RETURN NULL;
    END IF;
    SELECT ST_AsMVT(f, 'green_streets', 4096, 'geom') INTO tile FROM (
        SELECT ST_AsMVTGeom(ST_Transform(r.geometry, 3857), bounds, 4096, 64, true) AS geom,
               r.name, r.trees,
               round((r.trees * 100.0 / greatest(r.length_m, 50))::numeric, 1)::real AS per_100m,
               CASE WHEN r.trees > 0 AND r.canopy_trees * 5 >= r.trees * 4
                    THEN round(least(1, r.canopy_sum_m / (2 * greatest(r.length_m, 50)))::numeric, 2)::real END AS canopy
        FROM road_link r
        WHERE r.geometry && ST_Transform(bounds, 27700)
    ) f WHERE f.geom IS NOT NULL;
    RETURN tile;
END;
$$;

-- Canopy: the 10 m NDVI mosaic as ready-made PNG tiles (Web Mercator, 256 px, zoom 11-14; the map stretches
-- zoom 14 further in). Tiles with no green are not stored.
CREATE TABLE IF NOT EXISTS canopy_tile (
    z smallint NOT NULL CHECK (z BETWEEN 0 AND 22),
    x integer NOT NULL CHECK (x >= 0),
    y integer NOT NULL CHECK (y >= 0),
    png bytea NOT NULL,
    source_release_id text NOT NULL REFERENCES source_release(id),
    PRIMARY KEY (z, x, y)
);
