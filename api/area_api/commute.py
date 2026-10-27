"""Door-to-door commute minutes from the routing release (deploy/tools/etl_commute.py).

travel_time_matrix holds R5 minutes from every LSOA to each commute hub (weekday morning transit,
walking and cycling). A place pinned within HUB_SNAP_KM of a hub is reached through it: the hub's
minutes plus a walk from the hub to the place. Anything else stays a straight-line estimate
(personal_places). Lookups are cached per routing release, which only changes on activation.
"""
from __future__ import annotations

import math
import threading
from typing import Any, Callable, Mapping

from . import personal_places, regions
from .scope import LONDON, current as current_scope

HUB_SNAP_KM = 1.5
MATRIX_MODES = ("transit", "walk", "cycle", "car")
# deploy/routing/r5/commute_r5.py MAX_MINUTES: pairs over it are stored unreachable (median null), not timed.
MATRIX_CAP_MINUTES = 120
AMENITY_RADIUS_M = 4000  # how far around the area a kind of place is looked for
NR_WALK_METRES = 1200  # ~15 min on foot, as gettingAround's walkMinutes (80 m a minute)
# The TfL timetable release models these modes; National Rail is not in it.
ROUTER_MODELLED_MODES = frozenset({"tube", "elizabeth-line", "dlr", "overground", "tram"})

ACTIVE_NETWORK_SQL = """-- evidence:commute-network
SELECT n.id, n.timetable_source_release_id
FROM route_network_release n
JOIN product_release_member member ON member.source_release_id = n.timetable_source_release_id
WHERE member.release_id = (SELECT release_id FROM active_product_release)
ORDER BY n.created_at DESC
LIMIT 1"""

HUBS_SQL = """-- evidence:commute-hubs
SELECT id, name, station_id, ST_Y(location) AS latitude, ST_X(location) AS longitude
FROM commute_hub WHERE network_release_id = %s ORDER BY id"""

HUB_MINUTES_SQL = """-- evidence:commute-hub-minutes
SELECT geography_id, median_minutes, p10_minutes, p90_minutes
FROM travel_time_matrix
WHERE network_release_id = %s AND destination_cell = %s AND mode = %s"""

ITINERARIES_SQL = """-- evidence:commute-itineraries
SELECT option, total_minutes, transfers, walking_minutes, legs
FROM commute_itinerary
WHERE network_release_id = %s AND hub_id = %s
  AND origin_geography_id = (SELECT parent_id FROM area_geography WHERE id = %s)
ORDER BY option"""

ROUTES_SQL = """-- evidence:commute-routes
SELECT mode, km, coordinates
FROM commute_route
WHERE network_release_id = %s AND hub_id = %s
  AND origin_geography_id = (SELECT parent_id FROM area_geography WHERE id = %s)"""

# Stations near each LSOA for the National Rail gap: areas whose stations within ~15 min
# walk are National Rail only get bus/TfL transit minutes that read slower than the railway.
NR_ONLY_SQL = """-- commute:national-rail-only
SELECT g.id AS geography_id, s.name, s.modes
FROM area_geography g
JOIN place_station s ON ST_DWithin(s.location::geography, ST_PointOnSurface(g.geometry)::geography, %s)
WHERE g.kind = 'lsoa'
ORDER BY g.id, ST_Distance(s.location::geography, ST_PointOnSurface(g.geometry)::geography)"""

# Places of a kind around one area (the selected one): the nearest match by name, other brands, any of the kind.
AREA_AMENITIES_SQL = """-- evidence:commute-area-amenities
WITH p AS (SELECT ST_PointOnSurface(geometry)::geography AS g FROM area_geography WHERE id = %s)
SELECT a.name, a.brand, a.sport, ST_Distance(a.location::geography, p.g) AS metres
FROM place_amenity a, p
WHERE a.kind = ANY(%s) AND ST_DWithin(a.location::geography, p.g, %s)
ORDER BY metres LIMIT 400"""

AREA_SCHOOLS_SQL = """-- evidence:commute-area-schools
WITH p AS (SELECT ST_PointOnSurface(geometry) AS g FROM area_geography WHERE id = %s)
SELECT s.urn, s.name, ST_Distance(s.location::geography, p.g::geography) AS metres
FROM school s, p WHERE s.urn = ANY(%s) ORDER BY metres LIMIT 3"""

AREA_STEP_FREE_SQL = """-- evidence:commute-area-step-free
WITH p AS (SELECT ST_PointOnSurface(geometry)::geography AS g FROM area_geography WHERE id = %s)
SELECT s.name, ST_Distance(s.location::geography, p.g) AS metres
FROM place_station s, p WHERE s.step_free ORDER BY s.location::geography <-> p.g LIMIT 1"""

AREA_PARK_SQL = """-- evidence:commute-area-park
WITH p AS (SELECT ST_PointOnSurface(geometry)::geography AS g FROM area_geography WHERE id = %s)
SELECT k.name, ST_Distance(k.geometry::geography, p.g) AS metres
FROM place_park k, p ORDER BY k.geometry::geography <-> p.g LIMIT 1"""

ALTERNATIVE_BRANDS = {"supermarket": ("M&S", "Waitrose", "Sainsbury's", "Tesco", "Lidl", "Aldi"),
                      "gym": ("PureGym", "The Gym Group", "Virgin Active", "Better")}

_CACHE: dict[tuple, Any] = {}
_LOCK = threading.Lock()


def clear_cache() -> None:
    with _LOCK:
        _CACHE.clear()


def _cached(key: tuple, load: Callable[[], Any]) -> Any:
    with _LOCK:
        if key in _CACHE:
            return _CACHE[key]
    value = load()
    with _LOCK:
        _CACHE[key] = value
    return value


def _optional(connection: Any, sql: str, params: tuple = ()) -> list[dict] | None:
    """Rows from a table a database may not have yet (routing is optional): None instead of an error.
    A savepoint, so the failure cannot poison the open transaction."""
    try:
        savepoint = getattr(connection, "transaction", None)
        if savepoint is not None:
            with savepoint():
                return [dict(row) for row in connection.execute(sql, params)]
        return [dict(row) for row in connection.execute(sql, params)]
    except Exception:  # noqa: BLE001 - a missing routing table is a normal state, not an error
        return None


def active_network(connection: Any) -> dict | None:
    """The routing release whose timetable is part of the active product release, if any."""
    rows = _optional(connection, ACTIVE_NETWORK_SQL)
    return rows[0] if rows else None


def national_rail_only(connection: Any, area_ids: set | None = None,
                       network_id: str | None = None) -> dict[str, list[str]]:
    """{area_id: [station names]} whose stations within ~15 min walk are National Rail only.

    The timetable router models TfL services only, so these areas' transit minutes are
    bus/TfL and read slower than the railway. The whole map is loaded once per routing
    release and filtered to `area_ids` here."""
    def load() -> dict[str, list[str]]:
        rows = _optional(connection, NR_ONLY_SQL, (NR_WALK_METRES,)) or []
        by_area: dict[str, list[dict]] = {}
        for row in rows:
            by_area.setdefault(row["geography_id"], []).append(row)
        return {area_id: [station["name"] for station in stations]
                for area_id, stations in by_area.items()
                if stations and not any(set(station.get("modes") or ()) & ROUTER_MODELLED_MODES
                                        for station in stations)}
    whole = _cached((network_id, "nr-only"), load)
    if area_ids is None:
        return dict(whole)
    return {area_id: names for area_id, names in whole.items() if area_id in area_ids}


def hubs(connection: Any, network_id: str) -> list[dict]:
    return _cached((network_id, "hubs"), lambda: [dict(row) for row in connection.execute(HUBS_SQL, (network_id,))])


def nearest_hub(hub_list: list[Mapping[str, Any]], latitude: float, longitude: float) -> tuple[dict, float] | None:
    best = None
    for hub in hub_list:
        km = personal_places.haversine_km(latitude, longitude, hub["latitude"], hub["longitude"])
        if best is None or km < best[1]:
            best = (dict(hub), km)
    return best if best and best[1] <= HUB_SNAP_KM else None


def hub_minutes(connection: Any, network_id: str, hub_id: str, mode: str) -> dict[str, dict]:
    def load() -> dict[str, dict]:
        return {row["geography_id"]: {"median": row["median_minutes"], "p10": row["p10_minutes"], "p90": row["p90_minutes"]}
                for row in connection.execute(HUB_MINUTES_SQL, (network_id, hub_id, mode))}
    return _cached((network_id, "minutes", hub_id, mode), load)


def last_leg_minutes(km: float, mode: str = "walk") -> float:
    """The last stretch from the hub to the place: walked from the station, or ridden or driven on
    (a short urban hop at about cycling speed)."""
    return personal_places.estimate_minutes(km, "cycle" if mode in ("cycle", "car") else "walk")


def routed_minutes(connection: Any, network: Mapping[str, Any], place: Mapping[str, Any]) -> tuple[dict[str, float], dict] | None:
    """Minutes from every LSOA to a pinned place through its hub, or None when it has no hub nearby."""
    target = place["target"]
    if target["kind"] != "point":
        return None
    snapped = nearest_hub(hubs(connection, network["id"]), target["latitude"], target["longitude"])
    if snapped is None:
        return None
    hub, km = snapped
    extra = last_leg_minutes(km, place["mode"])
    minutes = {area: value["median"] + extra
               for area, value in hub_minutes(connection, network["id"], hub["id"], place["mode"]).items()
               if value["median"] is not None}
    return minutes, {**hub, "lastLegMinutes": round(extra, 1), "km": round(km, 2)}


def _local_entry(place: Mapping[str, Any], metres: float, name: str | None) -> dict:
    return {"placeId": place["id"], "label": place["label"], "hub": None, "routes": [], "paths": {},
            "modes": {mode: mode_entry(personal_places.estimate_minutes(metres / 1000, mode)) for mode in ("walk", "cycle", "car")},
            "nearest": {"name": name, "metres": round(metres)}}


def local_places(connection: Any, release_id: str, area_id: str, places: list[Mapping[str, Any]]) -> list[dict]:
    """For one area: each kind-of-place (a brand, a sport, a top-school rule) as the nearest match by name
    and straight-line minutes on foot, by bike and by car, plus what is close instead (other brands, any of the kind)."""
    out = []
    for place in places:
        target = place["target"]
        if target["kind"] == "school":
            ranked = personal_places.top_schools(connection, release_id, target["phase"], target.get("rankBy", "results"),
                                                 regions.area_regions_on(connection).get(area_id))
            rank = {urn: index + 1 for index, (urn, _) in enumerate(ranked)}
            urns = [urn for urn, _ in ranked[:target["top"]]]
            rows = list(connection.execute(AREA_SCHOOLS_SQL, (area_id, urns))) if urns else []
            if rows:
                entry = _local_entry(place, rows[0]["metres"], rows[0]["name"])
                entry["nearest"]["rank"] = rank.get(rows[0]["urn"])
                entry["alternatives"] = [{"label": f"#{rank.get(row['urn'])} {row['name']}", "metres": round(row["metres"])} for row in rows[1:]]
                out.append(entry)
            continue
        if target["kind"] == "school-filter":
            urns = personal_places.filtered_schools(connection, release_id, target["filter"])
            rows = list(connection.execute(AREA_SCHOOLS_SQL, (area_id, urns))) if urns else []
            within = target.get("within")
            rows = [row for row in rows if within is None or row["metres"] <= within]
            if rows:
                entry = _local_entry(place, rows[0]["metres"], rows[0]["name"])
                entry["alternatives"] = [{"label": row["name"], "metres": round(row["metres"])} for row in rows[1:]]
                out.append(entry)
            continue
        if target["kind"] == "category" and target["category"] == "step_free_station":
            found = next(iter(connection.execute(AREA_STEP_FREE_SQL, (area_id,))), None)
            if found:
                out.append({**_local_entry(place, found["metres"], found["name"]), "alternatives": []})
            continue
        if target["kind"] == "category" and target["category"] == "park":
            # The nearest park by name (the edge of its outline, as My match scores it): Local places' "Park" row.
            found = next(iter(connection.execute(AREA_PARK_SQL, (area_id,))), None)
            if found:
                out.append({**_local_entry(place, found["metres"], found["name"]), "alternatives": []})
            continue
        if target["kind"] != "category":
            continue
        rows = list(connection.execute(AREA_AMENITIES_SQL, (area_id, list(personal_places.CATEGORY_KINDS[target["category"]]),
                                                            AMENITY_RADIUS_M)))
        patterns = personal_places.brand_patterns(target.get("brand"))
        sport = (target.get("sport") or "").lower()

        def matches(row, brand_patterns=patterns) -> bool:
            text = [(row["brand"] or "").lower(), (row["name"] or "").lower()]
            if brand_patterns and not any(_like(value, pattern) for value in text for pattern in brand_patterns):
                return False
            return not sport or sport in (row["sport"] or "").lower()
        found = next((row for row in rows if matches(row)), None)
        if found is None:
            # Nothing of the kind within the radius: say how far was looked, not a bare null.
            out.append({"placeId": place["id"], "label": place["label"], "hub": None, "routes": [], "paths": {},
                        "modes": {}, "nearest": None, "alternatives": [], "searchedRadiusM": AMENITY_RADIUS_M})
            continue
        entry = _local_entry(place, found["metres"], found["name"] or found["brand"])
        alternatives = []
        if patterns or sport:
            if rows:
                alternatives.append({"label": f"Any {personal_places.CATEGORY_LABEL.get(target['category'], target['category'])}",
                                     "name": rows[0]["name"] or rows[0]["brand"], "metres": round(rows[0]["metres"])})
            for brand in ALTERNATIVE_BRANDS.get(target["category"], ()):
                other = personal_places.brand_patterns(brand)
                if patterns and set(other) == set(patterns):
                    continue
                hit = next((row for row in rows if matches(row, other)), None)
                if hit:
                    alternatives.append({"label": brand, "name": hit["name"] or hit["brand"], "metres": round(hit["metres"])})
        entry["alternatives"] = sorted(alternatives, key=lambda item: item["metres"])[:3]
        out.append(entry)
    return out


def _like(value: str, pattern: str) -> bool:
    """SQL LIKE with % only (the brand patterns): prefix, contains or exact."""
    parts = pattern.split("%")
    position = 0
    for index, part in enumerate(parts):
        if not part:
            continue
        found = value.find(part, position)
        if found < 0 or (index == 0 and found != 0):
            return False
        position = found + len(part)
    return pattern.endswith("%") or position == len(value)


def whole_minutes(value: float) -> int:
    """Whole minutes as My match's list shows the match's minutes: the tenths it scores with (personal_places
    place_rows), then rounded half up (JavaScript's Math.round), so the page and the row never differ by one."""
    return math.floor(round(value, 1) + 0.5)


def mode_entry(median: float, p10: float | None = None, p90: float | None = None, extra: float = 0.0) -> dict:
    """One mode's whole minutes with its range, every end rounded by whole_minutes and the range widened to
    the minutes if a percentile sits inside them, so range[0] <= minutes <= range[1] always holds."""
    minutes = whole_minutes(median + extra)
    low = whole_minutes((p10 if p10 is not None else median) + extra)
    high = whole_minutes((p90 if p90 is not None else median) + extra)
    return {"minutes": minutes, "range": [min(low, minutes), max(high, minutes)]}


def inside_london(latitude: float, longitude: float) -> bool:
    """Inside the Greater London box every pinned place must sit in (London's scope box): the routing
    covers London only (TfL timetables, also with CLOSE_KNIT_ENGLAND), so a pin beyond it gets no minutes
    rather than a straight-line guess."""
    return LONDON.contains(latitude, longitude)


def _outside_london(place: Mapping[str, Any]) -> dict:
    """No minutes: the place (or, in England, the area) is outside the London routing. The reason is
    outside-london, or outside-coverage with CLOSE_KNIT_ENGLAND (the routing's coverage, not the map's)."""
    return {"placeId": place["id"], "label": place["label"], "hub": None, "routes": [], "paths": {},
            "modes": {mode: {"minutes": None, "range": None} for mode in MATRIX_MODES},
            "reason": current_scope().outside_reason}


def area_outside_routing(connection: Any, release_id: str | None, area_id: str) -> bool:
    """The area itself is outside the London routing (its point is outside the London box): only ever with
    CLOSE_KNIT_ENGLAND, as every London area's point is inside the box."""
    point = personal_places.area_point(connection, release_id, area_id)
    return point is not None and not inside_london(point["lat"], point["lon"])


def area_commute(connection: Any, network: Mapping[str, Any], area_id: str, places: list[Mapping[str, Any]],
                 release_id: str | None = None) -> list[dict]:
    """For one area: each pinned place by transit, walking, cycling and car (via its hub), with the typical
    transit routes from the area's neighbourhood (MSOA) when the release has itineraries. A place with no hub near
    it gets the straight-line estimate My match scores it with (`estimate: true`), given the product release."""
    out = []
    area_outside = area_outside_routing(connection, release_id, area_id)
    for place in places:
        target = place["target"]
        if target["kind"] == "any-of":
            out.append(_outside_london(place) if area_outside
                       else _quickest_of(connection, network, area_id, place, release_id))
            continue
        if target["kind"] != "point":
            continue
        if area_outside or not inside_london(target["latitude"], target["longitude"]):
            out.append(_outside_london(place))
            continue
        snapped = nearest_hub(hubs(connection, network["id"]), target["latitude"], target["longitude"])
        if snapped is None:
            out.append(_estimated(connection, release_id, area_id, place))
            continue
        hub, km = snapped
        walk = last_leg_minutes(km)
        modes = {}
        for mode in MATRIX_MODES:
            value = hub_minutes(connection, network["id"], hub["id"], mode).get(area_id)
            if value is None:
                continue
            if value["median"] is None:
                # Over the matrix cap (stored unreachable): the mode stays, untimed, rather than vanishing.
                modes[mode] = {"minutes": None, "range": None, "capped": True, "capMinutes": MATRIX_CAP_MINUTES}
                continue
            modes[mode] = mode_entry(value["median"], value["p10"], value["p90"], last_leg_minutes(km, mode))
        # No field lists a journey the matrix would not time.
        routes = [{"totalMinutes": row["total_minutes"], "transfers": row["transfers"],
                   "walkingMinutes": row["walking_minutes"], "legs": row["legs"]}
                  for row in connection.execute(ITINERARIES_SQL, (network["id"], hub["id"], area_id))
                  if row["total_minutes"] is None or row["total_minutes"] <= MATRIX_CAP_MINUTES]
        paths = {row["mode"]: {"km": row["km"], "coordinates": row["coordinates"]}
                 for row in _optional(connection, ROUTES_SQL, (network["id"], hub["id"], area_id)) or []}
        out.append({"placeId": place["id"], "label": place["label"],
                    "hub": {"id": hub["id"], "name": hub["name"], "walkFromHubMinutes": round(walk),
                            "location": [hub["longitude"], hub["latitude"]]},
                    "modes": modes, "routes": routes, "paths": paths,
                    **_sanity_flags(connection, release_id, area_id, hub, modes)})
    return out


def _sanity_flags(connection: Any, release_id: str | None, area_id: str,
                  hub: Mapping[str, Any], modes: Mapping[str, Mapping[str, int]]) -> dict[str, bool]:
    """Implausible figures a reader should not trust at face value: a hub over 10 km from the area
    whose transit minutes read slower than cycling (the timetable misses the fast service)."""
    transit, cycle = modes.get("transit"), modes.get("cycle")
    if transit is None or cycle is None or transit["minutes"] is None or cycle["minutes"] is None \
            or transit["minutes"] <= cycle["minutes"]:
        return {}
    point = personal_places.area_point(connection, release_id, area_id)
    if point is None:
        return {}
    if personal_places.haversine_km(point["lat"], point["lon"], hub["latitude"], hub["longitude"]) > 10:
        return {"transitSlowerThanCycle": True}
    return {}


def _estimated(connection: Any, release_id: str | None, area_id: str, place: Mapping[str, Any]) -> dict:
    """No hub near the place: the match's straight-line minutes per mode (whole minutes, rounded half up as the list
    rounds the match's tenths), marked as an estimate; no modes without the product release."""
    minutes = personal_places.estimated_minutes(connection, release_id, area_id, place) if release_id else {}
    modes = {mode: mode_entry(value) for mode, value in minutes.items()}
    return {"placeId": place["id"], "label": place["label"], "hub": None, "modes": modes, "routes": [], "paths": {},
            **({"estimate": True} if modes else {})}


def _quickest_of(connection: Any, network: Mapping[str, Any], area_id: str, place: Mapping[str, Any],
                 release_id: str | None = None) -> dict:
    """Near any of: each point routed as a pinned place; the one quickest in the place's own mode."""
    options = area_commute(connection, network, area_id, [
        {**place, "target": {"kind": "point", "latitude": lat, "longitude": lon}} for lat, lon in place["target"]["points"]],
        release_id)
    reachable = [entry for entry in options if entry["modes"].get(place["mode"], {}).get("minutes") is not None]
    if reachable:
        return min(reachable, key=lambda entry: entry["modes"][place["mode"]]["minutes"])
    return next((entry for entry in options if "reason" not in entry), options[0])
