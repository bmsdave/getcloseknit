"""England's regions and boxes: London only, or all of England behind CLOSE_KNIT_ENGLAND (FLAGS.md); which one a
request is served is scope.py's.

The same boxes and region names as pipelines/area-analytics-ingest/area_analytics/coverage.py (the ETLs'
list); the API keeps its own copy so it does not import the pipelines (tests/test_postgis.py checks the names
against the region rows of area_geography). Areas carry their region in area_geography.region_id (the view
area_region, migration 123); "London" ranks are computed within that region.

    coverage.rank_scope("E12000002")   # {"code": "E12000002", "name": "North West"}
"""
from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import Any

LONDON_REGION = "E12000007"
REGIONS = {
    "E12000001": "North East",
    "E12000002": "North West",
    "E12000003": "Yorkshire and The Humber",
    "E12000004": "East Midlands",
    "E12000005": "West Midlands",
    "E12000006": "East of England",
    "E12000007": "London",
    "E12000008": "South East",
    "E12000009": "South West",
}
# (south, north) latitude and (west, east) longitude. England includes the Isles of Scilly.
ENGLAND_BOX = {"latitude": (49.86, 55.82), "longitude": (-6.45, 1.77)}
LONDON_BOX = {"latitude": (51.2, 51.8), "longitude": (-0.6, 0.4)}


def region_name(code: str | None) -> str | None:
    return REGIONS.get(code) if code else None


def rank_scope(region_code: str | None) -> dict | None:
    """The payload's rankScope: the region an area's percentiles are computed in."""
    region = region_name(region_code)
    return {"code": region_code, "name": region} if region else None


# Why a measure has no value in an area (the area page's "London only" tag, DESIGN.md §6): its source reaches London
# alone and the area lies elsewhere. Any other gap (few sales, suppressed, no source anywhere) has no reason: "No data".
LONDON_ONLY = "london-only"
# TfL's data (cycle lanes, fare zones, the routing's timetables) reaches London alone (FLAGS.md CLOSE_KNIT_ENGLAND).
TFL_REGIONS = frozenset({LONDON_REGION})
# Per-home data (each sale, home and address) is London's alone (FLAGS.md CLOSE_KNIT_ENGLAND).
PER_HOME_REGIONS = frozenset({LONDON_REGION})

# Each metric's regions with a value in the active release (metric_coverage, migration 126; the catalog's coverage).
METRIC_REGIONS_SQL = """-- coverage:metric-regions
SELECT c.metric_id, array_agg(DISTINCT replace(c.scope_id, 'uk:region:', '')) AS regions
FROM metric_coverage c JOIN active_product_release active ON active.release_id = c.release_id
WHERE c.metric_id = ANY(%s) AND c.scope_id LIKE 'uk:region:%%'
GROUP BY c.metric_id"""


def reason(region: str | None, reached: Iterable[str] | None) -> str | None:
    """"london-only" when a source reaches London alone (`reached`: the regions with a value) and the area's `region`
    is elsewhere; None inside its coverage, for an unknown region, or when the source reaches nowhere or elsewhere too."""
    regions = set(reached or ())
    if region is None or region in regions or regions != {LONDON_REGION}:
        return None
    return LONDON_ONLY


def metric_regions(connection: Any, metric_ids: Sequence[str]) -> dict[str, set[str]]:
    """The region codes where each metric has a value (metric_coverage); a metric with none is left out."""
    if not metric_ids:
        return {}
    rows = connection.execute(METRIC_REGIONS_SQL, (list(metric_ids),))
    return {row["metric_id"]: set(row["regions"] or ()) for row in rows if row.get("metric_id")}
