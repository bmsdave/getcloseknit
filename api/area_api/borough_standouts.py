"""A borough's standouts: the area page's 12 fixed tiles, tags and verdict for a London
borough, and each of its neighbourhoods' price, crime and school standing for the borough page's
Areas list. A wider neighbourhood (MSOA: the map's one area view) gets the same tiles from its
own neighbourhoods, standing among London's MSOAs, with tags in "of London" words.

A borough tile's value is the middle (median) of its neighbourhoods' values, said so ("11 min median");
crime and the school count are the borough's own, and the Nightlife tile counts every
place inside the borough (each neighbourhood counts the places inside its own boundary, so they add up). Its standing places that value among London's boroughs (0-100, 100 the
better end); price and nightlife stay neutral (a London position, never a tag). Tags pick a borough in
the best or worst 10% of boroughs, at most one per topic, as on the area page. People, income and
social housing are never tiles or tags; deprivation is a tag only (owner decision).

Everything is read for all of London once per release (one pass over each layer) and cached, so a
borough page costs a dictionary lookup after the first.
"""
from __future__ import annotations

import statistics
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping
from typing import Any

from . import coverage, custom_criteria, evidence, feature_flags, kinds, regions, release_store, schools, standouts

CARRIER = kinds.LAD

LSOAS_SQL = """-- borough-standouts:lsoas
SELECT l.id AS lsoa, m.id AS msoa, m.parent_id AS borough
FROM area_geography l JOIN area_geography m ON m.id = l.parent_id
WHERE l.kind = 'lsoa'"""

# One metric for every area of a carrier: each area's newest value within a year of the metric's newest period.
METRIC_SQL = """-- borough-standouts:metric
SELECT DISTINCT ON (v.geography_id) v.geography_id AS id, to_char(v.period, 'YYYY-MM') AS period, v.value,
  v.region_percentile
FROM metric_value v JOIN area_geography g ON g.id = v.geography_id
WHERE v.metric_id = %(metric)s AND g.kind = %(kind)s::geography_kind AND v.value IS NOT NULL
  AND v.period > (SELECT max(period) FROM metric_value WHERE metric_id = %(metric)s) - interval '12 months'
ORDER BY v.geography_id, v.period DESC"""

PRICE_AT_SQL = """-- borough-standouts:price-at
SELECT v.geography_id AS id, v.value FROM metric_value v
WHERE v.metric_id = 'price-per-square-metre' AND v.geography_id LIKE 'uk:lsoa:%%' AND v.value IS NOT NULL
  AND v.period = to_date(%s, 'YYYY-MM')"""

# Each borough's own km of protected lanes and TfL Cycleways inside its boundary: the borough figure,
# never one typical neighbourhood's "within 1 km" (area_kids sums the same two kinds per neighbourhood).
BOROUGH_LANES_SQL = """-- borough-standouts:borough-lanes
WITH b AS (SELECT id, ST_Transform(geometry, 27700) AS g FROM area_geography WHERE kind = 'lad')
SELECT b.id, sum(ST_Length(ST_Intersection(c.geometry, b.g))) / 1000.0 AS v
FROM b JOIN cycle_lane c ON c.geometry && b.g AND ST_Intersects(c.geometry, b.g)
WHERE c.kind IN ('protected', 'cycleway')
GROUP BY b.id"""

TABLES_SQL = """-- borough-standouts:tables
SELECT to_regclass('area_noise') IS NOT NULL AS noise, to_regclass('area_health') IS NOT NULL AS health,
  to_regclass('area_kids') IS NOT NULL AS kids, to_regclass('area_nature') IS NOT NULL AS nature,
  to_regclass('area_rank') IS NOT NULL AS ranks"""

LAYER_SQL = {
    "noise": ("noise", """-- borough-standouts:noise
SELECT geography_id AS id, any_55_share AS v FROM area_noise
WHERE geography_id LIKE 'uk:lsoa:%' AND any_55_share IS NOT NULL"""),
    "lanes": ("kids", f"""-- borough-standouts:lanes
SELECT geography_id AS id, {standouts.LANES_KM} AS v FROM area_kids
WHERE geography_id LIKE 'uk:lsoa:%' AND (protected_km IS NOT NULL OR cycleway_km IS NOT NULL)"""),
    "green": ("nature", """-- borough-standouts:green
SELECT geography_id AS id, green_share AS v FROM area_nature
WHERE geography_id LIKE 'uk:lsoa:%' AND green_share IS NOT NULL"""),
    "no2": ("health", """-- borough-standouts:no2
SELECT geography_id AS id, no2 AS v FROM area_health WHERE geography_id LIKE 'uk:lsoa:%' AND no2 IS NOT NULL"""),
    "gp": ("health", """-- borough-standouts:gp
SELECT geography_id AS id, gp_nearest_m AS v FROM area_health
WHERE geography_id LIKE 'uk:lsoa:%' AND gp_nearest_m IS NOT NULL"""),
    # The best state primary within 1 km of each neighbourhood, as its London percentile (migration 054).
    "primary": ("ranks", """-- borough-standouts:best-primary
SELECT geography_id AS id, region_percentile AS v FROM area_rank WHERE rank_id = 'best-primary'"""),
}

# Each borough's (or MSOA's) own share of homes at 55 dB or more (area_noise counts its dwellings): the figure its
# Green & quiet section shows, so the Noise tile agrees with it; the middle of its neighbourhoods without one.
OWN_NOISE_SQL = """-- borough-standouts:own-noise
SELECT n.geography_id AS id, n.any_55_share AS v FROM area_noise n JOIN area_geography g ON g.id = n.geography_id
WHERE g.kind = %(kind)s::geography_kind AND n.any_55_share IS NOT NULL"""

# State primaries and secondaries inside each borough (or MSOA), and how many Ofsted last judged Outstanding.
SCHOOLS_SQL = """-- borough-standouts:schools
SELECT g.id, count(*) AS schools,
  count(*) FILTER (WHERE s.attributes->'observations' @> '[{"measure": "Overall effectiveness", "value": "Outstanding"}]'::jsonb) AS outstanding
FROM area_geography g JOIN school s ON ST_Contains(g.geometry, s.location)
WHERE g.kind = %(kind)s::geography_kind AND s.phase IN ('primary', 'secondary')
GROUP BY g.id"""

# An MSOA's Schools tile counts as its Schools section does: state primaries and secondaries within
# 1.5 km of the area's point, so the tile never says "No data here" above a section listing schools. No
# row when no schools are loaded at all ("unknown" never reads as "none nearby").
NEAR_SCHOOLS_SQL = """-- borough-standouts:near-schools
WITH area AS (SELECT ST_PointOnSurface(geometry)::geography AS point FROM area_geography WHERE id = %s)
SELECT count(s.urn) AS schools,
  count(s.urn) FILTER (WHERE s.attributes->'observations' @> '[{"measure": "Overall effectiveness", "value": "Outstanding"}]'::jsonb) AS outstanding
FROM area LEFT JOIN school s ON s.phase IN ('primary', 'secondary') AND ST_DWithin(s.location::geography, area.point, %s)
HAVING EXISTS (SELECT 1 FROM school)"""

CARRIERS = (kinds.LAD, "msoa")

LSOA_METRICS = ("price-per-square-metre", "crime", "station-access", "food-hygiene", "deprivation")

# Tag words per tile, (pro, con), with the borough's standing among boroughs. {group}, {units} and {unit} are
# London's boroughs, elsewhere the region's councils (local_words): no "borough" outside London.
TAGS: dict[str, tuple[str | None, str | None]] = {
    "safety": ("Safer than {s}% of {group}", "More crime than {c}% of {group}"),
    "schools": ("Stronger primaries than {s}% of {group}", None),
    "station-walk": ("Closer to stations than {s}% of {group}", "Further from stations than {c}% of {group}"),
    "cycling": ("More cycle lanes than {s}% of {group}", "Fewer cycle lanes than {c}% of {group}"),
    "noise": ("Quieter than {s}% of {group}", "Noisier than {c}% of {group}"),
    "nature": ("Greener than {s}% of {group}", "Less green than {c}% of {group}"),
    "air": ("Cleaner air than {s}% of {group}", "More polluted than {c}% of {group}"),
    "gp": ("GPs nearer than in {s}% of {group}", "GPs further than in {c}% of {group}"),
    "food-hygiene": ("Better food hygiene than {s}% of {group}", "Lower food hygiene than {c}% of {group}"),
    "families": ("Closer to playgrounds and nurseries than {s}% of {group}",
                 "Further from playgrounds and nurseries than {c}% of {group}"),
}

# An MSOA stands among its region's MSOAs: its tags say "of <region>", as a neighbourhood's do.
MSOA_TAGS: dict[str, tuple[str | None, str | None]] = {
    tile: (None if pro is None else pro.replace(" in {s}% of {group}", " {s}% of {place}").replace("of {group}", "of {place}"),
           None if con is None else con.replace(" in {c}% of {group}", " {c}% of {place}").replace("of {group}", "of {place}"))
    for tile, (pro, con) in TAGS.items()
}

# The verdict's words where a borough reads differently from one neighbourhood.
VERDICT = {
    **standouts.VERDICT,
    "safety": ("very safe", "more crime than most {units}"),
    "schools": ("strong primaries", None),
    "station-walk": ("close to stations", "far from stations"),
    "gp": ("GPs close by", "GPs far away"),
    "deprivation": ("among {place}'s least deprived {units}", "among {place}'s most deprived {units}"),
}

# An MSOA reads as one neighbourhood for crime, as a group of them for schools, stations and GPs.
MSOA_VERDICT = {
    **standouts.VERDICT,
    "schools": ("strong primaries", None),
    "station-walk": ("close to stations", "far from stations"),
    "gp": ("GPs close by", "GPs far away"),
}

MSOA_CAVEATS = [
    "A wider neighbourhood's figure is the middle of its neighbourhoods' figures; crime and the school count are its own.",
    "Standing compares it with {place}'s other wider neighbourhoods (MSOAs) on the same measure, where 100 is the better end; "
    "tags pick what is in the best or worst 10%, at most one per topic. People, income and social housing never make a tag.",
]

CAVEATS = [
    "A {unit}'s figure is the middle of its neighbourhoods' figures; crime, the school count and the Nightlife count "
    "are the {unit}'s own; Families is the middle of its neighbourhoods' walks to a playground or nursery.",
    "Standing compares the {unit} with {place}'s other {units} on the same measure, where 100 is the better end; "
    "tags pick what is in the best or worst 10% of {units}, at most one per topic. People, income and social housing "
    "never make a tag.",
]


def local_words(place: str) -> dict[str, str]:
    """What the region's local authorities are called: London's boroughs; elsewhere councils ("of North West
    councils" in a tag), so no page outside London says "borough"."""
    london = place == "London"
    return {"group": "boroughs" if london else f"{place} councils", "units": "boroughs" if london else "councils",
            "unit": "borough" if london else "council"}


def _localised(vocabulary: Mapping[str, tuple[str | None, str | None]], place: str) -> dict:
    """The vocabulary with {group}, {units} and {unit} filled for the region; {place} is left for verdict()."""
    words = local_words(place)

    def fill(text: str | None) -> str | None:
        if text is None:
            return None
        for key, value in words.items():
            text = text.replace("{" + key + "}", value)
        return text
    return {key: (fill(pro), fill(con)) for key, (pro, con) in vocabulary.items()}


def borough_standouts(reader: evidence.EvidenceReader, area_id: str, cancel: Callable[[], bool] | None = None) -> dict:
    """area-standouts.v1 for one London borough or MSOA, with its neighbourhoods' strips."""
    carrier = kinds.kind_of(area_id)
    if carrier not in CARRIERS:
        raise evidence.MalformedQuery(f"grouped standouts are for boroughs and MSOAs: {area_id}")
    with reader._connect() as connection:
        release_id = evidence._active_release(connection, cancel)
        region_map = regions.area_regions_on(connection)
        view = _in_region(connection, release_id, region_map, region_map.get(area_id))
        evidence._check_cancelled(cancel)
        near = near_schools(connection, area_id) if carrier != CARRIER else None
        reasons = standouts.coverage_reasons(connection, region_map.get(area_id))
    place = coverage.region_name(region_map.get(area_id)) or "London"
    data = for_carrier(view, carrier)
    if area_id not in data["boroughs"]:
        raise evidence.AreaNotFound(f"unknown area: {area_id}")
    if near is not None:
        data["nearSchools"] = near
    tiles = standouts.with_coverage(build_tiles(data, area_id), reasons)
    tags = pick_tags(tiles, data, area_id, carrier, place)
    borough = carrier == CARRIER
    return {"schemaVersion": standouts.SCHEMA_VERSION, "productReleaseId": release_id, "geographyId": area_id,
            "carrier": carrier, "verdict": standouts.verdict(tags, _localised(VERDICT if borough else MSOA_VERDICT, place), place),
            "tags": tags, "tiles": tiles, "neighbourhoods": neighbourhoods(data, area_id),
            "withheld": feature_flags.withheld(("laeiAir",)),
            "caveats": [line.format(place=place, **local_words(place)) for line in (CAVEATS if borough else MSOA_CAVEATS)]}


def _everywhere(connection: Any, release_id: str) -> dict:
    """Every neighbourhood's inputs (load_london), once per release (release_artifact, built by release_build).
    Never cancelled: it is shared, and a cold load takes ~7 s while the web waits 2.5 s."""
    return release_store.cached(connection, release_id, ("borough-standouts",), lambda: load_london(connection, release_id))


def _in_region(connection: Any, release_id: str, region_map: Mapping[str, str], region: str | None) -> Mapping[str, Any]:
    """Standing among the boroughs (LADs) or MSOAs of the area's own region: London's for a London one."""
    if region is None:
        return _everywhere(connection, release_id)
    return release_store.cached(connection, release_id, ("borough-standouts", region), lambda: _region_view(
        _everywhere(connection, release_id), lambda key: region_map.get(key) == region))


def _region_view(value: Any, keep: Callable[[str], bool]) -> Any:
    """The all-regions inputs cut to one region's areas: dicts keyed by area ids and lists of area ids are cut at
    any depth, everything else is kept. One read for every region, sliced here: a read per region would repeat
    the ~7 s load nine times."""
    if isinstance(value, dict):
        if value and all(isinstance(key, str) and key.startswith("uk:") for key in value):
            return {key: item for key, item in value.items() if keep(key)}
        return {key: _region_view(item, keep) for key, item in value.items()}
    if isinstance(value, list) and value and all(isinstance(item, str) and item.startswith("uk:") for item in value):
        return [item for item in value if keep(item)]
    return value


def build(reader: evidence.EvidenceReader) -> list[str]:
    """Every region's borough and MSOA standouts inputs for the active release (release_build); the regions."""
    with reader._connect() as connection:
        release_id = evidence._active_release(connection, None)
        region_map = regions.area_regions_on(connection)
        found = sorted(set(region_map.values()))
        for region in found:
            _in_region(connection, release_id, region_map, region)
    return found


def for_carrier(london: Mapping[str, Any], carrier: str) -> dict:
    """The borough view (load_london as it is) or the MSOA view: the same neighbourhood values grouped by
    MSOA, with the MSOAs' own crime and school counts. "boroughs" lists the groups either way."""
    if carrier == CARRIER:
        return dict(london)
    return {**london, "carrier": carrier, "parent": london.get("msoaParent", {}), "boroughs": london.get("msoas", []),
            "crime": london.get("msoaCrime", {}), "schools": london.get("msoaSchools", {}),
            "ownNoise": london.get("msoaOwnNoise", {})}


def load_london(connection: Any, release_id: str, cancel: Callable[[], bool] | None = None) -> dict:
    """Every London neighbourhood's inputs and every borough's own figures, as plain values."""
    rows = list(connection.execute(LSOAS_SQL))
    parent = {row["lsoa"]: row["borough"] for row in rows}
    msoa_parent = {row["lsoa"]: row["msoa"] for row in rows if row.get("msoa")}
    boroughs = sorted(set(parent.values()))
    metrics = {metric: {row["id"]: row for row in connection.execute(METRIC_SQL, {"metric": metric, "kind": "lsoa"})}
               for metric in LSOA_METRICS}
    evidence._check_cancelled(cancel)
    crime = {row["id"]: row for row in connection.execute(METRIC_SQL, {"metric": "crime", "kind": CARRIER})}
    msoa_crime = {row["id"]: row for row in connection.execute(METRIC_SQL, {"metric": "crime", "kind": "msoa"})}
    periods = [row["period"] for row in metrics["price-per-square-metre"].values()]
    newest = max(periods) if periods else None
    year_ago = None
    if newest:
        year, month = (int(part) for part in newest.split("-"))
        year_ago = {row["id"]: row["value"] for row in connection.execute(PRICE_AT_SQL, (f"{year - 1}-{month:02d}",))}
    tables = list(connection.execute(TABLES_SQL))[0]
    layers = {key: ({row["id"]: float(row["v"]) for row in connection.execute(sql)} if tables[flag] else {})
              for key, (flag, sql) in LAYER_SQL.items()}
    evidence._check_cancelled(cancel)
    borough_lanes = ({row["id"]: float(row["v"] or 0) for row in connection.execute(BOROUGH_LANES_SQL)}
                     if tables["kids"] else {})
    schools = _schools(connection, CARRIER)
    msoa_schools = _schools(connection, "msoa")
    own_noise = {kind: ({row["id"]: float(row["v"]) for row in connection.execute(OWN_NOISE_SQL, {"kind": kind})}
                        if tables["noise"] else {}) for kind in (CARRIER, "msoa")}
    presets = {tile: _preset(connection, release_id, preset, formula) for tile, (preset, formula) in standouts.PRESETS.items()}
    return {
        "parent": parent, "boroughs": boroughs, "pricePeriod": newest,
        "lsoa": {
            "price": _values(metrics["price-per-square-metre"]), "priceYearAgo": year_ago or {},
            "pricePercentile": _values(metrics["price-per-square-metre"], "region_percentile"),
            "crime": _values(metrics["crime"]), "crimePercentile": _values(metrics["crime"], "region_percentile"),
            "station": _values(metrics["station-access"]), "food": _values(metrics["food-hygiene"]),
            "deprivation": _values(metrics["deprivation"], "region_percentile"),
            **layers, **presets,
        },
        "crime": _crime(crime),
        "boroughLanes": borough_lanes,
        "schools": schools,
        "msoaParent": msoa_parent, "msoas": sorted(set(msoa_parent.values())),
        "msoaCrime": _crime(msoa_crime), "msoaSchools": msoa_schools,
        "ownNoise": own_noise[CARRIER], "msoaOwnNoise": own_noise["msoa"],
    }


def _crime(rows: Mapping[str, Mapping[str, Any]]) -> dict[str, dict]:
    return {key: {"value": float(row["value"]), "period": row["period"]} for key, row in rows.items()}


def _values(rows: Mapping[str, Mapping[str, Any]], key: str = "value") -> dict[str, float]:
    return {area: float(row[key]) for area, row in rows.items() if row.get(key) is not None}


def _schools(connection: Any, kind: str) -> dict[str, dict]:
    try:
        # In a savepoint where the connection has one, so a missing table leaves the next reads working.
        savepoint = getattr(connection, "transaction", None)
        if savepoint is not None:
            with savepoint():
                rows = list(connection.execute(SCHOOLS_SQL, {"kind": kind}))
        else:
            rows = list(connection.execute(SCHOOLS_SQL, {"kind": kind}))
    except Exception:  # noqa: BLE001 - no school table loaded: the tile reads "No data here"
        return {}
    return {row["id"]: {"schools": int(row["schools"]), "outstanding": int(row["outstanding"])} for row in rows}


def near_schools(connection: Any, area_id: str) -> dict | None:
    """An MSOA's state schools within 1.5 km, as its Schools section lists them; None when none are loaded."""
    try:
        savepoint = getattr(connection, "transaction", None)
        if savepoint is not None:
            with savepoint():
                rows = list(connection.execute(NEAR_SCHOOLS_SQL, (area_id, schools.NEAR_RADIUS_METRES)))
        else:
            rows = list(connection.execute(NEAR_SCHOOLS_SQL, (area_id, schools.NEAR_RADIUS_METRES)))
    except Exception:  # noqa: BLE001 - no school table loaded: the boundary count (or "No data here")
        return None
    row = rows[0] if rows else None
    if not isinstance(row, Mapping) or row.get("schools") is None:
        return None
    return {"schools": int(row["schools"]), "outstanding": int(row.get("outstanding") or 0)}


def _preset(connection: Any, release_id: str, preset_id: str, formula: str | None = None) -> dict[str, float]:
    """A ready-made places criterion's value for every neighbourhood (standouts._preset reads one)."""
    criterion = standouts.preset_criterion(preset_id, formula)
    if criterion is None:
        return {}
    try:
        savepoint = getattr(connection, "transaction", None)
        if savepoint is not None:
            with savepoint():
                values, _, _ = custom_criteria.preset_values(connection, release_id, criterion)
        else:
            values, _, _ = custom_criteria.preset_values(connection, release_id, criterion)
    except Exception:  # noqa: BLE001 - no places table loaded
        return {}
    return {area: float(item["value"]) for area, item in values.items() if item and item.get("value") is not None}


# ---- pure: tiles, tags and strips from load_london's values ------------------------------------------------


def medians(values: Mapping[str, float], parent: Mapping[str, str]) -> dict[str, float]:
    """Each borough's median over its neighbourhoods that have a value."""
    grouped: dict[str, list[float]] = defaultdict(list)
    for area, value in values.items():
        borough = parent.get(area)
        if borough is not None:
            grouped[borough].append(value)
    return {borough: float(statistics.median(found)) for borough, found in grouped.items()}


def totals(values: Mapping[str, float], parent: Mapping[str, str]) -> dict[str, float]:
    """Each borough's sum over its neighbourhoods that have a value (counts of places inside each boundary)."""
    summed: dict[str, float] = defaultdict(float)
    for area, value in values.items():
        borough = parent.get(area)
        if borough is not None:
            summed[borough] += value
    return dict(summed)


def rank(by_borough: Mapping[str, float], borough: str, higher_is_better: bool = True) -> tuple[int, tuple[int, int]] | None:
    """(standing, (beats, beaten)) of one borough among London's boroughs; None without a value."""
    if borough not in by_borough:
        return None
    standing, beats, beaten = standouts.london_rank(sorted(by_borough.values()), by_borough[borough], higher_is_better)
    return standing, (beats, beaten)


def _ranked(tile_id: str, by_borough: Mapping[str, float], borough: str, higher_is_better: bool,
            display: Callable[[float], str], value: Callable[[float], Any] = lambda v: round(v, 1), **extra) -> dict | None:
    found = rank(by_borough, borough, higher_is_better)
    if found is None:
        return None
    standing, bounds = found
    middle = by_borough[borough]
    return standouts._tile(tile_id, value(middle), display(middle), standing, bounds=bounds, **extra)


def _cycling(data: Mapping[str, Any], typical: Mapping[str, float], borough: str) -> dict | None:
    """A borough's own km of protected lanes and Cycleways, ranked among the boroughs' totals; an MSOA (or a
    release without the lanes table) keeps its typical neighbourhood's lanes within 1 km."""
    own = data.get("boroughLanes") or {}
    if data.get("carrier", CARRIER) == CARRIER and own:
        totals_km = {name: own.get(name, 0.0) for name in data["boroughs"]}
        return _ranked("cycling", totals_km, borough, True, lambda v: f"{v:,.0f} km lanes", detail="in the borough")
    return _ranked("cycling", typical, borough, True, lambda v: f"{v:.1f} km lanes", detail="typical, within 1 km")


def _noise(data: Mapping[str, Any], typical: Mapping[str, float], borough: str) -> dict | None:
    """Its own share of homes over 55 dB among its kind's own shares, else the middle of its neighbourhoods'."""
    own = data.get("ownNoise") or {}
    values, detail = (own, None) if borough in own else (typical, "typical neighbourhood")
    return _ranked("noise", values, borough, False, lambda v: f"{v * 100:.0f}% over 55 dB", lambda v: round(v * 100, 1),
                   detail=detail)


def build_tiles(data: Mapping[str, Any], borough: str) -> list[dict]:
    """The 12 tiles in the area page's fixed order, for one borough."""
    parent, lsoa = data["parent"], data["lsoa"]
    middle = {key: medians(values, parent) for key, values in lsoa.items()}
    # Nightlife counts places inside each neighbourhood's boundary: the borough's count is their sum, never a middle.
    total = {"nightlife": totals(lsoa.get("nightlife") or {}, parent)}
    tiles: dict[str, dict] = {}

    price = middle["price"].get(borough)
    if price is not None:
        # Over the neighbourhoods with both prices, so a newly priced one does not move the trend.
        both = {area: value for area, value in lsoa["price"].items() if area in lsoa["priceYearAgo"]}
        now, ago = medians(both, parent).get(borough), middle["priceYearAgo"].get(borough)
        trend = {"percent": round((now / ago - 1) * 100, 1), "years": 1} if now and ago else None
        # Neutral: its London position among boroughs, never a standing or a tag.
        position = rank(middle["price"], borough)
        tiles["price"] = standouts._tile("price", round(price), f"£{round(price / 100) * 100:,}/m²",
                                         position[0] if position else None, trend=trend, period=data.get("pricePeriod"),
                                         detail="middle of its neighbourhoods")

    # Its own crime figure; with none for this kind of area, the middle of its neighbourhoods'.
    crime = {key: row["value"] for key, row in data["crime"].items()} or middle.get("crime", {})
    found = rank(crime, borough, higher_is_better=False)
    if found is not None:
        standing, bounds = found
        words = f"Safer than {standouts.london_share(standing)}%" if standing >= 50 else f"More crime than {standouts.london_share(100 - standing)}%"
        tiles["safety"] = standouts._tile("safety", round(crime[borough], 1), words, standing, bounds=bounds,
                                          detail="per 1,000 residents a year", period=(data["crime"].get(borough) or {}).get("period"))

    inside = "in the borough" if data.get("carrier", CARRIER) == CARRIER else "in the area"
    # A borough's own count inside its boundary; an MSOA's within 1.5 km, as its Schools section counts them.
    near = data.get("nearSchools")
    schools = near if near is not None else data["schools"].get(borough)
    if schools is not None:
        found = rank(middle["primary"], borough)
        words = f"{schools['schools']:,} within 1.5 km" if near is not None else f"{schools['schools']:,} state schools"
        tiles["schools"] = standouts._tile(
            "schools", schools["schools"], words, found[0] if found else None,
            bounds=found[1] if found else None, detail=f"{schools['outstanding']} Outstanding" if schools["outstanding"] else None)

    for tile in (
        _ranked("station-walk", middle["station"], borough, False, lambda v: f"{round(v)} min median", round, detail="typical walk"),
        _cycling(data, middle["lanes"], borough),
        _noise(data, middle["noise"], borough),
        _ranked("nature", middle["green"], borough, True, lambda v: f"{round(v * 100)}% green", lambda v: round(v * 100),
                detail="typical neighbourhood"),
        _ranked("air", middle["no2"], borough, False, lambda v: f"NO₂ {v:.0f} µg/m³") if feature_flags.air_quality() else None,
        _ranked("gp", middle["gp"], borough, False, lambda v: f"{standouts._distance(round(v, -1))} median",
                lambda v: int(round(v, -1)), detail="typical nearest"),
        _ranked("food-hygiene", middle["food"], borough, True, lambda v: f"{round(v)}% rated 4–5", round),
        # Families: the walk to the nearest playground or nursery, the middle of its neighbourhoods' (closer = better).
        _ranked("families", middle["families"], borough, False, lambda v: f"{round(v)} min median", round,
                detail="typical nearest playground or nursery"),
    ):
        if tile is not None:
            tiles[tile["id"]] = tile

    nightlife = total["nightlife"].get(borough)
    if nightlife is not None:
        position = rank(total["nightlife"], borough)
        tiles["nightlife"] = standouts._tile("nightlife", round(nightlife), f"{round(nightlife):,} bars & pubs",
                                             position[0] if position else None, detail=inside)

    return [tiles.get(tile_id) or standouts._tile(tile_id) for tile_id, *_ in standouts.TILES]


def _tag_words(vocabulary: Mapping[str, tuple[str | None, str | None]]) -> Callable[..., str | None]:
    def text(tile: Mapping[str, Any], kind: str, raw: Any) -> str | None:
        words = vocabulary.get(tile["id"], (None, None))[0 if kind == "pro" else 1]
        standing = tile["standing"]
        place = standouts._place(raw)
        return None if words is None or standing is None else words.format(
            s=standouts.london_share(standing), c=standouts.london_share(100 - standing), place=place, **local_words(place))
    return text


_tag_text = _tag_words(TAGS)


def pick_tags(tiles: list[Mapping[str, Any]], data: Mapping[str, Any], borough: str, carrier: str = CARRIER,
              place: str = "London") -> list[dict]:
    """≤ 3 pros then ≤ 2 cons from the best and worst 10% of boroughs (or MSOAs), as the area page picks them;
    `place`: the region they stand among."""
    msoa = carrier != CARRIER
    def deprivation(_raw: Any) -> tuple[int, dict] | None:
        found = rank(medians(data["lsoa"]["deprivation"], data["parent"]), borough)  # higher percentile = less deprived
        if found is None:
            return None
        standing, bounds = found
        kind = standouts._extreme(standing, bounds)
        if kind is None:
            return None
        group = "10%" if msoa else local_words(place)["units"]
        text = f"Among {place}'s least deprived {group}" if kind == "pro" else f"Among {place}'s most deprived {group}"
        return standing if kind == "pro" else 100 - standing, {"id": "deprivation", "kind": kind, "text": text, "section": "people"}

    return standouts.pick_tags(tiles, {"place": place}, text=_tag_words(MSOA_TAGS) if msoa else _tag_text, deprivation=deprivation,
                               verdict_words=_localised(MSOA_VERDICT if msoa else VERDICT, place))


def neighbourhoods(data: Mapping[str, Any], borough: str) -> list[dict]:
    """The borough's neighbourhoods, each with its price, crime and school strip (null where unknown)."""
    lsoa = data["lsoa"]

    def strip(values: Mapping[str, float], area: str, invert: bool = False) -> int | None:
        value = values.get(area)
        return None if value is None else round(100 - value if invert else value)

    def number(values: Mapping[str, float], area: str, digits: int = 0) -> float | None:
        value = values.get(area)
        return None if value is None else round(value, digits) if digits else round(value)

    areas: Iterable[str] = sorted(area for area, parent in data["parent"].items() if parent == borough)
    return [{
        "geographyId": area,
        "price": number(lsoa["price"], area),
        # Neutral: the raw London percentile (higher is dearer).
        "priceLondonPercentile": strip(lsoa["pricePercentile"], area),
        "crime": number(lsoa["crime"], area, 1),
        # 100 = safer than all of London.
        "safetyStanding": strip(lsoa["crimePercentile"], area, invert=True),
        # The best primary within 1 km, among London's primaries (100 = the best).
        "schoolStanding": strip(lsoa["primary"], area),
    } for area in areas]
