import math
import re
from typing import Any, Iterable, Mapping

from .scope import current as current_scope

RENT_UNIT = "GBP/month"
RENT_MONTHLY_BUDGET_CEILING = 20_000
RENT_BEDROOMS = (
    "room", "studio", "1 bedroom", "2 bedrooms", "3 bedrooms",
    "4 or more bedrooms",
)
BOROUGH_ID_RE = re.compile(r"^uk:lad:E[0-9]{8}$")
LSOA_ID_RE = re.compile(r"^uk:lsoa:E[0-9]{8}$")
STATION_ID_RE = re.compile(r"^osm:[nwr][0-9]{1,15}$")
# Zones: up to three places the household wants to live in: the Where criterion of the match model
# (match_model.py): fit 1 inside, falling with distance outside; Must = only inside ("zone:outside").
MAX_ZONES = 3
MAX_ZONE_LSOAS = 50
ZONE_WALK_MINUTES = (5, 30)
ZONE_LABEL_MAX = 80
ZONE_LIMIT = "zone:outside"
ZONE_FIELDS = {
    "station": {"kind", "stationId", "maxWalkMinutes", "label"},
    "borough": {"kind", "id", "label"},
    "lsoas": {"kind", "ids", "label"},
    "polygon": {"kind", "points", "label"},
}
# A drawn zone: one ring of [latitude, longitude] corners (closed implicitly), inside the coverage box
# (Greater London, or England with CLOSE_KNIT_ENGLAND) so a slip of the mouse cannot ask for the world.
POLYGON_POINTS = (3, 50)

FACTOR_IDS = (
    "affordability",
    "market-level",
    "growth-outlook",
    "crime",
    "deprivation",
    "income",
    "social-renting",
    "commute",
    "schools",
    "station-access",
    # Quick criteria (migration 028): appended so shared links keep their factor indexes.
    "noise",
    "disorder",
    "epc-share",
    "leasehold-share",
)
# Household income and social renting stay in FACTOR_IDS (share links carry factor indexes) but are
# no longer wizard factors; they are layer ranges (+ Add criterion) instead.
# Deprivation (the official IMD decile, 1 = most deprived) is a factor again (user decision).
# Kept in step with RETIRED_FACTOR_IDS in web/src/lib/fixtures.ts (tests/test_matching.py checks).
RETIRED_FACTOR_IDS = ("income", "social-renting")
DIRECTIONS = ("higher", "lower", "target-range")

# Range criteria of a v1 profile, kept for saved searches and links; the match model
# (match_model.py) reads them as v2 range criteria. A range with no soft edge is a Must.
MAX_RANGES = 8
RANGE_PREFIX = "range:"
# "scale" and "must" as the panel writes them (assertRanges in web/src/lib/contracts.ts).
RANGE_FIELDS = {"layer", "min", "max", "softMin", "softMax", "importance", "scale", "must"}
RANGE_LAYER_RE = re.compile(r"^(custom:)?[a-z0-9][a-z0-9-]{0,59}$")
# Never a criterion: the Census (religion included) only describes an area (owner rule, v3).
# Deprivation (owner decision), household income and social renting are
# ordinary layer ranges.
DESCRIPTIVE_PREFIX = "census-"
# Which way each home-search priority counts as better (home_search.Priority); the area layers flip
# their London standing for the "lower" ones.
DEFAULT_DIRECTION = {"crime": "lower", "station-access": "lower", "market-level": "lower", "deprivation": "higher",
                     "noise": "lower", "disorder": "lower", "epc-share": "higher", "leasehold-share": "lower"}
# The house subtypes a household may pick; matching treats any of them as a house.
HOUSE_TYPES = ("terraced", "semi", "detached")


class InvalidMatchRequest(ValueError):
    pass


def validate_match_request(profile: Mapping[str, Any]) -> None:
    """preference-profile.v1 (the current panel, saved searches, old links) or v2 (match_model.py)."""
    from . import match_model

    if not isinstance(profile, Mapping):
        raise InvalidMatchRequest("preference profile must be an object")
    if profile.get("schemaVersion") == match_model.SCHEMA_V2:
        try:
            match_model.validate_v2(profile)
        except match_model.InvalidProfile as error:
            raise InvalidMatchRequest(str(error)) from error
        return
    if profile.get("schemaVersion") != "preference-profile.v1":
        raise InvalidMatchRequest("unsupported preference profile version")
    market = profile.get("market", "buy")
    if market not in ("buy", "rent"):
        raise InvalidMatchRequest(f"unsupported housing market: {market}")
    _validate_budgets(profile)
    if market == "rent":
        _validate_rent_budgets(profile)
        _validate_bedrooms(profile.get("bedrooms"))
    _validate_factors(profile.get("factors"))
    _validate_destinations(profile.get("commuteDestinations", []))
    validate_zones(profile.get("zones"))
    if profile.get("propertyType", "any") not in ("house", "flat", "any"):
        raise InvalidMatchRequest("property type must be house, flat or any")
    validate_house_types(profile.get("houseTypes"))
    validate_places(profile.get("places"))
    validate_marks(profile.get("marks"))
    validate_custom(profile.get("custom"))
    validate_ranges(profile.get("ranges"))


def validate_house_types(house_types: Any) -> None:
    """Mirrors assertHouseTypes in web/src/lib/contracts.ts; absent or empty means any house."""
    if house_types is None:
        return
    if not isinstance(house_types, list) or len(set(map(str, house_types))) != len(house_types) \
            or any(item not in HOUSE_TYPES for item in house_types):
        raise InvalidMatchRequest("house types must be distinct values of terraced, semi or detached")


def property_kind(profile: Mapping[str, Any]) -> str:
    """House, flat or any for the profile: any house subtype (terraced, semi, detached) counts as a house."""
    if profile.get("houseTypes"):
        return "house"
    return profile.get("propertyType") or "any"


# Census-based layers named outside the prefix (Layers v5): Student areas (TS066). Mirrors evidence.py.
DESCRIPTIVE_IDS = frozenset({"student-share"})


def is_descriptive_layer(layer: str) -> bool:
    """A layer that describes who lives in an area: shown on the map, never a match criterion."""
    return layer.startswith(DESCRIPTIVE_PREFIX) or layer in DESCRIPTIVE_IDS


def validate_ranges(ranges: Any) -> None:
    """Mirrors assertRanges in web/src/lib/contracts.ts; absent means none."""
    if ranges is None:
        return
    if not isinstance(ranges, list) or len(ranges) > MAX_RANGES:
        raise InvalidMatchRequest(f"at most {MAX_RANGES} range criteria")
    seen = set()
    for item in ranges:
        if not isinstance(item, Mapping) or set(item) - RANGE_FIELDS:
            raise InvalidMatchRequest("malformed range criterion")
        layer = item.get("layer")
        if not isinstance(layer, str) or not RANGE_LAYER_RE.match(layer) or layer in seen:
            raise InvalidMatchRequest("invalid or duplicate range layer")
        if is_descriptive_layer(layer):
            raise InvalidMatchRequest(f"{layer} describes an area and is never a match criterion")
        seen.add(layer)
        _validate_range_bounds(item)
        importance = item.get("importance")
        if isinstance(importance, bool) or importance not in (1, 2, 3, 4, 5):
            raise InvalidMatchRequest("range importance must be an integer from 1 to 5")
        scale = item.get("scale", "value")
        if scale not in ("value", "percentile"):
            raise InvalidMatchRequest("range scale must be value or percentile")
        if scale == "percentile" and any(item.get(key) is not None and not 0 <= item[key] <= 100
                                         for key in ("min", "max", "softMin", "softMax")):
            raise InvalidMatchRequest("percentile bounds are 0-100")
        if not isinstance(item.get("must", False), bool):
            raise InvalidMatchRequest("range must is true or false")


def _validate_range_bounds(item: Mapping[str, Any]) -> None:
    low, high, soft_low, soft_high = (item.get(key) for key in ("min", "max", "softMin", "softMax"))
    if not all(value is None or _finite(value) for value in (low, high, soft_low, soft_high)):
        raise InvalidMatchRequest("range bounds must be numbers or null")
    if low is None and high is None:
        raise InvalidMatchRequest("a range needs a lowest or a highest value")
    if low is not None and high is not None and low > high:
        raise InvalidMatchRequest("range lowest exceeds highest")
    if soft_low is not None and (low is None or soft_low > low):
        raise InvalidMatchRequest("a soft edge below sits at or under the lowest value")
    if soft_high is not None and (high is None or soft_high < high):
        raise InvalidMatchRequest("a soft edge above sits at or over the highest value")


def _finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def range_fit(value: float, criterion: Mapping[str, Any]) -> float:
    """1 inside [min, max]; across a soft edge, linear down to 0 at the edge; 0 beyond (rangeFit in match-ranges.ts)."""
    from .match_model import range_fit as fit

    return fit(value, criterion.get("min"), criterion.get("max"), criterion.get("softMin"), criterion.get("softMax"))


def range_is_strict(criterion: Mapping[str, Any]) -> bool:
    """"Must": no soft edge on either side."""
    soft_low, soft_high = criterion.get("softMin"), criterion.get("softMax")
    return (soft_low is None or soft_low == criterion.get("min")) and (soft_high is None or soft_high == criterion.get("max"))


PLACE_CATEGORIES = ("park", "cafe", "supermarket", "convenience", "gp", "pharmacy", "pub", "restaurant",
                    "gym", "pool", "sports_club", "step_free_station")
SCHOOL_PHASES = ("primary", "secondary")
# "Top N schools" ranks by published results unless the rule asks for Progress 8 (secondary only).
SCHOOL_RANKINGS = ("results", "progress8")
MAX_TOP_SCHOOLS = 200
_FILTER_RE = re.compile(r"^[\w &'.+-]{1,40}$")
# "Near a school like this" (Schools filter v2): the nearest school the filter keeps, optionally within metres.
SCHOOL_WITHIN_METRES = (100, 10_000)


def _validate_school_filter(target: Mapping[str, Any]) -> None:
    from . import school_filter

    text = target.get("filter")
    try:
        canonical = school_filter.text(school_filter.parse(text))
    except ValueError as error:
        raise InvalidMatchRequest(f"invalid school filter: {error}") from None
    if canonical != text:
        raise InvalidMatchRequest("invalid school filter: not in canonical order")
    within = target.get("within")
    low, high = SCHOOL_WITHIN_METRES
    if within is not None and (isinstance(within, bool) or not isinstance(within, int) or not low <= within <= high):
        raise InvalidMatchRequest(f"a school filter's within is {low} to {high} metres")
    if set(target) - {"kind", "filter", "within"}:
        raise InvalidMatchRequest("invalid school filter target")
PLACE_MODES = ("walk", "cycle", "transit", "car")  # append-only: share links carry the index
# When the trip happens; only the weekday morning has routed times so far (scoring ignores the band).
PLACE_WHENS = ("weekday-am", "weekday-pm", "saturday")
PLACE_ID_RE = re.compile(r"^[a-z0-9-]{1,24}$")
GEOGRAPHY_ID_RE = re.compile(r"^uk:(lsoa|msoa|lad):E[0-9]{8}$")
MAX_PLACES = 8
# "Near any of": two or three pinned points (either office); minutes are the best of them.
ANY_OF_POINTS = (2, 3)
MAX_MARKED_AREAS = 50
MARK_LIMIT = "mark:excluded"


def validate_places(places: Any) -> None:
    """Mirrors assertPlaces in web/src/lib/contracts.ts; absent means none."""
    if places is None:
        return
    if not isinstance(places, list) or len(places) > MAX_PLACES:
        raise InvalidMatchRequest(f"at most {MAX_PLACES} places")
    seen = set()
    for place in places:
        if not isinstance(place, Mapping) or not PLACE_ID_RE.match(str(place.get("id", ""))) or place["id"] in seen:
            raise InvalidMatchRequest("invalid or duplicate place id")
        seen.add(place["id"])
        label = place.get("label")
        if not isinstance(label, str) or not 1 <= len(label) <= 60:
            raise InvalidMatchRequest("invalid place label")
        target = place.get("target")
        if not isinstance(target, Mapping):
            raise InvalidMatchRequest("invalid place target")
        if target.get("kind") == "point":
            lat, lon = target.get("latitude"), target.get("longitude")
            if not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in (lat, lon)) \
                    or abs(lat) > 90 or abs(lon) > 180:
                raise InvalidMatchRequest("invalid place coordinates")
        elif target.get("kind") == "category":
            if target.get("category") not in PLACE_CATEGORIES:
                raise InvalidMatchRequest("invalid place target")
            for key in ("brand", "sport"):
                if target.get(key) is not None and not (isinstance(target[key], str) and _FILTER_RE.match(target[key])):
                    raise InvalidMatchRequest(f"invalid place {key}")
        elif target.get("kind") == "any-of":
            points = target.get("points")
            low, high = ANY_OF_POINTS
            if not isinstance(points, list) or not low <= len(points) <= high or not all(_is_lat_lon(point) for point in points):
                raise InvalidMatchRequest(f"a near-any-of place lists {low} to {high} [latitude, longitude] points")
        elif target.get("kind") == "school":
            top = target.get("top")
            if target.get("phase") not in SCHOOL_PHASES or isinstance(top, bool) or not isinstance(top, int) \
                    or not 1 <= top <= MAX_TOP_SCHOOLS:
                raise InvalidMatchRequest("invalid school rule")
            rank_by = "results" if target.get("rankBy") is None else target["rankBy"]  # null = results (TS ??)
            if rank_by not in SCHOOL_RANKINGS or (rank_by == "progress8" and target["phase"] != "secondary"):
                raise InvalidMatchRequest("invalid school ranking")
        elif target.get("kind") == "school-filter":
            _validate_school_filter(target)
        else:
            raise InvalidMatchRequest("invalid place target")
        if place.get("mode") not in PLACE_MODES:
            raise InvalidMatchRequest("invalid place mode")
        if place.get("when") is not None and place["when"] not in PLACE_WHENS:
            raise InvalidMatchRequest("invalid place time band")
        minutes, weight = place.get("targetMinutes"), place.get("weight")
        if isinstance(minutes, bool) or not isinstance(minutes, int) or not 1 <= minutes <= 120:
            raise InvalidMatchRequest("place minutes must be 1-120")
        if isinstance(weight, bool) or not isinstance(weight, int) or not 0 <= weight <= 5:
            raise InvalidMatchRequest("place weight must be 0-5")
        if not isinstance(place.get("must"), bool):
            raise InvalidMatchRequest("invalid place must flag")


def validate_marks(marks: Any) -> None:
    """Mirrors assertMarks in web/src/lib/contracts.ts."""
    if marks is None:
        return
    if not isinstance(marks, Mapping):
        raise InvalidMatchRequest("marks must be an object")
    for key in ("liked", "excluded"):
        ids = marks.get(key, [])
        if not isinstance(ids, list) or len(ids) > MAX_MARKED_AREAS \
                or any(not isinstance(i, str) or not GEOGRAPHY_ID_RE.match(i) for i in ids):
            raise InvalidMatchRequest("marks must list area ids")
    notes = marks.get("notes", {})
    if not isinstance(notes, Mapping) or len(notes) > MAX_MARKED_AREAS or any(
            not GEOGRAPHY_ID_RE.match(str(k)) or not isinstance(v, str) or len(v) > 280 for k, v in notes.items()):
        raise InvalidMatchRequest("invalid area notes")


def validate_custom(entries: Any) -> None:
    """Mirrors assertCustomPreferences in web/src/lib/custom-criteria.ts; absent means none."""
    from .custom_criteria import InvalidCriterion, validate_custom as validate
    try:
        validate(entries)
    except InvalidCriterion as error:
        raise InvalidMatchRequest(str(error)) from error


def limit_id(code: str) -> str:
    """The relaxable id of an unmet-limit code: 'crime:below-minimum' -> 'crime',
    'place:gym:below-minimum' -> 'place:gym', 'zone:outside' -> 'zone'."""
    return code.rsplit(":", 1)[0]


def validate_zones(zones: Any) -> None:
    """Zones are optional; an empty list is the same as none."""
    if zones is None:
        return
    if not isinstance(zones, list):
        raise InvalidMatchRequest("zones must be a list")
    if len(zones) > MAX_ZONES:
        raise InvalidMatchRequest(f"at most {MAX_ZONES} zones")
    for zone in zones:
        _validate_zone(zone)


def _validate_zone(zone: Any) -> None:
    if not isinstance(zone, Mapping) or zone.get("kind") not in ZONE_FIELDS:
        raise InvalidMatchRequest("zone kind must be station, borough, lsoas or polygon")
    kind = zone["kind"]
    unknown = set(zone) - ZONE_FIELDS[kind]
    if unknown:
        raise InvalidMatchRequest(f"unknown {kind} zone field: {sorted(unknown)[0]}")
    label = zone.get("label")
    if label is not None and (not isinstance(label, str) or len(label) > ZONE_LABEL_MAX):
        raise InvalidMatchRequest(f"zone label must be text of at most {ZONE_LABEL_MAX} characters")
    if kind == "station":
        _validate_station_zone(zone)
    elif kind == "borough":
        if not isinstance(zone.get("id"), str) or not BOROUGH_ID_RE.match(zone["id"]):
            raise InvalidMatchRequest(f"invalid borough zone id: {zone.get('id')!r}")
    elif kind == "polygon":
        _validate_polygon_zone(zone.get("points"))
    else:
        _validate_lsoa_zone(zone.get("ids"))


def _validate_station_zone(zone: Mapping[str, Any]) -> None:
    station = zone.get("stationId")
    if not isinstance(station, str) or not STATION_ID_RE.match(station):
        raise InvalidMatchRequest(f"invalid station id: {station!r}")
    minutes = zone.get("maxWalkMinutes")
    low, high = ZONE_WALK_MINUTES
    if isinstance(minutes, bool) or not isinstance(minutes, int) or not low <= minutes <= high:
        raise InvalidMatchRequest(f"station zone walk minutes must be an integer from {low} to {high}")


def _validate_lsoa_zone(ids: Any) -> None:
    if not isinstance(ids, list) or not 1 <= len(ids) <= MAX_ZONE_LSOAS:
        raise InvalidMatchRequest(f"an area zone lists 1 to {MAX_ZONE_LSOAS} LSOA ids")
    if any(not isinstance(item, str) or not LSOA_ID_RE.match(item) for item in ids):
        raise InvalidMatchRequest("area zone ids must be LSOA geography ids")
    if len(set(ids)) != len(ids):
        raise InvalidMatchRequest("duplicate LSOA id in an area zone")


def _validate_polygon_zone(points: Any) -> None:
    low, high = POLYGON_POINTS
    if not isinstance(points, list) or not low <= len(points) <= high:
        raise InvalidMatchRequest(f"a drawn zone has {low} to {high} corners")
    served = current_scope()
    if not all(_is_lat_lon(point) and served.contains(*point) for point in points):
        raise InvalidMatchRequest(f"drawn zone corners must be [latitude, longitude] in {served.name}")
    if len({tuple(point) for point in points}) < low:
        raise InvalidMatchRequest(f"a drawn zone has {low} to {high} corners")


def _is_lat_lon(point: Any, box: Mapping[str, tuple[float, float]] | None = None) -> bool:
    """A [latitude, longitude] pair of plain numbers, on the globe or inside ``box``."""
    if not isinstance(point, list) or len(point) != 2 \
            or not all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in point):
        return False
    (lat_low, lat_high), (lon_low, lon_high) = (box["latitude"], box["longitude"]) if box else ((-90, 90), (-180, 180))
    return lat_low <= point[0] <= lat_high and lon_low <= point[1] <= lon_high


def _validate_budgets(profile: Mapping[str, Any]) -> None:
    target = profile.get("targetBudget")
    maximum = profile.get("maximumBudget")
    if not isinstance(target, (int, float)) or not isinstance(maximum, (int, float)):
        raise InvalidMatchRequest("housing budgets must be numbers")
    if target <= 0 or maximum < target:
        raise InvalidMatchRequest("invalid housing budget")


def _validate_rent_budgets(profile: Mapping[str, Any]) -> None:
    for key in ("targetBudget", "maximumBudget"):
        budget = profile.get(key)
        if budget > RENT_MONTHLY_BUDGET_CEILING:
            raise InvalidMatchRequest(
                f"rental {key} must be monthly pounds ({RENT_UNIT}), "
                f"not an annual or purchase-scale figure")


def _validate_bedrooms(bedrooms: Any) -> None:
    if isinstance(bedrooms, bool) or not isinstance(bedrooms, int):
        raise InvalidMatchRequest(f"invalid bedroom count: {bedrooms!r}")
    if bedrooms < 0 or bedrooms > 8:
        raise InvalidMatchRequest(f"bedroom count out of range: {bedrooms!r}")


def _validate_factors(factors: Any) -> None:
    if not isinstance(factors, list) or not factors:
        raise InvalidMatchRequest("profile factors must be a non-empty list")
    seen = set()
    for item in factors:
        _validate_factor(item, seen)


def _validate_factor(item: Any, seen: set) -> None:
    if not isinstance(item, Mapping):
        raise InvalidMatchRequest("malformed factor entry")
    factor_id = item.get("factorId")
    if factor_id not in FACTOR_IDS or factor_id in RETIRED_FACTOR_IDS:
        raise InvalidMatchRequest(f"unsupported factor id: {factor_id}")
    if factor_id in seen:
        raise InvalidMatchRequest(f"duplicate profile factor: {factor_id}")
    seen.add(factor_id)
    weight = item.get("weight")
    if isinstance(weight, bool) or weight not in (0, 1, 2, 3, 4, 5):
        raise InvalidMatchRequest(f"factor weight must be an integer from 0 to 5: {factor_id}")
    if item.get("direction") not in DIRECTIONS:
        raise InvalidMatchRequest(f"unsupported factor direction: {factor_id}")
    _validate_limit(item.get("minimumUtility"), item.get("maximumUtility"), factor_id)


def _validate_limit(minimum: Any, maximum: Any, factor_id: str) -> None:
    for bound in (minimum, maximum):
        if bound is not None and (isinstance(bound, bool) or not 0 <= bound <= 100):
            raise InvalidMatchRequest(f"factor utility bound must be 0-100 or null: {factor_id}")
    if minimum is not None and maximum is not None and minimum > maximum:
        raise InvalidMatchRequest(f"factor minimum exceeds maximum: {factor_id}")


def _validate_destinations(destinations: Any) -> None:
    if not isinstance(destinations, list):
        raise InvalidMatchRequest("commute destinations must be a list")
    for item in destinations:
        if not isinstance(item, Mapping) or not item.get("id"):
            raise InvalidMatchRequest("malformed commute destination")
        target = item.get("targetMinutes")
        if not isinstance(target, (int, float)) or target <= 0:
            raise InvalidMatchRequest("commute target minutes must be positive")
        weight = item.get("weight", 0)
        if isinstance(weight, bool) or weight not in (0, 1, 2, 3, 4, 5):
            raise InvalidMatchRequest("commute destination weight must be an integer from 0 to 5")


def build_match_pack(profile: Mapping[str, Any], rows: Iterable[Mapping[str, Any]],
                     relaxed: Iterable[str] = (), zone_lsoas: Iterable[str] | None = None,
                     zone_distance: Mapping[str, float] | None = None, sort: str = "score",
                     value_rows: Mapping[str, Mapping[str, Any]] | None = None,
                     region_of: Mapping[str, str] | None = None) -> dict:
    """match-pack.v2 for a v1 or v2 profile (match_model.score_pack). ``zone_lsoas`` is the zones
    expanded to LSOA ids and ``zone_distance`` the metres outside them (None: no zones); ``region_of``
    ranks a source without stored percentiles within each area's region."""
    from . import match_model

    return match_model.score_pack(profile, rows, relaxed, zone_lsoas, zone_distance, sort, value_rows, region_of)


def apply_relaxation(pack: Mapping[str, Any], relaxed: Iterable[str] = (),
                     profile: Mapping[str, Any] | None = None) -> dict:
    from . import match_model

    return match_model.relax(pack, relaxed, profile)


def describe_unmet_limits(result: Mapping[str, Any], profile: Mapping[str, Any]) -> list[str]:
    """Each unmet limit in the household's words (describeUnmetLimits in matching.ts)."""
    from . import match_model

    specs = {spec["id"]: spec for spec in match_model.specs(profile)}
    components = {item["factorId"]: item for item in result.get("components", [])}
    return [_describe_limit(code, specs, components, profile) for code in result.get("unmetLimits", [])]


def _describe_limit(code: str, specs: Mapping[str, Mapping[str, Any]], components: Mapping[str, Mapping[str, Any]],
                    profile: Mapping[str, Any]) -> str:
    factor_id, kind = limit_id(code), code.rsplit(":", 1)[-1]
    if factor_id == "zone":
        return "Outside the zones you chose"
    if factor_id == "mark":
        return "You ruled this area out"
    spec, component = specs.get(factor_id), components.get(factor_id)
    name = criterion_words(factor_id, spec)
    if kind == "missing" or component is None or spec is None:
        return f"No {name.lower()} evidence to check your {bound_words(spec)}"
    if spec["kind"] == "budget":
        if profile.get("market", "buy") == "rent":
            return f"Rent £{round(component['rawValue']):,} a month is over your £{round(profile['maximumBudget']):,}"
        return f"Ballpark {_pounds(component['rawValue'])} is over your {_pounds(profile['maximumBudget'])}"
    if spec["kind"] == "place":
        target = spec["item"].get("targetMinutes") or component.get("targetMinutes")
        return f"{spec['item']['label']}: about {round(component['rawValue'])} min, over your {target}"
    unit = f" {component['unit']}" if component.get("unit") else ""
    return f"{name} {_number(component['rawValue'])}{unit} is outside your {bound_words(spec)}"


def criterion_words(factor_id: str, spec: Mapping[str, Any] | None) -> str:
    """"Crime", "Price per square metre", "Gyms": the criterion's plain name."""
    if spec is not None and spec.get("layer"):
        return range_layer_words(spec["layer"])
    if spec is not None and spec["kind"] == "custom":
        return spec["item"]["criterion"].get("label") or factor_id
    return range_layer_words(factor_id)


def bound_words(spec: Mapping[str, Any] | None) -> str:
    """"≤ 25", "20–40", or for a London percentile range "lowest 50% of London"."""
    if spec is None:
        return "range"
    low, high = spec.get("min"), spec.get("max")
    if spec.get("axis") == "percentile":
        if low is not None and high is not None:
            return f"middle {_number(high - low)}% of London"
        return f"lowest {_number(high)}% of London" if high is not None else f"highest {_number(100 - low)}% of London"
    return range_words({"min": low, "max": high})


def _pounds(value: float) -> str:
    if value >= 1_000_000:
        text = f"{value / 1_000_000:.2f}".rstrip("0").rstrip(".")
        return f"£{text}m"
    return f"£{round(value / 1000)}k"


def range_layer_words(layer: str) -> str:
    """"price-per-square-metre" -> "Price per square metre"; "custom:gyms" -> "Gyms"."""
    words = layer.split(":", 1)[-1].replace("-", " ")
    return words[:1].upper() + words[1:]


def range_words(criterion: Mapping[str, Any]) -> str:
    """"≤ 25", "≥ 80", "20–40": the range only (the card says the soft edges)."""
    low, high = criterion.get("min"), criterion.get("max")
    if low is not None and high is not None:
        return f"{_number(low)}–{_number(high)}"
    return f"≤ {_number(high)}" if high is not None else f"≥ {_number(low)}"


def _number(value: float) -> str:
    rounded = round(value, 1)
    return f"{rounded:,.0f}" if rounded == int(rounded) else f"{rounded:,.1f}"


def over_budget(result: Mapping[str, Any], profile: Mapping[str, Any]) -> bool | None:
    """Whether the area's ballpark price (or borough rent, for a rental) is above the maximum budget:
    None when the pack carries no price evidence for it (overBudget in matching.ts)."""
    price = next((item for item in result.get("components", []) if item["factorId"] == "affordability"), None)
    return None if price is None else price["rawValue"] > profile["maximumBudget"]


def budget_tier(result: Mapping[str, Any], profile: Mapping[str, Any]) -> int:
    """For grouping a list (budgetTier in matching.ts): within the maximum, unknown, over it. The order
    itself no longer follows it: the budget is a ranked criterion like any other."""
    over = over_budget(result, profile)
    return 0 if over is False else 1 if over is None else 2


def _affordability_component(profile: Mapping[str, Any], preference: Mapping[str, Any], rows: list[Mapping[str, Any]]) -> dict | None:
    if profile.get("market", "buy") == "rent":
        return _rent_affordability_component(profile, preference, rows)
    if not rows:
        return None
    maximum = profile.get("maximumBudget")
    target = profile.get("targetBudget", maximum)
    if not maximum or not target or maximum < target:
        return None
    row = rows[0]
    span = max(1, maximum - target)
    utility = max(0.0, min(100.0, (maximum - row["raw_value"]) / span * 100))
    return {
        "factorId": "affordability", "rawValue": row["raw_value"], "unit": row.get("unit", "budget fit"),
        "utility": utility, "weight": preference["weight"], "contribution": 0,
        "carrierGeographyId": row["carrier_geography_id"], "quality": row["quality"],
        "sourceVersion": row["source_release_id"],
    }


def _rent_affordability_component(profile: Mapping[str, Any], preference: Mapping[str, Any], rows: list[Mapping[str, Any]]) -> dict | None:
    maximum = profile.get("maximumBudget")
    target = profile.get("targetBudget", maximum)
    if not _monthly_budgets_usable(maximum, target):
        return None
    try:
        cell = _rent_bedroom_cell(profile.get("bedrooms", 2))
    except InvalidMatchRequest:
        return None
    row = _rent_row_for(rows, cell)
    if row is None:
        return None
    span = max(1, maximum - target)
    utility = max(0.0, min(100.0, (maximum - row["raw_value"]) / span * 100))
    return {
        "factorId": "affordability", "rawValue": row["raw_value"], "unit": RENT_UNIT,
        "utility": utility, "weight": preference["weight"], "contribution": 0,
        "carrierGeographyId": row["carrier_geography_id"], "quality": row["quality"],
        "sourceVersion": row["source_release_id"],
    }


def _monthly_budgets_usable(maximum: Any, target: Any) -> bool:
    for budget in (maximum, target):
        if isinstance(budget, bool) or not isinstance(budget, (int, float)):
            return False
    return bool(target and target > 0 and maximum >= target
                and maximum <= RENT_MONTHLY_BUDGET_CEILING)


def _rent_bedroom_cell(bedrooms: Any) -> str:
    if isinstance(bedrooms, bool) or not isinstance(bedrooms, int):
        raise InvalidMatchRequest(f"invalid bedroom count: {bedrooms!r}")
    if bedrooms < 0 or bedrooms > 8:
        raise InvalidMatchRequest(f"bedroom count out of range: {bedrooms!r}")
    if bedrooms == 0:
        return "studio"
    if bedrooms == 1:
        return "1 bedroom"
    if bedrooms <= 3:
        return f"{bedrooms} bedrooms"
    return "4 or more bedrooms"


def _rent_row_for(rows: list[Mapping[str, Any]], cell: str) -> Mapping[str, Any] | None:
    for row in rows:
        if row.get("unit") != RENT_UNIT or row.get("bedrooms") != cell:
            continue
        carrier = row.get("carrier_geography_id", "")
        if not isinstance(carrier, str) or not BOROUGH_ID_RE.match(carrier):
            continue
        return row
    return None
