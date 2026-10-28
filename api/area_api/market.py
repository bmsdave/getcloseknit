"""Local market by property type: sale-price summary, percentiles, 10-year
trend and the recent sales list (HM Land Registry Price Paid, category A).

Aggregates come from `area_market` and the list from `area_recent_sale`
(migration 016, filled by pipelines/.../area_analytics/market_load.py). An
LSOA with fewer than MIN_AREA_SALES sales in the latest 12 months is widened
to its MSOA, then its borough; the payload names the area actually used.
Missing values stay null ("unknown"), never 0.
"""
from __future__ import annotations

import re
from datetime import date as Date
from typing import Any, Callable, Mapping

from . import coverage, kinds, regions
from .evidence import AreaNotFound, MalformedQuery, _active_release, _check_cancelled

MIN_AREA_SALES = 10
PROPERTY_TYPES = ("D", "S", "T", "F", "O")
RECENT_MONTHS = 18
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 50
# Paging deeper than this is a scrape, not a reader: 20 x 50 = the newest 1000 sales.
MAX_PAGE = 20
SORTS = ("nearest", "newest")
AREA_PATTERN = re.compile(r"^uk:(lsoa|msoa|lad):E0[0-9]{7}$")
CARRIER_COLUMNS = {"lsoa": "lsoa_id", "msoa": "msoa_id", kinds.LAD: "borough_id"}

# The area and its parents, nearest first.
CHAIN_SQL = """-- market:chain
WITH RECURSIVE chain AS (
  SELECT id, kind::text AS carrier, name, parent_id, 0 AS depth FROM area_geography WHERE id = %s
  UNION ALL
  SELECT g.id, g.kind::text, g.name, g.parent_id, c.depth + 1
  FROM area_geography g JOIN chain c ON g.id = c.parent_id
)
SELECT id, carrier, name, depth FROM chain ORDER BY depth"""

MARKET_SQL = """-- market:rows
SELECT m.geography_id, m.property_type, to_char(m.window_end, 'YYYY-MM') AS window_end, m.sales,
  m.median_price, m.p5, m.p25, m.p75, m.p95, m.min_price, m.max_price, m.ppm_sales, m.median_ppm,
  m.source_release_id, s.attribution
FROM area_market m JOIN source_release s ON s.id = m.source_release_id
WHERE m.geography_id = ANY(%s)
ORDER BY m.geography_id, m.property_type, m.window_end"""

RECENT_SQL = """-- market:recent-sales
WITH area AS (SELECT ST_PointOnSurface(geometry)::geography AS point FROM area_geography WHERE id = %(area)s),
found AS (
  SELECT r.transaction_id, to_char(r.completion_date, 'YYYY-MM-DD') AS date, r.display_address,
    r.postcode, r.property_type, r.tenure, r.new_build, r.price,
    round(ST_Distance(r.location, area.point))::integer AS distance_metres, r.source_release_id
  FROM area_recent_sale r CROSS JOIN area
  WHERE r.{column} = %(area)s
    AND NOT EXISTS (SELECT 1 FROM suppressed_dwelling d
                    WHERE d.address_id = r.address_id OR (r.uprn IS NOT NULL AND d.uprn = r.uprn))
)
SELECT * FROM found
ORDER BY {order}
LIMIT %(limit)s OFFSET %(offset)s"""

RECENT_COUNT_SQL = """-- market:recent-count
SELECT count(*) FILTER (WHERE r.{column} = %(area)s
    AND NOT EXISTS (SELECT 1 FROM suppressed_dwelling d
                    WHERE d.address_id = r.address_id OR (r.uprn IS NOT NULL AND d.uprn = r.uprn))) AS total,
  to_char(min(r.completion_date), 'YYYY-MM-DD') AS since,
  to_char(max(r.completion_date), 'YYYY-MM-DD') AS until
FROM area_recent_sale r"""

# Sales after a date (a saved area's "since your last visit" line), same privacy filter.
SINCE_SQL = """-- market:since
SELECT count(*) FILTER (WHERE r.completion_date > %(date)s::date) AS new_sales,
  to_char(max(r.completion_date), 'YYYY-MM-DD') AS newest
FROM area_recent_sale r
WHERE r.{column} = %(area)s
  AND NOT EXISTS (SELECT 1 FROM suppressed_dwelling d
                  WHERE d.address_id = r.address_id OR (r.uprn IS NOT NULL AND d.uprn = r.uprn))"""

ORDERS = {
    "nearest": "distance_metres NULLS LAST, date DESC, transaction_id",
    "newest": "date DESC, distance_metres NULLS LAST, transaction_id",
}

CAVEATS = (
    "Standard sales only (Price Paid category A) of £10,000 or more; repossessions, "
    "company and buy-to-let transfers are left out.",
    "Sales reach the register weeks to months after completion, so the newest months are incomplete.",
    "£ per m² uses only sales whose home has an energy certificate with a floor area.",
)


def _stats(property_type: str, row: Mapping[str, Any] | None) -> dict:
    def number(key: str):
        return None if row is None or row[key] is None else row[key]
    ppm = number("median_ppm")
    return {
        "propertyType": property_type,
        "sales": row["sales"] if row else 0,
        "medianPrice": number("median_price"),
        "p5": number("p5"), "p25": number("p25"), "p75": number("p75"), "p95": number("p95"),
        "minPrice": number("min_price"), "maxPrice": number("max_price"),
        "pricePerSquareMetreSales": row["ppm_sales"] if row else 0,
        "medianPricePerSquareMetre": None if ppm is None else round(float(ppm), 2),
    }


def _validate_area(area_id: str) -> None:
    if not AREA_PATTERN.match(area_id or ""):
        raise MalformedQuery(f"invalid area id: {area_id}")


def _chain(connection: Any, area_id: str) -> list[Mapping[str, Any]]:
    chain = list(connection.execute(CHAIN_SQL, (area_id,)))
    if not chain:
        raise AreaNotFound(f"unknown area: {area_id}")
    return chain


def _basis(chain: list[Mapping[str, Any]], rows: list[Mapping[str, Any]]):
    """The first area of the chain with MIN_AREA_SALES sales in the latest window."""
    latest = max((row["window_end"] for row in rows), default=None)
    totals = {row["geography_id"]: row["sales"] for row in rows
              if row["property_type"] == "all" and row["window_end"] == latest}
    with_sales = [area for area in chain if totals.get(area["id"], 0) > 0]
    chosen = next((area for area in chain if totals.get(area["id"], 0) >= MIN_AREA_SALES),
                  with_sales[-1] if with_sales else None)
    return chosen, latest


def _basis_payload(area: Mapping[str, Any], requested: str) -> dict:
    return {"geographyId": area["id"], "name": area["name"], "carrier": area["carrier"],
            "widened": area["id"] != requested, "minimumSales": MIN_AREA_SALES}


def _window_start(end: str) -> str:
    year, month = (int(part) for part in end.split("-"))
    month -= 11
    if month < 1:
        year, month = year - 1, month + 12
    return f"{year:04d}-{month:02d}"


def _trend(rows: list[Mapping[str, Any]], latest: str) -> list[dict]:
    year, month = latest.split("-")
    ends = [f"{int(year) - back:04d}-{month}" for back in range(10, -1, -1)]
    by_key = {(row["property_type"], row["window_end"]): row for row in rows}
    series = []
    for kind in ("all", *PROPERTY_TYPES):
        points = []
        for end in ends:
            row = by_key.get((kind, end))
            ppm = None if row is None or row["median_ppm"] is None else round(float(row["median_ppm"]), 2)
            points.append({"windowEnd": end, "sales": row["sales"] if row else 0,
                           "medianPrice": row["median_price"] if row else None,
                           "medianPricePerSquareMetre": ppm})
        series.append({"propertyType": kind, "points": points})
    return series


def area_market(reader: Any, area_id: str, cancel: Callable[[], bool] | None = None) -> dict:
    """Latest 12 months by property type, plus the ten years before."""
    _check_cancelled(cancel)
    _validate_area(area_id)
    with reader._connect() as connection:
        release_id = _active_release(connection, cancel)
        chain = _chain(connection, area_id)
        _check_cancelled(cancel)
        rows = list(connection.execute(MARKET_SQL, ([area["id"] for area in chain],)))
        basis, latest = _basis(chain, rows)
        payload = {"schemaVersion": "area-market-by-type.v1", "productReleaseId": release_id,
                   "geographyId": area_id, "name": chain[0]["name"], "available": basis is not None,
                   "caveats": list(CAVEATS)}
        if basis is None:
            return {**payload, "basis": None, "window": None, "summary": None, "byType": [], "trend": [],
                    "sourceVersion": None, "attribution": None}
        own = [row for row in rows if row["geography_id"] == basis["id"]]
        current = {row["property_type"]: row for row in own if row["window_end"] == latest}
        return {
            **payload,
            "basis": _basis_payload(basis, area_id),
            "window": {"start": _window_start(latest), "end": latest},
            "summary": _stats("all", current.get("all")),
            "byType": [_stats(kind, current.get(kind)) for kind in PROPERTY_TYPES],
            "trend": _trend(own, latest),
            "sourceVersion": own[0]["source_release_id"],
            "attribution": own[0]["attribution"],
        }


def _page_arguments(page: int, page_size: int, sort: str) -> None:
    if not 1 <= page <= MAX_PAGE:
        raise MalformedQuery(f"page must be between 1 and {MAX_PAGE}")
    if not 1 <= page_size <= MAX_PAGE_SIZE:
        raise MalformedQuery(f"pageSize must be between 1 and {MAX_PAGE_SIZE}")
    if sort not in SORTS:
        raise MalformedQuery(f"sort must be one of {', '.join(SORTS)}")


def recent_sales(reader: Any, area_id: str, page: int = 1, page_size: int = DEFAULT_PAGE_SIZE,
                 sort: str = "nearest", cancel: Callable[[], bool] | None = None) -> dict:
    """Sales of the last 18 months in the same area the market summary uses."""
    _check_cancelled(cancel)
    _validate_area(area_id)
    _page_arguments(page, page_size, sort)
    with reader._connect() as connection:
        release_id = _active_release(connection, cancel)
        chain = _chain(connection, area_id)
        _check_cancelled(cancel)
        rows = list(connection.execute(MARKET_SQL, ([area["id"] for area in chain],)))
        basis, _ = _basis(chain, rows)
        area = basis or chain[0]
        _check_cancelled(cancel)
        column = CARRIER_COLUMNS[area["carrier"]]
        counts = list(connection.execute(RECENT_COUNT_SQL.format(column=column), {"area": area["id"]}))
        counts = counts[0] if counts else {"total": 0, "since": None, "until": None}
        found = list(connection.execute(RECENT_SQL.format(column=column, order=ORDERS[sort]),
                                        {"area": area["id"], "limit": page_size,
                                         "offset": (page - 1) * page_size}))
        # Each sale is per-home data, London's alone: elsewhere the page says "London only", never "no sales".
        why = coverage.reason(regions.area_regions_on(connection).get(area_id), coverage.PER_HOME_REGIONS)
        return {
            "schemaVersion": "area-recent-sales.v1",
            "productReleaseId": release_id,
            "geographyId": area_id,
            "basis": _basis_payload(area, area_id),
            "months": RECENT_MONTHS,
            "since": counts["since"],
            "until": counts["until"],
            "sort": sort,
            "page": page,
            "pageSize": page_size,
            "total": counts["total"],
            "sales": [{
                "transactionId": row["transaction_id"], "date": row["date"],
                "address": row["display_address"], "postcode": row["postcode"],
                "propertyType": row["property_type"], "tenure": row["tenure"],
                "newBuild": bool(row["new_build"]), "price": row["price"],
                "distanceMetres": row["distance_metres"],
            } for row in found],
            "sourceVersion": found[0]["source_release_id"] if found else None,
            "coverage": why,
        }


def _since_date(value: str) -> str:
    try:
        return Date.fromisoformat(value or "").isoformat()
    except ValueError:
        raise MalformedQuery("date must be YYYY-MM-DD") from None


def area_since(reader: Any, area_id: str, date: str, cancel: Callable[[], bool] | None = None) -> dict:
    """What changed in an area after `date`: standard sales completed since then, in the same area the
    market summary uses, and today's median £ per m². The £ per m² is the area view's Price tile (the figure
    Saved shows on the same row; standouts.price_tile), never the market summary's widened median, so the move and
    the price beside it are one series. The client keeps the £ per m² it saw last time, so a price move is today's
    figure against that; nothing about a visit is sent or stored here."""
    _check_cancelled(cancel)
    _validate_area(area_id)
    since = _since_date(date)
    with reader._connect() as connection:
        release_id = _active_release(connection, cancel)
        chain = _chain(connection, area_id)
        _check_cancelled(cancel)
        rows = list(connection.execute(MARKET_SQL, ([area["id"] for area in chain],)))
        basis, latest = _basis(chain, rows)
        area = basis or chain[0]
        _check_cancelled(cancel)
        found = list(connection.execute(SINCE_SQL.format(column=CARRIER_COLUMNS[area["carrier"]]),
                                        {"area": area["id"], "date": since}))
        counts = found[0] if found else {"new_sales": 0, "newest": None}
        current = next((row for row in rows if row["geography_id"] == area["id"] and row["property_type"] == "all"
                        and row["window_end"] == latest), None)
    from . import standouts  # here: standouts reads evidence, which reads this module
    tile = standouts.price_tile(reader, area_id, cancel)
    return {
        "schemaVersion": "area-since.v1",
        "productReleaseId": release_id,
        "geographyId": area_id,
        "date": since,
        "basis": _basis_payload(area, area_id),
        "months": RECENT_MONTHS,
        "newSales": counts["new_sales"] or 0,
        "newestSale": counts["newest"],
        # The Price tile's figure and its month: a move counts only once that month has moved on.
        "pricePerSquareMetre": {
            "median": tile["value"] if tile else None,
            "windowEnd": tile["period"] if tile else None,
            "sales": tile["sales"] if tile else None,
        },
        "sourceVersion": current["source_release_id"] if current else None,
        "attribution": current["attribution"] if current else None,
        "caveats": [*CAVEATS, f"Only sales of the last {RECENT_MONTHS} months are counted.",
                    "£ per m² is the area's Price tile: the 12-month median sold price ÷ EPC floor area, as on the area page."],
    }
