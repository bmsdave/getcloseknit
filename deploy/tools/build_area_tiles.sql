-- Builds the map's area tiles (migrations 116, 119) for the current boundary set: first the shapes (area_shape,
-- then area_shape_zoom per zoom: one coverage simplified and snapped to each zoom's tile grid), then zoom 5-12, one
-- tile set per kind of area; records the build and drops all but the two newest builds' tiles (an API still
-- holding the previous release keeps serving it until it restarts). Safe to run again (each step is rebuilt).
--
--   docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T database \
--     psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -f - < deploy/tools/build_area_tiles.sql
--
-- One statement per step, each its own transaction: the site keeps serving. Local copy of England: ~5 min of
-- shapes, then the tiles; deploy/tools/area_topology.py checks the result.
\set ON_ERROR_STOP 1
\timing on
SELECT area_tile_release() AS release \gset
\echo building area shapes and tiles for :release
SELECT build_area_shapes() AS shapes;
SELECT format('SELECT %s AS z, build_area_shape_zoom(%s) AS shapes', z, z) FROM generate_series(5, 12) z
\gexec
SELECT format('SELECT %L AS kind, %s AS z, build_area_tiles(%L, %L, %s) AS tiles', kind, z, :'release', kind, z)
FROM unnest(ARRAY['borough', 'msoa', 'lsoa']) kind, generate_series(5, 12) z
ORDER BY kind, z
\gexec
INSERT INTO area_tile_build (release, min_zoom, max_zoom, tiles, bytes)
SELECT :'release', 5, 12, count(*), coalesce(sum(length(tile)), 0) FROM area_tile WHERE release = :'release'
ON CONFLICT (release) DO UPDATE SET tiles = EXCLUDED.tiles, bytes = EXCLUDED.bytes, built_at = now();
DELETE FROM area_tile_build WHERE release NOT IN (SELECT release FROM area_tile_build ORDER BY built_at DESC LIMIT 2);
DELETE FROM area_tile WHERE release NOT IN (SELECT release FROM area_tile_build);
SELECT release, tiles, pg_size_pretty(bytes) AS bytes, built_at FROM area_tile_build ORDER BY built_at DESC;
SELECT pg_size_pretty(pg_total_relation_size('area_tile')) AS tiles_on_disk,
       pg_size_pretty(pg_total_relation_size('area_shape') + pg_total_relation_size('area_shape_zoom')) AS shapes_on_disk;
