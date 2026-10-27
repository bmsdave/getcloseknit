"""Street trees and Green streets: map tiles (migration 066, loaded by deploy/tools/etl_green_streets.py).

  street_trees   GLA public realm trees (council, TfL, Royal Parks; no private gardens). From zoom 12;
                 below zoom 15 one point per cell (a 64th of the tile, ~100 m at 12, ~25 m at 14) with
                 n = how many trees, for the map's heat; from 15 one point per tree with its
                 kind, height, canopy spread, girth, age and owner as recorded
  green_streets  OS Open Roads links from zoom 13, each with its street trees per 100 m and the share
                 of its kerbs under canopy; from zoom 14 the same tile carries `green_street_bands`
                 (migration 102), a 35 m buffer each side of every link with trees, the zone of homes
                 along it, with its trees per 100 m
  canopy         PNG tiles, zoom 8-14, of green cover seen from Sentinel-2 in summer 2025 (10 m cells,
                 NDVI 0.4+ in four shades, private gardens included; zoom 8-10 the share of green per
                 pixel)

Tiles cover a box of the map at one zoom: never every tree at once. Both are empty below their zoom
and before the migration.
"""
from __future__ import annotations

from collections.abc import Callable

from . import evidence

MAX_ZOOM = 22
TREE_MIN_ZOOM = 12
TREE_POINT_ZOOM = 15
STREET_MIN_ZOOM = 13

TILE_READY_SQL = """-- evidence:street-tree-tiles-ready
SELECT to_regproc('public.street_tree_tile') IS NOT NULL AND to_regproc('public.green_street_tile') IS NOT NULL AS t"""

STREET_TREE_TILE_SQL = """-- evidence:street-tree-tile
SELECT street_tree_tile(%s, %s, %s) AS tile"""

# The heat below zoom 15: trees per cell of a 64th of the tile, so the cells sit 8 px apart on
# screen, well inside the heat's radius (no polka dots). Migration 066's function counts per eighth of the
# tile for its old number bubbles; this finer grid needs no migration (street_tree is 064's table). Only
# trees inside the tile: the map's heat draws across tile edges, so a margin would count a tree twice.
# A zoom 12 tile of central London: 0.36 s, 3,300 cells, 50 KB (local copy, 1.1 million trees).
STREET_TREE_HEAT_SQL = """-- evidence:street-tree-heat-tile
WITH tile AS (SELECT ST_TileEnvelope(%s, %s, %s) AS bounds), cells AS (
    SELECT ST_Centroid(ST_Collect(t.at)) AS at, count(*)::integer AS n
    FROM tile, LATERAL (SELECT ST_Transform(s.location, 3857) AS at FROM street_tree s
                        WHERE s.location && ST_Transform(tile.bounds, 4326)) t
    WHERE t.at && tile.bounds
    GROUP BY ST_SnapToGrid(t.at, (ST_XMax(tile.bounds) - ST_XMin(tile.bounds)) / 64)
)
SELECT ST_AsMVT(f, 'street_trees', 4096, 'geom') AS tile FROM (
    SELECT ST_AsMVTGeom(cells.at, tile.bounds, 4096, 0, true) AS geom, cells.n FROM cells, tile
) f WHERE f.geom IS NOT NULL"""

GREEN_STREET_TILE_SQL = """-- evidence:green-street-tile
SELECT green_street_tile(%s, %s, %s) AS tile"""

CANOPY_ZOOMS = (8, 14)

CANOPY_READY_SQL = """-- evidence:canopy-tiles-ready
SELECT to_regclass('public.canopy_tile') IS NOT NULL AS t"""

CANOPY_TILE_SQL = """-- evidence:canopy-tile
SELECT png FROM canopy_tile WHERE z = %s AND x = %s AND y = %s"""


def _check_tile(z: int, x: int, y: int) -> None:
    if not 0 <= z <= MAX_ZOOM or not 0 <= x < 2 ** z or not 0 <= y < 2 ** z:
        raise evidence.MalformedQuery(f"tile out of range: {z}/{x}/{y}")


def _tile(reader: evidence.EvidenceReader, sql: str, z: int, x: int, y: int,
          cancel: Callable[[], bool] | None) -> bytes:
    with reader._connect() as connection:
        evidence._active_release(connection, cancel)
        if not list(connection.execute(TILE_READY_SQL))[0]["t"]:
            return b""
        rows = list(connection.execute(sql, (z, x, y)))
        return bytes(rows[0]["tile"] or b"") if rows else b""


def street_tree_tile(reader: evidence.EvidenceReader, z: int, x: int, y: int,
                     cancel: Callable[[], bool] | None = None) -> bytes:
    """Street trees (`street_trees`) from zoom 12: counts per cell for the heat below zoom 15, single trees from 15."""
    evidence._check_cancelled(cancel)
    _check_tile(z, x, y)
    if z < TREE_MIN_ZOOM:
        return b""
    return _tile(reader, STREET_TREE_HEAT_SQL if z < TREE_POINT_ZOOM else STREET_TREE_TILE_SQL, z, x, y, cancel)


def canopy_tile(reader: evidence.EvidenceReader, z: int, x: int, y: int,
                cancel: Callable[[], bool] | None = None) -> bytes:
    """Canopy (PNG): green cover from the Sentinel-2 summer NDVI mosaic, zoom 8-14; empty elsewhere,
    where a tile holds no green, and before the migration."""
    evidence._check_cancelled(cancel)
    _check_tile(z, x, y)
    if not CANOPY_ZOOMS[0] <= z <= CANOPY_ZOOMS[1]:
        return b""
    with reader._connect() as connection:
        evidence._active_release(connection, cancel)
        if not list(connection.execute(CANOPY_READY_SQL))[0]["t"]:
            return b""
        rows = list(connection.execute(CANOPY_TILE_SQL, (z, x, y)))
        return bytes(rows[0]["png"]) if rows else b""


def green_street_tile(reader: evidence.EvidenceReader, z: int, x: int, y: int,
                      cancel: Callable[[], bool] | None = None) -> bytes:
    """Road links with their street trees (`green_streets`: per_100m, canopy, trees, name) from zoom 13, and
    from 14 the band of homes along each one with trees (`green_street_bands`: per_100m, migration 102)."""
    evidence._check_cancelled(cancel)
    _check_tile(z, x, y)
    if z < STREET_MIN_ZOOM:
        return b""
    return _tile(reader, GREEN_STREET_TILE_SQL, z, x, y, cancel)
