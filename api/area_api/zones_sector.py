"""Postcode sector pages (migration 057): GET /api/v1/sectors/{slug} and /api/v1/sectors.

A sector ("W5 1") with its district ("W5"): the £/m² distribution of 24 months
of standard sales, an annual £/m² index since 2004 (nominal and CPIH-real),
returns over 1/5/10/20 years, neighbouring sectors and its busiest streets.
Aggregates only (owner decisions 040/044): no per-home value or £/m², no
address. The migration suppresses a distribution under 20 sales, an index year
under 10 sales and a street under 5 sales; the payload only reads them.
"""
from __future__ import annotations

import json
import re
from typing import Any, Callable, Iterable, Mapping

from . import envelope, evidence, scope
from .market_depth import source_rows

SCHEMA_VERSION = "sector.v1"
SLUG_PATTERN = re.compile(r"^[A-Z]{1,2}[0-9][0-9A-Z]?-[0-9]$")
INDEX_BASE = 2004
RETURN_YEARS = (1, 5, 10, 20)
STREET_LIMIT = 12
SEARCH_LIMIT = 20
QUANTILES = ("p09", "p25", "p50", "p75", "p91")
INDEX_SERIES = (("sector", "all", "sector"), ("district", "all", "district"),
                ("borough", "house", "borough-house"), ("borough", "flat", "borough-flat"))
SOURCE_NAMES = {"hmlr-pp-sales": "HM Land Registry Price Paid", "epc": "EPC floor area",
                "mhclg-epc": "EPC floor area", "ons-cpih": "ONS CPIH", "onspd": "ONS Postcode Directory"}
CAVEATS = (
    "£/m² uses EPC floor area; sector names are informal",
    "Standard market sales (Price Paid category A) with an EPC floor area. A distribution needs 20 sales "
    "in 24 months, an index year 10 sales, a street 5 sales in 60 months; below that nothing is shown.",
    "Area aggregates only: not a valuation of any home. Real figures are deflated by the annual mean CPIH.",
    "Sector boundaries are drawn around postcode points, not official boundaries.",
)

SECTOR_SQL = """-- sector:sector
SELECT s.code, s.slug, s.name, s.district, s.borough_id, b.name AS borough_name, s.postcode_count,
  ST_AsGeoJSON(ST_SimplifyPreserveTopology(s.geometry, 0.0001), 6) AS geometry
FROM postcode_sector s LEFT JOIN area_geography b ON b.id = s.borough_id
WHERE s.code = %s/*scope:s.borough_id*/"""

DISTRIBUTION_SQL = """-- sector:distribution
SELECT zone_kind, to_char(period_end, 'YYYY-MM-DD') AS period_end, sales, p09, p25, p50, p75, p91,
  bucket_edges, bucket_counts, source_release_id
FROM zone_ppm_distribution
WHERE (zone_kind = 'sector' AND zone_code = %s) OR (zone_kind = 'district' AND zone_code = %s)"""

INDEX_SQL = """-- sector:index
SELECT zone_kind, "group", year, sales, index_nominal, index_real
FROM zone_price_index
WHERE (zone_kind = 'sector' AND zone_code = %s AND "group" = 'all')
   OR (zone_kind = 'district' AND zone_code = %s AND "group" = 'all')
   OR (zone_kind = 'borough' AND zone_code = %s AND "group" IN ('house', 'flat'))
ORDER BY year"""

NEARBY_SQL = """-- sector:nearby
SELECT n.code, n.slug, n.name, d.p25, d.p50, d.p75, d.sales
FROM postcode_sector self
JOIN postcode_sector n ON n.district = self.district OR ST_Intersects(n.geometry, self.geometry)
LEFT JOIN zone_ppm_distribution d ON d.zone_kind = 'sector' AND d.zone_code = n.code
WHERE self.code = %s/*scope:n.borough_id*/"""

STREETS_SQL = """-- sector:streets
SELECT street_name, sales_60m, median_floor_area, median_ppm
FROM zone_street WHERE sector = %s
ORDER BY sales_60m DESC, street_name LIMIT """ + str(STREET_LIMIT)

SOURCES_SQL = """-- sector:sources
SELECT DISTINCT ON (prefix) prefix, id, source_url, licence, attribution, transformation_version
FROM (SELECT substring(id FROM '^src-(hmlr-pp-sales|mhclg-epc|epc|onspd|ons-cpih)-') AS prefix, *
      FROM source_release) s
WHERE prefix IS NOT NULL
ORDER BY prefix, release_date DESC, id DESC"""

SEARCH_SQL = """-- sector:search
SELECT s.code, s.slug, s.name FROM postcode_sector s
WHERE s.code LIKE %s/*scope:s.borough_id*/
ORDER BY s.district = %s DESC, length(s.district), s.code LIMIT """ + str(SEARCH_LIMIT)

ALL_SQL = """-- sector:all
SELECT s.code, s.slug, s.name FROM postcode_sector s WHERE TRUE/*scope:s.borough_id*/ ORDER BY s.code"""

# The sectors with recorded homes (per-home data is London's, FLAGS.md CLOSE_KNIT_ENGLAND): the per-address
# sitemap shards, never an empty shard for each of England's other sectors. The range keeps it on the index.
WITH_HOMES_SQL = """-- sector:with-homes
SELECT s.code, s.slug, s.name FROM postcode_sector s
WHERE EXISTS (SELECT 1 FROM address a WHERE a.postcode BETWEEN s.code AND s.code || 'ZZ' AND a.postcode LIKE s.code || '%')
ORDER BY s.code"""


def scoped(sql: str) -> str:
    """The query cut to the served scope (FLAGS.md CLOSE_KNIT_ENGLAND): London's sectors with the flag off, every
    English sector with it on. `/*scope:<column>*/` marks where the borough column's filter goes."""
    return re.sub(r"/\*scope:([a-z_.]+)\*/", lambda m: scope.current().sql_filter(m.group(1)), sql)


def code_for_slug(slug: str) -> str | None:
    """'w5-1' -> 'W5 1'; None for anything that is not a sector slug."""
    upper = (slug or "").strip().upper()
    return upper.replace("-", " ") if SLUG_PATTERN.match(upper) else None


def _number(value: Any) -> float | None:
    return None if value is None else float(value)


def distribution_section(row: Mapping[str, Any] | None) -> dict | None:
    if row is None:
        return None
    edges, counts = list(row["bucket_edges"]), list(row["bucket_counts"])
    return {"sales": int(row["sales"]), **{key: row[key] for key in QUANTILES},
            "buckets": [{"from": edges[i], "to": edges[i + 1], "count": counts[i]} for i in range(len(counts))]}


def index_series(rows: Iterable[Mapping[str, Any]]) -> list[dict]:
    points: dict[str, list[dict]] = {zone: [] for _, _, zone in INDEX_SERIES}
    names = {(kind, group): zone for kind, group, zone in INDEX_SERIES}
    for row in rows:
        zone = names.get((row["zone_kind"], row["group"]))
        if zone:
            points[zone].append({"year": int(row["year"]), "nominal": _number(row["index_nominal"]),
                                 "real": _number(row["index_real"]), "sales": int(row["sales"])})
    return [{"zone": zone, "points": sorted(points[zone], key=lambda p: p["year"])}
            for _, _, zone in INDEX_SERIES]


def returns_rows(series: Iterable[Mapping[str, Any]]) -> list[dict]:
    """Annualised and total change (fractions: 0.032 = 3.2%) to the series' latest year,
    nominal and real; a row is left out when either end lacks an index."""
    rows = []
    for item in series:
        if item["zone"] not in ("sector", "district") or not item["points"]:
            continue
        by_year = {point["year"]: point for point in item["points"]}
        end = by_year[max(by_year)]
        for years in RETURN_YEARS:
            start = by_year.get(end["year"] - years)
            if not start or None in (start["nominal"], start["real"], end["nominal"], end["real"]):
                continue
            nominal, real = end["nominal"] / start["nominal"], end["real"] / start["real"]
            rows.append({"years": years, "zone": item["zone"],
                         "nominalPa": round(nominal ** (1 / years) - 1, 4), "realPa": round(real ** (1 / years) - 1, 4),
                         "nominalTotal": round(nominal - 1, 4), "realTotal": round(real - 1, 4)})
    return sorted(rows, key=lambda row: (row["years"], row["zone"] != "sector"))


def nearby_rows(rows: Iterable[Mapping[str, Any]], code: str) -> list[dict]:
    items = [{"code": row["code"], "slug": row["slug"], "name": row["name"], "p25": row["p25"],
              "p50": row["p50"], "p75": row["p75"], "sales": row["sales"], "isSelf": row["code"] == code}
             for row in rows]
    return sorted(items, key=lambda item: (item["p50"] is None, -(item["p50"] or 0), item["code"]))


def sector_payload(sector: Mapping[str, Any], distributions: Iterable[Mapping[str, Any]],
                   index_rows: Iterable[Mapping[str, Any]], nearby: Iterable[Mapping[str, Any]],
                   streets: Iterable[Mapping[str, Any]]) -> dict:
    by_kind = {row["zone_kind"]: row for row in distributions}
    period_end = next((row["period_end"] for row in by_kind.values()), None)
    series = index_series(index_rows)
    return {
        "sector": {"code": sector["code"], "slug": sector["slug"], "name": sector["name"],
                   "district": sector["district"],
                   "borough": {"id": sector["borough_id"], "name": sector["borough_name"]}
                   if sector["borough_id"] else None,
                   "postcodeCount": int(sector["postcode_count"]),
                   "geometry": json.loads(sector["geometry"]) if sector["geometry"] else None},
        "distribution": {"periodEnd": period_end, "sector": distribution_section(by_kind.get("sector")),
                         "district": distribution_section(by_kind.get("district"))},
        "index": {"base": INDEX_BASE, "series": series},
        "returns": returns_rows(series),
        "nearby": nearby_rows(nearby, sector["code"]),
        "streets": [{"name": row["street_name"], "sales": int(row["sales_60m"]),
                     "medianFloorArea": row["median_floor_area"], "medianPpm": row["median_ppm"]}
                    for row in streets],
    }


def sector_sources(rows: Iterable[Mapping[str, Any]]) -> list[dict]:
    rows = list(rows)
    names = [SOURCE_NAMES[row["prefix"]] for row in rows]
    return [{"sourceName": name, **source} for name, source in zip(names, source_rows(rows))]


def confidence(payload: Mapping[str, Any]) -> str:
    own = payload["distribution"]["sector"]
    if own is None:
        return "low"
    return "high" if own["sales"] >= 100 else "medium"


def sector(connect: Callable[[], Any], slug: str, cancel: Callable[[], bool] | None = None) -> dict:
    """One sector's page payload in the evidence envelope; AreaNotFound (404) otherwise."""
    evidence._check_cancelled(cancel)
    code = code_for_slug(slug)
    if code is None:
        raise evidence.AreaNotFound(f"unknown postcode sector: {slug}")
    with connect() as connection:
        release_id = evidence._active_release(connection, cancel)
        found = list(connection.execute(scoped(SECTOR_SQL), (code,)))
        if not found:
            raise evidence.AreaNotFound(f"unknown postcode sector: {slug}")
        row = found[0]
        payload = sector_payload(
            row,
            connection.execute(DISTRIBUTION_SQL, (code, row["district"])),
            connection.execute(INDEX_SQL, (code, row["district"], row["borough_id"])),
            connection.execute(scoped(NEARBY_SQL), (code,)),
            connection.execute(STREETS_SQL, (code,)))
        sources = sector_sources(connection.execute(SOURCES_SQL))
    own = payload["distribution"]["sector"]
    rows = [] if own is None else [{"kind": "sales-count", "zone": code, "periodEnd": payload["distribution"]["periodEnd"],
                                    "windowMonths": 24, "value": own["sales"]}]
    return envelope.wrap(payload, schema_version=SCHEMA_VERSION, release_id=release_id,
                         confidence=confidence(payload), evidence=rows, sources=sources, caveats=CAVEATS)


def search(connect: Callable[[], Any], q: str = "", cancel: Callable[[], bool] | None = None,
           homes: bool = False) -> list[dict]:
    """[{code, slug, name}]: sectors whose code starts with q ('W5', 'w5-1'), at most 20, the
    district's own first; with no q every sector (for the sitemap), or with `homes` only those with
    recorded homes (the per-address sitemap shards)."""
    evidence._check_cancelled(cancel)
    prefix = " ".join((q or "").upper().replace("-", " ").split())
    with connect() as connection:
        if not prefix:
            return [dict(row) for row in connection.execute(WITH_HOMES_SQL if homes else scoped(ALL_SQL))]
        if not re.fullmatch(r"[A-Z0-9 ]{1,8}", prefix):
            return []
        return [dict(row) for row in connection.execute(scoped(SEARCH_SQL), (prefix + "%", prefix))]
