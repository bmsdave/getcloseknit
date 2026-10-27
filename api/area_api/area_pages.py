"""Reads behind the area guide and ranking pages (web /area/london, /area/england, /area/{borough|msoa}/…,
/rankings/*): the borough → MSOA → LSOA tree, and one metric for every area of a
chosen carrier (the value pack only serves the metric's own carrier).

?region= (a region code such as E12000002, or any area id: that area's region) cuts every read to one
English region, so the web keeps one region in memory at a time instead of all of England."""
from typing import Any, Callable

from . import coverage, kinds, release_store
from . import regions as scope_regions
from .scope import Scope, current as current_scope
from .evidence import (
    GEOMETRY_CARRIERS,
    AreaNotFound,
    EvidenceReader,
    MalformedQuery,
    _active_release,
    _check_cancelled,
    _friendly,
    _summary,
    _validate_period_format,
)

# Schools are counted inside borough and MSOA boundaries; LSOAs carry none.
HIERARCHY_SQL = """-- area-pages:hierarchy
SELECT g.id, g.name, g.kind::text AS carrier, """ + kinds.PARENT_SQL + """ AS parent_id,
  l.friendly_name, l.postcode_district,
  count(s.urn) FILTER (WHERE s.phase = 'primary') AS primary_count,
  count(s.urn) FILTER (WHERE s.phase = 'secondary') AS secondary_count
FROM area_geography g
LEFT JOIN area_label l ON l.geography_id = g.id
LEFT JOIN school s ON g.kind <> 'lsoa' AND ST_Contains(g.geometry, s.location)
WHERE g.kind::text IN """ + kinds.SQL_LIST + """
GROUP BY g.id, g.name, g.kind, g.parent_id, l.friendly_name, l.postcode_district
ORDER BY g.id"""

SCHOOLS_LOADED_SQL = """-- area-pages:schools-loaded
SELECT EXISTS (SELECT 1 FROM school) AS loaded"""

CARRIER_VALUES_SQL = """-- area-pages:carrier-values
SELECT v.geography_id, g.name, g.kind::text AS carrier, v.metric_id,
  to_char(v.period, 'YYYY-MM') AS period, v.value,
  v.region_percentile, v.country_percentile, v.sample_count,
  v.quality::text AS quality, v.source_release_id
FROM active_product_release active
JOIN product_release_member member ON member.release_id = active.release_id
JOIN metric_value v ON v.source_release_id = member.source_release_id
JOIN area_geography g ON g.id = v.geography_id
WHERE v.metric_id = %s AND v.period = to_date(%s, 'YYYY-MM') AND g.kind::text = %s
ORDER BY v.geography_id"""

REGIONS_SQL = """-- area-pages:regions
SELECT area_id, region_code FROM area_region"""

_NO_GEOGRAPHY = {"id": None, "name": ""}


def _regions(reader: EvidenceReader, connection: Any, release_id: str) -> dict[str, str]:
    """Every area's region code (area_region, migration 103), kept per release (release_artifact)."""
    return release_store.cached(connection, release_id, ("area-pages", "regions"), lambda: {
        row["area_id"]: row["region_code"] for row in connection.execute(REGIONS_SQL)})


def _region_code(region: str | None, regions: dict[str, str]) -> str | None:
    """A region code from ?region=: a code as given, an area id as its area's region; None for no filter."""
    if not region:
        return None
    if region in coverage.REGIONS:
        return region
    if region in regions:
        return regions[region]
    if region.startswith("uk:"):
        raise AreaNotFound(f"unknown area: {region}")
    raise MalformedQuery(f"invalid region: {region}")


def hierarchy(reader: EvidenceReader, cancel: Callable[[], bool] | None = None,
              region: str | None = None, carrier: str | None = None) -> dict:
    """Every borough, MSOA and LSOA with its parent and region; state schools inside each
    borough and MSOA (null when no schools are loaded: unknown, never zero). `region` keeps one
    region (named in "region"), `carrier` one level."""
    carrier = kinds.normalise(carrier)
    if carrier and carrier not in GEOMETRY_CARRIERS:
        raise MalformedQuery(f"invalid carrier: {carrier}")
    with reader._connect() as connection:
        release_id = _active_release(connection, cancel)
        regions = _regions(reader, connection, release_id)
        # The scope's areas: London's alone with CLOSE_KNIT_ENGLAND off.
        areas = _hierarchy(reader, connection, release_id, cancel, regions, current_scope())
    code = _region_code(region, regions)
    if code or carrier:
        areas = [area for area in areas
                 if (code is None or area["regionCode"] == code) and (not carrier or area["carrier"] == carrier)]
    body = {"schemaVersion": "area-hierarchy.v1", "productReleaseId": release_id, "areas": areas}
    if code:
        body["region"] = coverage.rank_scope(code)
    return body


def trail(reader: EvidenceReader, area_id: str, cancel: Callable[[], bool] | None = None) -> dict:
    """An area and every area above it, root (borough) first, for a page's breadcrumbs: a few rows of the
    hierarchy instead of its region's whole list (≈1.5 MB). Empty outside the served regions, like ?region=."""
    with reader._connect() as connection:
        release_id = _active_release(connection, cancel)
        regions = _regions(reader, connection, release_id)
        by_id = release_store.cached(connection, release_id, ("area-pages", "trail-index", regions.get(area_id)),
                                     lambda: _trail_index(reader, connection, release_id, cancel, regions, regions.get(area_id)))
    if area_id not in by_id:
        raise AreaNotFound(f"unknown area: {area_id}")
    areas: list[dict] = []
    if current_scope().admits(regions, area_id):
        area: dict | None = by_id[area_id]
        while area is not None and len(areas) < 8:  # borough › MSOA › LSOA; the cap guards a parent loop
            areas.insert(0, area)
            area = by_id.get(area["parentId"]) if area["parentId"] else None
    body = {"schemaVersion": "area-hierarchy.v1", "productReleaseId": release_id, "areas": areas}
    code = regions.get(area_id)
    if code:
        body["region"] = coverage.rank_scope(code)
    return body


def build(reader: EvidenceReader) -> list[str]:
    """The area tree for the release (release_build): every area's region, the scope's hierarchy (cold ~1.5 s: every
    school counted inside every borough and MSOA) and each region's trail index; the region codes."""
    hierarchy(reader)
    with reader._connect() as connection:
        release_id = _active_release(connection, None)
        regions = _regions(reader, connection, release_id)
        codes = sorted(set(regions.values()))
        for code in codes:
            release_store.cached(connection, release_id, ("area-pages", "trail-index", code),
                                 lambda code=code: _trail_index(reader, connection, release_id, None, regions, code))
    return codes


def _hierarchy(reader: EvidenceReader, connection: Any, release_id: str, cancel: Callable[[], bool] | None,
               regions: dict[str, str], served: Scope | None = None) -> list[dict]:
    """Every area of the hierarchy, or the scope's, kept per release (release_artifact, built by release_build)."""
    key = ("area-pages", "hierarchy", served.regions if served else None)
    return release_store.cached(connection, release_id, key, lambda: _load_hierarchy(connection, cancel, regions, served))


def _trail_index(reader: EvidenceReader, connection: Any, release_id: str, cancel: Callable[[], bool] | None,
                 regions: dict[str, str], code: str | None) -> dict[str, dict]:
    """The hierarchy's areas of one region (`code`; None: the areas without one) and every area above them, by id:
    what a trail walks, a region's share of the whole list."""
    every = {area["geographyId"]: area for area in _hierarchy(reader, connection, release_id, cancel, regions)}
    kept: dict[str, dict] = {}
    for area_id, area in every.items():
        if regions.get(area_id) != code:
            continue
        step: dict | None = area
        for _ in range(8):  # as trail(): borough › MSOA › LSOA, the cap guards a parent loop
            if step is None:
                break
            kept[step["geographyId"]] = step
            step = every.get(step["parentId"]) if step["parentId"] else None
    return kept


def _load_hierarchy(connection: Any, cancel: Callable[[], bool] | None, regions: dict[str, str],
                    served: Scope | None) -> list[dict]:
    _check_cancelled(cancel)
    loaded = bool(list(connection.execute(SCHOOLS_LOADED_SQL))[0]["loaded"])
    _check_cancelled(cancel)
    return [{
        "geographyId": row["id"], "name": row["name"], "carrier": row["carrier"],
        "parentId": row["parent_id"], "regionCode": regions.get(row["id"]),
        **_friendly(row),
        "schools": ({"primary": row["primary_count"], "secondary": row["secondary_count"]}
                    if loaded and row["carrier"] != "lsoa" else None),
    } for row in connection.execute(served.rows(HIERARCHY_SQL, "id", order="id") if served else HIERARCHY_SQL)]


def in_region(reader: EvidenceReader, pack: dict, region: str | None,
              cancel: Callable[[], bool] | None = None) -> dict:
    """A value pack cut to one region's areas (?region=); the pack itself when no region is asked for."""
    if not region:
        return pack
    with reader._connect() as connection:
        regions = _regions(reader, connection, _active_release(connection, cancel))
    code = _region_code(region, regions)
    return {**pack, "region": coverage.rank_scope(code),
            "values": [entry for entry in pack["values"] if regions.get(entry["geographyId"]) == code]}


def carrier_values(reader: EvidenceReader, metric_id: str, period: str, carrier: str,
                   cancel: Callable[[], bool] | None = None) -> dict:
    """A value pack for one metric at a chosen carrier (crime is loaded for
    LSOAs, MSOAs and boroughs; the value pack only serves LSOAs)."""
    _check_cancelled(cancel)
    carrier = kinds.normalise(carrier)
    if carrier not in GEOMETRY_CARRIERS:
        raise MalformedQuery(f"invalid carrier: {carrier}")
    _validate_period_format(period)
    with reader._connect() as connection:
        release_id = _active_release(connection, cancel)
    served = current_scope()
    return reader._cached_pack(
        (release_id, metric_id, period, carrier, served.regions),
        lambda: _build(reader, release_id, metric_id, period, carrier, cancel, served))


def _build(reader: EvidenceReader, release_id: str, metric_id: str, period: str, carrier: str,
           cancel: Callable[[], bool] | None, served: Scope) -> dict:
    with reader._connect() as connection:
        metric = reader._metric_for_release(connection, release_id, metric_id)
        reader._check_release_period(connection, release_id, metric_id, period, cancel)
        rows = list(connection.execute(served.rows(CARRIER_VALUES_SQL, order="geography_id"), (metric_id, period, carrier)))
        region_map = scope_regions.area_regions_on(connection)
        return {
            "schemaVersion": "area-value-pack.v1",
            "metricId": metric_id,
            "period": period,
            "carrier": carrier,
            "sourceVersion": metric["source_release_id"],
            "productReleaseId": release_id,
            "values": [_summary(_NO_GEOGRAPHY, metric, period, row, region_map=region_map) for row in rows],
        }
