"""Universities and colleges as map points (Layers v5): drawn from zoom 13 under Student areas (student-share).

Read live from the merged places table (`place`, migration 034): OpenStreetMap amenity=university or
amenity=college with a name, as the retired Universities ready-made criterion counted them.
© OpenStreetMap contributors, ODbL 1.0.
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

ATTRIBUTION = "© OpenStreetMap contributors"
MIN_CONFIDENCE = 0.6  # as the places tile (migration 035)

TABLE_SQL = """-- evidence:university-table
SELECT to_regclass('public.place') IS NOT NULL AS t"""

POINTS_SQL = f"""-- evidence:university-points
SELECT id, name, tags->>'amenity' AS kind, ST_Y(location) AS latitude, ST_X(location) AS longitude
FROM place
WHERE (tags @> '{{"amenity": "university"}}' OR tags @> '{{"amenity": "college"}}')
  AND name IS NOT NULL AND confidence >= {MIN_CONFIDENCE}
ORDER BY name, id"""


def point(row: Mapping[str, Any]) -> dict:
    return {"id": row["id"], "name": row["name"], "kind": row["kind"],
            "latitude": round(float(row["latitude"]), 6), "longitude": round(float(row["longitude"]), 6)}


def points(rows: Iterable[Mapping[str, Any]], release_id: str) -> dict:
    """university-points.v1: one point per university or college place."""
    return {"schemaVersion": "university-points.v1", "productReleaseId": release_id,
            "attribution": ATTRIBUTION, "points": [point(row) for row in rows]}
