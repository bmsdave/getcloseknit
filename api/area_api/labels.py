"""Map label points (migration 023): one per region, per borough and per postcode district.

The map draws borough names when zoomed out and "BR6 · Orpington" district
labels at mid zoom; area colours stay per LSOA. Rows are reference data that a
load replaces wholesale, so the collection is cached per active release id like
the reader's other per-release lookups."""
from typing import Any, Callable, Mapping

from . import regions
from .scope import Scope, current as current_scope
from .evidence import EvidenceReader, _active_release, _check_cancelled, plain_place_name

# With the regions (migration 123's rows): their names zoomed out, before the LADs' (DESIGN.md §6, England map).
MAP_LABELS_SQL = """-- labels:map
SELECT kind, code, label, name, postcodes, lon, lat FROM (
    SELECT kind, code, label, name, postcodes, lon, lat FROM map_label
    UNION ALL
    SELECT 'region', g.official_code, g.name, g.name, NULL, ST_X(p.point), ST_Y(p.point)
    FROM area_geography g CROSS JOIN LATERAL (SELECT ST_PointOnSurface(g.geometry) AS point) p
    WHERE g.kind::text = 'region'
) labels
ORDER BY kind, postcodes DESC NULLS LAST, code"""


def map_labels(reader: EvidenceReader, cancel: Callable[[], bool] | None = None) -> dict:
    _check_cancelled(cancel)
    with reader._connect() as connection:
        release_id = _active_release(connection, cancel)
        features = reader._cached(release_id, ("labels", "map"), lambda: _load(connection, cancel))
    served = current_scope()
    if served.regions is not None:
        region_map = regions.area_regions(reader._connect)
        features = [feature for feature in features if _served(feature, served, region_map)]
    return {"type": "FeatureCollection", "productReleaseId": release_id, "features": features}


def _served(feature: dict, served: Scope, region_map: Mapping[str, str]) -> bool:
    """The scope's labels (London's alone with CLOSE_KNIT_ENGLAND off): its regions, its boroughs and the districts
    inside its box."""
    properties = feature["properties"]
    if properties["kind"] == "region":
        return served.regions is None or properties["code"] in served.regions
    if properties["kind"] == "borough":
        return served.admits(region_map, f"uk:lad:{properties['code']}")
    lon, lat = feature["geometry"]["coordinates"]
    return served.contains(lat, lon)


def _load(connection: Any, cancel: Callable[[], bool] | None) -> list[dict]:
    _check_cancelled(cancel)
    return [{
        "type": "Feature",
        # A borough's label is its name ("Bristol", never ONS's "Bristol, City of").
        "properties": {"kind": row["kind"], "code": row["code"],
                       "label": plain_place_name(row["label"]) if row["kind"] == "borough" else row["label"],
                       "name": plain_place_name(row["name"]) if row["kind"] == "borough" else row["name"], "rank": index},
        "geometry": {"type": "Point", "coordinates": [row["lon"], row["lat"]]},
    } for index, row in enumerate(connection.execute(MAP_LABELS_SQL))]
