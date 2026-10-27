"""State-funded primary and secondary schools of the coverage (England, or with CLOSE_KNIT_ETL_COVERAGE=london
Greater London and just beyond), with inspection and GCSE results.

Sources (OGL v3.0):
  * Ofsted state-funded schools inspections (management information), latest
    inspections: $AE_DATA/ofsted/ofsted_latest_inspections_<date>.csv. Gives the
    register (URN, name, phase, type, ages, faith, admissions policy, postcode),
    report-card grades (inspections from November 2025) and the last graded
    overall effectiveness under the previous framework.
  * DfE key stage 4 performance 2024/25 (provisional), school level:
    $AE_WORK/202425_performance_tables_schools_provisional.csv, extracted from
    $AE_DATA/schools/ks4_2024-25_all_data.zip. Attainment 8 and grade 5+ in
    English and maths. Progress 8 is not published for 2024/25.
  * Progress 8, latest year published (2023/24: there is none for 2024/25), from
    the final school performance table inside the same zip
    (data/202425_performance_tables_schools_final.csv, read in place). Load it
    alone into schools already loaded with: python3 etl_schools.py progress8 <url>
  * Inspection observations (overall grade, every judgement of the last graded inspection, the
    last ungraded outcome) can be rewritten alone with: python3 etl_schools.py inspections <url>
  * Location: the school's postcode centre ($AE_DATA/boundaries/onspd-london-grid.csv); a school whose
    postcode is beyond that London grid takes GIAS's point (school_history_common.fetch_gias_points,
    downloaded once into ~/data/gias/<YYYY-MM>/points-<stamp>.csv).
  * Which schools: every phase-matching school in England is read (not Ofsted's "London" region, which
    files e.g. Nonsuch High, LB Sutton, under South East: #225); those with a London postcode or within
    MARGIN_METRES of a coverage LAD (area_geography kind 'lad', the coverage's LAD codes) are kept; a
    point beyond every London borough is flagged outsideLondon in attributes. school.region_code (migration
    110) is the region the school ranks in (point_rank_region).
  * England: run `add-missing` on a database that already holds London's schools, so London's rows and
    their history stay as they are and only the rest of England is added.
  * Schools missing from a loaded table (boundary schools after #225) can be added alone, touching
    nothing else: python3 etl_schools.py add-missing <url>

  AE_DATA=~/data AE_WORK=~/data/aework/schools python3 etl_schools.py <database-url>

Key stage 2 school results come from etl_school_performance.py, which also
fills school_observation. A full run empties every school history table (results,
inspections, demand, distances) and marks KS2 as not loaded, so re-run
RELEASE-CHECKLIST step 6l after it.
"""
from __future__ import annotations

import csv
import glob
import hashlib
import io
import json
import os
import sys
import zipfile
from collections.abc import Iterable
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import school_history_common as common  # noqa: E402

DATA = os.environ.get("AE_DATA", os.path.expanduser("~/data"))
WORK = os.environ.get("AE_WORK", os.path.join(DATA, "aework", "schools"))
KS4_FILE = os.path.join(WORK, "202425_performance_tables_schools_provisional.csv")
GRID = os.path.join(DATA, "boundaries", "onspd-london-grid.csv")
ETL_VERSION = "close-knit-schools-1"
OFSTED_URL = ("https://www.gov.uk/government/statistical-data-sets/"
              "monthly-management-information-ofsteds-school-inspections-outcomes")
KS4_URL = "https://explore-education-statistics.service.gov.uk/find-statistics/key-stage-4-performance"
KS4_ZIP = os.path.join(DATA, "schools", "ks4_2024-25_all_data.zip")
KS4_FINAL_MEMBER = "data/202425_performance_tables_schools_final.csv"
PROGRESS8_RELEASE = "src-dfe-ks4-2024-25-final-progress8"
PROGRESS8_MEASURE = "Progress 8"
# Ofsted's own per-school link (column "Web Link"); this search URL is the fallback.
REPORT_URL = "https://reports.ofsted.gov.uk/search?q={urn}"

PHASES = {"Primary": "primary", "Secondary": "secondary"}
# Schools this far beyond Greater London still serve its edge areas (the API lists schools within 1.5 km
# of an area's point); British National Grid box around London plus the margin pre-filters the exact test.
MARGIN_METRES = 2000
LEGACY_GRADES = {"1": "Outstanding", "2": "Good", "3": "Requires improvement", "4": "Inadequate"}
# The last graded inspection's judgements, after its overall grade (graded inspections from
# September 2024 have no overall grade, so quality of education comes first).
LEGACY_JUDGEMENTS = (
    ("Latest OEIF quality of education", "Quality of education"),
    ("Latest OEIF behaviour and attitudes", "Behaviour and attitudes"),
    ("Latest OEIF personal development", "Personal development"),
    ("Latest OEIF effectiveness of leadership and management", "Leadership and management"),
    ("Latest OEIF early years provision (where applicable)", "Early years provision"),
    ("Latest OEIF sixth form provision (where applicable)", "Sixth form provision"),
)
# Judgements printed as words: column -> (measure, {printed value: value shown}).
LEGACY_OUTCOMES = (
    ("Latest OEIF  safeguarding is effective?", "Safeguarding is effective", {"Yes": "Yes", "No": "No"}),
    ("Latest OEIF category of concern", "Category of concern",
     {"SM": "Special measures", "SWK": "Serious weaknesses"}),
)
REPORT_CARD_AREAS = (
    "Inclusion", "Curriculum and teaching", "Achievement", "Attendance and behaviour",
    "Personal development and wellbeing", "Leadership and governance",
    "Early years (where applicable)", "Post-16 provision (where applicable)",
)
# The report card's safeguarding outcome (Met / Not met), after its graded areas (#226).
SAFEGUARDING = ("Safeguarding standards", "Safeguarding")


def ofsted_file() -> str:
    files = sorted(glob.glob(os.path.join(DATA, "ofsted", "ofsted_latest_inspections_*.csv")))
    if not files:
        raise SystemExit("no Ofsted latest-inspections file under $AE_DATA/ofsted")
    return files[-1]


def academic_year(day: str) -> str:
    """dd/mm/yyyy -> 2025/26 (academic years start in September)."""
    date = datetime.strptime(day, "%d/%m/%Y")
    start = date.year if date.month >= 9 else date.year - 1
    return f"{start}/{str(start + 1)[2:]}"


def present(value: str | None) -> bool:
    return bool(value) and value not in ("NULL", "Not judged", "Not applicable")


def school_rows(path: str) -> list[dict]:
    with open(path, newline="", encoding="utf-8-sig", errors="replace") as handle:
        rows = []
        for row in csv.DictReader(handle):
            if row.get("Ofsted phase") in PHASES and row.get("URN", "").isdigit():
                rows.append(row)
        return rows


def gias_points() -> dict[str, tuple[float, float]]:
    """URN -> (easting, northing) of every establishment GIAS places."""
    points = {}
    with open(common.fetch_gias_points(), newline="") as handle:
        for row in csv.DictReader(handle):
            if number(row["Easting"]) is not None and number(row["Northing"]) is not None:
                points[row["URN"]] = (float(row["Easting"]), float(row["Northing"]))
    return points


def locate(row: dict, grid: dict, points: dict) -> tuple[tuple[float, float] | None, bool]:
    """(point, inLondon): the postcode centre from the London grid, else GIAS's point (not in London)."""
    point = grid.get(row["Postcode"].strip())
    if point:
        return point, True
    return points.get(row["URN"]), False


def near_coverage(point: tuple[float, float]) -> bool:
    """Inside the coverage's British National Grid box (a pre-filter; the LAD margin is the real test)."""
    return common.COVERAGE.contains_bng(*point)


def report_link(row: dict) -> str:
    link = (row.get("Web Link (opens in new window)") or "").strip()
    return link.replace("http://", "https://", 1) if link.startswith("http") else REPORT_URL.format(urn=row["URN"])


def observations(row: dict, ofsted_release: str) -> list[dict]:
    out = []
    link = report_link(row)
    for area in REPORT_CARD_AREAS:
        grade = row.get(area)
        day = row.get(area.replace(" (where applicable)", "") + " - date of grade")
        if present(grade) and day and day != "NULL":
            out.append({"kind": "inspection-current", "academicYear": academic_year(day),
                        "measure": area.replace(" (where applicable)", ""), "value": grade,
                        "sourceUrl": link, "sourceRelease": ofsted_release})
    safeguarding, safeguarding_day = row.get(SAFEGUARDING[0]), row.get(SAFEGUARDING[0] + " - date of grade")
    if out and present(safeguarding) and safeguarding_day and safeguarding_day != "NULL":
        out.append({"kind": "inspection-current", "academicYear": academic_year(safeguarding_day),
                    "measure": SAFEGUARDING[1], "value": safeguarding,
                    "sourceUrl": link, "sourceRelease": ofsted_release})
    legacy = row.get("Latest OEIF overall effectiveness")
    legacy_day = row.get("Publication date of latest OEIF graded inspection")
    if legacy in LEGACY_GRADES and legacy_day and legacy_day != "NULL":
        out.append({"kind": "inspection-legacy", "academicYear": academic_year(legacy_day),
                    "measure": "Overall effectiveness", "value": LEGACY_GRADES[legacy],
                    "sourceUrl": link, "sourceRelease": ofsted_release})
    if legacy_day and legacy_day != "NULL":
        for column, measure in LEGACY_JUDGEMENTS:
            if row.get(column) in LEGACY_GRADES:
                out.append({"kind": "inspection-legacy", "academicYear": academic_year(legacy_day),
                            "measure": measure, "value": LEGACY_GRADES[row[column]],
                            "sourceUrl": link, "sourceRelease": ofsted_release})
        for column, measure, values in LEGACY_OUTCOMES:
            if row.get(column) in values:
                out.append({"kind": "inspection-legacy", "academicYear": academic_year(legacy_day),
                            "measure": measure, "value": values[row[column]],
                            "sourceUrl": link, "sourceRelease": ofsted_release})
    # A later ungraded inspection confirms (or flags) the last grade, including
    # grades from before the September 2019 framework that carry no OEIF row.
    ungraded = row.get("Ungraded inspection overall outcome")
    ungraded_day = row.get("Ungraded inspection publication date") or row.get("Date of latest ungraded inspection")
    if present(ungraded) and ungraded_day and ungraded_day != "NULL":
        out.append({"kind": "inspection-legacy", "academicYear": academic_year(ungraded_day),
                    "measure": "Ungraded inspection", "value": ungraded,
                    "sourceUrl": link, "sourceRelease": ofsted_release})
    return out


def ks4_results() -> dict[str, dict]:
    if not os.path.exists(KS4_FILE):
        return {}
    results = {}
    with open(KS4_FILE, newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            if row["breakdown_topic"] != "Total" or row["breakdown"] != "Total":
                continue
            results[row["school_urn"]] = row
    return results


def progress8_results(rows: Iterable[dict]) -> dict[str, dict]:
    """URN -> the latest published Progress 8 score (whole cohort): value, pupils, academic year."""
    results: dict[str, dict] = {}
    for row in rows:
        if row["breakdown_topic"] != "Total" or row["breakdown"] != "Total":
            continue
        value = number(row.get("progress8_average"))
        period = row["time_period"]
        if value is None or (row["school_urn"] in results and results[row["school_urn"]]["period"] >= period):
            continue
        results[row["school_urn"]] = {"period": period, "value": value,
                                      "cohort": int(number(row.get("progress8_pupil_count")) or 0),
                                      "year": f"{period[:4]}/{period[4:]}"}
    return results


def progress8_observation(result: dict) -> dict:
    return {"kind": "performance", "academicYear": result["year"], "measure": PROGRESS8_MEASURE,
            "value": result["value"], "cohortSize": result["cohort"], "suppressed": False,
            "sourceUrl": KS4_URL, "sourceRelease": PROGRESS8_RELEASE}


def with_progress8(attributes: dict, result: dict | None) -> dict:
    """School attributes with the Progress 8 observation replaced and the missing note updated."""
    observations = [o for o in attributes.get("observations", []) if o.get("measure") != PROGRESS8_MEASURE]
    missing = [m for m in attributes.get("missingObservations", []) if not m.startswith("Progress 8")]
    if result:
        observations.append(progress8_observation(result))
        missing.append(f"Progress 8 for 2024/25 (not published; {result['year']} shown)")
    else:
        missing.append("Progress 8 (not published for 2024/25)")
    return {**attributes, "observations": observations, "missingObservations": missing}


def read_progress8() -> dict[str, dict]:
    if not os.path.exists(KS4_ZIP):
        return {}
    with zipfile.ZipFile(KS4_ZIP) as archive, archive.open(KS4_FINAL_MEMBER) as raw:
        return progress8_results(csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")))


def register_progress8(cur) -> None:
    digest = hashlib.sha256()
    with open(KS4_ZIP, "rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    retrieved = datetime.fromtimestamp(os.path.getmtime(KS4_ZIP)).date().isoformat()
    cur.execute(
        """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
             attribution, transformation_version, geography_vintage, validation_status, caveats)
           VALUES (%s, %s, now(), %s, %s, 'OGL-3.0', %s, %s, '2021', 'passed', %s)
           ON CONFLICT (id) DO NOTHING""",
        (PROGRESS8_RELEASE, KS4_URL, retrieved, digest.hexdigest(),
         "Department for Education, key stage 4 performance (final school tables, Progress 8). Contains "
         "public sector information licensed under the Open Government Licence v3.0.", ETL_VERSION,
         ["Progress 8 is not published for 2024/25 or 2025/26 (no key stage 2 baseline); the latest "
          "published year (2023/24) is shown.",
          "Progress 8 compares pupils with others nationally who had similar primary results: 0 is "
          "average, +0.5 is half a grade better per subject.",
          "Release date is the date the zip was retrieved."]))


def load_progress8(url: str) -> None:
    """Adds Progress 8 to schools already loaded, touching nothing else."""
    import psycopg

    results = read_progress8()
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        register_progress8(cur)
        schools = list(cur.execute("SELECT urn, attributes FROM school WHERE phase = 'secondary'"))
        cur.executemany("UPDATE school SET attributes = %s WHERE urn = %s",
                        [(json.dumps(with_progress8(attributes, results.get(urn))), urn) for urn, attributes in schools])
    print(f"progress8: {sum(1 for urn, _ in schools if urn in results)} of {len(schools)} secondary schools with a score")


def with_inspections(attributes: dict, inspections: list[dict]) -> dict:
    """School attributes with the inspection observations replaced, everything else kept."""
    kept = [o for o in attributes.get("observations", []) if not o.get("kind", "").startswith("inspection")]
    return {**attributes, "observations": inspections + kept}


def load_inspections(url: str) -> None:
    """Rewrites the inspection observations of schools already loaded, touching nothing else."""
    import psycopg

    path = ofsted_file()
    as_of = os.path.basename(path).rsplit("_", 1)[-1].removesuffix(".csv")
    release = "src-ofsted-latest-inspections-" + datetime.strptime(as_of, "%d%b%Y").strftime("%Y-%m")
    rows = {row["URN"]: row for row in school_rows(path)}
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        schools = [(urn, attributes) for urn, attributes in cur.execute("SELECT urn, attributes FROM school")
                   if urn in rows]
        cur.executemany("UPDATE school SET attributes = %s WHERE urn = %s",
                        [(json.dumps(with_inspections(attributes, observations(rows[urn], release))), urn)
                         for urn, attributes in schools])
    print(f"inspections: observations rewritten for {len(schools)} schools")


def number(value: str) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# Kept: a London postcode, or a point within MARGIN_METRES of a coverage LAD (lads: borough ids);
# outsideLondon marks a point beyond every London borough; add-missing inserts only schools absent
# from the table.
INSERT_SQL = """INSERT INTO school (urn, school_id, name, phase, attributes, location, source_release_id)
  SELECT st.urn, 'uk:school:' || st.urn, st.name, st.phase,
    st.attributes || jsonb_build_object('outsideLondon', NOT EXISTS (
      SELECT 1 FROM area_geography a WHERE a.kind = 'lad' AND a.id = ANY(%(london)s)
        AND ST_Contains(a.geometry, st.point))),
    st.point, %(release)s
  FROM (SELECT *, ST_Transform(ST_SetSRID(ST_MakePoint(easting, northing), 27700), 4326) AS point
        FROM staging_school) st
  WHERE (st.in_london OR EXISTS (SELECT 1 FROM area_geography a WHERE a.kind = 'lad' AND a.id = ANY(%(lads)s)
                                 AND a.geometry && ST_Expand(st.point, 0.05)  -- index pre-filter (> 2 km)
                                 AND (ST_Contains(a.geometry, st.point)
                                      OR ST_DWithin(a.geometry::geography, st.point::geography, %(margin)s))))
    AND (%(full)s OR NOT EXISTS (SELECT 1 FROM school s WHERE s.urn = st.urn))"""


def borough_ids(cover) -> list[str]:
    return sorted(common.coverage.borough_id(code) for code in cover.lad_codes)


def main(url: str, add_missing: bool = False) -> None:
    import psycopg

    path = ofsted_file()
    rows = school_rows(path)
    grid = {}
    with open(GRID, newline="") as handle:
        for row in csv.DictReader(handle):
            if row["easting"] and row["northing"]:
                grid[row["postcode"]] = (float(row["easting"]), float(row["northing"]))
    points = gias_points()
    ks4 = ks4_results()
    progress8 = read_progress8()
    as_of = os.path.basename(path).rsplit("_", 1)[-1].removesuffix(".csv")
    ofsted_release = "src-ofsted-latest-inspections-" + datetime.strptime(as_of, "%d%b%Y").strftime("%Y-%m")
    ks4_release = "src-dfe-ks4-2024-25-provisional"

    staged, unplaced = [], 0
    for row in rows:
        point, in_london = locate(row, grid, points)
        if point is None:
            unplaced += 1
            continue
        if not in_london and not near_coverage(point):
            continue
        obs = observations(row, ofsted_release)
        missing = []
        phase = PHASES[row["Ofsted phase"]]
        result = ks4.get(row["URN"]) if phase == "secondary" else None
        cohort = int(number(result["pupil_count"]) or 0) if result else None
        if result:
            for measure, column in (("Attainment 8", "attainment8_average"),
                                    ("Grade 5+ in English and maths (%)", "engmath_95_percent")):
                value = number(result.get(column))
                out = {"kind": "performance", "academicYear": "2024/25", "measure": measure,
                       "value": value, "cohortSize": cohort, "suppressed": value is None,
                       "sourceUrl": KS4_URL, "sourceRelease": ks4_release}
                obs.append(out)
        elif phase == "secondary":
            missing.append("GCSE results 2024/25 (no published school-level figures)")
        else:
            missing.append("Key stage 2 results (not loaded yet)")
        if not any(o["kind"].startswith("inspection") for o in obs):
            missing.append("Graded inspection (none on record under either framework)")
        attributes = {
            "type": row["Type of education"], "ageFrom": int(number(row["Statutory lowest age"]) or 0),
            "ageTo": int(number(row["Statutory highest age"]) or 0),
            "faith": row["Designated religious character"] if row["Designated religious character"] not in ("Does not apply", "None", "NULL") else None,
            "selectivity": row["Admissions policy"], "pupils": number(row["Total number of pupils"]),
            "localAuthority": row["Local authority"], "postcode": row["Postcode"].strip(),
            "sixthForm": row["Sixth form"], "observations": obs, "missingObservations": missing,
            "reportCard": any(o["kind"] == "inspection-current" for o in obs),
        }
        if phase == "secondary":
            attributes = with_progress8(attributes, progress8.get(row["URN"]))
        staged.append((row["URN"], row["School name"], phase, json.dumps(attributes), point, in_london))

    checksum = hashlib.sha256(open(path, "rb").read()).hexdigest()
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        if progress8:
            register_progress8(cur)
        for source_id, source_url, release_date, attribution, caveats in (
            (ofsted_release, OFSTED_URL, datetime.strptime(as_of, "%d%b%Y").date().isoformat(),
             "Ofsted state-funded schools inspections and outcomes. Contains public sector information "
             "licensed under the Open Government Licence v3.0.",
             ["Report-card grades (from November 2025) and legacy overall judgements are different scales and are never combined.",
              "Schools are placed at their postcode centre (GIAS's point beyond the London postcode grid); "
              "state schools up to 2 km beyond the covered area are included (attribute outsideLondon: "
              "beyond every London borough)."]),
            (ks4_release, KS4_URL, "2025-10-16",
             "Department for Education, key stage 4 performance 2024/25 (provisional). Contains public "
             "sector information licensed under the Open Government Licence v3.0.",
             ["Provisional figures; Progress 8 is not published for 2024/25."]),
        ):
            cur.execute(
                """INSERT INTO source_release (id, source_url, retrieved_at, release_date, sha256, licence,
                     attribution, transformation_version, geography_vintage, validation_status, caveats)
                   VALUES (%s, %s, now(), %s, %s, 'OGL-3.0', %s, %s, '2021', 'passed', %s)
                   ON CONFLICT (id) DO NOTHING""",
                (source_id, source_url, release_date, checksum, attribution, ETL_VERSION, caveats))
        if not add_missing:
            cur.execute("DELETE FROM school_observation")
            cur.execute("UPDATE school SET predecessor_urn = NULL, successor_urn = NULL")
            cur.execute("DELETE FROM school_admission_observation")
            cur.execute("DELETE FROM school_priority_area")
            # Migration 048 history hangs off school(urn): a full rebuild empties it too, and
            # RELEASE-CHECKLIST step 6l reloads it.
            for table in ("school_inspection", "school_admission_demand"):
                if cur.execute("SELECT to_regclass(%s)", (table,)).fetchone()[0]:
                    cur.execute(f"DELETE FROM {table}")
            cur.execute("DELETE FROM school")
        cur.execute("""CREATE TEMP TABLE staging_school (urn text, name text, phase text, attributes jsonb,
                       easting double precision, northing double precision, in_london boolean)""")
        with cur.copy("COPY staging_school FROM STDIN") as copy:
            for urn, name, phase, attributes, (east, north), in_london in staged:
                copy.write_row((urn, name, phase, attributes, east, north, in_london))
        cur.execute(INSERT_SQL, {"release": ofsted_release, "margin": MARGIN_METRES, "full": not add_missing,
                                 "lads": borough_ids(common.COVERAGE),
                                 "london": borough_ids(common.coverage.LONDON)})
        loaded = cur.rowcount
        print(f"schools: {loaded} primary/secondary schools {'added' if add_missing else 'loaded'} of "
              f"{len(staged)} staged in or near {common.COVERAGE.name} ({sum(1 for s in staged if not s[5])} beyond the London "
              f"grid), {unplaced} without a point; "
              f"{sum(1 for s in staged if json.loads(s[3])['reportCard'])} with report-card grades; "
              f"{sum(1 for s in staged if s[2] == 'secondary' and s[0] in ks4)} secondary with GCSE results")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "progress8":
        load_progress8(sys.argv[2])
    elif len(sys.argv) == 3 and sys.argv[1] == "inspections":
        load_inspections(sys.argv[2])
    elif len(sys.argv) == 3 and sys.argv[1] == "add-missing":
        main(sys.argv[2], add_missing=True)
    elif len(sys.argv) == 2:
        main(sys.argv[1])
    else:
        sys.exit(__doc__)
