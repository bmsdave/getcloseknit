"""Custom criteria ("kebab shops vs cafés"): a household's own area criterion built from places (the
unified ``place`` table of migration 034, or OpenStreetMap's ``place_poi`` before it is loaded), evaluated for every LSOA (custom-criterion.v1 in, custom-criterion-pack.v1 out).

A definition names up to three sets of places (``a``, ``b``, ``c``); a set is an OR of matchers and
a matcher an AND of tag tests over whitelisted keys. ``cuisine`` and ``sport`` match inside OSM's
``;`` lists, ``brand`` by prefix of the brand or the name (``personal_places.brand_patterns``), ``*``
means "has the tag" and ``null`` "has no such tag" (a café without a brand is an independent one).
The formula turns the places inside each LSOA's boundary (the neighbourhood shapes painted on the
map; ``lsoa_id`` of migration 038, or a point-in-polygon join where it is missing) into one value, so
the map shows where the high streets are rather than what is within walking distance:

* ``count``, ``density`` (per km² of the area): places in any set;
* ``per_resident``: places in any set per 1,000 residents (``area_population``, Census 2021), "how much is
  around" for the people who live there; the City of London's neighbourhoods are left out (null): far more
  people work there than live there, so its few residents would top every list;
* ``balance`` (A - B) / (A + B + 5), -1 (more B) to +1 (more A), a builder option only (no ready-made
  criterion uses it: few places keep any area near 0); ``share`` A / (A + B);
* ``variety``: distinct ``cuisine``/``sport`` values among the A places;
* ``nearest``: straight-line walking minutes from the area's representative point (the same points as
  the household's places, ``personal_places.AREA_POINTS_SQL``) to the nearest A place (within 5 km),
  a distance by nature, so the one formula that looks past the boundary.

``radiusMetres`` stays in the definition (share links, Claude tools and contracts carry it) but no
formula reads it any more.

Places, not people: religion, denomination and every other non-whitelisted key are refused, and places
of worship are never counted (only the household's own "nearest X" place reaches them), so a criterion
can never describe or rank an area by who lives there. The matching places are read
once (GIN on ``tags``) with their LSOA and counted in Python; ``nearest`` searches a metre grid with the
WGS84 lengths of a degree at the area's latitude, within a metre of PostGIS geography at these distances.
Values are cached per product release and normalised definition.
"""
from __future__ import annotations

import json
import math
import re
import statistics
import threading
from collections import OrderedDict, defaultdict
from typing import Any, Callable, Mapping

from . import kinds, personal_places, regions, release_store
from .scope import Scope, current as current_scope
from .percentiles import competition_percentiles, regional_percentiles

SCHEMA = "custom-criterion.v1"
PACK_SCHEMA = "custom-criterion-pack.v1"
KEYS = ("amenity", "shop", "leisure", "tourism", "sport", "cuisine", "healthcare", "craft", "office", "brand")
LIST_KEYS = ("cuisine", "sport")
# Named in the refusal so the rule reads as a rule, not a typo.
PEOPLE_KEYS = ("religion", "denomination", "diet", "ethnic", "language", "community", "origin")
# Places of worship only through the household's own "nearest X" place (the plan's guardrail): refused as a
# value and never read by PLACES_SQL, so neither "*" nor a name prefix reaches them.
PEOPLE_VALUES = {"amenity": ("place_of_worship", "monastery"), "shop": ("religion",), "office": ("religion",)}
# A brand prefix also matches names: words that would pick places by faith are refused.
PEOPLE_WORDS = ("cathedral", "chapel", "christian", "church", "catholic", "gurdwara", "hindu", "islamic", "jewish",
                "mandir", "masjid", "mosque", "muslim", "sikh", "synagogue", "temple", "buddhist")
FORMULAS = ("count", "density", "per_resident", "balance", "share", "variety", "nearest")
# Balance shrinks small counts towards "even": two kebab shops and no café is not a kebab street.
BALANCE_PRIOR = 5
# Pair formulas are coloured relative to London (see legend()).
RELATIVE_QUANTILES = (0.05, 0.25, 0.5, 0.75, 0.95)
PAIR_FORMULAS = ("balance", "share")
SET_IDS = ("a", "b", "c")
MAX_MATCHERS = 6
MAX_VALUES = 12
RADIUS = (200, 2000)
MAX_PLACES = 60_000  # a broader criterion would only colour the whole map
# All of England (CLOSE_KNIT_ENGLAND) has about seven times London's places.
MAX_PLACES_ENGLAND = 420_000
# A count, density or variety tile's detail: places inside the area's boundary, never within a radius.
INSIDE_AREA = "in this area"
NEAREST_MAX_METRES = 5000
ID_RE = re.compile(r"^[a-z0-9-]{1,24}$")
VALUE_RE = re.compile(r"^[\w &'.+:-]{1,40}$")
WEIGHTS = (1, 2, 3, 4, 5)
DIRECTIONS = ("higher", "lower")
MAX_CUSTOM = 4
UNITS = {"count": "places", "density": "places per km²", "per_resident": "places per 1,000 residents",
         "balance": "balance (-1 to +1)",
         "share": "share of A", "variety": "kinds", "nearest": "minutes"}
OSM_SOURCE = {"name": "OpenStreetMap (Geofabrik England extract)", "licence": "ODbL-1.0",
              "attribution": "© OpenStreetMap contributors",
              "url": "https://www.openstreetmap.org/copyright"}
# The unified table (migration 034) merges OpenStreetMap, the FSA food hygiene register, Overture and
# Foursquare in OSM's tag vocabulary. Below 0.6 a place rests on one weak source (an old Foursquare
# record, say): 90% of food places at 0.6 or more have a registered food business within 50 m,
# 73% below it.
PLACE_TABLE = "place"
MIN_CONFIDENCE = 0.6
# Each source a unified place can rest on (place.sources), credited under its own licence.
PLACE_SOURCES = {
    "osm": OSM_SOURCE,
    "fhrs": {"name": "FSA food hygiene rating data", "licence": "OGL-UK-3.0",
             "attribution": "Contains public sector information licensed under the Open Government Licence v3.0 "
                            "(Food Standards Agency)",
             "url": "https://www.food.gov.uk/uk-food-hygiene-rating-data-api"},
    "overture": {"name": "Overture Maps places", "licence": "CDLA-Permissive-2.0",
                 "attribution": "© Overture Maps Foundation", "url": "https://docs.overturemaps.org/attribution/"},
    "fsq": {"name": "Foursquare Open Source Places", "licence": "Apache-2.0",
            "attribution": "Foursquare Open Source Places, © Foursquare Labs, Inc.",
            "url": "https://opensource.foursquare.com/os-places/"},
}
PLACES_NOT_PEOPLE = ("This counts places on the map, not who lives in an area; it never describes "
                     "residents.")
# Ramps in the Close Knit yarn box (DESIGN.md: snow grounds, no olive or pine). Sequential runs from snow
# to cobalt yarn; the web paints each Explore chip's layer in its own yarn by swapping these stops step
# for step (web/src/lib/palettes.ts YARN_RAMPS, kept equal to these by web/tests/palettes.test.ts).
# Each stop is at least 8 L* darker than the one before, so the order reads without colour.
SEQUENTIAL = ("#f4f7fa", "#bfd1f3", "#8cabeb", "#5c84e0", "#2f5bd3")
# B end ... A end: blue to coral through snow, the same sides as the colour square (A red, B blue).
DIVERGING = ("#2f5bd3", "#8cabeb", "#f4f7fa", "#f4a49b", "#e2453c")
# Pair formulas on the map: a 4 x 4 colour square from both counts, each scored against London
# (cafés are about 7 times commoner than kebab shops). Corners: few of either (pale), mostly A (red),
# mostly B (blue), many of both (purple: a black corner looked muddy). Levels start at the London
# median, upper quartile and top tenth of each count.
BIVARIATE_QUANTILES = (0.5, 0.75, 0.9)
# The square counts the places inside each area, so its colours follow the high streets street by street.
# Each axis has one shade per level (below the median, then from each threshold), evenly spaced 0, 1/3, 2/3, 1:
# ranking low counts on a finer scale jumped from grey to most of the colour at one place and left most
# cells unused (the web's preview bivariateCell reads the same levels).
BIVARIATE_STEPS = len(BIVARIATE_QUANTILES) + 1
BIVARIATE_CORNERS = {"none": "#ebe8e2", "a": "#d7263d", "b": "#2369d1", "both": "#7a2fb8"}
# Many kebab shops carry no cuisine tag; their names say it (checked on the 2026-10 extract: +411 places).
CUISINE_NAME_HINTS = {"kebab": r"(kebab|kebap|doner|döner|donner|shawarma|shawerma|ocakba|mangal|izgara|sofras)"}
PRESETS_PATH = __file__.rsplit("/", 1)[0] + "/fixtures/custom-presets.json"


class InvalidCriterion(ValueError):
    pass


def validate_definition(definition: Any) -> None:
    """Mirrors assertCustomCriterion in web/src/lib/custom-criteria.ts."""
    if not isinstance(definition, Mapping):
        raise InvalidCriterion("a custom criterion must be an object")
    unknown = set(definition) - {"schemaVersion", "id", "label", "sets", "formula", "radiusMetres"}
    if unknown:
        raise InvalidCriterion(f"unknown criterion field: {sorted(unknown)[0]}")
    if definition.get("schemaVersion", SCHEMA) != SCHEMA:
        raise InvalidCriterion("unsupported criterion version")
    if not ID_RE.match(str(definition.get("id", ""))):
        raise InvalidCriterion("criterion id must be 1-24 lowercase letters, digits or dashes")
    _label(definition.get("label"), "criterion")
    formula = definition.get("formula")
    if formula not in FORMULAS:
        raise InvalidCriterion(f"formula must be one of {', '.join(FORMULAS)}")
    radius = definition.get("radiusMetres")
    if isinstance(radius, bool) or not isinstance(radius, int) or not RADIUS[0] <= radius <= RADIUS[1]:
        raise InvalidCriterion(f"radius must be {RADIUS[0]}-{RADIUS[1]} metres")
    sets = definition.get("sets")
    if not isinstance(sets, Mapping) or not sets or set(sets) - set(SET_IDS):
        raise InvalidCriterion("sets must be an object with keys a, b and c")
    if "a" not in sets:
        raise InvalidCriterion("set a is required")
    if formula in PAIR_FORMULAS and set(sets) != {"a", "b"}:
        raise InvalidCriterion(f"{formula} compares exactly two sets, a and b")
    for set_id, place_set in sets.items():
        _validate_set(set_id, place_set)


def _label(value: Any, what: str) -> None:
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= 60:
        raise InvalidCriterion(f"{what} label must be 1-60 characters")


def _validate_set(set_id: str, place_set: Any) -> None:
    if not isinstance(place_set, Mapping) or set(place_set) - {"label", "any"}:
        raise InvalidCriterion(f"set {set_id} must have a label and any")
    _label(place_set.get("label"), f"set {set_id}")
    matchers = place_set.get("any")
    if not isinstance(matchers, list) or not 1 <= len(matchers) <= MAX_MATCHERS:
        raise InvalidCriterion(f"set {set_id} needs 1-{MAX_MATCHERS} matchers")
    for matcher in matchers:
        if not isinstance(matcher, Mapping) or not matcher:
            raise InvalidCriterion(f"set {set_id}: a matcher is an object of tag tests")
        for key, value in matcher.items():
            _validate_test(set_id, key, value)
        if all(value is None for value in matcher.values()):
            raise InvalidCriterion(f"set {set_id}: a matcher needs at least one tag the place has")


def _validate_test(set_id: str, key: Any, value: Any) -> None:
    if key in PEOPLE_KEYS:
        raise InvalidCriterion(f"{key} is not accepted: criteria describe places, never who lives in an area")
    if key not in KEYS:
        raise InvalidCriterion(f"set {set_id}: tag {key!r} is not one of {', '.join(KEYS)}")
    if value is None or value == "*":
        return
    values = value if isinstance(value, list) else [value]
    if not 1 <= len(values) <= MAX_VALUES or not all(isinstance(v, str) and VALUE_RE.match(v) for v in values):
        raise InvalidCriterion(f"set {set_id}: invalid value for {key}")
    if isinstance(value, list) and "*" in value:
        raise InvalidCriterion(f"set {set_id}: '*' stands alone, not in a list")
    lowered = [v.lower() for v in values]
    if any(v in PEOPLE_VALUES.get(key, ()) for v in lowered) or \
            (key == "brand" and any(word in v for v in lowered for word in PEOPLE_WORDS)):
        raise InvalidCriterion(f"{key}={values[0]} is not accepted: criteria describe places, never who lives in an area")


def normalise(definition: Mapping[str, Any]) -> dict:
    """The validated definition in a canonical form (sets a-c in order, list values sorted)."""
    validate_definition(definition)
    sets = {}
    for set_id in SET_IDS:
        if set_id in definition["sets"]:
            place_set = definition["sets"][set_id]
            sets[set_id] = {"label": place_set["label"].strip(),
                            "any": [{key: sorted(set(value)) if isinstance(value, list) else value
                                     for key, value in sorted(matcher.items())} for matcher in place_set["any"]]}
    return {"schemaVersion": SCHEMA, "id": definition["id"], "label": definition["label"].strip(), "sets": sets,
            "formula": definition["formula"], "radiusMetres": definition["radiusMetres"]}


def cache_key(definition: Mapping[str, Any]) -> str:
    """What the values depend on: the matchers and the formula (not the labels, nor the unused radius)."""
    return json.dumps([{k: v["any"] for k, v in definition["sets"].items()}, definition["formula"]], sort_keys=True)


def validate_custom(entries: Any) -> None:
    """profile.custom: [{criterion, weight 1-5, direction higher|lower}]; absent means none."""
    if entries is None:
        return
    if not isinstance(entries, list) or len(entries) > MAX_CUSTOM:
        raise InvalidCriterion(f"at most {MAX_CUSTOM} custom criteria")
    seen = set()
    for entry in entries:
        if not isinstance(entry, Mapping) or set(entry) - {"criterion", "weight", "direction"}:
            raise InvalidCriterion("a custom criterion entry has criterion, weight and direction")
        validate_definition(entry.get("criterion"))
        if entry["criterion"]["id"] in seen:
            raise InvalidCriterion("duplicate custom criterion id")
        seen.add(entry["criterion"]["id"])
        weight = entry.get("weight")
        if isinstance(weight, bool) or weight not in WEIGHTS:
            raise InvalidCriterion("custom criterion weight must be 1-5")
        if entry.get("direction") not in DIRECTIONS:
            raise InvalidCriterion("custom criterion direction must be higher or lower")


# --- SQL ---------------------------------------------------------------------------------------

PLACES_SQL = """-- evidence:custom-criterion-places
SELECT ST_X(location) AS lon, ST_Y(location) AS lat, {lsoa} AS lsoa_id, {flags}, tags->>'cuisine' AS cuisine,
  tags->>'sport' AS sport, source_release_id{origins}
FROM {table} p
WHERE ({where}){confidence}
  AND NOT ({excluded})
LIMIT {limit}"""
# Every formula but nearest only counts places per LSOA: the same rows grouped, one per LSOA and kind of place
# with its count (n), so a criterion across England travels as tens of thousands of rows, not millions.
PLACES_GROUPED_SQL = """-- evidence:custom-criterion-places
SELECT lsoa_id, {flag_columns}, cuisine, sport, source_release_id{origin_column}, count(*) AS n
FROM ({inner}) p
GROUP BY lsoa_id, {flag_columns}, cuisine, sport, source_release_id{origin_column}
LIMIT {limit}"""
# Without migration 038's stored lsoa_id: the LSOA polygon holding the place (GiST on area_geography).
LSOA_JOIN_SQL = ("(SELECT g.id FROM area_geography g WHERE g.kind = 'lsoa' "
                 "AND ST_Intersects(g.geometry, p.location) LIMIT 1)")
# Each LSOA's area for density.
AREA_KM2_SQL = """-- evidence:custom-criterion-area-km2
SELECT id AS geography_id, ST_Area(geometry::geography) / 1e6 AS km2
FROM area_geography
WHERE kind = 'lsoa'"""
# Residents per LSOA for per_resident, the City of London's left out (see the module docstring).
AREA_RESIDENTS_SQL = """-- evidence:custom-criterion-area-residents
SELECT p.geography_id, p.population
FROM area_population p
JOIN area_geography g ON g.id = p.geography_id AND g.kind = 'lsoa'
LEFT JOIN area_geography m ON m.id = g.parent_id
WHERE m.parent_id IS DISTINCT FROM 'uk:lad:E09000001'"""
EXCLUDED_SQL = " OR ".join(f"tags @> '{json.dumps({key: value})}'" for key, values in PEOPLE_VALUES.items()
                           for value in values)


def _test_sql(key: str, value: Any, params: dict) -> str:
    name = f"p{len(params)}"
    if value is None:
        params[name] = key
        return f"NOT (tags ? %({name})s)"
    if value == "*":
        params[name] = key
        return f"tags ? %({name})s"
    values = value if isinstance(value, list) else [value]
    if key in LIST_KEYS:
        params[name] = [v.lower().replace(" ", "") for v in values]
        test = (f"(tags ? '{key}' AND string_to_array(replace(lower(tags->>'{key}'), ' ', ''), ';') "
                f"&& %({name})s::text[])")
        hints = [CUISINE_NAME_HINTS[v] for v in params[name] if key == "cuisine" and v in CUISINE_NAME_HINTS]
        if hints:
            hint = f"p{len(params)}"
            params[hint] = "|".join(hints)
            test = (f"({test} OR (tags->>'amenity' IN ('fast_food', 'restaurant') "
                    f"AND lower(coalesce(tags->>'name', '')) ~ %({hint})s))")
        return test
    if key == "brand":
        params[name] = sorted({p for v in values for p in personal_places.brand_patterns(v) or []})
        return (f"(lower(coalesce(tags->>'brand', '')) LIKE ANY(%({name})s) "
                f"OR lower(coalesce(tags->>'name', '')) LIKE ANY(%({name})s))")
    tests = []
    for v in values:  # tags @> {key: value} is answered by the GIN index
        tests.append(f"tags @> %(p{len(params)})s::jsonb")
        params[f"p{len(params)}"] = json.dumps({key: v})
    return tests[0] if len(tests) == 1 else "(" + " OR ".join(tests) + ")"


def _set_sql(place_set: Mapping[str, Any], params: dict) -> str:
    matchers = ["(" + " AND ".join(_test_sql(key, value, params) for key, value in matcher.items()) + ")"
                for matcher in place_set["any"]]
    return "(" + " OR ".join(matchers) + ")"


TABLE_SQL = """-- evidence:custom-criterion-table
WITH t AS (SELECT CASE WHEN to_regclass('public.place') IS NOT NULL THEN 'place' ELSE 'place_poi' END AS name)
SELECT t.name = 'place' AS unified,
  EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = t.name
          AND c.column_name = 'lsoa_id') AS stored_lsoa
FROM t"""


def place_sources(source: str, places: list[Mapping[str, Any]], unified: bool) -> list[dict]:
    """The sources behind the places, each with its own licence and attribution: OpenStreetMap alone for
    place_poi; for the unified table the ones its places name (all of them when the places do not say)."""
    if not source:
        return []
    if not unified:
        return [{"id": source, **OSM_SOURCE}]
    named = {origin for place in places for origin in place.get("origins") or ()}
    return [{"id": source, **entry} for key, entry in PLACE_SOURCES.items() if not named or key in named]


def place_table(connection: Any) -> tuple[bool, bool]:
    """(unified, stored_lsoa): the unified place table when loaded (OpenStreetMap's place_poi otherwise), and
    whether it carries migration 038's lsoa_id."""
    try:
        rows = list(connection.execute(TABLE_SQL))
        return (bool(rows[0]["unified"]), bool(rows[0].get("stored_lsoa"))) if rows else (False, False)
    except Exception:  # noqa: BLE001 - a connection that cannot answer reads OpenStreetMap
        return False, False


def unified_places(connection: Any) -> bool:
    """True when the unified place table is loaded; OpenStreetMap's place_poi otherwise."""
    return place_table(connection)[0]


def max_places() -> int:
    """How many places a criterion may match: London's limit, or England's with CLOSE_KNIT_ENGLAND."""
    return MAX_PLACES_ENGLAND if current_scope().level == "nation" else MAX_PLACES


def places_query(definition: Mapping[str, Any], unified: bool = False, stored_lsoa: bool = True) -> tuple[str, dict]:
    """The matching places: one row per place for nearest (its point), else grouped per LSOA and kind with a
    count n (PLACES_GROUPED_SQL)."""
    params: dict = {}
    sets = {set_id: _set_sql(place_set, params) for set_id, place_set in definition["sets"].items()}
    flags = ", ".join(f"{expr} AS in_{set_id}" for set_id, expr in sets.items())
    limit = max_places() + 1
    sql = PLACES_SQL.format(flags=flags, where=" OR ".join(sets.values()), excluded=EXCLUDED_SQL,
                            lsoa="p.lsoa_id" if stored_lsoa else LSOA_JOIN_SQL,
                            table=PLACE_TABLE if unified else "place_poi",
                            origins=", p.sources AS origins" if unified else "",
                            confidence=f"\n  AND confidence >= {MIN_CONFIDENCE}" if unified else "",
                            limit=limit)
    if definition["formula"] == "nearest":
        return sql, params
    inner = sql.split("\n", 1)[1].rsplit("\nLIMIT", 1)[0]
    return PLACES_GROUPED_SQL.format(inner=inner, flag_columns=", ".join(f"in_{set_id}" for set_id in sets),
                                     origin_column=", origins" if unified else "", limit=limit), params


def _n(place: Mapping[str, Any]) -> int:
    """How many places a row stands for: its count n when grouped, else one."""
    return place.get("n") or 1


def place_total(places: list[Mapping[str, Any]]) -> int:
    return sum(_n(place) for place in places)


# --- Geometry ----------------------------------------------------------------------------------

def metres_per_degree(lat: float) -> tuple[float, float]:
    """WGS84 lengths of a degree of latitude and longitude at a latitude."""
    phi = math.radians(lat)
    return (111132.954 - 559.822 * math.cos(2 * phi) + 1.175 * math.cos(4 * phi),
            111412.84 * math.cos(phi) - 93.5 * math.cos(3 * phi))


_GRID_LAT, _GRID_LON = metres_per_degree(51.5)


class _Grid:
    """Places bucketed into square cells of ``cell`` metres (a fixed London projection)."""

    def __init__(self, places: list[Mapping[str, Any]], cell: float) -> None:
        self.cell = cell
        self.cells: dict[tuple[int, int], list[Mapping[str, Any]]] = defaultdict(list)
        for place in places:
            self.cells[self._key(place["lon"], place["lat"])].append(place)

    def _key(self, lon: float, lat: float) -> tuple[int, int]:
        return int(math.floor(lon * _GRID_LON / self.cell)), int(math.floor(lat * _GRID_LAT / self.cell))

    def ring(self, lon: float, lat: float, step: int):
        """The places in the cells exactly `step` cells from the point's cell (the square's border only:
        England has ~34,000 areas, so walking every cell of the square cost seconds)."""
        cx, cy = self._key(lon, lat)
        if step == 0:
            yield from self.cells.get((cx, cy), ())
            return
        cells = self.cells
        for x in range(cx - step, cx + step + 1):
            yield from cells.get((x, cy - step), ())
            yield from cells.get((x, cy + step), ())
        for y in range(cy - step + 1, cy + step):
            yield from cells.get((cx - step, y), ())
            yield from cells.get((cx + step, y), ())


def _nearest_metres(grid: _Grid, lon: float, lat: float) -> float | None:
    m_lat, m_lon = metres_per_degree(lat)
    # The grid's cells are `cell` metres wide at London's latitude and narrower further north (England reaches
    # 55.8°N), so the search reaches as far and stops as late as the narrowest cell here needs.
    width = grid.cell * min(1.0, m_lon / _GRID_LON)
    best = None
    for step in range(0, int(NEAREST_MAX_METRES / width) + 2):
        if best is not None and (step - 1) * width * 0.99 > best:
            break
        for place in grid.ring(lon, lat, step):
            distance = math.hypot((place["lon"] - lon) * m_lon, (place["lat"] - lat) * m_lat)
            if best is None or distance < best:
                best = distance
    return best if best is not None and best <= NEAREST_MAX_METRES else None


def _kinds(place: Mapping[str, Any]) -> set[str]:
    kinds = set()
    for key in LIST_KEYS:
        for part in (place.get(key) or "").lower().split(";"):
            if part.strip():
                kinds.add(f"{key}:{part.strip()}")
    return kinds


def area_values(definition: Mapping[str, Any], areas: list[Mapping[str, Any]],
                places: list[Mapping[str, Any]], km2: Mapping[str, float] | None = None,
                residents: Mapping[str, float] | None = None) -> dict[str, dict]:
    """{geography_id: {"value": v | None, "counts": {set: n}}} for every area: the places inside its
    boundary (``lsoa_id``); ``km2`` is each area's size for density, ``residents`` its population for
    per_resident (an area without one stays null), ``nearest`` measures from its point."""
    formula = definition["formula"]
    set_ids = list(definition["sets"])
    places = [place for place in places if any(place[f"in_{set_id}"] for set_id in set_ids)]
    inside: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for place in places:
        if place.get("lsoa_id"):
            inside[place["lsoa_id"]].append(place)
    nearest = _Grid([place for place in places if place["in_a"]], 500.0) if formula == "nearest" else None
    km2, residents = km2 or {}, residents or {}
    values = {}
    for area in areas:
        lon, lat = area["lon"], area["lat"]
        found = inside.get(area["geography_id"], [])
        counts = {set_id: sum(_n(place) for place in found if place[f"in_{set_id}"]) for set_id in set_ids}
        a, b = counts["a"], counts.get("b", 0)
        total = place_total(found)
        if formula == "count":
            value = float(total)
        elif formula == "density":
            size = km2.get(area["geography_id"])
            value = round(total / size, 1) if size else None
        elif formula == "per_resident":
            people = residents.get(area["geography_id"])
            value = round(total / people * 1000, 2) if people else None
        elif formula == "balance":
            value = round((a - b) / (a + b + BALANCE_PRIOR), 3)
        elif formula == "share":
            value = round(a / (a + b), 3) if a + b else None
        elif formula == "variety":
            value = float(len(set().union(*(_kinds(place) for place in found if place["in_a"]))))
        else:
            metres = _nearest_metres(nearest, lon, lat)
            value = None if metres is None else round(personal_places.estimate_minutes(metres / 1000, "walk"), 1)
        values[area["geography_id"]] = {"value": value, "counts": counts}
    return values


# --- Percentiles, legend, pack ------------------------------------------------------------------

def percentiles(values: Mapping[str, float | None], formula: str,
                region_of: Mapping[str, str] | None = None) -> dict[str, int]:
    """Percentile of "more of the criterion" (more places, more A, closer for nearest) within each area's
    region (London's areas among London's); the one competition rule of area_api.percentiles (issue #221),
    so tied areas share a percentile."""
    if formula == "nearest":  # closer ranks higher: the competition rule on the negated distance
        values = {k: None if v is None else -v for k, v in values.items()}
    return regional_percentiles(values, region_of, competition_percentiles)


def _quantile(sorted_values: list[float], q: float) -> float:
    return sorted_values[min(len(sorted_values) - 1, int(q * (len(sorted_values) - 1) + 0.5))]


def _format(value: float, formula: str) -> str:
    if formula == "share":
        return f"{round(value * 100)}%"
    if formula == "nearest":
        return f"{round(value)} min"
    return f"{value:g}" if formula in ("density", "per_resident") else str(round(value))


def legend(definition: Mapping[str, Any], values: list[float]) -> list[dict]:
    """Stops on the value scale, strictly increasing; diverging for balance and share."""
    formula, sets = definition["formula"], definition["sets"]
    if formula in PAIR_FORMULAS and len(set(values)) >= 5:
        # Relative to London: cafés outnumber kebab shops almost everywhere, so an absolute -1..+1 scale
        # paints the city one colour. Stops at the 5th..95th percentiles show where each side is
        # stronger than usual; the values themselves stay absolute in cards and tooltips.
        ordered = sorted(values)
        stops, previous = [], None
        for q, colour in zip(RELATIVE_QUANTILES, DIVERGING):
            value = _quantile(ordered, q)
            if previous is not None and value <= previous:
                value = previous + 0.001
            label = {0.05: f"more {_set_word(sets['b'])}", 0.5: "London middle", 0.95: f"more {_set_word(sets['a'])}"}.get(q, "")
            stops.append({"value": round(value, 3), "colour": colour, "label": label})
            previous = value
        return stops
    if formula == "balance":
        return [{"value": -1, "colour": DIVERGING[0], "label": f"more {_set_word(sets['b'])}"},
                {"value": -0.5, "colour": DIVERGING[1], "label": ""},
                {"value": 0, "colour": DIVERGING[2], "label": "even"},
                {"value": 0.5, "colour": DIVERGING[3], "label": ""},
                {"value": 1, "colour": DIVERGING[4], "label": f"more {_set_word(sets['a'])}"}]
    if formula == "share":
        return [{"value": 0, "colour": DIVERGING[0], "label": f"all {_set_word(sets['b'])}"},
                {"value": 0.5, "colour": DIVERGING[2], "label": "half"},
                {"value": 1, "colour": DIVERGING[4], "label": f"all {_set_word(sets['a'])}"}]
    ordered = sorted(values) or [0.0]
    # Counts inside an area are mostly 0 to a handful, with a long tail on the high streets (303 bars in
    # one City LSOA): ending the ramp at London's maximum would paint 5 pubs and 30 the same. The darkest
    # stop is the top 1%, read "18+".
    top = 1 if formula == "nearest" else 0.99
    quantiles = [0, 0.5, 0.75, 0.9, top]
    colours = SEQUENTIAL if formula != "nearest" else tuple(reversed(SEQUENTIAL))
    stops, previous = [], None
    for q, colour in zip(quantiles, colours):
        value = _quantile(ordered, q)
        if previous is not None and value <= previous:
            value = previous + 0.001
        label = _format(value, formula) if q in (0, 0.5, top) else ""
        if q == 0.5 and stops and label == stops[0]["label"]:
            label = ""  # a London median of 0 would read "0 · 0"
        if q == top and top < 1 and value < ordered[-1]:
            label += "+"
        if q == top and formula == "per_resident":
            label += " per 1,000"  # the unit once, on the top stop: "0 · 1.2 · 9.5+ per 1,000"
        stops.append({"value": round(value, 3), "colour": colour, "label": label})
        previous = value
    return stops


def _mix(x: float, y: float) -> str:
    """Bilinear blend of the four corners: x = level of A (0..1), y = level of B."""
    corners = {key: [int(colour[i:i + 2], 16) for i in (1, 3, 5)] for key, colour in BIVARIATE_CORNERS.items()}
    weights = {"none": (1 - x) * (1 - y), "a": x * (1 - y), "b": (1 - x) * y, "both": x * y}
    rgb = [round(sum(weights[key] * corners[key][i] for key in corners)) for i in range(3)]
    return "#" + "".join(f"{channel:02x}" for channel in rgb)


def _thresholds(counts: list[float]) -> list[int]:
    """Whole counts that start levels 1..3, at least 1 and strictly increasing."""
    ordered, out = sorted(counts) or [0], []
    for q in BIVARIATE_QUANTILES:
        out.append(max(out[-1] + 1 if out else 1, math.floor(_quantile(ordered, q) + 0.5)))
    return out


def bivariate_level(count: float, thresholds: list[int]) -> int:
    return sum(1 for threshold in thresholds if count >= threshold)


def _count(item: Mapping[str, Any], set_id: str) -> float:
    return item["counts"].get(set_id, 0)


def bivariate_cell(item: Mapping[str, Any], square: Mapping[str, Any]) -> int:
    """The square's cell for one area: level of A x STEPS + level of B, each from its axis thresholds."""
    level = lambda set_id: bivariate_level(_count(item, set_id), square["axes"][set_id]["thresholds"])  # noqa: E731
    return level("a") * BIVARIATE_STEPS + level("b")


def bivariate(definition: Mapping[str, Any], items: list[Mapping[str, Any]]) -> dict | None:
    """The colour square for pair formulas: STEPS x STEPS colours[shade of A][shade of B], and per set the
    counts at London's median, upper quartile and top tenth (the legend's ticks)."""
    if definition["formula"] not in PAIR_FORMULAS:
        return None
    last = BIVARIATE_STEPS - 1
    axes = {set_id: {"label": definition["sets"][set_id]["label"],
                     "thresholds": _thresholds([_count(item, set_id) for item in items])}
            for set_id in ("a", "b")}
    colours = [[_mix(i / last, j / last) for j in range(BIVARIATE_STEPS)] for i in range(BIVARIATE_STEPS)]
    return {"axes": axes, "colours": colours,
            "corners": {"none": f"few {_set_word(definition['sets']['a'])} or {_set_word(definition['sets']['b'])}",
                        "a": f"mostly {_set_word(definition['sets']['a'])}",
                        "b": f"mostly {_set_word(definition['sets']['b'])}",
                        "both": "many of both"}}


def caveats(definition: Mapping[str, Any], unified: bool = False) -> list[str]:
    notes = [PLACES_NOT_PEOPLE,
             ("Places merge OpenStreetMap, the FSA food hygiene register, Overture Maps and Foursquare; only places "
              "the sources agree on are counted, so a new shop may be missing and a closed one still listed."
              if unified else
              "Places come from OpenStreetMap, which volunteers keep up to date; a new shop may be missing and a "
              "closed one still listed."),
             "Counts are places inside each neighbourhood's boundary, the shape on the map, not within walking "
             "distance: a café just across the boundary road counts for the neighbouring area."]
    if definition["formula"] == "nearest":
        notes[2] = ("Minutes are a straight-line walking estimate from each area's centre point to the nearest "
                    "place (up to 5 km), not a route.")
    if definition["formula"] == "per_resident":
        notes.append("Per 1,000 residents (Census 2021) of each neighbourhood. The City of London is left out: far "
                     "more people work there than live there, so its few residents would top every list.")
    if definition["formula"] == "balance":
        notes.append(f"Balance is (A - B) / (A + B + {BALANCE_PRIOR}): areas with few places of either kind stay near 0.")
    return notes


_CACHE: "OrderedDict[tuple, Any]" = OrderedDict()
_CACHE_SIZE = 64
_LOCK = threading.Lock()


def clear_cache() -> None:
    with _LOCK:
        _CACHE.clear()


def _evaluate_values(connection: Any, release_id: str, definition: Mapping[str, Any],
                     served: Scope) -> tuple[dict, str, list]:
    """A household's criterion for the areas of the scope, through the 64-entry LRU cache."""
    key = (release_id, cache_key(definition), served.regions)
    with _LOCK:
        if key in _CACHE:
            _CACHE.move_to_end(key)
            return _CACHE[key]
    result = _compute_values(connection, release_id, definition, served)
    with _LOCK:
        _CACHE[key] = result
        while len(_CACHE) > _CACHE_SIZE:
            _CACHE.popitem(last=False)
    return result


def preset_values(connection: Any, release_id: str, definition: Mapping[str, Any]) -> tuple[dict, str, list]:
    """A ready-made criterion (custom-presets.json), computed once per release: built by release_build into
    release_artifact (each build reads every matching place), which households' criteria never touch."""
    return release_store.cached(connection, release_id, ("preset-values", cache_key(definition)),
                                lambda: _compute_values(connection, release_id, definition))


def _compute_values(connection: Any, release_id: str, definition: Mapping[str, Any],
                    served: Scope | None = None) -> tuple[dict, str, list]:
    """The criterion's value for every LSOA (a ready-made one's, ranked in each area's region), or the scope's."""
    areas = personal_places.area_points(connection, release_id, served)
    sql, params = places_query(definition, *place_table(connection))
    places = list(connection.execute(sql, params))
    if place_total(places) > max_places():
        raise InvalidCriterion(f"this criterion matches more than {max_places():,} places; narrow it down")
    km2 = None
    if definition["formula"] == "density":
        km2 = personal_places._cached((release_id, "area-km2"), lambda: {
            row["geography_id"]: row["km2"] for row in connection.execute(AREA_KM2_SQL)})
    residents = None
    if definition["formula"] == "per_resident":
        residents = personal_places._cached((release_id, "area-residents"), lambda: {
            row["geography_id"]: float(row["population"]) for row in connection.execute(AREA_RESIDENTS_SQL)})
    source = places[0]["source_release_id"] if places else ""
    return area_values(definition, areas, places, km2, residents), source, areas


def _active_release(connection: Any) -> str:
    rows = list(connection.execute("SELECT release_id FROM active_product_release"))
    if not rows:
        from .evidence import ReleaseUnavailable
        raise ReleaseUnavailable("no active product release is loaded")
    return rows[0]["release_id"]


def _area_entry(geography_id: str, name: str, item: Mapping[str, Any], percentile: int | None,
                titles: Mapping[str, str]) -> dict:
    return {"geographyId": geography_id, "name": name, "title": titles.get(geography_id),
            "value": item["value"], "percentile": percentile, "counts": item["counts"]}


def evaluate(connection: Any, definition: Any, titles: Mapping[str, str] | None = None,
             cancel: Callable[[], bool] | None = None, summary_only: bool = False,
             scope: Scope | None = None) -> dict:
    """The criterion for every LSOA in the scope (custom-criterion-pack.v1): London's with CLOSE_KNIT_ENGLAND
    off, else England's or the regions asked for; percentiles within each area's region."""
    scope = scope or current_scope()
    criterion = normalise(definition)
    release_id = _active_release(connection)
    if cancel and cancel():
        from .evidence import Cancelled
        raise Cancelled("request cancelled")
    values, source, areas = _evaluate_values(connection, release_id, criterion, scope)
    region_map = regions.area_regions_on(connection)
    names = {area["geography_id"]: area["name"] for area in areas}
    ranks = percentiles({k: v["value"] for k, v in values.items()}, criterion["formula"], region_map)
    titles = titles or {}
    entries = [_area_entry(geography_id, names.get(geography_id, geography_id), item, ranks.get(geography_id), titles)
               for geography_id, item in values.items()]
    present = [e for e in entries if e["value"] is not None]
    # Percentiles are rounded: the value itself breaks ties, then the areas with more places to judge by
    # (every area with one kebab shop and no café shares a value).
    sign = -1 if criterion["formula"] == "nearest" else 1
    top = _distinct(sorted(present, key=lambda e: (-e["percentile"], -sign * e["value"], -sum(e["counts"].values()), e["geographyId"])))
    bottom = _distinct(sorted(present, key=lambda e: (e["percentile"], sign * e["value"], -sum(e["counts"].values()), e["geographyId"])))
    observed = [e["value"] for e in present]
    unified = source.startswith("src-places-unified")
    square = bivariate(criterion, list(values.values()))
    pack = {
        "schemaVersion": PACK_SCHEMA, "productReleaseId": release_id, "sourceReleaseId": source,
        "criterion": criterion, "unit": UNITS[criterion["formula"]],
        "legend": legend(criterion, observed),
        "bivariate": square,
        "summary": {"areas": len(present), "regionMedian": _quantile(sorted(observed), 0.5) if observed else None,
                    # Places inside any area: 0 means the criterion matched nothing (#222).
                    "places": sum(sum(item["counts"].values()) for item in values.values()),
                    "top": top[:5], "bottom": bottom[:5],
                    # How many areas share each end's value: "312 areas have no gyms" beats five rows tied at 0.
                    "tied": {end: sum(e["value"] == ends[0]["value"] for e in present) if ends else 0
                             for end, ends in (("top", top), ("bottom", bottom))}},
        "sources": place_sources(source, [], unified),
        "caveats": caveats(criterion, unified),
    }
    if not summary_only:
        # Every LSOA for the map: names and titles stay in the summary to keep the pack small.
        pack["values"] = [{key: e[key] for key in ("geographyId", "value", "percentile", "counts")}
                          for e in sorted(entries, key=lambda e: e["geographyId"])]
        if square:
            for entry in pack["values"]:
                entry["cell"] = bivariate_cell(values[entry["geographyId"]], square)
    return pack


def roll_up_pack(pack: Mapping[str, Any], parent: Callable[[str], str | None], level: str = "msoa") -> dict:
    """A criterion pack's LSOAs rolled up to `level` (the map below WIDE_ZOOM, as map_chunks.roll_up does for value
    packs): each wider area's value and percentile are the medians of its LSOAs', its counts their sums (the places
    inside it) and, for a pair formula, its cell the square's for its LSOAs' median counts. An area none of whose
    LSOAs has a value is left out. Legend, square and summary stay the LSOAs': the colours read the same."""
    square = pack.get("bivariate")
    groups: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for entry in pack.get("values") or ():
        wider = parent(entry["geographyId"])
        if wider and entry["value"] is not None:
            groups[wider].append(entry)
    values = []
    for wider, children in sorted(groups.items()):
        percentiles = [entry["percentile"] for entry in children if entry["percentile"] is not None]
        sets = sorted({set_id for entry in children for set_id in entry["counts"]})
        rolled = {"geographyId": wider, "value": round(float(statistics.median(entry["value"] for entry in children)), 4),
                  "percentile": round(statistics.median(percentiles)) if percentiles else None,
                  "counts": {set_id: sum(entry["counts"].get(set_id, 0) for entry in children) for set_id in sets},
                  "areaCount": len(children)}
        if square:
            middle = {set_id: statistics.median(entry["counts"].get(set_id, 0) for entry in children) for set_id in sets}
            rolled["cell"] = bivariate_cell({"counts": middle}, square)
        values.append(rolled)
    return {**pack, "level": level, "values": values}


def rows(connection: Any, release_id: str, entries: list[Mapping[str, Any]],
         scope: Scope | None = None) -> list[dict]:
    """`custom:<id>` match evidence rows per LSOA in the scope: raw value and its percentile within the area's
    region as utility (``matching._static_component`` applies the household's direction)."""
    scope = scope or current_scope()
    result = []
    for entry in entries:
        criterion = normalise(entry["criterion"])
        values, source, areas = _evaluate_values(connection, release_id, criterion, scope)
        region_map = regions.area_regions_on(connection)
        names = {area["geography_id"]: area["name"] for area in areas}
        ranks = percentiles({k: v["value"] for k, v in values.items()}, criterion["formula"], region_map)
        factor_id = f"custom:{criterion['id']}"
        for geography_id, item in values.items():
            if item["value"] is None:
                continue
            result.append({"geography_id": geography_id, "name": names.get(geography_id, geography_id),
                           "factor_id": factor_id, "raw_value": item["value"], "utility": ranks[geography_id],
                           "unit": UNITS[criterion["formula"]], "carrier_geography_id": geography_id,
                           "quality": "observed", "source_release_id": source or "place-poi"})
    return result


def preset_criterion(criterion_id: str) -> dict | None:
    """A ready-made criterion by its id (the map layer custom:<id>), or None for any other id."""
    with open(PRESETS_PATH, encoding="utf-8") as handle:
        data = json.load(handle)
    return next((entry["criterion"] for entry in data["presets"] if entry["criterion"]["id"] == criterion_id), None)


def presets() -> dict:
    """The ready-made criteria (mirrored by web/src/lib/custom-presets.ts)."""
    with open(PRESETS_PATH, encoding="utf-8") as handle:
        data = json.load(handle)
    return {"schemaVersion": "custom-criterion-presets.v1", "presets": data["presets"],
            "caveats": [PLACES_NOT_PEOPLE]}


# --- Ranking lenses (web /rankings) ------------------------------------------------------------
# The presets ranked by MSOA and borough. Each is evaluated once per release over every LSOA and rolled
# up the area_geography parents, outside the 64-entry criterion cache that households' searches use.
LENS_PRESETS = ("gyms", "nightlife", "late-night-food", "culture", "food-variety", "good-coffee", "markets",
                "family", "dog-friendly", "coworking", "universities", "cycling", "ev-charging")
LENS_CARRIERS = ("msoa", kinds.LAD)
# The map asks "is one close" (nearest) or "how much per resident"; /rankings keeps ranking these by land
# (places per km², sparse MSOAs and the City left out) under the set's name, so its lists and links read
# as before. Markets ranks by the walk, as it always has.
LENS_BY_LAND = ("gyms", "family", "dog-friendly", "ev-charging")
# A density needs this many places in an MSOA: a few venues in a small area must not top a list.
LENS_MIN_PLACES = 5
# The City's tiny area would top every borough density list.
CITY_OF_LONDON = "uk:lad:E09000001"
LENS_GEOGRAPHY_SQL = """-- evidence:custom-criterion-lens-geography
SELECT id AS geography_id, name, kind::text AS carrier, parent_id
FROM area_geography
WHERE kind IN ('lsoa', 'msoa', 'lad')"""


def rollup(definition: Mapping[str, Any], parents: Mapping[str, tuple[str, ...]],
           lsoa_values: Mapping[str, Mapping[str, Any]], places: list[Mapping[str, Any]],
           km2: Mapping[str, float]) -> dict[str, dict]:
    """{carrier id: {"value": v | None, "sample": n}} for every area holding an LSOA (``parents``: each
    LSOA's MSOA and borough). count and density: places per km² of the summed LSOA areas; variety: the
    kinds across all its places (a union, not a sum); nearest: the median of its LSOAs' walk minutes;
    balance and share: recomputed from the summed counts. The sample is places, or LSOAs for nearest."""
    formula, set_ids = definition["formula"], list(definition["sets"])
    lsoas: dict[str, list[str]] = defaultdict(list)
    for lsoa_id, chain in parents.items():
        for carrier_id in chain:
            lsoas[carrier_id].append(lsoa_id)
    inside: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for place in places:
        if place.get("lsoa_id") and any(place[f"in_{set_id}"] for set_id in set_ids):
            inside[place["lsoa_id"]].append(place)
    result = {}
    for carrier_id, members in lsoas.items():
        found = [place for lsoa_id in members for place in inside.get(lsoa_id, [])]
        a = sum(_n(place) for place in found if place["in_a"])
        b = sum(_n(place) for place in found if place.get("in_b"))
        sample = place_total(found)
        if formula in ("count", "density"):
            size = sum(km2.get(lsoa_id) or 0 for lsoa_id in members)
            value = round(sample / size, 1) if size else None
        elif formula == "variety":
            value = float(len(set().union(*(_kinds(place) for place in found if place["in_a"]))))
        elif formula == "nearest":
            minutes = [lsoa_values[lsoa_id]["value"] for lsoa_id in members
                       if lsoa_values.get(lsoa_id, {}).get("value") is not None]
            value, sample = (statistics.median(minutes) if minutes else None), len(minutes)
        elif formula == "balance":
            value = round((a - b) / (a + b + BALANCE_PRIOR), 3)
        else:
            value = round(a / (a + b), 3) if a + b else None
        result[carrier_id] = {"value": value, "sample": sample}
    return result


def _lens_method(definition: Mapping[str, Any]) -> str:
    """How the figure is made, in words the ranking page can show."""
    label, formula = definition["label"], definition["formula"]
    if formula == "variety":
        return (f"{label}: how many different kinds the places to eat inside the area offer, counted once "
                "across the whole area.")
    if formula == "nearest":
        return (f"{label}: the middle of the walking minutes from each neighbourhood in the area to the "
                "nearest one.")
    return (f"{label}: every one on the map inside the area's boundary, divided by its land area, so the "
            f"figure is per km². MSOAs with fewer than {LENS_MIN_PLACES} are left out, and so is the City of "
            "London among boroughs: a few places in a small area would top the list.")


def lens_pack(connection: Any, preset_id: str, carrier: str) -> dict:
    """A rank-worthy preset for every MSOA or borough (area-value-pack.v1, the crime packs' shape)."""
    from .evidence import MalformedQuery, MetricNotFound
    carrier = kinds.normalise(carrier)
    if carrier not in LENS_CARRIERS:
        raise MalformedQuery(f"invalid carrier: {carrier}")
    if preset_id not in LENS_PRESETS:
        raise MetricNotFound(f"no ranking lens: {preset_id}")
    release_id = _active_release(connection)
    served = current_scope()
    # Built once per release and scope (release_build): each build reads every matching place.
    packs = release_store.cached(connection, release_id, ("lens", preset_id, served.regions),
                                 lambda: _build_lens(connection, release_id, preset_id, served))
    return packs[carrier]


def _build_lens(connection: Any, release_id: str, preset_id: str, served: Scope) -> dict:
    """The lens packs of the scope's MSOAs and boroughs, ranked within each one's region."""
    definition = normalise(next(entry["criterion"] for entry in presets()["presets"]
                                if entry["criterion"]["id"] == preset_id))
    if preset_id in LENS_BY_LAND:  # "Nearest gym or sports centre" ranks as "Gyms and sports centres" per km²
        definition = {**definition, "formula": "count", "label": definition["sets"]["a"]["label"]}
    elif definition["formula"] == "per_resident":
        definition = {**definition, "formula": "count"}
    formula = definition["formula"]
    areas = personal_places.area_points(connection, release_id, served)
    km2 = personal_places._cached((release_id, "area-km2"), lambda: {
        row["geography_id"]: row["km2"] for row in connection.execute(AREA_KM2_SQL)})
    geography = list(connection.execute(served.rows(LENS_GEOGRAPHY_SQL)))
    sql, params = places_query(definition, *place_table(connection))
    places = list(connection.execute(sql, params))
    if place_total(places) > max_places():
        raise InvalidCriterion(f"this criterion matches more than {max_places():,} places; narrow it down")
    parent = {row["geography_id"]: row["parent_id"] for row in geography}
    # Each LSOA's MSOA (its parent) and borough (the MSOA's parent).
    parents = {lsoa_id: tuple(p for p in (msoa, parent.get(msoa)) if p)
               for lsoa_id, msoa in ((row["geography_id"], row["parent_id"]) for row in geography
                                     if row["carrier"] == "lsoa" and row["parent_id"])}
    values = rollup(definition, parents, area_values(definition, areas, places, km2), places, km2)
    source = places[0]["source_release_id"] if places else ""
    unified = source.startswith("src-places-unified")
    density = formula in ("count", "density")
    region_map = regions.area_regions_on(connection)
    metric_id = f"lens:{preset_id}"
    packs = {}
    for carrier in LENS_CARRIERS:
        rows = [row for row in geography if row["carrier"] == carrier and row["geography_id"] in values]
        shown = {}
        for row in rows:
            item = values[row["geography_id"]]
            too_few = density and carrier == "msoa" and item["sample"] < LENS_MIN_PLACES
            city = density and row["geography_id"] == CITY_OF_LONDON
            shown[row["geography_id"]] = None if too_few or city else item["value"]
        ranks = percentiles(shown, formula, region_map)
        packs[carrier] = {
            "schemaVersion": "area-value-pack.v1", "metricId": metric_id, "period": None, "carrier": carrier,
            "sourceVersion": source, "productReleaseId": release_id,
            "unit": UNITS["density" if density else formula], "criterion": definition,
            "method": _lens_method(definition),
            "sources": place_sources(source, places, unified),
            "caveats": caveats(definition, unified),
            "values": [{"geographyId": row["geography_id"], "name": row["name"], "metricId": metric_id,
                        "period": None, "value": shown[row["geography_id"]],
                        "regionPercentile": ranks.get(row["geography_id"]), "countryPercentile": None,
                        "sampleCount": values[row["geography_id"]]["sample"],
                        "quality": "suppressed" if shown[row["geography_id"]] is None else "observed",
                        "sourceVersion": source, "carrier": carrier}
                       for row in sorted(rows, key=lambda row: row["geography_id"])],
        }
    return packs


def _set_word(place_set: Mapping[str, Any]) -> str:
    """The set's label inside a legend phrase: "more cafés", but brands keep their case ("more Greggs")."""
    label = place_set["label"]
    branded = any("brand" in matcher for matcher in place_set.get("any", []))
    return label if branded else label[:1].lower() + label[1:]


def _distinct(entries: list[dict], limit: int = 5) -> list[dict]:
    """The first entries with distinct titles: neighbouring areas often share one friendly name."""
    seen, out = set(), []
    for entry in entries:
        key = entry.get("title") or entry.get("name") or entry["geographyId"]
        if key in seen:
            continue
        seen.add(key)
        out.append(entry)
        if len(out) == limit:
            break
    return out
