"""Make a converted TfL GTFS loadable by R5: every stop needs coordinates.

transx2gtfs places stops from NaPTAN; a few new stops (e.g. a just-opened pier) are not there yet.
Coordinates are filled from TfL Unified API stop points saved under $AE_DATA/tfl when present;
otherwise the stop, its stop times and any trip left with fewer than two stops are dropped and
listed, so the routing release can state what is missing.

    python3 deploy/routing/gtfs_clean.py IN.zip OUT.zip [--stoppoints DIR]
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import zipfile
from collections import Counter
from pathlib import Path


def stoppoint_coordinates(directory: Path | None) -> dict[str, tuple[float, float]]:
    found: dict[str, tuple[float, float]] = {}
    if not directory or not directory.exists():
        return found
    for path in directory.glob("stoppoints-*.json"):
        payload = json.loads(path.read_text())
        points = payload.get("stopPoints", payload) if isinstance(payload, dict) else payload
        stack = list(points if isinstance(points, list) else [])
        while stack:
            point = stack.pop()
            if not isinstance(point, dict):
                continue
            if point.get("lat") and point.get("lon"):
                for key in ("naptanId", "id", "stationNaptan"):
                    if point.get(key):
                        found.setdefault(point[key], (point["lat"], point["lon"]))
            stack.extend(point.get("children", []))
    return found


def clean(source: Path, target: Path, coordinates: dict[str, tuple[float, float]]) -> dict:
    with zipfile.ZipFile(source) as archive:
        tables = {name: list(csv.reader(io.StringIO(archive.read(name).decode("utf-8-sig")))) for name in archive.namelist()}
    header, *stops = tables["stops.txt"]
    sid, lat, lon = header.index("stop_id"), header.index("stop_lat"), header.index("stop_lon")
    filled, dropped, kept = [], [], [header]
    for row in stops:
        if row[lat] and row[lon]:
            kept.append(row)
        elif row[sid] in coordinates:
            row[lat], row[lon] = (str(value) for value in coordinates[row[sid]])
            filled.append(row[sid])
            kept.append(row)
        else:
            dropped.append(row[sid])
    tables["stops.txt"] = kept
    gone = set(dropped)
    times_header, *times = tables["stop_times.txt"]
    t_trip, t_stop = times_header.index("trip_id"), times_header.index("stop_id")
    times = [row for row in times if row[t_stop] not in gone]
    per_trip = Counter(row[t_trip] for row in times)
    short = {trip for trip, count in per_trip.items() if count < 2}
    tables["stop_times.txt"] = [times_header] + [row for row in times if row[t_trip] not in short]
    trips_header, *trips = tables["trips.txt"]
    trip_col = trips_header.index("trip_id")
    alive = {row[t_trip] for row in tables["stop_times.txt"][1:]}
    tables["trips.txt"] = [trips_header] + [row for row in trips if row[trip_col] in alive]
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, rows in tables.items():
            buffer = io.StringIO()
            csv.writer(buffer).writerows(rows)
            archive.writestr(name, buffer.getvalue())
    return {"filled": filled, "dropped": dropped, "trips_dropped": len(trips) - (len(tables["trips.txt"]) - 1)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    parser.add_argument("--stoppoints", type=Path, default=None)
    args = parser.parse_args()
    report = clean(args.source, args.target, stoppoint_coordinates(args.stoppoints))
    print(json.dumps({"source": args.source.name, **report}))


if __name__ == "__main__":
    main()
