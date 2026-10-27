"""New homes on the way (migration 085): London Development Database permissions not started, under
construction and completed in the last five years in an area, homes still to come within 1 km, the rate
per 1,000 homes with its London percentile, and the Opportunity Areas and Housing Zones it sits in.

Facts about sites, never about who applied or lives there. A permission is not a completion. The card
lines travel with the payload so the site, the brief and the agent tools say the same thing.
"""
from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from typing import Any

from . import envelope, evidence, schools
from .location import INSIDE_SHARE, PARTLY_SHARE

SCHEMA_VERSION = "area-pipeline.v1"
METRIC_ID = "pipeline-homes-per-1000"
RADIUS_METRES = 1000
KIND_WORDS = {"opportunity-area": "Opportunity Area", "housing-zone": "Housing Zone"}
CAVEATS = [
    "Permissions are not completions: start and finish dates slip, and some permissions lapse unbuilt.",
    "Net new homes (proposed minus existing) from the London Development Database; each site counts at its "
    "centroid, and boroughs report with varying delay.",
    "Opportunity Area and Housing Zone boundaries are approximate; the borough's plan is the authority.",
]

AREA_PIPELINE_SQL = """-- evidence:area-pipeline
SELECT p.*, g.kind::text AS kind FROM area_pipeline p JOIN area_geography g ON g.id = p.geography_id
WHERE p.geography_id = %s"""

GROWTH_AREAS_SQL = """-- evidence:area-pipeline-growth
SELECT a.geography_id, o.id, o.name, o.kind, o.url, a.overlap_m2, o.source_release_id
FROM area_opportunity a JOIN opportunity_area o ON o.id = a.opportunity_id
WHERE a.geography_id = %s ORDER BY a.overlap_m2 DESC, o.name"""

SOURCES_SQL = """-- evidence:area-pipeline-sources
SELECT s.id, s.source_url, s.licence, s.attribution FROM source_release s WHERE s.id = ANY(%s) ORDER BY s.id"""


def _presence(share: float) -> str:
    return "inside" if share >= INSIDE_SHARE else "partly" if share >= PARTLY_SHARE else "outside"


def pipeline_value(row: Mapping[str, Any], growth: Iterable[Mapping[str, Any]] = ()) -> dict:
    """The block for one area_pipeline row and its growth areas (largest overlap first)."""
    total = float(row["area_m2"])
    areas = []
    for area in growth:
        share = round(min(1.0, float(area["overlap_m2"]) / total), 4) if total > 0 else 0.0
        if _presence(share) != "outside":
            areas.append({"name": area["name"], "kind": area["kind"], "url": area["url"], "share": share,
                          "presence": _presence(share)})
    per_1000 = row.get("per_1000")
    value = {
        "notStarted": row["homes_not_started"], "underConstruction": row["homes_under_construction"],
        "completed5y": row["homes_completed_5y"], "homes": row.get("homes"),
        "per1000": round(float(per_1000), 1) if per_1000 is not None else None,
        "regionPercentile": row.get("region_percentile"),
        "within1km": {"radiusMetres": RADIUS_METRES, "total": row["homes_within_1km"],
                      "notStarted": row["within_1km_not_started"],
                      "underConstruction": row["within_1km_under_construction"]},
        "growthAreas": areas,
    }
    value["notes"] = card_notes(value)
    return value


def card_notes(value: Mapping[str, Any]) -> list[str]:
    """Short card lines: homes on the way nearby, then the growth areas the land is in."""
    nearby = value["within1km"]["total"]
    notes = [f"≈ {nearby:,} new homes permitted or being built within 1 km" if nearby
             else "No new homes permitted or being built within 1 km"]
    for area in value["growthAreas"]:
        words = f"the {area['name']} {KIND_WORDS[area['kind']]}"
        notes.append(f"Inside {words}" if area["presence"] == "inside"
                     else f"Partly in {words} ({round(area['share'] * 100)}% of the land)")
    return notes


def _rows(connection: Any, area_id: str) -> tuple[Mapping[str, Any] | None, list[Mapping[str, Any]]]:
    """The area's row and growth areas; (None, []) when migration 085 is not loaded. A savepoint keeps a
    missing table from poisoning the caller's transaction."""
    def read():
        rows = list(connection.execute(AREA_PIPELINE_SQL, (area_id,)))
        return (rows[0], list(connection.execute(GROWTH_AREAS_SQL, (area_id,)))) if rows else (None, [])
    try:
        savepoint = getattr(connection, "transaction", None)
        if savepoint is not None:
            with savepoint():
                return read()
        return read()
    except Exception:  # noqa: BLE001 - an unloaded layer is a normal state, not an error
        return None, []


def pipeline_envelope(connection: Any, area_id: str, release_id: str) -> dict:
    row, growth = _rows(connection, area_id)
    if row is None:
        return envelope.wrap(None, schema_version=SCHEMA_VERSION, release_id=release_id, caveats=CAVEATS)
    value = pipeline_value(row, growth)
    period = row["period"]
    rows = [{"kind": "metric-observation", "geographyId": area_id, "metricId": METRIC_ID,
             "period": period.strftime("%Y-%m") if hasattr(period, "strftime") else str(period)[:7],
             "value": value["per1000"], "quality": "observed" if value["per1000"] is not None else "suppressed",
             "sampleCount": row.get("homes"), "regionPercentile": value["regionPercentile"],
             "sourceVersion": row["source_release_id"]}]
    releases = sorted({row["source_release_id"], *(area["source_release_id"] for area in growth)})
    sources = [{"release": source["id"], "sourceUrl": source["source_url"], "licence": source["licence"],
                "attribution": source["attribution"]} for source in connection.execute(SOURCES_SQL, (releases,))]
    return envelope.wrap(value, schema_version=SCHEMA_VERSION, release_id=release_id,
                         confidence="high" if value["per1000"] is not None else "medium",
                         evidence=rows, sources=sources, caveats=CAVEATS)


def area_pipeline(reader: evidence.EvidenceReader, area_id: str, cancel: Callable[[], bool] | None = None) -> dict:
    """area-pipeline.v1 for one LSOA, MSOA or borough; value null before the layers are loaded."""
    evidence._check_cancelled(cancel)
    if not schools.AREA_PATTERN.match(area_id or ""):
        raise evidence.MalformedQuery(f"invalid area id: {area_id}")
    with reader._connect() as connection:
        release_id = evidence._active_release(connection, cancel)
        if not list(connection.execute(schools.AREA_EXISTS_SQL, (area_id,))):
            raise evidence.AreaNotFound(f"unknown area: {area_id}")
        return pipeline_envelope(connection, area_id, release_id)
