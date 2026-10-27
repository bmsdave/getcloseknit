"""KS4 and 16-18 destination measures, institution level, into school_destination (migration 056).

Source (OGL v3.0): DfE (explore-education-statistics), "Key stage 4 destination measures" and "16-19 destination
measures" (16-18 study leavers), academic year 2024/25: what students who finished key stage 4 / 16-18 study in
2023/24 were doing in 2024/25. Kept: all students (breakdown Total; for 16-18, every qualification level), the
latest cohort, percentages as printed ("c" suppressed: null) and the cohort count. A destination is sustained
when it lasted the first two terms (six months) of the year after.

  fetch [folder]          download FILES into folder (default ~/data/school-destinations/<YYYY-MM>/)
  load [db-url] [folder]  one source release per file; replaces school_destination; figures published under a
                          predecessor's URN are kept for the school that replaced it (school_history_common)

  .ae-venv/bin/python deploy/tools/etl_school_destinations.py fetch
  .ae-venv/bin/python deploy/tools/etl_school_destinations.py load [database-url] [folder]
"""
from __future__ import annotations

import csv
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import school_history_common as common  # noqa: E402

SOURCE = "school-destinations"
CATALOGUE = "https://explore-education-statistics.service.gov.uk/data-catalogue/data-set/{id}/csv"
# stage -> (data set, file name, source release, what)
FILES = {
    "ks4": ("ecbafe39-f3d4-44b2-9d0b-2e686308da1f", "ees_ks4_inst_202324.csv", "src-dfe-ks4-destinations-2024-25",
            "Key stage 4 destination measures"),
    "16-18": ("1cf3fa31-8773-484c-a5f9-5cb2d7906882", "ees_ks5_inst_202324.csv", "src-dfe-16-18-destinations-2024-25",
              "16-19 destination measures"),
}
RELEASE_DATE = date(2026, 10, 15)
COLUMNS = {"overall": "sustained_percent", "education": "education_percent", "he": "higher_education_percent",
           "appren": "apprenticeship_percent", "all_work": "employment_percent",
           "all_notsust": "not_sustained_percent", "all_unknown": "unknown_percent"}
ATTRIBUTION = ("Department for Education, {what}, academic year 2024/25. Contains public sector information "
               "licensed under the Open Government Licence v3.0.")
CAVEATS = [
    "Destinations are for students who finished the stage in the year shown, followed through the next year; "
    "sustained means at least six months in education, an apprenticeship or employment.",
    "DfE suppresses small numbers; a suppressed figure is shown as not published.",
    "A type of destination, not named schools, colleges or universities.",
]
ETL_VERSION = "close-knit-school-destinations-1"


def _year(period: str) -> str:
    return f"{period[:4]}/{period[4:]}"


def _percent(text: str | None) -> float | None:
    try:
        return float((text or "").strip())
    except ValueError:
        return None


def all_students(row: dict) -> bool:
    return (row["breakdown"] == "Total" and row["data_type"] == "Percentage"
            and row.get("cohort_level_group", "Total") == "Total")


def records(rows, stage: str, resolve) -> tuple[list[dict], int]:
    """(rows for school_destination from the latest cohort, unmatched URNs)."""
    rows = [row for row in rows if all_students(row)]
    latest = max(row["time_period"] for row in rows)
    out: dict[str, dict] = {}
    unmatched = 0
    for row in rows:
        if row["time_period"] != latest:
            continue
        urn = resolve(row["school_urn"])
        if urn is None:
            unmatched += 1
            continue
        if urn in out and out[urn]["reported_urn"] == urn:
            continue  # the school's own figures win over a predecessor's
        cohort = (row["cohort_count"] or "").strip()
        out[urn] = {"urn": urn, "stage": stage, "cohort_year": _year(latest), "reported_urn": row["school_urn"],
                    "version": row.get("version") or None, "cohort": int(cohort) if cohort.isdigit() else None,
                    **{ours: _percent(row.get(theirs)) for theirs, ours in COLUMNS.items()}}
        if stage == "ks4":
            out[urn]["higher_education_percent"] = None  # not a KS4 destination
    return sorted(out.values(), key=lambda r: r["urn"]), unmatched


def fetch(folder: str) -> dict[str, str]:
    paths = {}
    for stage, (dataset, name, _, _) in FILES.items():
        paths[stage] = os.path.join(folder, name)
        common.http_get(CATALOGUE.format(id=dataset), paths[stage])
    return paths


def load(cur, paths: dict[str, str], resolve=None) -> int:
    resolve = resolve or common.load_resolver(cur).resolve
    cur.execute("DELETE FROM school_destination")
    total = 0
    for stage, (dataset, _, release, what) in FILES.items():
        with open(paths[stage], newline="", encoding="utf-8-sig") as handle:
            rows, unmatched = records(csv.DictReader(handle), stage, resolve)
        common.register_release(cur, release, CATALOGUE.format(id=dataset), common.recorded_sha256(paths[stage]),
                                "OGL-3.0", ATTRIBUTION.format(what=what), CAVEATS, RELEASE_DATE, ETL_VERSION)
        columns = ["urn", "stage", "cohort_year", "reported_urn", "version", "cohort", *COLUMNS.values()]
        cur.executemany(
            f"""INSERT INTO school_destination ({', '.join(columns)}, source_release_id)
                VALUES ({', '.join(f'%({c})s' for c in columns)}, %(release)s)""",
            [{**r, "release": release} for r in rows])
        print(f"load {release}: {len(rows)} schools ({rows[0]['cohort_year'] if rows else '-'} leavers), "
              f"{sum(1 for r in rows if r['sustained_percent'] is not None)} with a published figure; "
              f"{unmatched} England rows not in table school")
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
