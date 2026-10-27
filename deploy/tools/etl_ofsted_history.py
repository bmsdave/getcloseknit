"""Every Ofsted inspection of the coverage's state schools (England; London with CLOSE_KNIT_ETL_COVERAGE=london)
since 2005 into school_inspection (migration 048).

Sources (Ofsted, OGL v3.0), raw files kept under ~/data/ofsted-history/<YYYY-MM>/ with .sha256:
  * Management information, section 5 inspections 1 Sept 2005 - 31 Aug 2015 (xlsx).
  * Management information, all inspections 1 Sept 2015 - 31 Aug 2019 (csv).
  * Official statistics "State-funded schools inspections and outcomes", every inspection of
    each academic year 2018/19 - 2024/25 (csv).
  * Monthly management information, all inspections year to date: the last cumulative file of
    each inspection year 2019/20 - 2024/25 (31 Aug 2020, 31 Aug 2021, 31 Oct 2022, 31 Oct 2023,
    31 Oct 2024, 30 Sep 2025), 31 Oct 2025, and 31 Aug 2026 (2025/26, report cards from
    10 November 2025). When a later 2025/26 file is published, add it to SOURCES.
  * The latest-inspections file etl_schools.py reads ($AE_DATA/ofsted/), for any latest
    inspection the files above miss.

  fetch [db-url]   download the files once
  load [db-url]    fetch, then upsert every inspection of a school in table `school`

One row per inspection: deduplicated by inspection number (else inspected URN + start date),
the later file winning. Rows under a predecessor's URN are mapped to the current school with
the GIAS links (school_history_common.UrnResolver); rows that do not map are counted in the
log, never loaded. Frameworks are kept apart, never put on one scale: `overall` is the 1-4
grade where the file gives one; `judgements` keeps every other judgement as printed (1-4,
"Yes"/"No", report-card grades). Text extracted later (improve_text, key_findings) is kept
on re-runs.
"""
from __future__ import annotations

import csv
import glob
import json
import os
import re
import sys
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import school_history_common as common  # noqa: E402

ASSETS = "https://assets.publishing.service.gov.uk/media/"
ATTRIBUTION = ("Ofsted, state-funded schools inspections and outcomes. Contains public sector "
               "information licensed under the Open Government Licence v3.0.")
LOG_DIR = os.path.join(common.DATA, "aework", "school-history", "logs")
REPORT_URL = "https://reports.ofsted.gov.uk/provider/21/{urn}"
REPORT_CARD_START = date(2025, 11, 10)

# (release id, url, release date, caveat). File name = last URL segment.
SOURCES = (
    ("src-ofsted-inspections-2005-2015",
     ASSETS + "5a757ca240f0b6397f35ece5/Management_information_-_schools_-_1_Sept_2005_to_31_August_2015.xlsx",
     "2015-12-01", "Section 5 inspections only, published by 1 December 2015; section 8 visits before September 2015 are not in this file. Release date is that cut-off (the file's own publication date is not given)."),
    ("src-ofsted-inspections-2015-2019",
     ASSETS + "5f6b4b76d3bf7f72337b6ef7/Management_information_-_state-funded_schools_1_September_2015_to_31_August_2019.csv",
     "2020-01-31", "All inspections 2015/16 to 2018/19 published by 31 January 2020; grade 9 means not applicable. Release date is that cut-off (the file's own publication date is not given)."),
    *(
        (f"src-ofsted-inspections-{year}", ASSETS + path, released,
         f"Official statistics: every inspection between 1 September {year[:4]} and 31 August 20{year[5:]}.")
        for year, path, released in (
            ("2018-19", "5ddcf962e5274a7939e525e0/State_funded_schools_inspections_and_outcomes_between__1_September_2018_and_31_August_2019.csv", "2019-11-28"),
            ("2019-20", "5f96b462e90e077b0687cc5a/State_funded_schools_inspections_and_outcomes_between__1_September_2019_and_31_August_2020.csv", "2020-10-29"),
            ("2020-21", "6197ca038fa8f50382034d4c/State_funded_schools_inspections_and_outcomes_between_1_September_2020_and_31_August_2021.csv", "2021-11-25"),
            ("2021-22", "6384c015d3bf7f7eb32a9f06/State_funded_schools_inspections_and_outcomes_between_1_September_2021_and_31_August_2022.csv", "2022-11-29"),
            ("2022-23", "654e19575d60950011bec907/State_funded_schools_inspections_and_outcomes_between_1_September_2022_and_31_August_2023.csv", "2023-11-14"),
            ("2023-24", "673f1b742ff787d4e01b09ac/State_funded_schools_inspections_and_outcomes_between_1_September_2023_and_31_August_2024.csv", "2024-11-26"),
            ("2024-25", "691ee0610107ccaa765f7113/State-funded_schools_inspections_and_outcomes_between_1_September_2024_and_31_August_2025.csv", "2025-11-25"),
        )
    ),
    # The last cumulative monthly file of each inspection year holds inspections published after
    # the official statistics' cut-off (summer inspections published in the autumn).
    *(
        (f"src-ofsted-mi-ytd-{day}", ASSETS + path, released,
         f"Monthly management information (provisional): the inspection year's inspections published by {day}.")
        for day, path, released in (
            ("2020-08-31", "5f5891b18fa8f51061921e7c/Management_information_-_state-funded_schools_-_all_inspections_-_year_to_date_published_by_31_August_2020.csv", "2020-09-11"),
            ("2021-08-31", "6141a83c8fa8f503ba3dc8e1/Management_information_-_state-funded_schools_-_all_inspections_-_year_to_date_published_by_31_Aug_2021.csv", "2021-09-15"),
            ("2022-10-31", "636b6b8fd3bf7f164de3c9d3/Management_information_-_state-funded_schools_-_all_inspections_-_year_to_date_published_by_31_Oct_2022.csv", "2022-11-10"),
            ("2023-10-31", "654cc4d2b9068c000d0e762e/Management_information_-_state-funded_schools_-_all_inspections_-_year_to_date_published_by_31_Oct_2023.csv", "2023-11-10"),
            ("2024-10-31", "678f9cd47bb65baf62c2ad68/Management_information_-_state-funded_schools_-_all_inspections_-_year_to_date_published_by_31_Oct_2024.csv", "2025-01-21"),
        )
    ),
    ("src-ofsted-mi-ytd-2025-09-30",
     ASSETS + "68ee0f87a8398380cb4ad014/Management_information_-_state-funded_schools_-_all_inspections_-_year_to_date_published_by_30_Sep_2025.csv",
     "2025-10-14", "Monthly management information (provisional): inspections published by 30 September 2025."),
    ("src-ofsted-mi-ytd-2025-10-31",
     ASSETS + "69120166cf24e9250d893eca/Management_information_-_state-funded_schools_-_all_inspections_-_year_to_date_published_by_31_October_2025.csv",
     "2025-11-12", "Monthly management information (provisional): inspections published in October 2025."),
    ("src-ofsted-mi-ytd-2026-08-31",
     ASSETS + "6aa0175292e72b8ac437ef36/Management_information_-_state-funded_schools_-_all_inspections_-_year_to_date_published_by_31_August_2026.csv",
     "2026-09-10", "Monthly management information (provisional): 2025/26 inspections published by 31 August 2026; report cards have no overall grade."),
)


LATEST_RELEASE_PREFIX = "src-ofsted-latest-inspections-"
# Columns between the dates and the previous inspection that describe the school, not the inspection.
NOT_JUDGEMENTS = {"Inspection end date", "Overall effectiveness"}
# 8 = does not apply, 9 = no judgement / not applicable (the files' own notes).
DROP_VALUES = {"", "NULL", "8", "9", "None", "Not applicable"}
REPORT_CARD_AREAS = ("Safeguarding standards", "Inclusion", "Curriculum and teaching", "Achievement",
                     "Attendance and behaviour", "Personal development and wellbeing",
                     "Early years (where applicable)", "Post-16 provision (where applicable)",
                     "Leadership and governance")
# The latest-inspections file names the last graded (OEIF) inspection's judgements this way.
LATEST_OEIF = {
    "Latest OEIF category of concern": "Category of concern",
    "Latest OEIF quality of education": "Quality of education",
    "Latest OEIF behaviour and attitudes": "Behaviour and attitudes",
    "Latest OEIF personal development": "Personal development",
    "Latest OEIF effectiveness of leadership and management": "Effectiveness of leadership and management",
    "Latest OEIF  safeguarding is effective?": "Safeguarding is effective?",
    "Latest OEIF early years provision (where applicable)": "Early years provision (where applicable)",
    "Latest OEIF sixth form provision (where applicable)": "Sixth form provision (where applicable)",
}


def folder() -> str:
    """The month folder already holding the raw files, else this month's."""
    done = sorted(glob.glob(os.path.join(common.DATA, "ofsted-history", "*", "*.sha256")))
    return os.path.dirname(done[-1]) if done else common.raw_dir("ofsted-history")


def local_path(url: str) -> str:
    return os.path.join(folder(), url.rsplit("/", 1)[1])


def fetch() -> dict[str, str]:
    """release id -> sha256, downloading what is missing."""
    return {release: common.http_get(url, local_path(url)) for release, url, _, _ in SOURCES}


def parse_date(value) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, (int, float)):  # an Excel serial day
        return date(1899, 12, 30) + timedelta(days=int(value))
    text = str(value or "").strip()
    for pattern in ("%d/%m/%Y", "%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%d-%m-%Y"):
        try:
            return datetime.strptime(text, pattern).date()
        except ValueError:
            continue
    return None


def judgement_value(value) -> int | str | None:
    """1-4 grades as numbers, other outcomes as printed; blanks, NULL, 8 and 9 (not applicable) dropped."""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    text = re.sub(r"\s+", " ", str(value if value is not None else "")).strip()
    if text in DROP_VALUES:
        return None
    return int(text) if re.fullmatch(r"[1-4]", text) else text


def judgement_columns(header: list[str]) -> list[str]:
    """Every column after the inspection dates and before the previous inspection."""
    last_date = max(i for i, name in enumerate(header)
                    if name in ("Publication date", "Latest published date", "Inspection end date"))
    out = []
    for name in header[last_date + 1:]:
        if name.startswith(("Previous ", "Inspection number of the previous")):
            break
        if name and name not in NOT_JUDGEMENTS:
            out.append(name)
    return out


def framework(start: date | None, judgements: dict) -> str | None:
    """The framework in force at the start date; report cards from 10 November 2025."""
    if any(area in judgements for area in REPORT_CARD_AREAS):
        return "report-card-2025"
    if start is None:
        return None
    if start < date(2015, 9, 1):
        return "pre-2015"
    if start < date(2019, 9, 1):
        return "cif-2015"
    if start < date(2024, 9, 1):
        return "eif-2019"
    return "report-card-2025" if start >= REPORT_CARD_START else "eif-2024-no-overall"


def read_table(path: str) -> tuple[list[str], list[list]]:
    """(header, rows) of a CSV or the xlsx data sheet; title rows above the header are skipped."""
    if path.endswith(".xlsx"):
        import openpyxl

        sheet = openpyxl.load_workbook(path, read_only=True, data_only=True)["2005-2015 Inspections"]
        rows = sheet.iter_rows(values_only=True)
    else:
        try:
            with open(path, newline="", encoding="utf-8-sig") as handle:
                rows = list(csv.reader(handle))
        except UnicodeDecodeError:
            with open(path, newline="", encoding="cp1252") as handle:
                rows = list(csv.reader(handle))
        rows = iter(rows)
    for row in rows:
        if "URN" in row:
            header = [str(name or "").strip() for name in row]
            return header, rows
    raise SystemExit(f"{path}: no header row with URN")


def covered(row: dict) -> bool:
    """A school of the coverage: its region (Ofsted's name) or its LA (the first digits of LAESTAB)."""
    la = str(row.get("LAESTAB") or "")[:3]
    return ((row.get("Region") or "").strip().lower() in common.COVERAGE_REGION_NAMES
            or (la.isdigit() and int(la) in common.coverage_las()))


def history_rows(path: str, release: str):
    """Inspections of the coverage's schools in one history file, as dicts ready for `merge`."""
    header, rows = read_table(path)
    columns = judgement_columns(header)
    for values in rows:
        row = dict(zip(header, values))
        if not covered(row):
            continue
        judgements = {name: v for name in columns if (v := judgement_value(row.get(name))) is not None}
        start = parse_date(row.get("Inspection start date"))
        yield inspection(row.get("URN"), row.get("Inspection number"), start,
                         parse_date(row.get("Publication date") or row.get("First published date")),
                         row.get("Inspection type"), row.get("Overall effectiveness"), judgements, release)


def latest_rows(path: str, release: str):
    """The latest full, latest graded (OEIF) and latest ungraded inspection of each covered school."""
    header, rows = read_table(path)
    for values in rows:
        row = dict(zip(header, values))
        if not covered(row):
            continue
        full = {area: v for area in ("Category of concern", *REPORT_CARD_AREAS)
                if (v := judgement_value(row.get(area))) is not None}
        yield inspection(row.get("URN at time of latest full inspection"),
                         row.get("Inspection number of latest full inspection"),
                         parse_date(row.get("Inspection start date")), parse_date(row.get("Publication date")),
                         row.get("Inspection type"), None, full, release)
        graded = {name: v for column, name in LATEST_OEIF.items()
                  if (v := judgement_value(row.get(column))) is not None}
        yield inspection(row.get("URN at time of latest OEIF graded inspection"),
                         row.get("Inspection number of latest OEIF graded inspection"),
                         parse_date(row.get("Inspection start date of latest OEIF graded inspection")),
                         parse_date(row.get("Publication date of latest OEIF graded inspection")),
                         row.get("Inspection type of latest OEIF graded inspection"),
                         row.get("Latest OEIF overall effectiveness"), graded, release)
        outcome = judgement_value(row.get("Ungraded inspection overall outcome"))
        yield inspection(row.get("URN at time of the ungraded inspection"), row.get("Latest ungraded inspection number"),
                         parse_date(row.get("Date of latest ungraded inspection")),
                         parse_date(row.get("Ungraded inspection publication date")), None, None,
                         {"Outcomes for ungraded and monitoring inspections": outcome} if outcome else {}, release)


def inspection(urn, number, start, published, kind, overall, judgements: dict, release: str) -> dict | None:
    urn = str(urn or "").strip().removesuffix(".0")
    number = str(number or "").strip().removesuffix(".0")
    if not re.fullmatch(r"\d{6}", urn) or (number in DROP_VALUES and start is None):
        return None
    grade = judgement_value(overall)
    return {"inspected_urn": urn, "inspection_number": number if number not in DROP_VALUES else None,
            "start_date": start, "publication_date": published,
            "inspection_type": str(kind).strip() if kind and str(kind).strip() not in DROP_VALUES else None,
            "overall": grade if isinstance(grade, int) else None,
            "framework": framework(start, judgements), "judgements": judgements,
            "source_release_id": release}


def merge(batches) -> dict[str, dict]:
    """key -> inspection; later batches win. Key: inspection number, else inspected URN + start date."""
    out: dict[str, dict] = {}
    for batch in batches:
        for row in batch:
            if row is None:
                continue
            key = row["inspection_number"] or f"{row['inspected_urn']}:{row['start_date']}"
            out[key] = row
    return out


def resolve(rows: dict[str, dict], resolver) -> tuple[list[dict], list[dict]]:
    """(rows for current schools with urn and report_url set, rows that do not map)."""
    loaded, unmapped = [], []
    for key, row in rows.items():
        urn = resolver.resolve(row["inspected_urn"])
        if urn is None:
            unmapped.append(row)
            continue
        loaded.append({**row, "urn": urn, "inspection_number": row["inspection_number"] or key,
                       "report_url": REPORT_URL.format(urn=row["inspected_urn"])})
    return loaded, unmapped


def latest_file() -> tuple[str, str, str]:
    """(path, release id, release date) of the latest-inspections file etl_schools.py reads."""
    import etl_schools

    path = etl_schools.ofsted_file()
    as_of = datetime.strptime(os.path.basename(path).rsplit("_", 1)[-1].removesuffix(".csv"), "%d%b%Y")
    return path, LATEST_RELEASE_PREFIX + as_of.strftime("%Y-%m"), as_of.date().isoformat()


FRAMEWORK_CAVEAT = ("Frameworks differ (2005, 2015, 2019, 2024 without an overall grade, 2025 report cards); "
                    "grades are never put on one scale.")
LATEST_CAVEAT = "Latest inspections per school; used only for inspections the history files do not hold."


def register(cur, shas: dict[str, str], latest: tuple[str, str, str], used: set[str]) -> None:
    """Register the releases rows were loaded from (a file adding nothing new is not registered)."""
    import etl_schools

    for release, url, released, caveat in SOURCES:
        if release not in used:
            continue
        common.register_release(cur, release, url, shas[release], "OGL-3.0", ATTRIBUTION,
                                [caveat, FRAMEWORK_CAVEAT], released)
    path, release, released = latest
    common.register_release(cur, release, etl_schools.OFSTED_URL, common.sha256_file(path), "OGL-3.0",
                            ATTRIBUTION, [LATEST_CAVEAT], released, etl_schools.ETL_VERSION)


COLUMNS = ("urn", "inspection_number", "inspected_urn", "start_date", "publication_date", "inspection_type",
           "framework", "overall", "judgements", "report_url", "source_release_id")


def load(url: str) -> None:
    import psycopg

    shas = fetch()
    latest = latest_file()
    batches = [latest_rows(latest[0], latest[1])]
    # Later files win; provisional monthly files lose to the official files.
    for release, source_url, _, _ in sorted(SOURCES, key=lambda source: ("-mi-" not in source[0], source[2])):
        batches.append(history_rows(local_path(source_url), release))
    rows = merge(batches)
    releases = [release for release, *_ in SOURCES] + [latest[1]]
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        loaded, unmapped = resolve(rows, common.load_resolver(cur))
        register(cur, shas, latest, {row["source_release_id"] for row in loaded})
        cur.execute("CREATE TEMP TABLE staging_inspection (LIKE school_inspection INCLUDING DEFAULTS) ON COMMIT DROP")
        with cur.copy(f"COPY staging_inspection ({', '.join(COLUMNS)}) FROM STDIN") as copy:
            for row in loaded:
                copy.write_row([json.dumps(row[c]) if c == "judgements" else row[c] for c in COLUMNS])
        updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in COLUMNS[2:] if c != "report_url")
        # etl_ofsted_reports.py points report_url at the matched PDF; keep it once text was extracted.
        updates += (", report_url = CASE WHEN school_inspection.text_extracted_at IS NULL"
                    " THEN EXCLUDED.report_url ELSE school_inspection.report_url END")
        cur.execute(f"""INSERT INTO school_inspection ({', '.join(COLUMNS)})
                        SELECT {', '.join(COLUMNS)} FROM staging_inspection
                        ON CONFLICT (urn, inspection_number) DO UPDATE SET {updates}""")
        cur.execute("""DELETE FROM school_inspection s WHERE source_release_id = ANY(%s) AND NOT EXISTS
                         (SELECT 1 FROM staging_inspection t
                          WHERE t.urn = s.urn AND t.inspection_number = s.inspection_number)""", (releases,))
    write_unmapped(unmapped)
    schools = len({row["urn"] for row in loaded})
    print(f"ofsted-history: {len(loaded)} inspections of {schools} schools loaded; "
          f"{len(unmapped)} inspections not mapped to a school in `school` (see {LOG_DIR}/ofsted-unmapped.csv)")
    for name, count in sorted(count_by(loaded, "framework").items(), key=str):
        print(f"  {name}: {count}")


def count_by(rows: list[dict], key: str) -> dict:
    counts: dict = {}
    for row in rows:
        counts[row[key]] = counts.get(row[key], 0) + 1
    return counts


UNMAPPED_COLUMNS = ("inspected_urn", "inspection_number", "start_date", "inspection_type", "source_release_id")


def write_unmapped(rows: list[dict]) -> None:
    os.makedirs(LOG_DIR, exist_ok=True)
    with open(os.path.join(LOG_DIR, "ofsted-unmapped.csv"), "w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(UNMAPPED_COLUMNS)
        for row in sorted(rows, key=lambda r: (r["inspected_urn"], str(r["start_date"]))):
            writer.writerow([row[c] for c in UNMAPPED_COLUMNS])


def main(argv: list[str]) -> None:
    if len(argv) < 2 or argv[1] not in ("fetch", "load"):
        raise SystemExit(__doc__)
    if argv[1] == "fetch":
        for release, sha in fetch().items():
            print(sha[:12], release)
        return
    load(argv[2] if len(argv) > 2 else common.DEFAULT_DB_URL)


if __name__ == "__main__":
    main(sys.argv)
