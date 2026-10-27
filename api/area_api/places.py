"""Getting around and nearby: stations, parks, everyday places and a 1-10 score.

Rows come from migration 017 (pipelines/area-analytics-ingest/area_analytics/
places_load.py): OpenStreetMap locations with TfL fare zones and lines.
Distances are straight lines from the area's centroid or, with ?uprn=, from
the home's OS Open UPRN point. When no places are loaded the payload says
``available: false`` and every list is empty, so "unknown" never reads as
"nothing nearby".

Connectivity score (1-10), in plain words: add up the stations within about a
15-minute walk (1,200 m). A station within 400 m counts fully; further away it
counts less and less, down to nothing at 1,200 m. Each line at a station adds
to its value: tube, Elizabeth line, DLR and Overground lines count 1 (trains
every few minutes), trams 0.7 and National Rail services 0.6 (fewer trains);
one station counts at most 4. The total maps onto 1-10 on a square-root
curve, so the first station nearby lifts the score most: 1 means no station
within 1,200 m and 10 is reached at SCORE_CAP points (the best-connected
twentieth of London LSOAs, 2026-10 calibration: median LSOA 1.0 point -> 5).
Buses are not counted.
"""
from __future__ import annotations

import math
import re
from typing import Any, Callable, Iterable, Mapping

SCHEMA_VERSION = "area-places.v1"
AREA_PATTERN = re.compile(r"^uk:(lsoa|msoa|lad):E0[0-9]{7}$")
UPRN_PATTERN = re.compile(r"^[0-9]{1,12}$")

STATION_SEARCH_METRES = 3000
STATION_LIMIT = 6
PARK_SEARCH_METRES = 2000
PARK_LIMIT = 6
AMENITY_SEARCH_METRES = 1500
AMENITY_NEAREST = 5
WALK_METRES = 800  # about a 10-minute walk
AMENITY_GROUPS = ("groceries", "pubs", "food", "pharmacies", "gps", "gyms", "pools", "cafes", "bars")

SCORE_RADIUS_METRES = 1200
FULL_CREDIT_METRES = 400
MODE_WEIGHT = {"tube": 1.0, "elizabeth-line": 1.0, "dlr": 1.0, "overground": 1.0,
               "tram": 0.7, "national-rail": 0.6}
STATION_CAP = 4.0
SCORE_CAP = 6.0
# London Plan open space hierarchy (Table 8.1), in hectares.
SIZE_CLASSES = ((0.4, "pocket"), (2, "small"), (20, "local"), (60, "district"),
                (400, "metropolitan"), (float("inf"), "regional"))

AREA_ORIGIN_SQL = """-- places:area-origin
SELECT ST_X(c) AS lon, ST_Y(c) AS lat
FROM (SELECT ST_Centroid(geometry) AS c FROM area_geography WHERE id = %s) a"""

HOME_ORIGIN_SQL = """-- places:home-origin
SELECT ST_X(p.location) AS lon, ST_Y(p.location) AS lat FROM property p
WHERE p.uprn = %s AND NOT EXISTS (SELECT 1 FROM suppressed_dwelling d WHERE d.uprn = p.uprn)"""

RELEASES_SQL = """-- places:releases
SELECT s.id, s.licence, s.attribution, s.caveats FROM source_release s
WHERE s.id IN (SELECT source_release_id FROM place_station
               UNION SELECT tfl_source_release_id FROM place_station)
ORDER BY s.id"""

_POINT = "ST_SetSRID(ST_MakePoint(%(lon)s, %(lat)s), 4326)::geography"


def _bearing(target: str) -> str:
    """Whole degrees clockwise from north, origin to target (geodesic); NULL
    when they coincide, e.g. an origin inside a park."""
    return f"mod(round(degrees(ST_Azimuth({_POINT}, ({target})::geography)))::integer, 360)"

STATIONS_SQL = f"""-- places:stations
SELECT s.name, s.modes, s.zone, s.lines,
  round(ST_Distance(s.location::geography, {_POINT}))::integer AS distance_metres,
  {_bearing("s.location")} AS bearing_degrees
FROM place_station s
WHERE ST_DWithin(s.location::geography, {_POINT}, %(radius)s)
ORDER BY distance_metres, s.name
LIMIT 40"""

PARKS_SQL = f"""-- places:parks
SELECT * FROM (
  SELECT DISTINCT ON (lower(p.name)) p.name, p.kind, p.area_hectares,
    round(ST_Distance(p.geometry::geography, {_POINT}))::integer AS distance_metres,
    {_bearing("ST_ClosestPoint(p.geometry, " + _POINT + "::geometry)")} AS bearing_degrees
  FROM place_park p
  WHERE ST_DWithin(p.geometry::geography, {_POINT}, %(radius)s)
  ORDER BY lower(p.name), distance_metres, p.area_hectares DESC
) named
ORDER BY distance_metres, area_hectares DESC
LIMIT %(limit)s"""

# Lifestyle groups are raw OpenStreetMap counts drawn from the loaded rows (places.py in the
# ingest): cafes and bars also stay in food and pubs; gyms are fitness centres plus sports
# centres with sport=fitness; pools are the ingest's public pools (named or access-tagged
# swimming pools, water parks, sports centres with sport=swimming), which may also be gyms.
_GROUPS = """CASE
    WHEN a.kind = 'cafe' THEN ARRAY['food', 'cafes']
    WHEN a.kind = 'bar' THEN ARRAY['pubs', 'bars']
    WHEN a.amenity_group <> 'leisure' THEN ARRAY[a.amenity_group]
    ELSE array_remove(ARRAY[
      CASE WHEN a.kind = 'gym' OR (a.kind IN ('sports-centre', 'pool')
           AND 'fitness' = ANY (string_to_array(replace(a.sport, ' ', ''), ';'))) THEN 'gyms' END,
      CASE WHEN a.kind = 'pool' THEN 'pools' END], NULL)
  END"""

AMENITIES_SQL = f"""-- places:amenities
SELECT amenity_group, name, kind, distance_metres, bearing_degrees, walk_count FROM (
  SELECT g.amenity_group, a.name, a.kind, d.distance_metres, {_bearing("a.location")} AS bearing_degrees,
    row_number() OVER (PARTITION BY g.amenity_group ORDER BY d.distance_metres, a.id) AS rank,
    count(*) FILTER (WHERE d.distance_metres <= %(walk)s) OVER (PARTITION BY g.amenity_group) AS walk_count
  FROM place_amenity a
  CROSS JOIN LATERAL unnest({_GROUPS}) g(amenity_group)
  CROSS JOIN LATERAL (SELECT round(ST_Distance(a.location::geography, {_POINT}))::integer AS distance_metres) d
  WHERE ST_DWithin(a.location::geography, {_POINT}, %(radius)s)
) ranked
WHERE rank <= %(limit)s
ORDER BY amenity_group, distance_metres"""


# London ranks for the Overview ratings (migration 054, area_rank): each LSOA's
# percent_rank 0-100 among London LSOAs, lowest raw value = 0; the best-primary percentile
# is the school's among London primaries. higherIsBetter tells the reader which end is good.
LONDON_RANK_TABLE_SQL = """-- places:london-rank-table
SELECT to_regclass('area_rank') IS NOT NULL AS t"""

LONDON_RANKS_SQL = """-- places:london-ranks
SELECT r.rank_id, r.value, r.region_percentile, r.ranked, r.detail, r.source_release_id,
  s.licence, s.attribution, s.source_url
FROM area_rank r LEFT JOIN source_release s ON s.id = r.source_release_id
WHERE r.geography_id = %s
ORDER BY r.rank_id"""

# rank_id -> (payload key, higher raw value is better, unit of `value`)
LONDON_RANKS = {
    "station-walk": ("gettingAround", False, "minutes"),
    "quiet": ("quiet", False, "share"),
    "park-distance": ("greenSpace", False, "metres"),
    "best-primary": ("bestPrimary", True, "percent"),
}


def london_rank_item(row: Mapping[str, Any]) -> dict | None:
    """One rank, or None when the stored percentile is not a usable 0-100 number."""
    _, higher_is_better, unit = LONDON_RANKS[row["rank_id"]]
    percentile = row["region_percentile"]
    if percentile is None or not 0 <= percentile <= 100 or row["value"] is None:
        return None
    item = {"percentile": int(percentile), "higherIsBetter": higher_is_better,
            "value": round(float(row["value"]), 3), "unit": unit, "ranked": int(row["ranked"]),
            "sourceReleaseId": row["source_release_id"]}
    if row["rank_id"] == "best-primary":
        detail = row["detail"] or {}
        if detail.get("urn") is None:
            return None  # a rank about no named school is not shown
        item["school"] = {"urn": str(detail.get("urn")), "name": detail.get("name"),
                          "distanceMetres": detail.get("distanceMetres"),
                          "academicYear": detail.get("academicYear")}
    return item


def london_ranks_payload(rows: Iterable[Mapping[str, Any]]) -> dict:
    """Every rank key present, null when the LSOA has no row; sources once each."""
    ranks: dict[str, Any] = {key: None for key, _, _ in LONDON_RANKS.values()}
    sources: list[dict] = []
    for row in rows:
        if row["rank_id"] not in LONDON_RANKS:
            continue
        item = london_rank_item(row)
        ranks[LONDON_RANKS[row["rank_id"]][0]] = item
        if item and row["licence"] and all(s["id"] != row["source_release_id"] for s in sources):
            sources.append({"id": row["source_release_id"], "licence": row["licence"],
                            "attribution": row["attribution"], "url": row.get("source_url")})
    return {"scope": "london-lsoa", **ranks, "sources": sorted(sources, key=lambda s: s["id"])}


def london_ranks(connection: Any, area_id: str) -> dict | None:
    """London ranks of an LSOA; None for MSOAs and boroughs (ranked among LSOAs only) and
    before migration 054, so a missing rank is unknown, never a guessed score."""
    if not area_id.startswith("uk:lsoa:"):
        return None
    if not list(connection.execute(LONDON_RANK_TABLE_SQL))[0]["t"]:
        return None
    return london_ranks_payload(connection.execute(LONDON_RANKS_SQL, (area_id,)))


# Best nearby schools at request time, ranked as the school card ranks them
# (school_card.london_pool): each phase's headline measure (KS2 expected standard in
# reading, writing and maths; Attainment 8) in its latest London year, among state
# schools within schools.PROFILE_RADIUS_METRES of the area's point on surface, the
# radius every school count uses. Works for LSOAs and for the MSOA a fallback
# neighbourhood is answered by, before and after migration 054.
BEST_SCHOOLS_SQL = """-- places:best-schools
WITH area AS (
  SELECT ST_PointOnSurface(geometry) AS geom, ST_PointOnSurface(geometry)::geography AS point
  FROM area_geography WHERE id = %(area)s
)
SELECT s.urn, s.name, s.phase, s.region_code,
  round(ST_Distance(s.location::geography, area.point))::integer AS distance_metres
FROM area JOIN school s ON s.location && ST_Expand(area.geom, 0.02)
  AND ST_DWithin(s.location::geography, area.point, %(radius)s)
WHERE s.phase IN ('primary', 'secondary') AND /*school-scope:s*/TRUE"""

BEST_SCHOOL_KEYS = {"primary": ("bestPrimary", "percent"), "secondary": ("bestSecondary", "points")}


def best_school(pool: Any, rows: Iterable[Mapping[str, Any]], phase: str) -> dict | None:
    """The phase's nearby school with the highest percentile in its region's pool on its headline measure
    (ties: the nearer, then the lower URN); None when no nearby school has one. `pool` is one pool or
    {region code: pool} (a school's region's pool; London's when the row has none)."""
    from .school_card import LONDON_REGION, PHASE_RULES

    def pool_of(row: Mapping[str, Any]) -> Any:
        return pool[row.get("region_code") or LONDON_REGION] if isinstance(pool, Mapping) else pool

    headline = PHASE_RULES[phase][0]
    ranked = [(percentile, row) for row in rows if row["phase"] == phase
              and (percentile := pool_of(row).percentile(phase, headline, pool_of(row).latest_year(phase, headline),
                                                         str(row["urn"]))) is not None]
    if not ranked:
        return None
    percentile, row = min(ranked, key=lambda item: (-item[0], item[1]["distance_metres"], str(item[1]["urn"])))
    if not 0 <= percentile <= 100:
        return None
    pool = pool_of(row)
    year = pool.latest_year(phase, headline)
    urn = str(row["urn"])
    return {"percentile": int(round(percentile)), "higherIsBetter": True,
            "value": round(pool.value(phase, headline, year, urn), 3), "unit": BEST_SCHOOL_KEYS[phase][1],
            "ranked": pool.sizes[(phase, headline, year)], "sourceReleaseId": None,
            "school": {"urn": urn, "name": row["name"], "distanceMetres": row["distance_metres"],
                       "academicYear": year}}


def best_school_ranks(connection: Any, area_id: str, release_id: str) -> dict:
    """bestPrimary and bestSecondary for an LSOA or MSOA; both None for a borough or no schools."""
    best = {key: None for key, _ in BEST_SCHOOL_KEYS.values()}
    if not area_id.startswith(("uk:lsoa:", "uk:msoa:")):
        return best
    from . import school_card, schools

    rows = list(connection.execute(schools.scoped(BEST_SCHOOLS_SQL), {"area": area_id, "radius": schools.PROFILE_RADIUS_METRES}))
    if not rows:
        return best
    pools = {region: school_card.london_pool(connection, release_id, region)
             for region in {row.get("region_code") or school_card.LONDON_REGION for row in rows}}
    return {key: best_school(pools, rows, phase) for phase, (key, _) in BEST_SCHOOL_KEYS.items()}


def with_best_schools(ranks: dict | None, best: Mapping[str, Any]) -> dict | None:
    """The London ranks with the request-time best schools: bestSecondary always from here,
    bestPrimary from migration 054 when it has one. An area with no London ranks (an MSOA,
    or before the migration) gets ranks holding its schools alone; the rest stay null."""
    if ranks is None:
        if not any(best.values()):
            return None
        ranks = london_ranks_payload([])
    return {**ranks, "bestPrimary": ranks["bestPrimary"] or best["bestPrimary"],
            "bestSecondary": best["bestSecondary"]}


def with_bearing(item: dict, row: Mapping[str, Any]) -> dict:
    """Adds bearingDegrees when the row knows the direction; otherwise leaves it out."""
    bearing = row.get("bearing_degrees")
    return item if bearing is None else {**item, "bearingDegrees": int(bearing)}


def size_class(hectares: float | None) -> str | None:
    if hectares is None:
        return None
    return next(name for limit, name in SIZE_CLASSES if hectares < limit)


def station_points(distance_metres: float, lines: Iterable[Mapping[str, Any]], modes: Iterable[str]) -> float:
    """What one station adds to the score: closeness times its (capped) lines."""
    if distance_metres > SCORE_RADIUS_METRES:
        return 0.0
    closeness = 1.0 if distance_metres <= FULL_CREDIT_METRES else (
        (SCORE_RADIUS_METRES - distance_metres) / (SCORE_RADIUS_METRES - FULL_CREDIT_METRES))
    service = sum(MODE_WEIGHT.get(line.get("mode"), 0.0) for line in lines)
    if service == 0:  # no TfL lines known: count one line of its best mode
        service = max((MODE_WEIGHT.get(mode, 0.0) for mode in modes), default=0.0)
    return closeness * min(service, STATION_CAP)


def connectivity_score(points: float) -> int:
    """1 for no station in reach, 10 from SCORE_CAP points; the square root makes the
    first nearby station matter more than the fifth."""
    # floor(x + 0.5) rounds halves up, as Math.round does in web/src/lib/places.ts.
    return 1 + math.floor(9 * math.sqrt(min(max(points, 0.0), SCORE_CAP) / SCORE_CAP) + 0.5)


def connectivity(stations: Iterable[Mapping[str, Any]]) -> dict:
    """1-10 from stations with distanceMetres, lines and modes (see module doc)."""
    counted = [s for s in stations if s["distanceMetres"] <= SCORE_RADIUS_METRES]
    points = sum(station_points(s["distanceMetres"], s.get("lines", []), s.get("modes", [])) for s in counted)
    return {"score": connectivity_score(points), "points": round(points, 2), "stationsCounted": len(counted),
            "radiusMetres": SCORE_RADIUS_METRES}


def places_payload(area_id: str, release_id: str, uprn: str | None, releases: list[Mapping[str, Any]],
                   stations: list[Mapping[str, Any]], parks: list[Mapping[str, Any]],
                   amenities: list[Mapping[str, Any]]) -> dict:
    available = bool(releases)
    station_list = [with_bearing({"name": row["name"], "modes": list(row["modes"]), "zone": row["zone"],
                                  "lines": list(row["lines"] or []), "distanceMetres": row["distance_metres"]}, row)
                    for row in stations]
    groups = []
    if available:
        for group in AMENITY_GROUPS:
            rows = [row for row in amenities if row["amenity_group"] == group]
            groups.append({
                "group": group,
                "countWithinWalk": int(rows[0]["walk_count"]) if rows else 0,
                "nearest": [with_bearing({"name": row["name"], "kind": row["kind"],
                                          "distanceMetres": row["distance_metres"]}, row)
                            for row in rows],
            })
    caveats: list[str] = []
    for release in releases:
        caveats += [caveat for caveat in release["caveats"] if caveat not in caveats]
    return {
        "schemaVersion": SCHEMA_VERSION,
        "productReleaseId": release_id,
        "geographyId": area_id,
        "origin": {"kind": "home" if uprn else "area-centre", "uprn": uprn},
        "available": available,
        "stations": station_list[:STATION_LIMIT],
        "parks": [with_bearing({"name": row["name"], "kind": row["kind"],
                                "areaHectares": round(float(row["area_hectares"]), 2),
                                "sizeClass": size_class(float(row["area_hectares"])),
                                "distanceMetres": row["distance_metres"]}, row)
                  for row in parks],
        "walkRadiusMetres": WALK_METRES,
        "amenities": groups,
        "connectivity": connectivity(station_list) if available else None,
        "sources": [{"id": r["id"], "licence": r["licence"], "attribution": r["attribution"]} for r in releases],
        "caveats": caveats,
    }


def area_places(connect: Callable[[], Any], area_id: str, uprn: str | None = None,
                cancel: Callable[[], bool] | None = None) -> dict:
    """Stations, parks, amenities and the score for an area centroid or a home."""
    from . import evidence

    evidence._check_cancelled(cancel)
    if not AREA_PATTERN.match(area_id or ""):
        raise evidence.MalformedQuery(f"invalid area id: {area_id}")
    if uprn is not None and not UPRN_PATTERN.match(uprn):
        raise evidence.MalformedQuery(f"invalid UPRN: {uprn}")
    with connect() as connection:
        release_id = evidence._active_release(connection, cancel)
        origin = list(connection.execute(AREA_ORIGIN_SQL, (area_id,)))
        if not origin or origin[0]["lon"] is None:
            raise evidence.AreaNotFound(f"unknown area: {area_id}")
        if uprn:
            home = list(connection.execute(HOME_ORIGIN_SQL, (uprn,)))
            if not home:
                raise evidence.PropertyNotFound(f"unknown property: {uprn}")
            origin = home
        point = {"lon": float(origin[0]["lon"]), "lat": float(origin[0]["lat"])}
        releases = list(connection.execute(RELEASES_SQL))
        if not releases:
            return places_payload(area_id, release_id, uprn, [], [], [], [])
        evidence._check_cancelled(cancel)
        stations = list(connection.execute(STATIONS_SQL, {**point, "radius": STATION_SEARCH_METRES}))
        parks = list(connection.execute(PARKS_SQL, {**point, "radius": PARK_SEARCH_METRES, "limit": PARK_LIMIT}))
        evidence._check_cancelled(cancel)
        amenities = list(connection.execute(AMENITIES_SQL, {
            **point, "radius": AMENITY_SEARCH_METRES, "walk": WALK_METRES, "limit": AMENITY_NEAREST}))
        return places_payload(area_id, release_id, uprn, releases, stations, parks, amenities)
