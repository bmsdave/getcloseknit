"""Where an area sits on the planning and driving maps (migration 030): its land in a
conservation area, in the ULEZ and in the Congestion Charge zone, and how many planning
applications were made there in the last 24 months.

Conservation areas cover England (the GLA's for London, planning.data.gov.uk elsewhere; migration 113:
no conservation release = the council has published none, so conservation is null, unknown). The ULEZ,
the Congestion Charge and the Planning London Datahub are London-only: outside London (the area's
region, area_region) they are null. The planning median is the region's.

Facts about places, never about who lives there. A conservation area or a charging zone is a
rule that applies to the land; planning applications are proposals, not permissions. Short
card notes come with each payload so the site, the brief and the agent tools say the same thing.
"""
from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from typing import Any

from . import coverage, evidence, schools

SCHEMA_VERSION = "area-location.v1"
# Most of the land: "in"; a noticeable part: "partly in". Slivers at the edge say nothing.
INSIDE_SHARE = 0.5
PARTLY_SHARE = 0.05
MAX_NAMES = 5
CAVEATS = [
    "Shares are of the area's land, not of its homes; boundaries are as the GLA, TfL and (outside "
    "London) councils via planning.data.gov.uk publish them; ULEZ, the Congestion Charge and planning "
    "applications are London only.",
    "A conservation area adds planning controls (demolition, some extensions, trees); the council's map "
    "and planning team are the authority.",
    "ULEZ and Congestion Charge rules, hours and exemptions change; check TfL before relying on them.",
    "Planning applications are proposals validated in the window, not permissions or completed buildings; "
    "conditions, amendments, tree works, adverts and certificates for existing uses are not counted.",
]

AREA_LOCATION_SQL = """-- evidence:area-location
SELECT l.*, g.kind, r.region_code,
  (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY o.planning_applications)
   FROM area_location o JOIN area_geography og ON og.id = o.geography_id
   JOIN area_region orr ON orr.area_id = o.geography_id
   WHERE og.kind = g.kind AND orr.region_code = r.region_code) AS london_median
FROM area_location l JOIN area_geography g ON g.id = l.geography_id
LEFT JOIN area_region r ON r.area_id = l.geography_id
WHERE l.geography_id = ANY(%s)"""

AREA_CONSERVATION_SQL = """-- evidence:area-conservation
SELECT ac.geography_id, c.name, c.borough, ac.overlap_m2
FROM area_conservation ac JOIN conservation_area c ON c.id = ac.conservation_id
WHERE ac.geography_id = ANY(%s)
ORDER BY ac.geography_id, ac.overlap_m2 DESC, c.name"""

SOURCES_SQL = """-- evidence:area-location-sources
SELECT s.id, s.source_url, s.licence, s.attribution FROM source_release s WHERE s.id = ANY(%s) ORDER BY s.id"""


def _share(part: float | None, total: float) -> float:
    return round(min(1.0, max(0.0, float(part or 0) / total)), 4) if total > 0 else 0.0


def _presence(share: float) -> str:
    return "inside" if share >= INSIDE_SHARE else "partly" if share >= PARTLY_SHARE else "outside"


def in_london(row: Mapping[str, Any]) -> bool:
    """London-only layers apply: the area is in London (or the database predates area_region)."""
    return row.get("region_code") in (None, coverage.LONDON_REGION)


def location_value(row: Mapping[str, Any], conservation: Iterable[Mapping[str, Any]] = ()) -> dict:
    """The location block for one area_location row (and its conservation areas, largest first)."""
    total = float(row["area_m2"])
    conservation_share = _share(row["conservation_m2"], total)
    ulez, congestion = _share(row["ulez_m2"], total), _share(row["congestion_m2"], total)
    median = row.get("london_median")
    london = in_london(row)
    value = {
        "conservation": {"share": conservation_share, "presence": _presence(conservation_share),
                         "areas": _named_areas(conservation, total)}
        if row.get("conservation_release_id", True) else None,
        "ulez": {"share": ulez, "presence": _presence(ulez)} if london else None,
        "congestionCharge": {"share": congestion, "presence": _presence(congestion)} if london else None,
        "planning": {
            "applications": row["planning_applications"], "householder": row["planning_householder"],
            "full": row["planning_full"], "priorApproval": row["planning_prior_approval"],
            "windowStart": _iso(row["planning_window_start"]), "windowEnd": _iso(row["planning_window_end"]),
            "regionMedian": round(float(median)) if median is not None else None,
        } if london else None,
        "rankScope": coverage.rank_scope(row.get("region_code")),
    }
    value["notes"] = card_notes(value)
    return value


def _named_areas(rows: Iterable[Mapping[str, Any]], total: float) -> list[dict]:
    """Conservation areas by name, largest overlap first (one area can be several published features)."""
    overlap: dict[tuple, float] = {}
    for row in rows:
        key = (row["name"], row["borough"])
        overlap[key] = overlap.get(key, 0.0) + float(row["overlap_m2"])
    ranked = sorted(overlap.items(), key=lambda item: (-item[1], item[0][0]))[:MAX_NAMES]
    return [{"name": name, "borough": borough, "share": _share(m2, total)} for (name, borough), m2 in ranked]


def card_notes(value: Mapping[str, Any]) -> list[str]:
    """Short lines for an area card: rules on the land first, then planning activity."""
    notes = []
    conservation = value["conservation"]
    if conservation is None:
        notes.append("The council has not published its conservation areas: check the council's map")
    else:
        names = [area["name"] for area in conservation["areas"]]
        named = f" ({names[0]})" if names else ""
        if conservation["presence"] == "inside":
            notes.append(f"In a conservation area{named}: extensions are limited")
        elif conservation["presence"] == "partly":
            notes.append(f"Partly in a conservation area{named}, {round(conservation['share'] * 100)}% of the land: "
                         "extensions are limited there")
    if value["ulez"] is None or value["planning"] is None:  # London-only layers
        return notes
    congestion = value["congestionCharge"]["presence"]
    if congestion != "outside":
        notes.append(("Inside" if congestion == "inside" else "Partly inside")
                     + " the Congestion Charge zone: driving in pays a daily charge")
    # The ULEZ covers almost all of London, so being inside it says nothing; being outside (or on its
    # edge) is the informative case.
    ulez = value["ulez"]["presence"]
    if ulez == "outside" and congestion == "outside":  # the charge zone sits inside the ULEZ
        notes.append("Outside ULEZ: no daily charge for older petrol and diesel cars")
    elif ulez == "partly":
        notes.append("On the ULEZ boundary: part of the area is outside the charge")
    planning = value["planning"]
    count = planning["applications"]
    median = planning["regionMedian"]
    scope = (value.get("rankScope") or {}).get("name") or "London"
    context = f" ({scope} median {median})" if median is not None else ""
    notes.append(f"{count} planning {'application' if count == 1 else 'applications'} in the last 2 years{context}")
    return notes


def _iso(day: Any) -> str | None:
    return day.isoformat() if hasattr(day, "isoformat") else day


def location_rows(connection: Any, area_ids: list[str]) -> dict[str, dict]:
    """area id -> location value for the areas that have one; {} when migration 030 is not loaded.
    A savepoint keeps a missing table from poisoning the caller's transaction."""
    try:
        savepoint = getattr(connection, "transaction", None)
        if savepoint is not None:
            with savepoint():
                return _location_rows(connection, area_ids)
        return _location_rows(connection, area_ids)
    except Exception:  # noqa: BLE001 - an unloaded layer is a normal state, not an error
        return {}


def _location_rows(connection: Any, area_ids: list[str]) -> dict[str, dict]:
    rows = list(connection.execute(AREA_LOCATION_SQL, (area_ids,)))
    names: dict[str, list] = {}
    for row in connection.execute(AREA_CONSERVATION_SQL, (area_ids,)):
        names.setdefault(row["geography_id"], []).append(row)
    out = {}
    for row in rows:
        value = location_value(row, names.get(row["geography_id"], []))
        keys = ("conservation_release_id", "zones_release_id", "planning_release_id") if in_london(row) \
            else ("conservation_release_id",)
        value["sourceVersions"] = sorted({row[key] for key in keys if row.get(key)})
        out[row["geography_id"]] = value
    return out


def area_location(reader: evidence.EvidenceReader, area_id: str, cancel: Callable[[], bool] | None = None) -> dict:
    """area-location.v1 for one LSOA, MSOA or borough; available=false before the layers are loaded."""
    evidence._check_cancelled(cancel)
    if not schools.AREA_PATTERN.match(area_id or ""):
        raise evidence.MalformedQuery(f"invalid area id: {area_id}")
    with reader._connect() as connection:
        release_id = evidence._active_release(connection, cancel)
        if not list(connection.execute(schools.AREA_EXISTS_SQL, (area_id,))):
            raise evidence.AreaNotFound(f"unknown area: {area_id}")
        value = location_rows(connection, [area_id]).get(area_id)
        sources = [{"release": row["id"], "sourceUrl": row["source_url"], "licence": row["licence"],
                    "attribution": row["attribution"]}
                   for row in connection.execute(SOURCES_SQL, (value["sourceVersions"],))] if value else []
    return {"schemaVersion": SCHEMA_VERSION, "productReleaseId": release_id, "geographyId": area_id,
            "available": value is not None, **(value or {"notes": []}), "sources": sources, "caveats": CAVEATS}
