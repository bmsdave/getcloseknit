"""Mobile coverage for an area (migration 086): Ofcom Connected Nations, per local authority (LAD).

  indoor4gAll   share of premises predicted to get 4G indoors from all four networks
  outdoor5gAny  share of premises predicted to get 5G outdoors from at least one network
  outdoor4gAll, outdoor5gAll  the outdoor all-network shares, for the detail line

Ofcom publishes mobile coverage per local authority only, so every LSOA and MSOA reads its LAD's
figure (grain "borough"). Each headline share carries its place among the LADs of its region
(percent_rank 0-100, lowest = 0; London = the 33 boroughs) and the region's premises-weighted share
(rankScope names the region), the same ranks as the `mobile-4g-indoor` and `mobile-5g-outdoor` map layers. Predicted coverage of places, never a person or a home.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from . import coverage, evidence, schools

SCHEMA_VERSION = "area-mobile.v1"
CAVEATS = [
    "Predicted coverage from the networks' models, not measured speed or signal at any address.",
    "Ofcom publishes mobile coverage per local authority only: every neighbourhood shows its council area's figure.",
    "4G indoors counts premises served by all four networks; 5G outdoors by at least one, at Ofcom's "
    "high-confidence level.",
]

# The LAD the area sits in (itself for a borough), ranked among the LADs of its region (area_region,
# migration 103; London = the 33 boroughs, as before England was loaded).
MOBILE_SQL = """-- evidence:area-mobile
WITH lad AS (
  SELECT CASE g.kind WHEN 'lad' THEN g.id WHEN 'msoa' THEN g.parent_id ELSE m.parent_id END AS id
  FROM area_geography g LEFT JOIN area_geography m ON m.id = g.parent_id WHERE g.id = %s
), reg AS (SELECT r.region_code FROM area_region r JOIN lad ON r.area_id = lad.id)
SELECT * FROM (
  SELECT m.*, b.name, r.region_code,
    round(100 * percent_rank() OVER (ORDER BY m.indoor_4g_all_mno))::int AS indoor_percentile,
    round(100 * percent_rank() OVER (ORDER BY m.outdoor_5g_any))::int AS outdoor_5g_percentile,
    sum(m.indoor_4g_all_mno * m.premises) OVER () / sum(m.premises) OVER () AS london_indoor,
    sum(m.outdoor_5g_any * m.premises) OVER () / sum(m.premises) OVER () AS london_5g
  FROM area_mobile m JOIN area_geography b ON b.id = m.geography_id
  JOIN area_region r ON r.area_id = m.geography_id AND r.region_code = (SELECT region_code FROM reg)) x
WHERE geography_id = (SELECT id FROM lad)"""

SOURCES_SQL = """-- evidence:area-mobile-sources
SELECT s.id, s.source_url, s.licence, s.attribution FROM source_release s WHERE s.id = ANY(%s) ORDER BY s.id"""


def _share(value: Any) -> float | None:
    return None if value is None else round(min(1.0, max(0.0, float(value))), 4)


def _pct(share: float | None) -> str:
    return "unknown" if share is None else f"{round(share * 100)}%"


def card_notes(value: Mapping[str, Any]) -> list[str]:
    indoor, outdoor = value["indoor4gAll"], value["outdoor5gAny"]
    scope = (value.get("rankScope") or {}).get("name") or "London"
    return [f"4G indoors from all four networks at {_pct(indoor['share'])} of premises ({scope} {_pct(indoor['regionShare'])})",
            f"5G outdoors at {_pct(outdoor['share'])} of premises ({scope} {_pct(outdoor['regionShare'])})"]


def mobile_value(connection: Any, area_id: str) -> dict | None:
    """The mobile block for one area, or None when migration 086 is not loaded or nothing is loaded yet.
    A savepoint keeps a missing table from poisoning the caller's transaction."""
    try:
        savepoint = getattr(connection, "transaction", None)
        if savepoint is not None:
            with savepoint():
                return _mobile_value(connection, area_id)
        return _mobile_value(connection, area_id)
    except Exception:  # noqa: BLE001 - an unloaded layer is a normal state, not an error
        return None


def _mobile_value(connection: Any, area_id: str) -> dict | None:
    rows = list(connection.execute(MOBILE_SQL, (area_id,)))
    if not rows:
        return None
    row = rows[0]
    value = {
        "borough": {"id": row["geography_id"], "name": row["name"]},
        "premises": int(row["premises"]),
        "indoor4gAll": {"share": _share(row["indoor_4g_all_mno"]), "regionPercentile": row["indoor_percentile"],
                        "regionShare": _share(row["london_indoor"])},
        "outdoor5gAny": {"share": _share(row["outdoor_5g_any"]), "regionPercentile": row["outdoor_5g_percentile"],
                         "regionShare": _share(row["london_5g"])},
        "outdoor4gAll": _share(row["outdoor_4g_all_mno"]),
        "outdoor5gAll": _share(row["outdoor_5g_all"]),
        "rankScope": coverage.rank_scope(row.get("region_code")),
    }
    value["notes"] = card_notes(value)
    value["sourceVersions"] = [row["source_release_id"]]
    return value


def _evidence(value: Mapping[str, Any]) -> list[dict]:
    """The map layers' values for the area's borough, as metric_value rows carry them (%)."""
    borough = value["borough"]["id"]
    return [{"metricId": metric, "geographyId": borough, "value": round(100 * value[key]["share"], 2),
             "regionPercentile": value[key]["regionPercentile"]}
            for metric, key in (("mobile-4g-indoor", "indoor4gAll"), ("mobile-5g-outdoor", "outdoor5gAny"))]


def area_mobile(reader: evidence.EvidenceReader, area_id: str, cancel: Callable[[], bool] | None = None) -> dict:
    """area-mobile.v1 for one LSOA, MSOA or borough; available=false before the layer is loaded."""
    evidence._check_cancelled(cancel)
    if not schools.AREA_PATTERN.match(area_id or ""):
        raise evidence.MalformedQuery(f"invalid area id: {area_id}")
    with reader._connect() as connection:
        release_id = evidence._active_release(connection, cancel)
        if not list(connection.execute(schools.AREA_EXISTS_SQL, (area_id,))):
            raise evidence.AreaNotFound(f"unknown area: {area_id}")
        value = mobile_value(connection, area_id)
        sources = [{"release": row["id"], "sourceUrl": row["source_url"], "licence": row["licence"],
                    "attribution": row["attribution"]}
                   for row in connection.execute(SOURCES_SQL, (value["sourceVersions"],))] if value else []
    return {"schemaVersion": SCHEMA_VERSION, "productReleaseId": release_id, "geographyId": area_id,
            "available": value is not None, "grain": "borough",
            # Modelled, and a borough's figure for every neighbourhood in it.
            "confidence": "medium" if value else None,
            "value": value, "evidence": _evidence(value) if value else [],
            "notes": value["notes"] if value else [], "sources": sources, "caveats": CAVEATS}
