"""Observed cycling speed from Santander Cycles journeys (TfL open data, "Powered by TfL Open Data").

Weekday trips starting 07:00-10:00 on classic (non-electric) bikes between two different docks,
2-60 minutes long. For every dock pair with at least MIN_TRIPS trips we take the 25th percentile
and median duration (the faster riders went fairly directly; slower ones may have stopped) and the
cycling route distance between the docks from an OSRM bicycle server. The report gives the speed
riders actually achieved, which sets R5's cycling speed instead of an assumed one.

    python3 deploy/routing/cycle_observed.py HIRE_DIR OSRM_BIKE_URL OUT.json
"""
from __future__ import annotations

import csv
import json
import statistics
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime
from pathlib import Path

MIN_TRIPS = 5
DOCK_SECONDS = 60  # taking a bike out and docking it, inside the recorded duration


def trips(directory: Path) -> dict[tuple[str, str], list[float]]:
    pairs: dict[tuple[str, str], list[float]] = defaultdict(list)
    for path in sorted(directory.glob("*JourneyDataExtract*.csv")):
        for row in csv.DictReader(open(path, newline="", encoding="utf-8-sig")):
            if row.get("Bike model", "CLASSIC").upper() != "CLASSIC":
                continue
            start = datetime.strptime(row["Start date"], "%Y-%m-%d %H:%M")
            if start.weekday() >= 5 or not 7 <= start.hour < 10:
                continue
            a, b = row["Start station"].strip().lower(), row["End station"].strip().lower()
            seconds = float(row["Total duration (ms)"]) / 1000
            if a != b and 120 <= seconds <= 3600:
                pairs[(a, b)].append(seconds)
    return pairs


def distances(osrm: str, points: list[tuple[float, float]], sources: list[int], targets: list[int]) -> list[list[float | None]]:
    coords = ";".join(f"{lon},{lat}" for lat, lon in points)
    url = (f"{osrm}/table/v1/bike/{coords}?annotations=distance,duration"
           f"&sources={';'.join(map(str, sources))}&destinations={';'.join(map(str, targets))}")
    with urllib.request.urlopen(url, timeout=300) as response:
        payload = json.loads(response.read())
    return payload["distances"], payload["durations"]


def main(directory: Path, osrm: str, out: Path) -> None:
    docks = {point["commonName"].strip().lower(): (point["lat"], point["lon"])
             for point in json.load(open(directory / "bikepoints.json"))}
    pairs = {key: value for key, value in trips(directory).items()
             if len(value) >= MIN_TRIPS and key[0] in docks and key[1] in docks}
    names = sorted({name for pair in pairs for name in pair})
    index = {name: i for i, name in enumerate(names)}
    points = [docks[name] for name in names]
    by_origin = defaultdict(list)
    for a, b in pairs:
        by_origin[a].append(b)
    rows = []
    origins = sorted(by_origin)
    for start in range(0, len(origins), 50):
        batch = origins[start:start + 50]
        targets = sorted({b for a in batch for b in by_origin[a]})
        dist, dur = distances(osrm, points, [index[a] for a in batch], [index[b] for b in targets])
        for i, a in enumerate(batch):
            for b in by_origin[a]:
                j = targets.index(b)
                metres, osrm_seconds = dist[i][j], dur[i][j]
                if not metres:
                    continue
                times = sorted(pairs[(a, b)])
                p25, p50 = times[len(times) // 4], statistics.median(times)
                rows.append({"from": a, "to": b, "trips": len(times), "km": metres / 1000,
                             "p25_min": p25 / 60, "p50_min": p50 / 60, "osrm_min": osrm_seconds / 60,
                             "kmh_p25": metres / 1000 / ((p25 - DOCK_SECONDS) / 3600),
                             "kmh_p50": metres / 1000 / ((p50 - DOCK_SECONDS) / 3600)})
    longer = [row for row in rows if row["km"] >= 2]  # short hops are dominated by docking and lights
    weights = [row["trips"] for row in longer]

    def weighted_median(key: str) -> float:
        ordered = sorted(zip((row[key] for row in longer), weights))
        half, total = sum(weights) / 2, 0
        for value, weight in ordered:
            total += weight
            if total >= half:
                return round(value, 1)
        return float("nan")

    report = {
        "trips": sum(len(times) for times in pairs.values()), "pairs": len(rows), "pairs_2km_plus": len(longer),
        "speed_kmh_p25_riders": weighted_median("kmh_p25"), "speed_kmh_median_riders": weighted_median("kmh_p50"),
        "osrm_vs_observed_p25": round(statistics.median(row["osrm_min"] / row["p25_min"] for row in longer), 2),
        "osrm_vs_observed_median": round(statistics.median(row["osrm_min"] / row["p50_min"] for row in longer), 2),
        "rule": f"weekday 07-10 starts, classic bikes, {MIN_TRIPS}+ trips per dock pair, pairs >= 2 km, "
                f"{DOCK_SECONDS}s docking removed, speeds weighted by trips",
    }
    out.write_text(json.dumps(report, indent=2))
    with open(out.with_suffix(".csv"), "w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main(Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3]))
