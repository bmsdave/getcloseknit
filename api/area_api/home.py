"""The area card's Home theme (migration 063): can I extend, broadband, and how settled the area is.

  extend     share of the land in a conservation area or under a householder Article 4 direction,
             listed buildings by grade, and whether the borough has published Article 4 data at all
  broadband  share of homes (residential premises) with gigabit available; full fibre is the
             borough's figure (Ofcom publishes it for local authorities only)
  settled    share of usual residents at the same address a year before Census day 2021

Each comes with its place among the areas of the same kind in the area's region (percent_rank 0-100 over
the raw share, lowest = 0; London = London, as before England was loaded) and the region's own share
(rankScope names the region). Aggregates about places, never a person or a home. Short card
notes come with the payload so the site and the agent tools say the same thing.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from . import coverage, evidence, schools

SCHEMA_VERSION = "area-home.v1"
CAVEATS = [
    "Shares are of the area's land; the borough's own maps and planning team are the authority on what needs "
    "permission.",
    "Article 4 counts only directions that remove householder rights (extensions, roofs, porches, windows), and "
    "only from councils that publish them to planning.data.gov.uk.",
    "Conservation areas outside London are as councils publish them to planning.data.gov.uk; a council that "
    "publishes none shows no conservation share (unknown).",
    "Listed buildings are counted by list entry; one entry can be a terrace. Listing covers the whole building, "
    "inside and out.",
    "Broadband is availability (a line can be ordered), not take-up or speed in use; full fibre is the council "
    "area's figure.",
    "Settledness is from Census day, 21 March 2021, during the pandemic: students and some renters were away.",
]

# Each layer ranked among the areas of the same kind in the area's region (area_region, migration 103);
# the region's share from its boroughs' (LADs') sums. London's figures are London's, as before England.
RESTRICTION_SQL = """-- evidence:area-home-restriction
WITH a AS (SELECT %s::text AS id), reg AS (SELECT r.region_code FROM area_region r JOIN a ON r.area_id = a.id)
SELECT * FROM (
  SELECT r.*, g.kind, rg.region_code, r.restricted_m2 / r.area_m2 AS share,
    round(100 * percent_rank() OVER (PARTITION BY g.kind ORDER BY r.restricted_m2 / r.area_m2))::int AS region_percentile,
    sum(r.restricted_m2) FILTER (WHERE g.kind = 'lad') OVER () / nullif(sum(r.area_m2) FILTER (WHERE g.kind = 'lad') OVER (), 0) AS london_share
  FROM area_restriction r JOIN area_geography g ON g.id = r.geography_id
  JOIN area_region rg ON rg.area_id = g.id AND rg.region_code = (SELECT region_code FROM reg)) x
WHERE geography_id = (SELECT id FROM a)"""

BROADBAND_SQL = """-- evidence:area-home-broadband
WITH a AS (SELECT %s::text AS id), reg AS (SELECT r.region_code FROM area_region r JOIN a ON r.area_id = a.id)
SELECT * FROM (
  SELECT b.*, g.kind, rg.region_code, b.gigabit_premises::float8 / b.premises AS share,
    round(100 * percent_rank() OVER (PARTITION BY g.kind ORDER BY b.gigabit_premises::float8 / b.premises))::int AS region_percentile,
    sum(b.gigabit_premises) FILTER (WHERE g.kind = 'lad') OVER ()::float8
      / nullif(sum(b.premises) FILTER (WHERE g.kind = 'lad') OVER (), 0) AS london_share
  FROM area_broadband b JOIN area_geography g ON g.id = b.geography_id
  JOIN area_region rg ON rg.area_id = g.id AND rg.region_code = (SELECT region_code FROM reg)) x
WHERE geography_id = (SELECT id FROM a)"""

# Ranked and compared within the area's region (area_region, migration 103): London's figures are
# London's, as before England was loaded.
SETTLED_SQL = """-- evidence:area-home-settled
WITH a AS (SELECT %s::text AS id), reg AS (SELECT r.region_code FROM area_region r JOIN a ON r.area_id = a.id)
SELECT * FROM (
  SELECT s.*, g.kind, s.same_address::float8 / s.residents AS share,
    round(100 * percent_rank() OVER (PARTITION BY g.kind ORDER BY s.same_address::float8 / s.residents))::int AS region_percentile,
    sum(s.same_address) FILTER (WHERE g.kind = 'lad') OVER ()::float8
      / nullif(sum(s.residents) FILTER (WHERE g.kind = 'lad') OVER (), 0) AS london_share
  FROM area_settled s JOIN area_geography g ON g.id = s.geography_id
  JOIN area_region r ON r.area_id = g.id AND r.region_code = (SELECT region_code FROM reg)) x
WHERE geography_id = (SELECT id FROM a)"""

# The borough the area sits in (itself for a borough): Article 4 coverage and full fibre are borough facts.
BOROUGH_SQL = """-- evidence:area-home-borough
SELECT b.id, b.name, c.areas AS article4_areas, c.source_release_id AS coverage_release_id,
       bb.full_fibre_share, bb.source_release_id AS fibre_release_id
FROM area_geography g
LEFT JOIN area_geography m ON m.id = g.parent_id
JOIN area_geography b ON b.id = CASE g.kind WHEN 'lad' THEN g.id WHEN 'msoa' THEN g.parent_id ELSE m.parent_id END
LEFT JOIN article4_coverage c ON 'uk:lad:' || c.borough_code = b.id
LEFT JOIN area_broadband bb ON bb.geography_id = b.id
WHERE g.id = %s"""

SOURCES_SQL = """-- evidence:area-home-sources
SELECT s.id, s.source_url, s.licence, s.attribution FROM source_release s WHERE s.id = ANY(%s) ORDER BY s.id"""

# Listed buildings (NHLE points, 27700) within a few metres of a postcode's recorded homes, nearest
# first: "a listed building is recorded at or near this address", never "this home is listed" (#234).
LISTED_NEAR_METRES = 25
LISTED_NEAR_LIMIT = 5
LISTED_NEAR_SQL = """-- evidence:listed-near-postcode
SELECT b.id, b.name, b.grade,
  min(round(ST_Distance(b.location, ST_SetSRID(ST_MakePoint(a.easting, a.northing), 27700))))::integer AS distance_metres
FROM address a
JOIN listed_building b ON ST_DWithin(b.location, ST_SetSRID(ST_MakePoint(a.easting, a.northing), 27700), %s)
WHERE a.postcode = %s AND a.easting IS NOT NULL AND a.northing IS NOT NULL
GROUP BY b.id, b.name, b.grade
ORDER BY distance_metres, b.id
LIMIT %s"""
NHLE_URL = "https://historicengland.org.uk/listing/the-list/list-entry/"


def _share(value: Any) -> float | None:
    return None if value is None else round(min(1.0, max(0.0, float(value))), 4)


def _pct(share: float | None) -> str:
    if share is None:
        return "unknown"
    return "under 1%" if 0 < share < 0.005 else f"{round(share * 100)}%"


def extend_value(row: Mapping[str, Any], borough: Mapping[str, Any] | None) -> dict:
    area = float(row["area_m2"])
    listed = {"gradeI": row["listed_grade_i"], "gradeIIStar": row["listed_grade_ii_star"], "gradeII": row["listed_grade_ii"]}
    published = borough.get("article4_areas") if borough else None
    return {
        "restrictedShare": _share(row["share"]),
        # No conservation release: the council has published no conservation areas (unknown, not none).
        "conservationShare": (_share(float(row["conservation_m2"]) / area)
                              if row.get("conservation_release_id", True) else None),
        "article4Share": _share(float(row["article4_m2"]) / area),
        "listed": {**listed, "total": sum(listed.values())},
        "regionPercentile": row["region_percentile"],
        "regionShare": _share(row["london_share"]),
        # Unknown (no coverage row), published (areas > 0), or not published: never "no Article 4 here".
        "article4Data": None if published is None else "published" if published > 0 else "not-published",
    }


def ranked_value(row: Mapping[str, Any], **extra: Any) -> dict:
    return {"share": _share(row["share"]), "regionPercentile": row["region_percentile"],
            "regionShare": _share(row["london_share"]), **extra}


def card_notes(value: Mapping[str, Any], borough_name: str | None) -> list[str]:
    """Short lines for the card: the rules on the land, then the line, then how settled it is."""
    notes = []
    scope = (value.get("rankScope") or {}).get("name") or "London"
    extend = value.get("extend")
    if extend:
        if (extend["restrictedShare"] or 0) >= 0.005:
            notes.append(f"{_pct(extend['restrictedShare'])} of the land is in a conservation area or under Article 4: "
                         "most extensions need planning permission there")
        else:
            notes.append("No conservation area or householder Article 4 direction mapped here")
        listed = extend["listed"]
        if listed["total"]:
            starred = listed["gradeI"] + listed["gradeIIStar"]
            notes.append(f"{listed['total']:,} listed {'building' if listed['total'] == 1 else 'buildings'}"
                         + (f" ({starred} grade I or II*)" if starred else ""))
        if extend["article4Data"] == "not-published":
            notes.append(f"{borough_name or 'The borough'} has not published Article 4 data: check the council's map")
    broadband = value.get("broadband")
    if broadband:
        notes.append(f"Gigabit broadband available to {_pct(broadband['share'])} of homes "
                     f"({scope} {_pct(broadband['regionShare'])})")
    settled = value.get("settled")
    if settled:
        notes.append(f"{_pct(settled['share'])} of residents lived at the same address a year earlier "
                     f"({scope} {_pct(settled['regionShare'])})")
    return notes


def _one(connection: Any, sql: str, area_id: str) -> Mapping[str, Any] | None:
    rows = list(connection.execute(sql, (area_id,)))
    return rows[0] if rows else None


def listed_entry(row: Mapping[str, Any]) -> dict:
    entry = str(row["id"]).removeprefix("nhle:")
    return {"listEntry": entry, "name": row["name"], "grade": row["grade"], "distanceMetres": row["distance_metres"],
            "url": NHLE_URL + entry}


def listed_near_postcode(connection: Any, postcode: str, radius_metres: int = LISTED_NEAR_METRES) -> list[dict] | None:
    """Listed buildings within `radius_metres` of the postcode's recorded homes, or None when migration 063
    is not applied. A savepoint keeps a missing table from poisoning the caller's transaction."""
    try:
        savepoint = getattr(connection, "transaction", None)
        if savepoint is not None:
            with savepoint():
                return _listed_near(connection, postcode, radius_metres)
        return _listed_near(connection, postcode, radius_metres)
    except Exception:  # noqa: BLE001 - an unloaded layer is a normal state, not an error
        return None


def _listed_near(connection: Any, postcode: str, radius_metres: int) -> list[dict]:
    return [listed_entry(row) for row in connection.execute(LISTED_NEAR_SQL, (radius_metres, postcode, LISTED_NEAR_LIMIT))]


def home_value(connection: Any, area_id: str) -> dict | None:
    """The home block for one area, or None when migration 063 is not loaded or nothing is loaded yet.
    A savepoint keeps a missing table from poisoning the caller's transaction."""
    try:
        savepoint = getattr(connection, "transaction", None)
        if savepoint is not None:
            with savepoint():
                return _home_value(connection, area_id)
        return _home_value(connection, area_id)
    except Exception:  # noqa: BLE001 - an unloaded layer is a normal state, not an error
        return None


def _home_value(connection: Any, area_id: str) -> dict | None:
    restriction = _one(connection, RESTRICTION_SQL, area_id)
    broadband = _one(connection, BROADBAND_SQL, area_id)
    settled = _one(connection, SETTLED_SQL, area_id)
    if not (restriction or broadband or settled):
        return None
    borough = _one(connection, BOROUGH_SQL, area_id)
    fibre = borough.get("full_fibre_share") if borough else None
    region = next((row["region_code"] for row in (restriction, broadband) if row and row.get("region_code")), None)
    value = {
        "borough": {"id": borough["id"], "name": borough["name"]} if borough else None,
        "rankScope": coverage.rank_scope(region),
        "extend": extend_value(restriction, borough) if restriction else None,
        "broadband": ranked_value(broadband, premises=broadband["premises"],
                                  boroughFullFibreShare=_share(fibre)) if broadband else None,
        "settled": ranked_value(settled, residents=settled["residents"]) if settled else None,
    }
    value["notes"] = card_notes(value, borough["name"] if borough else None)
    releases = set()
    if restriction:
        releases |= {restriction[key] for key in ("article4_release_id", "listed_release_id", "conservation_release_id")}
    for row in (broadband, settled):
        if row:
            releases.add(row["source_release_id"])
    if borough:
        releases |= {borough.get("coverage_release_id"), borough.get("fibre_release_id")}
    value["sourceVersions"] = sorted(release for release in releases if release)
    return value


def area_home(reader: evidence.EvidenceReader, area_id: str, cancel: Callable[[], bool] | None = None) -> dict:
    """area-home.v1 for one LSOA, MSOA or borough; available=false before the layers are loaded."""
    evidence._check_cancelled(cancel)
    if not schools.AREA_PATTERN.match(area_id or ""):
        raise evidence.MalformedQuery(f"invalid area id: {area_id}")
    with reader._connect() as connection:
        release_id = evidence._active_release(connection, cancel)
        if not list(connection.execute(schools.AREA_EXISTS_SQL, (area_id,))):
            raise evidence.AreaNotFound(f"unknown area: {area_id}")
        value = home_value(connection, area_id)
        sources = [{"release": row["id"], "sourceUrl": row["source_url"], "licence": row["licence"],
                    "attribution": row["attribution"]}
                   for row in connection.execute(SOURCES_SQL, (value["sourceVersions"],))] if value else []
    return {"schemaVersion": SCHEMA_VERSION, "productReleaseId": release_id, "geographyId": area_id,
            "available": value is not None, **(value or {"notes": []}), "sources": sources, "caveats": CAVEATS}
