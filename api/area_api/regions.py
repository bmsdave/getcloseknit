"""The region each area's percentiles are computed in (area_region, migration 103), and the regions a request covers.

Every "London" percentile, rank and median is computed within the area's region, so a London area keeps its
London numbers and a Leeds one is ranked within Yorkshire and The Humber. Payloads keep their field names
(regionPercentile, regionMedian...) and add rankScope {code, name} saying which region that is.

A request's scope (London alone with CLOSE_KNIT_ENGLAND off, England or some of its regions with it on) is
scope.py's.

The area -> region map is small (about 41,000 rows for England) and changes only with a geography release,
so it is loaded once and kept for REGIONS_TTL_SECONDS. Without the table (before migration 103) it is empty:
rankScope is null and nothing is filtered.
"""
from __future__ import annotations

import threading
import time
from typing import Any, Callable, Mapping

from . import coverage

REGIONS_SQL = """-- regions:area-regions
SELECT area_id, region_code FROM area_region"""
REGIONS_TTL_SECONDS = 600.0
FAILED_TTL_SECONDS = 30.0  # a failed load is retried soon, not kept for the full TTL

_lock = threading.Lock()
_cache: tuple[float, dict[str, str]] | None = None


def clear_cache() -> None:
    global _cache
    with _lock:
        _cache = None


def set_for_tests(region_map: Mapping[str, str]) -> None:
    """Use this map until the cache expires or is cleared (tests: no fake connection sees the query)."""
    global _cache
    with _lock:
        _cache = (time.monotonic(), dict(region_map))


def _read(connection: Any) -> dict[str, str] | None:
    """The map from an open connection; None without the table. A savepoint keeps a missing table from
    poisoning the caller's transaction."""
    try:
        savepoint = getattr(connection, "transaction", None)
        if savepoint is not None:
            with savepoint():
                return {row["area_id"]: row["region_code"] for row in connection.execute(REGIONS_SQL)}
        return {row["area_id"]: row["region_code"] for row in connection.execute(REGIONS_SQL)}
    except Exception:  # noqa: BLE001 - no area_region yet (migration 103) is a normal state: no rankScope
        return None


def _load(connect: Callable[[], Any]) -> dict[str, str] | None:
    try:
        with connect() as connection:
            return _read(connection)
    except Exception:  # noqa: BLE001 - no database: no rankScope, nothing filtered
        return None


def _cached(load: Callable[[], dict[str, str] | None]) -> dict[str, str]:
    global _cache
    now = time.monotonic()
    with _lock:
        if _cache is not None and now - _cache[0] < REGIONS_TTL_SECONDS:
            return _cache[1]
    regions = load()
    with _lock:
        _cache = (now, regions) if regions is not None else (now - REGIONS_TTL_SECONDS + FAILED_TTL_SECONDS, {})
    return regions or {}


def area_regions(connect: Callable[[], Any]) -> dict[str, str]:
    """area id -> region code (E12000001..E12000009), cached for REGIONS_TTL_SECONDS."""
    return _cached(lambda: _load(connect))


def area_regions_on(connection: Any) -> dict[str, str]:
    """The same map, read through a connection the caller already holds."""
    return _cached(lambda: _read(connection))


def region_of(connect: Callable[[], Any], area_id: str | None) -> str | None:
    return area_regions(connect).get(area_id) if area_id else None


def rank_scope(connect: Callable[[], Any], area_id: str | None) -> dict | None:
    """{code, name} of the region the area's percentiles are computed in; None for an unknown area."""
    return coverage.rank_scope(region_of(connect, area_id))


def with_rank_scope(payload: Any, connect: Callable[[], Any], area_id: str | None) -> Any:
    """The payload with rankScope added (a dict payload only; anything else comes back as it is)."""
    if not isinstance(payload, dict):
        return payload
    return {**payload, "rankScope": rank_scope(connect, area_id)}
