"""Road, rail and aircraft noise at every London dwelling (Defra strategic noise mapping, Round 4).

Defra publishes the 2022 maps as 10 m rasters (receptor height 4 m, levels
under 40 dB not mapped) through WCS. This script:
  download  fetches road and rail Lden for the London extent as 10 km GeoTIFF
            tiles into $AE_WORK (default ~/data/aework/noise)
  load      samples road, rail and (when present) aircraft rasters at every
            dwelling's OS Open UPRN point (`property.location`), loads
            `dwelling_noise` and rebuilds `area_noise` (migration 009) as a
            source release

Aircraft: the loader samples `air-lden-<east>-<north>.tif` tiles from $AE_WORK
when they exist (same 10 km tiles, 10 m grid, 2021 airport operations); when
they are absent the load is road and rail only and aircraft_lden stays NULL.
The air-inclusive reference build is `src-defra-noise-round4-2022-road-rail-air`
(built prod-side; see RELEASE-CHECKLIST 6p). download does not fetch aircraft
tiles: place them in $AE_WORK before load.

  AE_WORK=~/data/aework/noise python3 etl_noise.py download
  AE_WORK=~/data/aework/noise python3 etl_noise.py load <database-url>

Needs numpy and tifffile.
"""
from __future__ import annotations

import hashlib
import io
import os
import sys
import urllib.request

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
WORK = os.environ.get("AE_WORK", os.path.join(DATA, "aework", "noise"))
ETL_VERSION = "close-knit-noise-1"
NODATA = -96.0
CELL = 10  # metres
TILE = 10_000  # metres per downloaded tile
# Greater London in British National Grid, rounded out to whole tiles.
EXTENT = (500_000, 150_000, 570_000, 210_000)
SOURCES = {
    "road": ("https://environment.data.gov.uk/spatialdata/road-noise-all-metrics-england-round-4/wcs",
             "562c9d56-7c2d-4d42-83bb-578d6e97a517__Road_Noise_Lden_England_Round_4_All"),
    "rail": ("https://environment.data.gov.uk/spatialdata/noise-data/wcs",
             "3fb3c2d7-292c-4e0a-bd5b-d8e4e1fe2947__Rail_Noise_Lden_England_Round_4_All"),
}


def tile_path(source: str, east: int, north: int) -> str:
    return os.path.join(WORK, f"{source}-lden-{east}-{north}.tif")


def air_tiles_present() -> bool:
    """Whether the optional aircraft Lden tiles are all in $AE_WORK."""
    return all(os.path.exists(tile_path("air", east, north)) for east, north in tiles())


def tiles():
    x0, y0, x1, y1 = EXTENT
    for east in range(x0, x1, TILE):
        for north in range(y0, y1, TILE):
            yield east, north


def fetch_tile(source: str, east: int, north: int) -> None:
    service, coverage = SOURCES[source]
    path = tile_path(source, east, north)
    if os.path.exists(path):
        return
    url = (f"{service}?service=WCS&version=2.0.1&request=GetCoverage&coverageId={coverage}"
           f"&format=image/tiff&subset=E({east},{east + TILE})&subset=N({north},{north + TILE})")
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=600) as response:
                body = response.read()
            break
        except OSError:
            if attempt == 2:
                raise
    if not body.startswith((b"MM", b"II")):
        raise SystemExit(f"{source} {east},{north}: not a TIFF ({body[:120]!r})")
    with open(path + ".tmp", "wb") as handle:
        handle.write(body)
    os.replace(path + ".tmp", path)
    print(f"download: {source} {east},{north} {len(body) // 1024} KiB", flush=True)


def download() -> None:
    """The WCS answers one 10 km tile in about a minute; fetch six at a time."""
    from concurrent.futures import ThreadPoolExecutor

    os.makedirs(WORK, exist_ok=True)
    jobs = [(source, east, north) for source in SOURCES for east, north in tiles()]
    with ThreadPoolExecutor(max_workers=6) as pool:
        for future in [pool.submit(fetch_tile, *job) for job in jobs]:
            future.result()


class Raster:
    """Mosaic of downloaded tiles; row 0 of a tile is its northern edge."""

    def __init__(self, source: str):
        import numpy as np
        import tifffile

        self.tiles = {}
        for east, north in tiles():
            data = tifffile.imread(tile_path(source, east, north)).astype(np.float32)
            if data.shape != (TILE // CELL, TILE // CELL):
                raise SystemExit(f"{source} tile {east},{north} has shape {data.shape}")
            self.tiles[(east, north)] = data

    def sample(self, east: float, north: float) -> float | None:
        key = (int(east // TILE * TILE), int(north // TILE * TILE))
        data = self.tiles.get(key)
        if data is None:
            return None
        col = int((east - key[0]) // CELL)
        row = TILE // CELL - 1 - int((north - key[1]) // CELL)
        value = float(data[row, col])
        return None if value <= NODATA + 1 or value < 40 else round(value, 1)


def load(url: str) -> None:
    import psycopg

    road, rail = Raster("road"), Raster("rail")
    air = Raster("air") if air_tiles_present() else None
    if air is None:
        print("load: no aircraft tiles in $AE_WORK; aircraft_lden stays NULL (road and rail only)")
    digest = hashlib.sha256()
    for source in SOURCES:
        for east, north in tiles():
            with open(tile_path(source, east, north), "rb") as handle:
                digest.update(handle.read())
    source_id = ("src-defra-noise-round4-2022-road-rail-air" if air
                 else "src-defra-noise-round4-2022")
    caveats = ["Modelled annual averages at 4 m above ground on a 10 m grid, not measurements.",
               "Levels under 40 dB Lden are not mapped; "
               + ("aircraft noise is included (Defra airport noise mapping, 2021 operations)." if air
                  else "aircraft noise is not included in this load."),
               "Each home is read at its OS Open UPRN point, which may sit at the building centre."]
    attribution = ("Defra strategic noise mapping Round 4 (2022), road and rail"
                   + (", and airports (2021 operations)" if air else "")
                   + ". Contains public sector information licensed under the Open Government Licence v3.0.")
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        points = list(cur.execute(
            "SELECT uprn, ST_X(ST_Transform(location, 27700)), ST_Y(ST_Transform(location, 27700)) FROM property"))
        buffer = io.StringIO()
        loud = 0
        for uprn, east, north in points:
            r, t = road.sample(east, north), rail.sample(east, north)
            a = air.sample(east, north) if air else None
            loud += max(r or 0, t or 0, a or 0) >= 55
            buffer.write(f"{uprn}\t{'' if r is None else r}\t{'' if t is None else t}\t"
                         f"{'' if a is None else a}\t{source_id}\n")
        cur.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
                 attribution, transformation_version, geography_vintage, validation_status, caveats)
               VALUES (%s, 'https://environment.data.gov.uk/dataset/562c9d56-7c2d-4d42-83bb-578d6e97a517',
                 now(), '2022-12-31', %s, 'OGL-3.0', %s, %s, '2021', 'passed', %s)
               ON CONFLICT (id) DO UPDATE SET sha256 = EXCLUDED.sha256, retrieved_at = now()""",
            (source_id, digest.hexdigest(), attribution, ETL_VERSION, caveats))
        cur.execute("DELETE FROM dwelling_noise")
        buffer.seek(0)
        with cur.copy("COPY dwelling_noise (uprn, road_lden, rail_lden, aircraft_lden, source_release_id)"
                      " FROM STDIN WITH (FORMAT text, NULL '')") as copy:
            copy.write(buffer.read())
        areas = cur.execute("SELECT rebuild_area_noise(%s)", (source_id,)).fetchone()[0]
        # Overview London ranks (migration 054) derive from area_noise: refresh them in this transaction.
        if cur.execute("SELECT to_regproc('public.rebuild_area_rank') IS NOT NULL").fetchone()[0]:
            cur.execute("SELECT rebuild_area_rank()")
        print(f"load: {len(points)} dwellings sampled ({loud} at 55 dB Lden or more), {areas} areas")


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else ""
    if stage == "download":
        download()
    elif stage == "load" and len(sys.argv) == 3:
        load(sys.argv[2])
    else:
        sys.exit(__doc__)
