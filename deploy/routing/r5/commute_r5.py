"""Offline commute job: travel times from every London LSOA to the commute hubs (R5 via r5py).

Runs in the close-knit-r5 image on the ETL machine; deploy/tools/etl_commute.py loads the
output into travel_time_matrix. Transit is a typical weekday morning: departures spread over an
hour from DEPARTURE, reported as the 10th/50th/90th percentile of door-to-door minutes; walking
and cycling are on the OpenStreetMap network.

    docker run --rm -v WORK:/work -v OSM:/osm:ro -v ROUTING:/app:ro close-knit-r5:1.1.7 \\
        matrix --osm /osm/greater-london-latest.osm.pbf --gtfs gtfs/a.zip gtfs/b.zip \\
        --origins origins-lsoa.csv --hubs hubs.csv --out matrix.csv  # → matrix-<mode>.csv
"""
from __future__ import annotations

import argparse
import datetime
import os
import sys

import geopandas
import pandas
import shapely

DEPARTURE = datetime.datetime(2026, 10, 13, 8, 0)  # a Tuesday inside every feed's calendar
WINDOW = datetime.timedelta(minutes=60)
MAX_MINUTES = 120
PERCENTILES = [10, 50, 90]
# Observed: weekday-morning Santander Cycles rides (classic bikes, dock pairs >= 2 km) average
# 16.2 km/h on the street route (deploy/routing/cycle_observed.py); r5py defaults to 12.
CYCLING_KMH = 16.0


def points(path: str, id_column: str) -> geopandas.GeoDataFrame:
    frame = pandas.read_csv(path)
    return geopandas.GeoDataFrame(
        {"id": frame[id_column]},
        geometry=[shapely.Point(lon, lat) for lat, lon in zip(frame["lat" if "lat" in frame else "latitude"],
                                                              frame["lon" if "lon" in frame else "longitude"])],
        crs="EPSG:4326")


def matrix(args: argparse.Namespace) -> None:
    """One file per mode, written as soon as that mode is done: walking and cycling need no timetable,
    so they run on the street network alone (`--gtfs` omitted), which keeps memory far lower."""
    import r5py

    network = r5py.TransportNetwork(args.osm, args.gtfs or [])
    origins = points(args.origins, "id")
    hubs = points(args.hubs, "hub_id")
    modes = {
        "transit": [r5py.TransportMode.TRANSIT, r5py.TransportMode.WALK],
        "walk": [r5py.TransportMode.WALK],
        "cycle": [r5py.TransportMode.BICYCLE],
        "car": [r5py.TransportMode.CAR],  # free-flow on OSM speed limits: a cross-check for OSRM, not a result
    }
    for mode, transport in modes.items():
        if mode not in args.modes:
            continue
        print(f"{mode}: {len(origins)} origins x {len(hubs)} hubs", flush=True)
        result = r5py.TravelTimeMatrix(
            network, origins=origins, destinations=hubs, departure=DEPARTURE,
            departure_time_window=WINDOW if mode == "transit" else datetime.timedelta(minutes=5),
            percentiles=PERCENTILES, transport_modes=transport, max_time=datetime.timedelta(minutes=MAX_MINUTES),
            speed_cycling=CYCLING_KMH, max_bicycle_traffic_stress=args.cycle_lts)
        result = pandas.DataFrame(result).rename(columns={"from_id": "geography_id", "to_id": "hub_id"})
        result["mode"] = mode
        out = args.out.replace(".csv", f"-{mode}.csv")
        result.to_csv(out, index=False)
        print(f"wrote {len(result)} rows to {out}", flush=True)


def itineraries(args: argparse.Namespace) -> None:
    """Typical transit itineraries (legs with route, stops, minutes and shape) from MSOA centres to
    the hubs, one file per hub so a long run can resume: hubs already written are skipped."""
    import r5py

    network = r5py.TransportNetwork(args.osm, args.gtfs)
    origins = points(args.origins, "id")
    hubs = points(args.hubs, "hub_id")
    for index in range(len(hubs)):
        hub = hubs.iloc[[index]]
        out = args.out.replace(".csv", f"-{hub['id'].iloc[0]}.csv")
        if os.path.exists(out):
            continue
        print(f"itineraries: {len(origins)} origins -> {hub['id'].iloc[0]}", flush=True)
        # One departure (not a window) and at most three rides: the typical route to draw, not every option.
        result = r5py.DetailedItineraries(
            network, origins=origins, destinations=hub, departure=DEPARTURE + datetime.timedelta(minutes=30),
            max_public_transport_rides=3,
            transport_modes=[r5py.TransportMode.TRANSIT, r5py.TransportMode.WALK], force_all_to_all=True,
            max_time=datetime.timedelta(minutes=MAX_MINUTES))
        frame = pandas.DataFrame(result)
        frame["geometry"] = [geometry.simplify(0.0001).wkt if geometry is not None else None for geometry in frame["geometry"]]
        frame.to_csv(out + ".part", index=False)
        os.replace(out + ".part", out)
        print(f"wrote {len(frame)} legs to {out}", flush=True)


def main(argv: list[str]) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("command", choices=["matrix", "itineraries"])
    parser.add_argument("--osm", required=True)
    parser.add_argument("--gtfs", nargs="*", default=[])
    parser.add_argument("--cycle-lts", type=int, default=4, choices=[1, 2, 3, 4],
                        help="highest level of traffic stress a cyclist accepts (r5py default 3 avoids main roads)")
    parser.add_argument("--modes", nargs="+", default=["transit", "walk", "cycle"], choices=["transit", "walk", "cycle", "car"])
    parser.add_argument("--origins", required=True)
    parser.add_argument("--hubs", required=True)
    parser.add_argument("--out", required=True)
    args, rest = parser.parse_known_args(argv)
    sys.argv = [sys.argv[0], *rest]  # r5py reads its own options (e.g. --max-memory) from argv
    {"matrix": matrix, "itineraries": itineraries}[args.command](args)


if __name__ == "__main__":
    main(sys.argv[1:])
