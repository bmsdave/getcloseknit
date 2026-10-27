"""The official house price index for an area's borough (HM Land Registry UK HPI, migration 080).

The index is published for boroughs only, so an LSOA or MSOA reads its borough's price line since
1995 by type of home and its change over 1, 5 and 10 years, next to London's, with the borough's
London rank on the `hpi-change-5y` / `hpi-change-10y` layers. Our own £/m² stays the local figure.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from datetime import date
from typing import Any

from . import coverage, envelope, evidence, schools
from .area_rents import AREA_BOROUGH_SQL

SCHEMA_VERSION = "area-hpi.v1"
LONDON = "E12000007"
TYPES = ("all", "detached", "semi", "terraced", "flat")
YEARS = (1, 5, 10)
LAYERS = {"hpi-change-5y": "5y", "hpi-change-10y": "10y"}
SOURCE_NAME = "HM Land Registry UK House Price Index"
CAVEATS = [
    "Borough-wide: the official index is not published for smaller areas.",
    "Mix-adjusted, so a change in which homes sold does not move it; our own £/m² stays the local figure.",
    "The latest months are first estimates and are revised as more sales are registered.",
]

HPI_TABLE_SQL = """-- evidence:hpi-table
SELECT to_regclass('borough_hpi') IS NOT NULL AS t"""

HPI_SERIES_SQL = """-- evidence:hpi-series
SELECT h.borough, h.month, h.property_type, h.average_price, h.index, h.source_release_id,
  s.source_url, s.licence, s.attribution, s.transformation_version, s.release_date
FROM borough_hpi h
JOIN source_release s ON s.id = h.source_release_id
WHERE h.borough IN (%s, coalesce((SELECT region_code FROM area_region WHERE area_id = 'uk:lad:' || %s), '""" + LONDON + """')) AND h.source_release_id IN (
  SELECT member.source_release_id FROM active_product_release active
  JOIN product_release_member member ON member.release_id = active.release_id)
ORDER BY h.borough, h.property_type, h.month"""

HPI_RANK_SQL = """-- evidence:hpi-rank
SELECT v.metric_id, v.region_percentile
FROM metric_value v
WHERE v.geography_id = %s AND v.metric_id IN ('hpi-change-5y', 'hpi-change-10y')"""


def change_pct(series: Mapping[date, float], latest: date, years: int) -> float | None:
    """Percent change of the index from the same month `years` earlier (etl_uk_hpi.change_pct)."""
    then, now = series.get(latest.replace(year=latest.year - years)), series.get(latest)
    return None if not then or now is None else round(100 * (now / then - 1), 1)


def _changes(series: Mapping[date, float], latest: date) -> dict:
    return {f"{years}y": change_pct(series, latest, years) for years in YEARS}


def hpi_payload(area_id: str, borough: Mapping[str, Any], rows: list[Mapping[str, Any]],
                ranks: list[Mapping[str, Any]]) -> dict:
    code = borough["id"].split(":")[-1]
    index: dict[tuple[str, str], dict[date, float]] = {}
    price: dict[tuple[str, str], dict[date, int]] = {}
    for row in rows:
        key = (row["borough"], row["property_type"])
        index.setdefault(key, {})[row["month"]] = float(row["index"])
        price.setdefault(key, {})[row["month"]] = int(row["average_price"])
    own = [kind for kind in TYPES if (code, kind) in index]
    # The comparison is the area's region (London for London): the one E12 code the SQL returns.
    region = next((key[0] for key in index if key[0].startswith("E12")), None)
    latest = max(index[(code, "all")]) if (code, "all") in index else None
    types = []
    for kind in own if latest else ():
        prices = price[(code, kind)]
        types.append({
            "type": kind,
            "latestPrice": prices.get(latest),
            "change": _changes(index[(code, kind)], latest),
            "regionChange": _changes(index.get((region, kind), {}), latest),
            # One point a quarter keeps the line light; the latest month always ends it.
            "series": [{"month": f"{month:%Y-%m}", "price": value} for month, value in sorted(prices.items())
                       if month.month in (1, 4, 7, 10) or month == latest],
        })
    return {
        "geographyId": area_id,
        "available": bool(types),
        "borough": {"id": borough["id"], "name": borough["name"]},
        "latest": f"{latest:%Y-%m}" if latest else None,
        "rankScope": coverage.rank_scope(region),
        "types": types,
        "regionPercentile": {LAYERS[row["metric_id"]]: row["region_percentile"] for row in ranks
                             if row["metric_id"] in LAYERS},
    }


def wrap_hpi(payload: Mapping[str, Any], release_id: str, area_id: str, rows: list[Mapping[str, Any]]) -> dict:
    if not payload["available"]:
        return envelope.wrap(payload, schema_version=SCHEMA_VERSION, release_id=release_id, caveats=CAVEATS)
    first = rows[0]
    everything = payload["types"][0]
    evidence_rows = [{"kind": "metric-observation", "geographyId": payload["borough"]["id"], "metricId": metric,
                      "period": payload["latest"], "value": everything["change"][span],
                      "quality": "observed" if area_id == payload["borough"]["id"] else "fallback",
                      "regionPercentile": payload["regionPercentile"].get(span),
                      "sourceVersion": first["source_release_id"]}
                     for metric, span in LAYERS.items()]
    source = {"sourceId": "hmlr-uk-hpi", "sourceName": SOURCE_NAME, "sourceUrl": first["source_url"],
              "release": first["source_release_id"], "licence": first["licence"],
              "attribution": first["attribution"], "transformationVersion": first["transformation_version"]}
    return envelope.wrap(payload, schema_version=SCHEMA_VERSION, release_id=release_id,
                         confidence="high" if area_id == payload["borough"]["id"] else "medium",
                         evidence=evidence_rows, sources=[source], caveats=CAVEATS)


def area_hpi(reader: evidence.EvidenceReader, area_id: str, cancel: Callable[[], bool] | None = None) -> dict:
    """The borough's UK HPI line by type and its change over 1, 5 and 10 years against London."""
    evidence._check_cancelled(cancel)
    if not schools.AREA_PATTERN.match(area_id or ""):
        raise evidence.MalformedQuery(f"invalid area id: {area_id}")
    with reader._connect() as connection:
        release_id = evidence._active_release(connection, cancel)
        found = list(connection.execute(AREA_BOROUGH_SQL, (area_id,)))
        if not found:
            raise evidence.AreaNotFound(f"unknown area: {area_id}")
        borough = found[0]
        rows: list[Mapping[str, Any]] = []
        ranks: list[Mapping[str, Any]] = []
        if list(connection.execute(HPI_TABLE_SQL))[0]["t"]:
            code = borough["id"].split(":")[-1]
            rows = list(connection.execute(HPI_SERIES_SQL, (code, code)))
            ranks = list(connection.execute(HPI_RANK_SQL, (borough["id"],))) if rows else []
        return wrap_hpi(hpi_payload(area_id, borough, rows, ranks), release_id, area_id, rows)
