"""A My match zone opened as a search on the portals.

Each zone kind gets what each portal takes (docs/design/v4-spec.md, D1 check):

  zone kind   Rightmove                       Zoopla                          OnTheMarket
  polygon     draw-a-search (USERDEFINEDAREA)  draw-a-search (polyenc)         postcode districts
  station     draw-a-search: a circle of the  draw-a-search: the same circle  postcode districts
              walk (minutes x 80 m)
  borough     the borough's REGION search     draw-a-search: its outline      postcode districts
              (London; elsewhere in England
              its outline, as Zoopla)
  lsoas       postcode districts              postcode districts              postcode districts

Postcode districts are the fallback for anything a portal does not take, up to 3 per zone (the busiest
first). Every link goes through /go (usage.go_target), which rebuilds the portal URL from these
parameters, so a link can only ever open a portal. The draw formats are unofficial: the weekly link
check (portal_link_check.py) records each portal x kind, and a failed or blocked latest check sends
that pair back to the districts. CLOSE_KNIT_PORTAL_DRAW_OFF=rightmove,zoopla does the same by hand.
"""
from __future__ import annotations

import json
import math
import os
import re
import time
from typing import Any, Callable, Iterable, Mapping
from urllib.parse import quote, urlencode

from .scope import current as current_scope

# A drawn ring may reach this far (degrees of latitude, longitude) past the scope's box: a station circle at its
# edge still fits.
RING_MARGIN = (0.1, 0.2)
MAX_VERTICES = 100  # D1: long URLs are untested; simplify first
MIN_VERTICES = 3
MAX_POLYLINE = 1200
WALK_METRES_PER_MINUTE = 80  # the site's 800 m = a 10-minute walk
CIRCLE_CORNERS = 24
DISTRICTS_PER_ZONE = 3
DRAW_PORTALS = ("rightmove", "zoopla")
PORTAL_LABELS = {"rightmove": "Rightmove", "zoopla": "Zoopla", "onthemarket": "OnTheMarket"}
SEARCH_ID = re.compile(r"^[a-z0-9]{6,32}$")
POLYLINE_CHARS = re.compile(r"^[\x3f-\x7e]+$")
BOROUGH_CODE = re.compile(r"^E090000(0[1-9]|[12]\d|3[0-3])$")

# Rightmove's own region per London borough (its "<name> (London Borough)" place), looked up with its
# typeahead and each search page opened by hand (title "Properties For Sale in <name>").
RIGHTMOVE_BOROUGH_REGIONS = {
    "E09000001": "61224", "E09000002": "61400", "E09000003": "93929", "E09000004": "93932",
    "E09000005": "93935", "E09000006": "93938", "E09000007": "93941", "E09000008": "93944",
    "E09000009": "93947", "E09000010": "93950", "E09000011": "61226", "E09000012": "93953",
    "E09000013": "61407", "E09000014": "61227", "E09000015": "93956", "E09000016": "61228",
    "E09000017": "93959", "E09000018": "93962", "E09000019": "93965", "E09000020": "61229",
    "E09000021": "93968", "E09000022": "93971", "E09000023": "61413", "E09000024": "61414",
    "E09000025": "61231", "E09000026": "61537", "E09000027": "61415", "E09000028": "61518",
    "E09000029": "93974", "E09000030": "61417", "E09000031": "61232", "E09000032": "93977",
    "E09000033": "61233",
}

STATION_SQL = """-- evidence:portal-station
SELECT ST_Y(s.geom) AS latitude, ST_X(s.geom) AS longitude
FROM station s
JOIN product_release_member member ON member.source_release_id = s.source_release_id
WHERE member.release_id = (SELECT release_id FROM active_product_release) AND s.id = %s
LIMIT 1"""

# The borough's outline, simplified to about 100 corners: the exterior ring of its largest part,
# as [latitude, longitude] corners.
BOROUGH_OUTLINE_SQL = """-- evidence:portal-borough-outline
WITH part AS (
  SELECT (ST_Dump(ST_SimplifyPreserveTopology(g.geometry, 0.002))).geom AS geom
  FROM area_geography g WHERE g.id = %s AND g.kind = 'lad'
)
SELECT ST_AsGeoJSON(ST_ExteriorRing(geom)) AS ring FROM part ORDER BY ST_Area(geom) DESC LIMIT 1"""

DISTRICTS_SQL = """-- evidence:portal-zone-districts
SELECT split_part(a.postcode, ' ', 1) AS outcode, COUNT(*) AS addresses
FROM active_product_release active
JOIN product_release_member member ON member.release_id = active.release_id
JOIN address a ON a.source_release_id = member.source_release_id
WHERE a.geography_id = ANY(%s)
GROUP BY 1 ORDER BY addresses DESC, outcode LIMIT %s"""

# Outside London there are no address rows (per-home data is London only): the busiest postcode districts
# of the zone's LSOAs come from the live postcodes in the ONS Postcode Directory instead.
POSTCODE_DISTRICTS_SQL = """-- evidence:portal-zone-postcode-districts
SELECT split_part(p.postcode, ' ', 1) AS outcode, COUNT(*) AS addresses
FROM postcode_civic p
WHERE p.lsoa_code = ANY(%s) AND p.terminated IS NULL
GROUP BY 1 ORDER BY addresses DESC, outcode LIMIT %s"""

LATEST_CHECK_SQL = """-- usage:portal-link-check-latest
SELECT DISTINCT ON (portal, kind) portal, kind, ok
FROM portal_link_check ORDER BY portal, kind, checked_at DESC"""


# ---- Encoded polylines (Google's format, precision 5, latitude then longitude) ------------------------

def _encode_value(value: int) -> str:
    value = ~(value << 1) if value < 0 else value << 1
    out = []
    while value >= 0x20:
        out.append(chr((0x20 | (value & 0x1F)) + 63))
        value >>= 5
    out.append(chr(value + 63))
    return "".join(out)


def encode_polyline(points: Iterable[Iterable[float]]) -> str:
    """[latitude, longitude] corners as an encoded polyline, the ring closed (D1: both portals want that)."""
    corners = [(float(lat), float(lon)) for lat, lon in points]
    if corners and corners[0] != corners[-1]:
        corners.append(corners[0])
    out, last_lat, last_lon = [], 0, 0
    for lat, lon in corners:
        lat_e5, lon_e5 = round(lat * 1e5), round(lon * 1e5)
        out.append(_encode_value(lat_e5 - last_lat) + _encode_value(lon_e5 - last_lon))
        last_lat, last_lon = lat_e5, lon_e5
    return "".join(out)


def decode_polyline(text: str) -> list[tuple[float, float]]:
    """The corners of an encoded polyline; ValueError when it is not one."""
    if not text or len(text) > MAX_POLYLINE or not POLYLINE_CHARS.match(text):
        raise ValueError("not an encoded polyline")
    numbers, value, shift = [], 0, 0
    for char in text:
        byte = ord(char) - 63
        value |= (byte & 0x1F) << shift
        shift += 5
        if byte < 0x20:
            numbers.append(~(value >> 1) if value & 1 else value >> 1)
            value, shift = 0, 0
    if shift or len(numbers) % 2:
        raise ValueError("truncated polyline")
    points, lat, lon = [], 0, 0
    for index in range(0, len(numbers), 2):
        lat += numbers[index]
        lon += numbers[index + 1]
        points.append((lat / 1e5, lon / 1e5))
    return points


def ring_box() -> dict[str, tuple[float, float]]:
    """Where a drawn ring may sit: around the scope's box (London's, or England's with CLOSE_KNIT_ENGLAND)."""
    west, south, east, north = current_scope().bbox
    return {"latitude": (south - RING_MARGIN[0], north + RING_MARGIN[0]),
            "longitude": (west - RING_MARGIN[1], east + RING_MARGIN[1])}


def valid_ring(points: list[tuple[float, float]]) -> bool:
    """A closed ring of 3 to MAX_VERTICES corners, every one in and around the coverage (London or England)."""
    corners = points[:-1] if len(points) > 1 and points[0] == points[-1] else points
    box = ring_box()
    return (MIN_VERTICES <= len(corners) <= MAX_VERTICES
            and all(box["latitude"][0] <= lat <= box["latitude"][1] and box["longitude"][0] <= lon <= box["longitude"][1]
                    for lat, lon in corners))


def thin_ring(points: list[tuple[float, float]], limit: int = MAX_VERTICES) -> list[tuple[float, float]]:
    """At most `limit` corners (the ring open), keeping evenly spaced ones."""
    corners = points[:-1] if len(points) > 1 and points[0] == points[-1] else list(points)
    if len(corners) <= limit:
        return corners
    step = len(corners) / limit
    return [corners[int(index * step)] for index in range(limit)]


def circle_ring(latitude: float, longitude: float, metres: float, corners: int = CIRCLE_CORNERS) -> list[tuple[float, float]]:
    """A circle of `metres` around a point, as [latitude, longitude] corners (accurate enough for a search)."""
    dlat = metres / 111_320
    dlon = metres / (111_320 * math.cos(math.radians(latitude)))
    return [(round(latitude + dlat * math.sin(2 * math.pi * i / corners), 5),
             round(longitude + dlon * math.cos(2 * math.pi * i / corners), 5)) for i in range(corners)]


# ---- Portal URLs (the D1 formats) -------------------------------------------------------------------

def draw_url(portal: str, market: str, polyline: str, max_price: int, beds: int) -> str | None:
    """A portal's draw-a-search page for an encoded polygon; None for a portal without one."""
    if portal == "rightmove":
        identifier = quote('USERDEFINEDAREA^{"polylines":"' + polyline + '"}', safe="")
        page = "property-for-sale" if market == "buy" else "property-to-rent"
        return (f"https://www.rightmove.co.uk/{page}/map.html?locationIdentifier={identifier}"
                f"&maxPrice={max_price}&minBedrooms={beds}")
    if portal == "zoopla":
        # The list view: the map view showed "0 results" behind the cookie banner (D1).
        if market == "buy":
            return (f"https://www.zoopla.co.uk/for-sale/property/london/?polyenc={quote(polyline, safe='')}"
                    f"&price_max={max_price}&beds_min={beds}&q=London&search_source=for-sale")
        return (f"https://www.zoopla.co.uk/to-rent/property/london/?polyenc={quote(polyline, safe='')}"
                f"&price_frequency=per_month&price_max={max_price}&beds_min={beds}&q=London&search_source=to-rent")
    return None


def borough_url(portal: str, market: str, borough: str, max_price: int, beds: int) -> str | None:
    """Rightmove's own search for a London borough (E09 code); None elsewhere."""
    region = RIGHTMOVE_BOROUGH_REGIONS.get(borough)
    if portal != "rightmove" or region is None:
        return None
    page = "property-for-sale" if market == "buy" else "property-to-rent"
    return (f"https://www.rightmove.co.uk/{page}/find.html?locationIdentifier=REGION%5E{region}"
            f"&maxPrice={max_price}&minBedrooms={beds}")


def with_search_id(url: str, search_id: str | None) -> str:
    """The My match search id for the Close Knit extension, as a fragment: the portal's server never sees it."""
    return f"{url}#closeknit={search_id}" if search_id and SEARCH_ID.match(search_id) else url


def zone_target(portal: str, market: str, params: Mapping[str, str], max_price: int, beds: int) -> str | None:
    """The portal URL for a /go?kind=zone request (shape=draw with poly=, or shape=borough with borough=)."""
    shape = params.get("shape")
    if shape == "draw":
        try:
            points = decode_polyline(params.get("poly") or "")
        except ValueError:
            return None
        if not valid_ring(points):
            return None
        return draw_url(portal, market, encode_polyline(points[:-1] if points[0] == points[-1] else points), max_price, beds)
    if shape == "borough":
        borough = params.get("borough") or ""
        return borough_url(portal, market, borough, max_price, beds) if BOROUGH_CODE.match(borough) else None
    return None


def go_zone_url(portal: str, *, market: str, max_price: int, beds: int, poly: str | None = None,
                borough: str | None = None, source: str = "web", base: str = "") -> str:
    query: dict[str, Any] = {"kind": "zone", "market": market, "max_price": max_price, "beds": beds, "from": source}
    if poly is not None:
        query.update(shape="draw", poly=poly)
    else:
        query.update(shape="borough", borough=borough)
    return f"{base.rstrip('/')}/go/{portal}?{urlencode(query)}"


# ---- Which draw formats are on --------------------------------------------------------------------

_check_cache: tuple[float, dict[tuple[str, str], bool]] | None = None
CHECK_TTL_SECONDS = 600.0


def _latest_checks(connect: Callable[[], Any] | None) -> dict[tuple[str, str], bool]:
    """The latest weekly link check per (portal, kind); empty without the table (nothing checked yet)."""
    global _check_cache
    now = time.monotonic()
    if _check_cache and now - _check_cache[0] < CHECK_TTL_SECONDS:
        return _check_cache[1]
    found: dict[tuple[str, str], bool] = {}
    if connect is not None:
        try:
            with connect() as connection:
                found = {(row["portal"], row["kind"]): bool(row["ok"]) for row in connection.execute(LATEST_CHECK_SQL)}
        except Exception:  # noqa: BLE001 - no table yet (migration 072) or no database: every format stays on
            found = {}
    _check_cache = (now, found)
    return found


def format_on(portal: str, kind: str, connect: Callable[[], Any] | None = None) -> bool:
    """Off when CLOSE_KNIT_PORTAL_DRAW_OFF names the portal, or its latest check for this kind failed."""
    off = {name.strip() for name in os.environ.get("CLOSE_KNIT_PORTAL_DRAW_OFF", "").split(",") if name.strip()}
    if portal in off:
        return False
    return _latest_checks(connect).get((portal, kind), True)


# ---- Links for a search's zones ------------------------------------------------------------------

def _zone_label(zone: Mapping[str, Any]) -> str:
    if zone.get("label"):
        return str(zone["label"])
    return {"station": "Near a station", "borough": "A borough", "polygon": "An area you drew"}.get(zone["kind"], "Chosen areas")


def _outline(connection: Any, borough_id: str) -> list[tuple[float, float]]:
    rows = list(connection.execute(BOROUGH_OUTLINE_SQL, (borough_id,)))
    if not rows or not rows[0]["ring"]:
        return []
    return thin_ring([(lat, lon) for lon, lat in json.loads(rows[0]["ring"])["coordinates"]])


def _station(connection: Any, station_id: str) -> tuple[float, float] | None:
    rows = list(connection.execute(STATION_SQL, (station_id,)))
    return (rows[0]["latitude"], rows[0]["longitude"]) if rows else None


def zone_links(connection: Any, zones: list[Mapping[str, Any]], market: str, max_price: int, beds: int,
               zone_lsoas: Callable[[Any, list], set[str] | None],
               connect: Callable[[], Any] | None = None) -> list[dict]:
    """Per zone: one link per portal that takes its shape (draw or borough search), and up to 3 postcode
    districts with a link per portal for the rest (and for every portal when nothing else holds)."""
    from . import usage  # usage imports home_search, which imports nothing from here

    out = []
    for zone in zones:
        kind = zone["kind"]
        poly: str | None = None
        if kind == "polygon":
            poly = encode_polyline(zone["points"])
        elif kind == "station":
            centre = _station(connection, zone["stationId"])
            if centre:
                poly = encode_polyline(circle_ring(*centre, zone["maxWalkMinutes"] * WALK_METRES_PER_MINUTE))
        elif kind == "borough":
            outline = _outline(connection, zone["id"])
            if len(outline) >= MIN_VERTICES:
                poly = encode_polyline(outline)
        borough = zone["id"].split(":")[-1] if kind == "borough" else None
        portals = []
        for portal in PORTAL_LABELS:
            href = None
            if portal == "rightmove" and borough in RIGHTMOVE_BOROUGH_REGIONS and format_on(portal, "borough", connect):
                href = go_zone_url(portal, market=market, max_price=max_price, beds=beds, borough=borough)
            elif portal in DRAW_PORTALS and poly and format_on(portal, "draw", connect):
                href = go_zone_url(portal, market=market, max_price=max_price, beds=beds, poly=poly)
            portals.append({"portal": portal, "label": PORTAL_LABELS[portal], "href": href})
        lsoas = sorted(zone_lsoas(connection, [zone]) or [])
        outcodes = [row["outcode"] for row in connection.execute(DISTRICTS_SQL, (lsoas, DISTRICTS_PER_ZONE))] if lsoas else []
        if lsoas and not outcodes and current_scope().level == "nation":  # London answers as before
            codes = [lsoa.split(":")[-1] for lsoa in lsoas]
            outcodes = [row["outcode"] for row in connection.execute(POSTCODE_DISTRICTS_SQL, (codes, DISTRICTS_PER_ZONE))]
        districts = [{"outcode": outcode, "links": {
            portal: usage.go_url("", portal, outcode=outcode, market=market, max_price=max_price,
                                 min_bedrooms=beds, source="web") for portal in PORTAL_LABELS}} for outcode in outcodes]
        out.append({"kind": kind, "label": _zone_label(zone), "portals": portals, "districts": districts})
    return out
