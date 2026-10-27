"""Future transport (migration 088): the new station nearest an area, from Close Knit's curated list of
TfL, GLA and DfT schemes (deploy/tools/future_transport.yaml), as an evidence envelope.

Plans change. A proposed scheme is said to be proposed, never coming, and only a station under
construction, consented or funded carries its expected year. The card line covers stations within 2 km.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from . import envelope, evidence, schools

SCHEMA_VERSION = "area-future-transport.v1"
REACH_M = 2000  # the card names the nearest station within this distance
STATUS_WORDS = {"under construction": "under construction", "consented": "consented, not yet built",
                "funded": "funded, not yet consented", "proposed": "proposed, not funded"}
CAVEATS = [
    "Plans change: a proposed scheme is shown as proposed, never as coming; dates are the promoter's own.",
    "Straight-line distance from the middle of the area (for an MSOA or borough, its closest LSOA) to a station "
    "point placed from the official page (to about 200 m).",
    "Only new stations are listed; upgrades of existing stations are not.",
]

AREA_SQL = """-- evidence:area-future-transport
SELECT a.geography_id, a.distance_m, a.status, a.expected_year, a.source_release_id,
       f.station, f.scheme, f.mode, f.source_url
FROM area_future_transport a JOIN future_transport f ON f.id = a.station_id
WHERE a.geography_id = %s"""

SOURCES_SQL = """-- evidence:area-future-transport-sources
SELECT s.id, s.source_url, s.licence, s.attribution FROM source_release s WHERE s.id = ANY(%s) ORDER BY s.id"""


def nearest_value(row: Mapping[str, Any]) -> dict:
    distance = int(row["distance_m"])
    return {"station": row["station"], "scheme": row["scheme"], "mode": row["mode"], "distanceM": distance,
            "status": row["status"], "expectedYear": row["expected_year"], "sourceUrl": row["source_url"],
            "withinReach": distance <= REACH_M}


def card_note(nearest: Mapping[str, Any] | None) -> str | None:
    """"New station Old Oak Common ≈ 1.2 km away, under construction, expected 2032"; None beyond 2 km."""
    if not nearest or nearest["distanceM"] > REACH_M:
        return None
    note = (f"New station {nearest['station']} ≈ {nearest['distanceM'] / 1000:.1f} km away, "
            f"{STATUS_WORDS[nearest['status']]}")
    if nearest["expectedYear"] and nearest["status"] != "proposed":
        note += f", expected {nearest['expectedYear']}"
    return note


def _rows(connection: Any, area_id: str) -> list[dict]:
    """The area's row; [] when migration 088 is not loaded. A savepoint keeps a missing table from
    poisoning the caller's transaction."""
    try:
        savepoint = getattr(connection, "transaction", None)
        if savepoint is not None:
            with savepoint():
                return [dict(row) for row in connection.execute(AREA_SQL, (area_id,))]
        return [dict(row) for row in connection.execute(AREA_SQL, (area_id,))]
    except Exception:  # noqa: BLE001 - an unloaded layer is a normal state, not an error
        return []


def area_future_transport(reader: evidence.EvidenceReader, area_id: str,
                          cancel: Callable[[], bool] | None = None) -> dict:
    """area-future-transport.v1 for one LSOA, MSOA or borough; available=false before the list is loaded."""
    evidence._check_cancelled(cancel)
    if not schools.AREA_PATTERN.match(area_id or ""):
        raise evidence.MalformedQuery(f"invalid area id: {area_id}")
    with reader._connect() as connection:
        release_id = evidence._active_release(connection, cancel)
        if not list(connection.execute(schools.AREA_EXISTS_SQL, (area_id,))):
            raise evidence.AreaNotFound(f"unknown area: {area_id}")
        rows = _rows(connection, area_id)
        releases = list(connection.execute(SOURCES_SQL, ([rows[0]["source_release_id"]],))) if rows else []
    if not rows:
        return envelope.wrap({"available": False, "nearest": None, "note": None}, schema_version=SCHEMA_VERSION,
                             release_id=release_id, caveats=CAVEATS)
    row = rows[0]
    nearest = nearest_value(row)
    sources = [{"sourceId": "scheme-page", "sourceName": row["scheme"], "sourceUrl": row["source_url"]}] + [
        {"sourceId": "future-transport", "sourceName": "Close Knit list of new stations (TfL, GLA, DfT pages)",
         "sourceUrl": source["source_url"], "release": source["id"], "licence": source["licence"],
         "attribution": source["attribution"]} for source in releases]
    return envelope.wrap(
        {"available": True, "nearest": nearest, "note": card_note(nearest)}, schema_version=SCHEMA_VERSION,
        release_id=release_id, confidence="medium",
        evidence=[{"kind": "future-station", "geographyId": area_id, **nearest,
                   "sourceVersion": row["source_release_id"]}],
        sources=sources, caveats=CAVEATS)
