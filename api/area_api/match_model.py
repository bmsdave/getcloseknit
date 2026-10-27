"""My match, one model for every criterion.

A search is an ordered list of criteria (preference-profile.v2): the top one matters most. Each criterion
gives every area a fit in [0, 1]: 1 inside its range, falling linearly to 0 across its soft edge, 0 beyond.
"Must" is a criterion whose edges sit at the range (no soft edge): it is a filter with no weight, and an
area outside it is out (excluded, never scored). Every other criterion is ranked: its weight comes from
its place in the list (rank-order centroid, w_i = 1/n * sum_{k=i..n} 1/k over the n ranked criteria), and
the score is the weighted geometric mean of the fits x 100, so a fit of 0 makes the score 0 (scored low,
red on the map), not out. A ranked criterion with no evidence for an area counts as half a fit
(MISSING_FIT), so missing data never lifts an area. Ties break by the criteria in order: the better fit,
then the better value. Areas get their rank and percentile among the scored ones; the pack names each
area's top 2 contributing criteria (the "why" line), its 2 weakest, and the bottom 10.

Kinds (the criterion id in brackets, also the component factorId and the relaxable limit id):
  budget  [affordability]  fit 1 at or under targetBudget, 0 at maximumBudget; Must = within maximumBudget
  range   [range:<layer>]  a map layer's own values (scale "value") or its London percentile (scale
                           "percentile", 0 = lowest value in London, 100 = highest)
  place   [place:<id>]     minutes to a place, <= targetMinutes, soft edge to softMinutes (default +50%)
  where   [zone]           up to 3 zones: fit 1 inside, falling with distance outside (softMetres, default
                           1 km); Must = only inside (replaces the old "zone:outside" limit)
  custom  [custom:<id>]    the household's own criterion from places, on its London percentile

preference-profile.v1 (wizard factors with importance dots, places, ranges, zones) is migrated on the
way in (`migrate_v1`): dots become the order (weight descending), Must stays Must (a factor's limit, a
place's must flag, a range with no soft edge), a built-in factor becomes a percentile range on its own
evidence ("Safer streets" = crime in London's lower half, soft edge to the 75th percentile). Mirrored by
web/src/lib/match-model.ts; api/tests/match_contract_fixtures.json pins both.
"""
from __future__ import annotations

import math
from collections import defaultdict
from typing import Any, Iterable, Mapping

SCHEMA_V1 = "preference-profile.v1"
SCHEMA_V2 = "preference-profile.v2"
PACK_SCHEMA = "match-pack.v2"
MODEL = "soft-edge-rank.v1"
KINDS = ("budget", "range", "place", "where", "custom")
MAX_CRITERIA = 20
RANGE_SCALES = ("value", "percentile")
# Chip defaults (one place; lib/match-model.ts CHIP_DEFAULTS mirrors it): the better half of London
# inside, the soft edge a quarter of London further.
DEFAULT_EDGE = 50
DEFAULT_SOFT = 25
SOFT_MINUTES_FACTOR = 1.5
MAX_SOFT_MINUTES = 240
DEFAULT_SOFT_METRES = 1000
SOFT_METRES = (100, 5000)
# Distances beyond this many soft edges are reported at the cap (the fit is 0 well before it).
ZONE_DISTANCE_EDGES = 3
MISSING_FIT = 0.5
# An area with no evidence for any ranked criterion has no score (unknown, not the middle): it is neither out nor ranked.
UNSCORED_MISSING = 1 - 1e-9
TOP_REASONS = 2
WEAKEST = 2
BOTTOM = 10
# "Best value": a separate order, not a weight. Ratios outside these bounds read as a stock mix
# (few sales of very different homes) rather than value, so the sort leaves them out.
VALUE_RATIO_FLOOR = 0.6
VALUE_RATIO_CEILING = 1.67
BEST_VALUE_MIN_PERCENTILE = 50
SORTS = ("score", "best-value")

FIELDS = {
    "budget": {"kind", "must"},
    "range": {"kind", "layer", "scale", "min", "max", "softMin", "softMax", "must"},
    "place": {"kind", "id", "label", "target", "mode", "when", "targetMinutes", "softMinutes", "must"},
    "where": {"kind", "zones", "softMetres", "must"},
    "custom": {"kind", "criterion", "direction", "must"},
}
# v1 wizard factors and the map layer each one is a range on (Safer streets = Crime, ...).
FACTOR_LAYERS = {
    "market-level": "price-per-square-metre", "growth-outlook": "growth-outlook", "crime": "crime",
    "deprivation": "deprivation", "income": "income", "social-renting": "social-renting", "schools": "schools",
    "station-access": "station-access", "noise": "noise", "disorder": "disorder", "epc-share": "epc-share",
    "leasehold-share": "leasehold-share",
}
LAYER_FACTORS = {layer: factor for factor, layer in FACTOR_LAYERS.items()}


class InvalidProfile(ValueError):
    pass


# ---- the profile ----------------------------------------------------------------------------------

def is_v2(profile: Mapping[str, Any]) -> bool:
    return isinstance(profile, Mapping) and profile.get("schemaVersion") == SCHEMA_V2


def validate_v2(profile: Mapping[str, Any]) -> None:
    """preference-profile.v2 (contracts/openapi.yaml PreferenceProfileV2). Raises InvalidProfile."""
    from . import matching

    try:
        if profile.get("market", "buy") not in ("buy", "rent"):
            raise InvalidProfile(f"unsupported housing market: {profile.get('market')}")
        matching._validate_budgets(profile)
        if profile.get("market", "buy") == "rent":
            matching._validate_rent_budgets(profile)
        if profile.get("market", "buy") == "rent" or "bedrooms" in profile:
            matching._validate_bedrooms(profile.get("bedrooms"))
        if profile.get("propertyType", "any") not in ("house", "flat", "any"):
            raise InvalidProfile("property type must be house, flat or any")
        if not isinstance(profile.get("analyticsConsent", False), bool):
            raise InvalidProfile("analyticsConsent is true or false")
        matching.validate_house_types(profile.get("houseTypes"))
        matching.validate_marks(profile.get("marks"))
        _validate_criteria(profile.get("criteria"))
    except matching.InvalidMatchRequest as error:
        raise InvalidProfile(str(error)) from error


def _validate_criteria(criteria: Any) -> None:
    from . import matching

    if not isinstance(criteria, list) or len(criteria) > MAX_CRITERIA:
        raise InvalidProfile(f"criteria must be a list of at most {MAX_CRITERIA}")
    seen: set[str] = set()
    counts: dict[str, int] = defaultdict(int)
    for item in criteria:
        if not isinstance(item, Mapping) or item.get("kind") not in KINDS:
            raise InvalidProfile("criterion kind must be budget, range, place, where or custom")
        kind = item["kind"]
        unknown = set(item) - FIELDS[kind]
        if unknown:
            raise InvalidProfile(f"unknown {kind} criterion field: {sorted(unknown)[0]}")
        if not isinstance(item.get("must", False), bool):
            raise InvalidProfile("must is true or false")
        counts[kind] += 1
        if kind == "range":
            _validate_range(item)
        elif kind == "place":
            softer = item.get("softMinutes")
            matching.validate_places([{**{k: v for k, v in item.items() if k not in ("kind", "softMinutes")},
                                       "weight": 0, "must": bool(item.get("must"))}])
            if softer is not None and (isinstance(softer, bool) or not isinstance(softer, int)
                                       or not item["targetMinutes"] <= softer <= MAX_SOFT_MINUTES):
                raise InvalidProfile(f"softMinutes is whole minutes from targetMinutes to {MAX_SOFT_MINUTES}")
        elif kind == "where":
            zones = item.get("zones")
            if not isinstance(zones, list) or not zones:
                raise InvalidProfile("a where criterion lists 1 to 3 zones")
            matching.validate_zones(zones)
            soft = item.get("softMetres")
            low, high = SOFT_METRES
            if soft is not None and (isinstance(soft, bool) or not isinstance(soft, int) or not low <= soft <= high):
                raise InvalidProfile(f"softMetres is whole metres from {low} to {high}")
        elif kind == "custom":
            if item.get("direction") not in ("higher", "lower"):
                raise InvalidProfile("custom direction must be higher or lower")
            matching.validate_custom([{"criterion": item.get("criterion"), "weight": 3, "direction": item["direction"]}])
        identity = criterion_id(item)
        if identity in seen:
            raise InvalidProfile(f"duplicate criterion: {identity}")
        seen.add(identity)
    for kind in ("budget", "where"):
        if counts[kind] > 1:
            raise InvalidProfile(f"at most one {kind} criterion")
    if counts["place"] > matching.MAX_PLACES:
        raise InvalidProfile(f"at most {matching.MAX_PLACES} places")


def _validate_range(item: Mapping[str, Any]) -> None:
    from . import matching

    layer = item.get("layer")
    if not isinstance(layer, str) or not matching.RANGE_LAYER_RE.match(layer):
        raise InvalidProfile("invalid range layer")
    if matching.is_descriptive_layer(layer):
        raise InvalidProfile(f"{layer} describes an area and is never a match criterion")
    if item.get("scale", "value") not in RANGE_SCALES:
        raise InvalidProfile("range scale must be value or percentile")
    bounds = {key: item.get(key) for key in ("min", "max", "softMin", "softMax")}
    if item.get("must"):
        bounds["softMin"] = bounds["softMax"] = None  # Must = edges at 0: soft edges are ignored
    try:
        matching._validate_range_bounds(bounds)
    except matching.InvalidMatchRequest as error:
        raise InvalidProfile(str(error)) from error
    if item.get("scale") == "percentile" and any(v is not None and not 0 <= v <= 100 for v in bounds.values()):
        raise InvalidProfile("percentile bounds are 0-100")


def criterion_id(item: Mapping[str, Any]) -> str:
    """The criterion's id: the component factorId and the relaxable limit id."""
    if item.get("_id"):
        return item["_id"]
    kind = item["kind"]
    if kind == "budget":
        return "affordability"
    if kind == "range":
        return f"range:{item['layer']}"
    if kind == "place":
        return f"place:{item['id']}"
    if kind == "where":
        return "zone"
    if kind == "custom":
        return f"custom:{(item.get('criterion') or {}).get('id')}"
    return kind


def roc_weights(count: int) -> list[float]:
    """Rank-order centroid: w_i = 1/n * sum_{k=i..n} 1/k (13 ranked: 25%, 17%, 13%, 10% ... 1%)."""
    weights = []
    for index in range(1, count + 1):
        total = 0.0
        for k in range(index, count + 1):
            total += 1 / k
        weights.append(total / count)
    return weights


def as_v2(profile: Mapping[str, Any]) -> dict:
    """Any accepted profile as v2 (a v1 one migrated); the v2 one as it is."""
    return dict(profile) if is_v2(profile) else migrate_v1(profile)


def migrate_v1(profile: Mapping[str, Any]) -> dict:
    """preference-profile.v1 -> v2: every weighted or limited criterion
    joins one ordered list, by weight descending (ties keep the v1 order: factors, places, own criteria,
    ranges); zones become the Where criterion at the top; Must stays Must. Each migrated criterion keeps
    its v1 id (`_id`, so relaxation and the current panel read the same ids); a factor reads its own
    evidence rows (`_source`). Keys starting with "_" are internal and never part of the contract."""
    candidates: list[tuple[float, int, dict]] = []
    order = 0

    def add(weight: float, item: dict) -> None:
        nonlocal order
        candidates.append((weight, order, item))
        order += 1

    for factor in profile.get("factors") or []:
        must = factor.get("minimumUtility") is not None or factor.get("maximumUtility") is not None
        weight = factor.get("weight") or 0
        if weight <= 0 and not must:
            continue
        factor_id = factor["factorId"]
        if factor_id == "affordability":
            add(weight, {"kind": "budget", "must": must})
        elif factor_id == "commute":
            if profile.get("commuteDestinations"):
                add(weight, {"kind": "commute", "_id": "commute", "must": must})
        elif factor_id in FACTOR_LAYERS:
            add(weight, _factor_range(factor, must))
    for place in profile.get("places") or []:
        item = {key: place[key] for key in ("id", "label", "target", "mode", "targetMinutes") if key in place}
        if place.get("when") is not None:
            item["when"] = place["when"]
        add(place.get("weight") or 0, {"kind": "place", **item, "must": bool(place.get("must"))})
    for entry in profile.get("custom") or []:
        if (entry.get("weight") or 0) > 0:
            add(entry["weight"], {"kind": "custom", "criterion": entry["criterion"], "direction": entry["direction"],
                                  "must": False})
    for item in profile.get("ranges") or []:
        # A range the panel wrote says its scale and Must (migrateV1 in match-model.ts); an older one is a Must
        # when it has no soft edge.
        strict, told = _strict(item), "must" in item
        add(item.get("importance") or 0, {
            "kind": "range", "layer": item["layer"], "scale": item.get("scale") or "value",
            "min": item.get("min"), "max": item.get("max"),
            "softMin": None if strict and not told else item.get("softMin"),
            "softMax": None if strict and not told else item.get("softMax"),
            "must": bool(item["must"]) if told else strict})
    criteria = [item for _, _, item in sorted(candidates, key=lambda entry: (-entry[0], entry[1]))]
    if profile.get("zones"):
        criteria.insert(0, {"kind": "where", "zones": list(profile["zones"]), "softMetres": DEFAULT_SOFT_METRES,
                            "must": False})
    migrated = {"schemaVersion": SCHEMA_V2, "market": profile.get("market", "buy")}
    for key in ("targetBudget", "maximumBudget", "bedrooms", "propertyType", "houseTypes", "marks",
                "commuteDestinations"):
        if key in profile:
            migrated[key] = profile[key]
    migrated["criteria"] = criteria
    return migrated


def _strict(item: Mapping[str, Any]) -> bool:
    soft_low, soft_high = item.get("softMin"), item.get("softMax")
    return (soft_low is None or soft_low == item.get("min")) and (soft_high is None or soft_high == item.get("max"))


def _factor_range(factor: Mapping[str, Any], must: bool) -> dict:
    """A wizard factor as a range on its London percentile: the chip default (the better half, soft edge a
    quarter further), or for a Must its own limit (a minimum fit of m = the better m% ... of London)."""
    direction = factor.get("direction", "higher")
    low = high = soft_low = soft_high = None
    if direction == "lower":
        high, soft_high = 100 - DEFAULT_EDGE, 100 - DEFAULT_EDGE + DEFAULT_SOFT
    elif direction == "higher":
        low, soft_low = DEFAULT_EDGE, DEFAULT_EDGE - DEFAULT_SOFT
    else:
        low, high, soft_low, soft_high = DEFAULT_SOFT, 100 - DEFAULT_SOFT, 0, 100
    if must:
        minimum, maximum = factor.get("minimumUtility"), factor.get("maximumUtility")
        soft_low = soft_high = None
        if direction == "lower":
            high = 100 - minimum if minimum is not None else high
            low = 100 - maximum if maximum is not None else None
        elif direction == "higher":
            low = minimum if minimum is not None else low
            high = maximum if maximum is not None else None
        elif minimum is not None:
            half = (100 - minimum) / 2
            low, high = 50 - half, 50 + half
    return {"kind": "range", "layer": FACTOR_LAYERS[factor["factorId"]], "scale": "percentile", "min": low,
            "max": high, "softMin": soft_low, "softMax": soft_high, "must": must,
            "_id": factor["factorId"], "_source": factor["factorId"]}


def contract_profile(profile: Mapping[str, Any]) -> dict:
    """A v2 profile without internal keys (for links and answers); the legacy commute criterion, which
    has no v2 form, is left out."""
    clean = {key: value for key, value in as_v2(profile).items() if key != "commuteDestinations"}
    clean["criteria"] = [{key: value for key, value in item.items() if not key.startswith("_")}
                         for item in clean.get("criteria", []) if item["kind"] in KINDS]
    return clean


def profile_zones(profile: Mapping[str, Any]) -> list[dict]:
    """The zones of the Where criterion (v2) or the v1 zones list."""
    if is_v2(profile):
        where = next((item for item in profile.get("criteria") or [] if item.get("kind") == "where"), None)
        return list(where["zones"]) if where else []
    return list(profile.get("zones") or [])


def soft_metres(profile: Mapping[str, Any]) -> int:
    where = next((item for item in as_v2(profile)["criteria"] if item["kind"] == "where"), None)
    return (where or {}).get("softMetres") or DEFAULT_SOFT_METRES


# ---- criteria as the scorer reads them --------------------------------------------------------------

def specs(profile: Mapping[str, Any]) -> list[dict]:
    """The profile's criteria, in order, each with its id, the rows it reads, its bounds on the axis it
    is compared on, whether it is a Must, its weight and its better end."""
    v2 = as_v2(profile)
    out = []
    for index, item in enumerate(v2.get("criteria") or []):
        out.append(_spec(item, index, v2))
    ranked = [spec for spec in out if not spec["must"]]
    for spec, weight in zip(ranked, roc_weights(len(ranked))):
        spec["weight"] = weight
    return out


def _spec(item: Mapping[str, Any], index: int, profile: Mapping[str, Any]) -> dict:
    kind, must = item["kind"], bool(item.get("must"))
    spec = {"id": criterion_id(item), "kind": kind, "must": must, "priority": index + 1, "weight": 0.0,
            "item": item, "axis": "value", "min": None, "max": None, "softMin": None, "softMax": None}
    if kind == "budget":
        target, maximum = profile.get("targetBudget"), profile.get("maximumBudget")
        spec.update(source="affordability", better="lower",
                    max=maximum if must else target, softMax=None if must else maximum)
    elif kind == "range":
        spec.update(source=item.get("_source") or spec["id"], layer=item["layer"],
                    axis="percentile" if item.get("scale") == "percentile" else "value",
                    min=item.get("min"), max=item.get("max"),
                    softMin=None if must else item.get("softMin"), softMax=None if must else item.get("softMax"))
        spec["better"] = _better(spec["min"], spec["max"])
    elif kind == "place":
        target = item.get("targetMinutes")
        spec.update(source=spec["id"], better="lower", max=target,
                    softMax=None if must or target is None else (item.get("softMinutes") or target * SOFT_MINUTES_FACTOR))
    elif kind == "where":
        spec.update(source="zone", better="lower", max=0,
                    softMax=None if must else (item.get("softMetres") or DEFAULT_SOFT_METRES))
    elif kind == "custom":
        spec.update(source=spec["id"], axis="percentile")
        if item["direction"] == "higher":
            spec.update(min=DEFAULT_EDGE, softMin=None if must else DEFAULT_EDGE - DEFAULT_SOFT, better="higher")
        else:
            spec.update(max=100 - DEFAULT_EDGE, softMax=None if must else 100 - DEFAULT_EDGE + DEFAULT_SOFT,
                        better="lower")
    else:  # the legacy commute factor (v1 commuteDestinations), scored per destination
        spec.update(source="commute", better="lower")
    return spec


def _better(low: float | None, high: float | None) -> str:
    if low is not None and high is not None:
        return "middle"
    return "lower" if high is not None else "higher"


def range_fit(value: float, low: float | None, high: float | None, soft_low: float | None,
              soft_high: float | None) -> float:
    """1 inside [low, high]; across a soft edge, linear down to 0 at the edge; 0 beyond."""
    if low is not None and value < low:
        return 0.0 if soft_low is None or soft_low >= low or value <= soft_low else (value - soft_low) / (low - soft_low)
    if high is not None and value > high:
        return 0.0 if soft_high is None or soft_high <= high or value >= soft_high else (soft_high - value) / (soft_high - high)
    return 1.0


def fit_kind(fit: float) -> str:
    """For the popup: in range (check), on the soft edge (≈) or out (cross)."""
    return "in" if fit >= 1 else "edge" if fit > 0 else "out"


def round_half_up(value: float) -> int:
    """To 6 decimals first (exp/log may differ in the last bit between Python and JavaScript), then half
    up like Math.round (Python's round() goes to even)."""
    return math.floor(round(value, 6) + 0.5)


# ---- zones: distance outside ------------------------------------------------------------------------

_METRES_PER_DEGREE_LAT = 110_540
_METRES_PER_DEGREE_LON = 111_320 * math.cos(math.radians(51.5))


def zone_distances(inside: Iterable[str], points: Mapping[str, tuple[float, float]], soft: float) -> dict[str, float]:
    """Metres from each area's point to the nearest point of an area inside the zones (0 inside), on a
    flat projection around London; capped at ZONE_DISTANCE_EDGES soft edges. Mirrors zoneDistances."""
    inside = set(inside)
    cap = soft * ZONE_DISTANCE_EDGES
    cell = max(soft, 1.0)
    grid: dict[tuple[int, int], list[tuple[float, float]]] = defaultdict(list)
    for area_id in inside:
        if area_id in points:
            x, y = _xy(points[area_id])
            grid[(math.floor(x / cell), math.floor(y / cell))].append((x, y))
    reach = ZONE_DISTANCE_EDGES + 1
    out: dict[str, float] = {}
    for area_id, point in points.items():
        if area_id in inside:
            out[area_id] = 0.0
            continue
        x, y = _xy(point)
        cx, cy = math.floor(x / cell), math.floor(y / cell)
        best = cap
        for gx in range(cx - reach, cx + reach + 1):
            for gy in range(cy - reach, cy + reach + 1):
                for px, py in grid.get((gx, gy), ()):
                    best = min(best, math.hypot(px - x, py - y))
        out[area_id] = round(best)
    for area_id in inside - set(out):
        out[area_id] = 0.0
    return out


def _xy(point: tuple[float, float]) -> tuple[float, float]:
    lat, lon = point
    return lon * _METRES_PER_DEGREE_LON, lat * _METRES_PER_DEGREE_LAT


# ---- scoring ----------------------------------------------------------------------------------------

def score_pack(profile: Mapping[str, Any], rows: Iterable[Mapping[str, Any]], relaxed: Iterable[str] = (),
               zone_lsoas: Iterable[str] | None = None, zone_distance: Mapping[str, float] | None = None,
               sort: str = "score", value_rows: Mapping[str, Mapping[str, Any]] | None = None,
               region_of: Mapping[str, str] | None = None) -> dict:
    """match-pack.v2 for any accepted profile: every area scored, ranked, with its percentile. ``region_of``
    (area -> region) ranks a source without stored percentiles within each region."""
    v2 = as_v2(profile)
    criteria = specs(v2)
    grouped: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[row["geography_id"]].append(row)
    percentiles = _percentile_maps(criteria, grouped, region_of)
    zone_set = None if zone_lsoas is None else frozenset(zone_lsoas)
    relaxed_set = set(relaxed)
    results = [_score_area(v2, criteria, area_rows, relaxed_set, zone_set, zone_distance, percentiles)
               for area_rows in grouped.values()]
    rank_results(results, criteria)
    releases = sorted({row["source_release_id"] for area_rows in grouped.values() for row in area_rows
                       if row.get("source_release_id")})
    release_set = "+".join(releases)
    for result in results:
        result["sourceReleaseSet"] = release_set
    pack = {
        "schemaVersion": PACK_SCHEMA, "profileVersion": profile.get("schemaVersion", SCHEMA_V1), "model": MODEL,
        "sourceReleaseSet": release_set, "criteria": [_echo(spec, grouped, percentiles) for spec in criteria],
        "sort": "score", "values": results,
    }
    _summarise(pack)
    if sort == "best-value":
        apply_best_value(pack, value_rows or {})
    elif value_rows is not None:
        pack["valueAreas"] = count_value_areas(pack, value_rows)
    return pack


def _percentile_maps(criteria: list[dict], grouped: Mapping[str, list[Mapping[str, Any]]],
                     region_of: Mapping[str, str] | None = None) -> dict[str, dict]:
    """Percentile per area within its region (London's areas among London's) for each percentile-scale source
    whose rows do not carry one."""
    from .quick_criteria import percentiles as ascending

    maps: dict[str, dict] = {}
    for spec in criteria:
        if spec["axis"] != "percentile" or spec["source"] in maps:
            continue
        values, stored = {}, {}
        for area_id, area_rows in grouped.items():
            row = next((r for r in area_rows if r["factor_id"] == spec["source"] and r.get("raw_value") is not None), None)
            if row is None:
                continue
            values[area_id] = row["raw_value"]
            known = row.get("percentile", row.get("utility"))
            if known is not None:
                stored[area_id] = float(known)
        maps[spec["source"]] = stored if len(stored) == len(values) else ascending(values, region_of)
    return maps


def _score_area(profile: Mapping[str, Any], criteria: list[dict], rows: list[Mapping[str, Any]], relaxed: set,
                zone_set: frozenset | None, zone_distance: Mapping[str, float] | None,
                percentiles: Mapping[str, dict]) -> dict:
    by_factor: dict[str, list] = defaultdict(list)
    for row in rows:
        by_factor[row["factor_id"]].append(row)
    first = rows[0]
    area_id = first["geography_id"]
    components, failures, missing, log_sum, zero = [], [], 0.0, 0.0, False
    for spec in criteria:
        component = _component(spec, profile, by_factor, area_id, zone_set, zone_distance, percentiles)
        if component is None:
            if spec["must"]:
                if spec["id"] not in relaxed:
                    failures.append(f"{spec['id']}:missing")
            else:
                missing += spec["weight"]
            continue
        components.append(component)
        if spec["must"]:
            if component["fit"] <= 0 and spec["id"] not in relaxed:
                if component.get("nationalRailNotModelled"):
                    missing += spec["weight"]  # unknown, not excluded: the railway is not modelled
                else:
                    failures.append(f"{spec['id']}:outside")
        elif component["fit"] <= 0:
            zero = True
        else:
            log_sum += spec["weight"] * math.log(component["fit"])
    if area_id in ((profile.get("marks") or {}).get("excluded") or ()) and "mark" not in relaxed:
        failures.append("mark:excluded")
    precise = 0.0 if zero else 100 * math.exp(log_sum + (missing * math.log(MISSING_FIT) if missing else 0.0))
    ranked = [spec for spec in criteria if not spec["must"]]
    result = {
        "geographyId": area_id, "name": first.get("name"),
        "score": None if failures or missing >= UNSCORED_MISSING else round_half_up(precise),
        "rankScore": round(precise, 6),
        "rank": None, "percentile": None,
        "evidenceCompleteness": round_half_up(100 * (1 - missing)) if ranked else 100,
        "excluded": bool(failures), "unmetLimits": failures, "components": components,
        "missingWeight": round(missing, 6),
    }
    result["reasons"] = [] if failures else _reasons(components)
    result["weakest"] = _weakest(components, failures)
    if zone_set is not None or zone_distance is not None:
        result["inZone"] = (zone_distance or {}).get(area_id) == 0 if zone_distance is not None else area_id in zone_set
    return result


def _component(spec: Mapping[str, Any], profile: Mapping[str, Any], by_factor: Mapping[str, list], area_id: str,
               zone_set: frozenset | None, zone_distance: Mapping[str, float] | None,
               percentiles: Mapping[str, dict]) -> dict | None:
    kind = spec["kind"]
    if kind == "where":
        return _where_component(spec, area_id, zone_set, zone_distance)
    if kind == "budget":
        from . import matching
        base = matching._affordability_component(profile, {"weight": 0}, by_factor.get("affordability", []))
        if base is None:
            return None
        value = base["rawValue"]
    elif kind == "commute":
        return _commute_component(spec, profile, by_factor.get("commute", []))
    else:
        rows = [row for row in by_factor.get(spec["source"], []) if row.get("raw_value") is not None]
        if not rows:
            return None
        row = rows[0]
        base = {"rawValue": row["raw_value"], "unit": row.get("unit") or ("minutes" if kind == "place" else ""),
                "carrierGeographyId": row["carrier_geography_id"], "quality": row["quality"],
                "sourceVersion": row["source_release_id"]}
        if row.get("detail"):
            base["detail"] = row["detail"]
        if row.get("nationalRailNotModelled"):
            base["nationalRailNotModelled"] = True
        value = row["raw_value"]
    percentile = None
    if spec["axis"] == "percentile":
        percentile = percentiles.get(spec["source"], {}).get(area_id)
        if percentile is None:
            return None
        value = percentile
    fit = range_fit(value, spec["min"], spec["max"], spec["softMin"], spec["softMax"])
    component = _finish(spec, base, fit)
    if percentile is not None:
        component["percentile"] = round(percentile, 1)
    if kind == "place" and spec["item"].get("targetMinutes") is not None:
        component["targetMinutes"] = spec["item"]["targetMinutes"]
    if kind == "range":
        component["layer"] = spec["layer"]
        component["scale"] = spec["axis"]
    return component


def _finish(spec: Mapping[str, Any], base: Mapping[str, Any], fit: float) -> dict:
    component = {
        "factorId": spec["id"], "rawValue": base["rawValue"], "unit": base.get("unit", ""),
        "utility": round(fit * 100, 6), "fit": fit, "fitKind": fit_kind(fit), "weight": spec["weight"],
        "contribution": round(spec["weight"] * fit, 6), "must": spec["must"], "priority": spec["priority"],
        "carrierGeographyId": base["carrierGeographyId"], "quality": base["quality"],
        "sourceVersion": base["sourceVersion"],
    }
    if base.get("detail"):
        component["detail"] = base["detail"]
    if base.get("nationalRailNotModelled"):
        component["nationalRailNotModelled"] = True
    return component


def _where_component(spec: Mapping[str, Any], area_id: str, zone_set: frozenset | None,
                     zone_distance: Mapping[str, float] | None) -> dict | None:
    if zone_distance is not None and area_id in zone_distance:
        metres = float(zone_distance[area_id])
    elif zone_set is not None:
        metres = 0.0 if area_id in zone_set else float((spec["softMax"] or DEFAULT_SOFT_METRES) * ZONE_DISTANCE_EDGES)
    else:
        return None
    fit = range_fit(metres, None, 0, None, spec["softMax"])
    return _finish(spec, {"rawValue": metres, "unit": "m", "carrierGeographyId": area_id, "quality": "observed",
                          "sourceVersion": "zones"}, fit)


def _commute_component(spec: Mapping[str, Any], profile: Mapping[str, Any], rows: list) -> dict | None:
    minutes_by = {row.get("destination_id"): row for row in rows if row.get("destination_id")}
    journeys = [(d, minutes_by[d["id"]]) for d in profile.get("commuteDestinations") or []
                if (d.get("weight") or 0) > 0 and d.get("id") in minutes_by]
    if not journeys:
        return None
    total = sum(d["weight"] for d, _ in journeys)
    minutes = sum(row["raw_value"] * d["weight"] for d, row in journeys) / total
    fit = sum(range_fit(row["raw_value"], None, d["targetMinutes"], None,
                        None if spec["must"] else d["targetMinutes"] * SOFT_MINUTES_FACTOR) * d["weight"]
              for d, row in journeys) / total
    first = journeys[0][1]
    return _finish(spec, {"rawValue": round(minutes), "unit": "minutes", "carrierGeographyId": first["carrier_geography_id"],
                          "quality": "observed", "sourceVersion": first["source_release_id"]}, fit)


def _reasons(components: list[dict]) -> list[str]:
    """The top contributing ranked criteria (weight x fit, top priority first on a tie): the "why" line."""
    ranked = [c for c in components if not c["must"] and c["fit"] > 0]
    ranked.sort(key=lambda c: (-round(c["weight"] * c["fit"], 9), c["priority"]))
    return [c["factorId"] for c in ranked[:TOP_REASONS]]


def _weakest(components: list[dict], failures: list[str]) -> list[str]:
    """What sinks the area: a failed Must first, then the ranked criteria losing most (weight x (1 - fit))."""
    from .matching import limit_id

    out = [limit_id(code) for code in failures if not code.startswith("mark:")]
    ranked = [c for c in components if not c["must"] and c["fit"] < 1]
    ranked.sort(key=lambda c: (-round(c["weight"] * (1 - c["fit"]), 9), c["priority"]))
    out += [c["factorId"] for c in ranked if c["factorId"] not in out]
    return out[:WEAKEST]


def _tie_key(result: Mapping[str, Any], criteria: list[dict]) -> tuple:
    """Ranked criteria in order, then the Musts: the better fit, then the better value."""
    by_id = {c["factorId"]: c for c in result["components"]}
    key: list[float] = []
    for spec in [s for s in criteria if not s["must"]] + [s for s in criteria if s["must"]]:
        component = by_id.get(spec["id"])
        if component is None:
            key += [-MISSING_FIT, math.inf]
            continue
        value = component.get("percentile", component["rawValue"])
        if spec["better"] == "higher":
            oriented = -value
        elif spec["better"] == "middle":
            oriented = abs(value - (spec["min"] + spec["max"]) / 2)
        else:
            oriented = value
        key += [-component["fit"], oriented]
    return tuple(key)


def is_scored(result: Mapping[str, Any]) -> bool:
    """Ranked and coloured: not out, and with evidence for at least one ranked criterion."""
    return not result["excluded"] and result["score"] is not None


def rank_results(results: list[dict], criteria: list[dict] | None = None) -> None:
    """Scored areas first, by precise score, then the tie key, then id; areas with no evidence next; out areas last."""
    def key(result: Mapping[str, Any]) -> tuple:
        if result["excluded"]:
            return (2, 0.0, (), len(result["unmetLimits"]), result["geographyId"])
        if result["score"] is None:
            return (1, 0.0, (), 0, result["geographyId"])
        tie = _tie_key(result, criteria) if criteria is not None else ()
        return (0, -round(result["rankScore"], 6), tie, 0, result["geographyId"])
    results.sort(key=key)
    count = sum(1 for result in results if is_scored(result))
    for index, result in enumerate(results, start=1):
        result["rank"] = index if is_scored(result) else None
        result["percentile"] = None if not is_scored(result) else (
            100 if count == 1 else round_half_up(100 * (count - index) / (count - 1)))


def _summarise(pack: dict) -> None:
    """Pack-level: how many areas are scored and the bottom 10 (worst first) with their weakest criteria."""
    scored = [result for result in pack["values"] if is_scored(result)]
    pack["scored"] = len(scored)
    pack["bottom"] = [{"geographyId": result["geographyId"], "rank": result["rank"], "percentile": result["percentile"],
                       "score": result["score"], "weakest": result["weakest"]}
                      for result in sorted(scored, key=lambda r: -r["rank"])[:BOTTOM]]


def _echo(spec: Mapping[str, Any], grouped: Mapping[str, list], percentiles: Mapping[str, dict]) -> dict:
    """The criterion as scored: id, kind, Must, priority and weight, its bounds; for a percentile range, the
    layer values those percentiles stand for today (`valueBounds`), so a card can say "≤ 25 / 1,000"."""
    # The budget's bounds are the household's own figures: never echoed in a pack (privacy boundary, AE-09).
    private = spec["kind"] == "budget"
    echo = {"id": spec["id"], "kind": spec["kind"] if spec["kind"] in KINDS else "commute", "must": spec["must"],
            "priority": spec["priority"], "weight": round(spec["weight"], 6), "better": spec["better"],
            "scale": spec["axis"], **{key: None if private else spec[key] for key in ("min", "max", "softMin", "softMax")}}
    if spec.get("layer"):
        echo["layer"] = spec["layer"]
    if spec["axis"] == "percentile" and spec["kind"] == "range":
        echo["valueBounds"] = _value_bounds(spec, grouped, percentiles.get(spec["source"], {}))
    return echo


def _value_bounds(spec: Mapping[str, Any], grouped: Mapping[str, list], percentile_of: Mapping[str, float]) -> dict:
    pairs = []
    for area_id, rows in grouped.items():
        row = next((r for r in rows if r["factor_id"] == spec["source"] and r.get("raw_value") is not None), None)
        if row is not None and area_id in percentile_of:
            pairs.append((percentile_of[area_id], row["raw_value"]))
    pairs.sort()

    def at(percentile: float | None) -> float | None:
        if percentile is None or not pairs:
            return None
        return min(pairs, key=lambda pair: (abs(pair[0] - percentile), pair[1]))[1]
    return {key: at(spec[key]) for key in ("min", "max", "softMin", "softMax")}


# ---- relaxing a Must, best value ----------------------------------------------------------------------

def relax(pack: Mapping[str, Any], relaxed: Iterable[str] = (), profile: Mapping[str, Any] | None = None) -> dict:
    """The pack with these Musts (and zones, marks) lifted: an area out only for them is scored again (a
    Must carries no weight, so its score is the one it already had)."""
    from .matching import limit_id

    relaxed_set = set(relaxed)
    values = []
    for result in pack["values"]:
        result = dict(result)
        remaining = [code for code in result.get("unmetLimits", []) if limit_id(code) not in relaxed_set]
        result["unmetLimits"] = remaining
        result["excluded"] = bool(remaining)
        unscored = result.get("missingWeight", 0.0) >= UNSCORED_MISSING
        result["score"] = None if remaining or unscored else round_half_up(result.get("rankScore", 0.0))
        result["reasons"] = [] if remaining else _reasons(result["components"])
        values.append(result)
    rank_results(values, specs(profile) if profile is not None else None)
    out = {**pack, "values": values}
    _summarise(out)
    return out


def apply_best_value(pack: dict, value_rows: Mapping[str, Mapping[str, Any]]) -> None:
    """"Best value": areas in the better half of the search, cheapest for their peers first (area
    typical price for the home type over the median of the 50 areas with the closest score vectors);
    ratios outside [VALUE_RATIO_FLOOR, VALUE_RATIO_CEILING] are trimmed as outliers. The rest follow
    in score order. Area level only, never one home."""
    eligible, rest = [], []
    for result in pack["values"]:
        row = value_rows.get(result["geographyId"])
        if row is not None:
            ratio = float(row["value_ratio"])
            result["value"] = {"typicalPrice": int(row["typical_price"]), "peerPrice": int(row["peer_price"]),
                               "valueRatio": round(ratio, 3), "valuePercent": round_half_up((ratio - 1) * 100),
                               "sales": int(row["sales"]),
                               "outlier": not VALUE_RATIO_FLOOR <= ratio <= VALUE_RATIO_CEILING}
        result["valueRank"] = None
        (eligible if _value_eligible(result, row) else rest).append(result)
    eligible.sort(key=lambda r: (r["value"]["valueRatio"], r["rank"]))
    for index, result in enumerate(eligible, start=1):
        result["valueRank"] = index
    pack["values"] = eligible + rest
    pack["sort"] = "best-value"
    pack["valueAreas"] = len(eligible)


def count_value_areas(pack: dict, value_rows: Mapping[str, Mapping[str, Any]]) -> int:
    """How many areas the Best value sort would list: the UI hides that sort at 0, e.g. when no area in the
    better half has 20+ sales of the home type (area_good_value leaves those out)."""
    return sum(1 for result in pack["values"] if _value_eligible(result, value_rows.get(result["geographyId"])))


def _value_eligible(result: Mapping[str, Any], row: Mapping[str, Any] | None) -> bool:
    """In the better half of the search, not out, with a good-value figure that is not an outlier."""
    if row is None or result["excluded"]:
        return False
    ratio = float(row["value_ratio"])
    return VALUE_RATIO_FLOOR <= ratio <= VALUE_RATIO_CEILING and (result["percentile"] or 0) >= BEST_VALUE_MIN_PERCENTILE


def value_home_type(profile: Mapping[str, Any]) -> str:
    """The good-value home type for the profile: a flat, one house subtype, else all homes."""
    if profile.get("propertyType") == "flat":
        return "flat"
    house_types = profile.get("houseTypes") or []
    if len(house_types) == 1:
        return house_types[0]
    return "all"
