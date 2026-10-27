"""Private rents for an area's borough (ONS PIPR, migration 029).

PIPR has nothing below a borough, so an LSOA or MSOA reads its borough's
average monthly rent by bedroom count, next to its region's (London's for London). It is a ballpark for
the area, never the rent of a particular home.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from . import coverage, evidence, schools

SCHEMA_VERSION = "area-rents.v1"
LONDON = "E12000007"
# borough_rent.bedrooms -> payload key, in display order
CELLS = {"1 bedroom": "oneBedroom", "2 bedrooms": "twoBedrooms", "3 bedrooms": "threeBedrooms",
         "4 or more bedrooms": "fourOrMoreBedrooms", "all": "all"}

RENT_TABLE_SQL = """-- evidence:rent-table
SELECT to_regclass('borough_rent') IS NOT NULL AS t"""

AREA_BOROUGH_SQL = """-- evidence:area-borough
SELECT b.id, b.name
FROM area_geography g
LEFT JOIN area_geography p ON p.id = g.parent_id
LEFT JOIN area_geography pp ON pp.id = p.parent_id
JOIN area_geography b ON b.id = CASE g.kind WHEN 'lad' THEN g.id WHEN 'msoa' THEN p.id ELSE pp.id END
WHERE g.id = %s"""

AREA_RENTS_SQL = """-- evidence:area-rents
SELECT r.area_code, to_char(r.period, 'YYYY-MM') AS period, r.bedrooms, r.monthly_rent,
  r.annual_change_pct, r.source_release_id, s.attribution
FROM borough_rent r JOIN source_release s ON s.id = r.source_release_id
WHERE r.area_code IN (%s, coalesce((SELECT region_code FROM area_region WHERE area_id = 'uk:lad:' || %s), '""" + LONDON + """')) AND r.period = (SELECT max(period) FROM borough_rent)"""


def rents_payload(area_id: str, release_id: str, borough: Mapping[str, Any] | None,
                  rows: list[Mapping[str, Any]]) -> dict:
    code = borough["id"].split(":")[-1] if borough else None
    own = {row["bedrooms"]: row for row in rows if row["area_code"] == code}
    # The comparison row is the area's region (London for London): the one E12 code the SQL returns.
    region = next((row["area_code"] for row in rows if row["area_code"].startswith("E12")), None)
    london = {row["bedrooms"]: row for row in rows if row["area_code"] == region}
    first = next(iter(own.values()), None)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "productReleaseId": release_id,
        "geographyId": area_id,
        "available": bool(own),
        "borough": {"id": borough["id"], "name": borough["name"]} if borough else None,
        "rankScope": coverage.rank_scope(region),
        "period": first["period"] if first else None,
        "rents": [{
            "bedrooms": key,
            "monthlyRent": own[cell]["monthly_rent"],
            "annualChangePct": float(own[cell]["annual_change_pct"]) if own[cell]["annual_change_pct"] is not None else None,
            "regionMonthlyRent": london[cell]["monthly_rent"] if cell in london else None,
        } for cell, key in CELLS.items() if cell in own],
        "sourceVersion": first["source_release_id"] if first else None,
        "attribution": first["attribution"] if first else None,
        "caveats": ["Average (mean) monthly private rent for the whole borough, new and existing tenancies.",
                    "Not the rent of a particular home."],
    }


def area_rents(reader: evidence.EvidenceReader, area_id: str,
               cancel: Callable[[], bool] | None = None) -> dict:
    """The borough's latest average private rents by bedroom count, with its region's alongside."""
    evidence._check_cancelled(cancel)
    if not schools.AREA_PATTERN.match(area_id or ""):
        raise evidence.MalformedQuery(f"invalid area id: {area_id}")
    with reader._connect() as connection:
        release_id = evidence._active_release(connection, cancel)
        found = list(connection.execute(AREA_BOROUGH_SQL, (area_id,)))
        if not found:
            raise evidence.AreaNotFound(f"unknown area: {area_id}")
        borough = found[0]
        rows = []
        if list(connection.execute(RENT_TABLE_SQL))[0]["t"]:
            code = borough["id"].split(":")[-1]
            rows = list(connection.execute(AREA_RENTS_SQL, (code, code)))
        return rents_payload(area_id, release_id, borough, rows)
