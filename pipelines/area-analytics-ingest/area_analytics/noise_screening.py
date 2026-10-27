"""AE-24: reviewed road-traffic noise pilot with visit prompts.

First release covers one reviewed strategic road-noise dataset
(modelled exposure, never a live measurement). A location inside a
mapped road corridor reports its modelled band; a gap between corridors
reports no-mapped-exposure, which is never a quietness guarantee; a
location outside the reviewed coverage reports no-coverage. Rail noise
is not a reviewed source yet and aircraft exposure stays separate, so
neither appears here. No speculative nuisance score exists by design.
Visit prompts follow the visitor's stated concerns: evening, weekend,
and event-day prompts are offered, unrelated topics add nothing.
"""

import json
from dataclasses import dataclass

NOISE_SOURCE_ID = "defra-strategic-road-noise"
METHOD_MODELLED = "modelled"
NOISE_UNITS = ("dB LAeq,16h", "dB Lnight")
DEFAULT_UNIT = "dB LAeq,16h"

AIRCRAFT_NOTE = (
    "Aircraft exposure stays separate and is not part of this road pilot."
)
RAIL_NOTE = (
    "Rail noise is not a reviewed source yet: unavailable here, never zero."
)

_PROMPTS = (
    ("evening-noise", "evening",
     "Visit in the evening: road-traffic bands describe the day average, "
     "not the evening peak outside it."),
    ("weekend-noise", "weekend",
     "Visit at the weekend: fleet mix and congestion differ from the "
     "modelled weekday pattern."),
    ("event-day", "event-day",
     "Check event-day conditions: matches and events near the corridors "
     "fall outside the strategic model."),
)


@dataclass(frozen=True)
class NoiseCorridor:
    name: str
    label: str
    band: str
    unit: str
    ring: tuple


@dataclass(frozen=True)
class NoiseCoverage:
    ring: tuple


@dataclass(frozen=True)
class ReferenceSample:
    source_id: str
    corridors: tuple
    coverage: NoiseCoverage


@dataclass(frozen=True)
class LocationScreening:
    status: str
    corridor: str | None
    band: str | None
    unit: str
    method: str
    explanation: str


@dataclass(frozen=True)
class VisitPrompt:
    concern: str
    slot: str
    prompt: str


def load_reference_sample(path) -> ReferenceSample:
    raw = json.loads(path.read_text())
    corridors = tuple(
        NoiseCorridor(
            item["name"], item["label"], item["band"], item["unit"],
            tuple(tuple(point) for point in
                  item["geometry"]["coordinates"][0]),
        )
        for item in raw["corridors"]
    )
    ring = tuple(tuple(point) for point in
                 raw["coverage"]["geometry"]["coordinates"][0])
    return ReferenceSample(raw["source_id"], corridors, NoiseCoverage(ring))


def assess_location(lon, lat, corridors, coverage,
                    unit=DEFAULT_UNIT) -> LocationScreening:
    _require_reviewed_unit(unit)
    point = (lon, lat)
    if not _point_in_ring(point, coverage.ring):
        return LocationScreening(
            "no-coverage", None, None, unit, METHOD_MODELLED,
            "Outside the reviewed road-noise coverage: treat noise "
            "exposure as unknown here, not quiet.",
        )
    for corridor in corridors:
        if _point_in_ring(point, corridor.ring):
            return LocationScreening(
                "mapped-exposure", corridor.name, corridor.band,
                unit, METHOD_MODELLED, _mapped_explanation(corridor),
            )
    return LocationScreening(
        "no-mapped-exposure", None, None, unit, METHOD_MODELLED,
        "Inside the reviewed coverage but between mapped road corridors: "
        "no modelled band applies here. This absence is not a quietness "
        "guarantee: strategic modelled exposure is not a live sound "
        "measurement, and neighbour or night-time sound is not mapped.",
    )


def describe_reading_kind(kind) -> str:
    if kind == "modelled":
        return ("Strategic modelled road-traffic exposure for the mapped "
                "time period and indicator: useful for comparing corridors, "
                "never a prediction of what a visit will sound like.")
    if kind == "measured":
        return ("A live sound measurement at one place and time: it records "
                "what the microphone heard, including unmapped sources, and "
                "is not directly comparable with a modelled strategic band.")
    raise ValueError(f"unknown reading kind: {kind}")


def visit_prompts(concerns) -> tuple:
    wanted = {concern for concern in concerns}
    return tuple(
        VisitPrompt(concern, slot, prompt)
        for concern, slot, prompt in _PROMPTS
        if concern in wanted
    )


def estimate_nuisance_score(*args, **kwargs) -> float:
    raise ValueError(
        "speculative nuisance scores are unsupported: show the reviewed "
        "modelled band with its limits and prompt repeat visits instead"
    )


def _mapped_explanation(corridor) -> str:
    return (f"Mapped modelled exposure {corridor.band} {corridor.unit} "
            f"under {corridor.name} ({METHOD_MODELLED} strategic road "
            f"traffic). {AIRCRAFT_NOTE} A mapped band never guarantees "
            "what a dwelling sounds like: visit before deciding.")


def _require_reviewed_unit(unit) -> None:
    if unit not in NOISE_UNITS:
        raise ValueError(
            f"incompatible noise unit {unit!r}: the reviewed road pilot "
            f"only compares {', '.join(NOISE_UNITS)}"
        )


def _point_in_ring(point, ring) -> bool:
    if any(_point_on_segment(point, ring[i - 1], ring[i])
           for i in range(len(ring))):
        return True
    inside = False
    for i in range(len(ring)):
        first, second = ring[i - 1], ring[i]
        if _ray_crosses(point, first, second):
            inside = not inside
    return inside


def _point_on_segment(point, first, second) -> bool:
    cross = ((second[0] - first[0]) * (point[1] - first[1])
             - (second[1] - first[1]) * (point[0] - first[0]))
    if abs(cross) > 1e-12:
        return False
    return (min(first[0], second[0]) - 1e-12 <= point[0]
            <= max(first[0], second[0]) + 1e-12
            and min(first[1], second[1]) - 1e-12 <= point[1]
            <= max(first[1], second[1]) + 1e-12)


def _ray_crosses(point, first, second) -> bool:
    if (first[1] > point[1]) == (second[1] > point[1]):
        return False
    crossing = (first[0] + (point[1] - first[1])
                * (second[0] - first[0]) / (second[1] - first[1]))
    return crossing > point[0]
