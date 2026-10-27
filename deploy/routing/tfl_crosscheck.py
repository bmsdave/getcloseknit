"""Check our R5 commute matrix against TfL's Journey Planner on a random sample of area-hub pairs.

TfL is the reference, not a source: answers are cached for this check only and never loaded.
For each sampled pair (same origin point and hub as R5, Tuesday 08:30 departure) we take TfL's
fastest journey and compare it with our median. A pair agrees when |ours - TfL| <= max(5 min, 20%).
The report also splits transit by whether TfL's route used National Rail, which our network lacks.

    python3 deploy/routing/tfl_crosscheck.py MATRIX.csv ORIGINS.csv HUBS.csv OUT_DIR [--transit 200 --cycle 100]
"""
from __future__ import annotations

import argparse
import csv
import json
import random
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://api.tfl.gov.uk/Journey/JourneyResults"
DATE, TIME = "20261013", "0830"
TFL_MODES = {"transit": None, "cycle": "cycle"}
RAIL_MODES = {"national-rail"}


def tolerance(reference: float) -> float:
    return max(5.0, 0.2 * reference)


def fetch(origin: tuple[float, float], hub: tuple[float, float], mode: str, cache: Path) -> dict | None:
    key = f"{mode}-{origin[0]:.5f},{origin[1]:.5f}-{hub[0]:.5f},{hub[1]:.5f}.json"
    target = cache / key
    if target.exists():
        return json.loads(target.read_text())
    query = {"date": DATE, "time": TIME, "timeIs": "Departing"}
    if TFL_MODES[mode]:
        query["mode"] = TFL_MODES[mode]
    url = f"{API}/{origin[0]},{origin[1]}/to/{hub[0]},{hub[1]}?{urllib.parse.urlencode(query)}"
    request = urllib.request.Request(url, headers={"User-Agent": "close-knit-routing-check/1.0", "Accept": "application/json"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                payload = json.loads(response.read())
            break
        except urllib.error.HTTPError as error:
            if error.code in (429, 500, 502, 503) and attempt < 3:
                time.sleep(10 * (attempt + 1))
                continue
            payload = {"error": error.code}
            break
    time.sleep(1.2)  # anonymous Unified API: stay under the rate limit
    target.write_text(json.dumps(payload))
    return payload


def fastest(payload: dict | None) -> tuple[float, list[str]] | None:
    journeys = (payload or {}).get("journeys") or []
    if not journeys:
        return None
    best = min(journeys, key=lambda journey: journey["duration"])
    return best["duration"], [leg["mode"]["id"] for leg in best["legs"]]


def run(matrix: Path, origins: Path, hubs: Path, out: Path, sizes: dict[str, int], seed: int = 20261013) -> dict:
    points = {row["id"]: (float(row["lat"]), float(row["lon"])) for row in csv.DictReader(open(origins))}
    hub_points = {row["hub_id"]: (float(row["latitude"]), float(row["longitude"])) for row in csv.DictReader(open(hubs))}
    ours = {(row["geography_id"], row["hub_id"], row["mode"]): float(row["travel_time_p50"])
            for row in csv.DictReader(open(matrix)) if row["travel_time_p50"]}
    cache = out / "tfl-cache"
    cache.mkdir(parents=True, exist_ok=True)
    rng = random.Random(seed)
    rows = []
    for mode, size in sizes.items():
        pairs = sorted(key for key in ours if key[2] == mode)
        for area, hub, _ in rng.sample(pairs, min(size, len(pairs))):
            answer = fastest(fetch(points[area], hub_points[hub], mode, cache))
            if answer is None:
                rows.append({"mode": mode, "area": area, "hub": hub, "ours": ours[(area, hub, mode)], "tfl": None})
                continue
            tfl, legs = answer
            rows.append({"mode": mode, "area": area, "hub": hub, "ours": ours[(area, hub, mode)], "tfl": tfl,
                         "diff": ours[(area, hub, mode)] - tfl, "agrees": abs(ours[(area, hub, mode)] - tfl) <= tolerance(tfl),
                         "national_rail": bool(RAIL_MODES & set(legs)), "legs": "+".join(legs)})
    with open(out / "crosscheck.csv", "w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["mode", "area", "hub", "ours", "tfl", "diff", "agrees", "national_rail", "legs"])
        writer.writeheader()
        writer.writerows(rows)
    report = {"date": DATE, "time": TIME, "rule": "agree when |ours - TfL| <= max(5 min, 20%)"}
    for mode in sizes:
        report[mode] = summary([row for row in rows if row["mode"] == mode])
        if mode == "transit":
            report["transit-with-national-rail"] = summary([row for row in rows if row["mode"] == mode and row.get("national_rail")])
            report["transit-tfl-only"] = summary([row for row in rows if row["mode"] == mode and row.get("tfl") and not row.get("national_rail")])
    (out / "crosscheck.json").write_text(json.dumps(report, indent=2))
    return report


def summary(rows: list[dict]) -> dict:
    compared = [row for row in rows if row.get("tfl") is not None]
    if not compared:
        return {"pairs": len(rows), "compared": 0}
    diffs = [row["diff"] for row in compared]
    worst = sorted(compared, key=lambda row: -abs(row["diff"]))[:5]
    return {"pairs": len(rows), "compared": len(compared),
            "agree_share": round(sum(row["agrees"] for row in compared) / len(compared), 3),
            "median_diff": statistics.median(diffs), "mean_diff": round(statistics.mean(diffs), 1),
            "within_5_min": round(sum(abs(d) <= 5 for d in diffs) / len(diffs), 3),
            "worst": [{key: row[key] for key in ("area", "hub", "ours", "tfl", "legs")} for row in worst]}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    for name in ("matrix", "origins", "hubs", "out"):
        parser.add_argument(name, type=Path)
    parser.add_argument("--transit", type=int, default=200)
    parser.add_argument("--cycle", type=int, default=100)
    args = parser.parse_args()
    print(json.dumps(run(args.matrix, args.origins, args.hubs, args.out, {"transit": args.transit, "cycle": args.cycle}), indent=2))


if __name__ == "__main__":
    main()
