"""Second routing engine: OSRM bicycle and car minutes and kilometres from every LSOA to the hubs.

OSRM (project-osrm v6, MLD) runs on the same Geofabrik OSM extract as R5, with its own bicycle and
car rules, so it is an independent view of the street network. Times are OSRM's own, uncalibrated:
calibration and traffic are applied when the release is built (deploy/tools/etl_commute.py).

    python3 deploy/routing/osrm_matrix.py ORIGINS.csv HUBS.csv BIKE_URL CAR_URL OUT.csv
"""
from __future__ import annotations

import csv
import json
import sys
import urllib.request

BATCH = 400


def table(url: str, profile: str, origins: list[tuple[str, float, float]], hubs: list[tuple[str, float, float]]):
    points = origins + hubs
    coords = ";".join(f"{lon:.6f},{lat:.6f}" for _, lat, lon in points)
    sources = ";".join(str(i) for i in range(len(origins)))
    targets = ";".join(str(len(origins) + j) for j in range(len(hubs)))
    request = f"{url}/table/v1/{profile}/{coords}?annotations=duration,distance&sources={sources}&destinations={targets}"
    with urllib.request.urlopen(request, timeout=600) as response:
        payload = json.loads(response.read())
    if payload.get("code") != "Ok":
        raise RuntimeError(payload)
    return payload["durations"], payload["distances"]


def main(origins_path: str, hubs_path: str, bike: str, car: str, out: str) -> None:
    origins = [(row["id"], float(row["lat"]), float(row["lon"])) for row in csv.DictReader(open(origins_path))]
    hubs = [(row["hub_id"], float(row["latitude"]), float(row["longitude"])) for row in csv.DictReader(open(hubs_path))]
    with open(out, "w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["geography_id", "hub_id", "mode", "minutes", "km"])
        for mode, url, profile in (("cycle", bike, "bike"), ("car", car, "car")):
            for start in range(0, len(origins), BATCH):
                batch = origins[start:start + BATCH]
                durations, distances = table(url, profile, batch, hubs)
                for i, (area, _, _) in enumerate(batch):
                    for j, (hub, _, _) in enumerate(hubs):
                        seconds, metres = durations[i][j], distances[i][j]
                        writer.writerow([area, hub, mode, "" if seconds is None else round(seconds / 60, 1),
                                         "" if metres is None else round(metres / 1000, 2)])
    print(f"wrote {out}")


if __name__ == "__main__":
    main(*sys.argv[1:6])
