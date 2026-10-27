"""Company and overseas ownership (migration 083) from HM Land Registry's monthly full files:
UK companies that own property (CCOD) and Overseas companies that own property (OCOD).

Only four columns are read: Title Number, Region, Postcode and District. Proprietor names, company
numbers and addresses are never read into memory past the CSV reader, and nothing but counts is
stored. Each title in coverage (England by default: every title, placed by its English postcode;
CLOSE_KNIT_ETL_COVERAGE=london: Region "GREATER LONDON") is counted once (a title in both files counts
as overseas), placed in an LSOA by its postcode (ONSPD, `postcode_civic`, terminated postcodes included);
titles with no usable postcode are counted on their borough (LAD) by District as `unmatched` and reported
in the log. Homes per LSOA are the rows in `property` (London's UPRNs); LSOAs without any use the VOA
council tax homes (`area_council_tax_band.total`). MSOAs and boroughs are sums of LSOAs.

  AE_WORK=~/data/aework/ownership HMLR_API_KEY=… python3 etl_ownership.py download
  AE_WORK=~/data/aework/ownership python3 etl_ownership.py load <database-url>

Download needs the owner's Use land and property data API key (free account, licence accepted);
without one, put CCOD_FULL_YYYY_MM.zip and OCOD_FULL_YYYY_MM.zip in AE_WORK by hand. Load needs
psycopg; download and parsing are stdlib only.
"""
from __future__ import annotations

import csv
import glob
import hashlib
import io
import json
import os
import re
import sys
import urllib.request
import zipfile
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass, field
from typing import IO

import area_coverage as coverage

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
WORK = os.environ.get("AE_WORK", os.path.join(DATA, "aework", "ownership"))
ETL_VERSION = "close-knit-ownership-1"
API = "https://use-land-property-data.service.gov.uk/api/v1/datasets"
PAGE = "https://use-land-property-data.service.gov.uk/datasets"
DATASETS = ("ccod", "ocod")
SOURCE_PREFIX = "src-hmlr-ownership"
LICENCE = "HM Land Registry CCOD/OCOD licence (Use land and property data); aggregate display to be confirmed by the owner"
ATTRIBUTION = "Contains HM Land Registry data © Crown copyright and database right {year}."
CAVEATS = [
    "Counts land titles, not homes: one title can hold a whole block, and a home can sit on more than one title.",
    "Includes commercial titles whose address looks residential.",
    "Titles are placed by the postcode in their address; titles with none are counted on the borough only.",
]
# The columns read; every other column (proprietors, company numbers, addresses, prices) is skipped.
COLUMNS = ("Title Number", "Region", "Postcode", "District")
POSTCODE = re.compile(r"^([A-Z]{1,2}[0-9][A-Z0-9]?)([0-9][A-Z]{2})$")
FILE_MONTH = re.compile(r"_(\d{4})_(\d{2})\.(?:zip|csv)$", re.IGNORECASE)

csv.field_size_limit(1 << 30)


def path(name: str) -> str:
    return os.path.join(WORK, name)


def _api(url: str, key: str) -> dict:
    request = urllib.request.Request(url, headers={"Authorization": key, "Accept": "application/json",
                                                   "User-Agent": "close-knit-etl"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.load(response)


def download() -> None:
    """The latest full file of each dataset into AE_WORK, with its sha256."""
    os.makedirs(WORK, exist_ok=True)
    key = os.environ.get("HMLR_API_KEY", "").strip()
    if not key:
        sys.exit(f"HMLR_API_KEY is not set: download CCOD_FULL_*.zip and OCOD_FULL_*.zip from {PAGE} "
                 f"under the owner's account and put them in {WORK}")
    for dataset in DATASETS:
        resources = _api(f"{API}/{dataset}", key).get("result", {}).get("resources", [])
        names = sorted(r["file_name"] for r in resources if re.match(rf"{dataset}_FULL_\d{{4}}_\d{{2}}\.zip$",
                                                                      r.get("file_name", ""), re.IGNORECASE))
        if not names:
            sys.exit(f"{dataset}: no full file listed")
        name = names[-1]
        target = path(name)
        if not os.path.exists(target):
            url = _api(f"{API}/{dataset}/{name}", key)["result"]["download_url"]
            with urllib.request.urlopen(url, timeout=1800) as response, open(target + ".tmp", "wb") as handle:
                while chunk := response.read(1 << 20):
                    handle.write(chunk)
            os.replace(target + ".tmp", target)
        print(f"download: {name} {os.path.getsize(target) // 1024} KiB sha256 {sha256(target)}", flush=True)


def sha256(file: str) -> str:
    digest = hashlib.sha256()
    with open(file, "rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def latest(dataset: str) -> str:
    files = sorted(glob.glob(path(f"{dataset.upper()}_FULL_*.zip")))
    if not files:
        sys.exit(f"no {dataset.upper()}_FULL_*.zip in {WORK}: run download or place the file there")
    return files[-1]


def file_period(name: str) -> str:
    """'CCOD_FULL_2026_10.zip' -> '2026-10-01', the month the file describes."""
    match = FILE_MONTH.search(os.path.basename(name))
    if not match:
        sys.exit(f"{name}: expected <DATASET>_FULL_YYYY_MM")
    return f"{match.group(1)}-{match.group(2)}-01"


def normal_postcode(text: str | None) -> str | None:
    """'nw11ab' -> 'NW1 1AB' (ONSPD pcds); None when it is not a full UK postcode."""
    compact = re.sub(r"\s+", "", (text or "").upper())
    match = POSTCODE.match(compact)
    return f"{match.group(1)} {match.group(2)}" if match else None


def titles(handle: IO[str], cov: coverage.Coverage | None = None) -> Iterator[tuple[str, str | None, str]]:
    """(title number, postcode or None, District) for each title in coverage, once per title: Greater
    London's for London; for England every title outside Wales and Scotland (placement decides)."""
    cov = cov or coverage.from_env()
    reader = csv.reader(handle)
    header = next(reader, [])
    missing = [column for column in COLUMNS if column not in header]
    if missing:
        sys.exit(f"unexpected CCOD/OCOD layout, missing: {', '.join(missing)}")
    title, region, postcode, district = (header.index(column) for column in COLUMNS)
    seen: set[str] = set()
    for row in reader:
        if len(row) <= max(title, region, postcode, district):
            continue
        where = row[region].strip().upper()
        if (where != "GREATER LONDON") if cov.name == "london" else (where in ("WALES", "SCOTLAND")):
            continue
        number = row[title].strip()
        if not number or number in seen:
            continue
        seen.add(number)
        yield number, normal_postcode(row[postcode]), row[district].strip().upper()


def zip_titles(source) -> Iterator[tuple[str, str | None, str]]:
    with zipfile.ZipFile(source) as archive:
        member = next(name for name in archive.namelist() if name.lower().endswith(".csv"))
        with archive.open(member) as raw:
            yield from titles(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""))


def _district(name: str) -> str:
    text = re.sub(r"\s+", " ", name.upper().replace("&", "AND")).strip()
    return re.sub(r"^(?:CITY OF |LONDON BOROUGH OF |ROYAL BOROUGH OF )(?!LONDON$)", "", text)


def borough_names(boroughs: Mapping[str, str]) -> dict[str, str]:
    """HMLR District ('CITY OF WESTMINSTER') -> borough id, from {borough id: name}."""
    names: dict[str, str] = {}
    for gid, name in boroughs.items():
        names[_district(name)] = gid
        names[name.upper()] = gid
        names["CITY OF " + _district(name)] = gid
    return names


@dataclass
class Tally:
    lsoas: dict[str, list[int]] = field(default_factory=dict)   # LSOA code -> [company, overseas]
    unmatched: dict[str, int] = field(default_factory=dict)     # borough id -> titles with no LSOA
    unplaced: int = 0                                           # no LSOA and no known District


def tally(company: Iterable[tuple], overseas: Iterable[tuple], lookup: Mapping[str, str],
          districts: Mapping[str, str]) -> Tally:
    """Count each title once, overseas first; `lookup` maps compact postcodes ('NW11AA') to LSOA codes."""
    result = Tally()
    counted: set[str] = set()
    for column, rows in ((1, overseas), (0, company)):
        for number, postcode, district in rows:
            if number in counted:
                continue
            counted.add(number)
            lsoa = lookup.get(postcode.replace(" ", "")) if postcode else None
            if lsoa:
                result.lsoas.setdefault(lsoa, [0, 0])[column] += 1
            elif borough := districts.get(district) or districts.get(_district(district)):
                result.unmatched[borough] = result.unmatched.get(borough, 0) + 1
            else:
                result.unplaced += 1
    return result


# --- Load -------------------------------------------------------------------------------------

def insert_release(cur, digest: str, period: str) -> str:
    """Immutable: the id carries both files' content hash, so new files are a new release."""
    release_id = f"{SOURCE_PREFIX}-{period[:7]}-{digest[:12]}"
    cur.execute(
        """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence, attribution,
             transformation_version, geography_vintage, validation_status, caveats)
           VALUES (%s, %s, now(), %s, %s, %s, %s, %s, '2021', 'passed', %s) ON CONFLICT (id) DO NOTHING""",
        (release_id, PAGE, period, digest, LICENCE, ATTRIBUTION.format(year=period[:4]), ETL_VERSION, CAVEATS))
    return release_id


def load(url: str) -> None:
    import psycopg
    from psycopg.rows import dict_row

    import stage_release

    ccod, ocod = latest("ccod"), latest("ocod")
    period = file_period(ccod)
    if file_period(ocod) != period:
        sys.exit(f"CCOD and OCOD months differ: {os.path.basename(ccod)}, {os.path.basename(ocod)}")
    digest = hashlib.sha256((sha256(ccod) + sha256(ocod)).encode()).hexdigest()
    print(f"load: {os.path.basename(ccod)} sha256 {sha256(ccod)}; {os.path.basename(ocod)} sha256 {sha256(ocod)}")
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        lookup = dict(cur.execute("SELECT replace(postcode, ' ', ''), lsoa_code FROM postcode_civic "
                                  "WHERE lsoa_code IS NOT NULL").fetchall())
        boroughs = dict(cur.execute("SELECT id, name FROM area_geography WHERE kind = 'lad'").fetchall())
        result = tally(zip_titles(ccod), zip_titles(ocod), lookup, borough_names(boroughs))
        homes = dict(cur.execute("SELECT p.geography_id, count(*) FROM property p JOIN area_geography g "
                                 "ON g.id = p.geography_id AND g.kind = 'lsoa' GROUP BY 1").fetchall())
        # Outside London there is no UPRN list: the VOA council tax homes are the denominator.
        for gid, total in cur.execute("SELECT t.geography_id, t.total FROM area_council_tax_band t JOIN "
                                      "area_geography g ON g.id = t.geography_id AND g.kind = 'lsoa'").fetchall():
            homes.setdefault(gid, total)
        release = insert_release(cur, digest, period)
        cur.execute("DELETE FROM area_ownership")
        cur.execute("CREATE TEMP TABLE stage_ownership (code text, company integer, overseas integer) ON COMMIT DROP")
        with cur.copy("COPY stage_ownership (code, company, overseas) FROM STDIN") as copy:
            for code, (company, overseas) in result.lsoas.items():
                copy.write_row((code, company, overseas))
        cur.execute(
            """INSERT INTO area_ownership (geography_id, titles_company, titles_overseas, homes, unmatched, source_release_id)
               SELECT g.id, coalesce(s.company, 0), coalesce(s.overseas, 0), coalesce(h.homes, 0), 0, %s
               FROM area_geography g
               LEFT JOIN stage_ownership s ON 'uk:lsoa:' || s.code = g.id
               LEFT JOIN unnest(%s::text[], %s::int[]) h(geography_id, homes) ON h.geography_id = g.id
               WHERE g.kind = 'lsoa' AND (s.code IS NOT NULL OR h.homes IS NOT NULL)""",
            (release, list(homes), list(homes.values())))
        outside = cur.execute("SELECT coalesce(sum(company + overseas), 0) FROM stage_ownership s WHERE NOT EXISTS "
                              "(SELECT 1 FROM area_geography g WHERE g.id = 'uk:lsoa:' || s.code)").fetchone()[0]
        for borough, count in result.unmatched.items():
            cur.execute("""INSERT INTO area_ownership (geography_id, titles_company, titles_overseas, homes, unmatched,
                             source_release_id) VALUES (%s, 0, 0, 0, %s, %s)""", (borough, count, release))
        areas = cur.execute("SELECT roll_up_area_ownership()").fetchone()[0]
        values = cur.execute("SELECT load_ownership_metrics(%s, %s)", (release, period)).fetchone()[0]
        placed = sum(sum(counts) for counts in result.lsoas.values()) - outside
        print(f"ownership: {placed} titles in LSOAs, {sum(result.unmatched.values())} unmatched (borough only), "
              f"{outside} in LSOAs outside the geography, {result.unplaced} unplaced; {areas} areas, {values} metric values")
        members = {row[0] for row in cur.execute(
            """SELECT source_release_id FROM product_release_member
               WHERE release_id = (SELECT release_id FROM active_product_release)""")}
        cur.row_factory = dict_row
        stage_release.stage(cur, "ownership", [release],
                            replace=tuple(m for m in members if m.startswith(SOURCE_PREFIX) and m != release))


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "download" and len(sys.argv) == 2:
        download()
    elif command == "load" and len(sys.argv) == 3:
        load(sys.argv[2])
    else:
        sys.exit(__doc__)
