"""Schools filter v2 (board Schools-filter-options, options 2 + 4): one filter for the map's school markers,
the /schools hub and My match's "near a school like this" place. Mirrors web/src/lib/school-filter.ts.

The filter travels as one compact text, the same as the map's `?schools=` value: "on" for every school, else
segments joined by "_", each a key and its values joined by ".":

    t.p.s        phases: p primary, s secondary, a all-through, x private (absent = all)
    o.out.good   Ofsted standing: out, good, ri, inad, rc (report card), none (absent = all; state schools only)
    e.academy    establishment groups (absent = any; schools.ESTABLISHMENT_GROUPS)
    g.girls      intake: mixed, girls or boys
    f.faith      faith: faith or none
    m.ks2.75     a measure and its threshold (none = colour only): at least the threshold, or at most for the
                 "lower" measures (England top %, free school meals)
    a            sixth forms by A-level results only (every sector)

Keys come in that order (the canonical text). Pupil-mix measures (ethnicity and the like) are never filters here.
"""
from __future__ import annotations

import re
from typing import Any, Mapping

from . import schools

PHASE_CODES = {"p": "primary", "s": "secondary", "a": "all-through", "x": "private"}
OFSTED_IDS = ("out", "good", "ri", "inad", "rc", "none")
GENDERS = ("mixed", "girls", "boys")
FAITHS = ("faith", "none")
# short id -> (measure key on the point, "higher" = at least the threshold | "lower" = at most, (low, high) bounds)
MEASURES: dict[str, tuple[str, str, tuple[float, float]]] = {
    "top": ("englandTopPercent", "lower", (1, 100)),
    "p8": ("progress8", "higher", (-3, 3)),
    "a8": ("attainment8", "higher", (0, 90)),
    "g5": ("grade5EngMaths", "higher", (0, 100)),
    "ks2": ("ks2RwmExpected", "higher", (0, 100)),
    "fsm": ("fsm6Share", "lower", (0, 100)),
}
MEASURE_SHORT = {key: short for short, (key, _, _) in MEASURES.items()}
KEY_ORDER = ("t", "o", "e", "g", "f", "m", "a")
MAX_TEXT = 160
_OFSTED_OF_MARK = {"outstanding": "out", "good": "good", "requires-improvement": "ri", "inadequate": "inad",
                   "report-card": "rc", None: "none"}
_NO_FAITH = re.compile(r"^(none|unknown|does not apply|not applicable)$", re.I)


def default() -> dict:
    return {"phases": list(PHASE_CODES.values()), "ofsted": list(OFSTED_IDS), "establishments": [],
            "gender": None, "faith": None, "measure": None, "aLevelOnly": False}


def _number(text: str) -> float:
    if not re.fullmatch(r"-?\d+(\.\d+)?", text):
        raise ValueError("invalid threshold")
    return float(text)


def _format(value: float) -> str:
    """The threshold as text: 75, 0.5, -0.5 (two decimals at most, the same as the web's Number#toString)."""
    rounded = round(value, 2)
    return str(int(rounded)) if rounded == int(rounded) else repr(rounded)


def parse(text: str) -> dict:
    """The filter from its compact text; ValueError for anything unknown, repeated or out of bounds."""
    if not isinstance(text, str) or not 1 <= len(text) <= MAX_TEXT:
        raise ValueError("invalid school filter")
    result = default()
    if text == "on":
        return result
    seen: list[str] = []
    for segment in text.split("_"):
        key, *values = segment.split(".")
        if key not in KEY_ORDER or key in seen:
            raise ValueError("invalid school filter key")
        if seen and KEY_ORDER.index(key) < KEY_ORDER.index(seen[-1]):
            raise ValueError("school filter keys out of order")
        seen.append(key)
        if key == "t":
            if any(value not in PHASE_CODES for value in values) or len(set(values)) != len(values):
                raise ValueError("invalid school phases")
            result["phases"] = [PHASE_CODES[code] for code in PHASE_CODES if code in values]
        elif key == "o":
            if any(value not in OFSTED_IDS for value in values) or len(set(values)) != len(values):
                raise ValueError("invalid Ofsted standing")
            result["ofsted"] = [grade for grade in OFSTED_IDS if grade in values]
        elif key == "e":
            if not values or any(v not in schools.ESTABLISHMENT_GROUPS for v in values) or len(set(values)) != len(values):
                raise ValueError("invalid establishment groups")
            result["establishments"] = [group for group in schools.ESTABLISHMENT_GROUPS if group in values]
        elif key == "g":
            if len(values) != 1 or values[0] not in GENDERS:
                raise ValueError("invalid intake")
            result["gender"] = values[0]
        elif key == "f":
            if len(values) != 1 or values[0] not in FAITHS:
                raise ValueError("invalid faith")
            result["faith"] = values[0]
        elif key == "m":
            if not values or values[0] not in MEASURES:
                raise ValueError("invalid measure")
            threshold = _number(".".join(values[1:])) if len(values) > 1 else None
            low, high = MEASURES[values[0]][2]
            if threshold is not None and not low <= threshold <= high:
                raise ValueError("measure threshold out of range")
            result["measure"] = {"id": MEASURES[values[0]][0], "threshold": threshold}
        elif values:
            raise ValueError("invalid A-level flag")
        else:
            result["aLevelOnly"] = True
    return result


def text(value: Mapping[str, Any]) -> str:
    """The canonical compact text of a filter ("on" when it keeps every school)."""
    segments = []
    phases = value.get("phases") or []
    if len(phases) != len(PHASE_CODES):
        segments.append(".".join(["t", *[code for code, phase in PHASE_CODES.items() if phase in phases]]))
    ofsted = value.get("ofsted") or []
    if len(ofsted) != len(OFSTED_IDS):
        segments.append(".".join(["o", *[grade for grade in OFSTED_IDS if grade in ofsted]]))
    if value.get("establishments"):
        segments.append(".".join(["e", *[g for g in schools.ESTABLISHMENT_GROUPS if g in value["establishments"]]]))
    if value.get("gender"):
        segments.append(f"g.{value['gender']}")
    if value.get("faith"):
        segments.append(f"f.{value['faith']}")
    measure = value.get("measure")
    if measure:
        threshold = measure.get("threshold")
        segments.append(f"m.{MEASURE_SHORT[measure['id']]}" + ("" if threshold is None else f".{_format(threshold)}"))
    if value.get("aLevelOnly"):
        segments.append("a")
    return "_".join(segments) or "on"


def _gender(point: Mapping[str, Any]) -> str:
    intake = str(point.get("intake") or "")
    return "girls" if intake.startswith("Girls") else "boys" if intake.startswith("Boys") else "mixed"


def matches(point: Mapping[str, Any], value: Mapping[str, Any]) -> bool:
    """Whether a school-points.v1 point passes the filter (schoolMatches in school-filter.ts). A threshold drops
    schools without the measure (suppressed, a small cohort, another phase): the filter cannot vouch for them."""
    independent = point.get("kind") == "independent"
    phase = "private" if independent else point.get("stage") or point.get("phase")
    if phase not in value["phases"]:
        return False
    if value.get("gender") and _gender(point) != value["gender"]:
        return False
    if value.get("faith"):
        has_faith = bool(str(point.get("faith") or "").strip()) and not _NO_FAITH.match(str(point.get("faith")).strip())
        if has_faith != (value["faith"] == "faith"):
            return False
    if value.get("aLevelOnly"):
        return point.get("aLevelRank") is not None
    if value.get("establishments") and point.get("group") not in value["establishments"]:
        return False
    if not independent and _OFSTED_OF_MARK.get(point.get("ofsted"), "none") not in value["ofsted"]:
        return False
    measure = value.get("measure")
    if measure and measure.get("threshold") is not None:
        pair = (point.get("measures") or {}).get(measure["id"])
        if not pair:
            return False
        short = MEASURE_SHORT[measure["id"]]
        lower = MEASURES[short][1] == "lower"
        return pair[0] <= measure["threshold"] if lower else pair[0] >= measure["threshold"]
    return True


def school_set(points: list[Mapping[str, Any]], filter_text: str) -> list[str]:
    """The URNs of the points the filter keeps."""
    value = parse(filter_text)
    return [point["urn"] for point in points if matches(point, value)]

