"""Street names for street-level search (migration 042), for the coverage (England by default,
CLOSE_KNIT_ETL_COVERAGE=london for London; area_analytics.coverage).

Source: OS Open Names (OGL v3), the GB CSV download. It lists every named road
with a point near its middle, its postcode district and settlement. Search uses
it to find a street that has no recorded sale, so a home that never sold can
still be placed in its area. It never identifies a particular home.

Stages (work files go to $AE_WORK, default ~/data/aework/streets):
  build       read the zip (downloaded by hand into ~/data/os; see DATA-LICENCES.md),
              keep the named roads inside the coverage's box and write street.tsv and sources.json
  load URL    load the TSV into the migration 042 table, placing each point in its
              LSOA and borough; points outside the coverage's regions (area_region) are dropped
              (psycopg needed)

  python3 -m area_analytics.streets build
  uv run --with 'psycopg[binary]' python -m area_analytics.streets load postgresql://...

Everything except load is pure and dependency-free.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import sys
import zipfile
from typing import Iterable, Iterator

from . import coverage

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
WORK = os.environ.get("AE_WORK", os.path.join(DATA, "aework", "streets"))
NAMES_ZIP = os.environ.get("AE_OPEN_NAMES", os.path.join(DATA, "os", "opname_csv_gb.zip"))
NAMES_URL = "https://api.os.uk/downloads/v1/products/OpenNames/downloads?area=GB&format=CSV&redirect"
NAMES_SOURCE = os.environ.get("AE_STREET_SOURCE", "src-os-open-names-2026-10")
ETL_VERSION = "close-knit-streets-1"
ATTRIBUTION = "Contains OS data © Crown copyright and database right 2026."
ROAD = "Named Road"
COLUMNS = ("id", "name", "locality", "postcode_district", "easting", "northing")

# The download's header (DOC/OS_Open_Names_Header.csv); used when the zip has none.
HEADER = ("ID", "NAMES_URI", "NAME1", "NAME1_LANG", "NAME2", "NAME2_LANG", "TYPE", "LOCAL_TYPE",
          "GEOMETRY_X", "GEOMETRY_Y", "MOST_DETAIL_VIEW_RES", "LEAST_DETAIL_VIEW_RES",
          "MBR_XMIN", "MBR_YMIN", "MBR_XMAX", "MBR_YMAX", "POSTCODE_DISTRICT", "POSTCODE_DISTRICT_URI",
          "POPULATED_PLACE", "POPULATED_PLACE_URI", "POPULATED_PLACE_TYPE", "DISTRICT_BOROUGH",
          "DISTRICT_BOROUGH_URI", "DISTRICT_BOROUGH_TYPE", "COUNTY_UNITARY", "COUNTY_UNITARY_URI",
          "COUNTY_UNITARY_TYPE", "REGION", "REGION_URI", "COUNTRY", "COUNTRY_URI",
          "RELATED_SPATIAL_OBJECT", "SAME_AS_DBPEDIA", "SAME_AS_GEONAMES")


def _coordinate(value: str) -> int | None:
    try:
        number = round(float(value))
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def street_rows(rows: Iterable[list[str]], header: tuple[str, ...] = HEADER,
                cov: coverage.Coverage | None = None) -> list[dict]:
    """Named roads inside the coverage's box (British National Grid), one row per Open Names entry,
    sorted by id; load keeps those whose point lies in a covered region's LSOA."""
    cov = cov or coverage.from_env()
    at = {name: index for index, name in enumerate(header)}
    found = {}
    for row in rows:
        if len(row) < len(header) or row[at["LOCAL_TYPE"]] != ROAD:
            continue
        name = row[at["NAME1"]].strip()
        easting, northing = _coordinate(row[at["GEOMETRY_X"]]), _coordinate(row[at["GEOMETRY_Y"]])
        if not name or easting is None or northing is None or not cov.contains_bng(easting, northing):
            continue
        found[row[at["ID"]]] = {
            "id": row[at["ID"]], "name": name,
            "locality": row[at["POPULATED_PLACE"]].strip() or None,
            "postcode_district": row[at["POSTCODE_DISTRICT"]].strip() or None,
            "easting": easting, "northing": northing}
    return [found[key] for key in sorted(found)]


def zip_rows(path: str) -> tuple[tuple[str, ...], Iterator[list[str]]]:
    """(header, data rows) from the Open Names zip: every DATA/*.csv, which carry no header."""
    archive = zipfile.ZipFile(path)
    names = archive.namelist()
    header_file = next((n for n in names if n.upper().endswith("HEADER.CSV")), None)
    header = HEADER
    if header_file:
        header = tuple(next(csv.reader(io.TextIOWrapper(archive.open(header_file), encoding="utf-8-sig"))))
    data = sorted(n for n in names if n.upper().endswith(".CSV") and "/DATA/" in f"/{n.upper()}")

    def rows() -> Iterator[list[str]]:
        for name in data:
            yield from csv.reader(io.TextIOWrapper(archive.open(name), encoding="utf-8-sig"))
    return header, rows()


def _sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _tsv(value) -> str:
    return "" if value is None else str(value).replace("\t", " ").replace("\n", " ")


def build() -> None:
    os.makedirs(WORK, exist_ok=True)
    header, rows = zip_rows(NAMES_ZIP)
    streets = street_rows(rows, header)
    if not streets:
        raise SystemExit("build: no named roads in the coverage in the download")
    with open(os.path.join(WORK, "street.tsv"), "w", newline="") as handle:
        for street in streets:
            handle.write("\t".join(_tsv(street[c]) for c in COLUMNS) + "\n")
    with open(os.path.join(WORK, "sources.json"), "w") as handle:
        json.dump({"sha256": _sha256(NAMES_ZIP), "rows": len(streets)}, handle)
    print(f"build: {len(streets)} named roads in the {coverage.from_env().name} box")


def source_release(sources: dict) -> tuple:
    """(id, url, sha256, licence, attribution, caveats) for the loaded download."""
    return (NAMES_SOURCE, NAMES_URL, sources["sha256"], "OGL-3.0", ATTRIBUTION,
            ["Street names and a point near each street's middle; no house numbers or addresses.",
             "A street's postcode for a house number is inferred from neighbouring recorded sales."])


# Each point goes to the LSOA containing it (Open Names points are British National Grid).
PLACE_SQL = """INSERT INTO street (id, name, locality, postcode_district, easting, northing,
                                   geography_id, borough_id, source_release_id)
SELECT s.id, s.name, s.locality, s.postcode_district, s.easting, s.northing,
       lsoa.id, msoa.parent_id, %s
FROM staging_street s
JOIN area_geography lsoa ON lsoa.kind = 'lsoa' AND ST_Contains(lsoa.geometry,
     ST_Transform(ST_SetSRID(ST_MakePoint(s.easting, s.northing), 27700), 4326))
JOIN area_geography msoa ON msoa.id = lsoa.parent_id
JOIN area_region region ON region.area_id = lsoa.id AND region.region_code = ANY(%s)
ON CONFLICT (id) DO NOTHING"""


def load(url: str) -> None:
    import psycopg

    with open(os.path.join(WORK, "sources.json")) as handle:
        sources = json.load(handle)
    source_id, source_url, sha, licence, attribution, caveats = source_release(sources)
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
                 attribution, transformation_version, geography_vintage, validation_status, caveats)
               VALUES (%s, %s, now(), current_date, %s, %s, %s, %s, '2021', 'passed', %s)
               ON CONFLICT (id) DO NOTHING""",
            (source_id, source_url, sha, licence, attribution, ETL_VERSION, caveats))
        cur.execute("""CREATE TEMP TABLE staging_street (id text, name text, locality text,
                       postcode_district text, easting integer, northing integer)""")
        with open(os.path.join(WORK, "street.tsv")) as handle, cur.copy(
                "COPY staging_street FROM STDIN WITH (FORMAT text, NULL '')") as copy:
            while chunk := handle.read(1 << 20):
                copy.write(chunk)
        cur.execute("DELETE FROM street WHERE source_release_id = %s", (source_id,))
        cur.execute(PLACE_SQL, (source_id, sorted(coverage.from_env().region_codes)))
        staged = cur.execute("SELECT count(*) FROM staging_street").fetchone()[0]
        placed = cur.execute("SELECT count(*) FROM street WHERE source_release_id = %s",
                             (source_id,)).fetchone()[0]
        print(f"load: {placed} of {staged} streets placed in an LSOA")


def main(argv: list[str]) -> None:
    stage = argv[1] if len(argv) > 1 else ""
    if stage == "build":
        build()
    elif stage == "load" and len(argv) == 3:
        load(argv[2])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
