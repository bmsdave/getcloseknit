"""The area card's Home theme (migration 063): can I extend, broadband, settledness.

  restrictions  Article 4 direction areas and listed buildings from planning.data.gov.uk (OGL v3;
                listed buildings © Historic England), with the conservation areas already loaded
                (migration 030): `article4_area`, `article4_coverage`, `listed_building`, then
                rebuild_area_restriction(). Only directions that remove householder rights (GPDO
                Part 1: extensions, roofs, porches, outbuildings) count as restricting; a council
                (LAD) with no published Article 4 data is "not published", never "none".
  broadband     Ofcom Connected Nations (OGL v3): residential premises and those with gigabit
                available per 2021 output area, summed to LSOAs (ONSPD's OA → LSOA), and each
                LAD's full-fibre share (Ofcom publishes full fibre for local authorities only).
The coverage (area_analytics.coverage: England by default, CLOSE_KNIT_ETL_COVERAGE=london) picks the
councils, LADs and boxes kept.
  settled       Census 2021 TS019 migrant indicator (OGL v3): usual residents at the same address
                a year before Census day, per LSOA.
Every level above the LSOA is a sum of LSOAs (roll_up_area_home), so the levels agree.

  AE_WORK=~/data/aework/home python3 etl_home.py download
  AE_WORK=~/data/aework/home python3 etl_home.py load <database-url> [restrictions|broadband|settled]

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
from collections import Counter
from collections.abc import Iterable, Iterator
from datetime import date, datetime

import area_coverage as coverage

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
WORK = os.environ.get("AE_WORK", os.path.join(DATA, "aework", "home"))
# The ONS Postcode Directory zip (or an extracted CSV with oa21cd, lsoa21cd and rgn26cd columns).
ONSPD = os.environ.get("AE_ONSPD", os.path.join(DATA, "civic", "ONSPD_AUG_2026.zip"))
ETL_VERSION = "close-knit-home-1"
PLANNING = "https://files.planning.data.gov.uk"
OFCOM_ZIP = ("https://www.ofcom.org.uk/siteassets/resources/documents/research-and-data/multi-sector/"
             "infrastructure-research/connected-nations-spring-2026/"
             "202601_fixed_broadband_coverage_and_full_fibre_take-up-r1.zip")
FILES = {
    "article-4-direction-area.csv": f"{PLANNING}/dataset/article-4-direction-area.csv",
    "listed-building.csv": f"{PLANNING}/dataset/listed-building.csv",
    "organisation.csv": f"{PLANNING}/organisation-collection/dataset/organisation.csv",
    "connected-nations.zip": OFCOM_ZIP,
    "census2021-ts019.zip": "https://www.nomisweb.co.uk/output/census/2021/census2021-ts019.zip",
}
OFCOM_RELEASE = date(2026, 1, 1)  # the Spring 2026 update describes coverage in January 2026
GRADES = {"I": "I", "II*": "II*", "II": "II", "2": "II", "2*": "II*", "1": "I"}
# GPDO 2015 Schedule 2 Part 1: development within the curtilage of a dwellinghouse.
# Codes as planning.data.gov.uk writes them ("1A;1B", "1AA") or as councils do ("Part 1 Class C").
HOUSEHOLDER_CODE = re.compile(r"(?:^|[;,\s])1(?:AA?|[B-H])(?:$|[;,\s])|part\s*1\b", re.IGNORECASE)
# Article 4(2) directions are the conservation-area kind: householder works facing a road.
HOUSEHOLDER_WORDS = re.compile(r"extension|enlarge|roof|porch|dwellinghouse|householder|outbuilding|"
                               r"window|door|chimney|front garden|hard surface|curtilage|conservation area|"
                               r"article\s*4\s*\(2\)", re.IGNORECASE)
CHANGE_OF_USE_WORDS = re.compile(r"change of use|\bHMO\b|house in multiple|\bC4\b|class (?:e|ma|o)\b|office|"
                                 r"commercial|demolition of", re.IGNORECASE)
TS019_TOTAL = "Migrant indicator: Total: All usual residents; measures: Value"
TS019_SAME = ("Migrant indicator: Address one year ago is the same as the address of enumeration; "
              "measures: Value")

csv.field_size_limit(1 << 30)


def path(name: str) -> str:
    return os.path.join(WORK, name)


def download() -> None:
    os.makedirs(WORK, exist_ok=True)
    for name, url in FILES.items():
        target = path(name)
        if os.path.exists(target):
            continue
        request = urllib.request.Request(url, headers={"User-Agent": "close-knit-etl"})
        with urllib.request.urlopen(request, timeout=900) as response, open(target + ".tmp", "wb") as handle:
            while chunk := response.read(1 << 20):
                handle.write(chunk)
        os.replace(target + ".tmp", target)
        print(f"download: {name} {os.path.getsize(target) // 1024} KiB", flush=True)


def sha256(*names: str) -> str:
    digest = hashlib.sha256()
    for name in names:
        with open(path(name), "rb") as handle:
            while chunk := handle.read(1 << 20):
                digest.update(chunk)
    return digest.hexdigest()


# --- Article 4 and listed buildings -----------------------------------------------------------

def householder(rights: str, *texts: str) -> bool:
    """True when a direction removes householder rights: a Part 1 class code (1A-1H), or, without
    codes, words about extensions, roofs or windows and none about changes of use."""
    rights = rights or ""
    if HOUSEHOLDER_CODE.search(rights):
        return True
    if re.search(r"\b\d{1,2}[A-Z]{1,2}\b", rights):  # other classes only (3MA, 2C, 11B…)
        return False
    words = " ".join(filter(None, (rights, *texts)))
    return bool(HOUSEHOLDER_WORDS.search(words)) and not CHANGE_OF_USE_WORDS.search(words)


def councils(rows: Iterable[dict], cov: coverage.Coverage | None = None) -> dict[str, str]:
    """organisation entity -> LAD code, for the live local-authority councils in the coverage (the planning
    authorities: London boroughs, unitaries, metropolitan and shire districts)."""
    cov = cov or coverage.from_env()
    out = {}
    for row in rows:
        if row.get("dataset") != "local-authority" or row.get("end-date"):
            continue
        # The list can carry a council's pre-2023 code (Barnsley, Sheffield): resolved by name.
        lad = coverage.current_lad(row.get("statistical-geography"), row.get("name", ""), row.get("region"))
        if cov.contains_lad(lad):
            out[row["entity"]] = lad
    return out


def article4_rows(rows: Iterable[dict], boroughs: dict[str, str]) -> Iterator[tuple]:
    """(id, name, reference, LAD, householder, wkt) for the councils' live directions with a geometry."""
    for row in rows:
        borough = boroughs.get(row.get("organisation-entity", ""))
        if not borough or row.get("end-date") or not row.get("geometry"):
            continue
        yield (f"pd:{row['entity']}", row.get("name") or None, row.get("reference") or None, borough,
               householder(row.get("permitted-development-rights", ""), row.get("description", ""), row.get("name", "")),
               row["geometry"])


def article4_coverage(rows: Iterable[tuple], cov: coverage.Coverage | None = None) -> dict[str, int]:
    """Every LAD in the coverage -> how many Article 4 areas its council has published (0 = none published)."""
    cov = cov or coverage.from_env()
    counts = Counter(row[3] for row in rows)
    return {code: counts.get(code, 0) for code in sorted(cov.lad_codes)}


POINT = re.compile(r"POINT\s*\(\s*(-?[0-9.]+)\s+(-?[0-9.]+)\s*\)")


def listed_rows(rows: Iterable[dict], cov: coverage.Coverage | None = None) -> Iterator[tuple]:
    """(id, name, grade, lon, lat) for current listings inside the coverage's box."""
    x0, y0, x1, y1 = (cov or coverage.from_env()).bbox_wgs84
    for row in rows:
        match = POINT.match(row.get("point", ""))
        grade = GRADES.get((row.get("listed-building-grade") or "").strip().upper())
        if not match or not grade or row.get("end-date"):
            continue
        lon, lat = float(match[1]), float(match[2])
        if x0 <= lon <= x1 and y0 <= lat <= y1:
            yield f"nhle:{row.get('reference') or row['entity']}", row.get("name") or None, grade, lon, lat


def newest_entry(name: str) -> date:
    with open(path(name), newline="", encoding="utf-8") as handle:
        return max(date.fromisoformat(row["entry-date"][:10]) for row in csv.DictReader(handle) if row.get("entry-date"))


# --- Broadband --------------------------------------------------------------------------------

def _member(archive: zipfile.ZipFile, pattern: str) -> str:
    names = [name for name in archive.namelist() if re.search(pattern, name)]
    if len(names) != 1:
        raise SystemExit(f"Ofcom zip: expected one file matching {pattern}, found {names}")
    return names[0]


def _number(text: str) -> float:
    return float(text) if text not in ("", None) else 0.0


def ofcom_output_areas(source) -> dict[str, tuple[int, int]]:
    """Output area -> (residential premises, those with gigabit available)."""
    with zipfile.ZipFile(source) as archive, archive.open(_member(archive, r"_fixed_oa_res_coverage_r\d+\.csv$")) as raw:
        reader = csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig"))
        return {row["output_area"]: (int(_number(row["All Premises"])),
                                     int(_number(row["Number of premises with Gigabit availability"])))
                for row in reader if row["output_area"].startswith("E00")}


def ofcom_full_fibre(source, cov: coverage.Coverage | None = None) -> dict[str, float]:
    """LAD in the coverage -> share of residential premises with full fibre available (0-1)."""
    cov = cov or coverage.from_env()
    with zipfile.ZipFile(source) as archive, archive.open(_member(archive, r"_fixed_laua_res_coverage_r\d+\.csv$")) as raw:
        reader = csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig"))
        out = {}
        for row in reader:
            premises = _number(row["All Premises"])
            if cov.contains_lad(row["laua"]) and premises > 0:
                out[row["laua"]] = round(min(1.0, _number(row["Number of premises with Full Fibre availability"]) / premises), 4)
        return out


def oa_to_lsoa(rows: Iterable[dict], cov: coverage.Coverage | None = None) -> dict[str, str]:
    """2021 output area -> LSOA from ONSPD rows in the coverage's regions (every OA nests in one LSOA).
    Rows without a region column (an extract already cut to the coverage) are kept."""
    cov = cov or coverage.from_env()
    return {row["oa21cd"]: row["lsoa21cd"] for row in rows if row.get("oa21cd") and row.get("lsoa21cd")
            and ("rgn26cd" not in row or cov.contains_region(row["rgn26cd"]))}


def onspd_lines(source: str) -> Iterator[str]:
    """The ONSPD data CSV's lines, from the zip (streamed) or an extracted CSV."""
    if not source.endswith(".zip"):
        with open(source, newline="", encoding="utf-8") as handle:
            yield from handle
        return
    with zipfile.ZipFile(source) as archive:
        name = next(n for n in archive.namelist() if re.fullmatch(r"Data/ONSPD_[A-Z]{3}_[0-9]{4}_UK\.csv", n))
        with archive.open(name) as raw:
            yield from io.TextIOWrapper(raw, encoding="utf-8", newline="")


def broadband_lsoas(areas: dict[str, tuple[int, int]], lookup: dict[str, str]) -> dict[str, tuple[int, int]]:
    out: dict[str, list[int]] = {}
    for oa, (premises, gigabit) in areas.items():
        lsoa = lookup.get(oa)
        if lsoa:
            total = out.setdefault(lsoa, [0, 0])
            total[0] += premises
            total[1] += min(gigabit, premises)
    return {lsoa: (premises, gigabit) for lsoa, (premises, gigabit) in out.items() if premises > 0}


# --- Settled ----------------------------------------------------------------------------------

def ts019_lsoas(source) -> dict[str, tuple[int, int]]:
    """LSOA -> (usual residents, at the same address a year before)."""
    with zipfile.ZipFile(source) as archive, archive.open("census2021-ts019-lsoa.csv") as raw:
        reader = csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig"))
        missing = {TS019_TOTAL, TS019_SAME} - set(reader.fieldnames or ())
        if missing:
            raise SystemExit(f"TS019: columns missing {sorted(missing)}")
        return {row["geography code"]: (int(row[TS019_TOTAL]), int(row[TS019_SAME]))
                for row in reader if int(row[TS019_TOTAL]) > 0}


def zip_date(name: str, member: str) -> date:
    with zipfile.ZipFile(path(name)) as archive:
        return datetime(*archive.getinfo(member).date_time).date()


# --- Load -------------------------------------------------------------------------------------

def scope_suffix(cov: coverage.Coverage) -> str:
    """'-england' for an England build: a new release id beside the London-only one it replaces."""
    return "" if cov.name == "london" else f"-{cov.name}"


def insert_release(cur, base: str, digest: str, url: str, released: date, attribution: str, caveats: list[str]) -> str:
    """Source releases are immutable: the id carries the content hash, so a new file is a new release."""
    release_id = f"{base}-{digest[:12]}"
    cur.execute(
        """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence, attribution,
             transformation_version, geography_vintage, validation_status, caveats)
           VALUES (%s, %s, now(), %s, %s, 'OGL-3.0', %s, %s, '2021', 'passed', %s) ON CONFLICT (id) DO NOTHING""",
        (release_id, url, released, digest, attribution, ETL_VERSION, caveats))
    return release_id


def _copy(cur, sql: str, rows: Iterable[tuple]) -> None:
    with cur.copy(sql) as copy:
        for row in rows:
            copy.write_row(row)


def _lsoa_rows(cur, table: str, columns: str, rows: dict[str, tuple], release_id: str, roll_up: list[str]) -> int:
    """Replace `table` with the London LSOAs of `rows` (unknown codes dropped), then sum MSOAs and boroughs."""
    cur.execute(f"CREATE TEMP TABLE stage_{table} (code text, {columns}) ON COMMIT DROP")
    names = ", ".join(column.split()[0] for column in columns.split(", "))
    _copy(cur, f"COPY stage_{table} (code, {names}) FROM STDIN", ((code, *values) for code, values in rows.items()))
    cur.execute(f"DELETE FROM {table}")
    cur.execute(f"""INSERT INTO {table} (geography_id, {names}, source_release_id)
                    SELECT g.id, {', '.join('s.' + name for name in names.split(', '))}, %s
                    FROM stage_{table} s JOIN area_geography g ON g.id = 'uk:lsoa:' || s.code""", (release_id,))
    cur.execute("SELECT roll_up_area_home(%s, %s, ARRAY['source_release_id'])", (table, roll_up))
    return cur.execute(f"SELECT count(*) FROM {table}").fetchone()[0]


def load_restrictions(cur) -> None:
    cov = coverage.from_env()
    with open(path("organisation.csv"), newline="", encoding="utf-8") as handle:
        boroughs = councils(csv.DictReader(handle), cov)
    missing = sorted(cov.lad_codes - set(boroughs.values()))
    if len(missing) > len(cov.lad_codes) // 20:
        raise SystemExit(f"organisation.csv: {len(missing)} of {len(cov.lad_codes)} councils missing: {missing[:10]}")
    with open(path("article-4-direction-area.csv"), newline="", encoding="utf-8") as handle:
        article4 = list(article4_rows(csv.DictReader(handle), boroughs))
    with open(path("listed-building.csv"), newline="", encoding="utf-8") as handle:
        listed = list(listed_rows(csv.DictReader(handle), cov))
    a4_release = insert_release(
        cur, "src-planning-data-article4" + scope_suffix(cov), sha256("article-4-direction-area.csv", "organisation.csv"),
        FILES["article-4-direction-area.csv"], newest_entry("article-4-direction-area.csv"),
        "Article 4 direction areas, planning.data.gov.uk (MHCLG, from local planning authorities). Contains "
        "public sector information licensed under the Open Government Licence v3.0.",
        ["Only councils that have published Article 4 data to planning.data.gov.uk are covered; elsewhere the "
         "absence of an area says nothing.",
         "Householder directions are read from the classes removed (GPDO Part 1) or, without them, the description."])
    lb_release = insert_release(
        cur, "src-historic-england-listed" + scope_suffix(cov), sha256("listed-building.csv"), FILES["listed-building.csv"],
        newest_entry("listed-building.csv"),
        f"Listed buildings: © Historic England {date.today().year}. Contains Ordnance Survey data © Crown copyright "
        "and database right. National Heritage List for England, via planning.data.gov.uk, Open Government Licence v3.0.",
        ["Each listing is one point; a listing can cover a terrace or several buildings."])
    cur.execute("DELETE FROM article4_area")
    cur.execute("CREATE TEMP TABLE stage_article4 (id text, name text, reference text, borough text, "
                "householder boolean, wkt text) ON COMMIT DROP")
    _copy(cur, "COPY stage_article4 FROM STDIN", article4)
    cur.execute("""INSERT INTO article4_area (id, name, reference, borough_code, householder, geom, source_release_id)
        SELECT id, name, reference, borough, householder, geom, %s FROM (
            SELECT DISTINCT ON (id) *, ST_Multi(ST_CollectionExtract(ST_MakeValid(
                ST_Transform(ST_SetSRID(ST_GeomFromText(wkt), 4326), 27700)), 3)) AS geom FROM stage_article4) s
        WHERE NOT ST_IsEmpty(geom)""", (a4_release,))
    cur.execute("DELETE FROM article4_coverage")
    _copy(cur, "COPY article4_coverage (borough_code, areas, source_release_id) FROM STDIN",
          ((code, n, a4_release) for code, n in article4_coverage(article4, cov).items()))
    cur.execute("DELETE FROM listed_building")
    cur.execute("CREATE TEMP TABLE stage_listed (id text, name text, grade text, lon float8, lat float8) ON COMMIT DROP")
    _copy(cur, "COPY stage_listed FROM STDIN", listed)
    cur.execute("""INSERT INTO listed_building (id, name, grade, location, source_release_id)
        SELECT DISTINCT ON (id) id, name, grade, ST_Transform(ST_SetSRID(ST_MakePoint(lon, lat), 4326), 27700), %s
        FROM stage_listed ORDER BY id""", (lb_release,))
    areas = cur.execute("SELECT rebuild_area_restriction()").fetchone()[0]
    published = sum(1 for n in article4_coverage(article4, cov).values() if n)
    print(f"restrictions: {len(article4)} Article 4 areas ({sum(r[4] for r in article4)} householder) from "
          f"{published}/{len(cov.lad_codes)} councils ({len(missing)} without an organisation row: {missing}), "
          f"{len(listed)} listed buildings, {areas} areas")


def load_broadband(cur) -> None:
    cov = coverage.from_env()
    lookup = oa_to_lsoa(csv.DictReader(onspd_lines(ONSPD)), cov)
    lsoas = broadband_lsoas(ofcom_output_areas(path("connected-nations.zip")), lookup)
    fibre = ofcom_full_fibre(path("connected-nations.zip"), cov)
    release = insert_release(
        cur, "src-ofcom-connected-nations-2026-spring" + scope_suffix(cov), sha256("connected-nations.zip"), OFCOM_ZIP, OFCOM_RELEASE,
        "Ofcom Connected Nations, spring 2026 update (January 2026 coverage). Contains public sector information "
        "licensed under the Open Government Licence v3.0.",
        ["Availability, not take-up: a line can be ordered, not that a home has it.",
         "Full fibre is published for local authorities only, so it is the council area's figure."])
    areas = _lsoa_rows(cur, "area_broadband", "premises integer, gigabit_premises integer", lsoas, release,
                       ["premises", "gigabit_premises"])
    cur.execute("""UPDATE area_broadband b SET full_fibre_share = f.share
                   FROM unnest(%s::text[], %s::real[]) AS f(code, share) WHERE b.geography_id = 'uk:lad:' || f.code""",
                (list(fibre), list(fibre.values())))
    print(f"broadband: {len(lsoas)} LSOAs with premises, {len(fibre)} LADs with full fibre, {areas} areas")


def load_settled(cur) -> None:
    lsoas = ts019_lsoas(path("census2021-ts019.zip"))
    release = insert_release(
        cur, "src-ons-census-2021-ts019", sha256("census2021-ts019.zip"), FILES["census2021-ts019.zip"],
        zip_date("census2021-ts019.zip", "census2021-ts019-lsoa.csv"),
        "Office for National Statistics, Census 2021 TS019 Migrant indicator, licensed under the Open Government "
        "Licence v3.0.",
        ["Census day was 21 March 2021, during the pandemic: students and some renters were away from term-time "
         "or usual addresses.", "Counts are of usual residents, rounded and perturbed by ONS for disclosure control."])
    areas = _lsoa_rows(cur, "area_settled", "residents integer, same_address integer", lsoas, release,
                       ["residents", "same_address"])
    print(f"settled: {areas} areas")


PARTS = {"restrictions": load_restrictions, "broadband": load_broadband, "settled": load_settled}


def load(url: str, parts: list[str]) -> None:
    import psycopg

    with psycopg.connect(url) as conn, conn.cursor() as cur:
        for part in parts:
            PARTS[part](cur)


if __name__ == "__main__":
    stage = sys.argv[1] if len(sys.argv) > 1 else ""
    if stage == "download":
        download()
    elif stage == "load" and len(sys.argv) in (3, 4) and (len(sys.argv) == 3 or sys.argv[3] in PARTS):
        load(sys.argv[2], list(PARTS) if len(sys.argv) == 3 else [sys.argv[3]])
    else:
        sys.exit(__doc__)
