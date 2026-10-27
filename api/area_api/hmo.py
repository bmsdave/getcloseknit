"""HMO and landlord licensing (migration 087, loaded by deploy/tools/etl_hmo.py) for the area card's Homes
section: licensed HMOs per 1,000 homes against London, and the additional or selective licensing schemes in
force where the area is.

A borough that has not published its HMO register in bulk has no counts: the payload says "not published",
never zero. Counts of licences by area only; never a name, a licence holder or an address. Answers in the
evidence envelope (area-hmo.v1).
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from datetime import date
from typing import Any

from . import coverage, envelope, evidence, kinds, regions, schools

SCHEMA_VERSION = "area-hmo.v1"
METRIC_ID = "hmo-per-1000"
CAVEATS = [
    "Licensed HMOs only: unlicensed HMOs, and small HMOs outside an additional licensing scheme, are missing.",
    "Each borough updates its public register (Housing Act 2004 s.232) at different times.",
    "Per 1,000 homes uses Census 2021 households; counted by each licence's property postcode.",
    "{place}'s figure and percentiles cover only the boroughs that publish their register in bulk.",
    "Licensing schemes are the borough's additional (HMO) and selective schemes; mandatory HMO licensing applies "
    "everywhere.",
]
KIND_COLUMN = {"lsoa": "lsoa_code", "msoa": "msoa_code", "lad": "borough_code"}

# The area's figure, its place among London areas of the same kind with a figure (0 = fewest) and London's rate
# from the published boroughs' sums.
AREA_SQL = """-- evidence:area-hmo-area
SELECT * FROM (
  SELECT a.*, g.kind::text AS kind,
    CASE WHEN a.per_1000_homes IS NOT NULL THEN round(100 * percent_rank() OVER (
      PARTITION BY g.kind, a.per_1000_homes IS NOT NULL ORDER BY a.per_1000_homes))::int END AS region_percentile,
    1000.0 * sum(a.licensed_hmos) FILTER (WHERE g.kind = 'lad') OVER ()
      / nullif(sum(a.homes) FILTER (WHERE g.kind = 'lad') OVER (), 0) AS london_per_1000
  FROM area_hmo a JOIN area_geography g ON g.id = a.geography_id) x
WHERE geography_id = %(area)s"""

# The borough the area sits in (itself for a borough) and its register.
BOROUGH_SQL = """-- evidence:area-hmo-borough
SELECT b.id, r.borough_code AS code, b.name, r.status, r.url, r.page,
       to_char(r.updated, 'YYYY-MM-DD') AS updated, to_char(r.retrieved, 'YYYY-MM-DD') AS retrieved,
       r.source_release_id
FROM area_geography g
LEFT JOIN area_geography m ON m.id = g.parent_id
JOIN area_geography b ON b.id = CASE g.kind WHEN 'lad' THEN g.id WHEN 'msoa' THEN g.parent_id ELSE m.parent_id END
JOIN hmo_register r ON 'uk:lad:' || r.borough_code = b.id
WHERE g.id = %(area)s"""

# Schemes not yet ended, with the share of the area's live postcodes inside them (1 for a whole-borough scheme;
# NULL for a scheme on named streets, which is listed for every area of the borough with its street count).
SCHEMES_SQL = """-- evidence:area-hmo-schemes
SELECT s.kind, to_char(s.start_date, 'YYYY-MM-DD') AS start_date, to_char(s.end_date, 'YYYY-MM-DD') AS end_date,
       s.url, s.wards IS NULL AS whole_borough, cardinality(s.streets) AS streets,
       CASE WHEN s.wards IS NULL THEN 1.0 WHEN s.streets IS NOT NULL THEN NULL ELSE (
         SELECT avg((p.ward_code = ANY(s.wards))::int) FROM postcode_civic p
         WHERE p.terminated IS NULL AND p.{column} = %(code)s) END AS share
FROM licensing_scheme s
WHERE s.borough_code = %(borough)s AND (s.end_date IS NULL OR s.end_date >= current_date)
ORDER BY s.kind, s.start_date"""

SOURCES_SQL = """-- evidence:area-hmo-sources
SELECT id, source_url, licence, attribution FROM source_release WHERE id = ANY(%(ids)s) ORDER BY id"""

KIND_LABEL = {"additional": "Additional HMO licensing", "selective": "Selective licensing"}


def _day(value: str | None) -> str | None:
    if not value:
        return None
    day = date.fromisoformat(value)
    return f"{day.day} {day:%b %Y}"


def _rate(value: Any) -> float | None:
    return None if value is None else round(float(value), 1)


def card_notes(value: Mapping[str, Any]) -> list[str]:
    """Short lines for the card: the count against London (or "not published"), then each scheme."""
    notes = []
    if value["register"]["status"] == "published" and value["licensedHmos"] is not None:
        count = value["licensedHmos"]
        line = f"{count:,} licensed {'HMO' if count == 1 else 'HMOs'}"
        if value["per1000Homes"] is not None:
            line += f": {value['per1000Homes']:g} per 1,000 homes"
            if value["regionPer1000"] is not None:
                line += f" (London {value['regionPer1000']:g})"
        notes.append(line)
    else:
        notes.append(f"{value['borough']['name']}: HMO register not published")
    for scheme in value["schemes"]:
        line = KIND_LABEL[scheme["kind"]] + " in force"
        if scheme["coverage"] == "part":
            line += " in part of the area"
        elif scheme["coverage"] == "streets":
            line += f" on {scheme['streets']} named streets"
        if scheme["until"]:
            line += f" (until {_day(scheme['until'])})"
        notes.append(line)
    return notes


def hmo_value(connection: Any, area_id: str) -> dict | None:
    """The HMO block for one area, or None before migration 087 is loaded. A savepoint keeps a missing table
    from poisoning the caller's transaction."""
    try:
        savepoint = getattr(connection, "transaction", None)
        if savepoint is not None:
            with savepoint():
                return _hmo_value(connection, area_id)
        return _hmo_value(connection, area_id)
    except Exception:  # noqa: BLE001 - an unloaded layer is a normal state, not an error
        return None


def _hmo_value(connection: Any, area_id: str) -> dict | None:
    boroughs = list(connection.execute(BOROUGH_SQL, {"area": area_id}))
    if not boroughs:
        return None
    borough = boroughs[0]
    areas = list(connection.execute(AREA_SQL, {"area": area_id})) if borough["status"] == "published" else []
    area = areas[0] if areas else None
    kind, code = kinds.kind_of(area_id), area_id.split(":")[2]
    schemes = [
        {"kind": row["kind"], "start": row["start_date"], "until": row["end_date"], "url": row["url"],
         "coverage": "streets" if row["streets"] else "whole" if float(row["share"]) >= 0.999 else "part",
         "streets": row["streets"]}
        for row in connection.execute(SCHEMES_SQL.replace("{column}", KIND_COLUMN[kind]),
                                      {"code": code, "borough": borough["code"]})
        if row["streets"] or (row["share"] is not None and float(row["share"]) > 0)]
    value = {
        "available": True,
        "borough": {"id": borough["id"], "name": borough["name"]},
        "register": {"status": borough["status"], "url": borough["url"], "page": borough["page"],
                     "updated": borough["updated"], "retrieved": borough["retrieved"]},
        "licensedHmos": area["licensed_hmos"] if area else None,
        "homes": area["homes"] if area else None,
        "per1000Homes": _rate(area["per_1000_homes"]) if area else None,
        "regionPer1000": _rate(area["london_per_1000"]) if area else None,
        "regionPercentile": area["region_percentile"] if area else None,
        "schemes": schemes,
        "sourceVersions": sorted({borough["source_release_id"]} | ({area["source_release_id"]} if area else set())),
    }
    value["notes"] = card_notes(value)
    return value


def wrap(value: dict | None, release_id: str, area_id: str, sources: list[Mapping[str, Any]],
         place: str = "London") -> dict:
    """area-hmo.v1: the value (available false before the layer is loaded) in the evidence envelope; `place`: the
    area's region, the one its figure is compared with."""
    published = bool(value) and value["per1000Homes"] is not None
    rows = []
    if published:
        rows.append({"kind": "metric-observation", "geographyId": area_id, "metricId": METRIC_ID,
                     "value": value["per1000Homes"], "quality": "observed", "sampleCount": value["licensedHmos"],
                     "regionPercentile": value["regionPercentile"], "sourceVersion": value["sourceVersions"][0]})
    source_rows = [{"sourceId": "hmo-registers", "sourceName": "London borough HMO licence registers",
                    "sourceUrl": row["source_url"], "release": row["id"], "licence": row["licence"],
                    "attribution": row["attribution"]} for row in sources]
    if value and value["register"]["url"]:
        source_rows.append({"sourceId": "hmo-register", "sourceName": f"{value['borough']['name']} HMO register",
                            "sourceUrl": value["register"]["page"] or value["register"]["url"]})
    return envelope.wrap(
        {"geographyId": area_id, **(value or {"available": False, "notes": [], "schemes": []})},
        schema_version=SCHEMA_VERSION, release_id=release_id, confidence="high" if published else "none",
        evidence=rows, sources=source_rows, caveats=[caveat.format(place=place) for caveat in CAVEATS])


def area_hmo(reader: evidence.EvidenceReader, area_id: str, cancel: Callable[[], bool] | None = None) -> dict:
    """area-hmo.v1 for one LSOA, MSOA or borough."""
    evidence._check_cancelled(cancel)
    if not schools.AREA_PATTERN.match(area_id or ""):
        raise evidence.MalformedQuery(f"invalid area id: {area_id}")
    with reader._connect() as connection:
        release_id = evidence._active_release(connection, cancel)
        if not list(connection.execute(schools.AREA_EXISTS_SQL, (area_id,))):
            raise evidence.AreaNotFound(f"unknown area: {area_id}")
        value = hmo_value(connection, area_id)
        sources = list(connection.execute(SOURCES_SQL, {"ids": value["sourceVersions"]})) if value else []
        place = coverage.region_name(regions.area_regions_on(connection).get(area_id)) or "London"
    return wrap(value, release_id, area_id, sources, place)
