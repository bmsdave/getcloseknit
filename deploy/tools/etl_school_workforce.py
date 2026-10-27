"""School Workforce in England, school level, into school_workforce (migration 056).

Source (OGL v3.0): DfE, School Workforce in England, reporting year 2025 (explore-education-statistics), two
school-level data sets keyed by URN: "Size of the school workforce" (FTE and headcount by post) and "Pupil to
teacher ratios" (DfE's own ratios). Only the latest census year is loaded, as printed: "x" (not available) and
"u" (low reliability) stay null. Nothing is derived here; the pupils-per-adult ratio is DfE's, whose adults are
teachers, teaching assistants, other school support staff and technicians (not administrative, auxiliary or
business staff).

  fetch [folder]          download FILES into folder (default ~/data/school-workforce/<YYYY-MM>/)
  load [db-url] [folder]  one source release; replaces school_workforce for the schools in table `school`

  .ae-venv/bin/python deploy/tools/etl_school_workforce.py fetch
  .ae-venv/bin/python deploy/tools/etl_school_workforce.py load [database-url] [folder]
"""
from __future__ import annotations

import csv
import hashlib
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import school_history_common as common  # noqa: E402

SOURCE = "school-workforce"
CATALOGUE = "https://explore-education-statistics.service.gov.uk/data-catalogue/data-set/{id}/csv"
RELEASE_ID = "src-dfe-school-workforce-2025"
RELEASE_DATE = date(2026, 6, 4)
FILES = {
    "size": ("cce5e2fe-b6eb-4741-9199-21afa08fb97a", "Workforce_2010_2025_fte_hc_sch.csv"),
    "ratios": ("d5f1867a-ca93-454d-9361-6c64df108872", "workforce_ptrs_2010_2025_sch.csv"),
}
# column in the size file / the ratios file -> school_workforce column
SIZE_COLUMNS = {"fte_all_teachers": "teachers_fte", "fte_teaching_assistants": "teaching_assistants_fte",
                "fte_leadership_teachers": "leadership_teachers_fte", "fte_all_support_staff": "support_staff_fte",
                "fte_workforce": "workforce_fte", "hc_workforce": "workforce_headcount",
                "hc_all_teachers": "teachers_headcount"}
RATIO_COLUMNS = {"pupils_fte": "pupils_fte", "pupil_to_qual_unqual_teacher_ratio": "pupils_per_teacher",
                 "pupil_to_adult_ratio": "pupils_per_adult"}
COUNTS = {"workforce_headcount", "teachers_headcount"}
ATTRIBUTION = ("Department for Education, School workforce in England, reporting year 2025. Contains public "
               "sector information licensed under the Open Government Licence v3.0.")
CAVEATS = [
    "From the November 2025 school workforce census; full-time equivalent (FTE) counts part-time staff by their "
    "hours. State-funded schools only.",
    "Pupils per teacher and per adult are DfE's ratios: FTE pupils in the January 2026 census divided by FTE "
    "teachers, or by FTE teachers, teaching assistants, other school support staff and technicians "
    "(administrative, auxiliary and business staff are not counted).",
    "Leadership is teachers in leadership posts (head, deputy and assistant heads).",
]
ETL_VERSION = "close-knit-school-workforce-1"


def academic_year(period: str) -> str:
    """'202526' -> '2025/26'."""
    return f"{period[:4]}/{period[4:]}"


def _number(text: str | None, count: bool = False):
    text = (text or "").strip()
    try:
        value = float(text)
    except ValueError:
        return None  # x, u, blank
    return int(value) if count else value


def latest_period(path: str) -> str:
    with open(path, newline="", encoding="utf-8-sig") as handle:
        return max(row["time_period"] for row in csv.DictReader(handle))


def read(path: str, period: str, columns: dict, schools: set[str]) -> dict[str, dict]:
    out = {}
    with open(path, newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            if row["time_period"] == period and row["geographic_level"] == "School" and row["school_urn"] in schools:
                out[row["school_urn"]] = {ours: _number(row[theirs], ours in COUNTS)
                                          for theirs, ours in columns.items()}
    return out


def records(size: dict[str, dict], ratios: dict[str, dict], year: str) -> list[dict]:
    blank = {**{c: None for c in SIZE_COLUMNS.values()}, **{c: None for c in RATIO_COLUMNS.values()}}
    return [{**blank, **size.get(urn, {}), **ratios.get(urn, {}), "urn": urn, "academic_year": year}
            for urn in sorted(set(size) | set(ratios))]


def manifest_sha256(paths: dict[str, str]) -> str:
    """One sha256 for the release's two files: of the lines "<file sha256>  <name>  <url>", which are kept
    next to them in sources-<release>.txt."""
    lines = "".join(f"{common.recorded_sha256(paths[key])}  {name}  {CATALOGUE.format(id=dataset)}\n"
                    for key, (dataset, name) in FILES.items())
    with open(os.path.join(os.path.dirname(paths["size"]), f"sources-{RELEASE_ID}.txt"), "w") as handle:
        handle.write(lines)
    return hashlib.sha256(lines.encode()).hexdigest()


def fetch(folder: str) -> dict[str, str]:
    paths = {}
    for key, (dataset, name) in FILES.items():
        paths[key] = os.path.join(folder, name)
        common.http_get(CATALOGUE.format(id=dataset), paths[key])
    return paths


def load(cur, paths: dict[str, str]) -> int:
    period = latest_period(paths["ratios"])
    if latest_period(paths["size"]) != period:
        raise SystemExit("workforce: the size and ratio files end in different years")
    schools = {row[0] for row in cur.execute("SELECT urn FROM school").fetchall()}
    year = academic_year(period)
    rows = records(read(paths["size"], period, SIZE_COLUMNS, schools),
                   read(paths["ratios"], period, RATIO_COLUMNS, schools), year)
    common.register_release(cur, RELEASE_ID, CATALOGUE.format(id=FILES["size"][0]), manifest_sha256(paths),
                            "OGL-3.0", ATTRIBUTION, CAVEATS, RELEASE_DATE, ETL_VERSION)
    cur.execute("DELETE FROM school_workforce")
    columns = ["urn", "academic_year", *SIZE_COLUMNS.values(), *RATIO_COLUMNS.values()]
    cur.executemany(
        f"""INSERT INTO school_workforce ({', '.join(columns)}, source_release_id)
            VALUES ({', '.join(f'%({c})s' for c in columns)}, %(release)s)""",
        [{**r, "release": RELEASE_ID} for r in rows])
    print(f"load {RELEASE_ID}: {year}, {len(rows)} of {len(schools)} schools; "
          f"{sum(1 for r in rows if r['pupils_per_teacher'] is not None)} with pupils per teacher")
    return len(rows)


def main(argv: list[str]) -> None:
    if len(argv) < 2 or argv[1] not in ("fetch", "load"):
        raise SystemExit(__doc__)
    if argv[1] == "fetch":
        print(fetch(argv[2] if len(argv) > 2 else common.raw_dir(SOURCE)))
        return
    import psycopg

    folder = argv[3] if len(argv) > 3 else common.raw_dir(SOURCE)
    with psycopg.connect(argv[2] if len(argv) > 2 else common.DEFAULT_DB_URL) as conn, conn.cursor() as cur:
        load(cur, fetch(folder))


if __name__ == "__main__":
    main(sys.argv)
