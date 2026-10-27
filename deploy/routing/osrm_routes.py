"""Street routes for the map: OSRM bicycle and car paths from every MSOA centre to each commute hub.

The commute matrix gives minutes per LSOA; this gives the line to draw for the selected area's
neighbourhood (simplified, coordinates rounded to ~1 m), loaded into commute_route by
deploy/tools/etl_commute.py routes.

    python3 deploy/routing/osrm_routes.py ORIGINS.csv HUBS.csv BIKE_URL CAR_URL OUT.csv
"""
from __future__ import annotations

import csv
import json
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor


def route(url: str, profile: str, start: tuple[float, float], end: tuple[float, float]) -> dict | None:
    request = (f"{url}/route/v1/{profile}/{start[1]:.6f},{start[0]:.6f};{end[1]:.6f},{end[0]:.6f}"
               "?overview=simplified&geometries=geojson")
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.loads(response.read())
    except urllib.error.HTTPError as error:  # OSRM answers NoRoute / NoSegment with 400
        payload = json.loads(error.read() or b"{}")
    if payload.get("code") != "Ok" or not payload.get("routes"):
        return None
    best = payload["routes"][0]
    coordinates = [[round(lon, 5), round(lat, 5)] for lon, lat in best["geometry"]["coordinates"]]
    return {"minutes": round(best["duration"] / 60, 1), "km": round(best["distance"] / 1000, 2), "coordinates": coordinates}


def main(origins_path: str, hubs_path: str, bike: str, car: str, out: str) -> None:
    origins = [(row["id"], float(row["lat"]), float(row["lon"])) for row in csv.DictReader(open(origins_path))]
    hubs = [(row["hub_id"], float(row["latitude"]), float(row["longitude"])) for row in csv.DictReader(open(hubs_path))]
    jobs = [(mode, url, profile, origin, hub) for mode, url, profile in (("cycle", bike, "bike"), ("car", car, "car"))
            for origin in origins for hub in hubs]

    def run(job):
        mode, url, profile, (area, lat, lon), (hub, hub_lat, hub_lon) = job
        return mode, area, hub, route(url, profile, (lat, lon), (hub_lat, hub_lon))

    with open(out, "w", newline="") as handle, ThreadPoolExecutor(8) as pool:
        writer = csv.writer(handle)
        writer.writerow(["origin_geography_id", "hub_id", "mode", "minutes", "km", "coordinates"])
        written = 0
        for mode, area, hub, found in pool.map(run, jobs):
            if found:
                writer.writerow([area, hub, mode, found["minutes"], found["km"], json.dumps(found["coordinates"], separators=(",", ":"))])
                written += 1
    print(f"wrote {written} of {len(jobs)} routes to {out}")


if __name__ == "__main__":
    main(*sys.argv[1:6])
