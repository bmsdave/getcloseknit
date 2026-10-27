"""Flood risk bands for London areas and homes (Environment Agency NaFRA2).

Two Environment Agency datasets, both Open Government Licence v3.0:
  rivers-sea     Risk of Flooding from Rivers and Sea (dataset 96ab4342-...)
  surface-water  Risk of Flooding from Surface Water (dataset b5aaa28d-...)

Each maps the chance of flooding in a year as four bands. Places outside every
mapped band are "very low". The EA offers no WFS for these layers, so the
London clip is read from its WMS as GeoJSON vectors (British National Grid,
2 m source grid) in 4 km tiles at 1 m per pixel, which keeps the source
geometry unsimplified. Tiles overlap by a few metres; the load clips every
polygon back to its own tile so nothing is counted twice.

The EA maps open water itself as high risk, so rivers, lakes and reservoirs
from OpenStreetMap (~/data/osm, ODbL) are left out of each area's land.

  python3 -m area_analytics.flood_risk download            # tiles into $AE_WORK
  python3 -m area_analytics.flood_risk water               # OSM water (needs osmium)
  python3 -m area_analytics.flood_risk load <database-url>  # needs psycopg

The load fills `flood_zone` and `flood_water`, then `rebuild_flood(release)`
(migration 018) fills `dwelling_flood` (band at every OS Open UPRN point) and
`area_flood` (land of each LSOA, MSOA and borough in each band).
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import subprocess
import sys
import urllib.request
from dataclasses import dataclass

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
WORK = os.environ.get("AE_WORK", os.path.join(DATA, "aework", "flood"))
ETL_VERSION = "close-knit-flood-1"
# Source releases are immutable: the id carries the tiles digest, so a reload of the
# same tiles reuses its release and new tiles get a new one.
RELEASE_PREFIX = "src-ea-nafra2-flood-"
RELEASE_DATE = "2026-07-06"  # EA metadata date of the NaFRA2 layers we read

TILE = 4_000  # metres
PIXELS = 4_000  # 1 m per pixel: no generalisation of the 2 m source grid
# Greater London in British National Grid, rounded out to whole tiles.
EXTENT = (500_000, 152_000, 564_000, 204_000)

OSM_PBF = os.path.join(DATA, "osm", "greater-london-latest.osm.pbf")
WATER_TAGS = ("wr/natural=water", "wr/waterway=riverbank", "wr/landuse=reservoir")

WMS = "https://environment.data.gov.uk/geoservices/datasets/{dataset}/wms"


@dataclass(frozen=True)
class FloodSource:
    id: str
    dataset: str
    layer: str
    title: str


SOURCES = {
    "rivers-sea": FloodSource(
        "rivers-sea", "96ab4342-82c1-4095-87f1-0082e8d84ef1", "rofrs_4band",
        "Risk of Flooding from Rivers and Sea"),
    "surface-water": FloodSource(
        "surface-water", "b5aaa28d-6eb9-460e-8d6f-43caa71fbe0e", "rofsw",
        "Risk of Flooding from Surface Water"),
}

# Band codes stored in the database, lowest to highest. "very-low" is also
# every place outside the mapped bands.
BANDS = ("very-low", "low", "medium", "high")
BAND_CODE = {band: code for code, band in enumerate(BANDS, start=1)}
# Chance of flooding in any one year, as the EA defines each band.
BAND_CHANCE = {
    "very-low": "less than 1 in 1,000 (0.1%)",
    "low": "between 1 in 1,000 and 1 in 100 (0.1% to 1%)",
    "medium": "between 1 in 100 and 1 in 30 (1% to 3.3%)",
    "high": "more than 1 in 30 (3.3%)",
}
_SOURCE_LABELS = {"very low": "very-low", "low": "low", "medium": "medium", "high": "high"}


def band_code(label: str | None) -> int:
    """EA `risk_band` label ("High", "Very low", ...) to the stored code."""
    band = _SOURCE_LABELS.get((label or "").strip().lower())
    if band is None:
        raise ValueError(f"unknown flood risk band: {label!r}")
    return BAND_CODE[band]


def band_name(code: int | None) -> str | None:
    return None if code is None else BANDS[code - 1]


def tiles(extent=EXTENT, size=TILE):
    x0, y0, x1, y1 = extent
    for east in range(x0, x1, size):
        for north in range(y0, y1, size):
            yield east, north


def tile_url(source: FloodSource, east: int, north: int) -> str:
    return (WMS.format(dataset=source.dataset)
            + "?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&STYLES=&CRS=EPSG:27700"
            + f"&LAYERS={source.layer}&BBOX={east},{north},{east + TILE},{north + TILE}"
            + f"&WIDTH={PIXELS}&HEIGHT={PIXELS}&FORMAT=application/json;type=geojson")


def tile_path(source_id: str, east: int, north: int) -> str:
    return os.path.join(WORK, source_id, f"{east}-{north}.geojson.gz")


def tile_features(payload: dict, source_id: str):
    """(band code, GeoJSON geometry) for each feature of one WMS tile."""
    if payload.get("type") != "FeatureCollection":
        raise ValueError(f"{source_id}: not a FeatureCollection")
    for feature in payload.get("features", []):
        geometry = feature.get("geometry")
        if not geometry or geometry.get("type") not in ("Polygon", "MultiPolygon"):
            continue
        yield band_code(feature.get("properties", {}).get("risk_band")), geometry


def fetch_tile(source: FloodSource, east: int, north: int) -> None:
    path = tile_path(source.id, east, north)
    if os.path.exists(path):
        return
    body = b""
    for attempt in range(3):
        try:
            with urllib.request.urlopen(tile_url(source, east, north), timeout=600) as response:
                body = response.read()
            break
        except OSError:
            if attempt == 2:
                raise
    payload = json.loads(body)
    count = sum(1 for _ in tile_features(payload, source.id))  # validates every band label
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with gzip.open(path + ".tmp", "wb") as handle:
        handle.write(body)
    os.replace(path + ".tmp", path)
    print(f"download: {source.id} {east},{north} {count} features {len(body) // 1024} KiB", flush=True)


def download() -> None:
    from concurrent.futures import ThreadPoolExecutor

    jobs = [(source, east, north) for source in SOURCES.values() for east, north in tiles()]
    with ThreadPoolExecutor(max_workers=4) as pool:
        for future in [pool.submit(fetch_tile, *job) for job in jobs]:
            future.result()


def water_path() -> str:
    return os.path.join(WORK, "water.geojsonseq")


def water() -> None:
    """Open water polygons (natural=water, riverbanks, reservoirs) from the OSM extract."""
    os.makedirs(WORK, exist_ok=True)
    filtered = os.path.join(WORK, "water.osm.pbf")
    subprocess.run(["osmium", "tags-filter", OSM_PBF, *WATER_TAGS, "-O", "-o", filtered], check=True)
    subprocess.run(["osmium", "export", filtered, "-f", "geojsonseq", "-x", "print_record_separator=false",
                    "--geometry-types=polygon", "-O", "-o", water_path()], check=True)
    print(f"water: {sum(1 for _ in open(water_path()))} polygons")


def water_geometries(lines):
    """GeoJSON geometry strings of the polygon features in a GeoJSON-seq file."""
    for line in lines:
        line = line.strip().lstrip("\x1e")
        if not line:
            continue
        geometry = json.loads(line).get("geometry") or {}
        if geometry.get("type") in ("Polygon", "MultiPolygon"):
            yield json.dumps(geometry)


def tiles_digest() -> str:
    digest = hashlib.sha256()
    for source_id in SOURCES:
        for east, north in tiles():
            with open(tile_path(source_id, east, north), "rb") as handle:
                digest.update(handle.read())
    return digest.hexdigest()


ATTRIBUTION = (
    "Environment Agency, Risk of Flooding from Rivers and Sea and Risk of Flooding from Surface "
    "Water (NaFRA2). Contains public sector information licensed under the Open Government "
    "Licence v3.0. © Environment Agency copyright and/or database right. Open water: "
    "© OpenStreetMap contributors (ODbL).")
CAVEATS = [
    "Bands are modelled chances of flooding in a year, not a record of past floods.",
    "Area figures describe the land in the area, not each building in it.",
    "A home is read at its OS Open UPRN point, which may sit at the building centre.",
    "Places outside every mapped band count as very low. Groundwater and sewer flooding are not included.",
    "Rivers, lakes and reservoirs (OpenStreetMap) are left out of an area's land.",
]


def load(url: str) -> None:
    import psycopg

    digest = tiles_digest()
    release_id = RELEASE_PREFIX + digest[:12]
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
                 attribution, transformation_version, geography_vintage, validation_status, caveats)
               VALUES (%s, 'https://environment.data.gov.uk/dataset/96ab4342-82c1-4095-87f1-0082e8d84ef1',
                 now(), %s, %s, 'OGL-3.0', %s, %s, '2021', 'passed', %s)
               ON CONFLICT (id) DO NOTHING""",
            (release_id, RELEASE_DATE, digest, ATTRIBUTION, ETL_VERSION, CAVEATS))
        cur.execute("DELETE FROM flood_water")
        with open(water_path()) as handle:
            cur.executemany(
                """INSERT INTO flood_water (geom) SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(
                     ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), 27700)), 3))""",
                [(geometry,) for geometry in water_geometries(handle)])
        cur.execute("DELETE FROM flood_water WHERE ST_IsEmpty(geom)")
        cur.execute("DELETE FROM flood_zone")
        loaded = 0
        for source_id in SOURCES:
            for east, north in tiles():
                with gzip.open(tile_path(source_id, east, north), "rb") as handle:
                    payload = json.loads(handle.read())
                rows = [(source_id, code, json.dumps(geometry), east, north, east + TILE, north + TILE,
                         release_id)
                        for code, geometry in tile_features(payload, source_id)]
                if not rows:
                    continue
                # Clip each polygon to its own tile (the WMS adds a small buffer).
                cur.executemany(
                    """INSERT INTO flood_zone (source, band, geom, source_release_id)
                       SELECT %s, %s, g, %s FROM (
                         SELECT ST_Multi(ST_CollectionExtract(ST_Intersection(
                           ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(%s), 27700)),
                           ST_MakeEnvelope(%s, %s, %s, %s, 27700)), 3)) AS g) clipped
                       WHERE NOT ST_IsEmpty(g)""",
                    [(s, c, r, g, x0, y0, x1, y1) for s, c, g, x0, y0, x1, y1, r in rows])
                loaded += len(rows)
            print(f"load: {source_id} done ({loaded} features so far)", flush=True)
        cur.execute("ANALYZE flood_zone")
        homes, areas = cur.execute("SELECT * FROM rebuild_flood(%s)", (release_id,)).fetchone()
        print(f"load: {loaded} features, {homes} homes banded, {areas} area rows")


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else ""
    if stage == "download":
        download()
    elif stage == "water":
        water()
    elif stage == "load" and len(sys.argv) == 3:
        load(sys.argv[2])
    else:
        sys.exit(__doc__)
