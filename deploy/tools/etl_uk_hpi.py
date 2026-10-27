"""HM Land Registry UK House Price Index into `borough_hpi` and the price-change map layers (migration 080).

The full file: every local authority and region, monthly from January 1995, average price and
index for all homes and for detached, semi-detached, terraced and flats. Every LAD in coverage
(England by default: E06/E07/E08/E09; CLOSE_KNIT_ETL_COVERAGE=london for the 33 boroughs) and its
region (E12, the comparison) are kept; the 5y/10y layers rank each LAD within its region.

  download  fetch the latest full file (tries this month and up to five before) -> $AE_WORK
  load      replace `borough_hpi` as source release `src-hmlr-uk-hpi-YYYY-MM` (latest month), rebuild
            the `hpi-change-5y` / `hpi-change-10y` layers (rebuild_hpi_layers) and stage a product release

  AE_WORK=~/data/aework/hpi python3 etl_uk_hpi.py download
  AE_WORK=~/data/aework/hpi python3 etl_uk_hpi.py load <database-url> [hpi]

Download and parsing are stdlib only; load needs psycopg.
"""
from __future__ import annotations

import csv
import glob
import hashlib
import os
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta

import area_coverage as coverage

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
WORK = os.environ.get("AE_WORK", os.path.join(DATA, "aework", "hpi"))
ETL_VERSION = "close-knit-uk-hpi-1"
BASE = "https://publicdata.landregistry.gov.uk/market-trend-data/house-price-index-data/"
PAGE = "https://www.gov.uk/government/statistical-data-sets/uk-house-price-index-data-downloads"
LONDON = "E12000007"
# borough_hpi.property_type -> the file's (price, index) columns
TYPES = {
    "all": ("AveragePrice", "Index"),
    "detached": ("DetachedPrice", "DetachedIndex"),
    "semi": ("SemiDetachedPrice", "SemiDetachedIndex"),
    "terraced": ("TerracedPrice", "TerracedIndex"),
    "flat": ("FlatPrice", "FlatIndex"),
}
ATTRIBUTION = ("Contains HM Land Registry data © Crown copyright and database right 2026. This data is licensed "
               "under the Open Government Licence v3.0. UK House Price Index.")
CAVEATS = [
    "The official mix-adjusted index for the whole borough, not this neighbourhood: our own £/m² stays the local figure.",
    "The latest months are first estimates and are revised as more sales are registered.",
]


def file_url(month: date) -> str:
    return f"{BASE}UK-HPI-full-file-{month:%Y-%m}.csv"


def number(text: str | None) -> float | None:
    text = (text or "").strip()
    return float(text) if text else None


def parse_csv(path: str, cov: coverage.Coverage | None = None) -> list[tuple]:
    """(borough, month, property_type, average_price, index) for the covered LADs and their regions,
    every type the row publishes; months are the file's DD/MM/YYYY dates."""
    cov = cov or coverage.from_env()
    rows = []
    with open(path, newline="", encoding="utf-8-sig") as handle:
        for record in csv.DictReader(handle):
            code = record["AreaCode"].strip()
            if not (cov.contains_lad(code) or cov.contains_region(code)):
                continue
            month = datetime.strptime(record["Date"].strip(), "%d/%m/%Y").date()
            for kind, (price_col, index_col) in TYPES.items():
                price, index = number(record.get(price_col)), number(record.get(index_col))
                if price is not None and index is not None:
                    rows.append((code, month, kind, round(price), index))
    if not rows:
        raise ValueError(f"no rows in coverage ({cov.name}) in {path}")
    return rows


def latest_month(rows: list[tuple]) -> date:
    return max(row[1] for row in rows)


def change_pct(series: dict[date, float], latest: date, years: int) -> float | None:
    """Percent change of the index from the same month `years` earlier, to one decimal."""
    then = series.get(latest.replace(year=latest.year - years))
    now = series.get(latest)
    return None if not then or now is None else round(100 * (now / then - 1), 1)


def sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def downloaded() -> str:
    files = sorted(glob.glob(os.path.join(WORK, "UK-HPI-full-file-*.csv")))
    if not files:
        raise SystemExit(f"no UK-HPI-full-file-*.csv in {WORK}: run download first")
    return files[-1]


def download() -> None:
    os.makedirs(WORK, exist_ok=True)
    month = date.today().replace(day=1)
    for _ in range(6):
        target = os.path.join(WORK, f"UK-HPI-full-file-{month:%Y-%m}.csv")
        request = urllib.request.Request(file_url(month), headers={"User-Agent": "close-knit-etl"})
        try:
            with urllib.request.urlopen(request, timeout=300) as response, open(target + ".tmp", "wb") as out:
                while chunk := response.read(1 << 20):
                    out.write(chunk)
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
            month = (month - timedelta(days=1)).replace(day=1)
            continue
        os.replace(target + ".tmp", target)
        rows = parse_csv(target)
        print(f"download: {os.path.basename(target)} {os.path.getsize(target) // 1024} KiB sha256 {sha256(target)}, "
              f"{len(rows)} rows in coverage to {latest_month(rows):%Y-%m}")
        return
    raise SystemExit("no UK HPI full file found for the last six months")


def load(url: str) -> None:
    import psycopg
    from psycopg.rows import dict_row

    import stage_release

    path = downloaded()
    rows = parse_csv(path)
    latest = latest_month(rows)
    digest = sha256(path)
    cov = coverage.from_env()
    # The London release keeps its id; the national one (same file) says so.
    source_id = f"src-hmlr-uk-hpi-{latest:%Y-%m}" + ("" if cov.name == "london" else f"-{cov.name}")
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
                 attribution, transformation_version, geography_vintage, validation_status, caveats)
               VALUES (%s, %s, now(), %s, %s, 'OGL-3.0', %s, %s, '2021', 'passed', %s)
               ON CONFLICT (id) DO NOTHING""",
            (source_id, file_url(latest), latest, digest, ATTRIBUTION, ETL_VERSION, CAVEATS))
        stored = cur.execute("SELECT sha256 FROM source_release WHERE id = %s", (source_id,)).fetchone()[0]
        if stored != digest:
            raise SystemExit(f"{source_id} is already loaded from a different file (sha256 {stored[:12]}…)")
        cur.execute("DELETE FROM borough_hpi")
        with cur.copy("COPY borough_hpi (borough, month, property_type, average_price, index, source_release_id) "
                      "FROM STDIN") as copy:
            for row in rows:
                copy.write_row(row + (source_id,))
        values = cur.execute("SELECT rebuild_hpi_layers(%s)", (source_id,)).fetchone()[0]
        print(f"load: {len(rows)} rows {min(r[1] for r in rows):%Y-%m}..{latest:%Y-%m}, {values} layer values, "
              f"sha256 {digest} as {source_id}")
        members = {row[0] for row in cur.execute(
            """SELECT source_release_id FROM product_release_member
               WHERE release_id = (SELECT release_id FROM active_product_release)""")}
        cur.row_factory = dict_row
        stage_release.stage(cur, "uk-hpi", [source_id],
                            replace=tuple(m for m in members if m.startswith("src-hmlr-uk-hpi-") and m != source_id))


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else ""
    if stage == "download" and len(sys.argv) == 2:
        download()
    elif stage == "load" and len(sys.argv) in (3, 4) and (len(sys.argv) == 3 or sys.argv[3] == "hpi"):
        load(sys.argv[2])
    else:
        sys.exit(__doc__)
