-- 127: the map's area tiles as static PMTiles files (2026-10-27, docs/review-2026-10/review.md #8). Safe to run again;
-- apply with psql --single-transaction -v ON_ERROR_STOP=1. A new table only: nothing is rebuilt.
--
-- deploy/tools/area_pmtiles.py packs the tiles of area_shape_zoom (119) into one archive per kind of area,
-- areas-<release>-<kind>.pmtiles, for every area and for London's alone, which Caddy serves as immutable files.
-- area_pmtiles   one row per release built: release (a hash of the files' bytes, so new shapes are a new release
--                even with the same area ids), region_code (NULL: every area; a region code: that region's areas
--                alone, the London map's with CLOSE_KNIT_ENGLAND off), tiles and bytes. The API serves the newest
--                release of each scope (api/area_api/map_tiles.py).

CREATE TABLE IF NOT EXISTS area_pmtiles (
    release text PRIMARY KEY CHECK (release ~ '^[0-9a-f]{12}$'),
    region_code text,
    tiles integer NOT NULL CHECK (tiles >= 0),
    bytes bigint NOT NULL CHECK (bytes >= 0),
    built_at timestamptz NOT NULL DEFAULT now()
);
