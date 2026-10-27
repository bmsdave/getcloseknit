"""The map's area boundaries as vector tiles (migrations 116, 119, 125): the only way area shapes reach the browser.

The boundaries are ready-made Mapbox Vector Tiles, one tile set per kind of area, built once per boundary set into
area_tile (zoom 5-12; the map overzooms 12 further in) and served as immutable files:

    GET /api/v1/tiles/areas/{release}/{kind}/{z}/{x}/{y}.mvt   kind = lsoa | msoa | borough

Each feature's id is its ONS code as an integer (E01000001 -> 1000001), the same number web/src/lib/area-tiles.ts
derives from the area id, and carries no values: the colours stay feature-state from the value packs. map-coverage.v1
names the tiles (`areaTiles`). With CLOSE_KNIT_ENGLAND off the map is London's: its tiles hold London's areas alone
(area_region_tile_mvt, made on request) under a release of their own, so a browser that keeps a tile for good never
shows a London-only one on the England map. What the map needs of the shapes besides drawing them (each area's box:
the in-view scale, the view's region, fitting an area) is the box index, per chunk (`GET /api/v1/areas/boxes`).
"""
from __future__ import annotations

import hashlib
import re
from collections.abc import Mapping
from typing import Any

from . import coverage

KINDS = ("lsoa", "msoa", "borough")
MIN_ZOOM = 5
MAX_ZOOM = 12
BOXES_SCHEMA = "area-boxes.v1"
RELEASE_PATTERN = re.compile(r"^a\d-[0-9a-f]{12}$")

READY_SQL = """-- evidence:area-tiles-ready
SELECT to_regproc('public.area_tile_mvt') IS NOT NULL AND to_regclass('public.area_tile_build') IS NOT NULL AS ready,
       to_regclass('public.area_pmtiles') IS NOT NULL AS files"""

# The newest static files of each scope (migration 127, deploy/tools/area_pmtiles.py): every area (region_code NULL)
# and London's alone.
FILES_SQL = """-- evidence:area-pmtiles
SELECT DISTINCT ON (region_code) release, region_code FROM area_pmtiles ORDER BY region_code, built_at DESC"""

INFO_SQL = """-- evidence:area-tiles-info
SELECT r.release, EXISTS (SELECT 1 FROM area_tile_build b WHERE b.release = r.release) AS built
FROM (SELECT area_tile_release() AS release) r"""

STORED_TILE_SQL = """-- evidence:area-tile
SELECT tile FROM area_tile WHERE release = %s AND kind = %s AND z = %s AND x = %s AND y = %s"""

LIVE_TILE_SQL = """-- evidence:area-tile-live
SELECT area_tile_mvt(%s, %s, %s, %s) AS tile"""

# One region's areas alone (migration 125): the London map's tiles.
REGION_TILE_SQL = """-- evidence:area-tile-region
SELECT area_region_tile_mvt(%s, %s, %s, %s, %s) AS tile"""

# The box index: each area's box (4 decimals: ~10 m), for the areas of a chunk or every area of the kind.
BOXES_SQL = """-- evidence:area-boxes
SELECT g.id AS geography_id, round(ST_XMin(g.geometry)::numeric, 4)::float8 AS west,
  round(ST_YMin(g.geometry)::numeric, 4)::float8 AS south, round(ST_XMax(g.geometry)::numeric, 4)::float8 AS east,
  round(ST_YMax(g.geometry)::numeric, 4)::float8 AS north
FROM area_geography g
WHERE g.kind = %s AND (%s::text[] IS NULL OR g.id = ANY(%s::text[]))
ORDER BY g.id"""


def london_release(release: str) -> str:
    """The London-only tile set's release: the same form as the boundary set's, other URLs."""
    digest = hashlib.md5(f"{release}:{coverage.LONDON_REGION}".encode()).hexdigest()[:12]
    return f"{release.split('-', 1)[0]}-{digest}"


def tile_info(connection: Any) -> dict | None:
    """The boundary set's tile release and whether its tiles are stored; None before migration 116."""
    ready = list(connection.execute(READY_SQL))
    if not ready or not ready[0]["ready"]:
        return None
    row = list(connection.execute(INFO_SQL))[0]
    files = {"england": None, "london": None}
    if ready[0].get("files"):
        for found in connection.execute(FILES_SQL):
            if found["region_code"] in (None, coverage.LONDON_REGION):
                files["london" if found["region_code"] else "england"] = found["release"]
    return {"release": row["release"], "london": london_release(row["release"]), "built": bool(row["built"]),
            "files": files, "minzoom": MIN_ZOOM, "maxzoom": MAX_ZOOM}


def with_tiles(payload: Mapping[str, Any], info: Mapping[str, Any] | None, *, london: bool = False) -> dict:
    """map-coverage.v1 with the tiles the map draws its areas from (`areaTiles`): London's alone for the London map.
    The static files once built (one PMTiles archive per kind, served by Caddy), else the API's tiles."""
    body = dict(payload)
    if info is not None:
        static = (info.get("files") or {}).get("london" if london else "england")
        release = static or (info["london"] if london else info["release"])
        url = (f"/tiles/areas-{static}-{{kind}}.pmtiles" if static
               else f"/api/v1/tiles/areas/{release}/{{kind}}/{{z}}/{{x}}/{{y}}.mvt")
        body["areaTiles"] = {"release": release, "minzoom": info["minzoom"], "maxzoom": info["maxzoom"], "url": url}
    return body


def london_only(info: Mapping[str, Any], release: str, england: bool) -> bool:
    """Whether a tile request gets London's areas alone: the London map's release, or any with the flag off."""
    return release == info["london"] or not england


def immutable(info: Mapping[str, Any] | None, release: str, england: bool) -> bool:
    """Whether a tile URL holds what it holds now for good: the current London release, or the current one with the
    flag on (with it off, that URL answers London's areas for now)."""
    return info is not None and (release == info["london"] or (england and release == info["release"]))


def tile_problem(release: str, kind: str, z: int, x: int, y: int) -> str | None:
    """Why a tile address is invalid, or None."""
    if not RELEASE_PATTERN.match(release):
        return f"invalid tile release: {release}"
    if kind not in KINDS:
        return f"invalid area kind: {kind}"
    if not 0 <= z <= 22 or not 0 <= x < 2 ** z or not 0 <= y < 2 ** z:
        return f"tile out of range: {z}/{x}/{y}"
    return None
