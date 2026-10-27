"""Typical transit routes from MSOA centres to the commute hubs, for the commute_itinerary table.

Reads the CSV written by `commute_r5.py itineraries` (r5py DetailedItineraries: one row per leg
with from_id, to_id, option, segment, transport_mode, travel_time, wait_time, route_id,
start_stop_id, end_stop_id) and names lines and stops from the GTFS feeds the network was built
with. Keeps the fastest MAX_OPTIONS options per origin and hub.
"""
from __future__ import annotations

import csv
import io
import json
import re
import zipfile
from collections import defaultdict
from pathlib import Path

MAX_OPTIONS = 2
WALK_MODES = {"WALK"}
_DURATION = re.compile(r"(?:(\d+) days? )?(\d+):(\d+):(\d+(?:\.\d+)?)")


def minutes(value: str) -> float:
    """'0 days 00:05:30' (pandas timedelta) or plain seconds → minutes."""
    if not value:
        return 0.0
    match = _DURATION.fullmatch(value.strip())
    if match:
        days, hours, mins, secs = match.groups()
        return int(days or 0) * 1440 + int(hours) * 60 + int(mins) + float(secs) / 60
    return float(value) / 60


def gtfs_names(paths: list[Path]) -> tuple[dict[str, str], dict[str, str]]:
    """Route id → line name and stop id → stop name across the feeds."""
    routes, stops = {}, {}
    for path in paths:
        with zipfile.ZipFile(path) as archive:
            for row in csv.DictReader(io.StringIO(archive.read("routes.txt").decode("utf-8-sig"))):
                routes[row["route_id"]] = row.get("route_short_name") or row.get("route_long_name") or row["route_id"]
            for row in csv.DictReader(io.StringIO(archive.read("stops.txt").decode("utf-8-sig"))):
                stops[row["stop_id"]] = row.get("stop_name") or row["stop_id"]
    return routes, stops


def itinerary_rows(path: Path, network_id: str, gtfs: list[Path] = ()) -> list[list]:
    routes, stops = gtfs_names(list(gtfs))
    options: dict[tuple[str, str, str], list[dict]] = defaultdict(list)
    with open(path, newline="") as handle:
        for row in csv.DictReader(handle):
            options[(row["from_id"], row["to_id"], row["option"])].append(row)
    best: dict[tuple[str, str], list[tuple[float, list]]] = defaultdict(list)
    for (origin, hub, _), legs in options.items():
        legs.sort(key=lambda leg: int(float(leg.get("segment") or 0)))
        out, total, walking, transit = [], 0.0, 0.0, 0
        for leg in legs:
            mode = leg["transport_mode"].split(".")[-1].upper()
            travel, wait = minutes(leg.get("travel_time", "")), minutes(leg.get("wait_time", ""))
            total += travel + wait
            if mode in WALK_MODES:
                walking += travel
            else:
                transit += 1
            out.append({"mode": mode.lower(), "line": routes.get(leg.get("route_id") or "", leg.get("route_id") or None),
                        "from": stops.get(leg.get("start_stop_id") or "", leg.get("start_stop_id") or None),
                        "to": stops.get(leg.get("end_stop_id") or "", leg.get("end_stop_id") or None),
                        "minutes": round(travel), "waitMinutes": round(wait)})
        if transit == 0:
            continue  # walking all the way is the walk matrix's job, not an itinerary
        best[(origin, hub)].append((total, [network_id, origin, hub, 0, round(total), max(0, transit - 1), round(walking),
                                            json.dumps(out)]))
    rows = []
    for ranked in best.values():
        for option, (_, row) in enumerate(sorted(ranked, key=lambda item: item[0])[:MAX_OPTIONS], start=1):
            rows.append([*row[:3], option, *row[4:]])
    return rows
