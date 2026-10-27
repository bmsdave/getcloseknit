"""Getting around and nearby (track H): stations, parks and everyday places.

Locations come from OpenStreetMap (Geofabrik Greater London extract, exported
to GeoJSON lines by ``osmium``). Fare zones and the lines that call at each
station come from TfL open data (StopPoint lists). Everything here is pure and
dependency-free; ``places_load`` runs osmium and writes migration 017 tables.

* ``classify`` sorts one OSM feature into a station, a park or an amenity group
  (or drops it).
* ``tfl_stations`` reads TfL StopPoint payloads into stations with a zone and
  rail lines; buses are ignored.
* ``build_stations`` merges the OSM objects of one station (a node and its
  outline, the tube and the National Rail halves) and attaches TfL zones and
  lines, by NaPTAN code first and by name and distance second.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping

# Modes the station list and the score know about; buses are out of scope.
RAIL_MODES = ("tube", "elizabeth-line", "dlr", "overground", "tram", "national-rail")
AMENITY_GROUPS = ("groceries", "pubs", "food", "pharmacies", "gps", "leisure")
PARK_KINDS = ("park", "garden", "nature-reserve", "common", "recreation-ground", "village-green")

_AMENITY_TAGS = {
    ("shop", "supermarket"): ("groceries", "supermarket"),
    ("shop", "convenience"): ("groceries", "convenience"),
    ("amenity", "pub"): ("pubs", "pub"),
    ("amenity", "bar"): ("pubs", "bar"),
    ("amenity", "cafe"): ("food", "cafe"),
    ("amenity", "restaurant"): ("food", "restaurant"),
    ("amenity", "pharmacy"): ("pharmacies", "pharmacy"),
    ("healthcare", "pharmacy"): ("pharmacies", "pharmacy"),
    ("amenity", "doctors"): ("gps", "gp"),
    ("healthcare", "doctor"): ("gps", "gp"),
}
# Leisure places a household goes to: gyms, public pools, sports clubs (by sport). Pools inside blocks of
# flats or gardens are tagged access=private/customers and dropped with the closed-access rule.
_LEISURE_TAGS = {
    ("leisure", "fitness_centre"): "gym",
    ("leisure", "swimming_pool"): "pool",
    ("leisure", "water_park"): "pool",
    ("leisure", "sports_centre"): "sports-centre",
    ("club", "sport"): "sports-club",
}
_PARK_TAGS = {
    ("leisure", "park"): "park",
    ("leisure", "garden"): "garden",
    ("leisure", "nature_reserve"): "nature-reserve",
    ("leisure", "common"): "common",
    ("landuse", "recreation_ground"): "recreation-ground",
    ("landuse", "village_green"): "village-green",
}
_CLOSED_ACCESS = {"private", "no", "customers"}
_PRIVATE_GARDENS = {"residential", "private", "roof_garden"}
_HERITAGE = {"miniature", "tourism", "heritage", "monorail", "funicular"}
# TfL lists a few stations in two zones as "2+3"; we show "2/3" everywhere.
_ZONE = re.compile(r"^[0-9](?:[/+][0-9])?$")
_NAME_NOISE = re.compile(
    r"\b(underground|overground|dlr|rail|railway|tram|stop|station|elizabeth line|london)\b|[()'’.,-]")
MATCH_BY_NAME_METRES = 500
MATCH_NEAREST_METRES = 150
MERGE_METRES = 400


@dataclass(frozen=True)
class Place:
    """One classified OSM feature."""
    osm_id: str
    category: str  # station | park | amenity
    kind: str
    name: str | None
    lon: float
    lat: float
    group: str | None = None
    modes: tuple[str, ...] = ()
    atco: tuple[str, ...] = ()
    brand: str | None = None  # OSM brand ("M&S Simply Food", "PureGym"), for "an M&S nearby"
    sport: str | None = None  # OSM sport ("swimming;fitness"), for "a pool", "a tennis club"


@dataclass
class TflStation:
    naptan: str
    name: str
    lon: float
    lat: float
    zone: str | None
    lines: dict[str, tuple[str, str]] = field(default_factory=dict)  # line id -> (name, mode)


@dataclass
class Station:
    osm_ids: list[str]
    name: str
    lon: float
    lat: float
    modes: list[str]
    zone: str | None
    lines: list[dict]
    tfl_ids: list[str]


def classify(feature: Mapping[str, Any]) -> Place | None:
    """A station, park or amenity from one osmium GeoJSON feature; None to drop it."""
    props = feature.get("properties") or {}
    geometry = feature.get("geometry") or {}
    point = representative_point(geometry)
    if point is None:
        return None
    osm_id = f"{props.get('@type', 'x')[0]}{props.get('@id')}"
    name = (props.get("name") or "").strip() or None
    lon, lat = point
    if _is_station(props):
        if not name:
            return None
        return Place(osm_id, "station", "station", name, lon, lat, modes=_osm_modes(props),
                     atco=tuple(_split(props.get("naptan:AtcoCode"))))
    for (key, value), kind in _PARK_TAGS.items():
        if props.get(key) == value:
            if geometry.get("type") not in ("Polygon", "MultiPolygon") or not name:
                return None
            if props.get("access") in _CLOSED_ACCESS:
                return None
            if kind == "garden" and (props.get("garden:type") in _PRIVATE_GARDENS
                                     or props.get("access") not in ("yes", "public", "permissive")):
                return None
            return Place(osm_id, "park", kind, name, lon, lat)
    brand = (props.get("brand") or "").strip() or None
    for (key, value), (group, kind) in _AMENITY_TAGS.items():
        if props.get(key) == value:
            if props.get("access") in _CLOSED_ACCESS or props.get("disused") == "yes":
                return None
            return Place(osm_id, "amenity", kind, name, lon, lat, group=group, brand=brand)
    for (key, value), kind in _LEISURE_TAGS.items():
        if props.get(key) == value:
            if props.get("access") in _CLOSED_ACCESS or props.get("disused") == "yes":
                return None
            sport = (props.get("sport") or "").strip() or None
            if kind == "sports-centre" and "swimming" in (sport or ""):
                kind = "pool"
            if kind == "pool" and not (name or brand or props.get("access") in ("yes", "public", "permissive")):
                return None  # an unnamed pool with no public access tag is almost always private
            return Place(osm_id, "amenity", kind, name, lon, lat, group="leisure", brand=brand, sport=sport)
    return None


def _is_station(props: Mapping[str, Any]) -> bool:
    if props.get("station") in _HERITAGE or props.get("usage") in _HERITAGE or props.get("airside") == "yes":
        return False
    if "airport" in (props.get("network") or "").lower():  # Heathrow's own people movers
        return False
    if props.get("railway") in ("station", "halt", "tram_stop"):
        return True
    if props.get("public_transport") == "station":
        return any(props.get(key) == "yes" for key in ("train", "subway", "light_rail", "tram"))
    return False


def _osm_modes(props: Mapping[str, Any]) -> tuple[str, ...]:
    """Best guess from OSM tags, used only when TfL has no match."""
    network = (props.get("network") or "").lower()
    modes = []
    if props.get("station") == "subway" or props.get("subway") == "yes" or "underground" in network:
        modes.append("tube")
    if "elizabeth" in network:
        modes.append("elizabeth-line")
    if "docklands" in network or "dlr" in network:
        modes.append("dlr")
    if "overground" in network:
        modes.append("overground")
    if props.get("railway") == "tram_stop" or props.get("tram") == "yes" or "tramlink" in network:
        modes.append("tram")
    if (props.get("train") == "yes" and not modes) or "national rail" in network:
        modes.append("national-rail")
    return tuple(dict.fromkeys(modes)) or ("national-rail",)


def _split(value: Any) -> list[str]:
    return [part.strip() for part in str(value or "").split(";") if part.strip()]


def representative_point(geometry: Mapping[str, Any]) -> tuple[float, float] | None:
    """A point for a Point, or the vertex mean of the first outer ring."""
    kind, coords = geometry.get("type"), geometry.get("coordinates")
    if not coords:
        return None
    if kind == "Point":
        return float(coords[0]), float(coords[1])
    ring = coords[0] if kind == "Polygon" else coords[0][0] if kind == "MultiPolygon" else None
    if not ring:
        return None
    ring = ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else ring
    return (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))


def metres(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Great-circle distance; plenty for matching within a few hundred metres."""
    r = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def normalise_name(name: str) -> str:
    text = name.lower().replace("&", " and ").replace("st.", "st")
    return " ".join(_NAME_NOISE.sub(" ", text).split())


def normalise_zone(value: str | None) -> str | None:
    value = (value or "").strip()
    return value.replace("+", "/") if _ZONE.match(value) else None


def atco_to_naptan(code: str) -> str:
    """OSM carries the ATCO code (9400ZZLUSBM); TfL lists the station (940GZZLUSBM)."""
    return code[:3] + "G" + code[4:] if len(code) > 4 and code[3] == "0" else code


def tfl_stations(payloads: Iterable[Any]) -> dict[str, TflStation]:
    """Stations with a zone and rail lines from TfL StopPoint payloads (by NaPTAN id)."""
    stations: dict[str, TflStation] = {}
    for payload in payloads:
        points = payload.get("stopPoints", []) if isinstance(payload, dict) else payload
        for point in points:
            if point.get("stopType") not in ("NaptanMetroStation", "NaptanRailStation"):
                continue
            naptan = point.get("naptanId") or point.get("id")
            names = {line["id"]: line.get("name") or line["id"] for line in point.get("lines", [])}
            lines = {}
            for group in point.get("lineModeGroups", []):
                mode = group.get("modeName")
                if mode not in RAIL_MODES:
                    continue
                for line_id in group.get("lineIdentifier", []):
                    lines[line_id] = (names.get(line_id, line_id), mode)
            if not lines:
                continue
            zone = next((prop.get("value") for prop in point.get("additionalProperties", [])
                         if prop.get("key") == "Zone"), None)
            station = stations.setdefault(naptan, TflStation(
                naptan, point.get("commonName", ""), float(point["lon"]), float(point["lat"]),
                normalise_zone(zone)))
            station.lines.update(lines)
            station.zone = station.zone or normalise_zone(zone)
    return stations


def _match_tfl(place: Place, tfl: Mapping[str, TflStation]) -> list[TflStation]:
    """TfL stations by the OSM NaPTAN code plus same-named ones nearby (one OSM node
    often stands for the tube and the rail halves); else the nearest within 150 m."""
    by_code = [tfl[n] for n in (atco_to_naptan(code) for code in place.atco) if n in tfl]
    name = normalise_name(place.name or "")
    near = [(metres(place.lon, place.lat, s.lon, s.lat), s) for s in tfl.values()]
    named = [s for d, s in near if d <= MATCH_BY_NAME_METRES and normalise_name(s.name) == name]
    found = by_code + [s for s in named if s not in by_code]
    if found:
        return found
    closest = min(near, key=lambda pair: pair[0], default=None)
    return [closest[1]] if closest and closest[0] <= MATCH_NEAREST_METRES else []


def build_stations(places: Iterable[Place], tfl: Mapping[str, TflStation]) -> list[Station]:
    """One station per name and place, with TfL zone and lines where they match."""
    merged: list[tuple[Station, str]] = []
    for place in sorted((p for p in places if p.category == "station"), key=lambda p: p.osm_id):
        matches = _match_tfl(place, tfl)
        key = normalise_name(place.name or "")
        target = next((station for station, name in merged if name == key
                       and metres(station.lon, station.lat, place.lon, place.lat) <= MERGE_METRES), None)
        if target is None:
            target = Station([], place.name or "", place.lon, place.lat, [], None, [], [])
            merged.append((target, key))
        target.osm_ids.append(place.osm_id)
        modes = [mode for match in matches for _, mode in match.lines.values()] or list(place.modes)
        target.modes = sorted(set(target.modes) | set(modes), key=RAIL_MODES.index)
        known = {line["id"] for line in target.lines}
        for match in matches:
            if match.naptan not in target.tfl_ids:
                target.tfl_ids.append(match.naptan)
            target.zone = target.zone or match.zone
            for line_id, (line_name, mode) in sorted(match.lines.items()):
                if line_id not in known:
                    known.add(line_id)
                    target.lines.append({"id": line_id, "name": line_name, "mode": mode})
    stations = [station for station, _ in merged]
    for station in stations:
        station.lines.sort(key=lambda line: (RAIL_MODES.index(line["mode"]), line["name"]))
    return stations


# Custom criteria (migration 027): every place with one of these keys keeps its raw tags.
POI_KEYS = ("amenity", "shop", "leisure", "tourism", "craft", "healthcare", "office", "club")


def poi(feature: Mapping[str, Any]) -> tuple[str, dict[str, str], float, float] | None:
    """(osm id, tags, lon, lat) for a place a custom criterion can count; None to drop it.

    Tags are every OSM property except osmium's own ``@type``/``@id``; closed (``disused``)
    places and features with none of ``POI_KEYS`` are dropped."""
    props = feature.get("properties") or {}
    point = representative_point(feature.get("geometry") or {})
    tags = {str(key): str(value) for key, value in props.items() if not str(key).startswith("@")}
    if point is None or not any(tags.get(key) for key in POI_KEYS) or tags.get("disused") == "yes":
        return None
    return f"{props.get('@type', 'x')[0]}{props.get('@id')}", tags, point[0], point[1]
