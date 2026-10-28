"""Real school evidence: primary and secondary schools near an area.

Rows come from `school` (deploy/tools/etl_schools.py): the Ofsted register with
report-card grades or the last legacy overall judgement, and GCSE results for
secondaries. Payloads follow the web's SchoolSummary contract; nothing about
admission or travel time is implied — both stay explicitly unavailable.

Coverage (migration 110): the table holds England's schools; each ranks within its region
(school.region_code, London = E12000007), so London's places and pools are as before. With
CLOSE_KNIT_ENGLAND off, scoped() keeps every listing to London's schools, exactly as before.
"""
from __future__ import annotations

import re
from typing import Any, Iterable, Mapping

from . import coverage
from .scope import current as current_scope
from .search_text import NAME_KEY_SQL

# A school query's scope marker: TRUE with CLOSE_KNIT_ENGLAND on, London's schools only with it off.
_SCOPE_RE = re.compile(r"/\*school-scope:(\w+)\*/TRUE")


def scope(alias: str = "s") -> str:
    """The marker scoped() resolves at query time (feature flags are read per request)."""
    return f"/*school-scope:{alias}*/TRUE"


def scoped(sql: str) -> str:
    """The query with its school scope: every school (England) or, with the flag off, London's only."""
    served = current_scope()
    if served.regions is None:
        return sql
    codes = ", ".join(f"'{code}'" for code in served.regions if code in coverage.REGIONS)
    return _SCOPE_RE.sub(lambda m: f"{m.group(1)}.region_code IN ({codes or 'NULL'})", sql)

NEAR_RADIUS_METRES = 1500
NEAR_LIMIT = 30
SEARCH_LIMIT = 20
URN_PATTERN = re.compile(r"^[0-9]{6}$")
AREA_PATTERN = re.compile(r"^uk:(lsoa|msoa|lad):E0[0-9]{7}$")

SCHOOL_COLUMNS = """s.urn, s.name, s.phase, s.attributes, ST_Y(s.location) AS latitude,
  ST_X(s.location) AS longitude, s.source_release_id, s.region_code"""

AREA_SCHOOLS_SQL = f"""-- evidence:area-schools
WITH area AS (
  SELECT ST_PointOnSurface(geometry)::geography AS point FROM area_geography WHERE id = %s
)
SELECT {SCHOOL_COLUMNS}, round(ST_Distance(s.location::geography, area.point))::integer AS distance_metres
FROM school s, area
WHERE ST_DWithin(s.location::geography, area.point, %s) AND {scope()}
ORDER BY distance_metres
LIMIT %s"""

PROFILE_RADIUS_METRES = 1000

# One row of counts by phase; no row when no schools are loaded at all, so
# "unknown" never reads as "none nearby".
AREA_SCHOOL_COUNTS_SQL = f"""-- evidence:area-school-counts
WITH area AS (
  SELECT id, ST_PointOnSurface(geometry)::geography AS point
  FROM area_geography WHERE id = %s
)
SELECT count(s.urn) FILTER (WHERE s.phase = 'primary') AS primary_count,
  count(s.urn) FILTER (WHERE s.phase = 'secondary') AS secondary_count
FROM area LEFT JOIN school s ON ST_DWithin(s.location::geography, area.point, %s) AND {scope()}
WHERE EXISTS (SELECT 1 FROM school)
GROUP BY area.id"""

SCHOOL_SEARCH_SQL = f"""-- evidence:school-search
SELECT {SCHOOL_COLUMNS}, NULL::integer AS distance_metres
FROM school s WHERE s.name ILIKE %s AND {scope()} ORDER BY s.name LIMIT %s"""

SCHOOL_SQL = f"""-- evidence:school
SELECT {SCHOOL_COLUMNS}, NULL::integer AS distance_metres FROM school s WHERE s.urn = %s AND {scope()}"""

AREA_EXISTS_SQL = """-- evidence:area-exists
SELECT 1 FROM area_geography WHERE id = %s"""

AREA_NOISE_SQL = """-- evidence:area-noise
SELECT n.dwellings, n.road_55_share, n.rail_55_share, n.air_55_share, n.any_55_share, n.any_65_share,
  n.road_lden_median, n.road_lden_mapped_share, n.source_release_id, s.caveats, s.attribution
FROM area_noise n JOIN source_release s ON s.id = n.source_release_id
WHERE n.geography_id = %s"""

DWELLING_NOISE_SQL = """-- evidence:dwelling-noise
SELECT n.road_lden, n.rail_lden FROM dwelling_noise n
WHERE n.uprn = %s AND NOT EXISTS (SELECT 1 FROM suppressed_dwelling d WHERE d.uprn = n.uprn)"""

UPRN_PATTERN = re.compile(r"^[0-9]{1,12}$")

# School history (migration 048), read only from source releases in the active product release.
IN_ACTIVE_RELEASE = """source_release_id IN (SELECT member.source_release_id FROM product_release_member member
  WHERE member.release_id = (SELECT release_id FROM active_product_release))"""

# --- The map's Show › Schools (Fixes 23, 25, 31) ---

# Every open state school (no successor) with a point, and what its icon and hover popup show: ages (phase,
# all-through), the standing Ofsted inspection, the England rank's top % in its phase's latest year, grammar,
# faith, sixth form, GIAS gender and the latest census share of the other sex.
# The standing inspection is the school card's (inspection_gate, lib/school-card.ts ofstedStanding): the newest
# report card, legacy overall grade or 2024-25 graded areas; an ungraded visit ("School remains Good",
# "Standards maintained") leaves the grade before it in place unless it found safeguarding not effective.
# Factored out: the map's points and the evidence pack's nearest[] share this rule.
STANDING_INSPECTION_CTE = f"""SELECT DISTINCT ON (urn) urn,
    framework AS standing_framework, overall AS standing_overall,
    to_char(start_date, 'YYYY-MM-DD') AS standing_date
  FROM school_inspection
  WHERE {IN_ACTIVE_RELEASE}
    AND (starts_with(framework, 'report-card') OR overall IS NOT NULL
      OR (framework = 'eif-2024-no-overall' AND jsonb_path_exists(judgements, '$.* ? (@.type() == "number")'))
      OR jsonb_path_exists(judgements, '$.keyvalue() ? (@.key like_regex "^safeguarding" flag "i" && @.value == "No")'))
  ORDER BY urn, start_date DESC NULLS LAST, inspection_number DESC"""

# The standing inspection of the given URNs, for the evidence pack's nearest[].
STANDING_INSPECTIONS_SQL = f"""-- evidence:standing-inspections
SELECT * FROM ({STANDING_INSPECTION_CTE}) AS standing WHERE urn = ANY(%s)"""

LEGACY_GRADE_WORDS = {1: "Outstanding", 2: "Good", 3: "Requires improvement", 4: "Inadequate"}

# observation_kind -> the point's measure key (Schools filter v2; web/src/lib/school-filter.ts SCHOOL_MEASURES).
POINT_MEASURES = {"ks4-progress8": "progress8", "ks4-attainment8": "attainment8", "ks4-em-grade5": "grade5EngMaths",
                  "ks2-rwm-expected": "ks2RwmExpected", "census-fsm6-percent": "fsm6Share"}
_POINT_MEASURE_KINDS = ", ".join(f"'{kind}'" for kind in POINT_MEASURES)
_MIN_COHORT = 30  # = personal_places.MIN_SCHOOL_COHORT (that module imports this one)

SCHOOL_POINTS_SQL = f"""-- evidence:school-points
WITH rank_year AS (
  SELECT phase, max(academic_year) AS year FROM school_national_rank WHERE {IN_ACTIVE_RELEASE} GROUP BY phase
), ranked AS (
  -- London position, now the place in the school's region (migration 110): the table ranks
  -- England's schools; their order by England rank within a region is their order there (equal values share
  -- the best place, as in England). London's region holds London's schools, so its places are as before.
  SELECT r.urn, r.phase, r.academic_year, r.top_percent,
    rank() OVER (PARTITION BY r.phase, r.academic_year, sc.region_code ORDER BY r.rank) AS london_rank,
    count(*) OVER (PARTITION BY r.phase, r.academic_year, sc.region_code) AS london_pool
  FROM school_national_rank r JOIN school sc ON sc.urn = r.urn WHERE r.{IN_ACTIVE_RELEASE}
), census AS (
  SELECT DISTINCT ON (urn, observation_kind) urn, observation_kind, (value ->> 'value')::real AS share
  FROM school_observation
  WHERE observation_kind IN ('census-girls-percent', 'census-boys-percent') AND {IN_ACTIVE_RELEASE}
  ORDER BY urn, observation_kind, academic_year DESC
), profile AS (
  SELECT urn, gender FROM school_profile WHERE {IN_ACTIVE_RELEASE}
), standing AS (
  {STANDING_INSPECTION_CTE}
), measure AS (
  -- Schools filter v2: the latest published value per measure, never a suppressed cell; a results measure only
  -- from a cohort of _MIN_COHORT or more (census shares carry no cohort).
  SELECT urn, jsonb_object_agg(observation_kind, jsonb_build_array(share, academic_year)) AS measures
  FROM (SELECT DISTINCT ON (urn, observation_kind) urn, observation_kind, (value ->> 'value')::real AS share, academic_year
        FROM school_observation
        WHERE observation_kind IN ({_POINT_MEASURE_KINDS}) AND {IN_ACTIVE_RELEASE}
          AND NOT coalesce((value ->> 'suppressed')::boolean, false) AND jsonb_typeof(value -> 'value') = 'number'
          AND (observation_kind LIKE 'census-%' OR coalesce(cohort_size, 0) >= {_MIN_COHORT})
        ORDER BY urn, observation_kind, academic_year DESC) latest
  GROUP BY urn
)
SELECT s.urn, s.name, s.phase, ST_Y(s.location) AS latitude, ST_X(s.location) AS longitude,
  s.attributes ->> 'ageFrom' AS age_from, s.attributes ->> 'ageTo' AS age_to,
  s.attributes ->> 'selectivity' AS selectivity, s.attributes ->> 'faith' AS faith,
  s.attributes ->> 'sixthForm' AS sixth_form, (s.attributes ->> 'reportCard')::boolean AS report_card,
  s.attributes ->> 'type' AS establishment_type, m.measures,
  jsonb_path_query_first(s.attributes,
    '$.observations[*] ? (@.kind == "inspection-legacy" && @.measure == "Overall effectiveness").value') #>> '{{}}'
    AS legacy_grade,
  standing.standing_framework, standing.standing_overall, rk.top_percent, rk.academic_year AS rank_year,
  rk.london_rank, rk.london_pool, s.region_code, p.gender,
  CASE p.gender WHEN 'Girls' THEN boys.share WHEN 'Boys' THEN girls.share END AS other_sex_percent
FROM school s
LEFT JOIN rank_year y ON y.phase = s.phase
LEFT JOIN ranked rk ON rk.urn = s.urn AND rk.phase = s.phase AND rk.academic_year = y.year
LEFT JOIN profile p ON p.urn = s.urn
LEFT JOIN standing ON standing.urn = s.urn
LEFT JOIN measure m ON m.urn = s.urn
LEFT JOIN census girls ON girls.urn = s.urn AND girls.observation_kind = 'census-girls-percent'
LEFT JOIN census boys ON boys.urn = s.urn AND boys.observation_kind = 'census-boys-percent'
WHERE s.location IS NOT NULL AND s.successor_urn IS NULL AND {scope()} ORDER BY s.urn"""

# Independent schools (migration 067) are a table of their own, absent before 067.
INDEPENDENT_TABLE_SQL = """-- evidence:independent-school-table
SELECT to_regclass('independent_school') IS NOT NULL AS t"""

# The combined sixth-form rank (migration 094, issue #201) is absent before 094.
SIXTH_FORM_RANK_TABLE_SQL = """-- evidence:sixth-form-rank-table
SELECT to_regclass('school_sixth_form_rank') IS NOT NULL AS t"""

# The required wording on every combined A-level rank (issue #201): selection explains part of
# the results, so the rank is never read as teaching quality alone.
SIXTH_FORM_SELECTION_NOTE = (
    "Independent and selective (grammar) schools choose their pupils, so high results partly "
    "reflect who gets in, not only teaching. Some independent schools don't publish results.")

# Every open independent school with a point, and the combined A-level rank where the school has
# one (migration 094): the England rank becomes the place among the ranked sixth forms of the school's region
# (migration 110; London's as before), derived the same way as the state ranks' position (rank() over the
# England rank). A ranked sixth form's region is its school's: state (school) or independent.
SIXTH_FORM_REGION_SQL = """(SELECT coalesce(st.region_code, ind.region_code) FROM (SELECT 1) one
    LEFT JOIN school st ON x.kind = 'state' AND st.urn = x.urn
    LEFT JOIN independent_school ind ON x.kind = 'independent' AND ind.urn = x.urn)"""

INDEPENDENT_POINTS_SQL = f"""-- evidence:independent-school-points
WITH sixth_year AS (
  SELECT max(academic_year) AS year FROM school_sixth_form_rank WHERE {IN_ACTIVE_RELEASE}
), placed AS (
  SELECT x.urn, x.academic_year, x.rank, {SIXTH_FORM_REGION_SQL} AS region_code
  FROM school_sixth_form_rank x
  WHERE x.{IN_ACTIVE_RELEASE} AND x.academic_year = (SELECT year FROM sixth_year)
), sixth AS (
  SELECT urn, academic_year, rank() OVER (PARTITION BY region_code ORDER BY rank) AS london_rank,
    count(*) OVER (PARTITION BY region_code) AS london_pool
  FROM placed
)
SELECT i.urn, i.name, i.age_from, i.age_to, i.gender, i.religious_character, i.sixth_form,
  ST_Y(i.location) AS latitude, ST_X(i.location) AS longitude, i.region_code,
  s.london_rank AS alevel_rank, s.london_pool AS alevel_pool, s.academic_year AS alevel_year
FROM independent_school i LEFT JOIN sixth s ON s.urn = i.urn
WHERE i.{IN_ACTIVE_RELEASE} AND {scope("i")} ORDER BY i.urn"""

# Before migration 094: the points without the combined rank.
INDEPENDENT_POINTS_SQL_BASIC = f"""-- evidence:independent-school-points
SELECT urn, name, age_from, age_to, gender, religious_character, sixth_form,
  ST_Y(location) AS latitude, ST_X(location) AS longitude
FROM independent_school i WHERE {IN_ACTIVE_RELEASE} AND {scope("i")} ORDER BY urn"""

# Independent schools within a radius of the area's centre, nearest first (the evidence pack, #250).
INDEPENDENT_NEAR_SQL = f"""-- evidence:independent-schools-near
WITH area AS (
  SELECT ST_PointOnSurface(geometry)::geography AS point FROM area_geography WHERE id = %s
)
SELECT s.urn, s.name, s.age_from, s.age_to, s.gender, s.religious_character, s.sixth_form, s.source_release_id,
  round(ST_Distance(s.location::geography, area.point))::integer AS distance_metres
FROM independent_school s, area
WHERE s.{IN_ACTIVE_RELEASE} AND ST_DWithin(s.location::geography, area.point, %s) AND {scope()}
ORDER BY distance_metres, s.urn"""

# Independent schools by name for the site search (G-E17): the name compared in search_text's normal form, so
# "Withington Girls School" finds Withington Girls' School.
INDEPENDENT_SEARCH_SQL = f"""-- evidence:independent-school-search
SELECT i.urn, i.name, ST_Y(i.location) AS latitude, ST_X(i.location) AS longitude
FROM independent_school i
WHERE i.{IN_ACTIVE_RELEASE} AND {NAME_KEY_SQL.format(column="i.name")} LIKE %s ESCAPE '\\' AND {scope("i")}
ORDER BY i.name LIMIT %s"""

OFSTED_GRADES = {"Outstanding": "outstanding", "Good": "good", "Requires improvement": "requires-improvement",
                 "Inadequate": "inadequate"}
# England's Top 5 / 10 / 25% of the latest ranked year: the one figure behind the map's award plaque, the popup tag
# and the school page's Results line (owner report). regionRank / regionPool is the place in London only.
TOP_PERCENT_MAX = 25


def _age(text: Any) -> int | None:
    try:
        return int(float(text))
    except (TypeError, ValueError):
        return None


def school_stage(phase: str | None, age_from: int | None, age_to: int | None) -> str:
    """primary | secondary | all-through: all-through when the ages span primary and GCSE (from under 10 to 16+).
    Without a phase (independent schools) a school to 13 at most is a primary (prep schools), else a secondary."""
    if age_from is not None and age_to is not None and age_from < 10 and age_to >= 16:
        return "all-through"
    if phase in ("primary", "secondary"):
        return phase
    return "primary" if age_to is not None and age_to <= 13 else "secondary"


def intake(gender: str | None, has_sixth_form: bool, other_sex_percent: float | None) -> dict | None:
    """GIAS gender, and "Girls · mixed sixth form" (or Boys …) when a single-sex school with a sixth form
    counts pupils of the other sex in the census, which covers Years 12-13 too: they join the sixth form."""
    if gender not in ("Mixed", "Girls", "Boys"):
        return None
    mixed = gender != "Mixed" and has_sixth_form and other_sex_percent is not None and other_sex_percent > 0
    return {"label": f"{gender} · mixed sixth form" if mixed else gender, "mixedSixthForm": mixed}


def _point(row: Mapping[str, Any], kind: str, phase: str, stage: str) -> dict:
    return {"urn": row["urn"], "name": row["name"], "phase": phase, "kind": kind, "stage": stage,
            "latitude": round(float(row["latitude"]), 6), "longitude": round(float(row["longitude"]), 6)}


def _present(**fields: Any) -> dict:
    """Optional fields, left out when empty: the map asks for every school at once."""
    return {key: value for key, value in fields.items() if value not in (None, False, "")}


LEGACY_OVERALL = {1: "outstanding", 2: "good", 3: "requires-improvement", 4: "inadequate"}


def standing_inspections(connection: Any, urns: list[str]) -> dict[str, dict]:
    """urn -> the standing inspection: {grade, framework, year}. grade is a legacy overall
    grade word ("Good"), "report card" for the new framework, or None (2024-25 graded areas, a
    safeguarding "No", or no inspection row). An ungraded visit never appears: it leaves the earlier
    grade in place. Report-card and legacy grades are never combined."""
    if not urns:
        return {}
    out = {}
    for row in connection.execute(STANDING_INSPECTIONS_SQL, (list(urns),)):
        framework = row["standing_framework"] or ""
        if framework.startswith("report-card"):
            grade, kind = "report card", "report-card"
        elif row["standing_overall"] is not None:
            grade, kind = LEGACY_GRADE_WORDS.get(row["standing_overall"]), "legacy-overall"
        else:
            grade, kind = None, "graded-areas"
        year = (row["standing_date"] or "")[:4] or None
        out[row["urn"]] = {"grade": grade, "framework": kind, "year": year}
    return out


_UNGRADED_TEXT = ("standards maintained", "school remains")


def is_ungraded_visit(measure: Any, value: Any) -> bool:
    """An ungraded visit's outcome ("Standards maintained", "School remains Good …"): it confirms the
    standing grade, never replaces it."""
    text = str(value or "")
    return measure == "Ungraded inspection" or any(t in text.lower() for t in _UNGRADED_TEXT)


def standing_from_observations(observations: list[Mapping[str, Any]]) -> dict | None:
    """The standing grade from the school's own observations (no DB): the newest report card, else the
    latest graded legacy judgement; an ungraded visit confirms the grade, never replaces it. Report-card
    and legacy grades are never blended into one value."""
    for observation in observations or []:
        kind = str(observation.get("kind", ""))
        if not kind.startswith("inspection"):
            continue
        if is_ungraded_visit(observation.get("measure"), observation.get("value")):
            continue
        if kind == "inspection-current":
            return {"grade": "report card", "framework": "report-card",
                    "year": observation.get("academicYear")}
        text = str(observation.get("value", ""))
        for grade in LEGACY_GRADE_WORDS.values():
            if grade.lower() in text.lower():
                return {"grade": grade, "framework": "legacy-overall",
                        "year": observation.get("academicYear")}
    return None


REPORT_CARD_SAFEGUARDING = "Safeguarding"


def report_card(observations: list[Mapping[str, Any]]) -> dict | None:
    """The newest Ofsted report card as a whole (#226): {year, areas: [{label, grade}], safeguarding}.
    A report card has no single grade, so every graded area keeps its label; safeguarding is its
    Met / Not met outcome (None when the ETL has not written it). None without a report card."""
    current = [o for o in observations or [] if o.get("kind") == "inspection-current"]
    if not current:
        return None
    year = current[0].get("academicYear")
    areas = [{"label": o.get("measure"), "grade": o.get("value")}
             for o in current if o.get("measure") != REPORT_CARD_SAFEGUARDING]
    safeguarding = next((o.get("value") for o in current if o.get("measure") == REPORT_CARD_SAFEGUARDING), None)
    return {"year": year, "areas": areas, "safeguarding": safeguarding}


def newest_ungraded(observations: list[Mapping[str, Any]]) -> dict | None:
    """The newest ungraded visit as detail: {year, outcome}. None when there is none."""
    for observation in observations or []:
        if not str(observation.get("kind", "")).startswith("inspection"):
            continue
        if is_ungraded_visit(observation.get("measure"), observation.get("value")):
            return {"year": observation.get("academicYear"), "outcome": observation.get("value")}
    return None


def ofsted_mark(row: Mapping[str, Any]) -> str | None:
    """The icon's Ofsted mark from the standing inspection (SCHOOL_POINTS_SQL): a report card, or the legacy
    overall grade; none for 2024-25 graded areas or safeguarding not effective (no single grade). Without any
    inspection row, the school's own observations: report card, or the overall effectiveness grade."""
    framework = row.get("standing_framework")
    if framework is not None:
        return "report-card" if framework.startswith("report-card") else LEGACY_OVERALL.get(row.get("standing_overall"))
    return "report-card" if row.get("report_card") else OFSTED_GRADES.get(row.get("legacy_grade") or "")


ESTABLISHMENT_GROUPS = ("academy", "free", "community", "voluntary", "foundation")


def establishment_group(type_of_education: Any) -> str | None:
    """GIAS "Type of education" as one of ESTABLISHMENT_GROUPS ("Academy converter" -> academy,
    "Free schools 16 to 19" -> free, "Voluntary aided school" -> voluntary); None for anything else."""
    text = str(type_of_education or "").lower()
    if text.startswith("free school"):
        return "free"
    return next((group for group in ESTABLISHMENT_GROUPS if text.startswith(group)), None)


def point_measures(row: Mapping[str, Any]) -> dict | None:
    """Schools filter v2: {measure key: [value, academic year]} (rounded for the map), plus England top % from the
    national rank at any value (the point's topPercent stops at Top 25%, the plaque's last tier)."""
    out = {}
    for kind, pair in (row.get("measures") or {}).items():
        key = POINT_MEASURES.get(kind)
        if key and isinstance(pair, list) and len(pair) == 2 and isinstance(pair[0], (int, float)):
            out[key] = [round(float(pair[0]), 2), pair[1]]
    if row.get("top_percent") is not None and row.get("rank_year"):
        out["englandTopPercent"] = [round(float(row["top_percent"]), 1), row["rank_year"]]
    return out or None


def point_scope(row: Mapping[str, Any]) -> dict | None:
    """The region its regionRank / aLevelRank place is within, outside London only (London's points as before)."""
    region = row.get("region_code")
    return coverage.rank_scope(region) if region and region != coverage.LONDON_REGION else None


def state_point(row: Mapping[str, Any]) -> dict:
    stage = school_stage(row["phase"], _age(row.get("age_from")), _age(row.get("age_to")))
    sixth = row.get("sixth_form") == "Has a sixth form"
    single_sex = intake(row.get("gender"), sixth, row.get("other_sex_percent"))
    top, faith = row.get("top_percent"), row.get("faith")
    ranked = top is not None and top <= TOP_PERCENT_MAX
    london_rank, london_pool = row.get("london_rank"), row.get("london_pool")
    return {**_point(row, "state", row["phase"], stage), **_present(
        group=establishment_group(row.get("establishment_type")), measures=point_measures(row),
        ofsted=ofsted_mark(row),
        topPercent=int(top) if ranked else None, rankYear=row.get("rank_year") if ranked else None,
        regionRank=int(london_rank) if london_rank and london_pool else None,
        regionPool=int(london_pool) if london_rank and london_pool else None,
        selective=row.get("selectivity") == "Selective", faith=None if faith in (None, "Unknown", "None") else faith,
        sixthForm=sixth, intake=single_sex["label"] if single_sex and single_sex["label"] != "Mixed" else None,
        rankScope=point_scope(row))}


def independent_point(row: Mapping[str, Any]) -> dict:
    """Independent schools carry the combined A-level rank where they have one (migration 094);
    still no Ofsted grade (most are ISI-inspected)."""
    stage = school_stage(None, row.get("age_from"), row.get("age_to"))
    gender = row.get("gender")
    rank, pool = row.get("alevel_rank"), row.get("alevel_pool")
    return {**_point(row, "independent", "primary" if stage == "primary" else "secondary", stage), **_present(
        faith=row.get("religious_character"), sixthForm=bool(row.get("sixth_form")),
        intake=gender if gender in ("Girls", "Boys") else None,
        aLevelRank={"rank": int(rank), "pool": int(pool), "year": row.get("alevel_year"),
                    "note": SIXTH_FORM_SELECTION_NOTE} if rank and pool else None,
        rankScope=point_scope(row))}


def school_points(rows: Iterable[Mapping[str, Any]], release_id: str,
                  independent_rows: Iterable[Mapping[str, Any]] = ()) -> dict:
    """school-points.v1: one map point per open school, state then independent (kind)."""
    return {"schemaVersion": "school-points.v1", "productReleaseId": release_id,
            "schools": [state_point(row) for row in rows] + [independent_point(row) for row in independent_rows]}


def load_points(connection: Any, release_id: str) -> dict:
    """school-points.v1 read from the database: the map's points, and the set My match's school filter picks from."""
    rows = list(connection.execute(scoped(SCHOOL_POINTS_SQL)))
    independent = []
    if list(connection.execute(INDEPENDENT_TABLE_SQL))[0]["t"]:
        sixth = list(connection.execute(SIXTH_FORM_RANK_TABLE_SQL))[0]["t"]
        independent = list(connection.execute(scoped(INDEPENDENT_POINTS_SQL if sixth else INDEPENDENT_POINTS_SQL_BASIC)))
    return school_points(rows, release_id, independent)


SCHOOL_OBSERVATIONS_HISTORY_SQL = f"""-- evidence:school-history-observations
SELECT observation_kind, academic_year, value, cohort_size, source_release_id
FROM school_observation WHERE urn = %s AND {IN_ACTIVE_RELEASE}
ORDER BY observation_kind, academic_year"""

SCHOOL_INSPECTIONS_SQL = f"""-- evidence:school-history-inspections
SELECT inspection_number, inspected_urn, start_date::text AS start_date,
  publication_date::text AS publication_date, inspection_type, framework, overall, judgements,
  report_url, key_findings, improve_text, text_extracted_at IS NOT NULL AS report_matched, source_release_id
FROM school_inspection WHERE urn = %s AND {IN_ACTIVE_RELEASE}
ORDER BY start_date DESC NULLS LAST, inspection_number DESC"""

SCHOOL_DEMAND_SQL = f"""-- evidence:school-history-demand
SELECT entry_year, entry_point, first_preferences, any_preferences, offers, first_preference_offers, pan,
  second_preferences, third_preferences, preferred_offers, second_preference_offers, third_preference_offers,
  source_release_id
FROM school_admission_demand WHERE urn = %s AND {IN_ACTIVE_RELEASE}
ORDER BY entry_point, entry_year"""

# Every council's table is shown (owner decision), credited and linked; publishable stays in
# the data as "re-use confirmed" (OGL) and the active release still gates what is read.
SCHOOL_DISTANCES_SQL = f"""-- evidence:school-history-distances
SELECT academic_year, entry_point, rule_id, school_site_id, measurement_method, last_offer_distance_metres,
  raw_value, all_offered, last_offer_criterion, applicants, offers, refused, source_url, source_release_id,
  publishable
FROM school_admission_observation WHERE urn = %s AND {IN_ACTIVE_RELEASE}
ORDER BY academic_year, rule_id, school_site_id"""

HISTORY_SOURCES_SQL = """-- evidence:school-history-sources
SELECT id, licence, attribution, caveats FROM source_release WHERE id = ANY(%s) ORDER BY id"""

# Labels and units of deploy/tools/school_measures.py (api/tests/test_schools.py keeps them equal).
SCHOOL_MEASURE_LABELS = {
    "ks2-rwm-expected": ("Expected standard in reading, writing and maths (%)", "percent"),
    "ks2-rwm-higher": ("Higher standard in reading, writing and maths (%)", "percent"),
    "ks2-reading-score": ("Average scaled score in reading", "score"),
    "ks2-maths-score": ("Average scaled score in maths", "score"),
    "ks2-gps-score": ("Average scaled score in grammar, punctuation and spelling", "score"),
    "ks2-gps-expected": ("Expected standard in grammar, punctuation and spelling (%)", "percent"),
    "ks2-reading-progress": ("Reading progress", "progress"),
    "ks2-writing-progress": ("Writing progress", "progress"),
    "ks2-maths-progress": ("Maths progress", "progress"),
    "ks4-attainment8": ("Attainment 8", "score"),
    "ks4-progress8": ("Progress 8", "progress"),
    "ks4-em-grade5": ("Grade 5+ in English and maths (%)", "percent"),
    "ks4-em-grade4": ("Grade 4+ in English and maths (%)", "percent"),
    "ks4-ebacc-aps": ("EBacc average point score", "score"),
    "ks5-alevel-aps": ("A level average point score per entry", "score"),
    "ks5-alevel-grade": ("A level average grade per entry", "grade"),
    "ks5-alevel-va": ("A level value added", "progress"),
    "ks5-students": ("Students aged 16-18 in the sixth form", "pupils"),
    "pupils": ("Pupils on roll", "pupils"),
    "census-girls-percent": ("Girls on roll (%)", "percent"),
    "census-boys-percent": ("Boys on roll (%)", "percent"),
    "census-fsm6-percent": ("Eligible for free school meals in the past 6 years (%)", "percent"),
    "census-eal-percent": ("First language not English (%)", "percent"),
    "census-sen-support-percent": ("SEN support (%)", "percent"),
    "census-ehcp-percent": ("Education, health and care plan (%)", "percent"),
    "absence-overall-percent": ("Overall absence (% of sessions)", "percent"),
    "absence-persistent-percent": ("Persistent absentees (% of pupils missing 10%+ of sessions)", "percent"),
}


def school_history(connection: Any, urn: str) -> dict:
    """Every year held for one school: results by measure, Ofsted inspections, applications and
    offers, and the last place offered (every council's table, publishable flag kept), with the attribution of
    every source behind them. Years not published are absent, never filled."""
    if not URN_PATTERN.match(urn or ""):
        raise ValueError(f"invalid URN: {urn}")
    used: set[str] = set()

    series: dict[str, list[dict]] = {}
    for row in connection.execute(SCHOOL_OBSERVATIONS_HISTORY_SQL, (urn,)):
        value = row["value"] or {}
        point = {"academicYear": row["academic_year"], "value": value.get("value"),
                 "suppressed": bool(value.get("suppressed")), "cohortSize": row["cohort_size"],
                 "sourceRelease": row["source_release_id"]}
        if value.get("code"):
            point["suppressionCode"] = value["code"]
        series.setdefault(row["observation_kind"], []).append(point)
        used.add(row["source_release_id"])
    order = list(SCHOOL_MEASURE_LABELS)
    measures = [
        {"id": kind, "label": SCHOOL_MEASURE_LABELS.get(kind, (kind, None))[0],
         "unit": SCHOOL_MEASURE_LABELS.get(kind, (kind, None))[1], "series": points}
        for kind, points in sorted(series.items(),
                                   key=lambda item: order.index(item[0]) if item[0] in order else len(order))
    ]

    inspections = []
    for row in connection.execute(SCHOOL_INSPECTIONS_SQL, (urn,)):
        inspections.append({
            "inspectionNumber": row["inspection_number"], "inspectedUrn": row["inspected_urn"],
            "startDate": row["start_date"], "publicationDate": row["publication_date"],
            "inspectionType": row["inspection_type"], "framework": row["framework"], "overall": row["overall"],
            "judgements": row["judgements"] or {},
            # Only a matched report PDF: the provider page of a closed predecessor URN can be a 404.
            "reportUrl": row["report_url"] if row["report_matched"] else None,
            "keyFindings": row["key_findings"], "improveText": row["improve_text"],
            "sourceRelease": row["source_release_id"],
        })
        used.add(row["source_release_id"])

    demand = []
    for row in connection.execute(SCHOOL_DEMAND_SQL, (urn,)):
        demand.append({
            "entryYear": row["entry_year"], "entryPoint": row["entry_point"],
            "firstPreferences": row["first_preferences"], "anyPreferences": row["any_preferences"],
            "offers": row["offers"], "firstPreferenceOffers": row["first_preference_offers"], "pan": row["pan"],
            "secondPreferences": row.get("second_preferences"), "thirdPreferences": row.get("third_preferences"),
            "preferredOffers": row.get("preferred_offers"),
            "secondPreferenceOffers": row.get("second_preference_offers"),
            "thirdPreferenceOffers": row.get("third_preference_offers"),
            "sourceRelease": row["source_release_id"],
        })
        used.add(row["source_release_id"])

    distances = []
    for row in connection.execute(SCHOOL_DISTANCES_SQL, (urn,)):
        distances.append({
            "academicYear": row["academic_year"], "entryPoint": row["entry_point"], "rule": row["rule_id"],
            "site": row["school_site_id"], "measurementMethod": row["measurement_method"],
            "distanceMetres": row["last_offer_distance_metres"], "rawValue": row["raw_value"],
            "allOffered": row["all_offered"], "criterion": row["last_offer_criterion"],
            "applicants": row["applicants"], "offers": row["offers"], "refused": row["refused"],
            "sourceUrl": row["source_url"], "sourceRelease": row["source_release_id"],
            "publishable": bool(row.get("publishable")),
        })
        used.add(row["source_release_id"])

    sources = [
        {"id": row["id"], "licence": row["licence"], "attribution": row["attribution"],
         "caveats": list(row["caveats"] or [])}
        for row in (connection.execute(HISTORY_SOURCES_SQL, (sorted(used),)) if used else [])
    ]
    return {"schemaVersion": "school-history.v1", "urn": urn, "measures": measures,
            "inspections": inspections, "demand": demand, "distances": distances, "sources": sources}


def noise_payload(area_id: str, release_id: str, row: Mapping[str, Any] | None,
                  dwelling: Mapping[str, Any] | None, uprn: str | None) -> dict:
    """Shares of dwellings at or above 55 / 65 dB Lden, from road, rail or aircraft (Defra Round 4).

    Levels under 40 dB Lden are not mapped, so the road Lden median covers
    mapped homes only (roadLdenMappedShare reports the share mapped) and is
    null when under half the homes are mapped.
    """
    def share(value):
        return None if value is None else round(float(value), 3)
    caveats = list(row["caveats"]) if row else []
    if row is not None:
        caveats.append("Homes under 40 dB Lden are not mapped; the road median covers mapped homes only.")
    return {
        "schemaVersion": "area-noise.v1",
        "productReleaseId": release_id,
        "geographyId": area_id,
        "available": row is not None,
        "dwellings": row["dwellings"] if row else 0,
        "road55Share": share(row["road_55_share"]) if row else None,
        "rail55Share": share(row["rail_55_share"]) if row else None,
        "air55Share": share(row["air_55_share"]) if row else None,
        "any55Share": share(row["any_55_share"]) if row else None,
        "any65Share": share(row["any_65_share"]) if row else None,
        "roadLdenMedian": share(row["road_lden_median"]) if row else None,
        "roadLdenMappedShare": share(row.get("road_lden_mapped_share")) if row else None,
        "dwelling": ({"uprn": uprn, "roadLden": dwelling["road_lden"], "railLden": dwelling["rail_lden"]}
                     if dwelling else None),
        "sourceVersion": row["source_release_id"] if row else None,
        "attribution": row["attribution"] if row else None,
        "caveats": caveats,
    }


def school_summary(row: Mapping[str, Any], top_badge: dict | None = None) -> dict:
    attributes = row["attributes"]
    observations = [
        {"cohortSize": None, "suppressed": False, **observation}
        for observation in attributes.get("observations", [])
    ]
    return {
        "schoolId": f"uk:school:{row['urn']}",
        "urn": row["urn"],
        "name": row["name"],
        "previousNames": [],
        "status": "open",
        "closedDate": None,
        "predecessorUrn": None,
        "successorUrn": None,
        "observations": observations,
        "missingObservations": attributes.get("missingObservations", []),
        "phase": row["phase"],
        "type": attributes.get("type") or "School",
        "ageRange": {"from": attributes.get("ageFrom") or 0, "to": attributes.get("ageTo") or 0},
        "gender": "not published in this release",
        "faith": attributes.get("faith"),
        "selectivity": attributes.get("selectivity") or "Unknown",
        "capacity": None,
        "senProvision": [],
        "latitude": round(float(row["latitude"]), 6),
        "longitude": round(float(row["longitude"]), 6),
        "journeyMinutes": None,
        "distanceMetres": row.get("distance_metres"),
        "qualityFacets": {},
        "inspectionFramework": "report-card" if attributes.get("reportCard") else "legacy-overall",
        "parentViewResponses": None,
        "admissionEvidence": {
            "kind": "unavailable", "academicYears": [], "yearsWithin": None, "measurementMethod": None,
            "sourceUrls": [], "cutoffs": [], "isProbability": False,
        },
        "sourceVersion": row["source_release_id"],
        # school_card.top_badge where the caller computed it (area list, card); None elsewhere.
        "topBadge": top_badge,
    }


# --- School rankings: one measure, one phase, one year; never a blended score. ---

RANKING_LIMIT = 100
RANKING_PHASES = ("primary", "secondary")
OGL = "Contains public sector information licensed under the Open Government Licence v3.0."

SCHOOL_RANKING_SQL = f"""-- evidence:school-ranking
SELECT s.urn, s.name, s.attributes FROM school s WHERE s.phase = %s AND {scope()}"""

# axis -> KS4 measure; ranked high to low, cohort ≥ MIN_SCHOOL_COHORT, latest year only.
PERFORMANCE_AXES = {
    "grade5-english-maths": "Grade 5+ in English and maths (%)",
    "attainment-8": "Attainment 8",
    "progress-8": "Progress 8",
}
RANKING_CAVEATS = {
    # KS4 axes: the year and status come first, from the rows (_performance_caveat).
    "grade5-english-maths": ["State-funded schools only."],
    "attainment-8": ["State-funded schools only."],
    "progress-8": ["State-funded schools only."],
    "legacy-outstanding": [
        "Legacy overall effectiveness only; schools since inspected under report cards are left out.",
        "Legacy grades age out as schools are re-inspected; read the inspection year."],
    "report-card-exceptional": [
        "Report-card grades from November 2025 only; never combined with legacy grades.",
        "Only schools inspected since November 2025 appear; ties are expected."],
}


def _ranking_row(school: Mapping[str, Any], value: Any, cohort: int | None, year: str) -> dict:
    return {"urn": school["urn"], "name": school["name"],
            "borough": school["attributes"].get("localAuthority"),
            "value": value, "cohort": cohort, "year": year}


def _performance_rows(measure: str, schools: list[Mapping[str, Any]]) -> tuple[list[dict], str | None]:
    from .personal_places import MIN_SCHOOL_COHORT

    found = [(school, obs) for school in schools for obs in school["attributes"].get("observations", [])
             if obs.get("kind") == "performance" and obs.get("measure") == measure
             and not obs.get("suppressed") and obs.get("value") is not None
             and (obs.get("cohortSize") or 0) >= MIN_SCHOOL_COHORT]
    year = max((obs["academicYear"] for _, obs in found), default=None)
    rows = [_ranking_row(school, obs["value"], obs["cohortSize"], year)
            for school, obs in found if obs["academicYear"] == year]
    return sorted(rows, key=lambda r: (-r["value"], r["name"])), year


def _performance_caveat(measure: str, schools: list[Mapping[str, Any]], year: str | None) -> list[str]:
    """The year ranked and whether DfE's figures are provisional, read from the observations; a measure
    behind the other KS4 results (Progress 8 is not published every year) says so."""
    if year is None:
        return []
    performance = [obs for school in schools for obs in school["attributes"].get("observations", [])
                   if obs.get("kind") == "performance" and obs.get("academicYear")]
    provisional = any("provisional" in (obs.get("sourceRelease") or "") for obs in performance
                      if obs.get("measure") == measure and obs["academicYear"] == year)
    text = f"{'Provisional ' if provisional else ''}{year} figures (DfE)"
    latest = max(obs["academicYear"] for obs in performance)
    if latest > year:
        return [f"{text}: {measure} is not published for {latest}."]
    return [f"{text}."]


def _legacy_outstanding_rows(schools: list[Mapping[str, Any]]) -> list[dict]:
    rows = [_ranking_row(school, obs["value"], None, obs["academicYear"])
            for school in schools if not school["attributes"].get("reportCard")
            for obs in school["attributes"].get("observations", [])
            if obs.get("kind") == "inspection-legacy" and obs.get("measure") == "Overall effectiveness"
            and obs.get("value") == "Outstanding"]
    rows.sort(key=lambda r: r["name"])
    return sorted(rows, key=lambda r: r["year"], reverse=True)


def _report_card_rows(schools: list[Mapping[str, Any]]) -> list[dict]:
    rows = []
    for school in schools:
        exceptional = [obs for obs in school["attributes"].get("observations", [])
                       if obs.get("kind") == "inspection-current" and obs.get("value") == "Exceptional"]
        if exceptional:
            rows.append(_ranking_row(school, len(exceptional), None,
                                     max(obs["academicYear"] for obs in exceptional)))
    return sorted(rows, key=lambda r: (-r["value"], r["name"]))


def school_ranking(axis: str, schools: list[Mapping[str, Any]], limit: int) -> dict:
    """Rows of one phase's schools for one axis: urn, name, borough, value, cohort, year."""
    from .personal_places import MIN_SCHOOL_COHORT

    if axis in PERFORMANCE_AXES:
        rows, year = _performance_rows(PERFORMANCE_AXES[axis], schools)
        extra = {"measure": PERFORMANCE_AXES[axis], "year": year, "minCohort": MIN_SCHOOL_COHORT}
        caveats = _performance_caveat(PERFORMANCE_AXES[axis], schools, year) + RANKING_CAVEATS[axis]
    elif axis == "legacy-outstanding":
        rows = _legacy_outstanding_rows(schools)
        extra = {"measure": "Ofsted overall effectiveness (legacy)", "year": None, "minCohort": None}
        caveats = RANKING_CAVEATS[axis]
    else:
        rows = _report_card_rows(schools)
        inspected = sum(1 for school in schools if school["attributes"].get("reportCard"))
        extra = {"measure": "Report-card areas graded exceptional", "year": None, "minCohort": None,
                 "inspectedSchools": inspected}
        caveats = RANKING_CAVEATS[axis]
    return {**extra, "eligibleSchools": len(rows), "rows": rows[:limit],
            "caveats": list(caveats), "attribution": OGL}
