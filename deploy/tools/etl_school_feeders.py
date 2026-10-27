"""Primary to secondary school flows from the GLA London Schools Atlas into school_feeder_flow (migration 058).

Source (OGL v2.0): Greater London Authority, London Schools Atlas, "Primary school feeder schools"
(Feeder_Pri2Sec): for each London state primary, how many of its state-funded Year 6 pupils went to each
state-funded secondary, as of the Spring School Census (January) of the file's year; built from the National Pupil
Database. Flows under 3 pupils are not published (no row); the primary's total was counted before that, so the
total minus the published flows is the pupils in unpublished flows. Never filled in or estimated here.

Census years 2016 (a file of its own, the latest open release), 2015 and 2014 (inside the Atlas dataset zips).
Every sheet is checked: the Notes sheet must name the file's census year, the data sheet must have the published
columns. Primaries are kept for the school that is current in table `school` (a predecessor's flows go to its
successor; the school's own row wins); each secondary keeps the URN and name as printed, plus its current school
in table `school` when GIAS links give one (none outside London).

  fetch [folder]          download FILES into folder (default ~/data/schools-atlas/<YYYY-MM>/)
  load [db-url] [folder]  one source release per census year; replaces school_feeder_flow

  .ae-venv/bin/python deploy/tools/etl_school_feeders.py fetch
  .ae-venv/bin/python deploy/tools/etl_school_feeders.py load [database-url] [folder]
"""
from __future__ import annotations

import os
import re
import sys
import zipfile
from collections import defaultdict
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import school_history_common as common  # noqa: E402

SOURCE = "schools-atlas"
DATASET = "https://data.london.gov.uk/dataset/london-schools-atlas-29j4y"
DOWNLOAD = "https://data.london.gov.uk/download/29j4y/"
# census year -> (published file, its name here, the workbook inside it or None, release date); the release date
# is the London Datastore's upload time for that file (the two zips were uploaded again on 20 June 2025)
FILES = {
    2016: (DOWNLOAD + "94ca96da-45c5-4f4f-9a9f-342805e0896f/Feeder_Pri2Sec_2016_LDS.xlsx",
           "Feeder_Pri2Sec_2016_LDS.xlsx", None, date(2017, 1, 26)),
    2015: (DOWNLOAD + "5bc6658b-da41-495c-8873-2f91471b0a8c/LondonSchoolsAtlas_Dataset_2015.zip",
           "LondonSchoolsAtlas_Dataset_2015.zip", "LondonSchoolsAtlas_Dataset_2015/Feeder_Pri2Sec_LDS2015.xlsx",
           date(2025, 6, 20)),
    2014: (DOWNLOAD + "36be65b1-f7df-4c66-9c61-c8208bd19cd7/LondonSchoolsAtlas_Dataset_2014.zip",
           "LondonSchoolsAtlas_Dataset_2014.zip", "LondonSchoolsAtlas_Dataset_2014/Feeder_Pri2Sec_LDS2014.xlsx",
           date(2025, 6, 20)),
}
HEADER = ("Primary_School_URN", "Primary_School_Name", "Total_No_of_Primary_School_Pupils",
          "Primary2Secondary_Flow_No.", "Secondary_School_URN", "Secondary_School_Name", "Pupil_count")
LICENCE = "OGL-2.0"
ATTRIBUTION = ("GLA London Schools Atlas, contains National Pupil Database data (DfE). Contains public sector "
               "information licensed under the Open Government Licence v2.0.")
CAVEATS = [
    "State-funded schools only: Year 6 pupils of a London state primary counted at the state-funded secondary "
    "they went to, Spring School Census (January) of the year shown.",
    "Flows of fewer than 3 pupils are not published; the primary's total was counted before that, so the "
    "difference is pupils in flows of fewer than 3 each.",
    "Licensed under the Open Government Licence v2.0.",
]
ETL_VERSION = "close-knit-school-feeders-1"
CENSUS_NOTE = re.compile(r"as of the (\d{4}) Spring School Census")


def release_id(year: int) -> str:
    return f"src-gla-schools-atlas-feeders-{year}"


def read_workbook(path: str, year: int) -> list[tuple]:
    """The data rows of a Feeder_Pri2Sec workbook, after checking its notes name `year` and its columns."""
    import openpyxl

    book = openpyxl.load_workbook(path, read_only=True, data_only=True)
    years, data = set(), None
    for sheet in book.worksheets:
        rows = [row for row in sheet.iter_rows(values_only=True) if any(c is not None for c in row)]
        if rows and tuple(rows[0][:len(HEADER)]) == HEADER:
            data = [tuple(row[:len(HEADER)]) for row in rows[1:]]
        else:
            years |= {int(y) for row in rows for c in row if isinstance(c, str) for y in CENSUS_NOTE.findall(c)}
    if years != {year}:
        raise SystemExit(f"{os.path.basename(path)}: notes name census year(s) {sorted(years)}, expected {year}")
    if data is None:
        raise SystemExit(f"{os.path.basename(path)}: no sheet with columns {HEADER}")
    return data


def _count(value, name: str, minimum: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < minimum:
        raise SystemExit(f"{name}: {value!r} is not a published count >= {minimum}")
    return value


def _urn(value) -> str:
    urn = str(value).strip()
    if not re.fullmatch(r"\d{6}", urn):
        raise SystemExit(f"not a URN: {value!r}")
    return urn


def records(rows, year: int, resolve) -> tuple[list[dict], dict]:
    """(school_feeder_flow rows, counts) from one year's data rows. resolve: URN -> current URN in school."""
    by_primary: dict[str, list[dict]] = defaultdict(list)
    totals: dict[str, int] = {}
    for row in rows:
        primary, _, total, flow, secondary, name, pupils = row
        primary = _urn(primary)
        total = _count(total, f"{primary} total", 1)
        if totals.setdefault(primary, total) != total:
            raise SystemExit(f"{year} {primary}: two different totals")
        match = re.fullmatch(r"Pri2Sec_Flow(\d+)", str(flow))
        if not match:
            raise SystemExit(f"{year} {primary}: flow label {flow!r}")
        by_primary[primary].append({
            "census_year": year, "reported_urn": primary, "primary_total": total, "flow_rank": int(match.group(1)),
            "secondary_urn": _urn(secondary), "secondary_name": str(name).strip(),
            "secondary_current_urn": resolve(_urn(secondary)), "pupils": _count(pupils, f"{primary} flow", 3)})
    for primary, flows in by_primary.items():
        if sum(f["pupils"] for f in flows) > totals[primary]:
            raise SystemExit(f"{year} {primary}: published flows exceed the total")
        if len({f["secondary_urn"] for f in flows}) != len(flows):
            raise SystemExit(f"{year} {primary}: a secondary printed twice")
    current: dict[str, dict[str, list[dict]]] = defaultdict(dict)
    unmatched = 0
    for primary, flows in by_primary.items():
        urn = resolve(primary)
        if urn is None:
            unmatched += 1
        else:
            current[urn][primary] = flows
    out, ambiguous = [], 0
    for urn, reported in current.items():
        if urn in reported:  # the school's own figures win over a predecessor's
            flows = reported[urn]
        elif len(reported) == 1:
            flows = next(iter(reported.values()))
        else:  # two predecessors merged: neither is the school's own
            ambiguous += 1
            continue
        out += [{"urn": urn, **flow} for flow in flows]
    out.sort(key=lambda r: (r["urn"], r["flow_rank"]))
    return out, {"primaries": len({r["urn"] for r in out}), "unmatched": unmatched, "ambiguous": ambiguous,
                 "flows": len(out), "secondaries_matched": sum(1 for r in out if r["secondary_current_urn"])}


def fetch(folder: str) -> dict[int, tuple[str, str]]:
    """{year: (workbook path, published file path)}; a zip's workbook is extracted next to it."""
    paths = {}
    for year, (url, name, member, _) in FILES.items():
        published = os.path.join(folder, name)
        common.http_get(url, published)
        workbook = published
        if member:
            workbook = os.path.join(folder, os.path.basename(member))
            if not os.path.exists(workbook):
                with zipfile.ZipFile(published) as archive, archive.open(member) as src, \
                        open(workbook + ".tmp", "wb") as out:
                    out.write(src.read())
                os.replace(workbook + ".tmp", workbook)
        paths[year] = (workbook, published)
    return paths


def load(cur, paths: dict[int, tuple[str, str]], resolve=None) -> int:
    resolve = resolve or common.load_resolver(cur).resolve
    cur.execute("DELETE FROM school_feeder_flow")
    columns = ["urn", "census_year", "reported_urn", "primary_total", "flow_rank", "secondary_urn",
               "secondary_name", "secondary_current_urn", "pupils"]
    total = 0
    for year, (workbook, published) in sorted(paths.items(), reverse=True):
        rows, counts = records(read_workbook(workbook, year), year, resolve)
        url, _, _, released = FILES[year]
        common.register_release(cur, release_id(year), url, common.recorded_sha256(published), LICENCE,
                                ATTRIBUTION, CAVEATS, released, ETL_VERSION)
        cur.executemany(
            f"""INSERT INTO school_feeder_flow ({', '.join(columns)}, source_release_id)
                VALUES ({', '.join(f'%({c})s' for c in columns)}, %(release)s)""",
            [{**r, "release": release_id(year)} for r in rows])
        print(f"load {release_id(year)}: {counts['primaries']} primaries, {counts['flows']} flows "
              f"({counts['secondaries_matched']} to a secondary in table school); {counts['unmatched']} primaries "
              f"not in table school, {counts['ambiguous']} merged predecessors left out")
        total += len(rows)
    return total


def main(argv: list[str]) -> None:
    if len(argv) < 2 or argv[1] not in ("fetch", "load"):
        raise SystemExit(__doc__)
    if argv[1] == "fetch":
        print(fetch(argv[2] if len(argv) > 2 else common.raw_dir(SOURCE)))
        return
    import psycopg
    from psycopg.rows import dict_row

    folder = argv[3] if len(argv) > 3 else common.raw_dir(SOURCE)
    with psycopg.connect(argv[2] if len(argv) > 2 else common.DEFAULT_DB_URL, row_factory=dict_row) as conn, \
            conn.cursor() as cur:
        load(cur, fetch(folder))


if __name__ == "__main__":
    main(sys.argv)
