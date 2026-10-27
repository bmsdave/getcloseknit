"""Links from agent answers back to the website.

`encode_profile` is a byte-for-byte port of `encodeSharedProfile` in
`web/src/lib/profile-state.ts` (compact array → JSON → base64url), so a
profile an agent built opens on the map exactly as a link shared from the
site would. A preference-profile.v2 (the ordered criteria)
goes in a `#profile=v3.` link (`encode_profile_v2`, encodeProfileLinkV3 in
web/src/lib/profile-link.ts). `contracts/fixtures/agent-share-links.json`
pins both sides.
"""
import base64
import json
import os
from typing import Any, Mapping
from urllib.parse import quote

from . import kinds
from .matching import RETIRED_FACTOR_IDS

PROFILE_PREFIX = "#profile=v1."
# The site's Share button writes the same array with defaults left out (encodeShareLink in
# web/src/lib/profile-state.ts): no zero-weight factors, short factor tuples, 0 for the default
# school settings, then "&compare=…". This module still writes v1; it reads both.
COMPACT_PROFILE_PREFIX = "#profile=v2."
# preference-profile.v2 (ordered criteria): a compact object, see _pack_v2.
V2_PROFILE_PREFIX = "#profile=v3."
DEFAULT_SCHOOL = {"phases": ["primary"], "characteristics": [], "facetWeights": {"progress": 3, "attainment": 2, "attendance": 1},
                  "shortlistUrns": [], "desiredSchoolCount": 3}
BRIEF_PREFIX = "#brief=v1."
BRIEF_CRITERIA = ("price", "schools", "commute", "safety", "station")
FACTOR_IDS = ("affordability", "market-level", "growth-outlook", "crime", "deprivation", "income",
              "social-renting", "commute", "schools", "station-access",
              "noise", "disorder", "epc-share", "leasehold-share")
DIRECTIONS = ("higher", "lower", "target-range")
MODES = ("transit", "walk", "cycle")
PLACE_MODES = ("walk", "cycle", "transit", "car")  # append-only: old links keep their indexes
PLACE_WHENS = ("weekday-am", "weekday-pm", "saturday")
DEFAULT_SITE_URL = "http://127.0.0.1:4180"


def site_url() -> str:
    """Origin of the website (not the API): CLOSE_KNIT_SITE_URL, else the public URL."""
    value = os.environ.get("CLOSE_KNIT_SITE_URL") or os.environ.get("CLOSE_KNIT_PUBLIC_URL")
    return (value or DEFAULT_SITE_URL).rstrip("/")


def encode_profile(profile: Mapping[str, Any]) -> str:
    if profile.get("schemaVersion") == "preference-profile.v2":
        return encode_profile_v2(profile)
    return PROFILE_PREFIX + _base64url(json.dumps(_pack_profile(profile), separators=(",", ":"), ensure_ascii=False))


def encode_profile_v2(profile: Mapping[str, Any]) -> str:
    """`#profile=v3.` + the compact v2 object (encodeProfileLinkV3 in web/src/lib/profile-link.ts)."""
    return V2_PROFILE_PREFIX + _base64url(json.dumps(_pack_v2(profile), separators=(",", ":"), ensure_ascii=False))


def decode_profile(fragment: str) -> Any:
    """The compact value behind a fragment (v1 or v2 array, v3 object; anything after "&" is not the profile)."""
    body = fragment.removeprefix(PROFILE_PREFIX).removeprefix(COMPACT_PROFILE_PREFIX) \
        .removeprefix(V2_PROFILE_PREFIX).split("&", 1)[0]
    return json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)).decode("utf-8"))


def profile_from_link(link: str) -> dict:
    """The preference profile in a site link (`…#profile=v1.…`, v2 or v3), as the site reads it: a v1
    profile for v1/v2 links, a preference-profile.v2 for v3 ones. Raises ValueError for anything else."""
    _, hash_mark, fragment = link.partition("#")
    if not hash_mark or not ("#" + fragment).startswith((PROFILE_PREFIX, COMPACT_PROFILE_PREFIX, V2_PROFILE_PREFIX)):
        raise ValueError("not an Close Knit search link (no #profile=v1.)")
    try:
        value = decode_profile("#" + fragment)
        # A link from before step R2 names LADs uk:borough:...: read as the current ids.
        if ("#" + fragment).startswith(V2_PROFILE_PREFIX):
            return kinds.canonical_value(_unpack_v2(value))
        return kinds.canonical_value(_unpack_profile(value))
    except (ValueError, IndexError, KeyError, TypeError, AttributeError) as error:
        raise ValueError("the search link is damaged") from error


def _unpack_profile(value: list) -> dict:
    school = value[7] if value[7] != 0 else [DEFAULT_SCHOOL[key] for key in ("phases", "characteristics")] + [
        list(DEFAULT_SCHOOL["facetWeights"].items()), DEFAULT_SCHOOL["shortlistUrns"], DEFAULT_SCHOOL["desiredSchoolCount"]]
    profile = {
        "schemaVersion": "preference-profile.v1", "market": "buy" if value[0] == 0 else "rent",
        "targetBudget": value[1], "maximumBudget": value[2], "bedrooms": value[3],
        "forecastHorizon": "1y" if value[4] == 1 else "5y",
        "factors": [{"factorId": _pick(FACTOR_IDS, f[0]), "weight": f[1], "direction": _pick(DIRECTIONS, f[2]),
                     "minimumUtility": f[3] if len(f) > 3 else None, "maximumUtility": f[4] if len(f) > 4 else None}
                    for f in value[5]],
        "commuteDestinations": [{"id": d[0], "label": d[1], "latitude": d[2], "longitude": d[3], "mode": _pick(MODES, d[4]),
                                 "arrivalTime": d[5], "targetMinutes": d[6], "weight": d[7]} for d in value[6]],
        "school": {"phases": school[0], "characteristics": school[1], "facetWeights": dict(school[2]),
                   "shortlistUrns": school[3], "desiredSchoolCount": school[4]},
        "analyticsConsent": value[8] == 1,
    }
    # #231: old links may carry retired factors; the site's withoutRetiredFactors() drops them and opens the link.
    dropped = [f["factorId"] for f in profile["factors"] if f["factorId"] in RETIRED_FACTOR_IDS]
    if dropped:
        kept = [f for f in profile["factors"] if f["factorId"] not in RETIRED_FACTOR_IDS]
        profile["factors"] = kept or [dict(f) for f in FRESH_PROFILE["factors"]]
        profile["droppedFactors"] = dropped
    if len(value) > 9 and value[9]:
        profile["zones"] = [_unpack_zone(zone) for zone in value[9]]
    extras = value[10] if len(value) > 10 else {}
    if extras.get("t"):
        profile["propertyType"] = extras["t"]
    if extras.get("p"):
        profile["places"] = [{
            "id": p[0], "label": p[1],
            "target": _unpack_target(p),
            "mode": _pick(PLACE_MODES, p[5]), "targetMinutes": p[6], "weight": p[7], "must": p[8] == 1,
            **({"when": _unpack_when(p[9])} if len(p) > 9 and p[9] is not None else {}),
        } for p in extras["p"]]
    if extras.get("c"):
        profile["custom"] = [_unpack_custom(entry) for entry in extras["c"]]
    if extras.get("l") or extras.get("x") or extras.get("n"):
        profile["marks"] = {"liked": extras.get("l", []), "excluded": extras.get("x", []),
                            "notes": {area_id: text for area_id, text in extras.get("n", [])}}
    if extras.get("h"):
        profile["houseTypes"] = list(extras["h"])
    if extras.get("r"):
        profile["ranges"] = [{"layer": r[0], "min": r[1], "max": r[2], "softMin": r[3], "softMax": r[4], "importance": r[5]}
                             for r in extras["r"]]
    return profile


def _unpack_target(p: list) -> dict:
    """Compact place target: 0 point [lat, lon], 1 kind [category, [brand, sport] | None], 2 school rule [phase, top],
    3 near any of [[lat, lon], ...]."""
    if p[2] == 0:
        return {"kind": "point", "latitude": p[3], "longitude": p[4]}
    if p[2] == 3:
        return {"kind": "any-of", "points": p[3]}
    if p[2] == 4:
        # Schools filter v2: its compact text and the within metres (None = none).
        return {"kind": "school-filter", "filter": p[3], **({"within": p[4]} if p[4] is not None else {})}
    if p[2] == 2:
        # Element 10, when present, is the school ranking ("progress8"); absent means results.
        return {"kind": "school", "phase": p[3], "top": p[4], **({"rankBy": p[10]} if len(p) > 10 and p[10] else {})}
    target = {"kind": "category", "category": p[3]}
    if isinstance(p[4], list):
        brand, sport = (p[4] + [None, None])[:2]
        if brand:
            target["brand"] = brand
        if sport:
            target["sport"] = sport
    return target


def _unpack_zone(value: list) -> dict:
    kind = value[0]
    if kind == 0:
        zone = {"kind": "station", "stationId": value[1], "maxWalkMinutes": value[2]}
        label = value[3] if len(value) > 3 else None
    elif kind == 1:
        zone = {"kind": "borough", "id": value[1]}
        label = value[2] if len(value) > 2 else None
    elif kind == 3:
        zone = {"kind": "polygon", "points": value[1]}
        label = value[2] if len(value) > 2 else None
    else:
        zone = {"kind": "lsoas", "ids": value[1]}
        label = value[2] if len(value) > 2 else None
    if label is not None:
        zone["label"] = label
    return zone


def encode_brief(brief: Mapping[str, Any]) -> str:
    """Port of `encodeBrief` in web/src/lib/brief-model.ts: short keys in a fixed order."""
    packed = {
        "a": list(brief["areas"]),
        "b": [_number(value) for value in brief["budget"]],
        "m": brief["market"], "r": brief["bedrooms"], "t": brief["propertyType"],
        "c": list(brief["criteria"]),
        "d": [[d["label"], d["latitude"], d["longitude"]] for d in brief.get("destinations", [])],
    }
    return BRIEF_PREFIX + _base64url(json.dumps(packed, separators=(",", ":"), ensure_ascii=False))


def brief_url(areas: list[str], budget: tuple[int | None, int | None], market: str, bedrooms: int,
              property_type: str = "any", criteria: list[str] | None = None,
              destinations: list[dict] | None = None) -> str:
    """The /brief page for a shortlist (at most six areas, in rank order)."""
    brief = {"areas": areas[:6], "budget": list(budget), "market": market, "bedrooms": bedrooms,
             "propertyType": property_type,
             "criteria": [c for c in BRIEF_CRITERIA if c in (criteria or [])],
             "destinations": destinations or []}
    return f"{site_url()}/brief{encode_brief(brief)}"


def _base64url(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode("utf-8")).decode("ascii").rstrip("=")


def area_url(area_id: str) -> str:
    carrier, code = _split_area(area_id)
    return f"{site_url()}/area/{carrier}/{code}"


def pack_url(area_id: str) -> str:
    return area_url(area_id) + "/pack"


def map_url(profile: Mapping[str, Any] | None = None, selected: str | None = None) -> str:
    query = "layer=personal-match" if profile else "layer=crime"
    if selected:
        query += "&selected=" + quote(selected, safe=":")
    return f"{site_url()}/?{query}" + (encode_profile(profile) if profile else "")


# A fresh visitor's search (DEFAULT_PROFILE's budget in web/src/lib/fixtures.ts) with nothing weighted: a link
# that shows one custom criterion on its own ranks by that criterion alone.
FRESH_PROFILE = {
    "schemaVersion": "preference-profile.v1", "market": "buy", "targetBudget": 500000, "maximumBudget": 650000,
    "bedrooms": 2, "forecastHorizon": "1y",
    "factors": [{"factorId": "crime", "weight": 0, "direction": "lower", "minimumUtility": None, "maximumUtility": None}],
    "commuteDestinations": [],
    "school": {"phases": ["primary"], "characteristics": [], "facetWeights": {}, "shortlistUrns": [], "desiredSchoolCount": 3},
    "analyticsConsent": False,
}


def custom_map_url(profile: Mapping[str, Any], criterion_id: str) -> str:
    """The map painted with one custom criterion (layer custom:<id>); the criterion itself rides in the
    profile fragment, never in the query."""
    return f"{site_url()}/?layer=custom:{quote(criterion_id, safe='')}" + encode_profile(profile)


def area_links(area_id: str, profile: Mapping[str, Any] | None = None) -> dict:
    links = {"area": area_url(area_id), "map": map_url(profile, area_id)}
    if area_id.startswith(("uk:lsoa:", "uk:msoa:")):
        links["evidencePack"] = pack_url(area_id)
    return links


def _split_area(area_id: str) -> tuple[str, str]:
    _, carrier, code = area_id.split(":", 2)
    return carrier, code


def _number(value: Any) -> Any:
    """JSON.stringify prints 600000.0 as 600000; keep the bytes identical."""
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def _pack_profile(profile: Mapping[str, Any]) -> list:
    school = profile["school"]
    packed = [
        0 if profile["market"] == "buy" else 1,
        _number(profile["targetBudget"]),
        _number(profile["maximumBudget"]),
        profile["bedrooms"],
        1 if profile["forecastHorizon"] == "1y" else 5,
        [[FACTOR_IDS.index(f["factorId"]), f["weight"], DIRECTIONS.index(f["direction"]),
          _number(f.get("minimumUtility")), _number(f.get("maximumUtility"))] for f in profile["factors"]],
        [[d["id"], d["label"], d["latitude"], d["longitude"], MODES.index(d["mode"]), d["arrivalTime"],
          d["targetMinutes"], d["weight"]] for d in profile["commuteDestinations"]],
        [school["phases"], school["characteristics"], [[k, v] for k, v in school["facetWeights"].items()],
         school["shortlistUrns"], school["desiredSchoolCount"]],
        1 if profile["analyticsConsent"] else 0,
    ]
    extras = _pack_extras(profile)
    if profile.get("zones") or extras:
        packed.append([_pack_zone(zone) for zone in profile.get("zones") or []])
    if extras:
        packed.append(extras)
    return packed


def _pack_extras(profile: Mapping[str, Any]) -> dict | None:
    """Element 10 of the compact profile (packExtras in profile-state.ts): keys in the same
    order, empty ones left out so older profiles encode exactly as before."""
    extras: dict = {}
    if profile.get("propertyType") in ("house", "flat"):
        extras["t"] = profile["propertyType"]
    if profile.get("places"):
        extras["p"] = [_pack_place(place) for place in profile["places"]]
    if profile.get("custom"):
        extras["c"] = [_pack_custom(entry) for entry in profile["custom"]]
    marks = profile.get("marks") or {}
    if marks.get("liked"):
        extras["l"] = list(marks["liked"])
    if marks.get("excluded"):
        extras["x"] = list(marks["excluded"])
    if marks.get("notes"):
        extras["n"] = [[area_id, text] for area_id, text in marks["notes"].items()]
    if profile.get("houseTypes"):
        extras["h"] = list(profile["houseTypes"])
    if profile.get("ranges"):
        # Range criteria: [layer, min, max, softMin, softMax, importance], open bounds as null.
        extras["r"] = [[item["layer"], item.get("min"), item.get("max"), item.get("softMin"), item.get("softMax"),
                        item["importance"]] for item in profile["ranges"]]
    return extras or None


def _unpack_when(index: Any) -> str:
    """unpackWhen in profile-state.ts: an index outside PLACE_WHENS (negative ones too) is a damaged link."""
    return _pick(PLACE_WHENS, index, "invalid place time band")


def _pick(options: tuple[str, ...], index: Any, message: str = "invalid enum index") -> str:
    """One packed enum value; a negative or out-of-range index is a damaged link, never Python's -1 (#231)."""
    if isinstance(index, bool) or not isinstance(index, int) or not 0 <= index < len(options):
        raise ValueError(message)
    return options[index]


def _pack_place(place: Mapping[str, Any]) -> list:
    """packPlace in profile-state.ts. Tail after the nine base elements: element 9 the time band's index
    (None when unset), element 10 a school rule's ranking when not "results" (older links stop at nine)."""
    target = place["target"]
    ranking = target.get("rankBy") if target["kind"] == "school" and target.get("rankBy") not in (None, "results") else None
    when = PLACE_WHENS.index(place["when"]) if place.get("when") is not None else None
    tail = [when, ranking] if ranking else ([when] if when is not None else [])
    return _pack_place_base(place) + tail


def _pack_place_base(place: Mapping[str, Any]) -> list:
    target = place["target"]
    mode = PLACE_MODES.index(place["mode"])
    must = 1 if place["must"] else 0
    if target["kind"] == "point":
        return [place["id"], place["label"], 0, _number(target["latitude"]), _number(target["longitude"]), mode,
                place["targetMinutes"], place["weight"], must]
    if target["kind"] == "any-of":
        return [place["id"], place["label"], 3, _points(target["points"]), None, mode, place["targetMinutes"],
                place["weight"], must]
    if target["kind"] == "school":
        return [place["id"], place["label"], 2, target["phase"], target["top"], mode, place["targetMinutes"], place["weight"], must]
    if target["kind"] == "school-filter":
        return [place["id"], place["label"], 4, target["filter"], target.get("within"), mode, place["targetMinutes"],
                place["weight"], must]
    narrow = [target.get("brand"), target.get("sport")] if target.get("brand") or target.get("sport") else None
    return [place["id"], place["label"], 1, target["category"], narrow, mode, place["targetMinutes"], place["weight"], must]


def _pack_zone(zone: Mapping[str, Any]) -> list:
    label = [zone["label"]] if zone.get("label") is not None else []
    if zone["kind"] == "station":
        return [0, zone["stationId"], zone["maxWalkMinutes"], *label]
    if zone["kind"] == "borough":
        return [1, zone["id"], *label]
    if zone["kind"] == "polygon":
        return [3, _points(zone["points"]), *label]
    return [2, list(zone["ids"]), *label]


# Custom criteria (key "c" of element 10, packCustom in profile-state.ts): [criterion, weight, direction],
# criterion = [id, label, formula, radius, [[set id, label, [[[key, value], ...] per matcher]], ...]].
CUSTOM_DIRECTIONS = ("higher", "lower")
CUSTOM_SET_IDS = ("a", "b", "c")  # packed in this order whatever the definition's own order


def _pack_custom(entry: Mapping[str, Any]) -> list:
    criterion = entry["criterion"]
    sets = [[set_id, place_set["label"], [[[key, value] for key, value in matcher.items()] for matcher in place_set["any"]]]
            for set_id in CUSTOM_SET_IDS if (place_set := criterion["sets"].get(set_id))]
    return [[criterion["id"], criterion["label"], criterion["formula"], criterion["radiusMetres"], sets],
            entry["weight"], CUSTOM_DIRECTIONS.index(entry["direction"])]


def _unpack_custom(value: list) -> dict:
    criterion, weight, direction = value
    sets = {set_id: {"label": label, "any": [{key: test for key, test in matcher} for matcher in matchers]}
            for set_id, label, matchers in criterion[4]}
    return {"criterion": {"id": criterion[0], "label": criterion[1], "sets": sets, "formula": criterion[2],
                          "radiusMetres": criterion[3]},
            "weight": weight, "direction": _pick(CUSTOM_DIRECTIONS, direction)}


def _points(points: Any) -> list:
    """[latitude, longitude] pairs, printed as JSON.stringify prints them."""
    return [[_number(lat), _number(lon)] for lat, lon in points]


# ---- #profile=v3. (preference-profile.v2) ------------------------------------------------------------
# {"m": 0 buy | 1 rent, "t": targetBudget, "x": maximumBudget, "b": bedrooms?, "c": [criterion...],
#  "k": propertyType?, "h": houseTypes?, "l": liked?, "e": excluded?, "n": [[id, note]]?}
# criterion: ["b", must] budget | ["r", layer, 0 value | 1 percentile, min, max, softMin, softMax, must]
# | ["p", id, label, target, mode index, targetMinutes, softMinutes, must, when index] (target as in _pack_place:
# [0, lat, lon] | [1, category, brand, sport] | [2, phase, top, rankBy] | [3, points])
# | ["w", [zone...] (as _pack_zone), softMetres, must] | ["c", criterion (as _pack_custom), 0 higher | 1 lower, must].
# must is 1 or 0; open values are null. Keys in this order; empty optional keys left out.

def _pack_v2(profile: Mapping[str, Any]) -> dict:
    packed: dict = {"m": 0 if profile.get("market", "buy") == "buy" else 1,
                    "t": _number(profile["targetBudget"]), "x": _number(profile["maximumBudget"])}
    if profile.get("bedrooms") is not None:
        packed["b"] = profile["bedrooms"]
    packed["c"] = [_pack_criterion(item) for item in profile.get("criteria") or [] if not str(item.get("kind")).startswith("_")
                   and item.get("kind") in ("budget", "range", "place", "where", "custom")]
    if profile.get("propertyType") in ("house", "flat"):
        packed["k"] = profile["propertyType"]
    if profile.get("houseTypes"):
        packed["h"] = list(profile["houseTypes"])
    marks = profile.get("marks") or {}
    if marks.get("liked"):
        packed["l"] = list(marks["liked"])
    if marks.get("excluded"):
        packed["e"] = list(marks["excluded"])
    if marks.get("notes"):
        packed["n"] = [[area_id, text] for area_id, text in marks["notes"].items()]
    return packed


def _pack_criterion(item: Mapping[str, Any]) -> list:
    must = 1 if item.get("must") else 0
    kind = item["kind"]
    if kind == "budget":
        return ["b", must]
    if kind == "range":
        return ["r", item["layer"], 1 if item.get("scale") == "percentile" else 0, _number(item.get("min")),
                _number(item.get("max")), _number(item.get("softMin")), _number(item.get("softMax")), must]
    if kind == "place":
        return ["p", item["id"], item["label"], _pack_target(item["target"]), PLACE_MODES.index(item["mode"]),
                item["targetMinutes"], item.get("softMinutes"), must,
                PLACE_WHENS.index(item["when"]) if item.get("when") is not None else None]
    if kind == "where":
        return ["w", [_pack_zone(zone) for zone in item["zones"]], item.get("softMetres"), must]
    criterion = _pack_custom({"criterion": item["criterion"], "weight": 0, "direction": item["direction"]})
    return ["c", criterion[0], criterion[2], must]


def _pack_target(target: Mapping[str, Any]) -> list:
    if target["kind"] == "point":
        return [0, _number(target["latitude"]), _number(target["longitude"])]
    if target["kind"] == "category":
        return [1, target["category"], target.get("brand"), target.get("sport")]
    if target["kind"] == "school":
        return [2, target["phase"], target["top"], target.get("rankBy")]
    if target["kind"] == "school-filter":
        return [4, target["filter"], target.get("within")]
    return [3, _points(target["points"])]


def _unpack_v2(value: Mapping[str, Any]) -> dict:
    profile: dict = {"schemaVersion": "preference-profile.v2", "market": "rent" if value["m"] == 1 else "buy",
                     "targetBudget": value["t"], "maximumBudget": value["x"]}
    if "b" in value:
        profile["bedrooms"] = value["b"]
    profile["criteria"] = [unpack_criterion(item) for item in value["c"]]
    if value.get("k"):
        profile["propertyType"] = value["k"]
    if value.get("h"):
        profile["houseTypes"] = list(value["h"])
    if value.get("l") or value.get("e") or value.get("n"):
        profile["marks"] = {"liked": value.get("l", []), "excluded": value.get("e", []),
                            "notes": {area_id: text for area_id, text in value.get("n", [])}}
    return profile


def unpack_criterion(item: list) -> dict:
    """One packed v3 criterion; raises (KeyError, IndexError, TypeError, ValueError) when it is unreadable."""
    kind = item[0]
    if kind == "b":
        return {"kind": "budget", "must": item[1] == 1}
    if kind == "r":
        return {"kind": "range", "layer": item[1], "scale": "percentile" if item[2] == 1 else "value", "min": item[3],
                "max": item[4], "softMin": item[5], "softMax": item[6], "must": item[7] == 1}
    if kind == "p":
        place = {"kind": "place", "id": item[1], "label": item[2], "target": _unpack_v3_target(item[3]),
                 "mode": _pick(PLACE_MODES, item[4]), "targetMinutes": item[5], "must": item[7] == 1}
        if item[6] is not None:
            place["softMinutes"] = item[6]
        if len(item) > 8 and item[8] is not None:
            place["when"] = _unpack_when(item[8])
        return place
    if kind == "w":
        where = {"kind": "where", "zones": [_unpack_zone(zone) for zone in item[1]], "must": item[3] == 1}
        if item[2] is not None:
            where["softMetres"] = item[2]
        return where
    if kind == "c":
        entry = _unpack_custom([item[1], 0, item[2]])
        return {"kind": "custom", "criterion": entry["criterion"], "direction": entry["direction"], "must": item[3] == 1}
    raise ValueError(f"unknown criterion kind {kind!r}")


def _unpack_v3_target(value: list) -> dict:
    if value[0] == 0:
        return {"kind": "point", "latitude": value[1], "longitude": value[2]}
    if value[0] == 1:
        target = {"kind": "category", "category": value[1]}
        if value[2]:
            target["brand"] = value[2]
        if value[3]:
            target["sport"] = value[3]
        return target
    if value[0] == 2:
        return {"kind": "school", "phase": value[1], "top": value[2], **({"rankBy": value[3]} if value[3] else {})}
    if value[0] == 3:
        return {"kind": "any-of", "points": value[1]}
    if value[0] == 4:
        return {"kind": "school-filter", "filter": value[1], **({"within": value[2]} if value[2] is not None else {})}
    raise ValueError("unknown place target")
