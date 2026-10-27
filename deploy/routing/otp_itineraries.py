"""Typical public-transport routes from every MSOA centre to the commute hubs, from OpenTripPlanner.

OTP 2.9 runs on the ETL machine with the same OSM extract and TfL GTFS as R5 (deploy/routing/README.md).
For each MSOA × hub it asks for the two best itineraries departing 08:30 on the service date and
keeps, per leg, the mode, line, from/to stop, minutes, wait and the shape (simplified, ~1 m
coordinates). Minutes on the map's cards stay R5's (the matrix); these lines are what gets drawn.

    python3 deploy/routing/otp_itineraries.py ORIGINS.csv HUBS.csv OTP_URL OUT.csv
"""
from __future__ import annotations

import csv
import json
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

SERVICE_DATE, DEPARTURE = "2026-10-13", "08:30"
OPTIONS = 2
QUERY = """query ($from: InputCoordinates!, $to: InputCoordinates!) {
  plan(from: $from, to: $to, date: "%s", time: "%s", numItineraries: %d,
       transportModes: [{mode: WALK}, {mode: TRANSIT}]) {
    itineraries { duration walkTime
      legs { mode duration startTime transitLeg
        route { shortName longName }
        from { name } to { name }
        legGeometry { points } } } } }""" % (SERVICE_DATE, DEPARTURE, OPTIONS)


# transx2gtfs short names are "R_<mode>-<code>": TfL line codes for rail, the route number for buses.
LINE_NAMES = {
    "BAK": "Bakerloo", "CEN": "Central", "CIR": "Circle", "DIS": "District", "HAM": "Hammersmith & City",
    "JUB": "Jubilee", "MET": "Metropolitan", "NTN": "Northern", "PIC": "Piccadilly", "VIC": "Victoria",
    "WAC": "Waterloo & City", "DLR": "DLR", "TR": "Tram", "CAB": "Cable car", "B6C": "Uber Boat", "RB1": "Uber Boat",
    "RB4": "Uber Boat", "WFF": "Woolwich Ferry",
}


def line_name(mode: str, short: str | None, long: str | None) -> str | None:
    """'R_1-VIC' -> 'Victoria', 'R_60-385' (bus) -> 'Bus 385'; the approximation feed's names pass through."""
    if not short:
        return long
    if not short.startswith("R_"):
        return short
    code = short.split("-", 1)[1].split("-")[0] if "-" in short else short
    if mode == "BUS":
        return f"Bus {code}"
    return LINE_NAMES.get(code, long or code)


def decode_polyline(encoded: str, precision: int = 5) -> list[list[float]]:
    """Google encoded polyline -> [[lon, lat], ...]."""
    coordinates, index, lat, lon, factor = [], 0, 0, 0, 10 ** precision
    while index < len(encoded):
        for axis in (0, 1):
            shift = result = 0
            while True:
                byte = ord(encoded[index]) - 63
                index += 1
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else result >> 1
            if axis == 0:
                lat += delta
            else:
                lon += delta
        coordinates.append([round(lon / factor, 5), round(lat / factor, 5)])
    return coordinates


def thin(coordinates: list[list[float]], every: int = 3) -> list[list[float]]:
    """Keep every n-th vertex (and both ends): enough for a line on the map, far less to ship."""
    if len(coordinates) <= 4:
        return coordinates
    return coordinates[:-1:every] + [coordinates[-1]]


def plan(url: str, start: tuple[float, float], end: tuple[float, float]) -> list[dict]:
    body = json.dumps({"query": QUERY, "variables": {"from": {"lat": start[0], "lon": start[1]},
                                                       "to": {"lat": end[0], "lon": end[1]}}}).encode()
    request = urllib.request.Request(f"{url}/otp/gtfs/v1", body, {"content-type": "application/json"})
    with urllib.request.urlopen(request, timeout=120) as response:
        payload = json.loads(response.read())
    return ((payload.get("data") or {}).get("plan") or {}).get("itineraries") or []


def itinerary_row(origin: str, hub: str, option: int, itinerary: dict) -> list:
    legs, rides = [], 0
    for leg in itinerary["legs"]:
        rides += bool(leg["transitLeg"])
        route = leg.get("route") or {}
        legs.append({"mode": leg["mode"].lower(), "line": line_name(leg["mode"], route.get("shortName"), route.get("longName")),
                     "from": (leg.get("from") or {}).get("name"), "to": (leg.get("to") or {}).get("name"),
                     "minutes": round(leg["duration"] / 60), "waitMinutes": 0,
                     "coordinates": thin(decode_polyline(leg["legGeometry"]["points"]))})
    return [origin, hub, option, round(itinerary["duration"] / 60), max(0, rides - 1), round(itinerary["walkTime"] / 60),
            json.dumps(legs, separators=(",", ":"))]


def main(origins_path: str, hubs_path: str, url: str, out: str) -> None:
    origins = [(row["id"], float(row["lat"]), float(row["lon"])) for row in csv.DictReader(open(origins_path))]
    hubs = [(row["hub_id"], float(row["latitude"]), float(row["longitude"])) for row in csv.DictReader(open(hubs_path))]
    jobs = [(origin, hub) for origin in origins for hub in hubs]

    def run(job):
        (area, lat, lon), (hub, hub_lat, hub_lon) = job
        try:
            found = plan(url, (lat, lon), (hub_lat, hub_lon))
        except Exception as error:  # noqa: BLE001 - one failed pair is reported, not fatal
            return area, hub, [], str(error)
        transit = [itinerary for itinerary in found if any(leg["transitLeg"] for leg in itinerary["legs"])]
        return area, hub, transit[:OPTIONS], None

    written = failed = 0
    with open(out, "w", newline="") as handle, ThreadPoolExecutor(6) as pool:
        writer = csv.writer(handle)
        writer.writerow(["origin_geography_id", "hub_id", "option", "total_minutes", "transfers", "walking_minutes", "legs"])
        for done, (area, hub, itineraries, error) in enumerate(pool.map(run, jobs), start=1):
            failed += error is not None
            for option, itinerary in enumerate(itineraries, start=1):
                writer.writerow(itinerary_row(area, hub, option, itinerary))
                written += 1
            if done % 2000 == 0:
                print(f"{done}/{len(jobs)} pairs, {written} itineraries, {failed} failed", flush=True)
    print(f"wrote {written} itineraries for {len(jobs)} pairs ({failed} failed) to {out}")


if __name__ == "__main__":
    main(*sys.argv[1:5])
