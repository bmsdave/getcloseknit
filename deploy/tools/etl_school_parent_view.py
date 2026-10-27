"""Ofsted Parent View, school level, into school_parent_view (migrations 056, 059).

Source (OGL v3.0): Ofsted, "Ofsted Parent View: management information", the ODS release "as at <date>",
sheet Table_3 (school level). Ofsted publishes a school only when it has 10 or more submissions; every
percentage is kept as printed ("[w]" no answers to the question, "[z]" not an option for it: left out).
The questions changed on 10 November 2025, and releases from March 2026 hold only answers to the new
questions. The two surveys are separate rows (survey '2025-11' or 'pre-2025-11') and separate source
releases: `load` refuses a release whose period starts before that date, `load-earlier` one whose period
ends on or after it, so old and new answers never mix. Earlier survey: each school gets one row, from the
newest of EARLIER_RELEASES (one academic year of submissions each) in which it has 10 or more; releases
before 2024 print their question texts only in Table_1.

  fetch [folder]                 download RELEASE (default ~/data/ofsted-parent-view/<YYYY-MM>/)
  fetch-earlier [folder]         download EARLIER_RELEASES
  load [db-url] [folder]         replaces the current-survey rows for the schools in table `school`
  load-earlier [db-url] [folder] replaces the earlier-survey rows

  .ae-venv/bin/python deploy/tools/etl_school_parent_view.py fetch
  .ae-venv/bin/python deploy/tools/etl_school_parent_view.py load [database-url] [folder]
"""
from __future__ import annotations

import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from datetime import date, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import school_history_common as common  # noqa: E402

SOURCE = "ofsted-parent-view"
PAGE = "https://www.gov.uk/government/statistical-data-sets/ofsted-parent-view-management-information"
# The latest release (published 16 June 2026). A new release is a new entry here and a new source release.
RELEASE = {"id": "src-ofsted-parent-view-2026-04-06", "as_at": date(2026, 4, 6),
           "url": "https://assets.publishing.service.gov.uk/media/6a2a8c0415f2a70fac7e5d74/"
                  "Parent_View_Management_Information_as_at_6_April_2026.ods"}
SURVEY = "2025-11"
SURVEY_START = date(2025, 11, 10)
# The earlier survey (questions in use before 10 November 2025), newest first: the last two academic years.
EARLIER_SURVEY = "pre-2025-11"
EARLIER_RELEASES = [
    {"id": "src-ofsted-parent-view-2025-09-01", "as_at": date(2025, 9, 1),  # published 31 October 2025
     "url": "https://assets.publishing.service.gov.uk/media/68ff578e49d08dd781b48356/"
            "Accessible_Parent_View_Management_Information_as_at_1_September_2025.ods"},
    # Its "Response Rate %" column prints a fraction (0.337313433 = 33.7%; every school 1 or below).
    {"id": "src-ofsted-parent-view-2024-09-02", "as_at": date(2024, 9, 2),  # published 24 January 2025
     "url": "https://assets.publishing.service.gov.uk/media/6793b3aae863a0e7724f4b37/"
            "Accessible_Parent_View_Management_Information_as_at_2_September_2024.ods", "rate_fraction": True},
]
MIN_SUBMISSIONS = 10
ATTRIBUTION = ("Ofsted, Ofsted Parent View management information. Contains public sector information licensed "
               "under the Open Government Licence v3.0.")
CAVEATS = [
    "Parent View answers come from the parents who chose to fill in the survey; response rates are low, so "
    "treat them with caution. It is not an Ofsted judgement.",
    "Ofsted publishes a school only when it has 10 or more submissions.",
    "The questions changed on 10 November 2025: these answers are from the new survey only and are not "
    "compared with earlier years.",
]
EARLIER_CAVEAT = ("Earlier survey: answers to the questions in use before 10 November 2025, submitted between "
                  "{start} and {end}. They are not compared with the current survey, whose questions differ.")
ETL_VERSION = "close-knit-school-parent-view-2"
NOT_PRINTED = {"[w]", "[z]", "", None}

_T = "{urn:oasis:names:tc:opendocument:xmlns:table:1.0}"
_TEXT = "{urn:oasis:names:tc:opendocument:xmlns:text:1.0}"
_OFFICE = "{urn:oasis:names:tc:opendocument:xmlns:office:1.0}"
_COLUMN = re.compile(r"^(Q\d+[a-z]?)\.\s*(.+?)\s*:\s*(.+?)\s*%$")
# Earlier survey to 2025: "Q1 Strongly Agree%", "Q7b Dont Know%", "Q14 Yes%"; the question text is in Table_1.
_OLD_COLUMN = re.compile(r"^(Q\d+[a-z]?)\s+(.+?)\s*%$")
_OLD_QUESTION = re.compile(r"^(Q\d+[a-z]?)\.\s*(.+?)\.?$")
OLD_OPTIONS = {"strongly agree": "Strongly agree", "agree": "Agree", "disagree": "Disagree",
               "strongly disagree": "Strongly disagree", "don't know": "Don't know", "dont know": "Don't know",
               "not applicable": "Not applicable", "yes": "Yes", "no": "No"}
_PERIOD = re.compile(r"between (\d{1,2} \w+ \d{4}) and (\d{1,2} \w+ \d{4})")


def ods_rows(path: str, sheet: str):
    """Rows (lists of cell text; office:value for numbers) of one sheet of an ODS file, stdlib only."""
    with zipfile.ZipFile(path) as archive, archive.open("content.xml") as handle:
        current = None
        for event, element in ET.iterparse(handle, events=("start", "end")):
            if event == "start" and element.tag == _T + "table":
                current = element.get(_T + "name")
            elif event == "end" and element.tag == _T + "table-row":
                if current == sheet:
                    cells = []
                    for cell in element:
                        if cell.tag not in (_T + "table-cell", _T + "covered-table-cell"):
                            continue
                        value = cell.get(_OFFICE + "value")
                        if value is None:
                            value = "\n".join("".join(p.itertext()) for p in cell.findall(_TEXT + "p"))
                        cells += [value] * min(int(cell.get(_T + "number-columns-repeated", "1")), 512)
                    while cells and cells[-1] == "":
                        cells.pop()
                    if cells:
                        yield cells
                element.clear()


def _day(text: str) -> date:
    return datetime.strptime(text, "%d %B %Y").date()


def _percent(text) -> float | None:
    """A printed percentage; [w], [z], blanks and malformed cells (the 6 April 2026 release has one "1[w][w]")
    are not a figure."""
    if text in NOT_PRINTED:
        return None
    try:
        return round(float(text), 2)
    except ValueError:
        return None


def question_texts(rows) -> dict[str, str]:
    """{qid: question} from Table_1 of an earlier-survey release (the first table, 1a, wins)."""
    texts: dict[str, str] = {}
    for row in rows:
        if match := _OLD_QUESTION.match((row[0] or "").strip()):
            texts.setdefault(match.group(1), match.group(2))
    return texts


def parse(rows, questions: dict[str, str] | None = None, rate_fraction: bool = False) -> tuple[date, date, list[dict]]:
    """(period start, as at, records) from the rows of Table_3. questions: question_texts() for an
    earlier-survey release (columns "Q1 Strongly Agree%"); None for the current survey. rate_fraction: the
    release prints the response rate as a fraction of 1, stored as a percentage like the others."""
    rows = iter(rows)
    title = next(rows)[0]
    found = _PERIOD.search(title)
    if not found:
        raise SystemExit(f"Parent View: no period in the Table_3 title: {title[:120]}")
    start, as_at = _day(found.group(1)), _day(found.group(2))
    if questions is None and start < SURVEY_START:
        raise SystemExit(f"Parent View: the release starts {start}, before the survey changed on {SURVEY_START}; "
                         "its answers are to the old questions and are not loaded")
    if questions is not None and as_at >= SURVEY_START:
        raise SystemExit(f"Parent View: the release runs to {as_at}, on or after the survey changed on "
                         f"{SURVEY_START}; it is not the earlier survey")
    header = next(row for row in rows if row and row[0] == "URN")
    columns = {}
    for index, name in enumerate(header):
        if match := _COLUMN.match(name):
            qid, question, option = match.groups()
        elif questions is not None and (match := _OLD_COLUMN.match(name)):
            (qid, option), question = match.groups(), questions.get(match.group(1))
        else:
            continue
        if questions is not None:  # the earlier releases print options in several spellings
            option = OLD_OPTIONS.get(option.lower())
            if question is None or option is None:
                raise SystemExit(f"Parent View: unknown earlier-survey column {name!r}")
        columns[index] = (qid, question, option)
    rate_column = next(i for i, name in enumerate(header) if name.startswith("Response Rate"))
    records = []
    for row in rows:
        if not re.fullmatch(r"\d{6}", row[0] or ""):
            continue
        cells = row + [""] * (len(header) - len(row))
        submissions = int(float(cells[header.index("Submissions")]))
        if submissions < MIN_SUBMISSIONS:
            continue
        answers: dict[str, dict] = {}
        for index, (qid, question, option) in columns.items():
            value = _percent(cells[index])
            if value is not None:
                answers.setdefault(qid, {"question": question, "options": {}})["options"][option] = value
        rate = _percent(cells[rate_column])
        if rate_fraction and rate is not None:
            if rate > 1:
                raise SystemExit(f"Parent View: response rate {rate} for {row[0]} is not a fraction")
            rate = round(float(cells[rate_column]) * 100, 2)
        records.append({"urn": row[0], "submissions": submissions, "response_rate": rate, "answers": answers})
    return start, as_at, records


def fetch(folder: str, release: dict = RELEASE) -> str:
    path = os.path.join(folder, os.path.basename(release["url"]))
    common.http_get(release["url"], path)
    return path


def _label(day: date) -> str:
    return f"{day.day} {day:%B %Y}"


def _insert(cur, survey: str, rows: list[dict]) -> None:
    cur.executemany(
        """INSERT INTO school_parent_view (urn, survey, period_start, as_at, submissions, response_rate, answers,
             source_release_id)
           VALUES (%(urn)s, %(survey)s, %(start)s, %(as_at)s, %(submissions)s, %(response_rate)s, %(answers)s,
             %(release)s)""",
        [{**r, "answers": json.dumps(r["answers"]), "survey": survey} for r in rows])


def load(cur, path: str) -> int:
    """The current survey's release; replaces only the current-survey rows."""
    start, as_at, records = parse(ods_rows(path, "Table_3"))
    if as_at != RELEASE["as_at"]:
        raise SystemExit(f"Parent View: the file is as at {as_at}, RELEASE says {RELEASE['as_at']}")
    schools = {row[0] for row in cur.execute("SELECT urn FROM school").fetchall()}
    records = [r for r in records if r["urn"] in schools]
    release = RELEASE["id"]
    common.register_release(cur, release, RELEASE["url"], common.recorded_sha256(path), "OGL-3.0", ATTRIBUTION,
                            CAVEATS, as_at, ETL_VERSION)
    cur.execute("DELETE FROM school_parent_view WHERE survey = %s", (SURVEY,))
    _insert(cur, SURVEY, [{**r, "start": start, "as_at": as_at, "release": release} for r in records])
    print(f"load {release}: {len(records)} of {len(schools)} schools have 10+ submissions ({start} to {as_at})")
    return len(records)


def load_earlier(cur, paths: list[str]) -> int:
    """EARLIER_RELEASES (paths in the same order, newest first): one earlier-survey row per school, from the
    newest release in which it has 10 or more submissions; replaces only the earlier-survey rows."""
    schools = {row[0] for row in cur.execute("SELECT urn FROM school").fetchall()}
    taken: dict[str, dict] = {}
    for spec, path in zip(EARLIER_RELEASES, paths, strict=True):
        start, as_at, records = parse(ods_rows(path, "Table_3"), question_texts(ods_rows(path, "Table_1")),
                                      spec.get("rate_fraction", False))
        if as_at != spec["as_at"]:
            raise SystemExit(f"Parent View: the file is as at {as_at}, EARLIER_RELEASES says {spec['as_at']}")
        common.register_release(
            cur, spec["id"], spec["url"], common.recorded_sha256(path), "OGL-3.0", ATTRIBUTION,
            CAVEATS[:2] + [EARLIER_CAVEAT.format(start=_label(start), end=_label(as_at))], as_at, ETL_VERSION)
        new = [r for r in records if r["urn"] in schools and r["urn"] not in taken]
        taken.update({r["urn"]: {**r, "start": start, "as_at": as_at, "release": spec["id"]} for r in new})
        print(f"load {spec['id']}: {len(new)} more of {len(schools)} schools have 10+ submissions "
              f"({start} to {as_at})")
    cur.execute("DELETE FROM school_parent_view WHERE survey = %s", (EARLIER_SURVEY,))
    _insert(cur, EARLIER_SURVEY, list(taken.values()))
    return len(taken)


def main(argv: list[str]) -> None:
    commands = ("fetch", "load", "fetch-earlier", "load-earlier")
    if len(argv) < 2 or argv[1] not in commands:
        raise SystemExit(__doc__)
    earlier = argv[1].endswith("-earlier")
    if argv[1].startswith("fetch"):
        folder = argv[2] if len(argv) > 2 else common.raw_dir(SOURCE)
        for release in EARLIER_RELEASES if earlier else [RELEASE]:
            print(fetch(folder, release))
        return
    import psycopg

    folder = argv[3] if len(argv) > 3 else common.raw_dir(SOURCE)
    with psycopg.connect(argv[2] if len(argv) > 2 else common.DEFAULT_DB_URL) as conn, conn.cursor() as cur:
        if earlier:
            load_earlier(cur, [fetch(folder, release) for release in EARLIER_RELEASES])
        else:
            load(cur, fetch(folder))


if __name__ == "__main__":
    main(sys.argv)
