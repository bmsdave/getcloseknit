"""Build the release matrix from independent views, and report how far they agree.

  transit, walk  R5 on TfL timetables (commute_r5.py), checked against TfL Journey Planner
  cycle          OSRM bicycle route time divided by its observed ratio to real weekday-morning
                 Santander Cycles rides (cycle_observed.py; matched TfL Journey Planner on 98% of a
                 sample it was not fitted to); the range spans it and R5 at the observed speed
  car            OSRM free-flow route, slowed to DfT's observed 2025 average speed on local 'A' roads
                 for the first and last 5 km in the start and hub boroughs (CGN0503d), scaled to
                 the weekday morning peak (CGN0503a); the range runs from free-flow to that time. Parking,
                 the congestion charge and ULEZ are not part of the time.

    python3 deploy/routing/combine_matrix.py WORK_DIR CGN0503.ods OUT.csv
WORK_DIR holds matrix-full.csv, matrix-bike16-cycle.csv, osrm-matrix.csv, lsoa-borough.csv,
hub-borough.csv, check/cycle-observed.json and optionally matrix-r5car-car.csv.
"""
from __future__ import annotations

import csv
import json
import statistics
import sys
from pathlib import Path

MPH_TO_KMH = 1.609344
END_KM = 5.0  # stretch at each end driven at the borough's local 'A' road speed


def agrees(a: float, b: float) -> bool:
    return abs(a - b) <= max(5.0, 0.2 * max(a, b))


def dft_speeds(ods: Path) -> tuple[dict[str, float], float]:
    """Borough code -> 2025 all-day mph on local 'A' roads, and the morning-peak / all-day ratio."""
    import pandas

    boroughs = pandas.read_excel(ods, engine="odf", sheet_name="CGN0503d", header=3)
    year = [column for column in boroughs.columns if str(column).startswith("2025")][0]
    speeds = {row["ONS area code"]: float(row[year]) for _, row in boroughs.iterrows()
              if str(row["ONS area code"]).startswith("E09") and str(row[year]).replace(".", "", 1).isdigit()}
    monthly = pandas.read_excel(ods, engine="odf", sheet_name="CGN0503a", header=3).dropna(subset=["Month"])
    last = monthly.iloc[-1]
    peak = [c for c in monthly.columns if str(c).startswith("Weekday morning peak (Rolling")][0]
    allday = [c for c in monthly.columns if str(c).startswith("All day (Rolling")][0]
    return speeds, float(last[peak]) / float(last[allday])


def morning_minutes(freeflow: float, km: float, start_mph: float | None, end_mph: float | None, am_factor: float) -> float:
    """The first and last END_KM (at most half the route each) at the borough's observed morning speed;
    the middle, typically trunk roads and motorways that local 'A' road statistics do not describe,
    at the route's own free-flow speed."""
    if not km or not freeflow:
        return freeflow
    end = min(END_KM, km / 2)
    minutes = (km - 2 * end) / (km / freeflow)
    for mph in (start_mph, end_mph):
        minutes += end / (mph * MPH_TO_KMH * am_factor) * 60 if mph else end / (km / freeflow)
    return minutes


def read(path: Path) -> list[dict]:
    return list(csv.DictReader(open(path, newline="")))


def number(value: str) -> float | None:
    return float(value) if value not in ("", None) else None


def main(work: Path, ods: Path, out: Path) -> None:
    rows: list[list] = []
    for row in read(work / "matrix-full.csv"):
        if row["mode"] in ("transit", "walk"):
            rows.append([row["geography_id"], row["hub_id"], row["travel_time_p10"], row["travel_time_p50"],
                         row["travel_time_p90"], row["mode"]])
    osrm = {(r["geography_id"], r["hub_id"], r["mode"]): (number(r["minutes"]), number(r["km"])) for r in read(work / "osrm-matrix.csv")}
    observed = json.loads((work / "check" / "cycle-observed.json").read_text())
    osrm_factor = observed["osrm_vs_observed_median"]
    report = {"cycle": {"osrm_calibration": osrm_factor, "observed_kmh": observed["speed_kmh_median_riders"]}}

    pairs, agreeing = 0, 0
    for row in read(work / "matrix-bike16-cycle.csv"):
        key = (row["geography_id"], row["hub_id"])
        r5 = number(row["travel_time_p50"])
        other = osrm.get((*key, "cycle"), (None, None))[0]
        other = other / osrm_factor if other is not None else None
        views = [value for value in (r5, other) if value is not None and value <= 120]
        if not views:
            rows.append([*key, "", "", "", "cycle"])
            continue
        if len(views) == 2:
            pairs += 1
            agreeing += agrees(*views)
        median = other if other is not None and other <= 120 else views[0]
        rows.append([*key, round(min(views), 1), round(median, 1), round(max(views), 1), "cycle"])
    report["cycle"].update({"pairs_both_engines": pairs, "engines_agree_share": round(agreeing / max(1, pairs), 3)})

    speeds, am_factor = dft_speeds(ods)
    borough = {r["geography_id"]: r["borough_code"] for r in read(work / "lsoa-borough.csv")}
    hub_borough = {r["hub_id"]: r["borough_code"] for r in read(work / "hub-borough.csv")}
    ratios = []
    for (area, hub, mode), (minutes, km) in osrm.items():
        if mode != "car":
            continue
        if minutes is None or km is None:
            rows.append([area, hub, "", "", "", "car"])
            continue
        typical = max(minutes, morning_minutes(minutes, km, speeds.get(borough.get(area)),
                                               speeds.get(hub_borough.get(hub)), am_factor))
        ratios.append(typical / minutes if minutes else 1)
        rows.append([area, hub, round(minutes, 1), round(typical, 1), round(typical, 1), "car"])
    report["car"] = {"am_peak_factor": round(am_factor, 3), "boroughs_with_speeds": len(speeds),
                     "typical_over_freeflow_median": round(statistics.median(ratios), 2)}
    r5car = work / "matrix-r5car-car.csv"
    if r5car.exists():
        both = [(number(r["travel_time_p50"]), osrm.get((r["geography_id"], r["hub_id"], "car"), (None,))[0]) for r in read(r5car)]
        both = [(a, b) for a, b in both if a is not None and b is not None]
        report["car"]["freeflow_engines_agree_share"] = round(sum(agrees(a, b) for a, b in both) / max(1, len(both)), 3)
        report["car"]["freeflow_r5_over_osrm_median"] = round(statistics.median(a / b for a, b in both if b), 2)

    with open(out, "w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["geography_id", "hub_id", "travel_time_p10", "travel_time_p50", "travel_time_p90", "mode"])
        writer.writerows(rows)
    (out.parent / (out.stem + "-report.json")).write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
