"""Road and rail noise area metrics for England (Defra strategic noise mapping, Round 4, 2022).

London keeps its per-home build (etl_noise.py: dwelling_noise at every `property` point, then
rebuild_area_noise). England has no per-home rows, so this reads the same two Defra WCS rasters
(10 m cells, levels under 40 dB Lden not mapped) in 20 km tiles, samples them at the EPC homes
(england_homes.py) exactly as etl_noise.Raster.sample does, keeps only each home's two levels in a
small per-tile .npz (the GeoTIFFs are never written to disk), and loads area aggregates:

  tiles     resumable; done tiles are skipped
  load      `area_noise` rows for every non-London LSOA, MSOA and LAD (same columns and rules as
            rebuild_area_noise, migration 093; aircraft not mapped: air_55_share stays NULL) and the
            `noise` map layer's rows for non-London LSOAs (etl_noise_layer.py rules, ranked within the
            region), as source releases `src-defra-noise-round4-2022-england` and
            `src-defra-noise-layer-england-<digest>`. London's rows are left as they are.

  python3 england_noise.py tiles [workers]
  python3 england_noise.py load <database-url>

Needs numpy, tifffile, imagecodecs and psycopg.
"""
from __future__ import annotations

import glob
import hashlib
import io
import json
import os
import sys
import time
import urllib.request

import numpy as np

import area_coverage as coverage
import england_homes
import etl_noise
import etl_noise_layer

WORK = os.path.join(england_homes.WORK, "noise")
TILES = os.path.join(WORK, "tiles")
TILE = 20_000  # metres: 2,000 x 2,000 cells of 10 m
CELL = etl_noise.CELL
SOURCES = etl_noise.SOURCES  # road and rail WCS coverages
RELEASE_ID = "src-defra-noise-round4-2022-england"
LAYER_PREFIX = "src-defra-noise-layer-england-"
MIN_INTERVAL = float(os.environ.get("AE_NOISE_MIN_INTERVAL", "4"))
_last_request = [0.0]


def tile_url(source: str, east: int, north: int) -> str:
    service, coverage_id = SOURCES[source]
    return (f"{service}?service=WCS&version=2.0.1&request=GetCoverage&coverageId={coverage_id}"
            f"&format=image/tiff&subset=E({east},{east + TILE})&subset=N({north},{north + TILE})")


def fetch(source: str, east: int, north: int) -> tuple[np.ndarray, float, float]:
    """(levels, west edge, north edge) of one tile. At the edge of England the WCS answers only the part
    inside its coverage, so the GeoTIFF's own tie point places the grid."""
    import tifffile

    for attempt in range(6):
        wait = _last_request[0] + MIN_INTERVAL - time.time()
        if wait > 0:
            time.sleep(wait)
        _last_request[0] = time.time()
        try:
            with urllib.request.urlopen(tile_url(source, east, north), timeout=900) as response:
                body = response.read()
            if not body.startswith((b"MM", b"II")):
                raise ValueError(f"not a TIFF: {body[:80]!r}")
            with tifffile.TiffFile(io.BytesIO(body)) as tif:
                page = tif.pages[0]
                data = page.asarray().astype(np.float32)
                # GeoServer writes ModelTransformationTag (34264) mapping a pixel index to its cell centre,
                # e.g. (10, 0, 0, 530005, 0, -10, 0, 189995, ...) for the tile 530000-540000 x 180000-190000.
                matrix = page.tags[34264].value
            if abs(matrix[0] - CELL) > 1e-6 or abs(matrix[5] + CELL) > 1e-6:
                raise ValueError(f"cell size {matrix[0]}, {matrix[5]}")
            west, top = matrix[3] - CELL / 2, matrix[7] + CELL / 2
            if west % CELL or top % CELL:
                raise ValueError(f"grid not on 10 m lines: {west}, {top}")
            return data, west, top
        except (OSError, ValueError, KeyError) as error:
            if attempt == 5:
                raise
            print(f"retry {source} {east},{north}: {error}", flush=True)
            time.sleep(120 if "403" in str(error) else 10 * (attempt + 1))
    raise AssertionError


def sample(data: np.ndarray, west: float, top: float, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    """dB x 10 (int16) at each point; 0 where not mapped. Same cell and threshold rules as
    etl_noise.Raster.sample (row 0 is the northern edge; under 40 dB or nodata is not mapped);
    points off the grid are not mapped."""
    cols = np.floor((xs - west) / CELL).astype(np.int64)
    rows = np.floor((top - ys) / CELL).astype(np.int64)
    inside = (cols >= 0) & (cols < data.shape[1]) & (rows >= 0) & (rows < data.shape[0])
    values = np.full(len(xs), np.nan)
    values[inside] = data[rows[inside], cols[inside]]
    mapped = (values > etl_noise.NODATA + 1) & (values >= 40)
    return np.where(mapped, np.round(np.nan_to_num(values) * 10), 0).astype(np.int16)


def tile_path(east: int, north: int) -> str:
    return os.path.join(TILES, f"{east}-{north}.npz")


def work_tile(job) -> tuple[int, int, str | None]:
    east, north, idx, xs, ys = job
    try:
        out = {"home": idx.astype(np.int64)}
        for source in SOURCES:
            out[source] = sample(*fetch(source, east, north), xs, ys)
        tmp = tile_path(east, north) + ".tmp.npz"
        np.savez(tmp, **out)
        os.replace(tmp, tile_path(east, north))
        return east, north, None
    except Exception as error:  # noqa: BLE001 - logged, retried on the next run
        return east, north, repr(error)


def tiles(workers: int = 2) -> None:
    from concurrent.futures import ProcessPoolExecutor

    os.makedirs(TILES, exist_ok=True)
    homes = england_homes.load()
    key = np.floor(homes["east"] / TILE).astype(np.int64) * 1_000 + np.floor(homes["north"] / TILE).astype(np.int64)
    order = np.argsort(key, kind="stable")
    sorted_key = key[order]
    present = np.unique(sorted_key)  # only tiles with homes in them
    todo = [(int(k // 1_000) * TILE, int(k % 1_000) * TILE) for k in present]
    todo = [(e, n) for e, n in todo if not os.path.exists(tile_path(e, n))]
    print(f"tiles: {len(present)} tiles hold homes, {len(todo)} to do", flush=True)

    def jobs():
        for east, north in todo:
            k = (east // TILE) * 1_000 + north // TILE
            lo, hi = np.searchsorted(sorted_key, [k, k + 1])
            idx = order[lo:hi]
            yield east, north, idx, homes["east"][idx], homes["north"][idx]

    done = failed = 0
    started = time.time()
    with ProcessPoolExecutor(max_workers=workers) as pool:
        for east, north, error in pool.map(work_tile, jobs()):
            done += 1
            if error:
                failed += 1
                print(f"tiles: FAILED {east},{north}: {error}", flush=True)
            if done % 20 == 0 or done == len(todo):
                print(f"tiles: {done}/{len(todo)} ({failed} failed), {done / max(time.time() - started, 1) * 60:.1f}/min",
                      flush=True)


# --- aggregation ---------------------------------------------------------------------------------

def home_levels() -> tuple[dict, np.ndarray, np.ndarray, str]:
    """(homes file arrays, road dB, rail dB (NaN where not mapped), digest of the tiles)."""
    homes = np.load(england_homes.HOMES)
    road = np.full(len(homes["uprn"]), np.nan)
    rail = np.full(len(homes["uprn"]), np.nan)
    seen = np.zeros(len(homes["uprn"]), dtype=bool)
    digest = hashlib.sha256()
    for path in sorted(glob.glob(os.path.join(TILES, "*.npz"))):
        with open(path, "rb") as handle:
            digest.update(handle.read())
        tile = np.load(path)
        idx = tile["home"]
        road[idx] = np.where(tile["road"] > 0, tile["road"] / 10.0, np.nan)
        rail[idx] = np.where(tile["rail"] > 0, tile["rail"] / 10.0, np.nan)
        seen[idx] = True
    if not seen.all():
        raise SystemExit(f"{(~seen).sum()} homes have no tile yet: run tiles again")
    return homes, road, rail, digest.hexdigest()


def area_rows(codes, lsoa: np.ndarray, road: np.ndarray, rail: np.ndarray) -> dict[str, tuple]:
    """{official code: (dwellings, road_55, rail_55, any_55, any_65, road median, road mapped share)}
    for every LSOA, MSOA and LAD with homes, as rebuild_area_noise (093) computes them."""
    lookup = coverage.lsoa_lookup()
    road0, rail0 = np.nan_to_num(road), np.nan_to_num(rail)
    loudest = np.maximum(road0, rail0)
    flags = np.column_stack([road0 >= 55, rail0 >= 55, loudest >= 55, loudest >= 65, ~np.isnan(road)])
    groups: dict[str, list[np.ndarray]] = {}
    order = np.argsort(lsoa, kind="stable")
    bounds = np.searchsorted(lsoa[order], np.arange(len(codes) + 1))
    for i, code in enumerate(codes):
        members = order[bounds[i]:bounds[i + 1]]
        if not len(members):
            continue
        msoa, lad = lookup[code]
        for key in (code, msoa, lad):
            groups.setdefault(key, []).append(members)
    out = {}
    for key, parts in groups.items():
        members = np.concatenate(parts)
        f = flags[members].mean(axis=0)
        mapped_road = road[members][~np.isnan(road[members])]
        median = float(np.percentile(mapped_road, 50)) if f[4] >= 0.5 and len(mapped_road) else None
        out[key] = (len(members), *(round(float(v), 3) for v in f[:4]), median, round(float(f[4]), 3))
    return out


CAVEATS = [
    "Modelled annual averages at 4 m above ground on a 10 m grid, not measurements.",
    "Levels under 40 dB Lden are not mapped; aircraft noise is not included outside London.",
    "Homes are the addresses in the domestic EPC register, read at their OS Open UPRN point; no single home is shown.",
]
ATTRIBUTION = ("Defra strategic noise mapping Round 4 (2022), road and rail. Contains public sector information "
               "licensed under the Open Government Licence v3.0. Homes: OS Open UPRN and the domestic EPC register (OGL v3).")


def load(url: str) -> None:
    import psycopg

    homes, road, rail, digest = home_levels()
    codes = list(homes["codes"])
    rows = area_rows(codes, homes["lsoa"], road, rail)
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
                 attribution, transformation_version, geography_vintage, validation_status, caveats)
               VALUES (%s, 'https://environment.data.gov.uk/dataset/562c9d56-7c2d-4d42-83bb-578d6e97a517',
                 now(), '2022-12-31', %s, 'OGL-3.0', %s, 'close-knit-noise-england-1', '2021', 'passed', %s)
               ON CONFLICT (id) DO UPDATE SET sha256 = EXCLUDED.sha256, retrieved_at = now()""",
            (RELEASE_ID, digest, ATTRIBUTION, CAVEATS))
        cur.execute("""CREATE TEMP TABLE noise_england (code text, dwellings int, road_55 real, rail_55 real,
                       any_55 real, any_65 real, road_median real, road_mapped real) ON COMMIT DROP""")
        with cur.copy("COPY noise_england FROM STDIN") as copy:
            for code, values in rows.items():
                copy.write_row((code, *values))
        cur.execute("""DELETE FROM area_noise n USING area_region r
                       WHERE r.area_id = n.geography_id AND r.region_code <> 'E12000007'""")
        areas = cur.execute(
            """INSERT INTO area_noise (geography_id, dwellings, road_55_share, rail_55_share, air_55_share,
                 any_55_share, any_65_share, road_lden_median, road_lden_mapped_share, source_release_id)
               SELECT g.id, e.dwellings, e.road_55, e.rail_55, NULL, e.any_55, e.any_65, e.road_median,
                      e.road_mapped, %s
               FROM noise_england e JOIN area_geography g ON g.official_code = e.code
               JOIN area_region r ON r.area_id = g.id AND r.region_code <> 'E12000007'""",
            (RELEASE_ID,)).rowcount
        layer = load_layer(cur, digest)
        print(f"load: {areas} area_noise rows outside London; noise layer {layer}", flush=True)


def load_layer(cur, digest: str) -> str:
    """The `noise` map layer's rows for non-London LSOAs (etl_noise_layer rules, ranked within the region)."""
    source_id = LAYER_PREFIX + digest[:8]
    cur.execute(
        """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence, attribution,
             transformation_version, geography_vintage, validation_status, caveats)
           SELECT %s, source_url, now(), release_date, sha256, licence, attribution, %s, '2021', 'passed', %s
           FROM source_release WHERE id = %s
           ON CONFLICT (id) DO NOTHING""",
        (source_id, etl_noise_layer.ETL_VERSION, etl_noise_layer.definition()["caveats"][:3], RELEASE_ID))
    cur.execute(
        """INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
           VALUES (%s, 'lsoa', '%%', 'higher-is-more', %s, %s) ON CONFLICT (id) DO NOTHING""",
        (etl_noise_layer.METRIC_ID, json.dumps(etl_noise_layer.definition()), source_id))
    found = {gid: (dwellings, share) for gid, dwellings, share in cur.execute(
        """SELECT n.geography_id, n.dwellings, n.any_55_share FROM area_noise n
           JOIN area_geography g ON g.id = n.geography_id AND g.kind = 'lsoa'
           JOIN area_region r ON r.area_id = n.geography_id AND r.region_code <> 'E12000007'""")}
    regions = coverage.load_area_regions(cur, ("lsoa",))
    values = etl_noise_layer.aggregate(found, regions=regions)
    cur.execute("""DELETE FROM metric_value v USING area_region r WHERE v.metric_id = %s
                   AND r.area_id = v.geography_id AND r.region_code <> 'E12000007'""", (etl_noise_layer.METRIC_ID,))
    etl_noise_layer.copy_rows(cur, "metric_value", "geography_id, metric_id, period, value, region_percentile,"
                              " sample_count, quality, source_release_id", [row + [source_id] for row in values])
    return source_id


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else ""
    if stage == "tiles" and len(sys.argv) in (2, 3):
        tiles(int(sys.argv[2]) if len(sys.argv) == 3 else 2)
    elif stage == "load" and len(sys.argv) == 3:
        load(sys.argv[2])
    else:
        sys.exit(__doc__)
