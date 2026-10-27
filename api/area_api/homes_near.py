"""The postcodes with recorded homes nearest a point ("Homes near this school").

The school page links to homes around the school, not to the school's own postcode (which often holds
only the school). The answer is postcodes, never addresses: each with how many homes its list of homes shows (the
same count as /postcode/{code}/homes) and how far its homes' middle is from the point. Hidden homes (suppressed_dwelling) are not counted.
Candidates come from the LSOAs within the radius (the area_geography GiST index), then the addresses in
them (address_geography_idx); distances use the addresses' own British National Grid points.
"""
from __future__ import annotations

from typing import Any, Callable

from .evidence import MalformedQuery, _active_release, _check_cancelled
from .property_profile import POSTCODE_HOME_LIMIT

__all__ = ["homes_near", "RADIUS_METRES", "MAX_LIMIT"]

# The site's 800 m = a 10-minute walk.
RADIUS_METRES = 800
DEFAULT_LIMIT = 4
MAX_LIMIT = 10
# A little more than 800 m in degrees at London's latitude, for the bounding-box prefilter.
BOX_DEGREES = 0.013
BOX = {"latitude": (51.1, 51.9), "longitude": (-0.8, 0.6)}

ACTIVE_MEMBERS_SQL = """(SELECT m.source_release_id FROM active_product_release a
   JOIN product_release_member m ON m.release_id = a.release_id)"""

NEAR_POSTCODES_SQL = """-- homes-near:postcodes
WITH here AS (
  SELECT ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326) AS g,
    ST_X(ST_Transform(ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326), 27700)) AS x,
    ST_Y(ST_Transform(ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326), 27700)) AS y
), near_lsoa AS (
  SELECT g.id FROM area_geography g CROSS JOIN here
  WHERE g.kind = 'lsoa' AND g.geometry && ST_Expand(here.g, %(box)s)
    AND ST_DWithin(g.geometry::geography, here.g::geography, %(radius)s)
), near AS (
  -- The postcodes whose homes' middle (homes with a grid point) is within the radius.
  SELECT a.postcode, min(a.geography_id) AS geography_id,
    sqrt(power(avg(a.easting) - here.x, 2) + power(avg(a.northing) - here.y, 2)) AS distance
  FROM address a CROSS JOIN here
  WHERE a.geography_id IN (SELECT id FROM near_lsoa)
    AND a.source_release_id IN """ + ACTIVE_MEMBERS_SQL + """
    AND a.easting IS NOT NULL AND a.northing IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM suppressed_dwelling d WHERE d.address_id = a.id)
  GROUP BY a.postcode, here.x, here.y
  HAVING sqrt(power(avg(a.easting) - here.x, 2) + power(avg(a.northing) - here.y, 2)) <= %(radius)s
), listed AS (
  -- The count the postcode's list of homes shows (property_profile.POSTCODE_HOMES_SQL): every recorded
  -- address, with or without a page of its own; hidden addresses and hidden homes left out.
  SELECT a.postcode, count(*) AS homes
  FROM address a
  WHERE a.postcode IN (SELECT postcode FROM near)
    AND a.source_release_id IN """ + ACTIVE_MEMBERS_SQL + """
    AND NOT EXISTS (SELECT 1 FROM suppressed_dwelling d WHERE d.address_id = a.id)
    AND NOT EXISTS (SELECT 1 FROM property p JOIN suppressed_dwelling d ON d.uprn = p.uprn
                    WHERE p.address_id = a.id AND p.source_release_id IN """ + ACTIVE_MEMBERS_SQL + """)
  GROUP BY a.postcode
)
SELECT n.postcode, n.geography_id, least(l.homes, %(cap)s) AS homes, round(n.distance)::integer AS metres
FROM near n JOIN listed l ON l.postcode = n.postcode
ORDER BY metres, n.postcode
LIMIT %(limit)s"""


def _number(value: Any, name: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise MalformedQuery(f"{name} must be a number") from None
    if number != number or number in (float("inf"), float("-inf")):
        raise MalformedQuery(f"{name} must be a number")
    return number


def _in_london(lat: float, lon: float) -> bool:
    """Per-home data is London's (FLAGS.md CLOSE_KNIT_ENGLAND): a point elsewhere in England has no homes here."""
    return BOX["latitude"][0] <= lat <= BOX["latitude"][1] and BOX["longitude"][0] <= lon <= BOX["longitude"][1]


def homes_near(connect: Callable[[], Any], latitude: Any, longitude: Any, limit: Any = DEFAULT_LIMIT,
               cancel: Callable[[], bool] | None = None) -> dict:
    """Up to `limit` postcodes within RADIUS_METRES of the point, nearest first, each with the number of
    homes its list shows and the distance from the point to their middle."""
    lat, lon = _number(latitude, "latitude"), _number(longitude, "longitude")
    try:
        count = int(limit)
    except (TypeError, ValueError):
        raise MalformedQuery("limit must be a whole number") from None
    if not 1 <= count <= MAX_LIMIT:
        raise MalformedQuery(f"limit must be 1 to {MAX_LIMIT}")
    _check_cancelled(cancel)
    with connect() as connection:
        release_id = _active_release(connection, cancel)
        rows = list(connection.execute(NEAR_POSTCODES_SQL, {
            "lat": lat, "lon": lon, "box": BOX_DEGREES, "radius": RADIUS_METRES, "limit": count,
            "cap": POSTCODE_HOME_LIMIT})) if _in_london(lat, lon) else []
    return {
        "schemaVersion": "homes-near.v1",
        "productReleaseId": release_id,
        "point": {"latitude": round(lat, 5), "longitude": round(lon, 5)},
        "radiusMetres": RADIUS_METRES,
        "postcodes": [{"postcode": row["postcode"], "geographyId": row["geography_id"],
                       "homes": int(row["homes"]), "metres": int(row["metres"])} for row in rows],
        "caveats": [
            "Postcodes with recorded homes (HM Land Registry sales, OS UPRNs) whose homes' middle is within "
            f"{RADIUS_METRES} m in a straight line; not a walking distance or a catchment.",
        ],
    }
