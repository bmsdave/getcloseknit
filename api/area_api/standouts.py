"""What stands out about an area (area-standouts.v1): the area page's 12 fixed tiles,
up to three pros and two cons, and a one-line verdict built from them.

Tiles are the same 12 on every area, in one order (TILES), so pages compare at a glance. Each
carries its value in words and its London standing: 0-100, 100 the better end, among London
neighbourhoods. Price and nightlife are neutral (dearer or busier is not worse): no standing, never
a tag. A tile without a value says so (available false); it is never zero.

Tags are picked by London extremes: a pro is a tile in London's best 10%, a con in its worst 10%;
at most one per topic, then the first three pros and two cons in topic order. Deprivation (the
official Index of Multiple Deprivation, not a tile) makes a tag in London's least or most deprived 10%,
in the same decile words as the People section (owner decision). People, income and social
housing are never tiles or tags: they describe who lives somewhere.
"""
from __future__ import annotations

import bisect
import re
from collections.abc import Callable, Mapping
from typing import Any

from . import coverage, custom_criteria, evidence, feature_flags, places, regions, release_store, school_card, schools
from .scope import of_region

SCHEMA_VERSION = "area-standouts.v1"
WALK_METRES_PER_MINUTE = 80
EXTREME = 10  # London's best or worst 10%
MAX_PROS, MAX_CONS = 3, 2
TAG_SCHOOL_METRES = 1000  # a school tag names a top school this close
NEAR_SITE_METRES = 800  # about ten minutes' walk: the nature tile names the site

# (tile id, label, page section, topic). Topic order breaks ties between tags and allows one tag per topic.
TILES = (
    ("price", "Price", "price", "price"),
    ("safety", "Safety", "safety", "safety"),
    ("schools", "Schools", "schools", "schools"),
    ("station-walk", "Station walk", "getting-around", "transport"),
    ("cycling", "Cycling", "getting-around", "transport"),
    ("noise", "Noise", "environment", "quiet"),
    ("nature", "Nature", "environment", "green"),
    ("air", "Air", "health", "health"),
    ("gp", "GP", "health", "health"),
    ("food-hygiene", "Food hygiene", "local-places", "local"),
    ("nightlife", "Nightlife", "local-places", "local"),
    ("families", "Families", "local-places", "local"),
)
# Deprivation is last, as its People section is on the page; it is a tag, never a tile.
TOPIC_ORDER = ("price", "safety", "schools", "transport", "green", "quiet", "health", "local", "deprivation")

# Verdict words per tile: (pro, con).
VERDICT = {
    "safety": ("very safe", "more crime than most of {place}"),
    "schools": ("a top school close by", None),
    "station-walk": ("close to a station", "a long walk to a station"),
    "cycling": ("good for cycling", "few cycle lanes"),
    "noise": ("quiet", "noisy"),
    "nature": ("green", "little green space"),
    "air": ("cleaner air", "polluted air"),
    "gp": ("a GP close by", "no GP close by"),
    "food-hygiene": ("well-rated food places", "low food hygiene"),
    "families": ("a playground or nursery close by", "far from playgrounds and nurseries"),
    "deprivation": ("among {place}'s least deprived", "among {place}'s most deprived"),
}

# Words with {place}: the area's region, the one its standing is among (London's for a London area).
CAVEATS = [
    "Tags pick what is in {place}'s best or worst 10% of neighbourhoods, at most one per topic; "
    "people, income and social housing never make a tag.",
    "Standing compares this neighbourhood with {place}'s others on the same measure, where 100 is the better end.",
]

# Each metric's newest value here within a year of its newest period in London: an older figure is
# not today's, so the tile says "No data here" rather than show it.
METRICS_SQL = """-- standouts:metrics
WITH latest AS (
  SELECT m.metric_id, (SELECT max(v.period) FROM metric_value v WHERE v.metric_id = m.metric_id) AS period
  FROM unnest(%(metrics)s::text[]) AS m(metric_id)
)
SELECT DISTINCT ON (v.metric_id) v.metric_id, to_char(v.period, 'YYYY-MM') AS period, v.value, v.region_percentile, v.sample_count
FROM metric_value v JOIN latest l ON l.metric_id = v.metric_id
WHERE v.geography_id = %(area)s AND v.value IS NOT NULL AND v.period > l.period - interval '12 months'
ORDER BY v.metric_id, v.period DESC"""

PRICE_YEAR_AGO_SQL = """-- standouts:price-year-ago
SELECT value FROM metric_value
WHERE geography_id = %s AND metric_id = 'price-per-square-metre' AND value IS NOT NULL
  AND period = to_date(%s, 'YYYY-MM') - interval '12 months'"""

TABLES_SQL = """-- standouts:tables
SELECT to_regclass('area_noise') IS NOT NULL AS noise, to_regclass('area_health') IS NOT NULL AS health,
  to_regclass('area_kids') IS NOT NULL AS kids, to_regclass('area_nature') IS NOT NULL AS nature,
  to_regclass('lsoa_station_walk') IS NOT NULL AS walk"""

NOISE_SQL = """-- standouts:noise
SELECT any_55_share, road_lden_median FROM area_noise WHERE geography_id = %s"""
NOISE_LONDON_SQL = """-- standouts:noise-london
SELECT any_55_share AS v FROM area_noise WHERE geography_id LIKE 'uk:lsoa:%%' AND any_55_share IS NOT NULL"""

HEALTH_SQL = """-- standouts:health
SELECT no2, air_pct, gp_practices, gp_nearest_m FROM area_health WHERE geography_id = %s"""
GP_LONDON_SQL = """-- standouts:gp-london
SELECT gp_nearest_m AS v FROM area_health WHERE geography_id LIKE 'uk:lsoa:%%' AND gp_nearest_m IS NOT NULL"""

KIDS_SQL = """-- standouts:kids
SELECT coalesce(protected_km, 0) + coalesce(cycleway_km, 0) AS lanes_km FROM area_kids WHERE geography_id = %s"""
LANES_LONDON_SQL = """-- standouts:lanes-london
SELECT coalesce(protected_km, 0) + coalesce(cycleway_km, 0) AS v FROM area_kids WHERE geography_id LIKE 'uk:lsoa:%%'"""

NATURE_SQL = """-- standouts:nature
SELECT green_share, site_name, site_kind, site_metres, nature_percentile FROM area_nature WHERE geography_id = %s"""

STATION_SQL = """-- standouts:station
SELECT s.name, s.zone FROM lsoa_station_walk w JOIN place_station s ON s.id = replace(w.station_id, 'osm:', '')
WHERE w.geography_id = %s"""

TILE_METRICS = ("price-per-square-metre", "crime", "station-access", "food-hygiene")
# Read for a tag only: the official deprivation decile (a higher London percentile is less deprived).
TAG_METRICS = ("deprivation",)

DEPRIVATION_LONDON_SQL = """-- standouts:deprivation-london
SELECT value AS v FROM metric_value
WHERE metric_id = 'deprivation' AND geography_id LIKE 'uk:lsoa:%%' AND value IS NOT NULL
  AND period = (SELECT max(period) FROM metric_value WHERE metric_id = 'deprivation')"""
# tile: (preset id, formula for the tile). Nightlife stays a count of places inside the area (its tile reads
# "12 places" and a borough sums them), whatever the map measures (per 1,000 residents); Families is the
# preset as it is, the walk to the nearest playground or nursery (closer = the better end).
FAMILIES_DETAIL = "nearest playground or nursery"
PRESETS = {"nightlife": ("nightlife", "count"), "families": ("family", None)}


def area_standouts(reader: evidence.EvidenceReader, area_id: str, cancel: Callable[[], bool] | None = None) -> dict:
    """area-standouts.v1 for one London neighbourhood (LSOA), or a borough or wider neighbourhood (MSOA)
    (borough_standouts.py: the same tiles from its neighbourhoods, standing among its own kind)."""
    evidence._check_cancelled(cancel)
    if schools.AREA_PATTERN.match(area_id or "") and area_id.startswith(("uk:lad:", "uk:msoa:")):
        from . import borough_standouts
        return borough_standouts.borough_standouts(reader, area_id, cancel)
    if not schools.AREA_PATTERN.match(area_id or "") or not area_id.startswith("uk:lsoa:"):
        raise evidence.MalformedQuery(f"standouts are for neighbourhoods (uk:lsoa:…), MSOAs and boroughs: {area_id}")
    with reader._connect() as connection:
        release_id = evidence._active_release(connection, cancel)
        if not list(connection.execute(schools.AREA_EXISTS_SQL, (area_id,))):
            raise evidence.AreaNotFound(f"unknown area: {area_id}")
        raw = load_inputs(connection, release_id, area_id, cancel)
    tiles = build_tiles(raw)
    tags = pick_tags(tiles, raw)
    place = _place(raw)
    return {"schemaVersion": SCHEMA_VERSION, "productReleaseId": release_id, "geographyId": area_id,
            "verdict": verdict(tags, place=place), "tags": tags, "tiles": tiles,
            "withheld": feature_flags.withheld(("laeiAir",)), "caveats": place_words(CAVEATS, place)}


def _place(raw: Mapping[str, Any] | None) -> str:
    """The region the area stands among, by name (load_inputs' "place"); London when unknown."""
    return (raw or {}).get("place") or "London"


def place_words(lines: list[str], place: str) -> list[str]:
    return [line.format(place=place) for line in lines]


def price_tile(reader: evidence.EvidenceReader, area_id: str, cancel: Callable[[], bool] | None = None) -> dict | None:
    """The area view's Price tile alone ({value, period, sales}), for a figure that must match it, such as a saved
    area's "since your last visit" move. A neighbourhood reads its own row as area_standouts does; a borough or MSOA
    takes its tile from borough_standouts (the middle of its neighbourhoods, cached per release). None without one."""
    if area_id.startswith("uk:lsoa:"):
        with reader._connect() as connection:
            rows = list(connection.execute(METRICS_SQL, {"area": area_id, "metrics": ["price-per-square-metre"]}))
        row = next((entry for entry in rows if entry["metric_id"] == "price-per-square-metre"), None)
        return None if row is None else {"value": round(row["value"]), "period": row["period"], "sales": row.get("sample_count")}
    try:
        tiles = area_standouts(reader, area_id, cancel)["tiles"]
    except (evidence.AreaNotFound, evidence.MalformedQuery):
        return None
    tile = next((entry for entry in tiles if entry["id"] == "price" and entry["available"]), None)
    return None if tile is None else {"value": tile["value"], "period": tile["period"], "sales": None}


def load_inputs(connection: Any, release_id: str, area_id: str, cancel: Callable[[], bool] | None = None) -> dict:
    """Everything the tiles read, as plain rows (None where a layer has no row or is not loaded)."""
    metrics = {row["metric_id"]: row for row in connection.execute(METRICS_SQL, {"area": area_id, "metrics": list(TILE_METRICS + TAG_METRICS)})}
    price = metrics.get("price-per-square-metre")
    year_ago = list(connection.execute(PRICE_YEAR_AGO_SQL, (area_id, price["period"]))) if price else []
    tables = list(connection.execute(TABLES_SQL))[0]
    evidence._check_cancelled(cancel)

    def one(flag: str, sql: str) -> Mapping[str, Any] | None:
        rows = list(connection.execute(sql, (area_id,))) if tables[flag] else []
        return rows[0] if rows else None

    # "London" distributions are the area's region's (migration 103): London's for a London area.
    region = regions.area_regions_on(connection).get(area_id)
    in_region = of_region(region).sql_filter("geography_id") if region else ""

    def london(flag: str, key: str, sql: str) -> list[float]:
        if not tables[flag]:
            return []
        return release_store.cached(connection, release_id, ("standouts", key, region),
                                    lambda: sorted(float(row["v"]) for row in connection.execute(sql + in_region)))

    school_rows = list(connection.execute(schools.scoped(schools.AREA_SCHOOLS_SQL), (area_id, schools.NEAR_RADIUS_METRES, schools.NEAR_LIMIT)))
    capped = len(school_rows) >= schools.NEAR_LIMIT
    school_rows = [row for row in school_rows if row["phase"] in ("primary", "secondary")]
    counts = list(connection.execute(schools.scoped(schools.AREA_SCHOOL_COUNTS_SQL), (area_id, schools.NEAR_RADIUS_METRES)))
    badges = school_card.top_badges(connection, release_id, school_rows)
    best = places.best_school_ranks(connection, area_id, release_id)
    evidence._check_cancelled(cancel)
    return {
        "place": coverage.region_name(region) or "London",
        "metrics": metrics,
        "priceYearAgo": year_ago[0]["value"] if year_ago else None,
        "noise": one("noise", NOISE_SQL), "noiseLondon": london("noise", "noise", NOISE_LONDON_SQL),
        "health": one("health", HEALTH_SQL), "gpLondon": london("health", "gp", GP_LONDON_SQL),
        "kids": one("kids", KIDS_SQL), "lanesLondon": london("kids", "lanes", LANES_LONDON_SQL),
        # Deprivation is a tag only: its London decile list makes the tag tie-aware (issue #189).
        # metric_value always exists, so no table gate like the london() helper's.
        "deprivationLondon": release_store.cached(
            connection, release_id, ("standouts", "deprivation", region),
            lambda: sorted(float(row["v"]) for row in connection.execute(DEPRIVATION_LONDON_SQL + in_region))),
        "nature": one("nature", NATURE_SQL),
        "station": one("walk", STATION_SQL),
        "schools": [{"name": row["name"], "phase": row["phase"], "distanceMetres": row["distance_metres"],
                     "outstanding": _outstanding(row["attributes"]),
                     "top": bool((badges.get(row["urn"]) or {}).get("isTop"))} for row in school_rows],
        "schoolCount": (counts[0]["primary_count"] + counts[0]["secondary_count"]) if counts else None,
        "schoolsCapped": capped,
        "bestSchool": max((rank["percentile"] for rank in best.values() if rank), default=None),
        "presets": {tile: _preset(connection, release_id, preset, area_id, formula)
                    for tile, (preset, formula) in PRESETS.items()},
    }


def _outstanding(attributes: Mapping[str, Any] | None) -> bool:
    return any(o.get("measure") == "Overall effectiveness" and o.get("value") == "Outstanding"
               for o in (attributes or {}).get("observations", []))


def preset_criterion(preset_id: str, formula: str | None = None) -> dict | None:
    """A ready-made criterion, normalised, with the tile's own formula where it has one (PRESETS)."""
    found = next((p for p in custom_criteria.presets()["presets"] if p["criterion"]["id"] == preset_id), None)
    if found is None:
        return None
    return custom_criteria.normalise({**found["criterion"], **({"formula": formula} if formula else {})})


def _preset(connection: Any, release_id: str, preset_id: str, area_id: str, formula: str | None = None) -> dict | None:
    """A ready-made places criterion for this area: its value and London percentile (more, or closer, = higher)."""
    criterion = preset_criterion(preset_id, formula)
    if criterion is None:
        return None
    try:
        # A savepoint: a failed read (no places table) must not abort the caller's transaction.
        savepoint = getattr(connection, "transaction", None)
        if savepoint is not None:
            with savepoint():
                values, _, _ = custom_criteria.preset_values(connection, release_id, criterion)
        else:
            values, _, _ = custom_criteria.preset_values(connection, release_id, criterion)
    except Exception:  # noqa: BLE001 - no places table loaded: the tile reads "No data here"
        return None
    ranks = release_store.cached(connection, release_id, ("standouts", "preset", preset_id, criterion["formula"]), lambda: custom_criteria.percentiles(
        {key: value["value"] for key, value in values.items()}, criterion["formula"], regions.area_regions_on(connection)))
    item = values.get(area_id)
    if not item or item["value"] is None:
        return None
    return {"value": item["value"], "percentile": ranks.get(area_id), "radiusMetres": criterion["radiusMetres"]}


def london_rank(sorted_values: list[float], value: float, higher_is_better: bool = True) -> tuple[int, int, int]:
    """(standing, beats, beaten) among London areas: the mid-rank standing (100 = the better end), and the
    percent of areas this one is strictly better and strictly worse than. Ties count for neither, so a
    value many areas share (no cycle lanes at all) is never an extreme."""
    total = len(sorted_values)
    if not total:
        return 50, 0, 0
    below = bisect.bisect_left(sorted_values, value)
    equal = bisect.bisect_right(sorted_values, value) - below
    lower, higher = below / total * 100, (total - below - equal) / total * 100
    mid = (below + equal / 2) / total * 100
    if higher_is_better:
        return round(mid), round(lower), round(higher)
    return round(100 - mid), round(higher), round(lower)


def _extreme(standing: int | None, bounds: tuple[int, int] | None = None) -> str | None:
    """pro in London's best 10%, con in its worst 10% (strictly, when ties are known)."""
    if standing is None:
        return None
    beats, beaten = bounds if bounds else (standing, 100 - standing)
    return "pro" if beats >= 100 - EXTREME else "con" if beaten >= 100 - EXTREME else None


def _tile(tile_id: str, value: Any = None, display: str | None = None, standing: int | None = None,
          detail: str | None = None, trend: dict | None = None, period: str | None = None,
          bounds: tuple[int, int] | None = None) -> dict:
    """One tile. standing: 0-100 with 100 the better end (None for neutral tiles, whose raw London
    percentile is regionPercentile instead); extreme: pro, con or None."""
    _, label, section, topic = next(entry for entry in TILES if entry[0] == tile_id)
    return tile_dict(tile_id, label, section, topic, neutral=tile_id in ("price", "nightlife"), value=value,
                     display=display, standing=standing, detail=detail, trend=trend, period=period, bounds=bounds)


def tile_dict(tile_id: str, label: str, section: str | None, topic: str | None, *, neutral: bool = False,
              value: Any = None, display: str | None = None, standing: int | None = None, detail: str | None = None,
              trend: dict | None = None, period: str | None = None, bounds: tuple[int, int] | None = None) -> dict:
    """A tile from explicit label, section and topic (the area layers' tiles have none in TILES). A neutral
    tile's standing is its raw London percentile, returned as regionPercentile."""
    oriented = None if neutral or standing is None else max(0, min(100, int(standing)))
    return {"id": tile_id, "label": label, "section": section, "topic": topic,
            "available": display is not None, "value": value, "display": display,
            "standing": oriented, "regionPercentile": standing if neutral else None,
            "extreme": None if neutral else _extreme(oriented, bounds),
            "detail": detail, "trend": trend, "period": period}


def _minutes(metres: float) -> int:
    return max(1, round(metres / WALK_METRES_PER_MINUTE))


def site_name(name: str | None) -> str | None:
    """A nature site's name with its designation in capitals: "Crofton Woods Sssi" → "Crofton Woods SSSI"."""
    return None if name is None else re.sub(r"\b(sssi|lnr|nnr)\b", lambda match: match.group(1).upper(), name, flags=re.IGNORECASE)


def london_share(percent: float) -> int:
    """A London share in words, 1-99: an area is part of London, so it is never "more than 100%" (or 0%)
    of it; a rounded 99.6 or 0.4 stays inside the set."""
    return max(1, min(99, round(percent)))


def _distance(metres: float) -> str:
    return f"{round(metres)} m" if metres < 1000 else f"{metres / 1000:.1f} km"


def build_tiles(raw: Mapping[str, Any]) -> list[dict]:
    """The 12 tiles in their fixed order, from load_inputs' rows."""
    metrics = raw.get("metrics") or {}
    tiles = {}

    price = metrics.get("price-per-square-metre")
    if price:
        year_ago = raw.get("priceYearAgo")
        trend = ({"percent": round((price["value"] / year_ago - 1) * 100, 1), "years": 1} if year_ago else None)
        # £/m² to the nearest £100, as everywhere on the page (no false precision).
        tiles["price"] = _tile("price", round(price["value"]), f"£{round(price['value'] / 100) * 100:,}/m²",
                               price["region_percentile"], trend=trend, period=price["period"])

    crime = metrics.get("crime")
    if crime:
        pct = crime["region_percentile"]
        words = None if pct is None else (f"Safer than {london_share(100 - pct)}%" if pct <= 50 else f"More crime than {london_share(pct)}%")
        tiles["safety"] = _tile("safety", round(crime["value"], 1), words or f"{crime['value']:.1f} per 1,000",
                                None if pct is None else 100 - pct, detail="per 1,000 residents a year", period=crime["period"])

    rows = raw.get("schools") or []
    count = raw.get("schoolCount")
    if count is not None:
        outstanding = sum(row["outstanding"] for row in rows)
        tiles["schools"] = _tile("schools", count, f"{count} within 1.5 km", raw.get("bestSchool"),
                                 detail=f"{outstanding} Outstanding" if outstanding and not raw.get("schoolsCapped") else None)

    walk = metrics.get("station-access")
    if walk:
        pct = walk["region_percentile"]
        station = raw.get("station")
        detail = None
        if station:
            detail = station["name"] + (f", zone {station['zone']}" if station.get("zone") else "")
        tiles["station-walk"] = _tile("station-walk", round(walk["value"]), f"{round(walk['value'])} min",
                                      None if pct is None else 100 - pct, detail=detail, period=walk["period"])

    kids = raw.get("kids")
    if kids and kids["lanes_km"] is not None:
        km = float(kids["lanes_km"])
        standing, *bounds = london_rank(raw.get("lanesLondon") or [], km)
        tiles["cycling"] = _tile("cycling", round(km, 1), f"{km:.1f} km lanes" if km else "0 km lanes",
                                 standing, detail="within 1 km", bounds=tuple(bounds))

    noise = raw.get("noise")
    if noise and noise["any_55_share"] is not None:
        share = float(noise["any_55_share"])
        standing, *bounds = london_rank(raw.get("noiseLondon") or [], share, higher_is_better=False)
        tiles["noise"] = _tile("noise", round(share * 100, 1), f"{share * 100:.0f}% over 55 dB", standing,
                               bounds=tuple(bounds), detail=None if noise["road_lden_median"] is None else f"Road median {float(noise['road_lden_median']):.1f} dB")

    nature = raw.get("nature")
    if nature and nature["nature_percentile"] is not None:
        site = nature["site_name"] and nature["site_metres"] is not None and nature["site_metres"] <= NEAR_SITE_METRES
        kind = {"lnr": "Reserve", "nnr": "Reserve", "sssi": "SSSI"}.get(nature["site_kind"] or "", "Nature site")
        display = (f"{kind} {_minutes(nature['site_metres'])} min" if site
                   else f"{round(float(nature['green_share']) * 100)}% green" if nature["green_share"] is not None
                   else f"Greener than {london_share(nature['nature_percentile'])}%")
        tiles["nature"] = _tile("nature", nature["nature_percentile"], display, nature["nature_percentile"],
                                detail=site_name(nature["site_name"]) if site else None)

    health = raw.get("health")
    if health and health["no2"] is not None and feature_flags.air_quality():  # the LAEI grid waits for its flag
        tiles["air"] = _tile("air", round(float(health["no2"]), 1), f"NO₂ {float(health['no2']):.0f} µg/m³",
                             None if health["air_pct"] is None else 100 - round(float(health["air_pct"])))
    if health and health["gp_nearest_m"] is not None:
        metres = float(health["gp_nearest_m"])
        practices = health["gp_practices"]
        standing, *bounds = london_rank(raw.get("gpLondon") or [], metres, higher_is_better=False)
        tiles["gp"] = _tile("gp", int(round(metres, -1)), _distance(metres), standing, bounds=tuple(bounds),
                            detail=(f"{practices} within 1 km" if practices else "None within 1 km") if practices is not None else None)

    food = metrics.get("food-hygiene")
    if food:
        tiles["food-hygiene"] = _tile("food-hygiene", round(food["value"]), f"{round(food['value'])}% rated 4–5",
                                      food["region_percentile"], period=food["period"])

    presets = raw.get("presets") or {}
    # Places are counted inside the area's boundary (custom_criteria.area_values), not within a walk: a small
    # central neighbourhood can truly have none of a kind inside it while one stands across the street.
    found = presets.get("nightlife")
    if found:
        count = round(found["value"])
        tiles["nightlife"] = _tile("nightlife", count, "1 place" if count == 1 else f"{count} places", found["percentile"],
                                   detail=custom_criteria.INSIDE_AREA)
    # Families: the walk to the nearest playground or nursery (its percentile is already "closer = higher").
    found = presets.get("families")
    if found:
        minutes = round(found["value"])
        tiles["families"] = _tile("families", minutes, f"{minutes} min walk", found["percentile"], detail=FAMILIES_DETAIL)

    return [tiles.get(tile_id) or _tile(tile_id) for tile_id, *_ in TILES]


def _tag_text(tile: Mapping[str, Any], kind: str, raw: Mapping[str, Any]) -> str | None:
    """The tag's words, with its number; None when this tile makes no tag of that kind."""
    tile_id, standing, value = tile["id"], tile["standing"], tile["value"]
    place = _place(raw)
    if tile_id == "safety":
        return f"Safer than {london_share(standing)}% of {place}" if kind == "pro" else f"More crime than {london_share(100 - standing)}% of {place}"
    if tile_id == "schools":
        if kind != "pro":
            return None  # a weaker school is the school card's judgement, never an area tag
        near = [row for row in raw.get("schools") or [] if row["top"] and row["distanceMetres"] <= TAG_SCHOOL_METRES]
        if not near:
            return None
        school = min(near, key=lambda row: row["distanceMetres"])
        return f"{'Outstanding' if school['outstanding'] else 'Top'} school {_distance(school['distanceMetres'])}"
    if tile_id == "station-walk":
        if kind == "pro":
            station = raw.get("station")
            return f"{value} min walk to {station['name']}" if station else f"{value} min walk to a station"
        zone = (raw.get("station") or {}).get("zone")
        return f"{value} min walk to a station" + (f", zone {zone}" if zone else "")
    if tile_id == "cycling":
        return f"{value:g} km of cycle lanes within 1 km" if kind == "pro" else (
            "No cycle lanes within 1 km" if not value else "Few cycle lanes nearby")
    if tile_id == "noise":
        return f"Quieter than {london_share(standing)}% of {place}" if kind == "pro" else f"Noisier than {london_share(100 - standing)}% of {place}"
    if tile_id == "nature":
        if kind == "pro":
            return f"{tile['display'].replace('Reserve', 'Nature reserve')}" if tile["detail"] else f"Greener than {london_share(standing)}% of {place}"
        return f"Less green than {london_share(100 - standing)}% of {place}"
    if tile_id == "air":
        return f"Cleaner air than {london_share(standing)}% of {place}" if kind == "pro" else f"More polluted than {london_share(100 - standing)}% of {place}"
    if tile_id == "gp":
        practices = (raw.get("health") or {}).get("gp_practices")
        if kind == "pro":
            return f"GP surgery {tile['display']}"
        return "No GP within 1 km" if practices == 0 else f"Nearest GP {tile['display']}"
    if tile_id == "food-hygiene":
        return f"{value}% of food places rated 4–5" if kind == "pro" else f"Low food hygiene: {value}% rated 4–5"
    if tile_id == "families":
        return f"Playground or nursery {value} min walk" if kind == "pro" else f"{value} min walk to a playground or nursery"
    return None


def deprivation_tag(raw: Mapping[str, Any]) -> tuple[int, dict] | None:
    """(extremity, tag) in London's least (pro) or most (con) deprived 10%, as share-rows.ts words it;
    else None. Tie-aware like every tile: the decile has only 10 distinct values, so the stored
    ties-upper region_percentile would tag ~20% of areas; the tag needs strictly >= 90% of LSOAs
    better (pro) or worse (con)."""
    row = (raw.get("metrics") or {}).get("deprivation")
    if row is None or row.get("value") is None:
        return None
    standing, beats, beaten = london_rank(raw.get("deprivationLondon") or [], row["value"])
    kind = _extreme(standing, (beats, beaten))
    if kind is None:
        return None
    text = f"Among {_place(raw)}'s least deprived 10%" if kind == "pro" else f"Among {_place(raw)}'s most deprived 10%"
    return (standing if kind == "pro" else 100 - standing,
            {"id": "deprivation", "kind": kind, "text": text, "section": "people"})


def pick_tags(tiles: list[Mapping[str, Any]], raw: Mapping[str, Any], text: Callable[..., str | None] | None = None,
              deprivation: Callable[[Mapping[str, Any]], tuple[int, dict] | None] | None = None,
              verdict_words: Mapping[str, tuple[str | None, str | None]] = VERDICT) -> list[dict]:
    """≤ 3 pros then ≤ 2 cons: London's best and worst 10%, the most extreme tile per topic, in topic order.
    A borough passes its own tag words, deprivation tag and verdict words (borough_standouts.py)."""
    text = text or _tag_text
    candidates: dict[tuple[str, str], tuple[int, dict]] = {}
    found = (deprivation or deprivation_tag)(raw)
    if found:
        candidates[(found[1]["kind"], "deprivation")] = found
    for tile in tiles:
        kind, standing = tile["extreme"], tile["standing"]
        if not tile["available"] or kind is None or tile["id"] not in verdict_words:
            continue
        words = text(tile, kind, raw)
        if words is None:
            continue
        extremity = standing if kind == "pro" else 100 - standing
        key = (kind, tile["topic"])
        if key not in candidates or extremity > candidates[key][0]:
            candidates[key] = (extremity, {"id": tile["id"], "kind": kind, "text": words, "section": tile["section"]})
    ordered = sorted(candidates.items(), key=lambda item: TOPIC_ORDER.index(item[0][1]))
    pros = [tag for (kind, _), (_, tag) in ordered if kind == "pro"][:MAX_PROS]
    cons = [tag for (kind, _), (_, tag) in ordered if kind == "con"][:MAX_CONS]
    return pros + cons


def verdict(tags: list[Mapping[str, Any]], vocabulary: Mapping[str, tuple[str | None, str | None]] = VERDICT,
            place: str = "London") -> str:
    """One plain line from the tags: "Very safe and quiet; no GP close by." `place`: the region the area stands
    among."""
    def words(kind: str) -> list[str]:
        index = 0 if kind == "pro" else 1
        return [vocabulary[tag["id"]][index].format(place=place)
                for tag in tags if tag["kind"] == kind and vocabulary[tag["id"]][index]]

    def join(parts: list[str]) -> str:
        return parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + " and " + parts[-1]

    pros, cons = words("pro"), words("con")
    if not pros and not cons:
        return f"Close to {place}'s middle on most measures."
    line = join(pros) if pros else ""
    if cons:
        line = f"{line}; {join(cons)}" if line else join(cons)
    return line[0].upper() + line[1:] + "."
