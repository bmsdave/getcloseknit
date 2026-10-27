"""Flood risk for an area and one home (Environment Agency NaFRA2, migration 018).

Two separate sources, never merged into one score: rivers and sea, and
surface water. Each uses the EA's four bands, the chance of flooding in any
one year. Area figures are shares of the area's land, not of its buildings.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from . import evidence, schools

SCHEMA_VERSION = "area-flood.v1"
BANDS = ("very-low", "low", "medium", "high")
SOURCES = {"rivers-sea": "riversSea", "surface-water": "surfaceWater"}
# The highest band must cover at least this share of the land, so a sliver at
# the area's edge does not label the whole area.
HIGHEST_BAND_MIN_SHARE = 0.01

AREA_FLOOD_SQL = """-- evidence:area-flood
SELECT f.source, f.area_m2, f.low_m2, f.medium_m2, f.high_m2, f.source_release_id,
  s.caveats, s.attribution
FROM area_flood f JOIN source_release s ON s.id = f.source_release_id
WHERE f.geography_id = %s ORDER BY f.source"""

DWELLING_FLOOD_SQL = """-- evidence:dwelling-flood
SELECT f.rivers_sea_band, f.surface_water_band FROM dwelling_flood f
WHERE f.uprn = %s AND NOT EXISTS (SELECT 1 FROM suppressed_dwelling d WHERE d.uprn = f.uprn)"""


def band_name(code: int | None) -> str | None:
    return BANDS[code - 1] if code in (1, 2, 3, 4) else None


def area_bands(row: Mapping[str, Any]) -> dict | None:
    """Share of the land in each band and the highest band covering at least
    1% of it. Very low is the land not mapped in a higher band."""
    total = float(row["area_m2"] or 0)
    if total <= 0:
        return None
    mapped = {band: min(1.0, max(0.0, float(row[f"{band}_m2"] or 0) / total))
              for band in ("low", "medium", "high")}
    shares = {"very-low": max(0.0, 1.0 - sum(mapped.values())), **mapped}
    highest = next((band for band in ("high", "medium", "low")
                    if shares[band] >= HIGHEST_BAND_MIN_SHARE), "very-low")
    return {"shares": {band: round(shares[band], 4) for band in BANDS}, "highestBand": highest}


def flood_payload(area_id: str, release_id: str, rows: list[Mapping[str, Any]],
                  dwelling: Mapping[str, Any] | None, uprn: str | None) -> dict:
    by_source = {row["source"]: row for row in rows}
    first = rows[0] if rows else None
    return {
        "schemaVersion": SCHEMA_VERSION,
        "productReleaseId": release_id,
        "geographyId": area_id,
        "available": bool(rows),
        **{key: (area_bands(by_source[source]) if source in by_source else None)
           for source, key in SOURCES.items()},
        "dwelling": ({"uprn": uprn,
                      "riversSea": band_name(dwelling["rivers_sea_band"]),
                      "surfaceWater": band_name(dwelling["surface_water_band"])}
                     if dwelling else None),
        "sourceVersion": first["source_release_id"] if first else None,
        "attribution": first["attribution"] if first else None,
        "caveats": list(first["caveats"]) if first else [],
    }


def area_flood(reader: evidence.EvidenceReader, area_id: str, uprn: str | None = None,
               cancel: Callable[[], bool] | None = None) -> dict:
    """Flood bands for the area's land and, with a UPRN, that home's bands."""
    evidence._check_cancelled(cancel)
    if not schools.AREA_PATTERN.match(area_id or ""):
        raise evidence.MalformedQuery(f"invalid area id: {area_id}")
    if uprn is not None and not schools.UPRN_PATTERN.match(uprn):
        raise evidence.MalformedQuery(f"invalid UPRN: {uprn}")
    with reader._connect() as connection:
        release_id = evidence._active_release(connection, cancel)
        if not list(connection.execute(schools.AREA_EXISTS_SQL, (area_id,))):
            raise evidence.AreaNotFound(f"unknown area: {area_id}")
        rows = list(connection.execute(AREA_FLOOD_SQL, (area_id,)))
        dwelling = list(connection.execute(DWELLING_FLOOD_SQL, (uprn,))) if uprn else []
        return flood_payload(area_id, release_id, rows, dwelling[0] if dwelling else None, uprn)
