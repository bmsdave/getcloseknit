"""EPC certificate facts per London dwelling for the property page (track K).

Stages (run in order; each is restartable):
  extract  read the MHCLG bulk download (domestic certificates-YYYY.csv, one
           per lodgement year, zipped or not: epc_bulk.py; OGL v3.0 for non-address
           fields), keep the per-home scope's certificates (London: local
           authority in epc_bulk.PER_HOME_SCOPE) with a UPRN, and keep each
           UPRN's latest certificate -> $AE_WORK/epc-london-latest.csv, and
           that certificate's postcode and address -> epc-london-addresses.csv
  load     COPY that file into `property_epc` (migration 020) under the
           existing EPC source release, keeping only UPRNs the property spine
           knows; the UPRNs it does not know, with their certificate address,
           into `property_epc_home` (migration 089, served only behind
           CLOSE_KNIT_EPC_ADDRESSES); then rebuild `area_type_price` from the
           loaded sales and the per-LSOA A-C share `area_epc_rating` (028):
           python3 etl_epc.py load <database url>

  AE_EPC=~/Downloads/domestic-csv.zip python3 etl_epc.py extract

Kept fields: rating (current, potential), property type, built form,
construction age band, total floor area, habitable rooms, floor level and the
lodgement date. Never kept: EPC tenure (it describes the occupant), names
and running costs. The certificate's address and postcode go to their own file
and table (property_epc_home) and only for homes the spine does not know:
matching to the spine is by UPRN. The address carries Royal Mail/OS rights
(DATA-LICENCES.md), so the API keeps it behind CLOSE_KNIT_EPC_ADDRESSES.
"""
from __future__ import annotations

import csv
import json
import os
import re
import sys
from multiprocessing import Pool

import area_coverage
import epc_bulk

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
WORK = os.environ.get("AE_WORK", os.path.join(DATA, "aework", "epc"))
EPC_SOURCE = epc_bulk.source()
# Per-home facts exist for the per-home scope only (London); the prefilter is its codes' common prefix.
LAD_CODES = area_coverage.get(epc_bulk.PER_HOME_SCOPE).lad_codes
LAD_PREFIX = os.path.commonprefix(sorted(LAD_CODES))
OUT_CSV = os.path.join(WORK, "epc-london-latest.csv")
ADDRESS_CSV = os.path.join(WORK, "epc-london-addresses.csv")
SOURCE_RELEASE_ID = os.environ.get("AE_EPC_SOURCE", "src-epc-bulk-2012-2026")
SALES_SOURCE = os.environ.get("AE_SALES_SOURCE")
COLUMNS = ("uprn", "lodgement_date", "current_rating", "potential_rating", "property_type", "built_form",
           "construction_age_band", "total_floor_area", "habitable_rooms", "floor_level")
NO_DATA = {"", "NO DATA!", "NODATA!", "INVALID!", "N/A", "NOT APPLICABLE", "UNKNOWN"}
PROPERTY_TYPES = {"House", "Flat", "Maisonette", "Bungalow", "Park home"}
RATINGS = set("ABCDEFG")
ADDRESS_COLUMNS = ("uprn", "postcode", "display_address")
POSTCODE = re.compile(r"^([A-Z]{1,2}[0-9][A-Z0-9]?) ?([0-9][A-Z]{2})$")


def clean(value: str | None) -> str | None:
    text = (value or "").strip()
    return None if text.upper() in NO_DATA else text


def age_band(value: str | None) -> str | None:
    text = clean(value)
    if text is None:
        return None
    return text.removeprefix("England and Wales: ").strip() or None


def ordinal(number: int) -> str:
    suffix = "th" if 10 <= number % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(number % 10, "th")
    return f"{number}{suffix}"


# The bulk download codes a flat's position: 3 always pairs with flat_top_storey=Y,
# 1 and 2 with N, 0 is rare. Older certificates use words ("Ground", "1st", "mid floor").
FLOOR_CODES = {"0": "Basement", "1": "Ground floor", "2": "Middle floor", "3": "Top floor"}


def floor_level(value: str | None) -> str | None:
    """EPC floor level -> 'Ground floor', 'Middle floor', 'Top floor', '4th floor'…; None when absent."""
    text = clean(value)
    if text is None:
        return None
    lowered = text.lower()
    if lowered in FLOOR_CODES:
        return FLOOR_CODES[lowered]
    if lowered.startswith("ground"):
        return "Ground floor"
    if lowered.startswith("basement"):
        return "Basement"
    if lowered.startswith("mid"):
        return "Middle floor"
    if lowered.startswith("top"):
        return "Top floor"
    if lowered[:2].isdigit() or lowered[:1].isdigit():
        digits = "".join(ch for ch in lowered[:2] if ch.isdigit())
        suffix = " or above" if "above" in lowered else ""
        return f"{ordinal(int(digits))} floor{suffix}"
    return None


def rooms(value: str | None) -> int | None:
    text = clean(value)
    try:
        number = int(float(text)) if text is not None else None
    except ValueError:
        return None
    return number if number is not None and 0 <= number <= 100 else None


def area(value: str | None) -> float | None:
    text = clean(value)
    try:
        number = float(text) if text is not None else None
    except ValueError:
        return None
    return number if number is not None and 5 <= number <= 5000 else None


def parse_row(row: dict[str, str]) -> tuple | None:
    """One certificate -> the stored tuple, or None when it is not a per-home-scope dwelling with a UPRN."""
    uprn = (row.get("uprn") or "").strip()
    if not uprn.isdigit() or (row.get("local_authority") or "") not in LAD_CODES:
        return None
    lodged = (row.get("lodgement_date") or "")[:10]
    if len(lodged) != 10:
        return None
    current = clean(row.get("current_energy_rating"))
    potential = clean(row.get("potential_energy_rating"))
    kind = clean(row.get("property_type"))
    return (
        str(int(uprn)), lodged,
        current if current in RATINGS else None,
        potential if potential in RATINGS else None,
        kind if kind in PROPERTY_TYPES else None,
        clean(row.get("built_form")),
        age_band(row.get("construction_age_band")),
        area(row.get("total_floor_area")),
        rooms(row.get("number_habitable_rooms")),
        floor_level(row.get("floor_level")),
    )


def postcode(value: str | None) -> str | None:
    """'w51lr' / 'W5 1LR' -> 'W5 1LR'; None when it is not a full postcode."""
    match = POSTCODE.match(re.sub(r"\s+", " ", (value or "").strip().upper()))
    return f"{match.group(1)} {match.group(2)}" if match else None


def tidy(value: str | None) -> str | None:
    """One address part: spaces squeezed; an all-capitals part ('10 HIGH STREET') in title case."""
    text = " ".join((clean(value) or "").split()).strip(" ,")
    if not text:
        return None
    return text.title() if text.isupper() else text


def parse_address(row: dict[str, str]) -> tuple | None:
    """One certificate -> (uprn, postcode, display address), or None without a full postcode and a first line.
    The display address reads like the spine's: 'Flat 2, 10 Sample Street, London, SW1A 1AA'."""
    uprn = (row.get("uprn") or "").strip()
    code = postcode(row.get("postcode"))
    if not uprn.isdigit() or code is None:
        return None
    parts = [tidy(row.get(key)) for key in ("address1", "address2", "address3")]
    if not any(parts):
        parts = [tidy(part) for part in (clean(row.get("address")) or "").split(",")]
    parts = [part for part in parts if part]
    if not parts:
        return None
    town = tidy(row.get("posttown"))
    if town and town.lower() not in {part.lower() for part in parts}:
        parts.append(town)
    return str(int(uprn)), code, ", ".join(parts + [code])


def newer(candidate: tuple, current: tuple | None) -> bool:
    return current is None or candidate[1] >= current[1]


def extract_file(args: tuple[str, str]) -> tuple[str, int, dict[str, tuple]]:
    """(source, member): a year's file -> each UPRN's latest certificate as (facts, address or None)."""
    src, member = args
    latest: dict[str, tuple] = {}
    with epc_bulk.open_text(src, member) as handle:
        header = next(csv.reader([handle.readline()]))
        rows = 0
        for line in handle:
            # Cheap prefilter: an in-scope certificate carries its authority code.
            if "," + LAD_PREFIX not in line:
                continue
            try:
                values = next(csv.reader([line]))
            except (csv.Error, StopIteration):
                continue
            if len(values) != len(header):
                continue
            row = dict(zip(header, values))
            parsed = parse_row(row)
            if parsed is None:
                continue
            rows += 1
            current = latest.get(parsed[0])
            if newer(parsed, current[0] if current else None):
                latest[parsed[0]] = (parsed, parse_address(row))
    return member, rows, latest


def stage_extract() -> None:
    files = epc_bulk.members(EPC_SOURCE)
    os.makedirs(WORK, exist_ok=True)
    latest: dict[str, tuple] = {}
    stats = {"files": {}, "source": EPC_SOURCE}
    with Pool(min(len(files), os.cpu_count() or 4)) as pool:
        for member, rows, found in pool.imap_unordered(extract_file, [(EPC_SOURCE, m) for m in files]):
            name = os.path.basename(member)
            stats["files"][name] = {"london_rows_with_uprn": rows, "uprns": len(found),
                                    "bytes": epc_bulk.size(EPC_SOURCE, member)}
            print(f"extract: {name} {rows} rows, {len(found)} uprns", flush=True)
            for uprn, row in found.items():
                current = latest.get(uprn)
                if newer(row[0], current[0] if current else None):
                    latest[uprn] = row
    write_csv(OUT_CSV, COLUMNS, (latest[uprn][0] for uprn in sorted(latest)))
    addressed = [latest[uprn][1] for uprn in sorted(latest) if latest[uprn][1]]
    write_csv(ADDRESS_CSV, ADDRESS_COLUMNS, addressed)
    stats["uprns"] = len(latest)
    stats["addressed_uprns"] = len(addressed)
    with open(os.path.join(WORK, "epc-stats.json"), "w") as handle:
        json.dump(stats, handle, indent=1)
    print(f"extract: {len(latest)} London UPRNs -> {OUT_CSV}; {len(addressed)} with an address -> {ADDRESS_CSV}")


def write_csv(path: str, header: tuple, rows) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        for row in rows:
            writer.writerow(["" if value is None else value for value in row])
    os.replace(tmp, path)


def stage_load(url: str) -> None:
    import psycopg

    with psycopg.connect(url) as conn, conn.cursor() as cur:
        if cur.execute("SELECT 1 FROM source_release WHERE id = %s", (SOURCE_RELEASE_ID,)).fetchone() is None:
            sys.exit(f"source release {SOURCE_RELEASE_ID} is not registered")
        cur.execute("""CREATE TEMP TABLE staging_epc (
              uprn text, lodgement_date date, current_rating text, potential_rating text, property_type text,
              built_form text, construction_age_band text, total_floor_area double precision,
              habitable_rooms smallint, floor_level text)""")
        with open(OUT_CSV, newline="") as handle, cur.copy(
                "COPY staging_epc FROM STDIN WITH (FORMAT csv, HEADER true)") as copy:
            while chunk := handle.read(1 << 20):
                copy.write(chunk)
        loaded = cur.execute("SELECT load_property_epc(%s)", (SOURCE_RELEASE_ID,)).fetchone()[0]
        print(f"load: {loaded} property_epc rows under {SOURCE_RELEASE_ID}")
        load_epc_homes(cur)
        sales_source = SALES_SOURCE or cur.execute(
            "SELECT source_release_id FROM sale LIMIT 1").fetchone()[0]
        cur.execute("SET LOCAL work_mem = '512MB'")
        rows = cur.execute("SELECT rebuild_area_type_prices(%s)", (sales_source,)).fetchone()[0]
        print(f"load: rebuild_area_type_prices -> {rows} rows from {sales_source}")
        areas = cur.execute("SELECT rebuild_area_epc_rating(%s)", (SOURCE_RELEASE_ID,)).fetchone()[0]
        print(f"load: rebuild_area_epc_rating -> {areas} areas (migration 028)")


def load_epc_homes(cur) -> None:
    """EPC-only homes (migration 089) from the address file; skipped with an older extract that has none."""
    if not os.path.exists(ADDRESS_CSV):
        print(f"load: no {ADDRESS_CSV}; property_epc_home left as it is (re-run extract)")
        return
    cur.execute("CREATE TEMP TABLE staging_epc_address (uprn text PRIMARY KEY, postcode text, display_address text)")
    with open(ADDRESS_CSV, newline="") as handle, cur.copy(
            "COPY staging_epc_address FROM STDIN WITH (FORMAT csv, HEADER true)") as copy:
        while chunk := handle.read(1 << 20):
            copy.write(chunk)
    homes = cur.execute("SELECT load_property_epc_home(%s)", (SOURCE_RELEASE_ID,)).fetchone()[0]
    print(f"load: {homes} property_epc_home rows (EPC-only homes, CLOSE_KNIT_EPC_ADDRESSES) under {SOURCE_RELEASE_ID}")


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else ""
    if stage == "extract":
        stage_extract()
    elif stage == "load" and len(sys.argv) > 2:
        stage_load(sys.argv[2])
    else:
        sys.exit(__doc__)
