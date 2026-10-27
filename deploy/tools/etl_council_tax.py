"""Council tax bands (migration 082): how many homes sit in each band A-H, per LSOA in coverage.

  VOA Council Tax: stock of properties (CTSOP1.1, OGL v3): homes on the valuation list by band per
  LSOA, rounded to the nearest 10 ("-" is fewer than five, read as none). Band I is Wales only.

`load` replaces `area_council_tax_band` with the covered LSOAs (England by default,
CLOSE_KNIT_ETL_COVERAGE=london for London only), then rebuild_council_tax_band() sums
MSOAs and boroughs and writes the `council-tax-band-mean` map metric (mean band, A = 1 ... H = 8);
a product release that replaces any earlier build is staged and activated. The borough's Band D
bill comes from `council_tax` (migration 019) and is not touched here.

  AE_WORK=~/data/aework/council-tax python3 etl_council_tax.py download
  AE_WORK=~/data/aework/council-tax python3 etl_council_tax.py load <database-url>

Needs psycopg for load; download and parsing are stdlib only.
"""
from __future__ import annotations

import csv
import hashlib
import io
import os
import re
import sys
import urllib.request
import zipfile
from collections.abc import Iterable
from typing import IO

import area_coverage as coverage

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
WORK = os.environ.get("AE_WORK", os.path.join(DATA, "aework", "council-tax"))
ETL_VERSION = "close-knit-council-tax-1"
METRIC_ID = "council-tax-band-mean"
SOURCE_PREFIX = "src-voa-ctsop"
FILE = "CTSOP1.1.zip"
URL = "https://assets.publishing.service.gov.uk/media/6a0ad444c75cc34a8ff8f397/CTSOP1.1.zip"
PAGE = "https://www.gov.uk/government/statistics/council-tax-stock-of-properties-2025"
RELEASED = "2025-09-25"
BANDS = tuple(f"band_{band}" for band in "abcdefgh")
ATTRIBUTION = ("Valuation Office Agency, Council Tax: stock of properties 2025. Contains public sector information "
               "licensed under the Open Government Licence v3.0.")
CAVEATS = [
    "Counts of homes on the valuation list at 31 March 2025, rounded by VOA to the nearest 10; fewer than five "
    "read as none.",
    "Bands come from 1991 values (England), not today's prices.",
    "Bills are the borough's average for the band, parish precepts included; discounts and exemptions are not.",
]


def path(name: str) -> str:
    return os.path.join(WORK, name)


def download() -> None:
    os.makedirs(WORK, exist_ok=True)
    target = path(FILE)
    if not os.path.exists(target):
        request = urllib.request.Request(URL, headers={"User-Agent": "close-knit-etl"})
        with urllib.request.urlopen(request, timeout=900) as response, open(target + ".tmp", "wb") as handle:
            while chunk := response.read(1 << 20):
                handle.write(chunk)
        os.replace(target + ".tmp", target)
    print(f"download: {FILE} {os.path.getsize(target) // 1024} KiB sha256 {sha256(target)}", flush=True)


def sha256(name: str) -> str:
    digest = hashlib.sha256()
    with open(name, "rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def _count(text: str) -> int:
    """A published count; "-" (fewer than five) and ".." (not applicable) are none."""
    text = text.strip().replace(",", "")
    return 0 if text in ("-", "..", "") else int(text)


def parse(lines: Iterable[str]) -> dict[str, tuple[int, ...]]:
    """{LSOA code: homes in bands A..H} from the CTSOP1.1 CSV."""
    rows = {}
    for row in csv.DictReader(line.lstrip("﻿") for line in lines):
        if row["geography"] == "LSOA":
            rows[row["ecode"]] = tuple(_count(row[band]) for band in BANDS)
    return rows


def read_zip(source: str | IO[bytes]) -> tuple[dict[str, tuple[int, ...]], str]:
    """The LSOA rows and their period ("2025-03-01") from the CSV inside the zip (CTSOP1_1_YYYY_MM_DD.csv)."""
    with zipfile.ZipFile(source) as archive:
        member = next(name for name in archive.namelist() if re.search(r"CTSOP1_1_\d{4}_\d{2}_\d{2}\.csv$", name))
        year, month = re.search(r"(\d{4})_(\d{2})_\d{2}\.csv$", member).groups()
        with archive.open(member) as handle:
            return parse(io.TextIOWrapper(handle, encoding="utf-8-sig")), f"{year}-{month}-01"


def covered_rows(rows: dict[str, tuple[int, ...]], known: set[str], period: str,
                 cov: coverage.Coverage | None = None) -> list[list]:
    """Table rows for the covered LSOAs in area_geography, with total = A..H summed."""
    cov = cov or coverage.from_env()
    out = []
    for code in sorted(rows):
        geography_id = f"uk:lsoa:{code}"
        if geography_id in known and cov.contains_lad(coverage.lad_of_code(code)):
            out.append([geography_id, *rows[code], sum(rows[code]), period])
    return out


def load(url: str) -> None:
    import psycopg
    from psycopg.rows import dict_row

    import stage_release

    digest = sha256(path(FILE))
    rows, period = read_zip(path(FILE))
    with psycopg.connect(url, row_factory=dict_row) as conn, conn.cursor() as cur:
        cov = coverage.from_env()
        known = {row["id"] for row in cur.execute("SELECT id FROM area_geography WHERE kind = 'lsoa'")
                 if cov.contains_lad(coverage.lad_of_code(row["id"].rsplit(":", 1)[-1]))}
        table = covered_rows(rows, known, period, cov)
        missing = len(known) - len(table)
        print(f"load: {len(table)} {cov.name} LSOAs of {len(rows)} in the file; {missing} absent", flush=True)
        if missing > len(known) // 100:
            raise SystemExit(f"{missing} {cov.name} LSOAs have no CTSOP row: wrong file or geography vintage")

        # The London release keeps its id; the national one (same file) says so.
        source_id = f"{SOURCE_PREFIX}-{period[:4]}-{digest[:12]}" + ("" if cov.name == "london" else f"-{cov.name}")
        cur.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence, attribution,
                 transformation_version, geography_vintage, validation_status, caveats)
               VALUES (%s, %s, now(), %s, %s, 'OGL-3.0', %s, %s, '2021', 'passed', %s) ON CONFLICT (id) DO NOTHING""",
            (source_id, PAGE, RELEASED, digest, ATTRIBUTION, ETL_VERSION, CAVEATS))
        old = tuple(row["source_release_id"] for row in cur.execute(
            "SELECT source_release_id FROM metric_definition WHERE id = %s AND source_release_id <> %s",
            (METRIC_ID, source_id)))
        cur.execute("DELETE FROM area_council_tax_band")
        with cur.copy("COPY area_council_tax_band (geography_id, " + ", ".join(BANDS)
                      + ", total, period, source_release_id) FROM STDIN") as copy:
            for row in table:
                copy.write_row([*row, source_id])
        areas = cur.execute("SELECT rebuild_council_tax_band(%s) AS n", (source_id,)).fetchone()["n"]
        stage_release.stage(cur, METRIC_ID, [source_id], replace=old)
        print(f"load: {source_id}: {areas} areas (LSOA, MSOA, borough)")


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "download":
        download()
    elif len(sys.argv) == 3 and sys.argv[1] == "load":
        load(sys.argv[2])
    else:
        sys.exit(__doc__)
