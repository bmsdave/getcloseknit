"""Health layers per area (migration 061): air pollution, summer heat and GP access.

Three open sources, each its own source release, rebuilt into `area_health` by
rebuild_area_health() after any stage:
  air   GLA London Atmospheric Emissions Inventory 2022: modelled annual mean NO2 and
        PM2.5 (µg/m³) on a 20 m grid (CSV x, y, conc in British National Grid), read at
        every home's OS Open UPRN point (`property.location`) and averaged per LSOA
  heat  GLA London's Urban Heat Island, average summer: modelled mean midnight air
        temperature (°C), May-September 2011, 250 m GeoTIFF, read at every home, averaged
        per LSOA (OGL v3)
  gp    NHS England Patients Registered at a GP Practice (latest month) and General
        Practice Workforce (practice level, FTE GPs excluding trainees and locums),
        placed at the practice's postcode centre (ONSPD grid reference, $AE_DATA/civic/ONSPD_AUG_2026.zip;
        only postcodes in the coverage: area_analytics.coverage, England by default) (OGL v3)

  AE_WORK=~/data/aework/health python3 etl_health.py download
  AE_WORK=~/data/aework/health python3 etl_health.py load-air <database-url>
  AE_WORK=~/data/aework/health python3 etl_health.py air-sql <database-url> <out.sql.gz>
  AE_WORK=~/data/aework/health python3 etl_health.py load-heat <database-url>
  AE_WORK=~/data/aework/health python3 etl_health.py load-gp <database-url>

load-air also writes the `air-no2` map layer (each LSOA's mean NO2, its own source release
`src-gla-laei-layer-*`) and stages a release with both; air-sql writes the same load as one psql
bundle for production (release_bundle.py), reading homes from <database-url> (read only).

Needs numpy, tifffile (heat) and psycopg. The GP Patient Survey is not used: its practice
results carry no reuse licence of their own (checked 2026-10-16).
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import re
import sys
import urllib.request
import zipfile
from collections.abc import Iterable, Iterator, Mapping
from datetime import date, datetime

import area_coverage as coverage

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
WORK = os.environ.get("AE_WORK", os.path.join(DATA, "aework", "health"))
# Postcode grid references: the ONSPD zip, or a CSV (postcode, easting, northing) already cut to the coverage.
GRID = os.environ.get("AE_ONSPD", os.path.join(DATA, "civic", "ONSPD_AUG_2026.zip"))
ETL_VERSION = "close-knit-health-1"
AIR_YEAR = 2022
HEAT_YEAR = 2011
SOURCES = {
    "air": ("https://data.london.gov.uk/download/2lg5g/7jy/LAEI2022-Concentrations-Data-CSV.zip",
            "laei-2022-concentrations-csv.zip"),
    "heat": ("https://data.london.gov.uk/download/2jxd0/f4e3a05d-fad7-4b56-8c42-ba2274f3bb3a/"
             "London_Tmin_midnight_2011.tif", "london-uhi-tmin-midnight-2011.tif"),
    # Monthly and quarterly NHS releases move: update these two to the latest publication.
    "gp-patients": ("https://files.digital.nhs.uk/FB/7851F6/gp-reg-pat-prac-all.zip", "gp-reg-pat-prac-all-2026-10.zip"),
    "gp-workforce": ("https://files.digital.nhs.uk/49/2ABF5A/GPWPracticeCSV.082026.zip", "gp-workforce-practice-2026-08.zip"),
}
PAGES = {
    "air": "https://data.london.gov.uk/dataset/london-atmospheric-emissions-inventory-laei-2022-2lg5g",
    "heat": "https://data.london.gov.uk/dataset/londons-urban-heat-island-average-summer-2jxd0",
    "gp": "https://digital.nhs.uk/data-and-information/publications/statistical/patients-registered-at-a-gp-practice",
}
OGL = "Contains public sector information licensed under the Open Government Licence v3.0."


def path(key: str) -> str:
    return os.path.join(WORK, SOURCES[key][1])


def download() -> None:
    os.makedirs(WORK, exist_ok=True)
    for key, (url, _) in SOURCES.items():
        target = path(key)
        if os.path.exists(target):
            continue
        request = urllib.request.Request(url, headers={"User-Agent": "close-knit-etl"})
        with urllib.request.urlopen(request, timeout=900) as response, open(target + ".tmp", "wb") as handle:
            while chunk := response.read(1 << 20):
                handle.write(chunk)
        os.replace(target + ".tmp", target)
        print(f"download: {key} {os.path.getsize(target) // 1024} KiB", flush=True)


def sha256(*paths: str) -> str:
    digest = hashlib.sha256()
    for name in paths:
        with open(name, "rb") as handle:
            while chunk := handle.read(1 << 20):
                digest.update(chunk)
    return digest.hexdigest()


# --- shared -----------------------------------------------------------------------------------

def pick_member(names: Iterable[str], pattern: str, prefer: str = "") -> str:
    """The one zip member whose name matches `pattern` (case-insensitive); `prefer` breaks a tie.
    Anything else stops with the candidates listed, so a changed release is easy to fix."""
    names = [name for name in names if name.lower().endswith(".csv")]
    found = [name for name in names if re.search(pattern, os.path.basename(name), re.IGNORECASE)]
    if len(found) > 1 and prefer:
        found = [name for name in found if prefer.lower() in os.path.basename(name).lower()] or found
    if len(found) != 1:
        raise SystemExit(f"expected one CSV matching {pattern!r}, found {found or names}")
    return found[0]


def zip_rows(archive: str, pattern: str, prefer: str = "") -> Iterator[dict]:
    with zipfile.ZipFile(archive) as bundle:
        member = pick_member(bundle.namelist(), pattern, prefer)
        with bundle.open(member) as raw:
            reader = csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""))
            reader.fieldnames = [name.strip() for name in reader.fieldnames or []]
            yield from reader


def home_points(cur, srid: int = 27700) -> list[tuple[str, float, float]]:
    """(LSOA id, x, y) of every home in the grid's CRS (British National Grid unless told otherwise)."""
    return list(cur.execute(
        "SELECT geography_id, ST_X(ST_Transform(location, %(srid)s)), ST_Y(ST_Transform(location, %(srid)s)) FROM property",
        {"srid": srid}))


def lsoa_means(points: Iterable[tuple[str, float, float]], *samplers) -> dict[str, tuple[int, list[float | None]]]:
    """LSOA -> (homes read, mean of each sampler over the homes it covers); homes outside every grid are skipped."""
    sums: dict[str, list] = {}
    for lsoa, east, north in points:
        values = [sample(east, north) for sample in samplers]
        if values[0] is None:
            continue
        entry = sums.setdefault(lsoa, [0] + [[0.0, 0] for _ in samplers])
        entry[0] += 1
        for slot, value in zip(entry[1:], values):
            if value is not None:
                slot[0] += value
                slot[1] += 1
    return {lsoa: (entry[0], [total / n if n else None for total, n in entry[1:]]) for lsoa, entry in sums.items()}


def upsert_release(cur, source_id: str, page: str, release_date: str, digest: str, licence: str,
                   attribution: str, caveats: list[str]) -> None:
    cur.execute(
        """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
             attribution, transformation_version, geography_vintage, validation_status, caveats)
           VALUES (%s, %s, now(), %s, %s, %s, %s, %s, '2021', 'passed', %s)
           ON CONFLICT (id) DO NOTHING""",
        (source_id, page, release_date, digest, licence, attribution, ETL_VERSION, caveats))
    # Source releases are immutable: a rerun on the same file reuses its release; a changed file needs a new id.
    stored = cur.execute("SELECT sha256 FROM source_release WHERE id = %s", (source_id,)).fetchone()[0]
    if stored != digest:
        raise SystemExit(f"{source_id} is already loaded from a different file (sha256 {stored[:12]}…); "
                         "give the new file its own source release id")


def rebuild(cur, label: str, loaded: int) -> None:
    areas = cur.execute("SELECT rebuild_area_health()").fetchone()[0]
    print(f"{label}: {loaded} loaded, {areas} areas rebuilt", flush=True)


# --- air --------------------------------------------------------------------------------------

class PointGrid:
    """A regular grid read from cell-centre points (x, y, value); sampling takes the nearest centre."""

    def __init__(self, xs, ys, values, cell: float):
        import numpy as np

        xs, ys = np.asarray(xs, dtype=np.float64), np.asarray(ys, dtype=np.float64)
        self.cell, self.x0, self.y0 = cell, float(xs.min()), float(ys.min())
        cols = np.rint((xs - self.x0) / cell).astype(np.int64)
        rows = np.rint((ys - self.y0) / cell).astype(np.int64)
        self.data = np.full((int(rows.max()) + 1, int(cols.max()) + 1), np.nan, dtype=np.float32)
        self.data[rows, cols] = np.asarray(values, dtype=np.float32)

    def sample(self, east: float, north: float) -> float | None:
        col, row = round((east - self.x0) / self.cell), round((north - self.y0) / self.cell)
        if not (0 <= row < self.data.shape[0] and 0 <= col < self.data.shape[1]):
            return None
        value = float(self.data[row, col])
        return None if value != value or value < 0 else value  # NaN: no cell there


def column(fields: list[str], *names: str) -> str:
    for name in names:
        for field in fields:
            if field.lower() == name:
                return field
    raise SystemExit(f"none of {names} in columns {fields}")


def read_point_grid(rows: Iterable[Mapping[str, str]], cell: float = 20.0) -> PointGrid:
    xs, ys, values = [], [], []
    keys = None
    for row in rows:
        if keys is None:
            fields = list(row)
            keys = (column(fields, "x", "easting"), column(fields, "y", "northing"),
                    column(fields, "conc", "concentration", "value"))
        try:
            x, y, value = float(row[keys[0]]), float(row[keys[1]]), float(row[keys[2]])
        except (TypeError, ValueError):
            continue
        xs.append(x), ys.append(y), values.append(value)
    if not xs:
        raise SystemExit("no grid points read")
    return PointGrid(xs, ys, values, cell)


AIR_SOURCE_ID = f"src-gla-laei-{AIR_YEAR}"
AIR_LICENCE = "London Datastore terms (use for any purpose); confirm OGL v3.0 with the GLA"
AIR_ATTRIBUTION = f"London Atmospheric Emissions Inventory {AIR_YEAR}, Greater London Authority and Transport for London."
AIR_CAVEATS = ["Modelled annual mean concentrations on a 20 m grid, not measurements.",
               "Each home is read at its OS Open UPRN point; the area value is the mean over its homes."]
# The `air-no2` map layer: each LSOA's mean NO2 at its homes (µg/m³), cleaner green to dirtier red.
AIR_LAYER = "air-no2"
AIR_LAYER_PREFIX = "src-gla-laei-layer"
AIR_LAYER_MIN_HOMES = 10  # fewer homes read than this: suppressed, no value
# Fixed stops (LSOA means 2022: p10 17.7, median 21.2, p90 25.5), so a reload never moves the scale.
# Mirrors web/src/lib/fixtures.ts.
AIR_LEGEND = [
    {"value": 17, "colour": "#3a7d44", "label": "17"},
    {"value": 19, "colour": "#7ba05b", "label": "19"},
    {"value": 21, "colour": "#f4d35e", "label": "21"},
    {"value": 24, "colour": "#c96a3b", "label": "24"},
    {"value": 28, "colour": "#b23a48", "label": "28+"},
]


def air_layer_definition() -> dict:
    return {
        "label": "Clean air", "shortLabel": "Air",
        "description": (f"Modelled yearly mean nitrogen dioxide (NO₂, µg/m³) at the area's homes, {AIR_YEAR} "
                        "(London: GLA London Atmospheric Emissions Inventory, 20 m; elsewhere in England: Defra "
                        "background maps, 1 km). Lower is cleaner; the WHO guideline is 10, the UK legal limit 40."),
        "legend": AIR_LEGEND,
        "sourceId": "gla-laei", "sourceName": f"London Atmospheric Emissions Inventory {AIR_YEAR} (GLA, TfL)",
        "methodologyPath": "/guide/clean-air", "freshness": f"{AIR_YEAR}-12",
        "caveats": AIR_CAVEATS + [
            f"Areas with fewer than {AIR_LAYER_MIN_HOMES} homes read show no value.",
            "Outside London the figure is Defra's 1 km background map (Pollution Climate Mapping, OGL v3): much "
            "coarser than London's 20 m model, and ranked only within its own region.",
            AIR_ATTRIBUTION,
        ],
    }


def air_layer_values(means: Mapping[str, tuple[int, list]], period: str = f"{AIR_YEAR}-12-01") -> list[tuple]:
    """metric_value rows (geography_id, period, value, region_percentile, homes, quality), one per LSOA,
    from {lsoa: (homes, [no2, pm25])}; the percentile is ascending (0 = cleanest)."""
    import crime_rates as cr

    kept = {lsoa: round(values[0], 1) for lsoa, (homes, values) in means.items()
            if homes >= AIR_LAYER_MIN_HOMES and values[0] is not None}
    pct = cr.ascending_percentiles(kept)
    return [(lsoa, period, kept.get(lsoa), pct.get(lsoa), homes, "observed" if lsoa in kept else "suppressed")
            for lsoa, (homes, _) in sorted(means.items())]


def air_layer_source(values: list[tuple], digest: str) -> dict:
    """The layer's source release row, named by a digest of its rows (a rerun reuses it)."""
    rows = hashlib.sha256(repr(values).encode()).hexdigest()[:8]
    return {"id": f"{AIR_LAYER_PREFIX}-{rows}", "source_url": PAGES["air"], "release_date": f"{AIR_YEAR}-12-31",
            "sha256": digest, "licence": AIR_LICENCE, "attribution": AIR_ATTRIBUTION,
            "transformation_version": ETL_VERSION, "caveats": AIR_CAVEATS}


def air_means(cur) -> tuple[dict, str]:
    """({lsoa: (homes, [no2, pm25])}, archive sha256) from the LAEI zip and the database's homes."""
    archive = path("air")
    no2 = read_point_grid(zip_rows(archive, r"(?<![a-z])no2(?![a-z0-9])", str(AIR_YEAR)))
    pm25 = read_point_grid(zip_rows(archive, r"pm2\.?5", str(AIR_YEAR)))
    means = lsoa_means(home_points(cur), no2.sample, pm25.sample)
    no2s = sorted(values[0] for _, values in means.values())
    print(f"air: {len(means)} LSOAs, NO2 p10/p50/p90 "
          + "/".join(f"{no2s[int(len(no2s) * q)]:.1f}" for q in (0.1, 0.5, 0.9)), flush=True)
    return means, sha256(archive)


def air_table_rows(means: Mapping[str, tuple[int, list]]) -> list[tuple]:
    """health_air_lsoa rows from {lsoa: (homes, [no2, pm25])}.

    The dwelling means go in unrounded: the only rounding is on read (api health._num,
    1 dp), so the overview can never double-round away from the air-no2 layer (issue #159).
    """
    return [(lsoa, homes, n, p, AIR_YEAR, AIR_SOURCE_ID)
            for lsoa, (homes, (n, p)) in means.items()]


def load_air(url: str) -> None:
    import psycopg
    from psycopg.rows import dict_row

    import stage_release

    with psycopg.connect(url) as conn, conn.cursor() as cur:
        means, digest = air_means(cur)
        upsert_release(cur, AIR_SOURCE_ID, PAGES["air"], f"{AIR_YEAR}-12-31", digest, AIR_LICENCE,
                       AIR_ATTRIBUTION, AIR_CAVEATS)
        cur.execute("DELETE FROM health_air_lsoa")
        with cur.copy("COPY health_air_lsoa (geography_id, dwellings, no2, pm25, year, source_release_id) FROM STDIN") as copy:
            for row in air_table_rows(means):
                copy.write_row(row)
        rebuild(cur, "air", len(means))
        values = air_layer_values(means)
        layer = air_layer_source(values, digest)
        upsert_release(cur, layer["id"], layer["source_url"], layer["release_date"], digest, AIR_LICENCE,
                       AIR_ATTRIBUTION, AIR_CAVEATS)
        cur.execute(
            """INSERT INTO metric_definition (id, carrier, unit, direction, definition, source_release_id)
               VALUES (%s, 'lsoa', 'µg/m³', 'higher-is-more', %s, %s)
               ON CONFLICT (id) DO UPDATE SET definition = EXCLUDED.definition,
                 source_release_id = EXCLUDED.source_release_id""",
            (AIR_LAYER, json.dumps(air_layer_definition()), layer["id"]))
        cur.execute("DELETE FROM metric_value WHERE metric_id = %s", (AIR_LAYER,))
        with cur.copy("COPY metric_value (geography_id, metric_id, period, value, region_percentile, sample_count,"
                      " quality, source_release_id) FROM STDIN") as copy:
            for gid, period, value, pct, homes, quality in values:
                copy.write_row((gid, AIR_LAYER, period, value, pct, homes, quality, layer["id"]))
        members = {row[0] for row in cur.execute(
            """SELECT source_release_id FROM product_release_member
               WHERE release_id = (SELECT release_id FROM active_product_release)""")}
        cur.row_factory = dict_row
        stage_release.stage(cur, "air", [AIR_SOURCE_ID, layer["id"]],
                            replace=tuple(m for m in members if m.startswith(AIR_LAYER_PREFIX) and m != layer["id"]))


def air_bundle(url: str, out: str) -> None:
    """The air load as one psql script for production: LAEI rows, the area_health rebuild, the layer, a stage."""
    import psycopg

    import release_bundle as rb

    with psycopg.connect(url) as conn, conn.cursor() as cur:
        means, digest = air_means(cur)
    values = air_layer_values(means)
    layer = air_layer_source(values, digest)
    laei = {"id": AIR_SOURCE_ID, "source_url": PAGES["air"], "release_date": f"{AIR_YEAR}-12-31", "sha256": digest,
            "licence": AIR_LICENCE, "attribution": AIR_ATTRIBUTION, "transformation_version": ETL_VERSION,
            "caveats": AIR_CAVEATS}
    guard = f"""DO $guard$ BEGIN
    IF EXISTS (SELECT 1 FROM source_release WHERE id = {rb.literal(AIR_SOURCE_ID)} AND sha256 <> {rb.literal(digest)}) THEN
        RAISE EXCEPTION '{AIR_SOURCE_ID} is already loaded from a different file';
    END IF;
END $guard$;"""
    rows = ((lsoa, homes, n, p, AIR_YEAR, AIR_SOURCE_ID)
            for lsoa, (homes, (n, p)) in sorted(means.items()))
    parts = [guard, rb.source_release_sql(laei), rb.source_release_sql(layer),
             "DELETE FROM health_air_lsoa;",
             rb.copy_sql("health_air_lsoa", ("geography_id", "dwellings", "no2", "pm25", "year", "source_release_id"), rows),
             "SELECT rebuild_area_health() AS areas_rebuilt;",
             rb.metric_sql(AIR_LAYER, "lsoa", "µg/m³", "higher-is-more", air_layer_definition(), layer["id"], values),
             rb.stage_sql("air", [AIR_SOURCE_ID, layer["id"]], [AIR_LAYER_PREFIX])]
    print(f"sql: {rb.write(out, parts)} ({len(means)} LSOAs, layer {layer['id']})")


# --- heat -------------------------------------------------------------------------------------

class GeoRaster:
    """A north-up GeoTIFF; sampling takes the cell holding the point. `srid` is its CRS: British National
    Grid, or ETRS89-LAEA Europe (EPSG:3035), which GLA's heat map uses as a user-defined projection."""

    def __init__(self, filename: str):
        import numpy as np
        import tifffile

        with tifffile.TiffFile(filename) as tif:
            page = tif.pages[0]
            tags = {tag.code: tag.value for tag in page.tags.values()}
            self.data = page.asarray().astype(np.float64)
        scale, tie = tags.get(33550), tags.get(33922)
        if not scale or not tie:
            raise SystemExit(f"{filename}: no GeoTIFF pixel scale or tie point")
        keys = tags.get(34735) or ()
        geokeys = dict(zip(keys[4::4], keys[7::4]))
        projected = geokeys.get(3072)  # ProjectedCSTypeGeoKey
        laea = tuple(tags.get(34736) or ())[:4] == (4321000.0, 3210000.0, 10.0, 52.0)
        if projected in (None, 27700) and not laea:
            self.srid = 27700
        elif projected == 3035 or (laea and geokeys.get(3075) == 10):  # ProjCoordTransGeoKey 10: LAEA
            self.srid = 3035  # Lambert azimuthal equal area, GRS80, false easting/northing 4321000/3210000
        else:
            raise SystemExit(f"{filename}: CRS EPSG:{projected}, expected 27700 or 3035")
        self.cell_x, self.cell_y = float(scale[0]), float(scale[1])
        self.x0 = float(tie[3]) - float(tie[0]) * self.cell_x
        self.y0 = float(tie[4]) + float(tie[1]) * self.cell_y  # top edge
        nodata = tags.get(42113)
        self.nodata = float(str(nodata).strip("\x00 ")) if nodata not in (None, "") else None

    def sample(self, east: float, north: float) -> float | None:
        col, row = int((east - self.x0) // self.cell_x), int((self.y0 - north) // self.cell_y)
        if not (0 <= row < self.data.shape[0] and 0 <= col < self.data.shape[1]):
            return None
        value = float(self.data[row, col])
        if value != value or (self.nodata is not None and value == self.nodata) or abs(value) > 100:
            return None
        return value


def load_heat(url: str) -> None:
    import psycopg

    raster = GeoRaster(path("heat"))
    source_id = f"src-gla-uhi-{HEAT_YEAR}"
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        means = lsoa_means(home_points(cur, raster.srid), raster.sample)
        upsert_release(cur, source_id, PAGES["heat"], f"{HEAT_YEAR}-09-30", sha256(path("heat")), "OGL-3.0",
                       "London's Urban Heat Island, average summer (2011), Greater London Authority. " + OGL,
                       ["Modelled mean air temperature at midnight, May to September 2011, on a 250 m grid.",
                        "It shows which places stay warmer at night, not a forecast or an indoor temperature."])
        cur.execute("DELETE FROM health_heat_lsoa")
        with cur.copy("COPY health_heat_lsoa (geography_id, heat, unit, year, source_release_id) FROM STDIN") as copy:
            for lsoa, (_, (value,)) in means.items():
                copy.write_row((lsoa, round(value, 2), "°C", HEAT_YEAR, source_id))
        rebuild(cur, "heat", len(means))


# --- gp ---------------------------------------------------------------------------------------

def normalise_postcode(postcode: str) -> str:
    compact = re.sub(r"\s+", "", (postcode or "").upper())
    return f"{compact[:-3]} {compact[-3:]}" if len(compact) >= 5 else compact


def parse_month(text: str) -> date | None:
    text = (text or "").strip()
    for fmt in ("%d%b%Y", "%d-%b-%Y", "%d-%b-%y", "%Y-%m-%d", "%d/%m/%Y", "%b-%y", "%B %Y"):
        try:
            return datetime.strptime(text.title(), fmt).date().replace(day=1)
        except ValueError:
            continue
    return None


def number(text: str | None) -> float | None:
    try:
        value = float((text or "").replace(",", ""))
    except ValueError:
        return None
    return value if value >= 0 else None


def onspd_grid(rows: Iterable[Mapping[str, str]], wanted: set[str],
               cov: coverage.Coverage | None = None) -> dict[str, tuple[float, float]]:
    """postcode -> (easting, northing) for the wanted postcodes inside the coverage's regions, from ONSPD
    rows; a live postcode wins over a terminated one, and postcodes without a grid reference are left out."""
    cov = cov or coverage.from_env()
    grid: dict[str, tuple[float, float]] = {}
    live: set[str] = set()
    for row in rows:
        postcode = row["pcds"].strip().upper()
        if postcode not in wanted or not cov.contains_region(row["rgn26cd"]) or row.get("gridind") == "9":
            continue
        if postcode in live or not (row["east1m"] or "").strip() or not (row["north1m"] or "").strip():
            continue
        grid[postcode] = (float(row["east1m"]), float(row["north1m"]))
        if not (row.get("doterm") or "").strip():
            live.add(postcode)
    return grid


def read_grid(source: str, wanted: set[str], cov: coverage.Coverage | None = None) -> dict[str, tuple[float, float]]:
    if not source.endswith(".zip"):
        with open(source, newline="") as handle:
            return {row["postcode"]: (float(row["easting"]), float(row["northing"]))
                    for row in csv.DictReader(handle) if row["easting"] and row["northing"]}
    with zipfile.ZipFile(source) as archive:
        name = next(n for n in archive.namelist() if re.fullmatch(r"Data/ONSPD_[A-Z]{3}_[0-9]{4}_UK\.csv", n))
        with archive.open(name) as raw:
            return onspd_grid(csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8", newline="")), wanted, cov)


def practice_rows(patients: Iterable[Mapping[str, str]], workforce: Iterable[Mapping[str, str]],
                  grid: Mapping[str, tuple[float, float]]) -> tuple[list[tuple], date | None]:
    """(code, postcode, easting, northing, patients, gp_fte) for practices with a postcode in the grid
    (the coverage) and patients, and the extract month. FTE is fully qualified GPs (trainees and locums
    excluded)."""
    fte = {}
    for row in workforce:
        code = (row.get("PRAC_CODE") or "").strip()
        value = number(row.get("TOTAL_GP_EXTGL_FTE"))
        if code and value is not None:
            fte[code] = value
    out, month = [], None
    for row in patients:
        if (row.get("TYPE") or "GP").strip() != "GP" or (row.get("SEX") or "ALL").strip() != "ALL" \
                or (row.get("AGE") or "ALL").strip() != "ALL":
            continue
        month = month or parse_month(row.get("EXTRACT_DATE", ""))
        code, postcode = row["CODE"].strip(), normalise_postcode(row["POSTCODE"])
        count = number(row.get("NUMBER_OF_PATIENTS"))
        point = grid.get(postcode)
        if point is None or not count:
            continue
        out.append((code, postcode, point[0], point[1], int(count), fte.get(code)))
    return out, month


def load_gp(url: str) -> None:
    import psycopg

    cov = coverage.from_env()
    wanted = {normalise_postcode(row["POSTCODE"]) for row in zip_rows(path("gp-patients"), r"gp-reg-pat-prac-all")}
    grid = read_grid(GRID, wanted, cov)
    rows, month = practice_rows(zip_rows(path("gp-patients"), r"gp-reg-pat-prac-all"),
                                zip_rows(path("gp-workforce"), r"detailed"), grid)
    if not rows or month is None:
        raise SystemExit(f"gp: {len(rows)} practices in {cov.name}, month {month}: check the files")
    scope = "" if cov.name == "london" else f"-{cov.name}"  # a new release beside the London-only one
    source_id = f"src-nhs-gp-{month:%Y-%m}{scope}"
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        upsert_release(cur, source_id, PAGES["gp"], month.isoformat(), sha256(path("gp-patients"), path("gp-workforce")),
                       "OGL-3.0", "Patients Registered at a GP Practice and General Practice Workforce, NHS England. "
                       "Contains information from NHS England, licenced under the current version of the Open Government Licence.",
                       ["Registered patients per full-time-equivalent GP, trainees and locums excluded; practices that "
                        "report no workforce are left out of the ratio.",
                        "Practices are placed at their postcode centre; branch surgeries are not counted."])
        cur.execute("CREATE TEMP TABLE gp_stage (code text, postcode text, east float8, north float8, patients int, "
                    "gp_fte numeric) ON COMMIT DROP")
        with cur.copy("COPY gp_stage FROM STDIN") as copy:
            for row in rows:
                copy.write_row(row)
        cur.execute("DELETE FROM gp_practice")
        cur.execute(
            """INSERT INTO gp_practice (code, postcode, location, patients, gp_fte, month, source_release_id)
               SELECT code, postcode, ST_Transform(ST_SetSRID(ST_MakePoint(east, north), 27700), 4326),
                      patients, gp_fte, %s, %s
               FROM gp_stage ON CONFLICT (code) DO NOTHING""", (month, source_id))
        print(f"gp: {len(rows)} practices placed of {len(wanted)} practice postcodes ({cov.name})", flush=True)
        rebuild(cur, "gp", len(rows))


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else ""
    stages = {"load-air": load_air, "load-heat": load_heat, "load-gp": load_gp}
    if stage == "download":
        download()
    elif stage == "air-sql" and len(sys.argv) == 4:
        air_bundle(sys.argv[2], sys.argv[3])
    elif stage in stages and len(sys.argv) == 3:
        stages[stage](sys.argv[2])
    else:
        sys.exit(__doc__)
