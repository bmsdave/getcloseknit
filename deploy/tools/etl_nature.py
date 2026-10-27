"""Nature on the area card: greenness, street trees, nature sites and wildlife seen nearby.

Sources (all open; see DATA-LICENCES.md):
  GLA public realm trees, Nov 2025 (London Datastore, OGL v3): ~1.1M council, TfL and park trees
  Sentinel-2 L2A, summer 2025 (Copernicus, free and open; COGs from Earth Search on AWS):
            per 10 m cell the highest NDVI of the clear June and July scenes
  Natural England Local Nature Reserves and SSSIs (OGL v3)
  GBIF occurrence search, records licensed CC0 or CC BY only (birds, mammals, amphibians)

Stages (files under $AE_WORK, default ~/data/aework/nature):
  download            trees CSV, nature sites GeoJSON and the Sentinel-2 red, NIR and SCL rasters
                      (trees and Sentinel-2: London; sites: the CLOSE_KNIT_ETL_COVERAGE box, default England)
  sites <db-url>      only the nature sites (download if missing, nature_site, rebuild_area_nature, release):
                      the England step; green share, street trees and wildlife stay London-only
  load <db-url>       street_tree, nature_site, an NDVI mosaic on the British National Grid,
                      area_green (30 m samples per LSOA, MSOA, borough), dwelling_nature (~100 m
                      around each home), then rebuild_area_nature() (migration 064)
  wildlife <db-url>   GBIF facets within 1 km of each LSOA's point on surface (cached and
                      resumable in wildlife.jsonl), then area_wildlife
  layers <db-url>     map layers as published metrics: `nature-score` and one `wildlife-<species>`
                      per notable species (its share of the records nearby), then a product release

  AE_WORK=~/data/aework/nature python3 etl_nature.py download
  AE_WORK=~/data/aework/nature python3 etl_nature.py load <database-url>
  AE_WORK=~/data/aework/nature python3 etl_nature.py wildlife <database-url>
  AE_WORK=~/data/aework/nature python3 etl_nature.py layers <database-url>

Needs numpy, tifffile, imagecodecs, pyproj and psycopg.
"""
from __future__ import annotations

import csv
import datetime as dt
import hashlib
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.error
import urllib.request

import area_coverage as coverage

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
WORK = os.environ.get("AE_WORK", os.path.join(DATA, "aework", "nature"))
ETL_VERSION = "close-knit-nature-1"
USER_AGENT = "CloseKnitBot/1.0 (+https://getcloseknit.com/bot)"

TREES_URL = ("https://data.london.gov.uk/download/2r45m/e62a6a1f-390d-4193-ae32-3aabd9846f36/"
             "Borough_tree_list_2025Nov.csv")
SITES = {
    "lnr": "https://services.arcgis.com/JJzESW51TqeY9uat/arcgis/rest/services/Local_Nature_Reserves_England/FeatureServer/0",
    "sssi": "https://services.arcgis.com/JJzESW51TqeY9uat/arcgis/rest/services/SSSI_England/FeatureServer/0",
}
STAC = "https://earth-search.aws.element84.com/v1/search"
# Two clear summer passes that together cover Greater London (searched 2026-10-16): June keeps
# grass green before the dry late summer; the per-cell maximum drops clouds and shadows.
SCENE_DATES = ("2025-06-19", "2025-07-11")
SCENE_MAX_CLOUD = 30
# The street-tree file (GLA) and the Sentinel-2 mosaic are London-only sources: their box stays London's.
LONDON_BBOX = (-0.52, 51.28, 0.34, 51.70)  # lon/lat
SITE_OFFSET = 0.00005  # degrees (~3-6 m): nature-site outlines are generalised on download

# The NDVI mosaic: British National Grid, 10 m cells, row 0 at the northern edge.
EXTENT = (500_000, 150_000, 570_000, 210_000)
CELL = 10
GREEN_NDVI = 0.4       # vegetation at 10 m: grass, trees, gardens; roofs, roads and water stay below
SAMPLE_STEP = 3        # area shares sample every 3rd cell (30 m)
HOME_WINDOW = 10       # cells either side of a home: a 210 m square, "about 100 m around"
SCL_CLEAR = (2, 4, 5, 6, 7, 11)  # dark area, vegetation, bare, water, unclassified, snow

WILDLIFE_RADIUS_KM = 1
WILDLIFE_YEARS = (2021, 2025)
GBIF = "https://api.gbif.org/v1"
GBIF_CLASSES = {212: "bird", 359: "mammal", 131: "amphibian"}  # GBIF backbone class keys
GBIF_LICENCES = ("CC0_1_0", "CC_BY_4_0")
# Domestic or captive animals are not wildlife.
NOT_WILD = {"Felis catus", "Canis lupus", "Canis familiaris", "Homo sapiens", "Equus caballus", "Bos taurus",
            "Ovis aries", "Capra hircus", "Sus scrofa", "Gallus gallus", "Cavia porcellus", "Oryctolagus cuniculus"}
# Named when seen: (label, GBIF name, rank). Never a species whose site is sensitive (badger setts,
# breeding raptors): those still count in the totals but are not named.
NOTABLE = [
    ("Hedgehog", "Erinaceus europaeus", "SPECIES"),
    ("Bats", "Chiroptera", "ORDER"),
    ("Fox", "Vulpes vulpes", "SPECIES"),
    ("Deer", "Cervidae", "FAMILY"),
    ("Kingfisher", "Alcedo atthis", "SPECIES"),
    ("Woodpecker", "Picidae", "FAMILY"),
    ("Owl", "Strigiformes", "ORDER"),
    ("Heron", "Ardea cinerea", "SPECIES"),
    ("Swift", "Apus apus", "SPECIES"),
    ("House sparrow", "Passer domesticus", "SPECIES"),
    ("Frog", "Rana temporaria", "SPECIES"),
    ("Newt", "Salamandridae", "FAMILY"),
]


# --- download ---------------------------------------------------------------------------------

def fetch(url: str, data: bytes | None = None, timeout: int = 300) -> bytes:
    request = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT,
                                                              "Content-Type": "application/json"})
    for attempt in range(8):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code not in (429, 500, 502, 503, 504) or attempt == 7:
                raise
            # Rate limited or busy: wait as long as the server asks, else back off from a minute.
            wait = error.headers.get("Retry-After")
            time.sleep(int(wait) if wait and wait.isdigit() else 60 * (attempt + 1))
        except OSError:
            if attempt == 7:
                raise
            time.sleep(2 ** min(attempt, 5))
    raise AssertionError("unreachable")


def save(path: str, body: bytes) -> None:
    with open(path + ".tmp", "wb") as handle:
        handle.write(body)
    os.replace(path + ".tmp", path)


def download_file(url: str, path: str) -> None:
    if os.path.exists(path):
        return
    save(path, fetch(url, timeout=1800))
    print(f"download: {os.path.basename(path)} {os.path.getsize(path) // 1024} KiB", flush=True)


def scenes() -> list[dict]:
    """Earth Search items on SCENE_DATES over London (cached in scenes.json)."""
    path = os.path.join(WORK, "scenes.json")
    if os.path.exists(path):
        with open(path) as handle:
            return json.load(handle)
    items = []
    for day in SCENE_DATES:
        body = json.dumps({"collections": ["sentinel-2-c1-l2a"], "bbox": LONDON_BBOX, "limit": 50,
                           "datetime": f"{day}T00:00:00Z/{day}T23:59:59Z",
                           "query": {"eo:cloud_cover": {"lt": SCENE_MAX_CLOUD}}}).encode()
        for feature in json.loads(fetch(STAC, body))["features"]:
            assets = feature["assets"]
            items.append({"id": feature["id"], "epsg": int(feature["properties"]["proj:code"].split(":")[1])
                          if "proj:code" in feature["properties"] else int(feature["properties"]["proj:epsg"]),
                          "cloud": feature["properties"]["eo:cloud_cover"],
                          **{band: {"href": assets[band]["href"], "transform": assets[band]["proj:transform"]}
                             for band in ("red", "nir", "scl")}})
    if not items:
        raise SystemExit("no Sentinel-2 scenes found")
    save(path, json.dumps(items, indent=1).encode())
    return items


def scene_path(item: dict, band: str) -> str:
    return os.path.join(WORK, "s2", f"{item['id']}-{band}.tif")


def download_sites() -> None:
    """Natural England LNRs and SSSIs inside the ETL coverage box (CLOSE_KNIT_ETL_COVERAGE, default
    England). Outlines come generalised to SITE_OFFSET degrees (a few metres): the sites are only used
    for each area's nearest-site distance."""
    bbox = coverage.from_env().bbox_wgs84
    for kind, service in SITES.items():
        path = os.path.join(WORK, f"{kind}.geojson")
        if not os.path.exists(path):
            features, offset = [], 0
            while True:
                query = urllib.parse.urlencode({
                    "where": "1=1", "geometry": ",".join(map(str, bbox)), "geometryType": "esriGeometryEnvelope",
                    "inSR": 4326, "spatialRel": "esriSpatialRelIntersects", "outFields": "REF_CODE,NAME",
                    "outSR": 4326, "f": "geojson", "resultOffset": offset, "resultRecordCount": 200,
                    "maxAllowableOffset": SITE_OFFSET, "geometryPrecision": 6})
                page = json.loads(fetch(f"{service}/query?{query}"))
                features += page["features"]
                if not page.get("properties", {}).get("exceededTransferLimit") and not page.get("exceededTransferLimit"):
                    break
                offset += len(page["features"])
            save(path, json.dumps({"type": "FeatureCollection", "features": features}).encode())
            print(f"download: {kind} {len(features)} sites", flush=True)


def download() -> None:
    from concurrent.futures import ThreadPoolExecutor

    os.makedirs(os.path.join(WORK, "s2"), exist_ok=True)
    download_file(TREES_URL, os.path.join(WORK, "trees.csv"))
    download_sites()
    jobs = [(item[band]["href"], scene_path(item, band)) for item in scenes() for band in ("red", "nir", "scl")]
    with ThreadPoolExecutor(max_workers=4) as pool:
        for future in [pool.submit(download_file, *job) for job in jobs]:
            future.result()


# --- NDVI -------------------------------------------------------------------------------------

def ndvi(red, nir):
    """NDVI from Sentinel-2 C1 L2A digital numbers (reflectance = DN * 1e-4 - 0.1); NaN when unusable."""
    import numpy as np

    r = red.astype(np.float32) * 1e-4 - 0.1
    n = nir.astype(np.float32) * 1e-4 - 0.1
    total = n + r
    with np.errstate(divide="ignore", invalid="ignore"):
        value = (n - r) / total
    return np.where((red > 0) & (nir > 0) & (total > 0), value, np.nan).astype(np.float32)


def mosaic():
    """Highest clear-sky NDVI per 10 m BNG cell over all scenes (cached as ndvi.npy)."""
    import numpy as np

    path = os.path.join(WORK, "ndvi.npy")
    if os.path.exists(path):
        return np.load(path)
    import tifffile
    from pyproj import Transformer

    x0, y0, x1, y1 = EXTENT
    width, height = (x1 - x0) // CELL, (y1 - y0) // CELL
    out = np.full((height, width), np.nan, dtype=np.float32)
    east = x0 + (np.arange(width) + 0.5) * CELL
    for item in scenes():
        red = tifffile.imread(scene_path(item, "red"))
        nir = tifffile.imread(scene_path(item, "nir"))
        scl = tifffile.imread(scene_path(item, "scl"))
        _, _, tx, _, _, ty = item["red"]["transform"]
        to_utm = Transformer.from_crs(27700, item["epsg"], always_xy=True)
        for top in range(0, height, 500):
            rows = np.arange(top, min(top + 500, height))
            north = y1 - (rows + 0.5) * CELL
            ee, nn = np.meshgrid(east, north)
            ux, uy = to_utm.transform(ee, nn)
            col = np.floor((ux - tx) / 10).astype(np.int64)
            row = np.floor((ty - uy) / 10).astype(np.int64)
            inside = (col >= 0) & (row >= 0) & (col < red.shape[1]) & (row < red.shape[0])
            col, row = np.where(inside, col, 0), np.where(inside, row, 0)
            clear = inside & np.isin(scl[row // 2, col // 2], SCL_CLEAR)
            value = np.where(clear, ndvi(red[row, col], nir[row, col]), np.nan)
            out[rows] = np.fmax(out[rows], value)
        print(f"mosaic: {item['id']} ({item['cloud']:.1f}% cloud)", flush=True)
    np.save(path, out)
    return out


def window_sums(grid, cells, rows, cols):
    """Sum of `grid` in the (2*cells+1)^2 square around each (row, col), clipped at the edges."""
    import numpy as np

    table = np.zeros((grid.shape[0] + 1, grid.shape[1] + 1), dtype=np.int64)
    table[1:, 1:] = grid.cumsum(0).cumsum(1)
    r0 = np.clip(rows - cells, 0, grid.shape[0])
    r1 = np.clip(rows + cells + 1, 0, grid.shape[0])
    c0 = np.clip(cols - cells, 0, grid.shape[1])
    c1 = np.clip(cols + cells + 1, 0, grid.shape[1])
    return table[r1, c1] - table[r0, c1] - table[r1, c0] + table[r0, c0]


def cell_of(east, north):
    """Row and column of BNG coordinates in the mosaic (may fall outside it)."""
    import numpy as np

    x0, _, _, y1 = EXTENT
    return (np.floor((y1 - np.asarray(north)) / CELL).astype(np.int64),
            np.floor((np.asarray(east) - x0) / CELL).astype(np.int64))


# --- load -------------------------------------------------------------------------------------

def sha256(*paths: str) -> str:
    digest = hashlib.sha256()
    for path in paths:
        with open(path, "rb") as handle:
            for block in iter(lambda: handle.read(1 << 20), b""):
                digest.update(block)
    return digest.hexdigest()


def register(cur, base_id: str, url: str, release_date: str, digest: str, licence: str,
             attribution: str, caveats: list[str], version: str = ETL_VERSION) -> str:
    """Record a source release; returns its id. Releases are immutable, so the id carries the
    content hash: the same files reuse their release, new files get a new one."""
    source_id = f"{base_id}-{digest[:8]}"
    cur.execute(
        """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence, attribution,
             transformation_version, geography_vintage, validation_status, caveats)
           VALUES (%s, %s, now(), %s, %s, %s, %s, %s, '2021', 'passed', %s)
           ON CONFLICT (id) DO NOTHING""",
        (source_id, url, release_date, digest, licence, attribution, version, caveats))
    return source_id


def tree_records(path: str):
    """(id, lon, lat, row) for every tree with a London position; the id is the borough and its tree id,
    with "#2", "#3" on repeats, so the same file always gives the same ids (migration 066 updates by id)."""
    seen: dict[str, int] = {}
    with open(path, newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            try:
                lat, lon = float(row["lat"]), float(row["lon"])
            except (TypeError, ValueError):
                continue
            if not (LONDON_BBOX[0] <= lon <= LONDON_BBOX[2] and LONDON_BBOX[1] <= lat <= LONDON_BBOX[3]):
                continue
            key = f"{row['borough']}:{row['uniqueid']}"
            seen[key] = seen.get(key, 0) + 1
            if seen[key] > 1:
                key = f"{key}#{seen[key]}"
            yield key, lon, lat, row


def tree_kind(row: dict) -> tuple[str | None, str | None, str]:
    """(common name, taxon, owner) of one tree row."""
    name = (row.get("gla_name") or row.get("common_name") or "").strip() or None
    taxon = (row.get("taxon_species") or row.get("taxon_genus") or "").strip() or None
    return name, taxon, (row.get("maintainer") or row["borough"]).strip()


def tree_rows(path: str):
    """(id, lon, lat, common name, taxon, owner) for every tree with a London position."""
    for key, lon, lat, row in tree_records(path):
        yield key, lon, lat, *tree_kind(row)


MEASURE = re.compile(r"(?i)(?P<prefix><|up to |over )?(?P<low>\d+(?:\.\d+)?)(?: ?to (?P<high>\d+(?:\.\d+)?))? ?(?P<plus>\+)? ?(?P<unit>cm|m)")
NOT_RECORDED = {"", "not recorded", "not provided", "undefined", "unknown", "n/a"}


def measure(raw: str | None) -> tuple[str | None, float | None]:
    """A recorded size as tidy text and a number: "8 m" (8), "5 to 10 m" -> "5–10 m" (7.5), "<3 m" ->
    "under 3 m" (3), "15+ m" (15), "Up to 10 cm" -> "up to 10 cm" (10); words such as "Sapling" or
    "Multi-stemmed" stay as they are with no number; "Not recorded" is (None, None)."""
    text = " ".join((raw or "").split())
    if text.lower() in NOT_RECORDED:
        return None, None
    match = MEASURE.fullmatch(text)
    if not match:
        return text[:40], None
    low, high, unit = match["low"], match["high"], match["unit"].lower()
    if high:
        return f"{low}–{high} {unit}", (float(low) + float(high)) / 2
    prefix = (match["prefix"] or "").lower()
    if prefix == "<":
        prefix = "under "
    return f"{prefix}{low}{'+' if match['plus'] else ''} {unit}", float(low)


def tree_size(row: dict) -> tuple[str | None, str | None, str | None, float | None, str | None]:
    """(height, canopy, girth, canopy_m, age) as the owner recorded them (migration 066). canopy_m sizes
    the map's dot and is kept only between 0 and 60 m; an age of "Not provided" or "Undefined" is None."""
    height, _ = measure(row.get("height_m"))
    canopy, canopy_m = measure(row.get("canopy_m"))
    girth, _ = measure(row.get("girth_dbh"))
    if canopy_m is not None and not 0 < canopy_m <= 60:
        canopy_m = None
    age = " ".join((row.get("age_cat") or "").split())
    return height, canopy, girth, canopy_m, (None if age.lower() in NOT_RECORDED else age[:40])


def load_trees(cur, path: str) -> list[tuple[float, float]]:
    source_id = register(
        cur, "src-gla-trees-2025-11", "https://data.london.gov.uk/dataset/local-authority-maintained-trees", "2025-11-30",
        sha256(path), "OGL-3.0",
        "Greater London Authority, London Datastore: Local Authority Maintained Trees (Nov 2025). Contains "
        "public sector information licensed under the Open Government Licence v3.0.",
        ["Council, TfL and Royal Parks trees only: gardens and private land are not counted.",
         "Some boroughs' lists are older or lack positions, so a low count can mean a gap in the list."])
    cur.execute("DELETE FROM street_tree")
    points, buffer = [], io.StringIO()
    clean = lambda value: "" if value is None else str(value).replace("\t", " ").replace("\n", " ").replace("\\", "/")
    for key, lon, lat, row in tree_records(path):
        name, taxon, owner = tree_kind(row)
        points.append((lon, lat))
        size = "\t".join(clean(value) for value in tree_size(row))
        buffer.write(f"{clean(key)}\tSRID=4326;POINT({lon} {lat})\t{clean(name)}\t{clean(taxon)}\t{clean(owner)}\t{size}\t{source_id}\n")
    buffer.seek(0)
    with cur.copy("COPY street_tree (id, location, common_name, taxon, owner, height, canopy, girth, canopy_m, age, "
                  "source_release_id) FROM STDIN WITH (FORMAT text, NULL '')") as copy:
        copy.write(buffer.read())
    print(f"load: {len(points)} street trees", flush=True)
    return points


SMALL_WORDS = {"of", "and", "the", "in", "on", "at", "to"}
ACRONYMS = {"SSSI", "LNR", "NNR"}  # kept upper case: "Basingstoke Canal SSSI"


def site_name(raw: str) -> str:
    """Natural England names are upper case: "PALACE ROAD NATURE GARDEN" -> "Palace Road Nature Garden"."""
    words = raw.strip().split()
    return " ".join(word.upper() if word.upper() in ACRONYMS
                    else word.lower() if index and word.lower() in SMALL_WORDS else word.capitalize()
                    for index, word in enumerate(words))


def load_sites(cur) -> str:
    """Replace nature_site from the downloaded GeoJSON; returns the source release id."""
    paths = [os.path.join(WORK, f"{kind}.geojson") for kind in SITES]
    source_id = register(
        cur, f"src-ne-nature-sites-{dt.date.fromtimestamp(os.path.getmtime(paths[0])):%Y-%m}",
        "https://naturalengland-defra.opendata.arcgis.com/", dt.date.today().isoformat(),
        sha256(*paths), "OGL-3.0",
        "© Natural England copyright. Contains Ordnance Survey data © Crown copyright and database right "
        f"{dt.date.today().year}.",
        ["Local Nature Reserves and Sites of Special Scientific Interest only; borough Sites of Importance "
         "for Nature Conservation are not openly licensed and are not included."])
    cur.execute("DELETE FROM nature_site")
    count = 0
    for kind, path in zip(SITES, paths):
        with open(path) as handle:
            for feature in json.load(handle)["features"]:
                props, geometry = feature["properties"], feature.get("geometry")
                if not geometry or not props.get("NAME"):
                    continue
                cur.execute(
                    """INSERT INTO nature_site (id, kind, name, geometry, source_release_id)
                       VALUES (%s, %s, %s, ST_Multi(ST_CollectionExtract(ST_MakeValid(
                         ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)), 3)), %s)
                       ON CONFLICT (id) DO NOTHING""",
                    (f"{kind}:{props.get('REF_CODE') or props['NAME']}", kind, site_name(props["NAME"]),
                     json.dumps(geometry), source_id))
                count += 1
    print(f"load: {count} nature sites", flush=True)
    return source_id


def sites(url: str) -> None:
    """Only the nature sites: download them for the coverage (default England), replace nature_site,
    rebuild area_nature (every LSOA gets its nearest site; green and trees stay London's) and stage a
    release that drops the earlier site build."""
    import psycopg
    from psycopg.rows import dict_row

    import stage_release

    download_sites()
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        old = {row[0] for row in cur.execute("SELECT DISTINCT source_release_id FROM nature_site")}
        source_id = load_sites(cur)
        areas = cur.execute("SELECT rebuild_area_nature()").fetchone()[0]
        print(f"sites: {areas} areas in area_nature", flush=True)
    with psycopg.connect(url, row_factory=dict_row) as conn, conn.cursor() as cur:
        stage_release.stage(cur, "nature-sites", [source_id], replace=tuple(sorted(old - {source_id})))


def load_green(cur, grid) -> str:
    """area_green from 30 m samples of the mosaic; returns the source release id."""
    import numpy as np

    source_id = register(
        cur, "src-sentinel2-ndvi-2025", "https://registry.opendata.aws/sentinel-2-l2a-cogs/", SCENE_DATES[-1],
        sha256(os.path.join(WORK, "scenes.json")), "Copernicus-Sentinel-free-full-open",
        f"Contains modified Copernicus Sentinel data ({SCENE_DATES[0][:4]}), processed by Close Knit "
        "from Sentinel-2 L2A (Earth Search on AWS).",
        [f"Green = NDVI {GREEN_NDVI} or more on a 10 m grid: the highest of the clear scenes of "
         f"{' and '.join(SCENE_DATES)}.",
         "Satellite view from above: gardens, trees, grass and green roofs all count; it says nothing "
         "about access or quality."])
    rows, cols = np.mgrid[0:grid.shape[0]:SAMPLE_STEP, 0:grid.shape[1]:SAMPLE_STEP]
    values = grid[rows, cols]
    keep = ~np.isnan(values)
    x0, _, _, y1 = EXTENT
    east = (x0 + (cols[keep] + 0.5) * CELL).astype(np.int32)
    north = (y1 - (rows[keep] + 0.5) * CELL).astype(np.int32)
    green = values[keep] >= GREEN_NDVI
    buffer = io.StringIO()
    for e, n, g in zip(east.tolist(), north.tolist(), green.tolist()):
        buffer.write(f"{e}\t{n}\t{'t' if g else 'f'}\n")
    buffer.seek(0)
    cur.execute("CREATE TEMP TABLE green_sample (e integer, n integer, green boolean) ON COMMIT DROP")
    with cur.copy("COPY green_sample FROM STDIN") as copy:
        copy.write(buffer.read())
    cur.execute("""CREATE TEMP TABLE lsoa_bng ON COMMIT DROP AS
                   SELECT l.id, l.parent_id AS msoa, m.parent_id AS borough, ST_Transform(l.geometry, 27700) AS geom
                   FROM area_geography l JOIN area_geography m ON m.id = l.parent_id WHERE l.kind = 'lsoa'""")
    cur.execute("CREATE INDEX ON lsoa_bng USING gist (geom)")
    cur.execute("DELETE FROM area_green")
    cur.execute(
        """INSERT INTO area_green (geography_id, sampled, green_share, source_release_id)
           WITH hits AS (
               SELECT l.id, l.msoa, l.borough, s.green
               FROM green_sample s JOIN lsoa_bng l ON ST_Intersects(l.geom, ST_SetSRID(ST_MakePoint(s.e, s.n), 27700))
           ), levels AS (
               SELECT id AS geography_id, green FROM hits
               UNION ALL SELECT msoa, green FROM hits
               UNION ALL SELECT borough, green FROM hits
           )
           SELECT geography_id, count(*), round(avg(green::int)::numeric, 3), %s
           FROM levels GROUP BY geography_id""", (source_id,))
    print(f"load: {len(green)} green samples, {cur.rowcount} areas", flush=True)
    return source_id


def load_dwellings(cur, grid, trees: list[tuple[float, float]], green_source: str) -> None:
    """Green share and street trees in the ~210 m square around every home."""
    import numpy as np
    from pyproj import Transformer

    valid = ~np.isnan(grid)
    green = (np.nan_to_num(grid, nan=-1) >= GREEN_NDVI)
    counts = np.zeros(grid.shape, dtype=np.int32)
    if trees:
        lon, lat = np.array(trees).T
        east, north = Transformer.from_crs(4326, 27700, always_xy=True).transform(lon, lat)
        rows, cols = cell_of(east, north)
        inside = (rows >= 0) & (cols >= 0) & (rows < grid.shape[0]) & (cols < grid.shape[1])
        np.add.at(counts, (rows[inside], cols[inside]), 1)
    homes = list(cur.execute("SELECT uprn, ST_X(ST_Transform(location, 27700)), ST_Y(ST_Transform(location, 27700)) "
                             "FROM property"))
    uprns = [home[0] for home in homes]
    rows, cols = cell_of([home[1] for home in homes], [home[2] for home in homes])
    inside = (rows >= 0) & (cols >= 0) & (rows < grid.shape[0]) & (cols < grid.shape[1])
    rows, cols = np.where(inside, rows, 0), np.where(inside, cols, 0)
    seen = window_sums(valid, HOME_WINDOW, rows, cols)
    leafy = window_sums(green, HOME_WINDOW, rows, cols)
    near = window_sums(counts, HOME_WINDOW, rows, cols)
    buffer = io.StringIO()
    for uprn, ok, s, g, t in zip(uprns, inside.tolist(), seen.tolist(), leafy.tolist(), near.tolist()):
        if ok:
            share = "" if s == 0 else f"{g / s:.3f}"
            buffer.write(f"{uprn}\t{share}\t{min(t, 32767)}\t{green_source}\n")
    buffer.seek(0)
    cur.execute("DELETE FROM dwelling_nature")
    with cur.copy("COPY dwelling_nature (uprn, green_share, street_trees, source_release_id) FROM STDIN "
                  "WITH (FORMAT text, NULL '')") as copy:
        copy.write(buffer.read())
    print(f"load: {int(inside.sum())} homes", flush=True)


def load(url: str) -> None:
    import psycopg

    grid = mosaic()
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        trees = load_trees(cur, os.path.join(WORK, "trees.csv"))
        load_sites(cur)
        green_source = load_green(cur, grid)
        load_dwellings(cur, grid, trees, green_source)
        areas = cur.execute("SELECT rebuild_area_nature()").fetchone()[0]
        print(f"load: {areas} areas in area_nature", flush=True)


# --- wildlife ---------------------------------------------------------------------------------

def gbif(path: str, params: list[tuple[str, object]]) -> dict:
    return json.loads(fetch(f"{GBIF}{path}?{urllib.parse.urlencode(params)}", timeout=120))


def facet_query(lat: float, lon: float, imprecise: bool) -> dict:
    params: list[tuple[str, object]] = [
        ("geoDistance", f"{lat:.5f},{lon:.5f},{WILDLIFE_RADIUS_KM}km"),
        ("year", f"{WILDLIFE_YEARS[0]},{WILDLIFE_YEARS[1]}"), ("occurrenceStatus", "PRESENT"),
        ("limit", 0), ("facet", "speciesKey"), ("facetLimit", 2000),
        *[("license", licence) for licence in GBIF_LICENCES], *[("taxonKey", key) for key in GBIF_CLASSES]]
    if imprecise:
        params.append(("coordinateUncertaintyInMeters", f"{WILDLIFE_RADIUS_KM * 1000 + 1},100000000"))
    else:
        params.append(("facet", "datasetKey"))
    payload = gbif("/occurrence/search", params)
    facets = {facet["field"]: {c["name"]: c["count"] for c in facet["counts"]} for facet in payload.get("facets", [])}
    return {"count": payload["count"], "species": {int(k): v for k, v in facets.get("SPECIES_KEY", {}).items()},
            "datasets": facets.get("DATASET_KEY", {})}


def precise_species(everything: dict, imprecise: dict) -> dict[int, int]:
    """Species with at least one record placed within the radius (not only blurred grid records)."""
    return {key: count - imprecise["species"].get(key, 0) for key, count in everything["species"].items()
            if count > imprecise["species"].get(key, 0)}


def classify(key: int, cache: dict) -> dict:
    if str(key) not in cache:
        record = gbif(f"/species/{key}", [])
        cache[str(key)] = {"name": record.get("species") or record.get("canonicalName"),
                           **{rank: record.get(f"{rank}Key") for rank in ("class", "order", "family", "species")}}
    return cache[str(key)]


def notable_keys(cache: dict) -> dict[str, tuple[str, int]]:
    out = {}
    for label, name, rank in NOTABLE:
        if f"match:{name}" not in cache:
            match = gbif("/species/match", [("name", name), ("rank", rank), ("strict", "true")])
            cache[f"match:{name}"] = match.get("usageKey")
        if cache[f"match:{name}"]:
            out[label] = (rank.lower(), cache[f"match:{name}"])
    return out


def summarise(species: dict[int, int], taxa: dict, notables: dict[str, tuple[str, int]]) -> dict:
    groups = {group: 0 for group in GBIF_CLASSES.values()}
    named = []
    for key in species:
        taxon = taxa[str(key)]
        if taxon["name"] in NOT_WILD or taxon["class"] not in GBIF_CLASSES:
            continue
        groups[GBIF_CLASSES[taxon["class"]]] += 1
        for label, (rank, usage) in notables.items():
            if taxon.get(rank) == usage and label not in named:
                named.append(label)
    order = [label for label, _, _ in NOTABLE]
    return {**groups, "notable": sorted(named, key=order.index)}


def wildlife(url: str) -> None:
    import psycopg

    os.makedirs(WORK, exist_ok=True)
    cache_path = os.path.join(WORK, "wildlife.jsonl")
    done: dict[str, dict] = {}
    if os.path.exists(cache_path):
        with open(cache_path) as handle:
            for line in handle:
                try:
                    row = json.loads(line)
                except ValueError:
                    continue  # a line cut short by an interrupted run: fetched again
                done[row["id"]] = row
    with psycopg.connect(url) as conn:
        points = list(conn.execute(
            """SELECT id, ST_Y(ST_PointOnSurface(geometry)), ST_X(ST_PointOnSurface(geometry))
               FROM area_geography WHERE kind = 'lsoa' ORDER BY id"""))
    todo = [point for point in points if point[0] not in done]

    def one(point):
        area_id, lat, lon = point
        try:
            everything, imprecise = facet_query(lat, lon, False), facet_query(lat, lon, True)
        except urllib.error.HTTPError as error:
            print(f"wildlife: {area_id} skipped ({error.code}); a rerun fetches it", flush=True)
            return None
        time.sleep(1.0)  # GBIF rate-limits per address: one area at a time, with a pause
        return {"id": area_id, "records": everything["count"] - imprecise["count"],
                "species": precise_species(everything, imprecise), "datasets": everything["datasets"]}

    with open(cache_path, "a") as out:
        for index, row in enumerate(map(one, todo), 1):
            if row is not None:
                out.write(json.dumps(row) + "\n")
                done[row["id"]] = row
            if index % 100 == 0:
                out.flush()
                print(f"wildlife: {index}/{len(todo)} areas", flush=True)
    missing = [point[0] for point in points if point[0] not in done]
    if missing:
        raise SystemExit(f"wildlife: {len(missing)} areas not fetched (rate limit); run the stage again")

    taxa_path = os.path.join(WORK, "taxa.json")
    taxa = json.load(open(taxa_path)) if os.path.exists(taxa_path) else {}
    for key in sorted({int(k) for row in done.values() for k in row["species"]}):
        classify(key, taxa)
    notables = notable_keys(taxa)
    save(taxa_path, json.dumps(taxa).encode())
    datasets: dict[str, int] = {}
    for row in done.values():
        for key, count in row["datasets"].items():
            datasets[key] = datasets.get(key, 0) + count
    # GBIF asks reusers to cite a derived-dataset DOI built from these dataset keys and counts.
    save(os.path.join(WORK, "gbif-datasets.json"), json.dumps(datasets, indent=1).encode())

    retrieved = dt.date.today()
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        source_id = register(
            cur, f"src-gbif-wildlife-{retrieved:%Y-%m}", "https://www.gbif.org/occurrence/search",
            retrieved.isoformat(), sha256(cache_path),
            "CC0-1.0 / CC-BY-4.0 (per record)",
            f"GBIF.org ({retrieved:%d %B %Y}) occurrence search: birds, mammals and amphibians, records "
            "licensed CC0 or CC BY 4.0 only, from the datasets listed in GBIF's derived-dataset record.",
            [f"Species recorded within {WILDLIFE_RADIUS_KM} km in {WILDLIFE_YEARS[0]}-{WILDLIFE_YEARS[1]} by "
             "observers (eBird, iNaturalist, recording schemes). Records follow where people look: no "
             "record never means no animal.",
             "Records licensed for non-commercial use only are left out, so counts are lower than on "
             "GBIF or NBN Atlas."])
        cur.execute("DELETE FROM area_wildlife")
        for area_id, _, _ in points:
            row = done.get(area_id)
            if row is None:
                continue
            summary = summarise({int(k): v for k, v in row["species"].items()}, taxa, notables)
            cur.execute(
                """INSERT INTO area_wildlife (geography_id, radius_metres, first_year, last_year, records,
                     bird_species, mammal_species, amphibian_species, notable, source_release_id)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (area_id, WILDLIFE_RADIUS_KM * 1000, *WILDLIFE_YEARS, row["records"], summary["bird"],
                 summary["mammal"], summary["amphibian"], summary["notable"], source_id))
        print(f"wildlife: {len(done)} areas loaded", flush=True)


# --- map layers -------------------------------------------------------------------------------

LAYER_PERIOD = f"{WILDLIFE_YEARS[1]}-01-01"
ENOUGH_RECORDS = 200   # fewer open records within 1 km: the area is "few records" (grey), never "not seen"
BLUES = ("#eff3ff", "#bdd7e7", "#6baed6", "#3182bd", "#08519c")


def layer_id(label: str) -> str:
    return "wildlife-" + label.lower().replace(" ", "-")


def species_shares(row: dict, taxa: dict, notables: dict[str, tuple[str, int]]) -> dict[str, float] | None:
    """Each notable's share (%) of the area's precise records; None when there are too few records."""
    records = row["records"]
    if records < ENOUGH_RECORDS:
        return None
    counts = {label: 0 for label in notables}
    for key, count in row["species"].items():
        taxon = taxa.get(str(key))
        if not taxon or taxon["name"] in NOT_WILD:
            continue
        for label, (rank, usage) in notables.items():
            if taxon.get(rank) == usage:
                counts[label] += count
    return {label: round(100 * count / records, 2) for label, count in counts.items()}


BAND_WORDS = ("No record", "Rarely", "Sometimes", "Often")
BAND_LEGEND = [{"value": index, "colour": colour, "label": word}
               for index, (colour, word) in enumerate(zip((BLUES[0], BLUES[1], BLUES[3], BLUES[4]), BAND_WORDS))]


def band_thresholds(values: list[float]) -> tuple[float, float, float] | None:
    """The quartile, median and 85th percentile of a species' share where it was recorded at all."""
    seen = sorted(value for value in values if value > 0)
    if not seen:
        return None
    t1, t2, t3 = (seen[int((len(seen) - 1) * q)] for q in (0.25, 0.5, 0.85))
    return t1, max(t2, t1 + 1e-6), max(t3, t2 + 2e-6)


def band_score(share: float, thresholds: tuple[float, float, float] | None) -> float:
    """0 not recorded; 1 rarely (up to the quartile); 1-2 sometimes, 2-3 often, rising smoothly
    between the species' own thresholds, so the map shades gently rather than in hard steps."""
    if share <= 0 or thresholds is None:
        return 0.0
    t1, t2, t3 = thresholds
    if share <= t1:
        return 1.0
    if share <= t2:
        return round(1 + (share - t1) / (t2 - t1), 2)
    if share <= t3:
        return round(2 + (share - t2) / (t3 - t2), 2)
    return 3.0


def wildlife_definition(label: str) -> dict:
    return {
        "label": f"Wildlife seen: {label}", "shortLabel": "Wildlife seen",
        "description": (f"How often {label.lower()} turns up among the bird, mammal and amphibian records made within "
                        f"{WILDLIFE_RADIUS_KM} km in {WILDLIFE_YEARS[0]}-{WILDLIFE_YEARS[1]} (GBIF, records licensed "
                        "CC0 or CC BY only). Its share of all records there is ranked against the other areas where "
                        "it was recorded: Rarely up to the lowest quarter, then Sometimes and Often, so areas with "
                        f"many observers and few compare fairly. Grey: fewer than {ENOUGH_RECORDS} records, too few to say."),
        "legend": BAND_LEGEND,
        "sourceId": "gbif", "sourceName": "GBIF.org occurrence records (CC0 / CC BY)",
        "methodologyPath": "/guide/nature", "freshness": f"{WILDLIFE_YEARS[1]}",
        "caveats": [
            "Records follow where people look: 'No record' means not seen in the records, never absent.",
            "Badgers, breeding raptors and other sensitive species are never mapped.",
            "Each area reads the records within 1 km of its centre, so neighbouring areas overlap.",
        ],
    }


NATURE_DEFINITION = {
    "label": "Green & trees", "shortLabel": "Green & trees",
    "description": ("A London rank combining three things measured everywhere alike: the share of green land in "
                    "summer 2025 (Sentinel-2), street trees per hectare (GLA) and how close the nearest Local "
                    "Nature Reserve or SSSI is (Natural England). Higher is greener."),
    "legend": [{"value": v, "colour": c, "label": l} for v, c, l in
               ((0, BLUES[0], "Least green"), (50, BLUES[2], "Middle"), (100, BLUES[4], "Greenest"))],
    "sourceId": "close-knit-nature", "sourceName": "Close Knit from Sentinel-2, GLA trees and Natural England",
    "methodologyPath": "/guide/nature", "freshness": "2025",
    "caveats": ["Satellite greenness counts gardens and green roofs as well as parks; it says nothing about access.",
                "Street trees are council, TfL and Royal Parks trees only."],
}


def layers(url: str) -> None:
    import psycopg
    from psycopg.rows import dict_row

    import stage_release

    rows = {}
    with open(os.path.join(WORK, "wildlife.jsonl")) as handle:
        for line in handle:
            try:
                row = json.loads(line)
            except ValueError:
                continue
            rows[row["id"]] = row
    with open(os.path.join(WORK, "taxa.json")) as handle:
        taxa = json.load(handle)
    notables = notable_keys(taxa)
    shares = {area_id: species_shares(row, taxa, notables) for area_id, row in rows.items()}
    with psycopg.connect(url, row_factory=dict_row) as conn, conn.cursor() as cur:
        lsoas = [r["id"] for r in cur.execute("SELECT id FROM area_geography WHERE kind = 'lsoa' ORDER BY id")]
        nature = {r["geography_id"]: r["nature_percentile"] for r in cur.execute(
            "SELECT geography_id, nature_percentile FROM area_nature")}
        sources = sorted(
            {s for r in cur.execute("SELECT source_release_ids FROM area_nature") for s in r["source_release_ids"]}
            | {r["source_release_id"] for r in cur.execute("SELECT DISTINCT source_release_id FROM area_wildlife")})
        digest = hashlib.sha256(json.dumps([sources, sorted(rows)], sort_keys=True).encode()).hexdigest()
        source_id = register(
            cur, "src-nature-layers", "https://getcloseknit.com/guide", dt.date.today().isoformat(), digest,
            "OGL-3.0 / Copernicus / CC0-1.0 / CC-BY-4.0",
            "Close Knit map layers from " + ", ".join(sources) + ".",
            ["Nature: derived from the area_nature London percentiles.",
             f"Wildlife seen: a 0-3 band from each species' share of open-licence GBIF records within 1 km; "
             f"under {ENOUGH_RECORDS} records the area is left unknown."])
        metric_ids = ["nature-score", *(layer_id(label) for label in notables)]
        old = sorted({r["source_release_id"] for r in cur.execute(
            "SELECT source_release_id FROM metric_definition WHERE id = ANY(%s)", (metric_ids,))} - {source_id})
        cur.execute("DELETE FROM metric_value WHERE metric_id = ANY(%s)", (metric_ids,))
        cur.execute(
            """INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
               VALUES ('nature-score', 'lsoa', 'percentile', 'higher-is-better', %s, %s)
               ON CONFLICT (id) DO UPDATE SET definition = EXCLUDED.definition, source_release_id = EXCLUDED.source_release_id""",
            (json.dumps(NATURE_DEFINITION), source_id))
        thresholds = {label: band_thresholds([s[label] for s in shares.values() if s is not None]) for label in notables}
        for label in notables:
            cur.execute(
                """INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
                   VALUES (%s, 'lsoa', 'band', 'higher-is-more', %s, %s)
                   ON CONFLICT (id) DO UPDATE SET definition = EXCLUDED.definition, source_release_id = EXCLUDED.source_release_id""",
                (layer_id(label), json.dumps(wildlife_definition(label)), source_id))
        buffer = io.StringIO()
        for gid in lsoas:
            score = nature.get(gid)
            buffer.write(f"{gid}\tnature-score\t{LAYER_PERIOD}\t{'' if score is None else score}\t"
                         f"{'' if score is None else score}\t\t{'suppressed' if score is None else 'observed'}\t{source_id}\n")
            area = shares.get(gid)
            records = rows[gid]["records"] if gid in rows else None
            for label in notables:
                value = None if area is None else band_score(area[label], thresholds[label])
                buffer.write(f"{gid}\t{layer_id(label)}\t{LAYER_PERIOD}\t{'' if value is None else value}\t\t"
                             f"{'' if records is None else records}\t{'suppressed' if value is None else 'observed'}\t{source_id}\n")
        buffer.seek(0)
        with cur.copy("COPY metric_value (geography_id, metric_id, period, value, region_percentile, sample_count, "
                      "quality, source_release_id) FROM STDIN WITH (FORMAT text, NULL '')") as copy:
            copy.write(buffer.read())
        release = stage_release.stage(cur, "nature-layers", [source_id], replace=tuple(old))
        known = sum(1 for s in shares.values() if s is not None)
        print(f"layers: {len(metric_ids)} metrics, {known} of {len(lsoas)} LSOAs with enough records; release {release}")


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else ""
    if stage == "download":
        download()
    elif stage == "load" and len(sys.argv) == 3:
        load(sys.argv[2])
    elif stage == "sites" and len(sys.argv) == 3:
        sites(sys.argv[2])
    elif stage == "wildlife" and len(sys.argv) == 3:
        wildlife(sys.argv[2])
    elif stage == "layers" and len(sys.argv) == 3:
        layers(sys.argv[2])
    else:
        sys.exit(__doc__)
