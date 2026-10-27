"""School performance history for the coverage's state schools (England; London with CLOSE_KNIT_ETL_COVERAGE=london;
  migration 048, school_observation).

Source (OGL v3.0): DfE "Compare school and college performance" download-data, England-wide
(regions=0) CSVs for KS2, KS4, KS5 (16-18), CENSUS and PUPILABSENCE, one per academic year, plus the
meta/definition files. The site closes in autumn 2026, so `fetch` mirrors every file into
~/data/dfe-performance/<YYYY-MM>/ (with .sha256) before anything is parsed.

  fetch   download the data and meta files (skips files already there)
  load    one source_release per dataset-year (src-dfe-cscp-<ks2|ks4|ks5|census>-<YYYY-YY>):
          rows of the coverage's LAs (school_history_common.coverage_las), URNs resolved to the current
          school through GIAS links (unmatched rows
          are counted and logged, never guessed), measures from school_measures.py into
          school_observation (value {value, suppressed[, code]}, cohort_size); then the latest
          KS2 year replaces the KS2 observations in school.attributes of primary schools; and each
          KS2 / KS4 year's England-wide rank (migration 055, school_national_rank, see RANK_RULES).

Each KS5 year also stores the combined state + independent A-level rank (migration 094,
school_sixth_form_rank): every sixth form with 20+ A-level students, ranked on A level average
points per entry with the average grade as tie-break, England-wide and London-wide. That table
is the only place independent schools' figures go: school_observation.urn REFERENCES school(urn),
and `school` is state-only (migration 067 keeps independents in independent_school).

  .ae-venv/bin/python deploy/tools/etl_school_performance.py fetch
  .ae-venv/bin/python deploy/tools/etl_school_performance.py load [database-url] [YYYY-MM]
          (the month folder defaults to the newest one under ~/data/dfe-performance/; a path
          containing "/" is read as the folder itself)

A delete + insert by source_release_id makes `load` idempotent. etl_schools.py main() empties
school_observation: run `load` again after it.
"""
from __future__ import annotations

import csv
import io
import json
import os
import re
import sys
import zipfile
from collections import Counter
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import school_history_common as common  # noqa: E402
import school_measures  # noqa: E402
from school_measures import (ABSENCE_YEARS, CENSUS_YEARS, KS2_YEARS, KS4_YEARS, KS5_YEARS,  # noqa: E402
                             download_year)

SITE = "https://www.compare-school-performance.service.gov.uk/download-data"
DATA_URL = SITE + "?download=true&regions=0&filters={source}&fileformat=csv&year={year}&meta=false"
META_URL = SITE + "?download=true&regions={source}&filters=meta&fileformat=csv&year={year}&meta=true"
YEARS = {"KS2": KS2_YEARS, "KS4": KS4_YEARS, "KS5": KS5_YEARS, "CENSUS": CENSUS_YEARS,
         "PUPILABSENCE": ABSENCE_YEARS}
LOGS = os.path.join(common.DATA, "aework", "school-history", "logs")
ATTRIBUTION = ("Department for Education, Compare school and college performance ({what}, {year}). "
               "Contains public sector information licensed under the Open Government Licence v3.0.")
WHAT = {"KS2": "key stage 2", "KS4": "key stage 4", "KS5": "16 to 18 results", "CENSUS": "school census",
        "PUPILABSENCE": "pupil absence"}
# Files with one row per school and no RECTYPE column.
NO_RECTYPE = {"CENSUS", "PUPILABSENCE"}


def data_path(folder: str, source: str, academic_year: str, meta: bool = False) -> str | None:
    """The downloaded file (.csv or .zip) or None."""
    base = os.path.join(folder, f"{source.lower()}{'-meta' if meta else ''}-{download_year(academic_year)}")
    return next((base + ext for ext in (".csv", ".zip") if os.path.exists(base + ext)), None)


def fetch_one(url: str, folder: str, source: str, academic_year: str, meta: bool = False) -> str:
    """Download once; the extension follows the content (the site sends a zip for some files)."""
    found = data_path(folder, source, academic_year, meta)
    if found:
        return found
    base = os.path.join(folder, f"{source.lower()}{'-meta' if meta else ''}-{download_year(academic_year)}")
    common.http_get(url, base)
    with open(base, "rb") as handle:
        ext = ".zip" if handle.read(2) == b"PK" else ".csv"
    os.replace(base, base + ext)
    os.remove(base + ".sha256")
    common.recorded_sha256(base + ext)
    return base + ext


def fetch(month: str | None = None) -> int:
    folder = common.raw_dir("dfe-performance", month)
    failed = 0
    for source, years in YEARS.items():
        for academic_year in years:
            for meta, url in ((False, DATA_URL), (True, META_URL)):
                target = url.format(source=source, year=download_year(academic_year))
                try:
                    path = fetch_one(target, folder, source, academic_year, meta)
                    print(f"{os.path.basename(path)}  {os.path.getsize(path):>11,}  {common.recorded_sha256(path)}")
                except Exception as error:  # noqa: BLE001 - every failure is reported, the rest go on
                    failed += 1
                    print(f"FAILED {source} {academic_year} meta={meta}: {error}  {target}")
    return failed


# --- parsing -------------------------------------------------------------------------------

# The codes in the performance tables' abbreviations.xlsx: suppressed (5 or fewer pupils), no entries,
# not applicable, not published, low coverage, small percentage (0-0.5%), redacted, new institution.
SUPPRESSED = {"SUPP", "NE", "NA", "NP", "LOWCOV", "SP", "RE", "NEW"}


def cell(raw: str | None, unit: str) -> dict | None:
    """{'value': number|grade, 'suppressed': False} or {'value': None, 'suppressed': True, 'code': ...};
    None for an empty cell (nothing published for this school)."""
    text = (raw or "").strip()
    if not text:
        return None
    if unit == "grade" and re.fullmatch(r"(A\*|[A-E])[+-]?|U", text):
        return {"value": text, "suppressed": False}
    number = text.removesuffix("%").replace(",", "")
    try:
        value = float(number)
    except ValueError:
        pass
    else:
        return {"value": int(value) if unit == "pupils" and value.is_integer() else value, "suppressed": False}
    if text.upper() in SUPPRESSED:
        return {"value": None, "suppressed": True, "code": text}
    raise ValueError(f"unreadable value {text!r}")


def read_rows(path: str):
    """Rows of a downloaded CSV (or the single CSV inside its zip), header names upper-cased.
    Short rows are padded: some years' data rows have fewer fields than the header."""
    if path.endswith(".zip"):
        with zipfile.ZipFile(path) as archive:
            names = [n for n in archive.namelist() if n.lower().endswith(".csv")]
            if len(names) != 1:
                raise ValueError(f"{path}: expected one CSV, found {names}")
            text = archive.read(names[0]).decode("utf-8-sig", errors="replace")
    else:
        with open(path, "rb") as handle:
            text = handle.read().decode("utf-8-sig", errors="replace")
    reader = csv.reader(io.StringIO(text, newline=""))
    header = [h.strip().upper() for h in next(reader)]
    for values in reader:
        yield dict(zip(header, values + [""] * (len(header) - len(values))))


def la_code(row: dict) -> int | None:
    """The LA code (LEA, LA, or the first three digits of LAESTAB in census 2010/11)."""
    value = (row.get("LEA") or row.get("LA") or row.get("LAESTAB", "")[:3]).strip()
    return int(value) if value.isdigit() else None


# Independent and non-maintained schools: not state schools, so never in table `school`.
INDEPENDENT = {"IND", "INDSS", "INDSPEC", "NMSS", "INDEPENDENT SCHOOL", "NON-MAINTAINED SPECIAL SCHOOL"}


def institution_type(row: dict) -> str:
    return (row.get("NFTYPE") or row.get("NFTYPE/FESITYPE") or row.get("SCHOOLTYPE") or "").strip()


def school_rows(rows, source: str, stats: Counter):
    """State school rows: a 6-digit URN, not independent, and RECTYPE 1 (mainstream) or 2 (special)
    where the file has it; 3-5 and 7 are consortia and LA, region and national totals. The LA is not
    filtered here: a London school can sit in a neighbouring county's LA (Cuddington Croft, Sutton,
    is Surrey's 936), so London is the set of schools in table `school`."""
    for row in rows:
        if source not in NO_RECTYPE and row.get("RECTYPE", "").strip() not in ("1", "2"):
            continue
        if not re.fullmatch(r"\d{6}", row.get("URN", "").strip()):
            continue
        if institution_type(row).upper() in INDEPENDENT:
            stats["independent (skipped)"] += 1 if la_code(row) in common.coverage_las() else 0
            continue
        yield row


def observations(rows, source: str, academic_year: str, resolve,
                 unmatched: list | None = None) -> tuple[list[tuple], Counter]:
    """(urn, kind, academic_year, value json, cohort) for every measure, and counts of what happened.
    The URN is resolved to the current school through GIAS links; a row that does not resolve is
    counted (and listed in `unmatched`), never guessed. When an old URN and the current school
    both report the same year (a school merged into it), the current school's own row wins; when
    only two or more old URNs report (schools amalgamated into a new one), the value is dropped."""
    stats: Counter = Counter()
    found: dict[tuple, dict[str, tuple]] = {}
    for row in school_rows(rows, source, stats):
        own = row["URN"].strip()
        urn = resolve(own)
        covered = la_code(row) in common.coverage_las()
        if not urn and not covered:
            continue
        stats["rows in coverage" if covered else "covered school in a neighbouring LA"] += 1
        if not urn:
            stats["unmatched URN"] += 1
            if unmatched is not None:
                unmatched.append((own, la_code(row), institution_type(row), row.get("SCHNAME", "")))
            continue
        stats["matched via predecessor URN" if urn != own else "matched"] += 1
        for measure in school_measures.measures(source):
            column = measure.column(academic_year)
            if not column:
                continue
            value = cell(row.get(column), measure.unit)
            if value is None:
                continue
            cohort_column = measure.cohort_column.get(academic_year)
            cohort = cell(row.get(cohort_column), "pupils") if cohort_column else None
            cohort = int(cohort["value"]) if cohort and not cohort["suppressed"] else None
            found.setdefault((urn, measure.id), {})[own] = (urn, measure.id, academic_year, json.dumps(value), cohort)
    out = []
    for (urn, kind), by_urn in found.items():
        if urn in by_urn:
            stats["values also reported under a merged school's URN (current kept)"] += len(by_urn) > 1
            out.append(by_urn[urn])
        elif len(by_urn) == 1:
            out.append(next(iter(by_urn.values())))
        else:
            stats["values dropped: several old URNs, no current one"] += 1
    return out, stats


def release_id(source: str, academic_year: str) -> str:
    return f"src-dfe-cscp-{source.lower()}-{academic_year.replace('/', '-')}"


SUPPRESSED_CAVEAT = ("Suppressed and not-applicable figures are kept as value null, suppressed true, with the "
                     "DfE code (SUPP: 5 or fewer pupils, NE: no entries, NA, NP, LOWCOV, SP, RE, NEW).")
PREDECESSOR_CAVEAT = ("A predecessor school's figures (before academy conversion or a merger, per GIAS links) "
                      "are attached to the current school; when two old schools were amalgamated the "
                      "figure is dropped.")
CAVEATS = {
    "KS2": [SUPPRESSED_CAVEAT, PREDECESSOR_CAVEAT,
            "No school-level KS2 results were published for 2019/20-2021/22; progress scores are not "
            "published from 2023/24 (no KS1 baseline)."],
    "KS4": [SUPPRESSED_CAVEAT, PREDECESSOR_CAVEAT,
            "No school-level results for 2019/20-2020/21; Progress 8 is not published for 2024/25.",
            "Attainment 8 uses 9-1 grade points from 2016/17; 2015/16 is on the old scale."],
    "KS5": [SUPPRESSED_CAVEAT, PREDECESSOR_CAVEAT,
            "No school-level results for 2019/20-2020/21; A level value added is not published for "
            "2021/22-2022/23.",
            "State and independent schools share one A-level rank per year (school_sixth_form_rank, "
            "linked to independent_school by URN; independents have no other observations). "
            "Independent and selective (grammar) schools choose their pupils, so high results partly "
            "reflect who gets in, not only teaching. Some independent schools don't publish results."],
    "CENSUS": [PREDECESSOR_CAVEAT,
               "Total pupils on roll (all ages) from the January school census of the academic year; "
               "column TOTPUPSENDN until 2013/14, NOR from 2014/15. 2019/20 was not published.",
               "Shares (girls, boys, FSM in the past 6 years, first language not English, SEN support, EHC plan) "
               "are DfE's published percentages; SEN support and EHC plan start in 2014/15."],
    "PUPILABSENCE": [PREDECESSOR_CAVEAT,
                     "Overall absence is the percentage of possible sessions missed (authorised and unauthorised) "
                     "and persistent absentees the percentage of enrolments missing 10% or more of sessions, "
                     "for the full academic year the file is named for."],
}


def latest_month() -> str | None:
    """The newest ~/data/dfe-performance/<YYYY-MM> folder: load reads the mirror, not this month."""
    root = os.path.join(common.DATA, "dfe-performance")
    months = sorted(m for m in os.listdir(root) if re.fullmatch(r"\d{4}-\d{2}", m)) if os.path.isdir(root) else []
    return months[-1] if months else None


def load(url: str, month: str | None = None) -> int:
    import psycopg

    folder = month if month and "/" in month else common.raw_dir("dfe-performance", month or latest_month())
    os.makedirs(LOGS, exist_ok=True)
    missing = 0
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        resolver = common.load_resolver(cur)
        has_independent = cur.execute("SELECT to_regclass('independent_school')").fetchone()[0] is not None
        independent_urns = ({row[0] for row in cur.execute("SELECT urn FROM independent_school")}
                            if has_independent else set())
        has_sixth_rank = cur.execute("SELECT to_regclass('school_sixth_form_rank')").fetchone()[0] is not None
        if not has_independent:
            print("independent_school is not on this database: no independent sixth forms in the rank")
        if not has_sixth_rank:
            print("school_sixth_form_rank is not on this database: the combined sixth-form rank is skipped")
        for source, years in YEARS.items():
            for academic_year in years:
                path = data_path(folder, source, academic_year)
                if not path:
                    print(f"{source} {academic_year}: no file in {folder} (run fetch)")
                    missing += 1
                    continue
                release = release_id(source, academic_year)
                unmatched: list[tuple] = []
                rows, stats = observations(read_rows(path), source, academic_year, resolver.resolve, unmatched)
                with open(os.path.join(LOGS, f"performance-unmatched-{release}.csv"), "w", newline="") as handle:
                    csv.writer(handle).writerows([("urn", "la", "type", "name"), *unmatched])
                common.register_release(
                    cur, release, DATA_URL.format(source=source, year=download_year(academic_year)),
                    common.recorded_sha256(path), "OGL-3.0",
                    ATTRIBUTION.format(what=WHAT[source], year=academic_year),
                    CAVEATS[source] + ["Release date is the date the file was retrieved."],
                    date.fromtimestamp(os.path.getmtime(path)).isoformat())
                cur.execute("DELETE FROM school_observation WHERE source_release_id = %s", (release,))
                with cur.copy("COPY school_observation (urn, observation_kind, academic_year, value, "
                              "cohort_size, source_release_id) FROM STDIN") as copy:
                    for row in rows:
                        copy.write_row((*row, release))
                line = f"{release}: {len(rows)} observations; " + ", ".join(f"{k} {v}" for k, v in sorted(stats.items()))
                if source in RANK_RULES:
                    line += "; " + store_ranks(cur, read_rows(path), source, academic_year, resolver.resolve, release)
                if source == "KS5" and has_sixth_rank:
                    line += "; " + store_sixth_form_ranks(cur, read_rows(path), academic_year,
                                                          resolver.resolve, independent_urns, release)
                print(line)
                with open(os.path.join(LOGS, "performance-load.log"), "a") as log:
                    log.write(f"{date.today()} {line}\n")
        print(f"school.attributes: {update_attributes(cur)}")
    return missing


# --- England rank (migration 055, school_national_rank) ------------------------------------

# source -> (phase, measure id, column, tie-break column). One measure per phase, ranked high to low:
# KS2 % at the expected standard in reading, writing and maths, ties broken by % at the higher
# standard; KS4 Attainment 8 (Progress 8 is not published for 2024/25).
RANK_RULES = {
    "KS2": ("primary", "ks2-rwm-expected", "PTRWM_EXP", "PTRWM_HIGH"),
    "KS4": ("secondary", "ks4-attainment8", "ATT8SCR", None),
}
# Further-education colleges with 14-16 pupils: in the KS4 file, but not schools.
NOT_SCHOOLS = {"FESI"}


def _number(raw: str | None) -> float | None:
    value = cell(raw, "score")
    return None if value is None or value["suppressed"] else float(value["value"])


def national_ranks(rows, source: str) -> tuple[list[dict], int]:
    """(one entry per ranked England school, pool size). The pool: RECTYPE 1 (mainstream) state schools
    with a published number for the measure; suppressed, not-applicable and empty cells are left out of
    the pool. Equal values share the best rank (1, 2, 2, 4); a missing tie-break sorts after any published
    one at the same value. top_percent = ceil(rank / pool * 100)."""
    _, _, column, tiebreak = RANK_RULES[source]
    pool = []
    for row in rows:
        urn = row.get("URN", "").strip()
        kind = institution_type(row).upper()
        if row.get("RECTYPE", "").strip() != "1" or not re.fullmatch(r"\d{6}", urn) \
                or kind in INDEPENDENT or kind in NOT_SCHOOLS:
            continue
        value = _number(row.get(column))
        if value is None:
            continue
        second = _number(row.get(tiebreak)) if tiebreak else None
        pool.append({"urn": urn, "value": value, "tiebreak": second,
                     "key": (value, float("-inf") if second is None else second)})
    pool.sort(key=lambda entry: entry["key"], reverse=True)
    total = len(pool)
    previous = None
    for index, entry in enumerate(pool):
        key = entry.pop("key")
        entry["rank"] = pool[index - 1]["rank"] if key == previous else index + 1
        entry["top_percent"] = -(-entry["rank"] * 100 // total)
        previous = key
    return pool, total


def london_ranks(pool: list[dict], resolve) -> list[dict]:
    """The pool entries of schools in table `school`, under the current URN (as observations(): the
    school's own row wins over a predecessor's; two predecessors and no own row are dropped)."""
    found: dict[str, dict[str, dict]] = {}
    for entry in pool:
        urn = resolve(entry["urn"])
        if urn:
            found.setdefault(urn, {})[entry["urn"]] = entry
    out = []
    for urn, by_urn in found.items():
        entry = by_urn.get(urn) or (next(iter(by_urn.values())) if len(by_urn) == 1 else None)
        if entry:
            out.append({**entry, "ranked_urn": entry["urn"], "urn": urn})
    return sorted(out, key=lambda e: e["urn"])


def store_ranks(cur, rows, source: str, academic_year: str, resolve, release: str) -> str:
    phase, measure, _, _ = RANK_RULES[source]
    pool, total = national_ranks(rows, source)
    london = london_ranks(pool, resolve)
    cur.execute("DELETE FROM school_national_rank WHERE source_release_id = %s", (release,))
    cur.executemany(
        """INSERT INTO school_national_rank (urn, phase, academic_year, ranked_urn, measure, value,
             tiebreak_value, rank, pool_size, top_percent, source_release_id)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        [(e["urn"], phase, academic_year, e["ranked_urn"], measure, e["value"], e["tiebreak"], e["rank"],
          total, e["top_percent"], release) for e in london])
    return f"England rank: {total} schools in the pool, {len(london)} loaded schools ranked"


# --- Combined sixth-form rank: state and independent schools on one A-level scale -------------

# DfE's A level points per entry: A* = 60, A = 50, B = 40, C = 30, D = 20, E = 10, U = 0; the
# tables' +/- refinement moves half a grade. Only a tie-break: ties share the best rank anyway.
GRADE_POINTS = {"A*": 60.0, "A": 50.0, "B": 40.0, "C": 30.0, "D": 20.0, "E": 10.0, "U": 0.0}
GRADE_RE = re.compile(r"^(A\*|[A-E]|U)([+-])?$")

# A sixth form with fewer A-level students than this is too small to rank (a handful of pupils at
# the top grades is not a top sixth form); follows the MIN_SCHOOL_COHORT logic of personal_places.
MIN_ALEVEL_COHORT = 20


def _grade_points(raw: str | None) -> float | None:
    """The average A level grade as points (the tie-break), or None when not published."""
    value = cell(raw, "grade")
    if value is None or value["suppressed"]:
        return None
    match = GRADE_RE.fullmatch(str(value["value"]).strip())
    if not match:
        return None
    grade, sign = match.groups()
    return GRADE_POINTS[grade] + (5.0 if sign == "+" else -5.0 if sign == "-" else 0.0)


def combined_sixth_form_ranks(rows) -> tuple[list[dict], int]:
    """(one entry per ranked England school, pool size). The pool: RECTYPE 1 (mainstream) rows of
    every sector (state and independent; FESI colleges are not schools) with a published A level
    average point score per entry and at least MIN_ALEVEL_COHORT A-level students. Ranked high to
    low on the points, ties broken by the average grade; equal (value, grade) pairs share the best
    rank (1, 2, 2, 4); a missing grade sorts after any published one at the same value.
    top_percent = ceil(rank / pool * 100). Suppressed, not-applicable and empty cells are left out
    of the pool, as national_ranks does."""
    pool = []
    for row in rows:
        urn = row.get("URN", "").strip()
        kind = institution_type(row).upper()
        if row.get("RECTYPE", "").strip() != "1" or not re.fullmatch(r"\d{6}", urn) \
                or kind in NOT_SCHOOLS:
            continue
        value = _number(row.get("TALLPPE_ALEV_1618"))
        if value is None:
            continue
        cohort = _number(row.get("TALLPUP_ALEV_1618"))
        if cohort is None or cohort < MIN_ALEVEL_COHORT:
            continue
        grade = _grade_points(row.get("TALLPPEGRD_ALEV_1618"))
        pool.append({"urn": urn, "value": value, "cohort": int(cohort), "tiebreak": grade,
                     "key": (value, float("-inf") if grade is None else grade)})
    pool.sort(key=lambda entry: entry["key"], reverse=True)
    total = len(pool)
    previous = None
    for index, entry in enumerate(pool):
        key = entry.pop("key")
        entry["rank"] = pool[index - 1]["rank"] if key == previous else index + 1
        entry["top_percent"] = -(-entry["rank"] * 100 // total)
        previous = key
    return pool, total


def london_sixth_form_ranks(pool: list[dict], resolve, independent_urns: set[str]) -> list[dict]:
    """The pool entries of London schools: state schools through the GIAS resolver (the school's
    own row wins over a predecessor's; two predecessors and no own row are dropped), independent
    schools by direct membership in independent_school. Each entry gains kind state|independent."""
    found: dict[tuple, dict[str, dict]] = {}
    for entry in pool:
        urn = resolve(entry["urn"])
        kind = "state"
        if urn is None and entry["urn"] in independent_urns:
            urn, kind = entry["urn"], "independent"
        if urn:
            found.setdefault((urn, kind), {})[entry["urn"]] = entry
    out = []
    for (urn, kind), by_urn in found.items():
        entry = by_urn.get(urn) or (next(iter(by_urn.values())) if len(by_urn) == 1 else None)
        if entry:
            out.append({**entry, "ranked_urn": entry["urn"], "urn": urn, "kind": kind})
    return sorted(out, key=lambda e: e["urn"])


def store_sixth_form_ranks(cur, rows, academic_year: str, resolve, independent_urns: set[str],
                           release: str) -> str:
    """The combined A-level rank into school_sixth_form_rank (migration 094): one table for both
    sectors, so school_national_rank (and its state-only KS2/KS4 ranks) is never touched."""
    pool, total = combined_sixth_form_ranks(rows)
    london = london_sixth_form_ranks(pool, resolve, independent_urns)
    cur.execute("DELETE FROM school_sixth_form_rank WHERE source_release_id = %s", (release,))
    cur.executemany(
        """INSERT INTO school_sixth_form_rank (urn, academic_year, kind, ranked_urn, measure, value,
             tiebreak_value, cohort_size, rank, pool_size, top_percent, source_release_id)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        [(e["urn"], academic_year, e["kind"], e["ranked_urn"], "ks5-alevel-aps", e["value"], e["tiebreak"],
          e["cohort"], e["rank"], total, e["top_percent"], release) for e in london])
    return (f"Sixth-form rank: {total} schools in the pool, {len(london)} loaded schools ranked "
            f"({sum(1 for e in london if e['kind'] == 'independent')} independent)")


# --- school.attributes (the map card and api/area_api/personal_places.py ranking) ------------

# Measures shown on the school card; the labels are the measure names ranking looks for.
KS2_CARD = ("ks2-rwm-expected", "ks2-rwm-higher")
KS2_PROGRESS = ("ks2-reading-progress", "ks2-writing-progress", "ks2-maths-progress")


def ks2_observation(kind: str, academic_year: str, value: dict, cohort: int | None) -> dict:
    return {"kind": "performance", "academicYear": academic_year, "measure": school_measures.BY_ID[kind].label,
            "value": value["value"], "cohortSize": cohort, "suppressed": value["suppressed"],
            "sourceUrl": DATA_URL.format(source="KS2", year=download_year(academic_year)),
            "sourceRelease": release_id("KS2", academic_year)}


def with_ks2(attributes: dict, results: dict[str, tuple[dict, int | None]], academic_year: str) -> dict:
    """School attributes with the KS2 card observations replaced by the given year's and the
    'Key stage 2 …' missing notes rewritten (the with_progress8 pattern of etl_schools.py)."""
    labels = {school_measures.BY_ID[kind].label for kind in KS2_CARD}
    observations = [o for o in attributes.get("observations", []) if o.get("measure") not in labels]
    missing = [m for m in attributes.get("missingObservations", []) if not m.startswith("Key stage 2")]
    for kind in KS2_CARD:
        if kind in results:
            observations.append(ks2_observation(kind, academic_year, *results[kind]))
    if not any(kind in results for kind in KS2_CARD):
        missing.append(f"Key stage 2 results {academic_year} (no published school-level figures, "
                       "e.g. infant schools without year 6)")
    elif not any(kind in results for kind in KS2_PROGRESS):
        missing.append(f"Key stage 2 progress scores (not published for {academic_year})")
    return {**attributes, "observations": observations, "missingObservations": missing}


def update_attributes(cur) -> str:
    """Primary schools carry the latest KS2 year from school_observation; returns a summary."""
    academic_year = KS2_YEARS[-1]
    release = release_id("KS2", academic_year)
    results: dict[str, dict] = {}
    for urn, kind, value, cohort in cur.execute(
            "SELECT urn, observation_kind, value, cohort_size FROM school_observation WHERE source_release_id = %s",
            (release,)):
        results.setdefault(urn, {})[kind] = (value, cohort)
    if not results:
        return f"no {release} rows; attributes unchanged"
    schools = cur.execute("SELECT urn, attributes FROM school WHERE phase = 'primary'").fetchall()
    changed = 0
    updates = []
    label = school_measures.BY_ID["ks2-rwm-expected"].label
    for urn, attributes in schools:
        new = with_ks2(attributes, results.get(urn, {}), academic_year)
        before = [o.get("value") for o in attributes.get("observations", []) if o.get("measure") == label]
        after = [o.get("value") for o in new["observations"] if o.get("measure") == label]
        changed += before != after
        updates.append((json.dumps(new), urn))
    cur.executemany("UPDATE school SET attributes = %s WHERE urn = %s", updates)
    with_results = sum(1 for urn, _ in schools if any(k in results.get(urn, {}) for k in KS2_CARD))
    return (f"{with_results} of {len(schools)} primary schools with KS2 {academic_year}; "
            f"{changed} with a different RWM expected value than before")


def main(argv: list[str]) -> None:
    if len(argv) >= 2 and argv[1] == "fetch":
        sys.exit(1 if fetch(argv[2] if len(argv) > 2 else None) else 0)
    if len(argv) >= 2 and argv[1] == "load":
        url = argv[2] if len(argv) > 2 else common.DEFAULT_DB_URL
        sys.exit(1 if load(url, argv[3] if len(argv) > 3 else None) else 0)
    sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
