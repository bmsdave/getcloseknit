"""Good value inputs for the v4 "Best value" sort (migration 069).

Per LSOA and home type: the typical price (the median of 3+ years of sales adjusted to today, as on
the area card), the area's score vector (six London ranks, 0-100, higher is better: safety,
schools, station, quiet, parks, air) and how that price compares with the 50 areas whose score
vectors are closest (`valueRatio` = typical / their median; 0.85 is 15% below areas like it).
Areas with fewer than 20 sales of the type have no figure and are left out, so the sort hides them.
Area level only: never a figure for one home. Price, income and who lives there are never in the
vector. The sort itself (and any UI) belongs to My match; this is the API field it reads.
"""
from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from typing import Any

from . import evidence
from .match_model import VALUE_RATIO_CEILING, VALUE_RATIO_FLOOR

SCHEMA_VERSION = "good-value.v1"
HOME_TYPES = {"all": "*", "flat": "F", "terraced": "T", "semi": "S", "detached": "D"}
SCORE_KEYS = ("safety", "schools", "station", "quiet", "parks", "air")
MIN_SALES = 20
PEERS = 50
MAX_AREAS = 200
CAVEATS = [
    "Typical price is the median of the area's recorded sales of this type of home over 3 years or more, "
    "adjusted to today's prices; areas with fewer than 20 such sales have no figure.",
    "Peers are the 50 London neighbourhoods whose ranks for safety, schools, station walk, quiet streets, parks "
    "and clean air are closest; price, income and who lives there are never compared.",
    "Good value compares areas, not homes: a home's own price depends on its size and condition.",
]

TABLE_SQL = "-- evidence:good-value-table\nSELECT to_regclass('public.area_good_value') IS NOT NULL AS ready"

ROWS_SQL = """-- evidence:good-value-rows
SELECT v.geography_id, v.typical_price, v.sales, v.peers, v.peer_price, v.value_ratio, v.source_release_id,
       s.safety, s.schools, s.station, s.quiet, s.parks, s.air
FROM area_good_value v
LEFT JOIN area_score_vector s ON s.geography_id = v.geography_id
WHERE v.property_type = %s AND (%s::text[] IS NULL OR v.geography_id = ANY(%s::text[]))
ORDER BY v.value_ratio, v.geography_id"""


def home_type_code(home_type: str) -> str:
    code = HOME_TYPES.get((home_type or "all").strip().lower())
    if code is None:
        raise evidence.MalformedQuery(f"homeType must be one of {', '.join(HOME_TYPES)}")
    return code


def area_ids(raw: str | None) -> list[str] | None:
    """Comma-separated LSOA ids, at most MAX_AREAS; None for every area."""
    if raw is None or not raw.strip():
        return None
    ids = [part.strip() for part in raw.split(",") if part.strip()]
    if len(ids) > MAX_AREAS:
        raise evidence.MalformedQuery(f"at most {MAX_AREAS} areas")
    for area_id in ids:
        if not evidence.GEOGRAPHY_PATTERN.match(area_id) or not area_id.startswith("uk:lsoa:"):
            raise evidence.MalformedQuery(f"invalid LSOA id: {area_id}")
    return ids


def area_value(row: Mapping[str, Any]) -> dict:
    """One area's figure: typical price, sales, score vector, peers' median and the ratio."""
    ratio = float(row["value_ratio"])
    return {
        "geographyId": row["geography_id"],
        "typicalPrice": int(row["typical_price"]),
        "sales": int(row["sales"]),
        "scores": {key: (None if row.get(key) is None else int(row[key])) for key in SCORE_KEYS},
        "peers": int(row["peers"]),
        "peerPrice": int(row["peer_price"]),
        "valueRatio": round(ratio, 3),
        # Whole percent below (negative) or above the peers' median.
        "valuePercent": round((ratio - 1) * 100),
        # Outside [VALUE_RATIO_FLOOR, VALUE_RATIO_CEILING] (match_model): read as a stock mix, not value; the
        # Best value sort of My match leaves it out.
        "outlier": not VALUE_RATIO_FLOOR <= ratio <= VALUE_RATIO_CEILING,
    }


def rows(connection, code: str, ids: Iterable[str] | None) -> list[dict]:
    """Rows from area_good_value (cheapest for its peers first); [] before migration 069."""
    if not list(connection.execute(TABLE_SQL))[0]["ready"]:
        return []
    ids = None if ids is None else list(ids)
    return list(connection.execute(ROWS_SQL, (code, ids, ids)))


def good_value(reader: evidence.EvidenceReader, home_type: str = "all", areas: str | None = None,
               cancel: Callable[[], bool] | None = None) -> dict:
    """good-value.v1: every LSOA with a figure for the home type, or only `areas`."""
    evidence._check_cancelled(cancel)
    code = home_type_code(home_type)
    ids = area_ids(areas)
    with reader._connect() as connection:
        release_id = evidence._active_release(connection, cancel)
        found = rows(connection, code, ids)
    sources = sorted({row["source_release_id"] for row in found})
    return {
        "schemaVersion": SCHEMA_VERSION, "productReleaseId": release_id,
        "homeType": next(name for name, value in HOME_TYPES.items() if value == code),
        "available": bool(found), "minimumSales": MIN_SALES, "peers": PEERS, "scoreKeys": list(SCORE_KEYS),
        "valueRatioBounds": [VALUE_RATIO_FLOOR, VALUE_RATIO_CEILING],
        "areas": [area_value(row) for row in found],
        "sources": [{"release": source} for source in sources], "caveats": CAVEATS,
    }
