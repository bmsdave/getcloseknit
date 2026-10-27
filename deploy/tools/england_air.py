"""Air quality for England outside London: Defra PCM background maps, 1 km (OGL v3).

London keeps the GLA London Atmospheric Emissions Inventory (20 m grid, etl_health.py load-air).
Elsewhere the national replacement is Defra's Pollution Climate Mapping (PCM) modelled background
annual means on a 1 km grid, for the same year as London (2022): NO2 and PM2.5. Each EPC home
(england_homes.py) reads its 1 km cell and the area value is the mean over its homes, as London's is.

  download    mapno2<year>.csv and mappm25<year>g.csv from UK-AIR into $AE_ENGLAND/environment/air
  load        health_air_lsoa rows for non-London LSOAs (source release src-defra-pcm-<year>-england),
              rebuild_area_health() (migration 061/103: MSOA/LAD means and ranks within the region), and
              the `air-no2` map layer's rows for non-London LSOAs (src-defra-pcm-layer-england-<digest>)

  python3 england_air.py download
  python3 england_air.py load <database-url>

The 1 km background grid is much coarser than London's 20 m street-level model: roadside peaks are
smoothed out, so the figures are flagged as coarse and only ranked within the region (never against
London's LAEI values). Needs numpy and psycopg.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import urllib.request

import numpy as np

import area_coverage as coverage
import england_homes
import etl_health

YEAR = etl_health.AIR_YEAR  # 2022, as London's LAEI
WORK = os.path.join(england_homes.WORK, "air")
BASE = "https://uk-air.defra.gov.uk/datastore/pcm/"
FILES = {"no2": f"mapno2{YEAR}.csv", "pm25": f"mappm25{YEAR}g.csv"}
PAGE = "https://uk-air.defra.gov.uk/data/pcm-data"
SOURCE_ID = f"src-defra-pcm-{YEAR}-england"
LAYER_PREFIX = "src-defra-pcm-layer-england-"
LICENCE = "OGL-3.0"
ATTRIBUTION = (f"Defra, Modelled background pollution data (Pollution Climate Mapping), {YEAR}, 1 km grid. "
               "© Crown copyright, Open Government Licence v3.0. Homes: OS Open UPRN and the domestic EPC register (OGL v3).")
CAVEATS = ["Modelled annual mean background concentrations on a 1 km grid, not measurements: much coarser than "
           "London's 20 m model, so busy roads are smoothed out.",
           "Each home reads its 1 km cell; the area value is the mean over its homes (EPC-registered addresses).",
           "Ranked only against areas of the same region (outside London), never against London's 20 m figures."]
CELL = 1_000


def download() -> None:
    os.makedirs(WORK, exist_ok=True)
    for name in FILES.values():
        target = os.path.join(WORK, name)
        if os.path.exists(target):
            continue
        with urllib.request.urlopen(BASE + name, timeout=600) as response:
            body = response.read()
        if b"," not in body[:2000] or b"<html" in body[:2000].lower():
            raise SystemExit(f"{name}: not a CSV (UK-AIR answered {body[:120]!r})")
        with open(target + ".tmp", "wb") as handle:
            handle.write(body)
        os.replace(target + ".tmp", target)
        print(f"download: {name} {len(body) // 1024} KiB", flush=True)


def read_grid(path: str) -> dict[tuple[int, int], float]:
    """{(cell west, cell south): value} from a PCM CSV (columns gridcode, x, y, <value>; x/y are the
    1 km cell centre in British National Grid; a few title lines come first; 'MISSING' is no value)."""
    grid = {}
    with open(path, encoding="utf-8-sig") as handle:
        for line in handle:
            parts = [p.strip() for p in line.split(",")]
            if len(parts) < 4 or not parts[1].replace(".", "", 1).isdigit():
                continue
            try:
                value = float(parts[3])
            except ValueError:
                continue  # MISSING
            x, y = float(parts[1]), float(parts[2])
            grid[(int(x // CELL * CELL), int(y // CELL * CELL))] = value
    if len(grid) < 100_000:
        raise SystemExit(f"{path}: only {len(grid)} cells read; check the file format")
    return grid


def sample(grid: dict, east: np.ndarray, north: np.ndarray) -> np.ndarray:
    keys = zip((east // CELL * CELL).astype(int).tolist(), (north // CELL * CELL).astype(int).tolist())
    return np.array([grid.get(k, np.nan) for k in keys], dtype=float)


def lsoa_means() -> tuple[dict[str, tuple[int, float | None, float | None]], str]:
    """{LSOA code: (homes read, mean NO2, mean PM2.5)} for every LSOA with homes inside the grid; files digest."""
    homes = england_homes.load()
    digest = hashlib.sha256()
    values = {}
    for key, name in FILES.items():
        path = os.path.join(WORK, name)
        with open(path, "rb") as handle:
            digest.update(handle.read())
        values[key] = sample(read_grid(path), homes["east"], homes["north"])
    no2, pm25 = values["no2"], values["pm25"]
    read = ~np.isnan(no2)
    lsoa = homes["lsoa"]
    count = np.bincount(lsoa[read], minlength=len(homes["codes"]))
    no2_sum = np.bincount(lsoa[read], weights=no2[read], minlength=len(homes["codes"]))
    pm_ok = read & ~np.isnan(pm25)
    pm_count = np.bincount(lsoa[pm_ok], minlength=len(homes["codes"]))
    pm_sum = np.bincount(lsoa[pm_ok], weights=pm25[pm_ok], minlength=len(homes["codes"]))
    out = {}
    for i, code in enumerate(homes["codes"]):
        if count[i]:
            out[str(code)] = (int(count[i]), float(no2_sum[i] / count[i]),
                              float(pm_sum[i] / pm_count[i]) if pm_count[i] else None)
    return out, digest.hexdigest()


def load(url: str) -> None:
    import psycopg

    means, digest = lsoa_means()
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        regions = {code: region for code, region in cur.execute(
            """SELECT g.official_code, r.region_code FROM area_region r
               JOIN area_geography g ON g.id = r.area_id AND g.kind = 'lsoa'""")}
        outside = {code: v for code, v in means.items() if regions.get(code) not in (None, coverage.LONDON_REGION)}
        etl_health.upsert_release(cur, SOURCE_ID, PAGE, f"{YEAR}-12-31", digest, LICENCE, ATTRIBUTION, CAVEATS)
        cur.execute("""DELETE FROM health_air_lsoa a USING area_region r
                       WHERE r.area_id = a.geography_id AND r.region_code <> %s""", (coverage.LONDON_REGION,))
        with cur.copy("COPY health_air_lsoa (geography_id, dwellings, no2, pm25, year, source_release_id) FROM STDIN") as copy:
            for code, (homes, no2, pm25) in sorted(outside.items()):
                copy.write_row((f"uk:lsoa:{code}", homes, no2, pm25, YEAR, SOURCE_ID))
        areas = cur.execute("SELECT rebuild_area_health()").fetchone()[0]
        layer = load_layer(cur, {f"uk:lsoa:{c}": (h, [n, p]) for c, (h, n, p) in outside.items()},
                           {f"uk:lsoa:{c}": regions[c] for c in outside}, digest)
        print(f"load: {len(outside)} LSOAs outside London, {areas} area_health rows rebuilt, layer {layer}", flush=True)


def layer_values(means, regions) -> list[tuple]:
    """air-no2 rows as etl_health.air_layer_values, ranked within the region."""
    import crime_rates as cr

    kept = {lsoa: round(values[0], 1) for lsoa, (homes, values) in means.items()
            if homes >= etl_health.AIR_LAYER_MIN_HOMES and values[0] is not None}
    pct = coverage.regional_percentiles(kept, regions, rank=cr.ascending_percentiles)
    return [(lsoa, f"{YEAR}-12-01", kept.get(lsoa), pct.get(lsoa), homes, "observed" if lsoa in kept else "suppressed")
            for lsoa, (homes, _) in sorted(means.items())]


def load_layer(cur, means, regions, digest: str) -> str:
    values = layer_values(means, regions)
    layer_id = LAYER_PREFIX + hashlib.sha256(repr(values).encode()).hexdigest()[:8]
    etl_health.upsert_release(cur, layer_id, PAGE, f"{YEAR}-12-31", digest, LICENCE, ATTRIBUTION, CAVEATS)
    cur.execute(
        """INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
           VALUES (%s, 'lsoa', 'µg/m³', 'higher-is-more', %s, %s)
           ON CONFLICT (id) DO UPDATE SET definition = EXCLUDED.definition""",
        (etl_health.AIR_LAYER, json.dumps(etl_health.air_layer_definition()), layer_id))
    cur.execute("""DELETE FROM metric_value v USING area_region r WHERE v.metric_id = %s
                   AND r.area_id = v.geography_id AND r.region_code <> %s""",
                (etl_health.AIR_LAYER, coverage.LONDON_REGION))
    with cur.copy("COPY metric_value (geography_id, metric_id, period, value, region_percentile, sample_count,"
                  " quality, source_release_id) FROM STDIN") as copy:
        for gid, period, value, pct, homes, quality in values:
            copy.write_row((gid, etl_health.AIR_LAYER, period, value, pct, homes, quality, layer_id))
    return layer_id


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else ""
    if stage == "download":
        download()
    elif stage == "load" and len(sys.argv) == 3:
        load(sys.argv[2])
    else:
        sys.exit(__doc__)
