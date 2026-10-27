"""Private rents by local authority and bedroom count (stream G2, migration 029).

Source: ONS Price Index of Private Rents (PIPR), UK: monthly price statistics
(OGL v3, official statistics in development). For each local authority PIPR
gives the average (mean) monthly rent of new and existing private tenancies,
rounded to £1, for all homes, one to four-or-more bedrooms and flats/maisonettes.
There is no studio or room figure, and no City of London row (too few lets).
Only the latest month is kept, for every LAD in coverage (England by default,
CLOSE_KNIT_ETL_COVERAGE=london for the 32 boroughs) and each covered region as a whole.

Stages (work files go to $AE_WORK, default ~/data/aework/rents):
  build       read the workbook (downloaded by hand into ~/data/rent; see
              DATA-LICENCES.md) and write borough_rent.tsv and sources.json
  load URL    load the TSV into the migration 029 table (psycopg needed)

  python3 -m area_analytics.rents build
  uv run --with 'psycopg[binary]' python -m area_analytics.rents load postgresql://...

Everything except load is pure and dependency-free (the .xlsx is read with zipfile).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Iterable, Iterator

from . import coverage

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
WORK = os.environ.get("AE_WORK", os.path.join(DATA, "aework", "rents"))
PIPR_XLSX = os.path.join(DATA, "rent", "pipr-2026-09-16.xlsx")
PIPR_URL = ("https://www.ons.gov.uk/file?uri=/economy/inflationandpriceindices/datasets/"
            "priceindexofprivaterentsukmonthlypricestatistics/16september2026/"
            "priceindexofprivaterentsukmonthlypricestatistics.xlsx")
PIPR_PUBLISHED = "2026-09-16"
PIPR_SOURCE = "src-ons-pipr-2026-09"
PIPR_SHEET = "Table 1"
ETL_VERSION = "close-knit-rents-1"
LONDON = "E12000007"
PIPR_ATTRIBUTION = ("Source: Office for National Statistics, Price Index of Private Rents. "
                    "Contains public sector information licensed under the Open Government Licence v3.0.")
CEILING = 20_000

# Workbook column suffix -> borough_rent.bedrooms
CELLS = {"": "all", " one bed": "1 bedroom", " two bed": "2 bedrooms", " three bed": "3 bedrooms",
         " four or more bed": "4 or more bedrooms", " flat maisonette": "flat or maisonette"}
COLUMNS = ("area_code", "period", "bedrooms", "monthly_rent", "annual_change_pct")

_S = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
_PKG = "{http://schemas.openxmlformats.org/package/2006/relationships}"
_REF = re.compile(r"^([A-Z]+)")
_EXCEL_EPOCH = date(1899, 12, 30)


def _column_index(ref: str) -> int:
    index = 0
    for char in _REF.match(ref).group(1):
        index = index * 26 + ord(char) - 64
    return index - 1


def _sheet_path(archive: zipfile.ZipFile, sheet: str) -> str:
    book = ET.fromstring(archive.read("xl/workbook.xml"))
    rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    targets = {rel.get("Id"): rel.get("Target") for rel in rels.iter(f"{_PKG}Relationship")}
    for entry in book.iter(f"{_S}sheet"):
        if entry.get("name") == sheet:
            target = targets[entry.get(f"{_R}id")].lstrip("/")
            return target if target.startswith("xl/") else f"xl/{target}"
    raise ValueError(f"no sheet {sheet!r}")


def xlsx_rows(path: str, sheet: str) -> Iterator[list[str]]:
    """Cell values of one sheet as text (shared strings resolved, numbers as written)."""
    with zipfile.ZipFile(path) as archive:
        strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            strings = ["".join(item.itertext()) for item in
                       ET.fromstring(archive.read("xl/sharedStrings.xml")).iter(f"{_S}si")]
        with archive.open(_sheet_path(archive, sheet)) as handle:
            for _, element in ET.iterparse(handle):
                if element.tag != f"{_S}row":
                    continue
                cells: list[str] = []
                for cell in element.iter(f"{_S}c"):
                    index = _column_index(cell.get("r"))
                    cells.extend([""] * (index - len(cells)))
                    kind, value = cell.get("t"), cell.find(f"{_S}v")
                    if kind == "s" and value is not None:
                        text = strings[int(value.text)]
                    elif kind == "inlineStr":
                        text = "".join(cell.itertext())
                    else:
                        text = value.text if value is not None and value.text else ""
                    cells.append(text)
                element.clear()
                yield cells


def month(value: str) -> str | None:
    """An Excel date serial (46235) or an ISO date ("2026-08-01…") as the month's first day."""
    value = value.strip()
    if re.match(r"^\d{4}-\d{2}", value):
        return value[:7] + "-01"
    try:
        day = _EXCEL_EPOCH + timedelta(days=int(float(value)))
    except ValueError:
        return None
    return day.replace(day=1).isoformat()


def _rent(value: str) -> int | None:
    try:
        rent = int(Decimal(value.strip()).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    except Exception:
        return None
    return rent if 0 < rent <= CEILING else None


def _change(value: str) -> Decimal | None:
    try:
        return Decimal(value.strip()).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except Exception:
        return None


def covered(code: str, cov: coverage.Coverage | None = None) -> bool:
    """A LAD (E06-E09) or a region (E12) inside the coverage (England unless the env says London)."""
    cov = cov or coverage.from_env()
    return cov.contains_lad(code) or cov.contains_region(code)


def source_id(cov: coverage.Coverage | None = None) -> str:
    """The release id: the London release keeps its id, the national one says so (same workbook)."""
    cov = cov or coverage.from_env()
    return PIPR_SOURCE if cov.name == "london" else f"{PIPR_SOURCE}-{cov.name}"


def rent_rows(rows: Iterable[list[str]], cov: coverage.Coverage | None = None) -> list[dict]:
    """The latest month's rents in coverage: one row per area and bedroom cell with a published rent."""
    cov = cov or coverage.from_env()
    rows = iter(rows)
    header = next(row for row in rows if row and row[0].strip() == "Time period")
    where = {name.strip(): index for index, name in enumerate(header)}
    period_at, code_at = where["Time period"], where["Area code"]
    found: dict[str, list[dict]] = {}
    for row in rows:
        if len(row) <= code_at or not covered(row[code_at].strip(), cov):
            continue
        period = month(row[period_at])
        if period is None:
            continue
        for suffix, cell in CELLS.items():
            price_at = where.get(f"Rental price{suffix}")
            change_at = where.get(f"Annual change{suffix}")
            rent = _rent(row[price_at]) if price_at is not None and price_at < len(row) else None
            if rent is None:
                continue
            change = _change(row[change_at]) if change_at is not None and change_at < len(row) else None
            found.setdefault(period, []).append({
                "area_code": row[code_at].strip(), "period": period, "bedrooms": cell,
                "monthly_rent": rent, "annual_change_pct": change})
    if not found:
        raise ValueError(f"no rents in coverage ({cov.name}) in the workbook")
    return sorted(found[max(found)], key=lambda item: (item["area_code"], item["bedrooms"]))


def _sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def build() -> None:
    os.makedirs(WORK, exist_ok=True)
    rows = rent_rows(xlsx_rows(PIPR_XLSX, PIPR_SHEET))
    with open(os.path.join(WORK, "borough_rent.tsv"), "w", newline="") as handle:
        for row in rows:
            handle.write("\t".join("" if row[c] is None else str(row[c]) for c in COLUMNS) + "\n")
    areas = {row["area_code"] for row in rows}
    with open(os.path.join(WORK, "sources.json"), "w") as handle:
        json.dump({"sha256": _sha256(PIPR_XLSX), "period": rows[0]["period"], "rows": len(rows),
                   "areas": len(areas)}, handle)
    print(f"build: {len(rows)} rows, {len(areas)} areas, period {rows[0]['period']}")


def source_release(sources: dict) -> tuple:
    """(id, url, release_date, sha256, licence, attribution, caveats) for the loaded workbook."""
    return (source_id(), PIPR_URL, PIPR_PUBLISHED, sources["sha256"], "OGL-3.0", PIPR_ATTRIBUTION,
            [f"Average (mean) monthly private rent for {sources['period'][:7]}, new and existing tenancies, "
             "official statistics in development.",
             "Local-authority-wide by bedroom count: every neighbourhood in a borough or district reads the same rent.",
             "No studio, room or City of London figures are published."])


def load(url: str) -> None:
    import psycopg

    with open(os.path.join(WORK, "sources.json")) as handle:
        sources = json.load(handle)
    source_id, source_url, released, sha, licence, attribution, caveats = source_release(sources)
    with open(os.path.join(WORK, "borough_rent.tsv")) as handle:
        body = "".join(f"{line}\t{source_id}\n" for line in handle.read().splitlines())
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
                 attribution, transformation_version, geography_vintage, validation_status, caveats)
               VALUES (%s, %s, now(), %s, %s, %s, %s, %s, '2021', 'passed', %s)
               ON CONFLICT (id) DO NOTHING""",
            (source_id, source_url, released, sha, licence, attribution, ETL_VERSION, caveats))
        # One release holds every covered area: replace the table (the London build's rows too).
        cur.execute("DELETE FROM borough_rent")
        with cur.copy(f"COPY borough_rent ({', '.join(COLUMNS)}, source_release_id) FROM STDIN "
                      "WITH (FORMAT text, NULL '')") as copy:
            copy.write(body)
        print("load:", cur.execute("SELECT count(*) FROM borough_rent").fetchone()[0], "rows")


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
