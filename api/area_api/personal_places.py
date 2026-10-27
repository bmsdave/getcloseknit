"""The household's own places as match evidence: one `place:<id>` row per LSOA and place.

A place is a pinned point (work, a gym, a particular school, friends) or the nearest of a kind
(any park, cafe, supermarket...). Minutes are estimates until the route planner lands: the
straight line from the area's representative point stretched by a detour factor, at a walking or
cycling speed; transit adds the walk to the area's nearest station and a wait to a fast in-vehicle
leg. Every row is `fallback` quality from ESTIMATE_RELEASE, so nothing reads as a timetable.
`matching._place_component` turns minutes into utility exactly as it does for a commute leg.
"""
from __future__ import annotations

import math
import threading
from typing import Any, Callable, Iterable, Mapping

from .scope import Scope, current as current_scope

ESTIMATE_RELEASE = "estimate-straight-line-v1"
DETOUR = 1.3
# Car: a typical London weekday-morning road speed (DfT congestion statistics), no parking or charges.
SPEED_KMH = {"walk": 4.8, "cycle": 15.0, "car": 20.0}
TRANSIT_KMH = 30.0
TRANSIT_WAIT_MINUTES = 5.0
TRANSIT_DETOUR = 1.25
DEFAULT_STATION_WALK = 15.0  # an area with no station within 20 minutes' walk

CATEGORY_KINDS = {
    "cafe": ("cafe",), "supermarket": ("supermarket",), "convenience": ("convenience",), "gp": ("gp",),
    "pharmacy": ("pharmacy",), "pub": ("pub", "bar"), "restaurant": ("restaurant",),
    "gym": ("gym",), "pool": ("pool",), "sports_club": ("sports-club", "sports-centre"),
}
CATEGORY_LABEL = {"supermarket": "supermarket", "convenience": "corner shop", "cafe": "café", "gp": "GP",
                  "pharmacy": "pharmacy", "pub": "pub", "restaurant": "restaurant", "gym": "gym", "pool": "pool",
                  "sports_club": "sports club", "step_free_station": "step-free station"}
# What people say -> how OSM spells it (brand or name prefix). Anything else matches its own words.
BRAND_PATTERNS = {
    "m&s": ("m&s%", "marks%spencer%"), "marks and spencer": ("m&s%", "marks%spencer%"),
    "marks & spencer": ("m&s%", "marks%spencer%"), "waitrose": ("waitrose%", "little waitrose%"),
    "sainsbury's": ("sainsbury%",), "sainsburys": ("sainsbury%",), "tesco": ("tesco%",), "lidl": ("lidl%",),
    "aldi": ("aldi%",), "co-op": ("co-op%", "coop%", "the co-operative%"), "whole foods": ("whole foods%",),
    "puregym": ("puregym%", "pure gym%"), "the gym group": ("the gym%",), "virgin active": ("virgin active%",),
    "david lloyd": ("david lloyd%",), "better": ("better%",), "nuffield health": ("nuffield%",),
    "third space": ("third space%",), "gymbox": ("gymbox%",),
}
# London-wide school rankings: the published share reaching the standard, latest year with a value.
MIN_SCHOOL_COHORT = 30  # a handful of pupils at 100% is not a top school
SCHOOL_MEASURES = {"secondary": "Grade 5+ in English and maths (%)",
                   "primary": "Expected standard in reading, writing and maths (%)"}
# The rule's optional rankBy "progress8" (secondaries): Progress 8 from the KS4 final tables, latest year.
PROGRESS8_MEASURE = "Progress 8"

AREA_POINTS_SQL = """-- evidence:place-area-points
SELECT g.id AS geography_id, g.name, ST_X(ST_PointOnSurface(g.geometry)) AS lon,
  ST_Y(ST_PointOnSurface(g.geometry)) AS lat,
  (SELECT min(w.median_minutes) FROM lsoa_station_walk w
   JOIN product_release_member member ON member.source_release_id = w.source_release_id
   WHERE member.release_id = (SELECT release_id FROM active_product_release)
     AND w.geography_id = g.id) AS station_walk
FROM area_geography g
WHERE g.kind = 'lsoa'"""

# Nearest place of a kind from each LSOA (KNN on the geography GiST indexes of migration 017).
NEAREST_AMENITY_SQL = """-- evidence:place-nearest-amenity
WITH area AS (SELECT g.id, ST_PointOnSurface(g.geometry)::geography AS point
              FROM area_geography g WHERE g.kind = 'lsoa'{scope})
SELECT area.id AS geography_id,
  (SELECT ST_Distance(a.location::geography, area.point) FROM place_amenity a
   WHERE a.kind = ANY(%s) ORDER BY a.location::geography <-> area.point LIMIT 1) AS metres
FROM area"""

# Same as above, narrowed to a brand (brand or name) and/or a sport, e.g. "an M&S", "a tennis club".
NEAREST_FILTERED_AMENITY_SQL = """-- evidence:place-nearest-amenity-filtered
WITH area AS (SELECT g.id, ST_PointOnSurface(g.geometry)::geography AS point
              FROM area_geography g WHERE g.kind = 'lsoa'{scope})
SELECT area.id AS geography_id,
  (SELECT ST_Distance(a.location::geography, area.point) FROM place_amenity a
   WHERE a.kind = ANY(%(kinds)s)
     AND (%(brands)s::text[] IS NULL OR lower(coalesce(a.brand, '')) LIKE ANY(%(brands)s)
          OR lower(coalesce(a.name, '')) LIKE ANY(%(brands)s))
     AND (%(sport)s::text IS NULL OR lower(coalesce(a.sport, '')) LIKE '%%' || %(sport)s || '%%')
   ORDER BY a.location::geography <-> area.point LIMIT 1) AS metres
FROM area"""

# Nearest step-free station (place_station.step_free, migration 028: TfL lift access, DLR, trams).
NEAREST_STEP_FREE_SQL = """-- evidence:place-nearest-step-free
WITH area AS (SELECT g.id, ST_PointOnSurface(g.geometry)::geography AS point
              FROM area_geography g WHERE g.kind = 'lsoa'{scope})
SELECT area.id AS geography_id,
  (SELECT ST_Distance(s.location::geography, area.point) FROM place_station s
   WHERE s.step_free ORDER BY s.location::geography <-> area.point LIMIT 1) AS metres
FROM area"""

# Each school's region (migration 103): "top N" ranks the schools of the area's own region.
SCHOOL_OBSERVATIONS_SQL = """-- evidence:place-school-observations
SELECT urn, attributes->'observations' AS observations, point_rank_region(location) AS region_code
FROM school WHERE phase = %s"""

NEAREST_SCHOOL_SQL = """-- evidence:place-nearest-school
WITH area AS (SELECT g.id, ST_PointOnSurface(g.geometry) AS point FROM area_geography g WHERE g.kind = 'lsoa'{scope})
SELECT area.id AS geography_id,
  (SELECT CASE WHEN count(*) < 10 OR min(near.metres) <= max(near.planar) * 60000 THEN min(near.metres)
          ELSE (SELECT min(ST_Distance(s.location::geography, area.point::geography)) FROM school s
                WHERE s.urn = ANY(%(urns)s)) END
   FROM (SELECT ST_Distance(s.location::geography, area.point::geography) AS metres,
           s.location <-> area.point AS planar
         FROM school s WHERE s.urn = ANY(%(urns)s) ORDER BY s.location <-> area.point LIMIT 10) near) AS metres
FROM area"""
# At most 200 schools, exact metres, never a planar guess: the 10 planar-nearest schools are measured, and their
# nearest is the true one when it is no farther than the 10th's planar distance times 60 km (the fewest metres a
# degree of planar distance can be in England, up to 55.9°N; a school outside the 10 is at least that far).
# Otherwise (or with under 10 schools) every school is measured. Same answers as measuring all, ~2x faster.

# A filtered set can hold every school in London: the three nearest by the index (planar), then exact metres.
NEAREST_SCHOOL_SET_SQL = """-- evidence:place-nearest-school-set
WITH area AS (SELECT g.id, ST_PointOnSurface(g.geometry) AS point FROM area_geography g WHERE g.kind = 'lsoa'{scope})
SELECT area.id AS geography_id,
  (SELECT min(ST_Distance(near.location::geography, area.point::geography))
   FROM (SELECT s.location FROM school s WHERE s.urn = ANY(%s) AND s.location IS NOT NULL
         ORDER BY s.location <-> area.point LIMIT 3) near) AS metres
FROM area"""

NEAREST_PARK_SQL = """-- evidence:place-nearest-park
WITH area AS (SELECT g.id, ST_PointOnSurface(g.geometry)::geography AS point
              FROM area_geography g WHERE g.kind = 'lsoa'{scope})
SELECT area.id AS geography_id,
  (SELECT ST_Distance(p.geometry::geography, area.point) FROM place_park p
   ORDER BY p.geometry::geography <-> area.point LIMIT 1) AS metres
FROM area"""

_CACHE: dict[tuple, Any] = {}
_LOCK = threading.Lock()


def clear_cache() -> None:
    with _LOCK:
        _CACHE.clear()


_LOADING: dict[tuple, threading.Lock] = {}


def _cached(key: tuple, load: Callable[[], Any]) -> Any:
    """`load()` once per key: concurrent callers of a cold key wait for the one load instead of each running it
    (a cold England-wide load took ~7 s; several at once only queued on the database). A failed load keeps nothing."""
    with _LOCK:
        if key in _CACHE:
            return _CACHE[key]
        gate = _LOADING.setdefault(key, threading.Lock())
    with gate:
        with _LOCK:
            if key in _CACHE:
                return _CACHE[key]
        try:
            value = load()
        except BaseException:
            with _LOCK:
                _LOADING.pop(key, None)
            raise
        with _LOCK:
            _CACHE[key] = value
            _LOADING.pop(key, None)
        return value


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    rad = math.pi / 180
    d_lat = (lat2 - lat1) * rad
    d_lon = (lon2 - lon1) * rad
    a = math.sin(d_lat / 2) ** 2 + math.cos(lat1 * rad) * math.cos(lat2 * rad) * math.sin(d_lon / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(a))


def estimate_minutes(km: float, mode: str, station_walk: float | None = None) -> float:
    """Door-to-door minutes for a straight-line distance (an estimate, not a route)."""
    if mode in SPEED_KMH:
        return km * DETOUR / SPEED_KMH[mode] * 60
    walk_out = station_walk if station_walk is not None else DEFAULT_STATION_WALK
    # Short hops are walked: never slower than walking the whole way.
    transit = walk_out + TRANSIT_WAIT_MINUTES + km * TRANSIT_DETOUR / TRANSIT_KMH * 60
    return min(transit, km * DETOUR / SPEED_KMH["walk"] * 60)


def area_points(connection: Any, release_id: str | None, served: Scope | None = None) -> list[dict]:
    """Every LSOA's point row (AREA_POINTS_SQL), or the scope's LSOAs' only, read once per release."""
    regions = served.regions if served else None
    sql = served.rows(AREA_POINTS_SQL) if served else AREA_POINTS_SQL
    return _cached((release_id, "area-points", regions), lambda: list(connection.execute(sql)))


def area_point(connection: Any, release_id: str | None, area_id: str) -> Mapping[str, Any] | None:
    """One LSOA's point row (the cached area points), or None when the area is unknown."""
    rows = area_points(connection, release_id)
    return next((row for row in rows if row["geography_id"] == area_id), None)


def place_rows(connection: Any, release_id: str, places: Iterable[Mapping[str, Any]],
               scope: Scope | None = None) -> list[dict]:
    """`place:<id>` evidence rows for every LSOA in the scope (London with CLOSE_KNIT_ENGLAND off),
    one per place: routed through a commute hub when the routing release has one near the place (observed),
    otherwise a straight-line estimate."""
    from . import commute  # commute builds on this module; imported here to keep the import one-way

    places = list(places)
    if not places:
        return []
    scope = scope or current_scope()
    areas = area_points(connection, release_id, scope)
    network = commute.active_network(connection)
    nr_only = commute.national_rail_only(connection, network_id=network["id"]) if network else {}
    rows = []
    for place in places:
        target = place["target"]
        if target["kind"] == "any-of":
            rows += _best_of_rows(connection, release_id, place, scope)
            continue
        routed = commute.routed_minutes(connection, network, place) if network else None
        if routed is not None:
            minutes, hub = routed
            factor_id = f"place:{place['id']}"
            rows += [{"geography_id": area["geography_id"], "name": area["name"], "factor_id": factor_id,
                      "raw_value": round(minutes[area["geography_id"]], 1), "utility": None, "unit": "minutes",
                      "carrier_geography_id": area["geography_id"], "quality": "observed",
                      "source_release_id": network["timetable_source_release_id"], "via_hub": hub["id"],
                      **({"nationalRailNotModelled": True} if area["geography_id"] in nr_only else {})}
                     for area in areas if area["geography_id"] in minutes]
            continue
        if target["kind"] == "point":
            minutes = {area["geography_id"]: estimate_minutes(
                haversine_km(area["lat"], area["lon"], target["latitude"], target["longitude"]),
                place["mode"], area["station_walk"]) for area in areas}
        else:
            metres = _nearest(connection, release_id, target, scope)
            # The nearest of a kind is a local trip: walked, cycled or driven, never a transit journey.
            mode = place["mode"] if place["mode"] in ("cycle", "car") else "walk"
            minutes = {area_id: estimate_minutes(value / 1000, mode)
                       for area_id, value in metres.items() if value is not None}
        factor_id = f"place:{place['id']}"
        for area in areas:
            value = minutes.get(area["geography_id"])
            if value is None:
                continue
            rows.append({"geography_id": area["geography_id"], "name": area["name"], "factor_id": factor_id,
                         "raw_value": round(value, 1), "utility": None, "unit": "minutes",
                         "carrier_geography_id": area["geography_id"], "quality": "fallback",
                         "source_release_id": ESTIMATE_RELEASE})
    return rows


def estimated_minutes(connection: Any, release_id: str, area_id: str, place: Mapping[str, Any]) -> dict[str, float]:
    """A pinned point with no commute hub near it, from one LSOA in every mode: the straight-line estimate place_rows
    scores the match with (the same area point and station walk, rounded the same way), so an area's page says the
    minutes its My match row says. Empty when the area or the point is unknown."""
    target = place["target"]
    if target["kind"] != "point":
        return {}
    areas = area_points(connection, release_id)
    area = next((row for row in areas if row["geography_id"] == area_id), None)
    if area is None:
        return {}
    km = haversine_km(area["lat"], area["lon"], target["latitude"], target["longitude"])
    return {mode: round(estimate_minutes(km, mode, area["station_walk"]), 1) for mode in ("transit", "walk", "cycle", "car")}


def _best_of_rows(connection: Any, release_id: str, place: Mapping[str, Any],
                  scope: Scope | None = None) -> list[dict]:
    """Near any of two or three points: each point as a pinned place (routed where it can be), and
    per area the quickest of them, so "either office" scores the closer one."""
    best: dict[str, dict] = {}
    for latitude, longitude in place["target"]["points"]:
        point = {**place, "target": {"kind": "point", "latitude": latitude, "longitude": longitude}}
        for row in place_rows(connection, release_id, [point], scope):
            current = best.get(row["geography_id"])
            if current is None or row["raw_value"] < current["raw_value"]:
                best[row["geography_id"]] = row
    return list(best.values())


def brand_patterns(brand: str | None) -> list[str] | None:
    if not brand:
        return None
    key = " ".join(brand.lower().split())
    return list(BRAND_PATTERNS.get(key, (key.replace("%", "") + "%",)))


def scoped(sql: str, scope: Scope) -> str:
    """A nearest-place query over the LSOAs of the scope only: the KNN runs per area."""
    return sql.replace("{scope}", scope.sql_filter("g.id"))


def _nearest(connection: Any, release_id: str, target: Mapping[str, Any],
             scope: Scope | None = None) -> dict[str, float | None]:
    """Metres from every LSOA in the scope to the nearest place matching the target (a kind, a brand, a sport, a
    school rule)."""
    scope = scope or current_scope()
    if target["kind"] == "school":
        return _nearest_school(connection, release_id, target["phase"], target["top"], target.get("rankBy", "results"),
                               scope)
    if target["kind"] == "school-filter":
        return nearest_filtered_school(connection, release_id, target["filter"], target.get("within"), scope)
    category, brand, sport = target["category"], target.get("brand"), target.get("sport")

    def load() -> dict[str, float | None]:
        if category == "park":
            result = connection.execute(scoped(NEAREST_PARK_SQL, scope))
        elif category == "step_free_station":
            result = connection.execute(scoped(NEAREST_STEP_FREE_SQL, scope))
        elif brand or sport:
            result = connection.execute(scoped(NEAREST_FILTERED_AMENITY_SQL, scope), {
                "kinds": list(CATEGORY_KINDS[category]), "brands": brand_patterns(brand),
                "sport": sport.lower() if sport else None})
        else:
            result = connection.execute(scoped(NEAREST_AMENITY_SQL, scope), (list(CATEGORY_KINDS[category]),))
        return {row["geography_id"]: row["metres"] for row in result}
    return _cached((release_id, "nearest", category, (brand or "").lower(), (sport or "").lower(), scope), load)


def _ranked_schools(connection: Any, release_id: str, phase: str, rank_by: str) -> list[tuple[str, float, str | None]]:
    """(urn, value, region) for every state school of a phase with a published value, best first."""
    measure = PROGRESS8_MEASURE if rank_by == "progress8" else SCHOOL_MEASURES[phase]

    def load() -> list[tuple[str, float, str | None]]:
        ranked = []
        for row in connection.execute(SCHOOL_OBSERVATIONS_SQL, (phase,)):
            values = [(obs.get("academicYear") or "", obs.get("value")) for obs in (row["observations"] or [])
                      if obs.get("measure") == measure and not obs.get("suppressed") and isinstance(obs.get("value"), (int, float))
                      and (obs.get("cohortSize") or 0) >= MIN_SCHOOL_COHORT]
            if values:
                ranked.append((row["urn"], max(values)[1], row.get("region_code")))
        return sorted(ranked, key=lambda item: -item[1])
    return _cached((release_id, "school-rank", phase, rank_by), load)


def top_schools(connection: Any, release_id: str, phase: str, rank_by: str = "results",
                region: str | None = None) -> list[tuple[str, float]]:
    """State schools of a phase ranked by the published share reaching the standard (best first), or by Progress 8
    for secondaries when the rule asks for it: those of one region (London's for London), or all of them (also
    when no school carries a region yet)."""
    ranked = _ranked_schools(connection, release_id, phase, rank_by)
    regional = region is not None and any(school_region for _, _, school_region in ranked)
    return [(urn, value) for urn, value, school_region in ranked if not regional or school_region == region]


def school_points(connection: Any, release_id: str) -> list[dict]:
    """The map's school points (school-points.v1), read once per release."""
    from . import schools

    return _cached((release_id, "school-points"), lambda: schools.load_points(connection, release_id)["schools"])


def filtered_schools(connection: Any, release_id: str, filter_text: str) -> list[str]:
    """URNs of the schools the Schools filter v2 keeps (school_filter.py), the same set the map shows."""
    from . import school_filter

    return school_filter.school_set(school_points(connection, release_id), filter_text)


def nearest_filtered_school(connection: Any, release_id: str, filter_text: str,
                            within: float | None = None,
                            scope: Scope | None = None) -> dict[str, float | None]:
    """Metres from every LSOA to the nearest school the filter keeps; None beyond `within` metres (when set), so
    an area with no such school that near has no value (no data, never a far school passed off as near)."""
    urns = filtered_schools(connection, release_id, filter_text)

    def load() -> dict[str, float | None]:
        if not urns:
            return {}
        return {row["geography_id"]: row["metres"]
                for row in connection.execute(scoped(NEAREST_SCHOOL_SET_SQL, scope), (urns,))}
    scope = scope or current_scope()
    metres = _cached((release_id, "nearest-school-filter", filter_text, scope), load)
    if within is None:
        return metres
    return {area: value if value is not None and value <= within else None for area, value in metres.items()}


def _nearest_school(connection: Any, release_id: str, phase: str, top: int, rank_by: str = "results",
                    scope: Scope | None = None) -> dict[str, float | None]:
    """Metres from each LSOA in the scope to the nearest of its region's top N schools (London's for a London
    area). Schools without a region (before migration 103) rank as one list for every area."""
    scope = scope or current_scope()
    ranked = _ranked_schools(connection, release_id, phase, rank_by)
    known = sorted({region for _, _, region in ranked if region})
    groups = [None] if not known else [region for region in (scope.regions or known) if region in known]

    def load() -> dict[str, float | None]:
        metres: dict[str, float | None] = {}
        for region in groups:
            urns = [urn for urn, _ in top_schools(connection, release_id, phase, rank_by, region)[:top]]
            area_scope = scope if region is None else scope.within((region,))
            metres.update({row["geography_id"]: row["metres"]
                           for row in connection.execute(scoped(NEAREST_SCHOOL_SQL, area_scope), {"urns": urns})})
        return metres
    return _cached((release_id, "nearest-school", phase, top, rank_by, scope), load)
