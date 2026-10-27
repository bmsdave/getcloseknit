"""Geograph photos nearest a point in the coverage (London, or England with CLOSE_KNIT_ENGLAND; migration 043).

Titles, photographers and links only: Geograph asks that its images are not
hotlinked without permission, so callers show each photo as a credited link to
its Geograph page. Before migration 043 is loaded the list is simply empty.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from . import evidence
from .scope import current as current_scope

SCHEMA_VERSION = "nearby-photos.v1"
LICENCE_URL = "https://creativecommons.org/licenses/by-sa/2.0/"
MAX_LIMIT = 12
# Photos farther than this say nothing about the place.
MAX_METRES = 800

TABLE_SQL = """-- photos:table
SELECT to_regclass('geograph_photo') IS NOT NULL AS t"""

# The GiST index orders by planar distance; metres are measured on the sphere afterwards.
NEARBY_SQL = """-- photos:nearby
WITH p AS (SELECT ST_SetSRID(ST_MakePoint(%s, %s), 4326) AS g)
SELECT n.id, n.title, n.photographer, n.user_id, n.taken, n.source_release_id, n.metres
FROM (
  SELECT f.*, ST_Distance(f.location::geography, p.g::geography) AS metres
  FROM p, LATERAL (SELECT * FROM geograph_photo ORDER BY location <-> p.g LIMIT %s) f
) n
WHERE n.metres <= %s
ORDER BY n.metres, n.id"""

SOURCE_SQL = """-- photos:source
SELECT id, attribution, caveats FROM source_release WHERE id = %s"""


def photo(row: Mapping[str, Any]) -> dict:
    return {
        "id": str(row["id"]),
        "title": row["title"],
        "photographer": row["photographer"],
        "pageUrl": f"https://www.geograph.org.uk/photo/{row['id']}",
        "profileUrl": f"https://www.geograph.org.uk/profile/{row['user_id']}",
        "taken": row["taken"].isoformat() if row["taken"] else None,
        "metres": round(float(row["metres"])),
    }


def nearby_payload(lat: float, lon: float, rows: list, source: Mapping[str, Any] | None) -> dict:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "point": {"lat": lat, "lon": lon},
        "photos": [photo(row) for row in rows],
        "licence": "CC-BY-SA-2.0",
        "licenceUrl": LICENCE_URL,
        "sourceVersion": source["id"] if source else None,
        "attribution": source["attribution"] if source else None,
        "caveats": list(source["caveats"] or []) if source else [],
    }


def nearby_photos(reader: evidence.EvidenceReader, lat: float, lon: float, limit: int = 4,
                  cancel: Callable[[], bool] | None = None) -> dict:
    """The Geograph photos nearest the point, nearest first, within MAX_METRES."""
    evidence._check_cancelled(cancel)
    served = current_scope()  # inside the scope's box: no general-purpose photo search
    if not served.contains(lat, lon):
        raise evidence.MalformedQuery(f"lat/lon must be in {served.name}")
    if not 1 <= limit <= MAX_LIMIT:
        raise evidence.MalformedQuery(f"limit must be 1-{MAX_LIMIT}")
    with reader._connect() as connection:
        if not list(connection.execute(TABLE_SQL))[0]["t"]:
            return nearby_payload(lat, lon, [], None)
        rows = list(connection.execute(NEARBY_SQL, (lon, lat, limit, MAX_METRES)))
        sources = list(connection.execute(SOURCE_SQL, (rows[0]["source_release_id"],))) if rows else []
        return nearby_payload(lat, lon, rows, sources[0] if sources else None)
