"""The domestic EPC bulk download (MHCLG, every certificate since 2008), read one way by every ETL.

The download is one zip of yearly `certificates-YYYY.csv` files (domestic-csv.zip); a folder with the
files unzipped works the same, so nothing needs unzipping first. Either one is the `source`:

    AE_EPC        a zip or a folder (AE_EPC_ZIP and AE_EPC_DIR are read too, in that order)
    default       ~/Downloads/domestic-csv.zip, or ~/Downloads/domestic-csv when only the folder is there

    members(source)              certificate CSV names, oldest year first
    open_text(source, member)    one member as text (UTF-8, undecodable bytes replaced)

Readers: england_homes.py, etl_england_prices.py (link), etl_station_access.py (homes), etl_epc.py (per home)
and the per-home extract below, which etl_sales.py and etl_property.py read:

    python3 epc_bulk.py london-csv [<out.csv>] [year ...]

keeps the per-home scope's certificates (London: per-home data stays London-only) with the columns of
EPC_KEEP -> $AE_DATA/aework/epc/epc-london.csv by default. Restartable per year file.
"""
from __future__ import annotations

import csv
import io
import json
import os
import sys
import zipfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import TextIO

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipelines/area-analytics-ingest"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import area_coverage  # noqa: E402

DEFAULT_ZIP = os.path.expanduser("~/Downloads/domestic-csv.zip")
DEFAULT_DIR = os.path.expanduser("~/Downloads/domestic-csv")
DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
LONDON_CSV = os.path.join(DATA, "aework", "epc", "epc-london.csv")
# Per-home rows (property, sale, property_epc) exist for this scope only.
PER_HOME_SCOPE = "london"
EPC_KEEP = ("certificate_number", "address1", "address2", "address3", "postcode", "local_authority",
            "total_floor_area", "lodgement_date", "uprn", "transaction_type")


def source() -> str:
    """The zip or folder to read: $AE_EPC, $AE_EPC_ZIP, $AE_EPC_DIR, then the default download."""
    for name in ("AE_EPC", "AE_EPC_ZIP", "AE_EPC_DIR"):
        if os.environ.get(name):
            return os.path.expanduser(os.environ[name])
    if not os.path.exists(DEFAULT_ZIP) and os.path.isdir(DEFAULT_DIR):
        return DEFAULT_DIR
    return DEFAULT_ZIP


def _is_certificates(name: str) -> bool:
    base = os.path.basename(name)
    return base.startswith("certificates") and base.endswith(".csv")


def members(src: str) -> list[str]:
    """The certificate CSVs of a zip (member names) or a folder (file names), sorted by file name."""
    if os.path.isdir(src):
        names = [name for name in os.listdir(src) if _is_certificates(name)]
    else:
        with zipfile.ZipFile(src) as archive:
            names = [name for name in archive.namelist() if _is_certificates(name)]
    if not names:
        raise SystemExit(f"no certificates*.csv in {src}")
    return sorted(names, key=lambda name: (os.path.basename(name), name))


@contextmanager
def open_text(src: str, member: str) -> Iterator[TextIO]:
    """One certificates file as text, from a zip or a folder alike."""
    if os.path.isdir(src):
        with open(os.path.join(src, member), newline="", encoding="utf-8", errors="replace") as handle:
            yield handle
        return
    with zipfile.ZipFile(src) as archive, archive.open(member) as raw:
        yield io.TextIOWrapper(raw, encoding="utf-8", errors="replace", newline="")


def size(src: str, member: str) -> int:
    """Uncompressed bytes of one member."""
    if os.path.isdir(src):
        return os.path.getsize(os.path.join(src, member))
    with zipfile.ZipFile(src) as archive:
        return archive.getinfo(member).file_size


# --- per-home extract ------------------------------------------------------------------------------

def scope_rows(handle: TextIO, lad_codes: frozenset[str]) -> Iterator[list]:
    """EPC_KEEP rows of one certificates file for certificates in `lad_codes` with a valid floor area,
    date and UPRN (bulk_price.map_epc_row's rules)."""
    from area_analytics.epc_link import map_epc_row, normalize_epc_columns

    fieldnames = normalize_epc_columns(next(csv.reader([handle.readline()])))
    for row in csv.DictReader(handle, fieldnames=fieldnames):
        if (row.get("local_authority") or "") not in lad_codes:
            continue
        try:
            record = map_epc_row(row)
        except ValueError:
            continue
        yield [record.certificate_number, row.get("address1", ""), row.get("address2", ""),
               row.get("address3", ""), row.get("postcode", ""), row.get("local_authority", ""),
               record.floor_area_sqm, record.lodgement_date, record.uprn, row.get("transaction_type", "")]


def london_csv(out_path: str = LONDON_CSV, years: list[str] | None = None, src: str | None = None) -> int:
    """Append each not yet done year file's per-home-scope certificates to `out_path`; returns rows added."""
    src = src or source()
    lad_codes = area_coverage.get(PER_HOME_SCOPE).lad_codes
    done_path = out_path + ".done.json"
    done = set(json.load(open(done_path))) if os.path.exists(done_path) else set()
    names = [name for name in members(src)
             if not years or any(os.path.basename(name).endswith(f"-{year}.csv") for year in years)]
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    kept = 0
    with open(out_path, "a" if done else "w", newline="") as out:
        writer = csv.writer(out)
        if not done:
            writer.writerow(EPC_KEEP)
        for name in names:
            if os.path.basename(name) in done:
                continue
            with open_text(src, name) as handle:
                count = 0
                for row in scope_rows(handle, lad_codes):
                    writer.writerow(row)
                    count += 1
            kept += count
            out.flush()
            done.add(os.path.basename(name))
            with open(done_path, "w") as handle:
                json.dump(sorted(done), handle)
            print(f"epc {os.path.basename(name)}: {count} {PER_HOME_SCOPE} rows", flush=True)
    print(f"london-csv: {kept} new rows -> {out_path}")
    return kept


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "london-csv":
        rest = sys.argv[2:]
        out = rest.pop(0) if rest and not rest[0].isdigit() else LONDON_CSV
        london_csv(out, rest or None)
    else:
        sys.exit(__doc__)
