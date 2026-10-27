"""Kids: nurseries, road safety and cycle lanes around an area (migration 062, area-kids.v1).

Three separate figures, never merged into one score, each ranked against London areas of
the same kind (LSOA or MSOA) by deploy/tools/etl_kids.py's rebuild_area_kids():

  nurseries   well-rated nurseries and pre-schools within 1 km (Ofsted; childminders are not
              included), with the nearest few named, as schools are
  roadSafety  pedestrians and cyclists hurt within 500 m over five years (DfT STATS19),
              children counted apart; fewer is better
  cycling     km of protected lane and of TfL Cycleway within 1 km (TfL)

Aggregates only: no person, vehicle or home is ever named. Boroughs have no row.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from . import evidence, schools

SCHEMA_VERSION = "area-kids.v1"
NURSERY_RADIUS_METRES = 1000
CASUALTY_RADIUS_METRES = 500
LANE_RADIUS_METRES = 1000
NEAREST_NURSERIES = 6
TILE_ZOOM = (11, 22)
OFSTED_PROVIDER_URL = "https://reports.ofsted.gov.uk/provider/16/{urn}"

AREA_KIDS_SQL = """-- evidence:area-kids
SELECT k.* FROM area_kids k WHERE k.geography_id = %s"""

NEAREST_NURSERIES_SQL = """-- evidence:kids-nurseries
SELECT n.urn, n.name, n.grade, n.framework, to_char(n.inspection_date, 'YYYY-MM-DD') AS inspected,
  n.well_rated, n.places, round(ST_Distance(n.location, a.point))::integer AS distance
FROM (SELECT ST_Transform(ST_PointOnSurface(geometry), 27700) AS point
      FROM area_geography WHERE id = %s) a
JOIN nursery_setting n ON ST_DWithin(n.location, a.point, %s)
WHERE n.well_rated IS NOT NULL
ORDER BY distance, n.urn LIMIT %s"""

KIDS_SOURCES_SQL = """-- evidence:kids-sources
SELECT id, source_url, to_char(release_date, 'YYYY-MM-DD') AS release_date, licence, attribution, caveats
FROM source_release WHERE id = ANY(%s) ORDER BY id"""

CYCLE_LANE_TILE_SQL = """-- evidence:cycle-lane-tile
SELECT cycle_lane_tile(%s, %s, %s) AS tile"""

COLLISION_TILE_SQL = """-- evidence:collision-tile
SELECT collision_tile(%s, %s, %s) AS tile"""
# Zoomed out: one continuous heat map, not a polka-dot grid. Casualties snap to a fine grid
# (tile / 128, ~300 m at zoom 10, ~75 m at 12) and carry their counts per severity (n1 killed, n2 serious,
# n3 slight; n all), so the map weights them by severity (10 / 3 / 1) and its severity filter still applies.
# Each casualty is in one tile only (its point inside the tile): the heat crosses tile edges by itself.
# Replaces collision_tile()'s grouped branch below zoom 13 without a migration; the function serves 13+.
COLLISION_HEAT_TILE_SQL = """-- evidence:collision-heat-tile
WITH tile AS (SELECT ST_TileEnvelope(%(z)s, %(x)s, %(y)s) AS bounds)
SELECT ST_AsMVT(f, 'collisions', 4096, 'geom') AS tile FROM (
  SELECT ST_AsMVTGeom(ST_SnapToGrid(ST_Transform(c.location, 3857), (ST_XMax(t.bounds) - ST_XMin(t.bounds)) / 128),
           t.bounds, 4096, 64, true) AS geom,
         c.road_user, c.child,
         (count(*) FILTER (WHERE c.severity = 1))::integer AS n1,
         (count(*) FILTER (WHERE c.severity = 2))::integer AS n2,
         (count(*) FILTER (WHERE c.severity = 3))::integer AS n3,
         count(*)::integer AS n
  FROM collision_casualty c, tile t
  WHERE c.location && ST_Transform(t.bounds, 27700) AND ST_Transform(c.location, 3857) && t.bounds
  GROUP BY 1, 2, 3
) f WHERE f.geom IS NOT NULL"""
COLLISION_HEAT_MAX_ZOOM = 12
COLLISION_TILE_READY_SQL = """-- evidence:collision-tile-ready
SELECT to_regproc('public.collision_tile') IS NOT NULL AS t"""
COLLISION_MIN_ZOOM = 10


def _nursery(row: Mapping[str, Any]) -> dict:
    return {"urn": row["urn"], "name": row["name"], "grade": row["grade"], "framework": row["framework"],
            "inspected": row["inspected"], "wellRated": bool(row["well_rated"]), "places": row["places"],
            "distanceMetres": row["distance"], "url": OFSTED_PROVIDER_URL.format(urn=row["urn"])}


def kids_payload(area_id: str, release_id: str, row: Mapping[str, Any] | None,
                 nearest: list[Mapping[str, Any]], sources: list[Mapping[str, Any]]) -> dict:
    """The area-kids.v1 payload; every figure null when the area has no row."""
    if row is None:
        return {"schemaVersion": SCHEMA_VERSION, "productReleaseId": release_id, "geographyId": area_id,
                "available": False, "nurseries": None, "roadSafety": None, "cycling": None, "sources": []}
    first = row["casualty_first_year"]
    by_year = list(row["casualties_by_year"] or [])
    return {
        "schemaVersion": SCHEMA_VERSION,
        "productReleaseId": release_id,
        "geographyId": area_id,
        "available": True,
        "nurseries": {
            "radiusMetres": NURSERY_RADIUS_METRES,
            "rated": row["nursery_rated"],
            "wellRated": row["nursery_good"],
            "share": row["nursery_share"],
            "regionPercentile": row["nursery_percentile"],
            "nearest": [_nursery(item) for item in nearest],
        },
        "roadSafety": {
            "radiusMetres": CASUALTY_RADIUS_METRES,
            "casualties": row["casualties"],
            "children": row["child_casualties"],
            "seriousOrFatal": row["serious_casualties"],
            "cyclists": row["cyclist_casualties"],
            "pedestrians": row["casualties"] - row["cyclist_casualties"],
            "byYear": [{"year": first + index, "count": count} for index, count in enumerate(by_year)]
            if first is not None else [],
            "regionPercentile": row["casualty_percentile"],
        },
        # TfL's lanes are London-only (migration 110 leaves them null elsewhere): no figure, not "0 km".
        "cycling": None if row["protected_km"] is None else {
            "radiusMetres": LANE_RADIUS_METRES,
            "protectedKm": row["protected_km"],
            "cyclewayKm": row["cycleway_km"],
            "regionPercentile": row["cycle_percentile"],
        },
        "sources": [{"id": source["id"], "url": source["source_url"], "releaseDate": source["release_date"],
                     "licence": source["licence"], "attribution": source["attribution"],
                     "caveats": list(source["caveats"] or [])} for source in sources],
    }


def area_kids(reader: evidence.EvidenceReader, area_id: str,
              cancel: Callable[[], bool] | None = None) -> dict:
    """Nurseries, road safety and cycle lanes around an LSOA or MSOA."""
    evidence._check_cancelled(cancel)
    if not schools.AREA_PATTERN.match(area_id or ""):
        raise evidence.MalformedQuery(f"invalid area id: {area_id}")
    with reader._connect() as connection:
        release_id = evidence._active_release(connection, cancel)
        if not list(connection.execute(schools.AREA_EXISTS_SQL, (area_id,))):
            raise evidence.AreaNotFound(f"unknown area: {area_id}")
        rows = list(connection.execute(AREA_KIDS_SQL, (area_id,)))
        row = rows[0] if rows else None
        nearest = (list(connection.execute(NEAREST_NURSERIES_SQL, (area_id, NURSERY_RADIUS_METRES, NEAREST_NURSERIES)))
                   if row else [])
        sources = list(connection.execute(KIDS_SOURCES_SQL, (list(row["source_release_ids"]),))) if row else []
        return kids_payload(area_id, release_id, row, nearest, sources)


def cycle_lane_tile(reader: evidence.EvidenceReader, z: int, x: int, y: int,
                    cancel: Callable[[], bool] | None = None) -> bytes:
    """Cycle lanes (`cycle_lanes`: kind protected, lane or cycleway, and name) from zoom 11;
    painted lanes only from zoom 13. Empty below zoom 11."""
    evidence._check_cancelled(cancel)
    low, high = TILE_ZOOM
    if not 0 <= z <= high or not 0 <= x < 2 ** z or not 0 <= y < 2 ** z:
        raise evidence.MalformedQuery(f"tile out of range: {z}/{x}/{y}")
    if z < low:
        return b""
    with reader._connect() as connection:
        evidence._active_release(connection, cancel)
        rows = list(connection.execute(CYCLE_LANE_TILE_SQL, (z, x, y)))
        return bytes(rows[0]["tile"] or b"") if rows else b""


def collision_tile(reader: evidence.EvidenceReader, z: int, x: int, y: int,
                   cancel: Callable[[], bool] | None = None) -> bytes:
    """Road casualties (`collisions`, migration 065) from zoom 10: counts per fine grid cell, road user and
    child below zoom 13 (n1 / n2 / n3 by severity, COLLISION_HEAT_TILE_SQL), single casualties with year,
    light and age band from 13. Never a date, time or sex. Empty below zoom 10 or before the migration."""
    evidence._check_cancelled(cancel)
    _, high = TILE_ZOOM
    if not 0 <= z <= high or not 0 <= x < 2 ** z or not 0 <= y < 2 ** z:
        raise evidence.MalformedQuery(f"tile out of range: {z}/{x}/{y}")
    if z < COLLISION_MIN_ZOOM:
        return b""
    with reader._connect() as connection:
        evidence._active_release(connection, cancel)
        if not list(connection.execute(COLLISION_TILE_READY_SQL))[0]["t"]:
            return b""
        rows = list(connection.execute(COLLISION_HEAT_TILE_SQL, {"z": z, "x": x, "y": y})
                    if z <= COLLISION_HEAT_MAX_ZOOM else connection.execute(COLLISION_TILE_SQL, (z, x, y)))
        return bytes(rows[0]["tile"] or b"") if rows else b""
