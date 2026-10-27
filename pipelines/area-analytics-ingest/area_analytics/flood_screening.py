"""AE-23: source-specific flood screening for candidate places.

First release covers one reviewed Environment Agency dataset (rivers
and sea). A location reports polygon intersection; a coarse area
reports area exposure, never building-level risk. Other mechanisms are
separately named observations, never merged. Missing coverage is
distinct from no mapped exposure. Insurance-cost prediction and any
single generic flood score are unsupported by design.
"""

import json
from dataclasses import dataclass

FLOOD_SOURCE_ID = "ea-flood-risk-rivers-sea"
PRIMARY_MECHANISM = "rivers-sea"
LOCATION_SEMANTICS = "polygon-intersection"
AREA_SEMANTICS = "area-exposure"
FLOOD_CHECK_URL = "https://www.gov.uk/check-long-term-flood-risk"

AREA_LEVEL_NOTE = (
    "Mapped exposure describes the area polygon, not every building in "
    "it: a small exposed section never means each building shares the risk."
)


@dataclass(frozen=True)
class ScreeningZone:
    name: str
    label: str
    ring: tuple


@dataclass(frozen=True)
class ScreeningCoverage:
    ring: tuple


@dataclass(frozen=True)
class ReferenceSample:
    source_id: str
    zones: tuple
    coverage: ScreeningCoverage


@dataclass(frozen=True)
class LocationScreening:
    status: str
    intersections: tuple
    explanation: str


@dataclass(frozen=True)
class AreaScreening:
    semantics: str
    exposures: dict
    explanation: str


def load_reference_sample(path) -> ReferenceSample:
    raw = json.loads(path.read_text())
    zones = tuple(
        ScreeningZone(
            item["name"], item["label"],
            tuple(tuple(point) for point in
                  item["geometry"]["coordinates"][0]),
        )
        for item in raw["mechanisms"]
    )
    ring = tuple(tuple(point) for point in
                 raw["coverage"]["geometry"]["coordinates"][0])
    return ReferenceSample(raw["source_id"], zones, ScreeningCoverage(ring))


def assess_location(lon, lat, zones, coverage) -> LocationScreening:
    point = (lon, lat)
    if not _point_in_ring(point, coverage.ring):
        return LocationScreening(
            "no-coverage", (),
            "Outside the reviewed screening coverage: treat flood "
            "exposure as unknown and check the official flood service.",
        )
    hits = tuple((zone.name, _point_in_ring(point, zone.ring))
                 for zone in zones)
    exposed = sorted(name for name, hit in hits if hit)
    if not exposed:
        return LocationScreening("no-mapped-exposure", hits,
                                 _clear_explanation())
    return LocationScreening("exposed", hits, _exposed_explanation(exposed))


def assess_area(area_ring, zones, coverage) -> AreaScreening:
    ring = tuple(tuple(point) for point in area_ring)
    _require_rectangle(ring)
    exposures = {zone.name: _overlap_fraction(ring, zone.ring)
                 for zone in zones}
    named = ", ".join(f"{name}: {share:.1%}" for name, share in
                      sorted(exposures.items()))
    return AreaScreening(
        AREA_SEMANTICS, exposures,
        f"Coarse area exposure ({LOCATION_SEMANTICS} for points, "
        f"{AREA_SEMANTICS} for areas): {named}. {AREA_LEVEL_NOTE}",
    )


def estimate_insurance_cost(*args, **kwargs) -> float:
    raise ValueError(
        "insurance-cost prediction is unsupported: show mapped exposure "
        "and link the official flood check, never a price"
    )


def _exposed_explanation(exposed) -> str:
    names = ", ".join(exposed)
    extra = [name for name in exposed if name != PRIMARY_MECHANISM]
    separate = (f" {', '.join(extra)} is a separately named observation, "
                "never merged into the rivers-and-sea screening." if extra
                else "")
    return (f"Mapped exposure under {names} ({LOCATION_SEMANTICS} for a "
            f"location).{separate} {AREA_LEVEL_NOTE} Check the official "
            "flood service for the property-specific position.")


def _clear_explanation() -> str:
    return ("No mapped exposure inside the reviewed screening coverage: "
            "no zone polygon intersects this location. Absence from the "
            "mapped extent is not a guarantee; check the official flood "
            "service for the property-specific position.")


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


def _require_rectangle(ring) -> None:
    longitudes = {point[0] for point in ring}
    latitudes = {point[1] for point in ring}
    corners = {(lon, lat) for lon in longitudes for lat in latitudes}
    if len(longitudes) != 2 or len(latitudes) != 2:
        raise ValueError("area screening needs an axis-aligned rectangle")
    if set(ring) != corners:
        raise ValueError("area screening needs an axis-aligned rectangle")


def _overlap_fraction(area_ring, zone_ring) -> float:
    _require_rectangle(zone_ring)
    west, south, east, north = _rect_bounds(area_ring)
    zone_west, zone_south, zone_east, zone_north = _rect_bounds(zone_ring)
    width = min(east, zone_east) - max(west, zone_west)
    height = min(north, zone_north) - max(south, zone_south)
    if width <= 0 or height <= 0:
        return 0.0
    return (width * height) / ((east - west) * (north - south))


def _rect_bounds(ring) -> tuple:
    longitudes = [point[0] for point in ring]
    latitudes = [point[1] for point in ring]
    return (min(longitudes), min(latitudes),
            max(longitudes), max(latitudes))
