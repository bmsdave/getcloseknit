"""Food businesses in the coverage from the FSA Food Hygiene Rating Scheme (migration 031).

Source: Food Standards Agency, FHRS open data (OGL v3). One XML file per local
authority (https://ratings.food.gov.uk/OpenDataFiles/FHRS<code>en-GB.xml), picked by RegionName
in authorities.json: the 33 London authorities, or every English one (all FSA regions but
Scotland, Wales and Northern Ireland). CLOSE_KNIT_ETL_COVERAGE picks the coverage (england by
default, or london; area_analytics.coverage). An England build is its own source release
(`src-fsa-fhrs-england-<yyyy-mm>`) that replaces the London one.
Kept per business: FHRS id, name, business type, the published rating and its date,
the authority and a point. Addresses, postcodes, contact details and inspection
scores are dropped (data minimisation). Businesses without a geocode are skipped and
counted.

Stages (work files go to $AE_WORK, default ~/data/aework/fhrs; FHRS_DIR is the XML folder,
default ~/data/fhrs/2026-10; FHRS_RETRIEVED the download date):
  download    fetch authorities.json and the coverage's XML files into FHRS_DIR
  build       read FHRS_DIR/*.xml and write food_business.tsv and sources.json
  load URL    load the TSV into the migration 031 table (psycopg needed); an England load
              replaces the rows of the London release

  python3 -m area_analytics.food_hygiene download
  python3 -m area_analytics.food_hygiene build
  uv run --with 'psycopg[binary]' python -m area_analytics.food_hygiene load postgresql://...

Everything except load is pure and dependency-free.
"""
from __future__ import annotations

import glob
import hashlib
import json
import os
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter
from typing import Iterable

from . import coverage, workfiles

COVERAGE = coverage.from_env()
DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
WORK = os.environ.get("AE_WORK", os.path.join(DATA, "aework", "fhrs"))
FHRS_DIR = os.environ.get("FHRS_DIR", os.path.join(DATA, "fhrs", "2026-10"))
FHRS_URL = "https://ratings.food.gov.uk/open-data"
AUTHORITIES_URL = "https://api.ratings.food.gov.uk/Authorities"
FHRS_RETRIEVED = os.environ.get("FHRS_RETRIEVED", "2026-10-07")
LONDON_SOURCE = "src-fsa-fhrs-2026-10"  # the London build (2026-10-07)
FHRS_SOURCE = (LONDON_SOURCE if COVERAGE.name == "london"
               else f"src-fsa-fhrs-{COVERAGE.name}-{FHRS_RETRIEVED[:7]}")
# FSA regions outside England (authorities.json RegionName).
OTHER_NATIONS = frozenset({"Scotland", "Wales", "Northern Ireland"})
ETL_VERSION = "close-knit-fhrs-1"
FHRS_ATTRIBUTION = ("Food hygiene ratings: Food Standards Agency (ratings.food.gov.uk). "
                    "Contains public sector information licensed under the Open Government Licence v3.0.")
COLUMNS = ("fhrs_id", "name", "business_type", "business_type_id", "rating", "rating_date",
           "local_authority", "location")
_FILE = re.compile(r"FHRS(\d+)en-GB\.xml$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}")


def _text(element: ET.Element, tag: str) -> str | None:
    value = element.findtext(tag)
    value = value.strip() if value else ""
    return value or None


def _coordinate(value: str | None, low: float, high: float) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if low <= number <= high else None


def london_codes(authorities: dict) -> set[str]:
    """LocalAuthorityIdCode of every London authority in the FSA authorities listing."""
    return {a["LocalAuthorityIdCode"] for a in authorities["authorities"] if a.get("RegionName") == "London"}


def coverage_codes(authorities: dict, scope: coverage.Coverage = COVERAGE) -> set[str]:
    """LocalAuthorityIdCode of every authority of the coverage: London's, or every English one."""
    if scope.name == "london":
        return london_codes(authorities)
    return {a["LocalAuthorityIdCode"] for a in authorities["authorities"]
            if a.get("RegionName") and a["RegionName"] not in OTHER_NATIONS}


def _get(url: str, headers: dict | None = None) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "close-knit-ingest", **(headers or {})})
    with urllib.request.urlopen(request, timeout=300) as response:
        return response.read()


def download() -> None:
    """authorities.json and each coverage authority's XML file, into FHRS_DIR (skips files already there)."""
    os.makedirs(FHRS_DIR, exist_ok=True)
    listing_path = os.path.join(FHRS_DIR, "authorities.json")
    if not os.path.exists(listing_path):
        body = _get(f"{AUTHORITIES_URL}?pageSize=0", {"x-api-version": "2", "Accept": "application/json"})
        with open(listing_path, "wb") as handle:
            handle.write(body)
    with open(listing_path) as handle:
        authorities = json.load(handle)
    codes = coverage_codes(authorities)
    fetched = 0
    for code in sorted(codes, key=int):
        path = os.path.join(FHRS_DIR, f"FHRS{code}en-GB.xml")
        if os.path.exists(path):
            continue
        body = _get(f"https://ratings.food.gov.uk/OpenDataFiles/FHRS{code}en-GB.xml")
        with open(path + ".part", "wb") as handle:
            handle.write(body)
        os.replace(path + ".part", path)
        fetched += 1
    print(f"download: {len(codes)} {COVERAGE.name} authorities, {fetched} fetched into {FHRS_DIR}")


def establishments(source) -> tuple[str | None, list[dict], Counter]:
    """(extract date, kept rows, skip counts) for one authority file (path or file object)."""
    extract, rows, skipped = None, [], Counter()
    for _, element in ET.iterparse(source):
        if element.tag == "ExtractDate":
            extract = (element.text or "").strip() or None
        if element.tag != "EstablishmentDetail":
            continue
        fhrs_id = _text(element, "FHRSID")
        lon = _coordinate(element.findtext("Geocode/Longitude"), -180, 180)
        lat = _coordinate(element.findtext("Geocode/Latitude"), -90, 90)
        if fhrs_id is None or not fhrs_id.isdigit():
            skipped["no id"] += 1
        elif lon is None or lat is None or (lon == 0 and lat == 0):
            skipped["no geocode"] += 1
        else:
            type_id = _text(element, "BusinessTypeID")
            rated = _text(element, "RatingDate")
            rows.append({
                "fhrs_id": int(fhrs_id), "name": _text(element, "BusinessName"),
                "business_type": _text(element, "BusinessType"),
                "business_type_id": int(type_id) if type_id and type_id.lstrip("-").isdigit() else None,
                "rating": _text(element, "RatingValue"),
                "rating_date": rated[:10] if rated and _DATE.match(rated) else None,
                "local_authority": _text(element, "LocalAuthorityName"),
                "location": f"SRID=4326;POINT({lon} {lat})"})
        element.clear()
    return extract, rows, skipped


def merge(parts: Iterable[tuple[list[dict], Counter]]) -> tuple[list[dict], Counter]:
    """Rows from every file, first occurrence of an FHRS id kept; duplicates counted as skipped."""
    rows: dict[int, dict] = {}
    skipped: Counter = Counter()
    for found, skips in parts:
        skipped.update(skips)
        for row in found:
            if row["fhrs_id"] in rows:
                skipped["duplicate id"] += 1
            else:
                rows[row["fhrs_id"]] = row
    return sorted(rows.values(), key=lambda row: row["fhrs_id"]), skipped


def _escape(value) -> str:
    """One COPY text-format field (NULL is the empty string)."""
    if value is None:
        return ""
    text = str(value)
    return (text.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n").replace("\r", "\\r"))


def tsv_line(row: dict) -> str:
    return "\t".join(_escape(row[column]) for column in COLUMNS)


def files_sha256(paths: list[str]) -> str:
    """One digest over every input file: names and contents, in name order."""
    digest = hashlib.sha256()
    for path in sorted(paths, key=os.path.basename):
        digest.update(os.path.basename(path).encode() + b"\0")
        with open(path, "rb") as handle:
            for block in iter(lambda: handle.read(1 << 20), b""):
                digest.update(block)
    return digest.hexdigest()


def build() -> None:
    os.makedirs(WORK, exist_ok=True)
    with open(os.path.join(FHRS_DIR, "authorities.json")) as handle:
        codes = coverage_codes(json.load(handle))
    paths = sorted(path for path in glob.glob(os.path.join(FHRS_DIR, "FHRS*en-GB.xml"))
                   if _FILE.search(path) and _FILE.search(path).group(1) in codes)
    if not paths:
        raise SystemExit(f"no {COVERAGE.name} FHRS files in {FHRS_DIR}")
    parts, extracts = [], []
    for path in paths:
        extract, found, skips = establishments(path)
        extracts.append(extract)
        parts.append((found, skips))
    rows, skipped = merge(parts)
    with workfiles.open_text(workfiles.name(WORK, "food_business.tsv", COVERAGE), "w") as handle:
        for row in rows:
            handle.write(tsv_line(row) + "\n")
    types = Counter(row["business_type"] for row in rows)
    with open(os.path.join(WORK, "sources.json"), "w") as handle:
        json.dump({"sha256": files_sha256(paths + [os.path.join(FHRS_DIR, "authorities.json")]),
                   "coverage": COVERAGE.name, "retrieved": FHRS_RETRIEVED, "files": len(paths), "extract_date": max(e for e in extracts if e), "rows": len(rows),
                   "skipped": dict(skipped), "business_types": dict(types.most_common())}, handle, indent=1)
    print(f"build: {len(paths)} files, {len(rows)} rows, skipped {dict(skipped)}")
    for name, count in types.most_common():
        print(f"  {count:6d}  {name}")


def source_release(sources: dict) -> tuple:
    """(id, url, release_date, sha256, licence, attribution, caveats) for the loaded files."""
    scope = sources.get("coverage", "london")
    source_id = (LONDON_SOURCE if scope == "london"
                 else f"src-fsa-fhrs-{scope}-{sources.get('retrieved', FHRS_RETRIEVED)[:7]}")
    which = "London" if scope == "london" else "English"
    return (source_id, FHRS_URL, sources["extract_date"], sources["sha256"], "OGL-3.0", FHRS_ATTRIBUTION,
            [f"FSA Food Hygiene Rating Scheme register for the {sources['files']} {which} authorities, "
             f"extract of {sources['extract_date']}, retrieved {sources.get('retrieved', FHRS_RETRIEVED)}.",
             "A rating reflects the business on the day of its last inspection; ratings can be months or "
             "years old and some businesses are awaiting inspection or exempt.",
             f"Businesses without a published location ({sources['skipped'].get('no geocode', 0)}) are "
             "left out, so counts near a place understate what is there.",
             "The register lists food businesses of every kind (including caring premises, schools and "
             "manufacturers), not only places that serve the public."])


def load(url: str) -> None:
    import psycopg

    with open(os.path.join(WORK, "sources.json")) as handle:
        sources = json.load(handle)
    source_id, source_url, released, sha, licence, attribution, caveats = source_release(sources)
    with workfiles.open_text(workfiles.name(WORK, "food_business.tsv", COVERAGE)) as handle:
        body = "".join(f"{line}\t{source_id}\n" for line in handle.read().splitlines())
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
                 attribution, transformation_version, geography_vintage, validation_status, caveats)
               VALUES (%s, %s, now(), %s, %s, %s, %s, %s, '2021', 'passed', %s)
               ON CONFLICT (id) DO NOTHING""",
            (source_id, source_url, released, sha, licence, attribution, ETL_VERSION, caveats))
        # A national build replaces the London one (same businesses, newer extract) and its own earlier rows.
        replaced = [source_id] if source_id == LONDON_SOURCE else [source_id, LONDON_SOURCE]
        cur.execute("DELETE FROM food_business WHERE source_release_id = ANY(%s)", (replaced,))
        with cur.copy(f"COPY food_business ({', '.join(COLUMNS)}, source_release_id) FROM STDIN "
                      "WITH (FORMAT text, NULL '')") as copy:
            copy.write(body)
        print("load:", cur.execute("SELECT count(*) FROM food_business").fetchone()[0], "rows")


def main(argv: list[str]) -> None:
    stage = argv[1] if len(argv) > 1 else ""
    if stage == "download":
        download()
    elif stage == "build":
        build()
    elif stage == "load" and len(argv) == 3:
        load(argv[2])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
