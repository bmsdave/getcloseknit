"""Commute times from every London LSOA to the commute hubs, as a routing release.

Inputs are built on the ETL machine (deploy/routing/README.md):
  - TfL Journey Planner timetables (TransXChange, Underground, DLR, trams, river, buses) converted
    to GTFS with transx2gtfs, plus the Overground and Elizabeth line frequency approximation
    (deploy/routing/tfl_rail_frequencies.py) — TfL open data terms, "Powered by TfL Open Data";
  - the Geofabrik Greater London OpenStreetMap extract (ODbL);
  - the R5 job (deploy/routing/r5/commute_r5.py) writing matrix.csv:
      geography_id, hub_id, travel_time_p10, travel_time_p50, travel_time_p90, mode.

  python3 etl_commute.py load <database-url> <matrix.csv> [<itineraries.csv>]
  python3 etl_commute.py routes <database-url> <osrm-routes.csv>   (street lines for the active network)
  python3 etl_commute.py itineraries <database-url> <otp-itineraries.csv>   (transit routes, ditto)

Loads route_network_release, commute_hub, travel_time_matrix (and commute_itinerary when given)
as new source releases, then stages and activates a product release. Validation gates first:
every LSOA and hub present, minutes in range, and the transit median to King's Cross from a
handful of known areas inside sane bounds.
"""
from __future__ import annotations

import csv
import hashlib
import json
import math
import os
import sys
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

DATA = Path(os.environ.get("AE_DATA", Path.home() / "data"))
WORK = Path(os.environ.get("AE_WORK", DATA / "aework" / "commute"))
REPO = Path(__file__).resolve().parents[2]
TXC_ZIP = DATA / "tfl" / "timetables" / "journey-planner-timetables.zip"
TXC_URL = "https://tfl.gov.uk/tfl/syndication/feeds/journey-planner-timetables.zip"
RAIL_APPROX = WORK / "gtfs" / "tfl-rail-approx.zip"
PBF = DATA / "osm" / "greater-london-latest.osm.pbf"
PBF_URL = "https://download.geofabrik.de/europe/united-kingdom/england/greater-london-latest.osm.pbf"
HUBS = REPO / "deploy" / "routing" / "hubs.csv"
DFT_SPEEDS = DATA / "dft" / "congestion" / "cgn0503.ods"
DFT_URL = "https://www.gov.uk/government/statistical-data-sets/average-speed-delay-and-reliability-of-travel-times-cgn"
CYCLE_HIRE = DATA / "tfl" / "cycle-hire"
CYCLE_HIRE_URL = "https://cycling.data.tfl.gov.uk/"
ETL_VERSION = "commute-1"
R5_VERSION = "r5py-1.1.7"
SERVICE_DATE = date(2026, 10, 13)
ARRIVAL_BAND = "weekday-depart-0800-0900"
MODES = ("transit", "walk", "cycle", "car")
TIMETABLE_DATE = "2026-10-05"
# Sanity gate: weekday transit median to King's Cross must fall in these bounds (minutes).
KINGS_CROSS_BOUNDS = {"uk:lsoa:E01000001": (5, 30), "uk:lsoa:E01004447": (15, 50)}


def sha256(path: Path) -> str:
    with open(path, "rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def read_matrix(path: Path) -> list[dict]:
    rows = []
    with open(path, newline="") as handle:
        for row in csv.DictReader(handle):
            rows.append({key: _number(value) if key.startswith("travel_time") else value for key, value in row.items()})
    return rows


def _number(value: str) -> float | None:
    if value in ("", "nan", "NaN", None):
        return None
    number = float(value)
    return None if math.isnan(number) else number


def read_hubs(path: Path = HUBS) -> list[dict]:
    with open(path, newline="") as handle:
        return [{**row, "latitude": float(row["latitude"]), "longitude": float(row["longitude"])} for row in csv.DictReader(handle)]


def validate(rows: list[dict], lsoas: set[str], hubs: list[dict]) -> dict:
    """Blocking checks before anything is written; returns a summary for the release record."""
    hub_ids = {hub["hub_id"] for hub in hubs}
    seen = defaultdict(set)
    for row in rows:
        if row["mode"] not in MODES:
            raise ValueError(f"unknown mode {row['mode']}")
        if row["hub_id"] not in hub_ids:
            raise ValueError(f"unknown hub {row['hub_id']}")
        median = row["travel_time_p50"]
        if median is not None and not 0 <= median <= 180:
            raise ValueError(f"minutes out of range: {row}")
        seen[row["mode"]].add((row["geography_id"], row["hub_id"]))
    expected = len(lsoas) * len(hub_ids)
    for mode in MODES:
        if len(seen[mode]) != expected:
            raise ValueError(f"{mode}: {len(seen[mode])} of {expected} LSOA-hub pairs")
    transit = {(row["geography_id"], row["hub_id"]): row["travel_time_p50"] for row in rows if row["mode"] == "transit"}
    for area, (low, high) in KINGS_CROSS_BOUNDS.items():
        value = transit.get((area, "kings-cross"))
        if area in lsoas and (value is None or not low <= value <= high):
            raise ValueError(f"sanity: {area} to King's Cross {value} min outside {low}-{high}")
    reachable = [value for value in transit.values() if value is not None]
    return {"pairs": expected, "transit_reachable_share": round(len(reachable) / max(1, len(transit)), 3),
            "transit_median_minutes": round(sorted(reachable)[len(reachable) // 2], 1) if reachable else None}


def matrix_rows(rows: list[dict], network_id: str) -> list[list]:
    return [[network_id, row["geography_id"], row["hub_id"], ARRIVAL_BAND, row["mode"],
             _minutes(row["travel_time_p50"]), _minutes(row["travel_time_p10"]), _minutes(row["travel_time_p90"]),
             None, None, row["travel_time_p50"] is None] for row in rows]


def _minutes(value: float | None) -> int | None:
    return None if value is None else round(value)


def load(url: str, matrix_path: Path, itineraries_path: Path | None = None) -> None:
    import psycopg
    from psycopg.rows import dict_row

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import stage_release
    from etl_station_access import copy_rows

    rows = read_matrix(matrix_path)
    hubs = read_hubs()
    with psycopg.connect(url, row_factory=dict_row) as conn, conn.cursor() as cur:
        lsoas = {row["id"] for row in cur.execute("SELECT id FROM area_geography WHERE kind = 'lsoa'")}
        summary = validate(rows, lsoas, hubs)
        print(json.dumps(summary), flush=True)
        # One network per matrix build, so reloading never rewrites a release an older product release names.
        network_id = f"net-{TIMETABLE_DATE}-{R5_VERSION}-{sha256(matrix_path)[:8]}"
        if cur.execute("SELECT 1 FROM route_network_release WHERE id = %s", (network_id,)).fetchone():
            raise SystemExit(f"{network_id} is already loaded")
        timetable_id = _new_id(cur, f"src-tfl-timetables-{TIMETABLE_DATE}")
        osm_id = _new_id(cur, "src-osm-routing-network-2026-09")
        cur.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
                 attribution, transformation_version, geography_vintage, validation_status, caveats)
               VALUES (%s, %s, now(), %s, %s, 'TfL open data terms', %s, %s, '2021', 'passed', %s)""",
            (timetable_id, TXC_URL, TIMETABLE_DATE, sha256(TXC_ZIP),
             "Powered by TfL Open Data. Contains OS data © Crown copyright and database rights.",
             ETL_VERSION,
             ["Underground, DLR, trams, river and buses from TfL's Journey Planner timetables (TransXChange).",
              "Overground and Elizabeth line are a frequency approximation from TfL's published stop "
              f"sequences (sha256 {sha256(RAIL_APPROX)[:12]}), not their timetable; National Rail is not included yet.",
              "Weekday departures 08:00-09:00; minutes are the 10th/50th/90th percentile across that hour."]))
        cur.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
                 attribution, transformation_version, geography_vintage, validation_status, caveats)
               VALUES (%s, %s, now(), %s, %s, 'ODbL-1.0', %s, %s, '2021', 'passed', %s)""",
            (osm_id, PBF_URL, "2026-09-09", sha256(PBF),
             "© OpenStreetMap contributors (ODbL). Walking and cycling network for routing.", ETL_VERSION,
             ["Walking and cycling on mapped paths and streets; no traffic, lifts or crossings are timed."]))
        calibration = []
        if DFT_SPEEDS.exists():
            calibration.append(_new_id(cur, "src-dft-cgn0503-2025"))
            cur.execute(
                """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
                     attribution, transformation_version, geography_vintage, validation_status, caveats)
                   VALUES (%s, %s, now(), '2026-03-31', %s, 'OGL-3.0', %s, %s, '2021', 'passed', %s)""",
                (calibration[-1], DFT_URL, sha256(DFT_SPEEDS),
                 "Contains public sector information licensed under the Open Government Licence v3.0.", ETL_VERSION,
                 ["Average speed on local 'A' roads by borough (2025) scaled to the weekday morning peak; applied to "
                  "the first and last 5 km of a drive. Parking, the congestion charge and ULEZ are not included."]))
        hire = sorted(CYCLE_HIRE.glob("*JourneyDataExtract*.csv")) if CYCLE_HIRE.exists() else []
        if hire:
            calibration.append(_new_id(cur, "src-tfl-cycle-hire-2026-05"))
            digest = hashlib.sha256("".join(sha256(path) for path in hire).encode()).hexdigest()
            cur.execute(
                """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
                     attribution, transformation_version, geography_vintage, validation_status, caveats)
                   VALUES (%s, %s, now(), '2026-05-31', %s, 'TfL open data terms', %s, %s, '2021', 'passed', %s)""",
                (calibration[-1], CYCLE_HIRE_URL, digest, "Powered by TfL Open Data.", ETL_VERSION,
                 [f"Observed cycling speed from {len(hire)} Santander Cycles journey extracts (weekday mornings, "
                  "classic bikes); aggregate only, no trip is stored."]))
        cur.execute(
            """INSERT INTO route_network_release (id, osm_source_release_id, timetable_source_release_id,
                 service_date, r5_version, otp_version) VALUES (%s, %s, %s, %s, %s, %s)""",
            (network_id, osm_id, timetable_id, SERVICE_DATE, R5_VERSION, "not-used"))
        copy_rows(cur, "commute_hub", "id, name, station_id, location, network_release_id", [
            [hub["hub_id"], hub["name"], hub["station_id"],
             "SRID=4326;POINT({:.6f} {:.6f})".format(hub["longitude"], hub["latitude"]), network_id] for hub in hubs])
        copy_rows(cur, "travel_time_matrix",
                  "network_release_id, geography_id, destination_cell, arrival_band, mode, median_minutes,"
                  " p10_minutes, p90_minutes, transfers, walking_minutes, unreachable", matrix_rows(rows, network_id))
        if itineraries_path:
            from commute_itineraries import itinerary_rows
            copy_rows(cur, "commute_itinerary",
                      "network_release_id, origin_geography_id, hub_id, option, total_minutes, transfers,"
                      " walking_minutes, legs", itinerary_rows(itineraries_path, network_id, sorted((WORK / "gtfs").glob("*.zip"))))
        old = [row["source_release_id"] for row in cur.execute(
            """SELECT m.source_release_id FROM product_release_member m
               WHERE m.release_id = (SELECT release_id FROM active_product_release)
                 AND (m.source_release_id LIKE 'src-tfl-timetables-%%' OR m.source_release_id LIKE 'src-osm-routing-network-%%'
                      OR m.source_release_id LIKE 'src-dft-cgn0503-%%' OR m.source_release_id LIKE 'src-tfl-cycle-hire-%%')""")]
        stage_release.stage(cur, "commute", [timetable_id, osm_id, *calibration], replace=tuple(old))
        print(f"load: {network_id}: {len(rows)} matrix rows, {len(hubs)} hubs "
              f"(stamp {datetime.now(timezone.utc):%Y-%m-%dT%H:%MZ})")


def _active_network_load(url: str, table: str, columns: str, read_rows) -> None:
    """Replace one routing table's rows for the active routing release (lines drawn on the map)."""
    import psycopg
    from psycopg.rows import dict_row

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from etl_station_access import copy_rows

    with psycopg.connect(url, row_factory=dict_row) as conn, conn.cursor() as cur:
        network = cur.execute(
            """SELECT n.id FROM route_network_release n
               JOIN product_release_member m ON m.source_release_id = n.timetable_source_release_id
               WHERE m.release_id = (SELECT release_id FROM active_product_release)
               ORDER BY n.created_at DESC LIMIT 1""").fetchone()
        if not network:
            raise SystemExit("no active routing release")
        msoas = {row["id"] for row in cur.execute("SELECT id FROM area_geography WHERE kind = 'msoa'")}
        rows = read_rows(network["id"], msoas)
        cur.execute(f"DELETE FROM {table} WHERE network_release_id = %s", (network["id"],))
        copy_rows(cur, table, columns, rows)
        print(f"{table}: {len(rows)} rows for {network['id']}")


def load_routes(url: str, routes_path: Path) -> None:
    """Street routes (deploy/routing/osrm_routes.py): bike and car lines per MSOA x hub."""
    _active_network_load(url, "commute_route", "network_release_id, origin_geography_id, hub_id, mode, km, coordinates",
                         lambda network, msoas: [
                             [network, row["origin_geography_id"], row["hub_id"], row["mode"], float(row["km"]), row["coordinates"]]
                             for row in csv.DictReader(open(routes_path, newline="")) if row["origin_geography_id"] in msoas])


def distinct_itineraries(rows: list[dict]) -> list[dict]:
    """Per MSOA x hub, keep an option only when it rides different lines (the next train is not an
    alternative route); renumber 1, 2."""
    kept: dict[tuple, list[dict]] = defaultdict(list)
    for row in sorted(rows, key=lambda row: (row["origin_geography_id"], row["hub_id"], int(row["option"]))):
        key = (row["origin_geography_id"], row["hub_id"])
        lines = tuple(leg["line"] for leg in json.loads(row["legs"]) if leg["mode"] != "walk")
        if all(lines != existing["_lines"] for existing in kept[key]):
            kept[key].append({**row, "_lines": lines, "option": len(kept[key]) + 1})
    return [row for options in kept.values() for row in options]


def load_itineraries(url: str, itineraries_path: Path) -> None:
    """Transit routes (deploy/routing/otp_itineraries.py): up to two distinct itineraries per MSOA x hub."""
    _active_network_load(url, "commute_itinerary",
                         "network_release_id, origin_geography_id, hub_id, option, total_minutes, transfers, walking_minutes, legs",
                         lambda network, msoas: [
                             [network, row["origin_geography_id"], row["hub_id"], int(row["option"]), int(row["total_minutes"]),
                              int(row["transfers"]), int(row["walking_minutes"]), row["legs"]]
                             for row in distinct_itineraries(list(csv.DictReader(open(itineraries_path, newline=""))))
                             if row["origin_geography_id"] in msoas])


def _new_id(cur, base: str) -> str:
    taken = {row["id"] for row in cur.execute("SELECT id FROM source_release WHERE id LIKE %s", (base + "%",))}
    revision = 1
    while (base if revision == 1 else f"{base}-r{revision}") in taken:
        revision += 1
    return base if revision == 1 else f"{base}-r{revision}"


if __name__ == "__main__":
    if len(sys.argv) in (4, 5) and sys.argv[1] == "load":
        load(sys.argv[2], Path(sys.argv[3]), Path(sys.argv[4]) if len(sys.argv) == 5 else None)
    elif len(sys.argv) == 4 and sys.argv[1] == "routes":
        load_routes(sys.argv[2], Path(sys.argv[3]))
    elif len(sys.argv) == 4 and sys.argv[1] == "itineraries":
        load_itineraries(sys.argv[2], Path(sys.argv[3]))
    else:
        print(__doc__)
        sys.exit(2)
