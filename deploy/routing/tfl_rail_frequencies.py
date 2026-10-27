"""Frequency-based GTFS for the London Overground lines and the Elizabeth line.

TfL's Journey Planner timetables (TransXChange) cover the Underground, DLR, trams, river and buses,
but not these rail lines, and the Unified API publishes no timetable for them. Until the National
Rail timetable is registered as a source, this builds an approximation from what the Unified API
does publish (TfL open data terms, "Powered by TfL Open Data"): every route pattern's ordered
stops with coordinates. Run times come from the distance between stations at a line speed plus a
dwell; service is a fixed weekday headway per pattern. The feed says so in its name and agency, and
the routing release records it as an approximation.

    python3 deploy/routing/tfl_rail_frequencies.py OUT.zip [--cache DIR]
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import math
import time
import urllib.request
import zipfile
from pathlib import Path

API = "https://api.tfl.gov.uk"
LINES = ["elizabeth", "liberty", "lioness", "mildmay", "suffragette", "weaver", "windrush"]
# Cruising speed between stations (km/h), dwell and acceleration allowance (minutes) per stop.
SPEED_KMH = {"elizabeth": 75.0}
DEFAULT_SPEED_KMH = 55.0
STOP_ALLOWANCE_MIN = 1.0
# Weekday headway per route pattern (minutes); trunk sections get the sum of their patterns.
HEADWAY_MIN = {"elizabeth": 10, "mildmay": 8, "windrush": 8}
DEFAULT_HEADWAY_MIN = 15
SERVICE_START, SERVICE_END = "06:00:00", "23:30:00"
CALENDAR = ("weekday", 1, 1, 1, 1, 1, 0, 0, "20260101", "20271231")


def fetch(path: str, cache: Path | None) -> dict:
    target = cache / (path.strip("/").replace("/", "_") + ".json") if cache else None
    if target and target.exists():
        return json.loads(target.read_text())
    request = urllib.request.Request(f"{API}{path}", headers={
        "User-Agent": "close-knit-routing/1.0 (+https://getcloseknit.com)", "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.loads(response.read())
    if target:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(payload))
    time.sleep(1.5)  # anonymous Unified API: stay well under the rate limit
    return payload


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    rad = math.pi / 180
    d_lat, d_lon = (b[0] - a[0]) * rad, (b[1] - a[1]) * rad
    h = math.sin(d_lat / 2) ** 2 + math.cos(a[0] * rad) * math.cos(b[0] * rad) * math.sin(d_lon / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def build(cache: Path | None) -> dict[str, list[list]]:
    stops: dict[str, tuple[str, float, float]] = {}
    routes, trips, stop_times, frequencies = [], [], [], []
    for line in LINES:
        speed = SPEED_KMH.get(line, DEFAULT_SPEED_KMH)
        headway = HEADWAY_MIN.get(line, DEFAULT_HEADWAY_MIN)
        line_name = None
        for direction in ("outbound", "inbound"):
            sequence = fetch(f"/Line/{line}/Route/Sequence/{direction}", cache)
            line_name = sequence.get("lineName", line)
            for group in sequence.get("stopPointSequences", []):
                for point in group.get("stopPoint", []):
                    stops[point["id"]] = (point["name"], point["lat"], point["lon"])
            for index, pattern in enumerate(sequence.get("orderedLineRoutes", [])):
                naptans = [naptan for naptan in pattern["naptanIds"] if naptan in stops]
                if len(naptans) < 2:
                    continue
                trip_id = f"{line}-{direction}-{index}"
                trips.append([line, CALENDAR[0], trip_id, pattern["name"].replace("&harr;", "-").strip(), 0 if direction == "outbound" else 1])
                clock = 0.0
                for order, naptan in enumerate(naptans):
                    if order:
                        previous = stops[naptans[order - 1]]
                        here = stops[naptan]
                        clock += haversine_km((previous[1], previous[2]), (here[1], here[2])) * 1.1 / speed * 60 + STOP_ALLOWANCE_MIN
                    stamp = _clock(clock)
                    stop_times.append([trip_id, stamp, stamp, naptan, order + 1])
                frequencies.append([trip_id, SERVICE_START, SERVICE_END, headway * 60, 0])
        routes.append([line, "TfL-rail-approx", line_name or line, f"{line_name or line} (frequency approximation)", 2])
    return {
        "agency.txt": [["agency_id", "agency_name", "agency_url", "agency_timezone"],
                       ["TfL-rail-approx", "TfL rail lines (frequency approximation, Powered by TfL Open Data)", "https://tfl.gov.uk", "Europe/London"]],
        "stops.txt": [["stop_id", "stop_name", "stop_lat", "stop_lon"]] + [[sid, name, lat, lon] for sid, (name, lat, lon) in sorted(stops.items())],
        "routes.txt": [["route_id", "agency_id", "route_short_name", "route_long_name", "route_type"]] + routes,
        "trips.txt": [["route_id", "service_id", "trip_id", "trip_headsign", "direction_id"]] + trips,
        "stop_times.txt": [["trip_id", "arrival_time", "departure_time", "stop_id", "stop_sequence"]] + stop_times,
        "frequencies.txt": [["trip_id", "start_time", "end_time", "headway_secs", "exact_times"]] + frequencies,
        "calendar.txt": [["service_id", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "start_date", "end_date"], list(CALENDAR)],
    }


def _clock(minutes: float) -> str:
    seconds = round(minutes * 60)
    return f"{seconds // 3600:02d}:{seconds % 3600 // 60:02d}:{seconds % 60:02d}"


def write_zip(tables: dict[str, list[list]], out: Path) -> None:
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, rows in tables.items():
            buffer = io.StringIO()
            csv.writer(buffer).writerows(rows)
            archive.writestr(name, buffer.getvalue())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("out", type=Path)
    parser.add_argument("--cache", type=Path, default=None)
    args = parser.parse_args()
    tables = build(args.cache)
    write_zip(tables, args.out)
    print(f"{args.out}: {len(tables['routes.txt']) - 1} lines, {len(tables['trips.txt']) - 1} patterns, "
          f"{len(tables['stops.txt']) - 1} stops")


if __name__ == "__main__":
    main()
