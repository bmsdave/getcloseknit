"""ONS CPIH all-items index (series L522, 2015 = 100) into `cpih_month` (migration 057).

The sector price index deflates annual £/m² medians by the annual mean CPIH.

  download  fetch the series CSV from the ONS time-series generator -> <csv>
  load      replace `cpih_month` with the CSV's monthly rows as a source release
            `src-ons-cpih-YYYY-MM` (latest month); then rerun
            `SELECT rebuild_zone_analytics('<sales release>')` or the next sales load

  python3 etl_cpih.py download ~/data/ons/cpih-l522.csv
  python3 etl_cpih.py load <db url> ~/data/ons/cpih-l522.csv

Reads either the ONS generator CSV (metadata rows, then "1988", "1988 Q1",
"1988 JAN" rows: only the monthly ones are kept) or the pipeline fixture
(`month,cpih_index,source` with YYYY-MM months).
"""
from __future__ import annotations

import csv
import hashlib
import sys
import urllib.request
from datetime import date, datetime

SOURCE_URL = ("https://www.ons.gov.uk/generator?format=csv"
              "&uri=/economy/inflationandpriceindices/timeseries/l522/mm23")
ETL_VERSION = "close-knit-cpih-1"
ATTRIBUTION = ("Source: Office for National Statistics licensed under the Open Government Licence v3.0. "
               "CPIH all items index (L522), 2015 = 100.")
MONTHS = {name: number for number, name in enumerate(
    ("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"), start=1)}


def parse_month(label: str) -> date | None:
    """'2004 JAN' or '2004-01' -> 2004-01-01; years, quarters and metadata -> None."""
    label = label.strip()
    parts = label.split(" ")
    if len(parts) == 2 and parts[0].isdigit() and parts[1] in MONTHS:
        return date(int(parts[0]), MONTHS[parts[1]], 1)
    if len(label) == 7 and label[4] == "-" and label[:4].isdigit() and label[5:].isdigit():
        return date(int(label[:4]), int(label[5:]), 1)
    return None


def parse_csv(path: str) -> tuple[list[tuple[date, float]], date | None]:
    """Monthly (month, index) rows in order, and the ONS release date when the file states one."""
    rows: dict[date, float] = {}
    released = None
    with open(path, newline="", encoding="utf-8-sig") as handle:
        for record in csv.reader(handle):
            if len(record) < 2:
                continue
            if record[0] == "Release date" and record[1]:
                released = datetime.strptime(record[1], "%d-%m-%Y").date()
            month = parse_month(record[0])
            if month is not None and record[1].strip():
                rows[month] = float(record[1])
    if not rows:
        raise ValueError(f"no monthly CPIH rows in {path}")
    return sorted(rows.items()), released


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def stage_download(path: str) -> None:
    request = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "close-knit-etl"})
    with urllib.request.urlopen(request, timeout=60) as response, open(path, "wb") as out:
        out.write(response.read())
    rows, released = parse_csv(path)
    print(f"download: {len(rows)} months to {rows[-1][0]:%Y-%m} (released {released}) -> {path}")


def stage_load(url: str, path: str) -> None:
    import psycopg

    rows, released = parse_csv(path)
    latest = rows[-1][0]
    source_id = f"src-ons-cpih-{latest:%Y-%m}"
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
                 attribution, transformation_version, geography_vintage, validation_status, caveats)
               VALUES (%s, %s, now(), %s, %s, 'OGL-3.0', %s, %s, 'national', 'passed', %s)
               ON CONFLICT (id) DO NOTHING""",
            (source_id, SOURCE_URL, released or latest, sha256_file(path), ATTRIBUTION, ETL_VERSION,
             ["A national consumer price index: it deflates area prices, it is not an area price."]))
        cur.execute("DELETE FROM cpih_month")
        cur.executemany("INSERT INTO cpih_month (month, cpih_index, source_release_id) VALUES (%s, %s, %s)",
                        [(month, value, source_id) for month, value in rows])
        print(f"load: {len(rows)} months {rows[0][0]:%Y-%m}..{latest:%Y-%m} as {source_id}")


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else ""
    if stage == "download" and len(sys.argv) == 3:
        stage_download(sys.argv[2])
    elif stage == "load" and len(sys.argv) == 4:
        stage_load(sys.argv[2], sys.argv[3])
    else:
        sys.exit(__doc__)
