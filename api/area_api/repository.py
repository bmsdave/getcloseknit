import contextlib
import copy
import datetime
import json
import logging
import os
import threading
from typing import Any, Callable, Iterator, Mapping

from . import feature_flags, kinds, personal_places, quick_criteria, regions
from .scope import Scope, current as current_scope
from .privacy import analytics_event

logger = logging.getLogger(__name__)


EVIDENCE_SQL = """
SELECT combined.geography_id, geography.name, combined.factor_id,
  combined.raw_value, combined.utility,
  combined.unit, combined.carrier_geography_id,
  combined.quality::text AS quality,
  combined.source_release_id, active.release_id AS product_release_id
FROM active_product_release active, (
  SELECT fu.geography_id, fu.factor_id, fu.raw_value, fu.utility,
    fu.unit, fu.carrier_geography_id, fu.quality, fu.source_release_id,
    fu.period
  FROM product_release_member member
  JOIN factor_utility fu ON fu.source_release_id = member.source_release_id
  WHERE member.release_id = (SELECT release_id FROM active_product_release)
  UNION ALL
  SELECT mv.geography_id, 'deprivation', mv.value, mv.region_percentile,
    'decile', mv.geography_id, mv.quality, mv.source_release_id,
    mv.period
  FROM product_release_member member
  JOIN metric_value mv ON mv.source_release_id = member.source_release_id
  WHERE member.release_id = (SELECT release_id FROM active_product_release)
    AND mv.metric_id = 'deprivation' AND mv.value IS NOT NULL
    AND mv.region_percentile IS NOT NULL
  UNION ALL
  SELECT mv.geography_id, 'social-renting', mv.value, mv.region_percentile,
    '%%', mv.geography_id, mv.quality, mv.source_release_id,
    mv.period
  FROM product_release_member member
  JOIN metric_value mv ON mv.source_release_id = member.source_release_id
  WHERE member.release_id = (SELECT release_id FROM active_product_release)
    AND mv.metric_id = 'social-renting' AND mv.value IS NOT NULL
    AND mv.region_percentile IS NOT NULL
  UNION ALL
  SELECT child.id, 'income', mv.value, mv.region_percentile,
    '£/year', mv.geography_id, 'fallback', mv.source_release_id,
    mv.period
  FROM product_release_member member
  JOIN metric_value mv ON mv.source_release_id = member.source_release_id
  JOIN area_geography child ON child.parent_id = mv.geography_id
  WHERE member.release_id = (SELECT release_id FROM active_product_release)
    AND mv.metric_id = 'income' AND mv.value IS NOT NULL
    AND mv.region_percentile IS NOT NULL
    AND child.kind = 'lsoa'
  UNION ALL
  SELECT mv.geography_id, 'market-level', mv.value, mv.region_percentile,
    '£/m²', mv.geography_id, mv.quality, mv.source_release_id,
    mv.period
  FROM product_release_member member
  JOIN metric_value mv ON mv.source_release_id = member.source_release_id
  WHERE member.release_id = (SELECT release_id FROM active_product_release)
    AND mv.metric_id = 'price-per-square-metre' AND mv.value IS NOT NULL
    AND mv.region_percentile IS NOT NULL
    AND mv.period = (SELECT MAX(period) FROM metric_value
      WHERE metric_id = 'price-per-square-metre')
) AS combined
JOIN area_geography geography ON geography.id = combined.geography_id
WHERE geography.kind = 'lsoa' AND combined.factor_id = ANY(%s)
ORDER BY combined.period DESC
"""
_EVIDENCE_WHERE = "WHERE geography.kind = 'lsoa' AND combined.factor_id = ANY(%s)"


def evidence_sql(served: Scope) -> str:
    """EVIDENCE_SQL for the LSOAs of the scope only, filtered in the database."""
    return EVIDENCE_SQL.replace(_EVIDENCE_WHERE, _EVIDENCE_WHERE + served.sql_filter("geography.id"))


class ReleaseActivationError(RuntimeError):
    pass


class ReleaseSnapshot:
    def __init__(self, store: "ReleaseStore", release_id: str) -> None:
        self._store = store
        self.release_id = release_id

    def fetch(self) -> list[dict]:
        return self._store._rows_for(self.release_id)

    def to_shared_link(self) -> dict:
        return {"productReleaseId": self.release_id, "rows": self.fetch()}


class ReleaseStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._staged: dict[str, dict] = {}
        self._evidence: dict[str, list[dict]] = {}
        self._active_id: str | None = None
        self._previous_id: str | None = None
        self._activations: list[dict] = []

    def stage_release(self, manifest: Mapping[str, Any]) -> str:
        _check_shape(manifest)
        with self._lock:
            if manifest["id"] in self._staged:
                raise ReleaseActivationError(f"release already staged: {manifest['id']}")
            self._staged[manifest["id"]] = copy.deepcopy(dict(manifest))
            return manifest["id"]

    def attach_evidence(self, release_id: str, rows: list[dict]) -> None:
        with self._lock:
            self._require_staged(release_id)
            self._evidence.setdefault(release_id, []).extend(copy.deepcopy(rows))

    def import_release(
        self,
        manifest: Mapping[str, Any],
        chunks: list[list[dict]],
        fail_at: int | None = None,
    ) -> str:
        _check_shape(manifest)
        staged: list[dict] = []
        for index, chunk in enumerate(chunks):
            if fail_at is not None and index == fail_at:
                raise ReleaseActivationError("import interrupted; staged rows discarded")
            staged.extend(copy.deepcopy(chunk))
        with self._lock:
            self._staged[manifest["id"]] = copy.deepcopy(dict(manifest))
            self._evidence[manifest["id"]] = staged
            return manifest["id"]

    def activate_release(self, release_id: str) -> dict:
        with self._lock:
            self._require_staged(release_id)
            _check_manifest(self._staged[release_id])
            record = {"release_id": release_id, "previous_release_id": self._active_id}
            self._previous_id = self._active_id
            self._active_id = release_id
            self._activations.append(record)
            return dict(record)

    def rollback(self) -> dict:
        with self._lock:
            if self._previous_id is None:
                raise ReleaseActivationError("no previous release to roll back to")
            record = {"release_id": self._previous_id, "previous_release_id": self._active_id}
            self._previous_id = self._active_id
            self._active_id = record["release_id"]
            self._activations.append(record)
            return dict(record)

    def begin_read(self) -> ReleaseSnapshot:
        with self._lock:
            if self._active_id is None:
                raise ReleaseActivationError("no active release")
            return ReleaseSnapshot(self, self._active_id)

    def read_release(self, release_id: str) -> ReleaseSnapshot:
        with self._lock:
            self._require_staged(release_id)
            return ReleaseSnapshot(self, release_id)

    def active_release_id(self) -> str | None:
        with self._lock:
            return self._active_id

    def activation_log(self) -> list[dict]:
        with self._lock:
            return [dict(record) for record in self._activations]

    def _require_staged(self, release_id: str) -> None:
        if release_id not in self._staged:
            raise ReleaseActivationError(f"release is not staged: {release_id}")

    def _rows_for(self, release_id: str) -> list[dict]:
        with self._lock:
            if release_id not in self._staged:
                raise ReleaseActivationError(f"release is not staged: {release_id}")
            return copy.deepcopy(self._evidence.get(release_id, []))


def _check_shape(manifest: Mapping[str, Any]) -> None:
    for field in ("id", "members", "validationStatus"):
        if field not in manifest:
            raise ReleaseActivationError(f"release manifest missing: {field}")
    if not manifest["members"]:
        raise ReleaseActivationError("release manifest members must be non-empty")


def _check_manifest(manifest: Mapping[str, Any]) -> None:
    _check_shape(manifest)
    for member in manifest["members"]:
        if member.get("validationStatus") != "passed":
            raise ReleaseActivationError("release member validation status must be passed")
    if manifest["validationStatus"] != "passed":
        raise ReleaseActivationError("release validation status must be passed")


_TITLES: dict[str, dict[str, str]] = {}


def area_titles() -> dict[str, str]:
    """Friendly titles ("Gillespie Road · N5") for every labelled area, read once per product release.
    Empty when the labels table is missing or the database is unavailable: titles are an extra."""
    try:
        with _pool().connection() as connection:
            release = list(connection.execute("SELECT release_id FROM active_product_release"))
            key = release[0]["release_id"] if release else ""
            if key not in _TITLES:
                from .evidence import friendly_title
                _TITLES.clear()
                _TITLES[key] = {row["geography_id"]: title for row in connection.execute(
                    "SELECT geography_id, friendly_name, postcode_district FROM area_label")
                    if (title := friendly_title(row["friendly_name"], row["postcode_district"]))}
            return _TITLES[key]
    except Exception:  # noqa: BLE001 - titles never block a match
        return {}


def match_sources(profile: Mapping[str, Any]) -> dict:
    """What a profile's criteria read (v1 or v2, through match_model.specs): the factor rows (EVIDENCE_SQL and
    quick criteria), places, own criteria, layer ranges, and whether the budget is one of them."""
    from . import match_model

    v2 = match_model.as_v2(profile)
    sources = {"factors": [], "places": [], "custom": [], "ranges": [], "budget": False}
    for spec in match_model.specs(v2):
        item = spec["item"]
        if spec["kind"] == "budget":
            sources["budget"] = True
        elif spec["kind"] == "commute":
            sources["factors"].append("commute")
        elif spec["kind"] == "place":
            place = {key: value for key, value in item.items() if key not in ("kind", "softMinutes")}
            sources["places"].append({**place, "weight": 0, "must": bool(item.get("must"))})
        elif spec["kind"] == "custom":
            sources["custom"].append({"criterion": item["criterion"], "weight": 1, "direction": item["direction"]})
        elif spec["kind"] == "range" and spec["source"] == spec["id"] and spec["id"].startswith("range:"):
            sources["ranges"].append({"layer": item["layer"]})
        elif spec["kind"] == "range":
            sources["factors"].append(spec["source"])
    return sources


def load_match_evidence(profile: Mapping[str, Any], served: Scope | None = None) -> list[dict]:
    """Every match evidence row the profile reads, for the LSOAs of the request's scope (London with
    CLOSE_KNIT_ENGLAND off; with it on the regions asked for, else all of England), filtered in the database."""
    sources = match_sources(profile)
    factors = sources["factors"]
    scope = served or current_scope()
    scoped_sql = evidence_sql(scope)
    with _pool().connection() as connection:
        rows = list(connection.execute(scoped_sql, (factors,))) if factors else []
        if sources["places"]:
            release = list(connection.execute("SELECT release_id FROM active_product_release"))
            if release:
                rows += personal_places.place_rows(connection, release[0]["release_id"], sources["places"], scope)
        if sources["custom"]:
            from . import custom_criteria
            release = list(connection.execute("SELECT release_id FROM active_product_release"))
            if release:
                rows += custom_criteria.rows(connection, release[0]["release_id"], sources["custom"], scope)
        if sources["ranges"]:
            rows += range_rows(connection, sources["ranges"], scope)
        if any(factor in quick_criteria.QUICK_FACTORS for factor in factors):
            release = list(connection.execute("SELECT release_id FROM active_product_release"))
            rows += quick_criteria.match_rows(connection, release[0]["release_id"] if release else "", factors, scope)
        if sources["budget"] and profile.get("market", "buy") == "buy" \
                and not any(row["factor_id"] == "affordability" for row in rows):
            levels = [row for row in rows if row["factor_id"] == "market-level"] \
                or list(connection.execute(scoped_sql, (["market-level"],)))
            rows += [ballpark_price_row(row, profile.get("bedrooms", 2)) for row in levels]
        if sources["budget"] and profile.get("market", "buy") == "rent":
            rows += rent_rows(connection, profile.get("bedrooms", 2), served=scope)
        event = analytics_event(profile)
        if event:
            _store_analytics(connection, event)
    return rows


# Range criteria: every LSOA's value of a map layer at its latest period in the active release, read
# from its carrier (an MSOA or borough figure applies to each LSOA inside it), with its London
# percentile for a percentile-scale range. A layer that is not a published metric but is a My match
# factor (disorder, schools, growth outlook, EPC and leasehold shares, or noise before its map layer
# is loaded) reads that factor's rows instead (every criterion is a range on its layer).
RANGE_METRIC_SQL = """-- evidence:range-metric
SELECT m.carrier::text AS carrier, m.unit, to_char(max(v.period), 'YYYY-MM') AS period
FROM metric_definition m
JOIN metric_value v ON v.metric_id = m.id
JOIN product_release_member member ON member.source_release_id = v.source_release_id
JOIN active_product_release active ON active.release_id = member.release_id
WHERE m.id = %s
GROUP BY m.carrier, m.unit"""

RANGE_VALUES_SQL = """-- evidence:range-values
SELECT lsoa.id AS geography_id, lsoa.name, v.value AS raw_value, v.geography_id AS carrier_geography_id,
  v.quality::text AS quality, v.source_release_id, v.region_percentile AS percentile
FROM active_product_release active
JOIN product_release_member member ON member.release_id = active.release_id
JOIN metric_value v ON v.source_release_id = member.source_release_id
{carrier_join}
WHERE v.metric_id = %s AND v.period = to_date(%s, 'YYYY-MM') AND v.value IS NOT NULL"""

RANGE_CARRIER_JOINS = {
    "lsoa": "JOIN area_geography lsoa ON lsoa.id = v.geography_id AND lsoa.kind = 'lsoa'",
    "msoa": "JOIN area_geography lsoa ON lsoa.parent_id = v.geography_id AND lsoa.kind = 'lsoa'",
    kinds.LAD: "JOIN area_geography msoa ON msoa.parent_id = v.geography_id AND msoa.kind = 'msoa' "
               "JOIN area_geography lsoa ON lsoa.parent_id = msoa.id AND lsoa.kind = 'lsoa'",
}


def range_rows(connection: Any, ranges: list[Mapping[str, Any]],
               scope: Scope | None = None) -> list[dict]:
    """`range:<layer>` evidence rows per LSOA (of the scope) for each range criterion: a published
    metric, a ready-made criterion (`custom:<preset id>`) counted from places, or a My match factor's own rows.
    Unknown layers add no rows."""
    scope = scope or current_scope()
    rows: list[dict] = []
    for item in ranges:
        layer = item["layer"]
        if layer.startswith("custom:"):
            rows += _preset_range_rows(connection, layer, scope)
            continue
        if layer in feature_flags.hidden_metrics():
            continue
        metric = list(connection.execute(RANGE_METRIC_SQL, (layer,)))
        if not metric or metric[0]["carrier"] not in RANGE_CARRIER_JOINS or not metric[0]["period"]:
            rows += _factor_range_rows(connection, layer, scope)
            continue
        sql = RANGE_VALUES_SQL.format(carrier_join=RANGE_CARRIER_JOINS[metric[0]["carrier"]]) \
            + scope.sql_filter("lsoa.id")
        rows += [{**row, "factor_id": f"range:{layer}", "utility": None, "unit": metric[0]["unit"]}
                 for row in connection.execute(sql, (layer, metric[0]["period"]))]
    return rows


def _factor_range_rows(connection: Any, layer: str, scope: Scope) -> list[dict]:
    """A layer without a published metric, read from the My match factor of the same name (its stored
    utility is the London percentile of the value)."""
    from .match_model import LAYER_FACTORS

    factor = LAYER_FACTORS.get(layer)
    if factor is None:
        return []
    if factor in quick_criteria.QUICK_FACTORS:
        release = list(connection.execute("SELECT release_id FROM active_product_release"))
        found = quick_criteria.match_rows(connection, release[0]["release_id"] if release else "", [factor], scope)
    else:
        found = list(connection.execute(evidence_sql(scope), ([factor],)))
    return [{**row, "factor_id": f"range:{layer}", "percentile": row.get("utility"), "utility": None} for row in found]


def criterion_values(layer: str) -> dict:
    """Every LSOA's value of a criterion layer and its London percentile (GET /api/v1/match-criteria/{layer}):
    the histogram behind a range card when the layer has no map value pack (noise before its map layer
    is loaded, disorder, schools ...). Empty when the layer is not a criterion."""
    with _pool().connection() as connection:
        region_map = regions.area_regions_on(connection)
        rows = range_rows(connection, [{"layer": layer}])
    seen: dict[str, dict] = {}
    for row in rows:
        seen.setdefault(row["geography_id"], row)
    values = sorted(seen.values(), key=lambda row: row["geography_id"])
    if values and any(row.get("percentile") is None for row in values):
        ranks = quick_criteria.percentiles({row["geography_id"]: row["raw_value"] for row in values}, region_map)
        values = [{**row, "percentile": ranks[row["geography_id"]]} for row in values]
    return {
        "schemaVersion": "match-criterion-values.v1", "layer": layer,
        "unit": values[0].get("unit") if values else None,
        "sourceReleaseIds": sorted({row["source_release_id"] for row in values if row.get("source_release_id")}),
        "values": [{"geographyId": row["geography_id"], "value": row["raw_value"],
                    "regionPercentile": None if row.get("percentile") is None else round(float(row["percentile"]), 1)}
                   for row in values],
    }


def _preset_range_rows(connection: Any, layer: str, scope: Scope) -> list[dict]:
    from . import custom_criteria
    preset = next((entry for entry in custom_criteria.presets()["presets"]
                   if entry["criterion"]["id"] == layer.split(":", 1)[1]), None)
    release = list(connection.execute("SELECT release_id FROM active_product_release"))
    if preset is None or not release:
        return []
    rows = custom_criteria.rows(connection, release[0]["release_id"], [{"criterion": preset["criterion"]}], scope)
    return [{**row, "factor_id": f"range:{layer}", "utility": None} for row in rows]


def _wants(profile: Mapping[str, Any], factor_id: str) -> bool:
    """Whether the profile (v1 or v2) has the budget among its criteria (affordability) or reads a factor."""
    sources = match_sources(profile)
    return sources["budget"] if factor_id == "affordability" else factor_id in sources["factors"]


# No release carries purchase-price affordability per area, so it is derived the way the agent
# tools quote a ballpark: the area's latest median £/m² times a typical size for the bedrooms.
TYPICAL_FLOOR_AREA = {0: 38, 1: 50, 2: 70, 3: 90, 4: 115, 5: 140}


def ballpark_price_row(level: Mapping[str, Any], bedrooms: int) -> dict:
    price = round(level["raw_value"] * TYPICAL_FLOOR_AREA.get(bedrooms, 160), -3)
    return {**level, "factor_id": "affordability", "raw_value": price, "utility": None,
            "unit": "£ ballpark", "quality": "fallback"}


# Rent mode (migration 029): every LSOA reads its borough's average private rent for the bedroom
# cell (ONS PIPR, latest month), carried by the borough the way matching expects. PIPR has no
# studio figure, so a studio search has no rent row and budget fit stays unknown.
RENT_CELLS = {1: "1 bedroom", 2: "2 bedrooms", 3: "3 bedrooms"}

RENT_TABLE_SQL = """-- evidence:rent-table
SELECT to_regclass('borough_rent') IS NOT NULL AS t"""

RENT_SQL = """-- evidence:borough-rent
SELECT lsoa.id AS geography_id, lsoa.name, 'affordability' AS factor_id,
  rent.monthly_rent AS raw_value, NULL::numeric AS utility, 'GBP/month' AS unit, rent.bedrooms,
  msoa.parent_id AS carrier_geography_id, 'fallback' AS quality, rent.source_release_id,
  rent.period, (SELECT release_id FROM active_product_release) AS product_release_id
FROM borough_rent rent
JOIN area_geography msoa ON msoa.parent_id = 'uk:lad:' || rent.area_code AND msoa.kind = 'msoa'
JOIN area_geography lsoa ON lsoa.parent_id = msoa.id AND lsoa.kind = 'lsoa'
WHERE rent.bedrooms = %s AND rent.period = (SELECT max(period) FROM borough_rent)
  AND (%s::text[] IS NULL OR lsoa.id = ANY(%s::text[]))"""


def rent_cell(bedrooms: int) -> str | None:
    """PIPR's bedroom cell, worded as matching's (`_rent_bedroom_cell`); None for a studio."""
    if bedrooms <= 0:
        return None
    return RENT_CELLS.get(bedrooms, "4 or more bedrooms")


def rent_rows(connection: Any, bedrooms: int, area_ids: list[str] | None = None, served: Scope | None = None) -> list[dict]:
    """Borough rent rows per LSOA (of the scope, when given); empty for a studio or before migration 029 is
    loaded."""
    cell = rent_cell(bedrooms)
    if cell is None or not list(connection.execute(RENT_TABLE_SQL))[0]["t"]:
        return []
    return list(connection.execute(served.rows(RENT_SQL) if served else RENT_SQL, (cell, area_ids, area_ids)))


# Zones expand to LSOA sets. Station walks are pinned to the active release;
# the borough walk is LSOA -> MSOA -> borough through area_geography.parent_id.
ZONE_STATION_SQL = """-- evidence:zone-station
SELECT walk.geography_id
FROM lsoa_station_walk walk
JOIN product_release_member member ON member.source_release_id = walk.source_release_id
WHERE member.release_id = (SELECT release_id FROM active_product_release)
  AND walk.station_id = %s AND walk.median_minutes <= %s"""

ZONE_BOROUGH_SQL = """-- evidence:zone-borough
SELECT lsoa.id AS geography_id
FROM area_geography lsoa
JOIN area_geography msoa ON msoa.id = lsoa.parent_id
WHERE lsoa.kind = 'lsoa' AND msoa.parent_id = %s"""


# find_areas expands borough and MSOA exclusions to their LSOAs (#218), the way Where
# zones resolve; unknown ids fail fast with a typed invalid-query error.
KNOWN_GEOGRAPHIES_SQL = """-- evidence:known-geographies
SELECT id FROM area_geography WHERE id = ANY(%s) AND kind::text IN """ + kinds.SQL_LIST

EXPAND_AREAS_SQL = """-- evidence:expand-area-ids
SELECT lsoa.id AS geography_id
FROM area_geography lsoa
JOIN area_geography msoa ON msoa.id = lsoa.parent_id
JOIN area_geography borough ON borough.id = msoa.parent_id
WHERE lsoa.kind = 'lsoa'
  AND (lsoa.id = ANY(%s) OR msoa.id = ANY(%s) OR borough.id = ANY(%s))"""


def expand_area_ids(connection: Any, area_ids: list[str]) -> tuple[set[str], set[str]]:
    """(LSOA ids, unknown ids) for LSOA, MSOA and borough geography ids."""
    ids = sorted(set(area_ids))
    known = {row["id"] for row in connection.execute(KNOWN_GEOGRAPHIES_SQL, (ids,))}
    unknown = set(ids) - known
    if unknown:
        return set(), unknown
    expanded = {row["geography_id"] for row in connection.execute(EXPAND_AREAS_SQL, (ids, ids, ids))}
    return expanded, set()
# find_areas validates its station and borough ids up front (#217): unknown ids fail
# with a typed invalid-query error instead of silently matching nothing.
KNOWN_STATIONS_SQL = """-- evidence:known-stations
SELECT s.id
FROM station s
JOIN product_release_member member ON member.source_release_id = s.source_release_id
WHERE member.release_id = (SELECT release_id FROM active_product_release)
  AND s.id = ANY(%s)"""

KNOWN_BOROUGHS_SQL = """-- evidence:known-boroughs
SELECT g.id
FROM area_geography g
WHERE g.kind = 'lad' AND g.id = ANY(%s)"""


def known_zone_references(connection: Any, station_ids: list[str],
                          borough_ids: list[str]) -> tuple[set[str], set[str]]:
    """Station and borough ids the active release knows; anything else is unknown."""
    known_stations = {row["id"] for row in connection.execute(KNOWN_STATIONS_SQL, (sorted(station_ids),))} \
        if station_ids else set()
    known_boroughs = {row["id"] for row in connection.execute(KNOWN_BOROUGHS_SQL, (sorted(borough_ids),))} \
        if borough_ids else set()
    return known_stations, known_boroughs


# A drawn zone: every LSOA its polygon touches (corners are [latitude, longitude]; ST_MakeValid
# repairs a ring that crosses itself).
ZONE_POLYGON_SQL = """-- evidence:zone-polygon
SELECT g.id AS geography_id
FROM area_geography g
WHERE g.kind = 'lsoa'
  AND ST_Intersects(g.geometry, ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)))"""


def polygon_geojson(points: Any) -> str:
    """GeoJSON Polygon (lon, lat order, ring closed) for a drawn zone's [latitude, longitude] corners."""
    ring = [[lon, lat] for lat, lon in points]
    return json.dumps({"type": "Polygon", "coordinates": [ring + ring[:1]]})


def zone_lsoas(connection: Any, zones: Any) -> set[str] | None:
    """LSOA ids inside any of the (validated) zones; None when there are no zones."""
    if not zones:
        return None
    found: set[str] = set()
    for zone in zones:
        if zone["kind"] == "station":
            rows = connection.execute(ZONE_STATION_SQL, (zone["stationId"], zone["maxWalkMinutes"]))
        elif zone["kind"] == "borough":
            rows = connection.execute(ZONE_BOROUGH_SQL, (zone["id"],))
        elif zone["kind"] == "polygon":
            rows = connection.execute(ZONE_POLYGON_SQL, (polygon_geojson(zone["points"]),))
        else:
            found.update(zone["ids"])
            continue
        found.update(row["geography_id"] for row in rows)
    return found


# A Where zone's outline on the map. A borough is its own boundary; a station's walk and a list of areas are
# the union of their LSOAs, so the outline is exactly what counts as inside. Simplified (~10 m), 5 decimals.
ZONE_SHAPE_BOROUGH_SQL = """-- evidence:zone-shape-borough
SELECT ST_AsGeoJSON(ST_SimplifyPreserveTopology(g.geometry, 0.0001), 5) AS geometry
FROM area_geography g WHERE g.id = %s AND g.kind = 'lad'"""

ZONE_SHAPE_LSOAS_SQL = """-- evidence:zone-shape-lsoas
SELECT ST_AsGeoJSON(ST_SimplifyPreserveTopology(ST_UnaryUnion(ST_Collect(g.geometry)), 0.0001), 5) AS geometry
FROM area_geography g WHERE g.kind = 'lsoa' AND g.id = ANY(%s)"""


def zone_shapes(connection: Any, zones: Any) -> list[dict | None]:
    """Per (validated) zone, in order, its outline as a GeoJSON geometry; None for a drawn polygon (the
    client has its corners) and for a zone with nothing inside (a station with no area in walking range)."""
    shapes: list[dict | None] = []
    for zone in zones or []:
        rows: Any = []
        if zone["kind"] == "borough":
            rows = connection.execute(ZONE_SHAPE_BOROUGH_SQL, (zone["id"],))
        elif zone["kind"] in ("station", "lsoas"):
            ids = (sorted(row["geography_id"] for row in connection.execute(ZONE_STATION_SQL, (zone["stationId"], zone["maxWalkMinutes"])))
                   if zone["kind"] == "station" else list(zone["ids"]))
            rows = connection.execute(ZONE_SHAPE_LSOAS_SQL, (ids,)) if ids else []
        found = [row["geometry"] for row in rows if row.get("geometry")]
        shapes.append(json.loads(found[0]) if found else None)
    return shapes


def load_zone_lsoas(zones: Any, connect: Callable[[], Any] | None = None) -> set[str] | None:
    if not zones:
        return None
    with (connect or evidence_connection)() as connection:
        return zone_lsoas(connection, zones)


def load_zone_distances(inside: set[str] | None, soft: float,
                        connect: Callable[[], Any] | None = None) -> dict[str, float] | None:
    """Metres from every LSOA to the zones (0 inside; match_model.zone_distances) for the Where criterion.
    None without zones, or when the area points cannot be read: the match then scores inside
    as 1 and outside as beyond the soft edge."""
    if inside is None:
        return None
    from . import match_model
    try:
        with (connect or evidence_connection)() as connection:
            release = list(connection.execute("SELECT release_id FROM active_product_release"))
            areas = personal_places.area_points(connection, release[0]["release_id"] if release else "")
    except Exception:  # noqa: BLE001 - distances refine the Where fit; inside/outside still works without them
        logger.warning("zone distances unavailable", exc_info=True)
        return None
    points = {area["geography_id"]: (area["lat"], area["lon"]) for area in areas
              if area.get("lat") is not None and area.get("lon") is not None}
    return match_model.zone_distances(inside, points, soft) if points else None


def match_zones(profile: Mapping[str, Any], load_lsoas: Callable[[Any], set[str] | None] = load_zone_lsoas,
                load_distances: Callable[[set[str] | None, float], dict | None] | None = None) -> dict:
    """The zone inputs of build_match_pack for a v1 or v2 profile: {"zone_lsoas", "zone_distance"}."""
    from . import match_model

    zones = match_model.profile_zones(profile)
    if not zones:
        return {"zone_lsoas": None, "zone_distance": None}
    inside = load_lsoas(zones)
    distances = (load_distances or load_zone_distances)(inside, match_model.soft_metres(profile))
    return {"zone_lsoas": inside, "zone_distance": distances}


def _store_analytics(connection, event: Mapping[str, Any]) -> None:
    connection.execute(
        """INSERT INTO profile_analytics_event
        (market, budget_band, bedrooms, forecast_horizon, factor_weights,
         destination_count, destination_modes, school_phases)
        VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s, %s)""",
        (
            event["market"], event["budgetBand"], event["bedrooms"],
            event["forecastHorizon"], json.dumps(event["factorWeights"]),
            event["destinationCount"], event["destinationModes"], event["schoolPhases"],
        ),
    )


_POOL = None


def _pool():
    """One process-wide pool; a connection per request was the bottleneck for
    tile bursts. Each `connection()` block commits on success, rolls back on
    error, exactly like the `psycopg.connect` context manager it replaces."""
    global _POOL
    if _POOL is None:
        from psycopg.rows import dict_row
        from psycopg_pool import ConnectionPool

        _POOL = ConnectionPool(
            _database_url(),
            min_size=1,
            max_size=int(os.environ.get("CLOSE_KNIT_DB_POOL_SIZE", "10")),
            # A runaway query ends as 503 query-timeout (errors.py) instead of holding a pool slot.
            # force_custom_plan: after five calls a generic plan turned z15+ tiles from ~20 ms into
            # ~1.5 s; jit=off: compiling cost ~300 ms on some sale tiles (measured on prod).
            kwargs={"row_factory": dict_row,
                    "options": f"-c statement_timeout={_statement_timeout_ms()} "
                               "-c plan_cache_mode=force_custom_plan -c jit=off"},
            open=True,
        )
    return _POOL


def close_pool() -> None:
    """For one-shot CLIs: stop the pool's threads so the process exits at once."""
    global _POOL
    if _POOL is not None:
        _POOL.close()
        _POOL = None


def _statement_timeout_ms() -> int:
    return int(os.environ.get("CLOSE_KNIT_DB_STATEMENT_TIMEOUT_MS") or "20000")


@contextlib.contextmanager
def evidence_connection() -> Iterator[Any]:
    with _pool().connection() as connection:
        yield connection


def _database_url() -> str:
    try:
        return os.environ["CLOSE_KNIT_DATABASE_URL"]
    except KeyError as error:
        raise RuntimeError("CLOSE_KNIT_DATABASE_URL is required") from error


READINESS_SQL = """-- health:readiness
SELECT active.release_id, active.previous_release_id,
  release.validation_status, release.assets
FROM active_product_release active
JOIN product_release release ON release.id = active.release_id"""

READINESS_SOURCES_SQL = """-- health:sources
SELECT member.source_release_id AS id, source.retrieved_at
FROM active_product_release active
JOIN product_release_member member ON member.release_id = active.release_id
JOIN source_release source ON source.id = member.source_release_id"""

READY_CODE = "ready"
BLOCKING_CODES = ("refresh-failed", "missing-tile-asset")
SOURCE_FRESHNESS_PATH = __file__.rsplit("/", 1)[0] + "/fixtures/source-freshness.json"
CORRECTION_ROUTES = {"publisher-error": "publisher", "transformation-error": "transformation"}
RUN_SUMMARY_FIELDS = (
    "releaseId", "status", "members", "rejectedRows",
    "quarantinedJoins", "lastPublication", "rollbackRef",
)


class CorrectionError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def assess_readiness(state: Mapping[str, Any]) -> dict:
    active = state.get("activeReleaseId")
    if active is None:
        code = _empty_code(state)
        check = _empty_check(state, code)
        return _report("not-ready", code, None, [check], [check])
    checks = [_refresh_check(state), _assets_check(state),
              _freshness_check(state), _coverage_check(state)]
    return _combine(active, checks)


def load_readiness(
    connect: Any,
    *,
    now: str | None = None,
    required_assets: tuple = ("tiles/",),
    stale_after_days: Mapping[str, int] | None = None,
    rejected_rows: int = 0,
    quarantined_joins: tuple = (),
    last_run: Mapping[str, Any] | None = None,
) -> dict:
    with connect() as connection:
        rows = list(connection.execute(READINESS_SQL))
        sources = list(connection.execute(READINESS_SOURCES_SQL)) if rows else []
    if not rows:
        return assess_readiness({"activeReleaseId": None, "lastRun": last_run})
    row = rows[0]
    return assess_readiness({
        "activeReleaseId": row["release_id"],
        "previousReleaseId": row["previous_release_id"],
        "validationStatus": row["validation_status"],
        "assets": list(row["assets"] or []),
        "requiredAssets": list(required_assets),
        "sources": [_source_state(source, stale_after_days) for source in sources],
        "now": now or _today(),
        "rejectedRows": rejected_rows,
        "quarantinedJoins": list(quarantined_joins),
        "lastRun": last_run,
    })


def health_http_status(report: Mapping[str, Any]) -> int:
    return 503 if report["status"] == "not-ready" else 200


def health_log_line(report: Mapping[str, Any]) -> str:
    return ("data-health status={} code={} release={} reasons={}").format(
        report["status"], report["code"],
        report["productReleaseId"], len(report["unavailableReasons"]))


def log_health_report(report: Mapping[str, Any]) -> Mapping[str, Any]:
    level = logging.INFO
    if report["status"] == "degraded":
        level = logging.WARNING
    if report["status"] == "not-ready":
        level = logging.ERROR
    logger.log(level, health_log_line(report))
    return report


def build_run_summary(summary: Mapping[str, Any]) -> dict:
    missing = sorted(set(RUN_SUMMARY_FIELDS) - set(summary))
    if missing:
        raise ValueError(f"run summary missing: {', '.join(missing)}")
    members = [_checked_member(member) for member in summary["members"]]
    return {
        "releaseId": summary["releaseId"],
        "status": summary["status"],
        "sourceVersions": {m["source"]: m["release"] for m in members},
        "rejectedRows": summary["rejectedRows"],
        "quarantinedJoins": [dict(entry) for entry in summary["quarantinedJoins"]],
        "expectedCadence": {m["source"]: m["cadence"] for m in members},
        "lastPublication": summary["lastPublication"],
        "rollbackRef": summary["rollbackRef"],
    }


CORRECTION_INSERT_SQL = """-- correction:insert
INSERT INTO correction_report (observation_id, product_release_id, source_release_id, kind, description)
VALUES (%s, %s, %s, %s, %s)
RETURNING id"""


def store_correction_report(connect: Callable[[], Any], report: Mapping[str, Any]) -> int:
    """Persist a prepared report; unknown release ids surface as a 400, not a 500."""
    params = (report.get("observationId"), report.get("productReleaseId"),
              report.get("sourceReleaseId"), report["kind"], report.get("description"))
    with connect() as connection:
        try:
            rows = list(connection.execute(CORRECTION_INSERT_SQL, params))
        except Exception as error:
            if _is_foreign_key_violation(error):
                raise CorrectionError("invalid-correction-report",
                                      "correction report names an unknown release") from error
            raise
    return rows[0]["id"]


def _is_foreign_key_violation(error: Exception) -> bool:
    try:
        from psycopg.errors import ForeignKeyViolation
    except ImportError:  # pragma: no cover
        return False
    return isinstance(error, ForeignKeyViolation)


def prepare_correction_report(payload: Mapping[str, Any]) -> dict:
    kind = payload.get("kind")
    if kind not in CORRECTION_ROUTES:
        raise CorrectionError("invalid-correction-report",
                              f"correction kind must be one of {sorted(CORRECTION_ROUTES)}")
    ids = {k: payload[k] for k in
           ("observationId", "productReleaseId", "sourceReleaseId") if payload.get(k)}
    if not ids:
        raise CorrectionError("invalid-correction-report",
                              "correction report needs an observation or release id")
    report = {"status": "received", "kind": kind,
              "route": CORRECTION_ROUTES[kind], **ids}
    description = _clean_description(payload.get("description"))
    if description is not None:
        report["description"] = description
    return report


def _clean_description(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise CorrectionError("invalid-correction-report",
                              "correction description must be text")
    trimmed = value.strip()
    if not trimmed:
        return None
    if len(trimmed) > 2000:
        raise CorrectionError("invalid-correction-report",
                              "correction description must fit in 2000 characters")
    return trimmed


def _checked_member(member: Mapping[str, Any]) -> dict:
    for field in ("source", "release", "cadence"):
        if field not in member:
            raise ValueError(f"run summary member missing: {field}")
    return dict(member)


def _combine(active: str, checks: list) -> dict:
    failing = [check for check in checks if not check["ok"]]
    blocking = [c for c in failing if c["code"] in BLOCKING_CODES]
    if blocking:
        return _report("not-ready", blocking[0]["code"], active, checks, failing)
    if failing:
        return _report("degraded", failing[0]["code"], active, checks, failing)
    return _report("ready", READY_CODE, active, checks, [])


def _report(status: str, code: str, active: Any, checks: list, failing: list) -> dict:
    return {"status": status, "code": code, "productReleaseId": active,
            "checks": checks,
            "unavailableReasons": [check["detail"] for check in failing]}


def _empty_code(state: Mapping[str, Any]) -> str:
    last = state.get("lastRun") or {}
    if last.get("status") == "failed":
        return "refresh-failed"
    return "empty-database"


def _empty_check(state: Mapping[str, Any], code: str) -> dict:
    if code == "refresh-failed":
        last = state.get("lastRun") or {}
        detail = (f"refresh {last.get('releaseId')} failed and no usable "
                  "release is loaded; previous publication is retained")
    else:
        detail = "no active product release is loaded"
    return {"check": "active-release", "ok": False, "code": code, "detail": detail}


def _refresh_check(state: Mapping[str, Any]) -> dict:
    if state.get("validationStatus") == "passed":
        return {"check": "publication", "ok": True, "code": READY_CODE,
                "detail": "active release validation passed"}
    return {"check": "publication", "ok": False, "code": "refresh-failed",
            "detail": (f"release {state.get('activeReleaseId')} validation is "
                       f"{state.get('validationStatus')}; last usable release is retained")}


def _assets_check(state: Mapping[str, Any]) -> dict:
    assets = state.get("assets") or []
    missing = [r for r in state.get("requiredAssets") or []
               if not any(a.startswith(r) for a in assets)]
    if not missing:
        return {"check": "tile-assets", "ok": True, "code": READY_CODE,
                "detail": "required tile assets are present"}
    return {"check": "tile-assets", "ok": False, "code": "missing-tile-asset",
            "detail": (f"release {state.get('activeReleaseId')} is missing "
                       f"required tile assets: {', '.join(missing)}")}


def _freshness_check(state: Mapping[str, Any]) -> dict:
    today = _as_date(state.get("now")) or _as_date(_today())
    stale = [s for s in state.get("sources") or [] if _is_stale(s, today)]
    if not stale:
        return {"check": "source-freshness", "ok": True, "code": READY_CODE,
                "detail": "all sources are within expected cadence"}
    return {"check": "source-freshness", "ok": False, "code": "stale-source",
            "detail": _stale_detail(stale[0])}


def _coverage_check(state: Mapping[str, Any]) -> dict:
    rejected = state.get("rejectedRows") or 0
    quarantined = state.get("quarantinedJoins") or []
    if not quarantined and rejected <= 0:
        return {"check": "join-coverage", "ok": True, "code": READY_CODE,
                "detail": "join coverage is complete"}
    joins = sorted({entry.get("join", "unknown") for entry in quarantined})
    where = ", ".join(joins) if joins else "unmatched rows"
    return {"check": "join-coverage", "ok": False, "code": "quarantined-join",
            "detail": (f"{rejected} rejected rows quarantined at {where}; "
                       "affected values are unavailable, never zero")}


def _is_stale(source: Mapping[str, Any], today: Any) -> bool:
    retrieved = _as_date(source.get("retrievedAt"))
    if retrieved is None or today is None:
        return True
    days = source.get("staleAfterDays") or stale_after_days_for(source.get("release") or "")
    return (today - retrieved).days > int(days)


def _stale_detail(source: Mapping[str, Any]) -> str:
    return (f"source {source.get('sourceId')} release {source.get('release')} "
            f"retrieved {source.get('retrievedAt')} exceeds the "
            f"{source.get('staleAfterDays')}-day expected cadence")


_source_windows: dict | None = None


def _freshness_windows() -> dict:
    global _source_windows
    if _source_windows is None:
        with open(SOURCE_FRESHNESS_PATH, encoding="utf-8") as handle:
            _source_windows = json.load(handle)
    return _source_windows


def stale_after_days_for(release_id: str) -> int:
    """The freshness window of a source release: the longest matching prefix in source-freshness.json."""
    windows = _freshness_windows()
    matches = [w for w in windows["windows"] if release_id.startswith(w["prefix"])]
    if not matches:
        return int(windows["defaultStaleAfterDays"])
    return int(max(matches, key=lambda w: len(w["prefix"]))["staleAfterDays"])


def _source_state(source: Mapping[str, Any], stale_after_days: Any) -> dict:
    release_id = source["id"]
    days = (stale_after_days or {}).get(release_id) or stale_after_days_for(release_id)
    return {"sourceId": release_id, "release": release_id,
            "retrievedAt": _as_text(source.get("retrieved_at")),
            "staleAfterDays": days}


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _as_date(value: Any) -> Any:
    try:
        return datetime.date.fromisoformat(str(value)[:10])
    except (ValueError, TypeError):
        return None


def _today() -> str:
    return datetime.date.today().isoformat()
