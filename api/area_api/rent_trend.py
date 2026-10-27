"""Rent trend for an area's borough (ONS PIPR series, migration 081).

PIPR has nothing below a borough, so an LSOA or MSOA reads its borough's monthly
rent series by bedroom count and type of home, its change over 1 and 5 years
(index based, as ONS measures it) next to London's, and the borough's London
percentile on the rent-change map layers. A trend for the area, never one home's rent.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from . import coverage, area_rents, envelope, evidence, schools

SCHEMA_VERSION = "area-rent-trend.v1"
LONDON = "E12000007"
METRIC_IDS = ("rent-change-1y", "rent-change-5y")
# borough_rent_series.category -> payload key, in display order
CATEGORIES = {"all": "all", "1 bedroom": "oneBedroom", "2 bedrooms": "twoBedrooms", "3 bedrooms": "threeBedrooms",
              "4 or more bedrooms": "fourOrMoreBedrooms", "flat or maisonette": "flat", "terraced": "terraced",
              "semi-detached": "semiDetached", "detached": "detached"}
SOURCE_NAME = "ONS Price Index of Private Rents"
CAVEATS = [
    "Borough-wide: every neighbourhood in a borough reads the borough's rents.",
    "Average (mean) monthly rent of new and existing tenancies; change is from the ONS index, which "
    "adjusts for the mix of homes let.",
    "Official statistics in development: ONS may revise recent months.",
    "No City of London figures are published.",
]

SERIES_TABLE_SQL = """-- evidence:rent-series-table
SELECT to_regclass('borough_rent_series') IS NOT NULL AS t"""

SERIES_SQL = """-- evidence:rent-series
SELECT s.borough, to_char(s.month, 'YYYY-MM') AS month, s.category, s.rent, s.index, s.source_release_id
FROM borough_rent_series s
WHERE s.borough IN (%s, coalesce((SELECT region_code FROM area_region WHERE area_id = 'uk:lad:' || %s), '""" + LONDON + """'))
ORDER BY s.month"""

VALUES_SQL = """-- evidence:rent-change-values
SELECT v.geography_id, g.name, g.kind::text AS carrier, v.metric_id,
  to_char(v.period, 'YYYY-MM') AS period, v.value,
  v.region_percentile, v.country_percentile, v.sample_count,
  v.quality::text AS quality, v.source_release_id
FROM active_product_release active
JOIN product_release_member member ON member.release_id = active.release_id
JOIN metric_value v ON v.source_release_id = member.source_release_id
JOIN area_geography g ON g.id = v.geography_id
WHERE v.geography_id = %s AND v.metric_id = ANY(%s)
  AND v.period = (SELECT max(period) FROM metric_value WHERE metric_id = v.metric_id)
ORDER BY v.metric_id"""

SOURCE_SQL = """-- evidence:rent-series-source
SELECT id, source_url, to_char(release_date, 'YYYY-MM-DD') AS release_date, licence, attribution,
  transformation_version
FROM source_release WHERE id = %s"""


def _back(month: str, months: int) -> str:
    total = int(month[:4]) * 12 + int(month[5:7]) - 1 - months
    return f"{total // 12:04d}-{total % 12 + 1:02d}"


def _change(index: Mapping[str, Any], latest: str, months: int) -> float | None:
    now, then = index.get(latest), index.get(_back(latest, months))
    if not now or not then:
        return None
    return float(((Decimal(now) / Decimal(then) - 1) * 100).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def _cell(rows: list[Mapping[str, Any]], latest: str) -> dict:
    rent = {row["month"]: row["rent"] for row in rows if row["rent"] is not None}
    index = {row["month"]: row["index"] for row in rows if row["index"] is not None}
    return {"rent": rent.get(latest), "change1yPct": _change(index, latest, 12),
            "change5yPct": _change(index, latest, 60), "rents": rent}


def rent_trend_payload(area_id: str, release_id: str, borough: Mapping[str, Any] | None,
                       series: list[Mapping[str, Any]], values: list[Mapping[str, Any]],
                       source: Mapping[str, Any] | None) -> dict:
    code = borough["id"].split(":")[-1] if borough else None
    own = [row for row in series if row["borough"] == code]
    # The comparison is the area's region (London for London): the one E12 code the SQL returns.
    region = next((row["borough"] for row in series if row["borough"].startswith("E12")), None)
    latest = max((row["month"] for row in own), default=None)
    categories = []
    for category, key in CATEGORIES.items():
        rows = [row for row in own if row["category"] == category]
        if not rows or latest is None:
            continue
        mine = _cell(rows, latest)
        london = _cell([row for row in series if row["borough"] == region and row["category"] == category], latest)
        categories.append({
            "category": key, "rent": mine["rent"], "change1yPct": mine["change1yPct"],
            "change5yPct": mine["change5yPct"], "regionRent": london["rent"],
            "regionChange1yPct": london["change1yPct"], "regionChange5yPct": london["change5yPct"],
            "series": [{"month": month, "rent": rent} for month, rent in sorted(mine["rents"].items())],
        })
    available = bool(categories)
    value = {
        "available": available,
        "borough": {"id": borough["id"], "name": borough["name"]} if borough else None,
        "latest": latest,
        "rankScope": coverage.rank_scope(region),
        "regionPercentile": {row["metric_id"]: row["region_percentile"] for row in values} if available else {},
        "categories": categories,
    }
    quality = "observed" if area_id.startswith("uk:lad:") else "fallback"
    sources = [{"sourceId": "ons-pipr", "sourceName": SOURCE_NAME, "sourceUrl": source["source_url"],
                "release": source["id"], "licence": source["licence"], "attribution": source["attribution"],
                "transformationVersion": source["transformation_version"]}] if available and source else []
    return envelope.wrap(
        value, schema_version=SCHEMA_VERSION, release_id=release_id,
        confidence=envelope.confidence_from_quality(quality) if available else "none",
        evidence=[envelope.evidence_from_summary({
            "geographyId": row["geography_id"], "name": row["name"], "metricId": row["metric_id"],
            "period": row["period"], "value": row["value"], "quality": row["quality"],
            "regionPercentile": row["region_percentile"], "sourceVersion": row["source_release_id"],
        }) for row in values] if available else [],
        sources=sources, caveats=CAVEATS)


def area_rent_trend(reader: evidence.EvidenceReader, area_id: str,
                    cancel: Callable[[], bool] | None = None) -> dict:
    """The borough's monthly rents, 1- and 5-year change next to London's, and its London rank."""
    evidence._check_cancelled(cancel)
    if not schools.AREA_PATTERN.match(area_id or ""):
        raise evidence.MalformedQuery(f"invalid area id: {area_id}")
    with reader._connect() as connection:
        release_id = evidence._active_release(connection, cancel)
        found = list(connection.execute(area_rents.AREA_BOROUGH_SQL, (area_id,)))
        if not found:
            raise evidence.AreaNotFound(f"unknown area: {area_id}")
        borough = found[0]
        series, values, source = [], [], None
        if list(connection.execute(SERIES_TABLE_SQL))[0]["t"]:
            code = borough["id"].split(":")[-1]
            series = list(connection.execute(SERIES_SQL, (code, code)))
            values = list(connection.execute(VALUES_SQL, (borough["id"], list(METRIC_IDS))))
            if series:
                source = next(iter(connection.execute(SOURCE_SQL, (series[0]["source_release_id"],))), None)
        return rent_trend_payload(area_id, release_id, borough, series, values, source)
