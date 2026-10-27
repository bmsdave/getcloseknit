"""England's regions and boxes: London only, or all of England behind CLOSE_KNIT_ENGLAND (FLAGS.md); which one a
request is served is scope.py's.

The same boxes and region names as pipelines/area-analytics-ingest/area_analytics/coverage.py (the ETLs'
list); the API keeps its own copy so it does not import the pipelines (tests/test_postgis.py checks the names
against the region rows of area_geography). Areas carry their region in area_geography.region_id (the view
area_region, migration 123); "London" ranks are computed within that region.

    coverage.rank_scope("E12000002")   # {"code": "E12000002", "name": "North West"}
"""
from __future__ import annotations

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
