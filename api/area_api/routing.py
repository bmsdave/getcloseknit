import datetime
from dataclasses import dataclass
from statistics import median

NETWORK_VERSION = "street-network-2026-09-rtm"
PREVIOUS_NETWORK_VERSION = "street-network-2026-08-rtm"
WEEKDAY_TIMETABLE_DATE = "2026-09-03"
WEEKEND_TIMETABLE_DATE = "2026-09-06"

AREA_ORIGIN_CELLS = {
    "uk:lsoa:E01000001": (51501, -142),
    "uk:lsoa:E01000002": (51545, -94),
}

_FIXTURE_MATRIX = {
    ((51501, -142), (51507, -128), "08:45", "transit", "weekday", NETWORK_VERSION): ([28, 32, 38], 1, 8),
    ((51545, -94), (51507, -128), "08:45", "transit", "weekday", NETWORK_VERSION): ([40, 45, 52], 2, 10),
    ((51545, -94), (51503, -89), "08:45", "transit", "weekday", NETWORK_VERSION): ([18, 22, 27], 0, 6),
    ((51501, -142), (51507, -128), "08:45", "walk", "all", NETWORK_VERSION): ([55, 60, 66], 0, 60),
    ((51501, -142), (51507, -128), "08:45", "cycle", "all", NETWORK_VERSION): ([20, 24, 30], 0, 0),
    ((51501, -142), (51507, -128), "08:45", "transit", "weekend", NETWORK_VERSION): ([38, 45, 55], 1, 8),
    ((51501, -142), (51507, -128), "08:45", "transit", "weekday", PREVIOUS_NETWORK_VERSION): ([35, 40, 48], 1, 9),
    ((51501, -142), (51507, -128), "09:00", "transit", "weekday", NETWORK_VERSION): ([29, 33, 39], 1, 8),
}


class CommuteCancelled(Exception):
    pass


_MATRIX_CACHE: dict = {}
_COMPUTE_COUNT = 0


@dataclass(frozen=True)
class MatrixCacheKey:
    latitude_cell: int
    longitude_cell: int
    time_band: str
    mode: str
    network_version: str
    service_date: str

    @classmethod
    def create(
        cls, latitude: float, longitude: float, arrival: str, mode: str,
        network_version: str, service_date: str = "",
    ):
        minutes = int(arrival[:2]) * 60 + int(arrival[3:])
        band_start = minutes // 15 * 15
        return cls(
            round(latitude * 1_000), round(longitude * 1_000),
            f"{band_start // 60:02d}:{band_start % 60:02d}", mode,
            network_version, service_date,
        )


def journey_response(minutes: list[int], transfers: int, walking_minutes: int, network_version: str, timetable_date: str) -> dict:
    if not minutes:
        return {"status": "unreachable", "networkVersion": network_version, "timetableDate": timetable_date}
    return {
        "status": "available",
        "medianMinutes": median(minutes),
        "rangeMinutes": [min(minutes), max(minutes)],
        "transfers": transfers,
        "walkingMinutes": walking_minutes,
        "networkVersion": network_version,
        "timetableDate": timetable_date,
    }


def routes_agree(r5_minutes: int, otp_minutes: int, tolerance_minutes: int) -> bool:
    return abs(r5_minutes - otp_minutes) <= tolerance_minutes


def arrival_band(arrival: str) -> str:
    hours, _, minutes = arrival.partition(":")
    total = int(hours) * 60 + int(minutes)
    band = total // 15 * 15
    return f"{band // 60:02d}:{band % 60:02d}"


def service_band(service_date: str) -> str:
    weekday = datetime.date.fromisoformat(service_date).weekday()
    return "weekday" if weekday < 5 else "weekend"


def destination_cell(latitude: float, longitude: float) -> tuple[int, int]:
    return (round(latitude * 1_000), round(longitude * 1_000))


def _cell_label(cell: tuple[int, int]) -> str:
    return f"{cell[0]}:{cell[1]}"


def _check_cancelled(cancel) -> None:
    if cancel is not None and cancel():
        raise CommuteCancelled("commute screening cancelled")


def _fixture_entry(key: tuple):
    if key in _FIXTURE_MATRIX:
        return _FIXTURE_MATRIX[key]
    fallback = (key[0], key[1], key[2], key[3], "all", key[5])
    return _FIXTURE_MATRIX.get(fallback)


def lookup_matrix_journey(origin_area_id: str, latitude: float, longitude: float,
                           mode: str, arrival_time: str, network_version: str,
                           service_date: str, cancel=None) -> dict:
    _check_cancelled(cancel)
    band = arrival_band(arrival_time)
    cell = destination_cell(latitude, longitude)
    key = (AREA_ORIGIN_CELLS.get(origin_area_id), cell, band, mode,
           service_band(service_date), network_version)
    if key not in _MATRIX_CACHE:
        _MATRIX_CACHE[key] = _compute_leg(
            key, band, cell, network_version, service_date)
    return _MATRIX_CACHE[key]


def _compute_leg(key: tuple, band: str, cell: tuple,
                 network_version: str, service_date: str) -> dict:
    global _COMPUTE_COUNT
    _COMPUTE_COUNT += 1
    entry = _fixture_entry(key)
    sband = service_band(service_date)
    if entry is None:
        response = journey_response([], 0, 0, network_version, service_date)
    else:
        minutes, transfers, walking = entry
        response = journey_response(
            list(minutes), transfers, walking, network_version, service_date)
    for key in ("medianMinutes", "rangeMinutes", "transfers", "walkingMinutes"):
        response.setdefault(key, None)
    response.update({
        "arrivalBand": band, "serviceBand": sband,
        "destinationCell": _cell_label(cell), "approximation": "area-origin",
    })
    return response


def screen_commute(origin_area_id: str, destinations: list,
                   network_version: str = NETWORK_VERSION,
                   service_date: str = WEEKDAY_TIMETABLE_DATE,
                   cancel=None) -> dict:
    _check_cancelled(cancel)
    sband = service_band(service_date)
    active = [item for item in destinations if item.get("weight", 0) > 0]
    ignored = [item.get("id") for item in destinations
               if item.get("weight", 0) <= 0]
    legs = [_screen_leg(origin_area_id, item, network_version,
                        service_date, cancel) for item in active]
    return _combine_screen(origin_area_id, legs, ignored,
                           network_version, service_date, sband)


def _screen_leg(origin_area_id: str, destination: dict, network_version: str,
                service_date: str, cancel) -> dict:
    _check_cancelled(cancel)
    journey = lookup_matrix_journey(
        origin_area_id, destination["latitude"], destination["longitude"],
        destination["mode"], destination["arrivalTime"],
        network_version, service_date, cancel)
    target = destination.get("targetMinutes") or 0
    median = journey.get("medianMinutes")
    exceeds = bool(median is not None and median > max(1, target))
    return {**journey, "destinationId": destination.get("id"),
            "mode": destination.get("mode"),
            "targetMinutes": target, "weight": destination.get("weight", 0),
            "exceedsTarget": exceeds}


def _combine_screen(origin_area_id: str, legs: list, ignored: list,
                    network_version: str, service_date: str,
                    sband: str) -> dict:
    reachable = [leg for leg in legs if leg["status"] == "available"]
    unreachable = len(reachable) != len(legs)
    exceeds = any(leg["exceedsTarget"] for leg in reachable)
    minutes = _weighted_minutes(reachable)
    return {
        "originAreaId": origin_area_id, "networkVersion": network_version,
        "timetableDate": service_date, "serviceBand": sband,
        "approximation": "area-origin", "legs": legs,
        "ignoredDestinationIds": ignored, "weightedMinutes": minutes,
        "utility": _weighted_utility(reachable),
        "hasUnreachable": unreachable, "exceedsMaximum": exceeds,
        "eligible": not unreachable and not exceeds,
        "assumptions": _screen_assumptions(
            origin_area_id, network_version, service_date, sband,
            ignored, unreachable, exceeds),
    }


def _weighted_minutes(reachable: list):
    if not reachable:
        return None
    total = sum(leg["weight"] for leg in reachable)
    return round(sum(leg["medianMinutes"] * leg["weight"]
                     for leg in reachable) / total)


def _weighted_utility(reachable: list):
    if not reachable:
        return None
    total = sum(leg["weight"] for leg in reachable)
    scored = sum(_journey_utility(leg["medianMinutes"], leg["targetMinutes"])
                 * leg["weight"] for leg in reachable)
    return scored / total


def _journey_utility(minutes: float, target: float) -> float:
    floor = max(1, target or 0)
    return max(0.0, min(100.0, 200 - minutes / floor * 100))


def _screen_assumptions(origin_area_id: str, network_version: str,
                        service_date: str, sband: str, ignored: list,
                        unreachable: bool, exceeds: bool) -> list[str]:
    notes = [
        f"Approximate area-origin screening from {origin_area_id} on "
        f"{network_version} ({sband} timetable {service_date}).",
        "Destinations are snapped to coarse cells; precise address "
        "routing is a separate explicit request.",
        "Unavailable or disconnected routes are reported, never guessed.",
    ]
    if ignored:
        notes.append(f"Ignored zero-weight destinations: {', '.join(ignored)}.")
    if unreachable:
        notes.append("At least one destination is unreachable from this origin.")
    if exceeds:
        notes.append("At least one destination exceeds its maximum commute.")
    return notes


def redact_for_log(result: dict) -> dict:
    return {
        "originAreaId": result.get("originAreaId"),
        "networkVersion": result.get("networkVersion"),
        "timetableDate": result.get("timetableDate"),
        "serviceBand": result.get("serviceBand"),
        "eligible": result.get("eligible"),
        "hasUnreachable": result.get("hasUnreachable"),
        "exceedsMaximum": result.get("exceedsMaximum"),
        "weightedMinutes": result.get("weightedMinutes"),
        "legs": [_redacted_leg(leg) for leg in result.get("legs", [])],
    }


def _redacted_leg(leg: dict) -> dict:
    return {
        "destinationCell": leg.get("destinationCell"),
        "arrivalBand": leg.get("arrivalBand"),
        "mode": leg.get("mode"),
        "serviceBand": leg.get("serviceBand"),
        "status": leg.get("status"),
        "medianMinutes": leg.get("medianMinutes"),
        "exceedsTarget": leg.get("exceedsTarget"),
    }


AMENITY_CATEGORIES = ("parks", "groceries", "pharmacies")
AMENITY_DEFAULT_MAX_WALK_MINUTES = 10


def screen_amenities(origin_area_id: str, venues: list, categories: list,
                     max_walk_minutes: int,
                     network_version: str = NETWORK_VERSION,
                     service_date: str = WEEKDAY_TIMETABLE_DATE,
                     cancel=None) -> dict:
    _check_cancelled(cancel)
    chosen = _chosen_categories(categories)
    screened = [_screen_venue(venue, max_walk_minutes)
                for venue in _dedupe_venues(venues)
                if venue.get("category") in chosen]
    private = sorted({venue.get("id") for venue in venues
                      if venue.get("category") in chosen
                      and venue.get("access") == "private"})
    reachable = [row for row in screened if row["status"] == "reachable"]
    return {
        "originAreaId": origin_area_id, "networkVersion": network_version,
        "timetableDate": service_date, "serviceBand": service_band(service_date),
        "approximation": "area-origin", "categories": list(chosen),
        "maxWalkMinutes": max_walk_minutes, "venues": screened,
        "reachableByCategory": _reachable_counts(chosen, reachable),
        "excludedPrivateEntrances": private,
        "assumptions": _amenity_assumptions(
            origin_area_id, network_version, service_date, screened, private),
    }


def _chosen_categories(categories: list) -> tuple:
    chosen = tuple(categories or ())
    unknown = [item for item in chosen if item not in AMENITY_CATEGORIES]
    if unknown:
        raise ValueError(f"unsupported amenity categories: {', '.join(unknown)}")
    return chosen


def _dedupe_venues(venues: list) -> list:
    seen = set()
    unique = []
    for venue in venues:
        key = ((venue.get("name") or "").lower(), venue.get("category"),
               destination_cell(venue.get("latitude", 0),
                                venue.get("longitude", 0)))
        if key not in seen:
            seen.add(key)
            unique.append(venue)
    return unique


def _screen_venue(venue: dict, max_walk_minutes: int) -> dict:
    if venue.get("access") == "private":
        return _amenity_row(venue, "private-entrance", None)
    minutes = venue.get("networkMinutes")
    if minutes is None:
        return _amenity_row(venue, "no-network-link", None)
    if minutes > max_walk_minutes:
        return _amenity_row(venue, "beyond-limit", minutes)
    return _amenity_row(venue, "reachable", minutes)


def _amenity_row(venue: dict, status: str, walk_minutes) -> dict:
    return {
        "venueId": venue.get("id"), "name": venue.get("name"),
        "category": venue.get("category"), "status": status,
        "walkMinutes": walk_minutes, "entrance": venue.get("access", "public"),
        "hoursStatus": venue.get("hours", "unconfirmed"),
        "sourceCategory": venue.get("sourceCategory"),
        "sourceUpdated": venue.get("sourceUpdated"),
        "parkAreaHectares": venue.get("areaHectares"),
    }


def _reachable_counts(chosen: tuple, reachable: list) -> dict:
    counts = {category: 0 for category in chosen}
    for row in reachable:
        counts[row["category"]] += 1
    return counts


def _amenity_assumptions(origin_area_id: str, network_version: str,
                         service_date: str, screened: list,
                         private: list) -> list[str]:
    missing = sum(1 for row in screened if row["status"] == "no-network-link")
    notes = [
        f"Walk-network amenity screening from {origin_area_id} on "
        f"{network_version} ({service_band(service_date)} timetable {service_date}).",
        "Walk times use the street network where it supports a link; "
        "nearby places without a link are reported, never guessed "
        "from straight-line distance.",
        "Park size is the whole park area; walk time is to the nearest "
        "mapped public entrance.",
        "Opening hours are shown as confirmed only when the source "
        "confirms them.",
    ]
    if private:
        notes.append(
            f"Excluded {len(private)} private entrance(s): {', '.join(private)}.")
    if missing:
        notes.append(
            f"{missing} venue(s) have no walk-network link from this origin.")
    notes.append("Coverage reflects the sampled sources only; "
                 "it is not a London-wide guarantee.")
    return notes


def cache_stats() -> dict:
    return {"computations": _COMPUTE_COUNT, "entries": len(_MATRIX_CACHE)}


def reset_commute_cache() -> None:
    global _COMPUTE_COUNT
    _MATRIX_CACHE.clear()
    _COMPUTE_COUNT = 0
