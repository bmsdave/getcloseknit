"""Flood risk area metrics for England (Environment Agency NaFRA2), outside the London per-home build.

London keeps its vector build (area_analytics.flood_risk: WMS GeoJSON tiles into flood_zone, then
rebuild_flood/rebuild_flood_risk over `property`). England has no per-home rows and the EA's
national NaFRA2 files are only handed out through a support ticket ("Request a Large Dataset"), so
this reads the same two WMS layers as images, at the same 1 m per pixel as London's vectors, and
keeps only area aggregates:

  tiles     8 km x 8 km PNG tiles (8,000 px, 1 m pixels) of both layers over every tile that touches
            an English LSOA, drawn with our own SLD (one flat colour per band, no outline, no
            anti-aliasing), so a pixel's colour is its band. Each tile is reduced at once to
            per-LSOA land and band areas (open water from OpenStreetMap left out, as in London) and
            the bands at the EPC homes inside it (england_homes.py), saved as a small .npz;
            the PNGs are never written to disk. Resumable: done tiles are skipped.
  load      sums the tiles into `area_flood` rows for every non-London LSOA, MSOA and LAD and the
            `flood-risk` metric (share of homes in a medium or high band, LSOAs with 10+ homes,
            ranked within the region), as source release `src-ea-nafra2-flood-england-<digest>`.
            London's rows (the vector build) are left as they are.
  compare   prints London LSOAs' areas from the tiles against the London vector build in area_flood.

  python3 england_flood.py water                      # OSM water polygons (needs osmium + an England .pbf)
  python3 england_flood.py tiles <database-url> [workers]
  python3 england_flood.py compare <database-url>
  python3 england_flood.py load <database-url>

A 4 km tile at 1 m drawn this way matches London's vector areas to the square metre (checked on
tiles 528000,176000 and 520000,196000). Needs numpy, shapely, pyproj, pillow and psycopg.
"""
from __future__ import annotations

import glob
import hashlib
import io
import os
import pickle
import subprocess
import sys
import time
import urllib.parse
import urllib.request

import numpy as np

import area_coverage as coverage
import england_homes

WORK = os.path.join(england_homes.WORK, "flood")
TILES = os.path.join(WORK, "tiles")
TILE = 8_000  # metres
PIXELS = 8_000  # 1 m per pixel, the resolution of London's vector build
OSM_PBF = os.environ.get("AE_ENGLAND_PBF", os.path.join(england_homes.ENGLAND, "places", "osm", "england-261020.osm.pbf"))
WATER_TAGS = ("wr/natural=water", "wr/waterway=riverbank", "wr/landuse=reservoir")  # as flood_risk.py
ETL_VERSION = "close-knit-flood-england-1"
RELEASE_PREFIX = "src-ea-nafra2-flood-england-"
RELEASE_DATE = "2026-07-06"  # the NaFRA2 layer date London's build used: the same metric period
MIN_HOMES = 10  # as rebuild_flood_risk

WMS = "https://environment.data.gov.uk/geoservices/datasets/{dataset}/wms"
SOURCES = {  # id -> (dataset, layer), as area_analytics.flood_risk.SOURCES
    "rivers-sea": ("96ab4342-82c1-4095-87f1-0082e8d84ef1", "rofrs_4band"),
    "surface-water": ("b5aaa28d-6eb9-460e-8d6f-43caa71fbe0e", "rofsw"),
}
# Our SLD paints each mapped band in its own grey level: the red channel is the band (1-3).
BAND_FILL = {"Low": 1, "Medium": 2, "High": 3}


def sld(layer: str) -> str:
    rules = "".join(
        "<Rule><ogc:Filter><ogc:PropertyIsEqualTo><ogc:PropertyName>risk_band</ogc:PropertyName>"
        f"<ogc:Literal>{band}</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter><PolygonSymbolizer><Fill>"
        f"<CssParameter name=\"fill\">#{level:02x}{level:02x}{level:02x}</CssParameter></Fill>"
        "</PolygonSymbolizer></Rule>"
        for band, level in BAND_FILL.items())
    return ('<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld" '
            f'xmlns:ogc="http://www.opengis.net/ogc"><NamedLayer><Name>{layer}</Name><UserStyle>'
            f"<FeatureTypeStyle>{rules}</FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>")


def tile_url(source: str, east: int, north: int) -> str:
    dataset, layer = SOURCES[source]
    query = urllib.parse.urlencode({
        "SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetMap", "CRS": "EPSG:27700", "LAYERS": layer,
        "BBOX": f"{east},{north},{east + TILE},{north + TILE}", "WIDTH": PIXELS, "HEIGHT": PIXELS,
        "FORMAT": "image/png", "TRANSPARENT": "true", "format_options": "antialias:none", "SLD_BODY": sld(layer)})
    return WMS.format(dataset=dataset) + "?" + query


def band_raster(png: bytes) -> np.ndarray:
    """uint8 PIXELS x PIXELS: 0 = not mapped (very low), 1 low, 2 medium, 3 high."""
    from PIL import Image

    grey = np.asarray(Image.open(io.BytesIO(png)).convert("LA"))  # our fills are greys 1-3
    if grey.shape[:2] != (PIXELS, PIXELS):
        raise ValueError(f"unexpected tile size {grey.shape}")
    bands = np.where(grey[..., 1] > 0, grey[..., 0], 0).astype(np.uint8)
    if bands.max(initial=0) > 3:
        raise ValueError("unexpected colour in tile: the SLD was not applied")
    return bands


# The EA's gateway answers 403 to bursts (it blocked ~8 requests a second for a few minutes):
# each worker starts at most one request every MIN_INTERVAL seconds and backs off on errors.
MIN_INTERVAL = float(os.environ.get("AE_FLOOD_MIN_INTERVAL", "3.5"))
_last_request = [0.0]


def fetch(source: str, east: int, north: int) -> np.ndarray:
    for attempt in range(6):
        wait = _last_request[0] + MIN_INTERVAL - time.time()
        if wait > 0:
            time.sleep(wait)
        _last_request[0] = time.time()
        try:
            with urllib.request.urlopen(tile_url(source, east, north), timeout=600) as response:
                body = response.read()
            return band_raster(body)
        except (OSError, ValueError) as error:
            if attempt == 5:
                raise
            print(f"retry {source} {east},{north}: {error}", flush=True)
            time.sleep(120 if "403" in str(error) else 10 * (attempt + 1))
    raise AssertionError


# --- inputs ------------------------------------------------------------------------------------

def water() -> None:
    """OSM water polygons (British National Grid WKB) for England, as flood_risk.water() does for London."""
    import shapely
    from pyproj import Transformer

    os.makedirs(WORK, exist_ok=True)
    filtered = os.path.join(WORK, "water.osm.pbf")
    exported = os.path.join(WORK, "water.pg")
    subprocess.run(["osmium", "tags-filter", OSM_PBF, *WATER_TAGS, "-O", "-o", filtered], check=True)
    subprocess.run(["osmium", "export", filtered, "-f", "pg", "--geometry-types=polygon", "-O", "-o", exported],
                   check=True)
    with open(exported) as handle:
        geoms = shapely.from_wkb([line.split("\t", 1)[0].strip() for line in handle if line.strip()])
    to_bng = Transformer.from_crs(4326, 27700, always_xy=True)
    geoms = shapely.transform(geoms, lambda xy: np.column_stack(to_bng.transform(xy[:, 0], xy[:, 1])))
    geoms = shapely.make_valid(geoms)
    with open(os.path.join(WORK, "water.wkb.pickle"), "wb") as handle:
        pickle.dump(shapely.to_wkb(geoms), handle)
    os.remove(exported)
    print(f"water: {len(geoms)} polygons", flush=True)


def lsoa_inputs(url: str) -> str:
    """Cache the English LSOAs (codes, BNG WKB) for the tile workers."""
    import shapely

    path = os.path.join(WORK, "lsoa.wkb.pickle")
    if not os.path.exists(path):
        codes, geoms = england_homes.lsoa_polygons(url)
        with open(path, "wb") as handle:
            pickle.dump((codes, shapely.to_wkb(geoms)), handle)
    return path


def tile_grid(geoms) -> list[tuple[int, int]]:
    """8 km tiles (south-west corners) that touch an English LSOA."""
    import shapely

    x0, y0, x1, y1 = coverage.ENGLAND.bbox_bng
    x0, y0 = int(x0 // TILE * TILE), int(y0 // TILE * TILE)
    corners = [(e, n) for e in range(x0, int(x1), TILE) for n in range(y0, int(y1), TILE)]
    boxes = shapely.box([e for e, _ in corners], [n for _, n in corners],
                        [e + TILE for e, _ in corners], [n + TILE for _, n in corners])
    hit, _ = shapely.STRtree(geoms).query(boxes, predicate="intersects")
    return [corners[i] for i in np.unique(hit)]


def tile_path(east: int, north: int) -> str:
    return os.path.join(TILES, f"{east}-{north}.npz")


# --- per-tile work (in worker processes) --------------------------------------------------------

_W: dict = {}


def _init(lsoa_path: str, water_path: str) -> None:
    import shapely

    with open(lsoa_path, "rb") as handle:
        codes, wkb = pickle.load(handle)
    geoms = shapely.from_wkb(wkb)
    with open(water_path, "rb") as handle:
        water_geoms = shapely.from_wkb(pickle.load(handle))
    _W.update(lsoa=geoms, lsoa_area=shapely.area(geoms), lsoa_tree=shapely.STRtree(geoms),
              water=water_geoms, water_tree=shapely.STRtree(water_geoms))


def _draw(draw, geom, east: int, north: int, fill: int) -> None:
    """Draw a (multi)polygon in tile pixels: exterior filled, holes cleared."""
    import shapely

    for part in shapely.get_parts(geom):
        if part.geom_type != "Polygon" or part.is_empty:
            continue
        rings = [part.exterior, *part.interiors]
        for number, ring in enumerate(rings):
            xy = np.asarray(ring.coords)
            pts = list(zip((xy[:, 0] - east).tolist(), (north + TILE - xy[:, 1]).tolist()))
            if len(pts) >= 3:
                draw.polygon(pts, fill=fill if number == 0 else 0)


def labels(east: int, north: int) -> tuple[np.ndarray, np.ndarray]:
    """(LSOA index + 1 per pixel, 0 outside England; water mask) for one tile."""
    import shapely
    from PIL import Image, ImageDraw

    clip = shapely.box(east, north, east + TILE, north + TILE)
    hits = _W["lsoa_tree"].query(clip, predicate="intersects")
    image = Image.new("I", (PIXELS, PIXELS), 0)
    draw = ImageDraw.Draw(image)
    # Largest first, so an LSOA inside another's hole is drawn after it.
    for index in sorted(hits.tolist(), key=lambda i: -_W["lsoa_area"][i]):
        _draw(draw, shapely.intersection(_W["lsoa"][index], clip), east, north, index + 1)
    mask = Image.new("L", (PIXELS, PIXELS), 0)
    mask_draw = ImageDraw.Draw(mask)
    for index in _W["water_tree"].query(clip, predicate="intersects").tolist():
        _draw(mask_draw, shapely.intersection(_W["water"][index], clip), east, north, 1)
    return np.asarray(image, dtype=np.int32), np.asarray(mask, dtype=bool)


def reduce_tile(east: int, north: int, label: np.ndarray, water_mask: np.ndarray,
                rasters: dict[str, np.ndarray], home_idx: np.ndarray, home_e: np.ndarray, home_n: np.ndarray) -> dict:
    """Per-LSOA land and band areas (m2) and each home's band codes for one tile."""
    land_label = np.where(water_mask, 0, label).ravel()  # 0 = water or outside England
    size = int(land_label.max(initial=0)) + 1
    land = np.bincount(land_label, minlength=size)
    ids = np.nonzero(land[1:])[0] + 1
    out = {"lsoa": (ids - 1).astype(np.int32), "land": land[ids].astype(np.int64)}
    cols = np.clip(np.floor(home_e - east).astype(np.int64), 0, PIXELS - 1)
    rows = np.clip(np.floor(north + TILE - home_n).astype(np.int64), 0, PIXELS - 1)
    out["home"] = home_idx.astype(np.int64)
    for source, bands in rasters.items():
        key = source.replace("-", "_")
        flat = bands.ravel()
        for level, name in ((1, "low"), (2, "medium"), (3, "high")):
            out[f"{key}_{name}"] = np.bincount(land_label[flat == level], minlength=size)[ids].astype(np.int64)
        out[f"{key}_home"] = (bands[rows, cols] + 1).astype(np.int8)  # 1 very low .. 4 high
    return out


def work_tile(job) -> tuple[int, int, str | None]:
    east, north, home_idx, home_e, home_n = job
    try:
        rasters = {source: fetch(source, east, north) for source in SOURCES}
        label, water_mask = labels(east, north)
        result = reduce_tile(east, north, label, water_mask, rasters, home_idx, home_e, home_n)
        tmp = tile_path(east, north) + ".tmp.npz"
        np.savez(tmp, **result)
        os.replace(tmp, tile_path(east, north))
        return east, north, None
    except Exception as error:  # noqa: BLE001 - logged, the tile is retried on the next run
        return east, north, repr(error)


def tiles(url: str, workers: int = 6) -> None:
    import shapely
    from concurrent.futures import ProcessPoolExecutor

    os.makedirs(TILES, exist_ok=True)
    lsoa_path = lsoa_inputs(url)
    with open(lsoa_path, "rb") as handle:
        _, wkb = pickle.load(handle)
    grid = tile_grid(shapely.from_wkb(wkb))
    todo = [(e, n) for e, n in grid if not os.path.exists(tile_path(e, n))]
    print(f"tiles: {len(grid)} tiles touch England, {len(todo)} to do", flush=True)
    homes = england_homes.load()
    key = (np.floor(homes["east"] / TILE).astype(np.int64) * 1_000 + np.floor(homes["north"] / TILE).astype(np.int64))
    order = np.argsort(key, kind="stable")
    sorted_key = key[order]

    def jobs():
        for east, north in todo:
            k = (east // TILE) * 1_000 + north // TILE
            lo, hi = np.searchsorted(sorted_key, [k, k + 1])
            idx = order[lo:hi]
            yield east, north, idx, homes["east"][idx], homes["north"][idx]

    done = failed = 0
    started = time.time()
    with ProcessPoolExecutor(max_workers=workers, initializer=_init,
                             initargs=(lsoa_path, os.path.join(WORK, "water.wkb.pickle"))) as pool:
        for east, north, error in pool.map(work_tile, jobs(), chunksize=1):
            done += 1
            if error:
                failed += 1
                print(f"tiles: FAILED {east},{north}: {error}", flush=True)
            if done % 100 == 0 or done == len(todo):
                rate = done / max(time.time() - started, 1)
                print(f"tiles: {done}/{len(todo)} ({failed} failed), {rate * 60:.0f}/min", flush=True)


# --- aggregation and load ----------------------------------------------------------------------

def aggregate() -> tuple[list[str], dict[str, np.ndarray], np.ndarray, np.ndarray, str]:
    """Sum every tile: (LSOA codes, {column: per-LSOA m2}, home rivers-sea band, home surface-water band,
    digest of the tiles)."""
    with open(os.path.join(WORK, "lsoa.wkb.pickle"), "rb") as handle:
        codes, _ = pickle.load(handle)
    homes = np.load(england_homes.HOMES)
    if list(homes["codes"]) != list(codes):
        raise SystemExit("homes file and LSOA cache disagree: rebuild one of them")
    columns = ("land", "rivers_sea_low", "rivers_sea_medium", "rivers_sea_high",
               "surface_water_low", "surface_water_medium", "surface_water_high")
    sums = {c: np.zeros(len(codes), dtype=np.int64) for c in columns}
    rs = np.ones(len(homes["uprn"]), dtype=np.int8)
    sw = np.ones(len(homes["uprn"]), dtype=np.int8)
    digest = hashlib.sha256()
    for path in sorted(glob.glob(os.path.join(TILES, "*.npz"))):
        with open(path, "rb") as handle:
            digest.update(handle.read())
        tile = np.load(path)
        for c in columns:
            np.add.at(sums[c], tile["lsoa"], tile[c])
        rs[tile["home"]] = tile["rivers_sea_home"]
        sw[tile["home"]] = tile["surface_water_home"]
    return list(codes), sums, rs, sw, digest.hexdigest()


def lsoa_frames():
    codes, sums, rs, sw, digest = aggregate()
    homes = np.load(england_homes.HOMES)
    lsoa = homes["lsoa"]
    at_risk = (np.maximum(rs, sw) >= 3)
    home_count = np.bincount(lsoa, minlength=len(codes))
    risk_count = np.bincount(lsoa, weights=at_risk, minlength=len(codes))
    return codes, sums, home_count, risk_count, digest


ATTRIBUTION = (
    "Environment Agency, Risk of Flooding from Rivers and Sea and Risk of Flooding from Surface Water "
    "(NaFRA2). Contains public sector information licensed under the Open Government Licence v3.0. "
    "© Environment Agency copyright and/or database right. Open water: © OpenStreetMap contributors (ODbL). "
    "Homes: OS Open UPRN (OGL v3) at UPRNs in the domestic EPC register (OGL v3).")
CAVEATS = [
    "Bands are modelled chances of flooding in a year, not a record of past floods.",
    "Area figures describe the land in the area, not each building in it.",
    "Read from the Environment Agency's map service at 1 m per pixel, the same grid as the London figures.",
    "Homes are the addresses in the domestic EPC register, read at their OS Open UPRN point; no single home is shown.",
    "Places outside every mapped band count as very low. Groundwater and sewer flooding are not included.",
    "Rivers, lakes and reservoirs (OpenStreetMap) are left out of an area's land.",
]


def compare(url: str) -> None:
    """London LSOAs: tile areas against the London vector build (area_flood)."""
    import psycopg

    codes, sums, *_ = aggregate()
    index = {code: i for i, code in enumerate(codes)}
    with psycopg.connect(url) as conn:
        rows = conn.execute(
            """SELECT g.official_code, f.source, f.area_m2, f.low_m2, f.medium_m2, f.high_m2
               FROM area_flood f JOIN area_geography g ON g.id = f.geography_id AND g.kind = 'lsoa'
               WHERE f.source_release_id NOT LIKE %s""", (RELEASE_PREFIX + "%",)).fetchall()
    land, shares = [], {}
    for code, source, area, low, medium, high in rows:
        i = index.get(code)
        if i is None or sums["land"][i] <= 0:
            continue
        key = source.replace("-", "_")
        land.append(abs(sums["land"][i] - area) / area * 100)
        for name, old in (("low", low), ("medium", medium), ("high", high)):
            new_share = sums[f"{key}_{name}"][i] / sums["land"][i] * 100
            shares.setdefault(f"{source} {name}", []).append(abs(new_share - old / area * 100))
    land = np.array(land)
    print(f"compare: {len(land)} London LSOA rows; land differs by median {np.median(land):.3f}% "
          f"(p99 {np.percentile(land, 99):.2f}%, max {land.max():.2f}%)")
    for name, values in shares.items():
        values = np.array(values)
        print(f"compare {name}: share of land differs by median {np.median(values):.3f} pp, "
              f"p99 {np.percentile(values, 99):.3f} pp, max {values.max():.2f} pp")


def load(url: str) -> None:
    import psycopg

    codes, sums, home_count, risk_count, digest = lsoa_frames()
    release_id = RELEASE_PREFIX + digest[:12]
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
                 attribution, transformation_version, geography_vintage, validation_status, caveats)
               VALUES (%s, 'https://environment.data.gov.uk/dataset/96ab4342-82c1-4095-87f1-0082e8d84ef1',
                 now(), %s, %s, 'OGL-3.0', %s, %s, '2021', 'passed', %s)
               ON CONFLICT (id) DO NOTHING""",
            (release_id, RELEASE_DATE, digest, ATTRIBUTION, ETL_VERSION, CAVEATS))
        cur.execute("""CREATE TEMP TABLE flood_england (code text, land float8, rs_low float8, rs_medium float8,
                       rs_high float8, sw_low float8, sw_medium float8, sw_high float8, homes int, at_risk int)
                       ON COMMIT DROP""")
        with cur.copy("COPY flood_england FROM STDIN") as copy:
            for i, code in enumerate(codes):
                copy.write_row((code, *(int(sums[c][i]) for c in (
                    "land", "rivers_sea_low", "rivers_sea_medium", "rivers_sea_high",
                    "surface_water_low", "surface_water_medium", "surface_water_high")),
                    int(home_count[i]), int(risk_count[i])))
        cur.execute(DEFINITION_SQL, (release_id,))
        cur.execute(DELETE_AREAS_SQL)
        cur.execute(DELETE_METRIC_SQL)
        areas = cur.execute(LOAD_AREAS_SQL, {"release": release_id}).rowcount
        metric = cur.execute(LOAD_METRIC_SQL, {"release": release_id, "min_homes": MIN_HOMES}).rowcount
        print(f"load: {release_id}: {areas} area_flood rows, {metric} flood-risk rows outside London", flush=True)


# Non-London areas only: London keeps the vector build. MSOAs and LADs are sums of their LSOAs.
DELETE_AREAS_SQL = """DELETE FROM area_flood f USING area_region r
WHERE r.area_id = f.geography_id AND r.region_code <> 'E12000007'"""
LOAD_AREAS_SQL = """
INSERT INTO area_flood (geography_id, source, area_m2, low_m2, medium_m2, high_m2, source_release_id)
WITH lsoa AS (
    SELECT l.id, l.parent_id AS msoa, m.parent_id AS borough, e.*
    FROM flood_england e
    JOIN area_geography l ON l.kind = 'lsoa' AND l.official_code = e.code
    JOIN area_geography m ON m.id = l.parent_id
    JOIN area_region r ON r.area_id = l.id AND r.region_code <> 'E12000007'
    WHERE e.land > 0
), per_source AS (
    SELECT id, msoa, borough, 'rivers-sea' AS source, land, rs_low AS low, rs_medium AS medium, rs_high AS high FROM lsoa
    UNION ALL
    SELECT id, msoa, borough, 'surface-water', land, sw_low, sw_medium, sw_high FROM lsoa
), levels AS (
    SELECT id AS geography_id, source, land, low, medium, high FROM per_source
    UNION ALL SELECT msoa, source, land, low, medium, high FROM per_source
    UNION ALL SELECT borough, source, land, low, medium, high FROM per_source
)
SELECT geography_id, source, sum(land), sum(low), sum(medium), sum(high), %(release)s
FROM levels GROUP BY geography_id, source
"""

DELETE_METRIC_SQL = """DELETE FROM metric_value v USING area_region r
WHERE v.metric_id = 'flood-risk' AND r.area_id = v.geography_id AND r.region_code <> 'E12000007'"""
LOAD_METRIC_SQL = """
INSERT INTO metric_value (geography_id, metric_id, period, value, region_percentile, sample_count, quality,
    source_release_id)
WITH shares AS (
    SELECT l.id, e.homes,
           CASE WHEN e.homes >= %(min_homes)s THEN round((100.0 * e.at_risk / e.homes)::numeric, 1)::float8 END AS share
    FROM flood_england e
    JOIN area_geography l ON l.kind = 'lsoa' AND l.official_code = e.code
    JOIN area_region r ON r.area_id = l.id AND r.region_code <> 'E12000007'
), ranked AS (
    SELECT id, round(100 * percent_rank() OVER (PARTITION BY area_rank_region(id) ORDER BY share))::smallint AS pct
    FROM shares WHERE share IS NOT NULL
)
SELECT s.id, 'flood-risk', date_trunc('month', %(release_date)s::date)::date, s.share, r.pct, s.homes,
       CASE WHEN s.share IS NULL THEN 'suppressed' ELSE 'observed' END::metric_quality, %(release)s
FROM shares s LEFT JOIN ranked r ON r.id = s.id
""".replace("%(release_date)s", f"'{RELEASE_DATE}'")

# The definition rebuild_flood_risk (migration 103) writes, seeded only when it is missing (an ETL
# database without London's per-home build). Production keeps its own.
DEFINITION_SQL = """
INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
VALUES ('flood-risk', 'lsoa', '%%', 'higher-is-more', jsonb_build_object(
    'label', 'Homes at flood risk', 'shortLabel', 'Flood risk',
    'description', 'Share of the area''s homes in a medium or high flood-risk band (a 1%% chance a year or more) '
        || 'from rivers and the sea or from surface water, read at each home''s point (Environment Agency NaFRA2, 2026).',
    'legend', '[{"value": 0, "colour": "#3a7d44", "label": "0%%"},
                {"value": 5, "colour": "#7ba05b", "label": "5%%"},
                {"value": 15, "colour": "#f4d35e", "label": "15%%"},
                {"value": 30, "colour": "#c96a3b", "label": "30%%"},
                {"value": 50, "colour": "#b23a48", "label": "50%%+"}]'::jsonb,
    'sourceId', 'ea-nafra2', 'sourceName', 'Environment Agency National Flood Risk Assessment (NaFRA2)',
    'methodologyPath', '/guide/flood', 'freshness', '2026-07',
    'caveats', jsonb_build_array(
        'Modelled chance of flooding each year, not a record of past floods.',
        'Medium is 1%% to 3.3%% a year, high more than 3.3%%; the higher of the rivers-and-sea and surface-water bands counts.',
        'Areas with fewer than 10 homes with a point show no share.',
        'Contains public sector information licensed under the Open Government Licence v3.0. '
            || '© Environment Agency copyright and/or database right.')),
    %s)
ON CONFLICT (id) DO NOTHING"""


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else ""
    if stage == "water":
        water()
    elif stage == "tiles" and len(sys.argv) in (3, 4):
        tiles(sys.argv[2], int(sys.argv[3]) if len(sys.argv) == 4 else 6)
    elif stage == "compare" and len(sys.argv) == 3:
        compare(sys.argv[2])
    elif stage == "load" and len(sys.argv) == 3:
        load(sys.argv[2])
    else:
        sys.exit(__doc__)
