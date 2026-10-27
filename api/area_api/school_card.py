"""School card (school-card.v1): one school's history set against its region (London for London's schools,
migration 110), a "Top school" badge, short dated Ofsted extracts and the last place offered by its council.
Field names keep "london" (regionMedian, regionRank...): the values are the school's region's.

  * Percentiles: the region's state schools in table `school`, same phase, measure and academic year,
    not suppressed and a cohort of MIN_SCHOOL_COHORT or more; `percent_rank() * 100`. One SQL pass
    per active product release, cached in-process (no migration).
  * Top school (docs/area-card-2026-10/school-spec.md §3): the phase headline at P90+ and the second
    measure at P75+ in the latest London year, and an inspection gate: the standing legacy overall
    grade is Outstanding or Good, or a report card has nothing below Expected and safeguarding Met.
    Missing data is a "Not enough data" chip with the reason, never a guess.
  * TL;DR: whole sentences of 160 characters or fewer, at most three each, picked in order from the
    latest inspection that holds text. Extracts are OGL, dated and linked; no summary is written.
  * Admissions: the last distance offered by every council (owner decision), each with
    the council, its licence and attribution and a link to the council's own table. The publishable
    flag stays in the data and is shown as `reuseConfirmed`.
  * Parent View (migrations 056, 059): Ofsted's school-level percentages (10+ submissions only) from the newest
    survey the school has: the one in use since 10 November 2025, else the earlier survey (surveyEra
    "earlier"); never both. "% happy" is Q1 strongly agree + agree, "% recommend" the recommend question's Yes.
  * Comparisons (compare): each pupil, workforce, finance and admissions figure against London schools in
    table `school` of the same phase and year (10th, 50th and 90th percentile) and its borough's median when
    the borough has 10 or more; finance only within the same accounts (CFR or AAR). Computed in SQL from the
    active release and cached per release; the school's own figure is never estimated.
  * Workforce, finance, destinations (migration 056): the latest school workforce census; one CFR or AAR return
    (the school's own kind, never both); KS4 and 16-18 destination measures for secondaries. Per-pupil money
    is the published total ÷ FTE pupils of the same return.
  * Destination schools (migration 058): for primaries, the GLA London Schools Atlas flows of Year 6 pupils to
    state secondaries, latest census year first (older years as history); percent = pupils ÷ the primary's
    total, to the whole number; flows under 3 are unpublished and shown together, never split or estimated.
  * National rank (migration 055): the school's place among England's state mainstream schools on one
    measure per phase, every year loaded; the headline is the latest year ranked nationally, or a reason.
  * Profile: GIAS gender, trust and capacity (school_profile) and the latest census and absence shares
    from the school's history, each with its year and source release; DfE's pupils per teacher from the
    school workforce census.
  * Inspection counts: from the latest graded inspection, areas graded above / below the expected bar out
    of all graded areas, and the "to improve" points in its report; counted, never scored from the text.
  * Links (migration 099, school_links.py): the school's website and phone from GIAS and the official and guide
    pages built from the URN, each a counted /go click-out; the guides are behind default-off flags.
  * Admissions: every entry year's first-choice applications not offered a place on offer day,
    100 × (1 − first-preference offers ÷ first preferences), with applications and offers by preference.
"""
from __future__ import annotations

import re
import statistics
from typing import Any, Iterable, Mapping

from . import coverage, release_store, school_links, schools
from .personal_places import MIN_SCHOOL_COHORT

LONDON_REGION = coverage.LONDON_REGION


def scope_name(region: str | None) -> str:
    """The pool's name in copy: the region ("London", "North West"); London when unknown."""
    return coverage.region_name(region) or "London"

TOP_HEADLINE_PERCENTILE = 90
TOP_SECOND_PERCENTILE = 75
SIXTH_FORM_PERCENTILE = 75
TREND_POINTS = 5
TREND_DATA_YEARS = 3
TLDR_SENTENCES = 3
TLDR_MAX_CHARS = 160

# phase -> (headline, second measure, short name used in the badge line)
PHASE_RULES = {
    "primary": ("ks2-rwm-expected", "ks2-rwm-higher", "KS2 RWM"),
    "secondary": ("ks4-attainment8", "ks4-em-grade5", "Attainment 8"),
}
SIXTH_FORM_MEASURE = "ks5-alevel-aps"
KPI_MEASURES = {
    "primary": ("ks2-rwm-expected", "ks2-rwm-higher", "ks2-reading-score", "ks2-maths-score"),
    "secondary": ("ks4-attainment8", "ks4-em-grade5", "ks4-ebacc-aps", "ks4-progress8"),
}
KPI_LABELS = {
    "ks2-rwm-expected": "Expected standard, RWM", "ks2-rwm-higher": "Higher standard, RWM",
    "ks2-reading-score": "Reading score", "ks2-maths-score": "Maths score",
    "ks4-attainment8": "Attainment 8", "ks4-em-grade5": "Grade 5+ English and maths",
    "ks4-ebacc-aps": "EBacc point score", "ks4-progress8": "Progress 8",
    "ks5-alevel-aps": "A level points per entry",
}
# Measures with no figure for recent years, by publisher decision: said, never imputed.
UNPUBLISHED = {
    "ks4-progress8": "Not published for 2024/25: Progress 8 returns with 2026/27 results",
    "ks2-reading-progress": "Not published for 2023/24 or 2024/25",
    "ks2-writing-progress": "Not published for 2023/24 or 2024/25",
    "ks2-maths-progress": "Not published for 2023/24 or 2024/25",
}
POOL_MEASURES = tuple(dict.fromkeys(
    [m for rule in PHASE_RULES.values() for m in rule[:2]]
    + [m for measures in KPI_MEASURES.values() for m in measures] + [SIXTH_FORM_MEASURE]))

REPORT_CARD_PASS = {"Exceptional", "Strong standard", "Expected standard"}
REPORT_CARD_GRADES = REPORT_CARD_PASS | {"Needs attention", "Urgent improvement"}
LEGACY_GRADES = {1: "Outstanding", 2: "Good", 3: "Requires improvement", 4: "Inadequate"}
OFSTED_ATTRIBUTION = ("Ofsted inspection report extracts, Crown copyright, "
                      "licensed under the Open Government Licence v3.0.")

IN_ACTIVE_RELEASE_O = """o.source_release_id IN (SELECT member.source_release_id FROM product_release_member member
  WHERE member.release_id = (SELECT release_id FROM active_product_release))"""

POOL_SQL = f"""-- evidence:school-card-pool
SELECT o.urn, s.phase, o.observation_kind, o.academic_year, (o.value->>'value')::float8 AS value,
  percent_rank() OVER (PARTITION BY s.phase, o.observation_kind, o.academic_year
                       ORDER BY (o.value->>'value')::float8) * 100 AS percentile
FROM school_observation o JOIN school s ON s.urn = o.urn
WHERE o.observation_kind = ANY(%s) AND o.cohort_size >= %s
  AND NOT coalesce((o.value->>'suppressed')::boolean, false) AND jsonb_typeof(o.value->'value') = 'number'
  AND s.region_code = %s AND {IN_ACTIVE_RELEASE_O}"""

BADGE_OBSERVATIONS_SQL = f"""-- evidence:school-badge-observations
SELECT o.urn, o.observation_kind, o.academic_year, o.value, o.cohort_size
FROM school_observation o
WHERE o.urn = ANY(%s) AND o.observation_kind = ANY(%s) AND {IN_ACTIVE_RELEASE_O}"""

BADGE_INSPECTIONS_SQL = f"""-- evidence:school-badge-inspections
SELECT o.urn, o.framework, o.overall, o.judgements, o.start_date::text AS start_date
FROM school_inspection o
WHERE o.urn = ANY(%s) AND {IN_ACTIVE_RELEASE_O}
ORDER BY o.urn, o.start_date DESC NULLS LAST, o.inspection_number DESC"""

NATIONAL_RANK_SQL = f"""-- evidence:school-national-rank
WITH latest AS (
  SELECT max(academic_year) AS year FROM school_national_rank WHERE phase = %(phase)s AND {schools.IN_ACTIVE_RELEASE}
)
SELECT latest.year AS latest_year, o.academic_year, o.ranked_urn, o.measure, o.value, o.tiebreak_value, o.rank,
  o.pool_size, o.top_percent, o.source_release_id
FROM latest LEFT JOIN school_national_rank o ON o.urn = %(urn)s AND o.phase = %(phase)s AND {IN_ACTIVE_RELEASE_O}
ORDER BY o.academic_year"""

PROFILE_SQL = f"""-- evidence:school-profile
SELECT o.gender, o.trust_code, o.trust_name, o.capacity, o.pupils, o.census_date::text AS census_date,
  o.website, o.telephone, o.laestab, o.source_release_id
FROM school_profile o WHERE o.urn = %s AND {IN_ACTIVE_RELEASE_O}"""

# /go/school-<target> (school_links.destination): what the destination is rebuilt from.
LINKS_ROW_SQL = f"""-- evidence:school-links
SELECT s.urn, s.name, s.phase, s.attributes->>'localAuthority' AS local_authority, o.website
FROM school s LEFT JOIN school_profile o ON o.urn = s.urn AND {IN_ACTIVE_RELEASE_O}
WHERE s.urn = %s AND {schools.scope()}"""

# Migration 056: one query per row of the card, each read by extra_rows().
EXTRA_SQL = {
    "parentView": f"""-- evidence:school-parent-view
SELECT o.survey, o.period_start::text AS period_start, o.as_at::text AS as_at, o.submissions, o.response_rate,
  o.answers, o.source_release_id
FROM school_parent_view o WHERE o.urn = %s AND {IN_ACTIVE_RELEASE_O}
ORDER BY o.survey = '2025-11' DESC LIMIT 1""",
    "workforce": f"""-- evidence:school-workforce
SELECT o.* FROM school_workforce o WHERE o.urn = %s AND {IN_ACTIVE_RELEASE_O}
ORDER BY o.academic_year DESC LIMIT 1""",
    "finance": f"""-- evidence:school-finance
SELECT o.* FROM school_finance o WHERE o.urn = %s AND {IN_ACTIVE_RELEASE_O} ORDER BY o.accounts""",
    "destinations": f"""-- evidence:school-destinations
SELECT DISTINCT ON (o.stage) o.* FROM school_destination o WHERE o.urn = %s AND {IN_ACTIVE_RELEASE_O}
ORDER BY o.stage, o.cohort_year DESC""",
}

# Which migration-056 sources the active release holds, so an empty row says "not loaded" rather than
# claiming the publisher left the school out.
EXTRA_LOADED_SQL = f"""-- evidence:school-extra-loaded
SELECT EXISTS (SELECT 1 FROM school_parent_view o WHERE {IN_ACTIVE_RELEASE_O}) AS parent_view,
  EXISTS (SELECT 1 FROM school_workforce o WHERE {IN_ACTIVE_RELEASE_O}) AS workforce,
  EXISTS (SELECT 1 FROM school_finance o WHERE o.accounts = 'CFR' AND {IN_ACTIVE_RELEASE_O}) AS finance_cfr,
  EXISTS (SELECT 1 FROM school_finance o WHERE o.accounts = 'AAR' AND {IN_ACTIVE_RELEASE_O}) AS finance_aar,
  EXISTS (SELECT 1 FROM school_destination o WHERE {IN_ACTIVE_RELEASE_O}) AS destinations"""

CARD_SCHOOL_SQL = f"""-- evidence:school-card
SELECT {schools.SCHOOL_COLUMNS}, NULL::integer AS distance_metres, s.predecessor_urn, s.successor_urn,
  (SELECT g.id FROM area_geography g WHERE g.id LIKE 'uk:lsoa:%%' AND ST_Contains(g.geometry, s.location)
   LIMIT 1) AS area_id
FROM school s WHERE s.urn = %s AND {schools.scope()}"""


# Every school with its phase, borough and whether any result or inspection is in the active release: the
# sitemap lists /school/{urn} only for those with evidence (a page without any is noindex); /schools lists a
# borough's schools by the borough.
SCHOOL_INDEX_SQL = f"""-- evidence:school-index
SELECT s.urn, s.name, s.phase, s.successor_urn, s.attributes ->> 'localAuthority' AS borough,
  (EXISTS (SELECT 1 FROM school_observation o WHERE o.urn = s.urn AND {IN_ACTIVE_RELEASE_O})
   OR EXISTS (SELECT 1 FROM school_inspection o WHERE o.urn = s.urn AND {IN_ACTIVE_RELEASE_O})) AS has_evidence
FROM school s WHERE {schools.scope()} ORDER BY s.urn"""


def school_index(rows: Iterable[Mapping[str, Any]], release_id: str) -> dict:
    return {"schemaVersion": "school-index.v1", "productReleaseId": release_id,
            "schools": [{"urn": row["urn"], "name": row["name"], "phase": row["phase"],
                         "borough": row.get("borough"), "successorUrn": row["successor_urn"],
                         "hasEvidence": bool(row["has_evidence"])}
                        for row in rows]}

# --- Region pool (London's for London's schools): percentiles and medians per (phase, measure, year), cached per
# release and region. ---

class Pool:
    def __init__(self, rows: Iterable[Mapping[str, Any]], region: str = LONDON_REGION):
        self.region = region
        self.scope = scope_name(region)
        self.percentiles: dict[tuple[str, str, str], dict[str, float]] = {}
        self.values: dict[tuple[str, str, str], dict[str, float]] = {}
        values: dict[tuple[str, str, str], list[float]] = {}
        for row in rows:
            key = (row["phase"], row["observation_kind"], row["academic_year"])
            self.percentiles.setdefault(key, {})[row["urn"]] = round(float(row["percentile"]), 1)
            self.values.setdefault(key, {})[row["urn"]] = float(row["value"])
            values.setdefault(key, []).append(float(row["value"]))
        self.medians = {key: round(statistics.median(v), 2) for key, v in values.items()}
        self.sizes = {key: len(v) for key, v in values.items()}
        self.years: dict[tuple[str, str], list[str]] = {}
        for phase, kind, year in sorted(self.percentiles):
            self.years.setdefault((phase, kind), []).append(year)

    def latest_year(self, phase: str, kind: str) -> str | None:
        years = self.years.get((phase, kind))
        return years[-1] if years else None

    def percentile(self, phase: str, kind: str, year: str | None, urn: str) -> float | None:
        return self.percentiles.get((phase, kind, year), {}).get(urn) if year else None

    def value(self, phase: str, kind: str, year: str | None, urn: str) -> float | None:
        return self.values.get((phase, kind, year), {}).get(urn) if year else None

    def earlier_year(self, phase: str, kind: str, year: str) -> str | None:
        """The year TREND_DATA_YEARS data-years before `year` (exam-free years are not data-years)."""
        years = self.years.get((phase, kind), [])
        if year not in years:
            return None
        index = years.index(year) - TREND_DATA_YEARS
        return years[index] if index >= 0 else None


def london_pool(connection: Any, release_id: str, region: str | None = LONDON_REGION) -> Pool:
    """The pool of the region's schools (the name stays: London's is the default)."""
    region = region or LONDON_REGION
    # Built at release activation (release_build) into release_artifact: ~2 s a region cold, a card waited ~10 s.
    return release_store.cached(connection, release_id, ("school-pool", region), lambda: Pool(
        connection.execute(POOL_SQL, (list(POOL_MEASURES), MIN_SCHOOL_COHORT, region)), region))


# --- Comparisons: London (p10, median, p90) and borough median per phase, measure, year and accounts ---

MIN_BOROUGH_SCHOOLS = 10
# key -> (what it is, unit, better when, decimals shown)
COMPARE_MEASURES = {
    "pupils": ("Pupils on roll (GIAS, January census)", "count", None, 0),
    "fsm6Percent": ("Pupils eligible for free school meals in the last 6 years", "percent", None, 1),
    "ealPercent": ("Pupils with English as an additional language", "percent", None, 1),
    "senSupportPercent": ("Pupils with SEN support", "percent", None, 1),
    "ehcpPercent": ("Pupils with an EHC plan", "percent", None, 1),
    "overallAbsencePercent": ("Overall absence", "percent", "lower", 1),
    "persistentAbsencePercent": ("Persistent absence", "percent", "lower", 1),
    "pupilsPerTeacher": ("Pupils per teacher (FTE)", "ratio", None, 1),
    "pupilsPerAdult": ("Pupils per adult (FTE)", "ratio", None, 1),
    "incomePerPupil": ("Total income per pupil", "pounds", None, 0),
    "spendPerPupil": ("Total spend per pupil", "pounds", None, 0),
    "staffSpendPerPupil": ("Staff spend per pupil", "pounds", None, 0),
    "reservePerPupil": ("Revenue reserve per pupil", "pounds", None, 0),
    "firstChoiceOfferedPercent": ("First-choice applications offered a place on national offer day", "percent",
                                  None, 1),
}
COMPARE_OBSERVATIONS = {"census-fsm6-percent": "fsm6Percent", "census-eal-percent": "ealPercent",
                        "census-sen-support-percent": "senSupportPercent", "census-ehcp-percent": "ehcpPercent",
                        "absence-overall-percent": "overallAbsencePercent",
                        "absence-persistent-percent": "persistentAbsencePercent"}
COMPARE_POOL = ("{scope} state schools in Close Knit with a published figure, same phase (primary or secondary) "
                "and year; the borough median only when 10 or more of its schools have one")
COMPARE_METHOD = "10th, 50th and 90th percentiles with linear interpolation (PostgreSQL percentile_cont)"
COMPARE_ACCOUNTS = {"CFR": "Compared only with maintained schools' accounts (CFR), same financial year",
                    "AAR": "Compared only with academies' accounts (AAR), same academic year"}

# Every school's figures as the card shows them (one row per school, measure, year and accounts). Income and
# spend per pupil leave out part-year returns, as finance() does; the first-choice share is the phase's entry
# point (reception or year 7), as admissions() computes it.
_COMPARE_VALUES = f"""
SELECT s.urn, s.phase, s.region_code, s.attributes->>'localAuthority' AS borough, v.measure, v.year, v.accounts,
  v.value, v.source_release_id
FROM school s JOIN (
  SELECT o.urn, CASE o.observation_kind {" ".join(f"WHEN '{kind}' THEN '{key}'" for kind, key in COMPARE_OBSERVATIONS.items())}
    END AS measure, o.academic_year AS year, NULL::text AS accounts, (o.value->>'value')::float8 AS value,
    NULL::text AS entry_point, o.source_release_id
  FROM school_observation o
  WHERE o.observation_kind IN ({", ".join(f"'{kind}'" for kind in COMPARE_OBSERVATIONS)})
    AND NOT coalesce((o.value->>'suppressed')::boolean, false) AND jsonb_typeof(o.value->'value') = 'number'
    AND {{active}}
  UNION ALL
  SELECT o.urn, 'pupils', o.census_date::text, NULL, o.pupils::float8, NULL, o.source_release_id
  FROM school_profile o WHERE o.pupils IS NOT NULL AND o.census_date IS NOT NULL AND {{active}}
  UNION ALL
  SELECT o.urn, m.measure, o.academic_year, NULL, m.value, NULL, o.source_release_id
  FROM school_workforce o CROSS JOIN LATERAL (VALUES ('pupilsPerTeacher', o.pupils_per_teacher::float8),
    ('pupilsPerAdult', o.pupils_per_adult::float8)) m(measure, value)
  WHERE m.value IS NOT NULL AND {{active}}
  UNION ALL
  SELECT o.urn, m.measure, o.period, o.accounts, m.value / o.pupils_fte::float8, NULL, o.source_release_id
  FROM school_finance o CROSS JOIN LATERAL (VALUES
    ('incomePerPupil', CASE WHEN coalesce(o.period_months, 12) = 12 THEN o.total_income::float8 END),
    ('spendPerPupil', CASE WHEN coalesce(o.period_months, 12) = 12 THEN o.total_expenditure::float8 END),
    ('staffSpendPerPupil', CASE WHEN coalesce(o.period_months, 12) = 12 THEN o.staff_costs::float8 END),
    ('reservePerPupil', o.revenue_reserve::float8)) m(measure, value)
  WHERE m.value IS NOT NULL AND o.pupils_fte > 0 AND {{active}}
  UNION ALL
  SELECT o.urn, 'firstChoiceOfferedPercent', o.entry_year::text, NULL,
    100.0 * o.first_preference_offers / o.first_preferences, o.entry_point, o.source_release_id
  FROM school_admission_demand o
  WHERE o.first_preferences > 0 AND o.first_preference_offers <= o.first_preferences AND {{active}}
) v ON v.urn = s.urn
WHERE v.entry_point IS NULL OR v.entry_point = CASE s.phase WHEN 'primary' THEN 'reception' ELSE 'year7' END"""
# The pool reads one region's schools (the card compares a school with its own region only): each source
# table is cut to the region's URNs before the join, ~1-2 s a region instead of ~9 s for England in one pass.
_REGION_URNS = " AND o.urn IN (SELECT r.urn FROM school r WHERE r.region_code = %(region)s)"
_COMPARE_REGION_VALUES = _COMPARE_VALUES.replace("{active}", IN_ACTIVE_RELEASE_O + _REGION_URNS)
_COMPARE_VALUES = _COMPARE_VALUES.replace("{active}", IN_ACTIVE_RELEASE_O)

COMPARE_POOL_SQL = f"""-- evidence:school-compare-pool
WITH v AS ({_COMPARE_REGION_VALUES})
SELECT region_code, phase, measure, year, accounts, CASE WHEN grouping(borough) = 0 THEN borough END AS borough,
  grouping(borough) = 1 AS london,
  percentile_cont(ARRAY[0.1, 0.5, 0.9]) WITHIN GROUP (ORDER BY value) AS quantiles, count(*) AS n
FROM v WHERE region_code = %(region)s GROUP BY GROUPING SETS ((region_code, phase, measure, year, accounts),
                               (region_code, phase, measure, year, accounts, borough))"""

COMPARE_SCHOOL_SQL = f"""-- evidence:school-compare-values
WITH v AS ({_COMPARE_VALUES})
SELECT measure, year, accounts, value, source_release_id FROM v WHERE urn = %s ORDER BY measure, accounts, year"""


class ComparePool:
    """{(region, phase, measure, year, accounts, borough | None): (p10, median, p90, n)}; borough None = the
    whole region (London for London's schools)."""

    def __init__(self, rows: Iterable[Mapping[str, Any]]):
        self.groups: dict[tuple, tuple[float, float, float, int]] = {}
        for row in rows:
            borough = None if row["london"] else row["borough"]
            p10, median, p90 = (float(q) for q in row["quantiles"])
            region = row.get("region_code") or LONDON_REGION
            self.groups[(region, row["phase"], row["measure"], row["year"], row["accounts"], borough)] = (
                p10, median, p90, int(row["n"]))

    def get(self, phase: str, measure: str, year: str, accounts: str | None, borough: str | None = None,
            region: str | None = LONDON_REGION):
        return self.groups.get((region or LONDON_REGION, phase, measure, year, accounts, borough))


def compare_pool(connection: Any, release_id: str, region: str | None = LONDON_REGION) -> ComparePool:
    """One region's comparison groups (the region's whole and each borough's), kept per release and region."""
    region = region or LONDON_REGION
    return release_store.cached(connection, release_id, ("school-compare-pool", region),
                                lambda: ComparePool(connection.execute(COMPARE_POOL_SQL, {"region": region})))


POOL_REGIONS_SQL = f"""-- evidence:school-pool-regions
SELECT DISTINCT s.region_code FROM school s WHERE s.region_code IS NOT NULL AND {schools.scope()}
ORDER BY s.region_code"""


def build_pools(connection: Any, release_id: str) -> list[str]:
    """Every region's pools for the release (release_build), so no visitor waits for them (~2 s a region cold)."""
    regions = [row["region_code"] for row in connection.execute(schools.scoped(POOL_REGIONS_SQL))]
    for region in regions:
        london_pool(connection, release_id, region)
        compare_pool(connection, release_id, region)
    return regions


def _rounded(value: float, decimals: int) -> float | int:
    return round(value) if decimals == 0 else round(value, decimals)


def compare(phase: str, borough: str | None, rows: list[Mapping[str, Any]], pool: ComparePool,
            accounts: str | None, region: str | None = LONDON_REGION) -> dict:
    """Each COMPARE_MEASURES figure of the school (its latest year; finance from the accounts the card shows)
    against London and its borough, same phase and year (and accounts); None for a measure the school has
    no figure for."""
    latest: dict[str, Mapping[str, Any]] = {}
    for row in rows:  # oldest first: the last row per measure is the latest year
        if row["accounts"] is None or row["accounts"] == accounts:
            latest[row["measure"]] = row
    measures: dict[str, dict | None] = {}
    for key, (label, unit, better, decimals) in COMPARE_MEASURES.items():
        row = latest.get(key)
        london = row and pool.get(phase, key, row["year"], row["accounts"], region=region)
        if not row or not london:
            measures[key] = None
            continue
        local = pool.get(phase, key, row["year"], row["accounts"], borough, region) if borough else None
        measures[key] = {
            # the school's own figure as the card shows it: stored to 2 decimals, money and counts whole
            "label": label, "unit": unit, "value": _rounded(row["value"], decimals and 2), "year": row["year"],
            "london": {"p10": _rounded(london[0], decimals), "median": _rounded(london[1], decimals),
                       "p90": _rounded(london[2], decimals), "n": london[3]},
            "borough": ({"name": borough, "median": _rounded(local[1], decimals), "n": local[3]}
                        if local and local[3] >= MIN_BOROUGH_SCHOOLS else None),
            "betterWhen": better, "sourceRelease": row["source_release_id"], "scope": scope_name(region),
            **({"accounts": row["accounts"], "accountsNote": COMPARE_ACCOUNTS[row["accounts"]]}
               if row["accounts"] else {}),
        }
    return {"phase": phase, "pool": COMPARE_POOL.format(scope=scope_name(region)), "method": COMPARE_METHOD,
            "minBoroughSchools": MIN_BOROUGH_SCHOOLS, "measures": measures}


# --- Inspection gate ---

def _safeguarding(judgements: Mapping[str, Any]) -> Any:
    return next((v for k, v in judgements.items() if k.lower().startswith("safeguarding")), None)


def inspection_gate(inspections: list[Mapping[str, Any]]) -> dict:
    """{passed: bool | None, label, short}; inspections newest first. Ungraded (section 8 and monitoring)
    visits, legacy or since September 2024, leave the standing grade in place unless they found
    safeguarding not effective; legacy and report-card grades are never combined."""
    for inspection in inspections:
        framework = inspection.get("framework") or ""
        judgements = inspection.get("judgements") or {}
        year = (inspection.get("startDate") or "")[:4]
        if framework.startswith("report-card"):
            grades = [v for v in judgements.values() if v in REPORT_CARD_GRADES]
            passed = (bool(grades) and all(g in REPORT_CARD_PASS for g in grades)
                      and _safeguarding(judgements) == "Met")
            label = (f"Ofsted report card {year}: nothing below Expected, safeguarding met" if passed
                     else f"Ofsted report card {year}: an area below Expected or safeguarding not met")
            return {"passed": passed, "label": label, "short": "Ofsted report card", "framework": "report-card"}
        if inspection.get("overall") in LEGACY_GRADES:
            grade = LEGACY_GRADES[inspection["overall"]]
            return {"passed": inspection["overall"] <= 2, "label": f"Ofsted {grade} ({year})",
                    "short": f"Ofsted {grade}", "framework": "legacy-overall"}
        # No overall grade since September 2024: a graded inspection still grades each area 1-4.
        grades = [v for v in judgements.values() if isinstance(v, int) and not isinstance(v, bool)]
        if framework == "eif-2024-no-overall" and grades:
            passed = all(g <= 2 for g in grades) and _safeguarding(judgements) == "Yes"
            label = (f"Ofsted {year}: every area Good or better" if passed
                     else f"Ofsted {year}: an area below Good")
            return {"passed": passed, "label": label, "short": f"Ofsted: all Good+ {year}",
                    "framework": "legacy-areas"}
        if _safeguarding(judgements) == "No":
            return {"passed": False, "label": f"Ofsted {year}: safeguarding not effective",
                    "short": "Ofsted: safeguarding not effective", "framework": "ungraded"}
        # Ungraded visit (e.g. "Standards maintained"): the previous graded inspection stands.
    return {"passed": None, "label": "Not inspected", "short": "Not inspected", "framework": None}


# --- Badge ---

def _point(series: list[Mapping[str, Any]], year: str | None) -> Mapping[str, Any] | None:
    return next((p for p in series if p.get("academicYear") == year), None) if year else None


def _missing_reason(point: Mapping[str, Any] | None, year: str | None, scope: str = "London") -> str:
    if point is None:
        return f"No results published for {year}" if year else "No results published"
    if point.get("suppressed") or point.get("value") is None:
        return f"Suppressed in {year} (too few pupils to publish)"
    if (point.get("cohortSize") or 0) < MIN_SCHOOL_COHORT:
        return f"Small cohort: {point.get('cohortSize') or 0} pupils in {year} (under {MIN_SCHOOL_COHORT})"
    return f"Not in the {scope} pool for {year}"


def _phase_noun(phase: str) -> str:
    return "primaries" if phase == "primary" else "secondaries"


def top_badge(urn: str, phase: str, series: Mapping[str, list[Mapping[str, Any]]],
              inspections: list[Mapping[str, Any]], pool: Pool) -> dict:
    """series: measure id -> points (academicYear, value, suppressed, cohortSize)."""
    headline, second, short = PHASE_RULES[phase]
    year = pool.latest_year(phase, headline)
    gate = inspection_gate(inspections)
    chips: list[dict] = []
    reasons: list[str] = []

    head_pct = pool.percentile(phase, headline, year, urn)
    second_pct = pool.percentile(phase, second, year, urn)
    missing = None
    if head_pct is None:
        missing = _missing_reason(_point(series.get(headline, []), year), year, pool.scope)
    elif second_pct is None:
        missing = _missing_reason(_point(series.get(second, []), year), year, pool.scope)
    else:
        reasons.append(f"{KPI_LABELS[headline]}: P{head_pct:g} of {pool.scope} {_phase_noun(phase)} ({year})")
        reasons.append(f"{KPI_LABELS[second]}: P{second_pct:g} ({year})")
    if gate["passed"] is None:
        missing = missing or "Not inspected"
    reasons.append(gate["label"])

    if head_pct is not None and head_pct >= TOP_HEADLINE_PERCENTILE:
        chips.append({"id": "top-results", "label": "Top 10% results"})
    for inspection in inspections[:1]:
        if (inspection.get("framework") or "").startswith("report-card"):
            for area, grade in (inspection.get("judgements") or {}).items():
                if grade == "Exceptional":
                    chips.append({"id": "exceptional", "label": f"Exceptional in {area.split(' (')[0]}"})
    sixth_year = pool.latest_year(phase, SIXTH_FORM_MEASURE)
    sixth = pool.percentile(phase, SIXTH_FORM_MEASURE, sixth_year, urn)
    if sixth is not None and sixth >= SIXTH_FORM_PERCENTILE:
        chips.append({"id": "strong-sixth-form", "label": "Strong sixth form"})
    trend = percentile_trend(pool, phase, headline, year, urn)
    if trend and trend["direction"] != "flat":
        chips.append({"id": "rising" if trend["direction"] == "up" else "falling",
                      "label": f"{'Rising' if trend['direction'] == 'up' else 'Falling'} "
                               f"({trend['deltaPoints']:+g} pts since {trend['fromYear']})"})

    is_top = (missing is None and gate["passed"] is True and head_pct >= TOP_HEADLINE_PERCENTILE
              and second_pct >= TOP_SECOND_PERCENTILE)
    if missing:
        chips.append({"id": "not-enough-data", "label": "Not enough data", "reason": missing})
    line = f"Top school: top 10% {pool.scope} {short} {year} · {gate['short']}" if is_top else None
    return {"isTop": is_top, "chips": chips, "line": line, "year": year, "reasons": reasons,
            "missingReason": missing,
            "criteria": (f"Top 10% of {pool.scope} {_phase_noun(phase)} on {KPI_LABELS[headline]} and top 25% on "
                         f"{KPI_LABELS[second]} ({year}, cohort {MIN_SCHOOL_COHORT}+), and Ofsted Good or "
                         "better or a report card with nothing below Expected. Separate from the map "
                         f"plaque, which only tiers the school's {pool.scope} rank by England results "
                         "(Top 1/3/5/10/25%).")}


def percentile_trend(pool: Pool, phase: str, kind: str, year: str | None, urn: str) -> dict | None:
    now = pool.percentile(phase, kind, year, urn)
    earlier_year = pool.earlier_year(phase, kind, year) if year else None
    before = pool.percentile(phase, kind, earlier_year, urn)
    if now is None or before is None:
        return None
    delta = round(now - before, 1)
    direction = "flat" if abs(delta) < TREND_POINTS else ("up" if delta > 0 else "down")
    return {"direction": direction, "deltaPoints": delta, "fromYear": earlier_year}


def top_badges(connection: Any, release_id: str, rows: list[Mapping[str, Any]]) -> dict[str, dict]:
    """urn -> topBadge for school rows (urn, phase), in two queries; for school lists."""
    urns = [row["urn"] for row in rows]
    if not urns:
        return {}
    pools = {region: london_pool(connection, release_id, region)
             for region in {row.get("region_code") or LONDON_REGION for row in rows}}
    measures = list(dict.fromkeys(m for rule in PHASE_RULES.values() for m in rule[:2]))
    series: dict[str, dict[str, list[dict]]] = {}
    for row in connection.execute(BADGE_OBSERVATIONS_SQL, (urns, measures)):
        value = row["value"] or {}
        series.setdefault(row["urn"], {}).setdefault(row["observation_kind"], []).append(
            {"academicYear": row["academic_year"], "value": value.get("value"),
             "suppressed": bool(value.get("suppressed")), "cohortSize": row["cohort_size"]})
    inspections: dict[str, list[dict]] = {}
    for row in connection.execute(BADGE_INSPECTIONS_SQL, (urns,)):
        inspections.setdefault(row["urn"], []).append(
            {"framework": row["framework"], "overall": row["overall"], "judgements": row["judgements"] or {},
             "startDate": row["start_date"]})
    return {row["urn"]: top_badge(row["urn"], row["phase"], series.get(row["urn"], {}),
                                  inspections.get(row["urn"], []), pools[row.get("region_code") or LONDON_REGION])
            for row in rows if row["phase"] in PHASE_RULES}


# --- TL;DR: extractive, deterministic ---

_SENTENCE_END = re.compile(r"(?<=[.!?])[\"'’”)]?\s+(?=[\"'‘“(]?[A-Z0-9])")


def pick_sentences(text: str | None, limit: int = TLDR_SENTENCES, max_chars: int = TLDR_MAX_CHARS) -> list[str]:
    """The first `limit` whole sentences of `max_chars` or fewer, in report order. A fragment (a heading,
    or text cut off mid-sentence) is never a sentence."""
    out: list[str] = []
    for block in re.split(r"[\n•]+", text or ""):
        block = " ".join(block.split())
        for sentence in _SENTENCE_END.split(block):
            sentence = sentence.strip(" -–")
            if (not sentence or len(sentence) > max_chars or not re.search(r"[.!?][\"'’”)]?$", sentence)
                    or not re.match(r"[\"'‘“(]?[A-Z0-9]", sentence) or sentence in out):
                continue
            out.append(sentence)
            if len(out) == limit:
                return out
    return out


def tldr(urn: str, inspections: list[Mapping[str, Any]]) -> dict | None:
    """Strengths and To improve from the latest inspection that holds text; None when none does."""
    for inspection in inspections:
        if not (inspection.get("keyFindings") or inspection.get("improveText")):
            continue
        strengths = pick_sentences(inspection.get("keyFindings"))
        improve = pick_sentences(inspection.get("improveText"))
        if not strengths and not improve:
            continue
        date = inspection.get("publicationDate") or inspection.get("startDate")
        predecessor = inspection.get("inspectedUrn") not in (None, urn)
        return {"strengths": strengths, "improve": improve, "inspectionDate": inspection.get("startDate"),
                "publicationDate": inspection.get("publicationDate"), "reportUrl": inspection.get("reportUrl"),
                "label": f"From Ofsted report, {date}" + (" (inspected as predecessor)" if predecessor else ""),
                "inspectedAsPredecessor": predecessor, "inspectedUrn": inspection.get("inspectedUrn"),
                "attribution": OFSTED_ATTRIBUTION}
    return None


# --- Admissions ---

# Older council releases still carry the review-time caveat (re-caveated on staging,
# deploy/tools/school_history_common.py); the card shows the current wording either way.
_REUSE_CAVEATS = {
    "The council's terms do not confirm re-use: loaded for review, publishable = false.":
        "The council's terms do not confirm re-use: shown credited, with a link to the council's table.",
}


OVERSUBSCRIPTION = ("First-choice applications not offered a place on national offer day: 100 × (1 − first-preference "
                    "offers ÷ first preferences). Applications count preferences, not children; places can still "
                    "be offered from waiting lists after offer day.")

OGL_STATEMENT = ". Contains public sector information licensed under the Open Government Licence v3.0."


def card_sources(sources: list[Mapping[str, Any]]) -> list[dict]:
    return [{**source, "caveats": [_REUSE_CAVEATS.get(c, c) for c in source.get("caveats") or []]}
            for source in sources]


def _council(source: Mapping[str, Any] | None) -> str | None:
    attribution = (source or {}).get("attribution") or ""
    return attribution.split(",")[0].strip() or None


def admissions(history: Mapping[str, Any]) -> dict:
    """Latest applications per place by entry point, and the last distance offered per year from every
    council's table, each with the council, its licence and a link to the council's source."""
    sources = {source["id"]: source for source in history.get("sources", [])}
    latest: dict[str, dict] = {}
    for row in history.get("demand", []):
        if row["entryPoint"] not in latest or row["entryYear"] > latest[row["entryPoint"]]["entryYear"]:
            latest[row["entryPoint"]] = row

    def per_place(count, pan):
        return round(count / pan, 2) if count is not None and pan else None

    def not_offered(row):
        first, offered = row["firstPreferences"], row["firstPreferenceOffers"]
        if not first or offered is None or offered > first:
            return None
        return round(100 * (1 - offered / first), 1)

    demand = [{**row, "applicationsPerPlace": per_place(row["anyPreferences"], row["pan"]),
               "firstPreferencesPerPlace": per_place(row["firstPreferences"], row["pan"]),
               "applicationsPerOffer": per_place(row["anyPreferences"], row["offers"]),
               "firstChoiceNotOfferedPercent": not_offered(row),
               "missingReason": None if row["pan"] else "No published admission number"}
              for _, row in sorted(latest.items())]
    by_year = [{**row, "firstChoiceNotOfferedPercent": not_offered(row)}
               for row in sorted(history.get("demand", []), key=lambda r: (r["entryPoint"], -r["entryYear"]))]

    groups: dict[tuple, dict] = {}
    for row in history.get("distances", []):
        key = (row["academicYear"], row["entryPoint"], row["site"], row["sourceRelease"])
        source = sources.get(row["sourceRelease"]) or {}
        council, licence = _council(source) or "The council", source.get("licence")
        group = groups.setdefault(key, {
            "academicYear": row["academicYear"], "entryPoint": row["entryPoint"], "site": row["site"],
            "council": council, "licence": licence if licence == "OGL-3.0" else f"{council} copyright",
            "attribution": f"Source: {council}, {row['academicYear']}" + (OGL_STATEMENT if licence == "OGL-3.0" else ""),
            "sourceUrl": row["sourceUrl"],
            "reuseConfirmed": bool(row.get("publishable")), "measurementMethod": row["measurementMethod"],
            "distanceMetres": None, "allOffered": None, "rules": []})
        group["rules"].append({"rule": row["rule"], "criterion": row["criterion"],
                               "distanceMetres": row["distanceMetres"], "rawValue": row["rawValue"],
                               "allOffered": row["allOffered"]})
    for group in groups.values():
        # One headline only when the table gives one: the whole-school rule, or a single figure.
        whole = [r for r in group["rules"] if r["rule"] == group["entryPoint"]
                 and (r["distanceMetres"] is not None or r["allOffered"])]
        figures = [r for r in group["rules"] if r["distanceMetres"] is not None or r["allOffered"]]
        pick = whole[0] if whole else (figures[0] if len(figures) == 1 else None)
        if pick:
            group["distanceMetres"], group["allOffered"] = pick["distanceMetres"], pick["allOffered"]
        group["rules"] = [r for r in group["rules"] if r["distanceMetres"] is not None or r["allOffered"]]
    last_offered = sorted(groups.values(), key=lambda g: (g["academicYear"], g["entryPoint"] or "", g["site"]),
                          reverse=True)
    return {"demand": demand, "byYear": by_year, "oversubscriptionDefinition": OVERSUBSCRIPTION,
            "lastOffered": [g for g in last_offered if g["rules"]]}


# --- National rank ---

# phase -> (measure id, what is ranked)
RANK_MEASURES = {
    "primary": ("ks2-rwm-expected", "Key stage 2: % of pupils meeting the expected standard in reading, writing "
                                    "and maths; ties broken by % at the higher standard"),
    "secondary": ("ks4-attainment8", "Key stage 4: Attainment 8 average score"),
}
RANK_POOL = ("England's state-funded mainstream schools with a published figure that year (suppressed or missing "
             "figures are left out); equal figures share a rank; top % = rank ÷ schools × 100, rounded up")


def national_rank(phase: str, rows: list[Mapping[str, Any]]) -> dict | None:
    """rows: NATIONAL_RANK_SQL, oldest first. None when no England rank is loaded for the phase."""
    if phase not in RANK_MEASURES or not rows or rows[0]["latest_year"] is None:
        return None
    measure_id, measure = RANK_MEASURES[phase]
    latest = rows[0]["latest_year"]
    history = [{"academicYear": row["academic_year"], "rank": row["rank"], "total": row["pool_size"],
                "topPercent": row["top_percent"], "value": row["value"], "tiebreakValue": row["tiebreak_value"],
                "rankedUrn": row["ranked_urn"], "sourceRelease": row["source_release_id"]}
               for row in rows if row["rank"] is not None]
    now = next((point for point in history if point["academicYear"] == latest), None)
    return {
        "rank": now["rank"] if now else None, "total": now["total"] if now else None,
        "topPercent": now["topPercent"] if now else None, "year": latest, "measure": measure,
        "measureId": measure_id, "value": now["value"] if now else None,
        "tiebreakValue": now["tiebreakValue"] if now else None, "rankedUrn": now["rankedUrn"] if now else None,
        "sourceRelease": now["sourceRelease"] if now else None,
        "line": (f"Ranked {now['rank']:,} of {now['total']:,} {_phase_noun(phase)} in England, {latest} "
                 f"(top {now['topPercent']}%)") if now else None,
        "missingReason": None if now else f"Not ranked for {latest}: no published figure for this school",
        "pool": RANK_POOL, "history": history,
    }


# --- Combined A-level rank (migration 094, issue #201): one scale for state and independent ----

SIXTH_FORM_RANK_SQL = f"""-- evidence:school-sixth-form-rank
WITH latest AS (
  SELECT max(academic_year) AS year FROM school_sixth_form_rank WHERE {schools.IN_ACTIVE_RELEASE}
)
SELECT o.rank AS england_rank, o.pool_size AS england_pool, o.academic_year, o.value,
  o.tiebreak_value, o.cohort_size,
  (SELECT count(*) FROM school_sixth_form_rank x
   WHERE x.academic_year = o.academic_year AND x.source_release_id IN (
     SELECT member.source_release_id FROM product_release_member member
     WHERE member.release_id = (SELECT release_id FROM active_product_release))
     AND x.rank <= o.rank AND {schools.SIXTH_FORM_REGION_SQL} = %(region)s) AS london_rank,
  (SELECT count(*) FROM school_sixth_form_rank x
   WHERE x.academic_year = o.academic_year AND x.source_release_id IN (
     SELECT member.source_release_id FROM product_release_member member
     WHERE member.release_id = (SELECT release_id FROM active_product_release))
     AND {schools.SIXTH_FORM_REGION_SQL} = %(region)s) AS london_pool,
  o.source_release_id
FROM latest JOIN school_sixth_form_rank o
  ON o.urn = %(urn)s AND o.academic_year = latest.year AND {IN_ACTIVE_RELEASE_O}"""


def sixth_form_rank(rows: list[Mapping[str, Any]], scope: str = "London") -> dict | None:
    """The combined A-level rank: the school's place among its region's (`scope`) sixth forms, state and
    independent, on A level average points per entry (migration 094). None when the school has
    no ranked sixth form that year (under 20 A-level students, or no published figure)."""
    rows = [row for row in rows if row.get("london_rank") is not None]
    if not rows:
        return None
    row = rows[0]
    rank, pool, year = int(row["london_rank"]), int(row["london_pool"]), row["academic_year"]
    return {
        "measure": "A level average point score per entry", "measureId": "ks5-alevel-aps",
        "year": year, "value": row["value"], "cohortSize": row.get("cohort_size"),
        "regionRank": rank, "regionPool": pool, "scope": scope,
        "englandRank": int(row["england_rank"]), "englandPool": int(row["england_pool"]),
        "selectionNote": schools.SIXTH_FORM_SELECTION_NOTE,
        "line": f"#{rank:,} of {pool:,} {scope} sixth forms, state and independent, {year}",
        "sourceRelease": row["source_release_id"],
    }


# --- Profile: gender, trust, capacity and the census and absence shares ---

PROFILE_FIGURES = {
    "girlsPercent": "census-girls-percent", "boysPercent": "census-boys-percent",
    "fsm6Percent": "census-fsm6-percent", "ealPercent": "census-eal-percent",
    "senSupportPercent": "census-sen-support-percent", "ehcpPercent": "census-ehcp-percent",
    "overallAbsencePercent": "absence-overall-percent", "persistentAbsencePercent": "absence-persistent-percent",
}


def latest_figure(series: Mapping[str, list[Mapping[str, Any]]], kind: str) -> dict | None:
    """The latest published year of a measure as stored; a suppressed figure stays value null."""
    points = series.get(kind) or []
    if not points:
        return None
    point = points[-1]
    return {"measure": kind, "label": schools.SCHOOL_MEASURE_LABELS[kind][0],
            "value": None if point.get("suppressed") else point.get("value"),
            "suppressed": bool(point.get("suppressed")), "academicYear": point["academicYear"],
            "sourceRelease": point.get("sourceRelease")}


def profile(row: Mapping[str, Any] | None, series: Mapping[str, list[Mapping[str, Any]]],
            workforce_row: Mapping[str, Any] | None = None, sixth_form: str | None = None) -> dict:
    capacity = pupils = None
    if row is not None:
        capacity, pupils = row["capacity"], row["pupils"]
    gias = None if row is None else {
        "gender": row["gender"],
        "trust": {"name": row["trust_name"], "code": row["trust_code"]} if row["trust_name"] else None,
        "capacity": capacity, "pupils": pupils, "censusDate": row["census_date"],
        # Both counts from the same GIAS row; nothing when either is not published.
        "percentFull": round(100 * pupils / capacity, 1) if capacity and pupils is not None else None,
        "laestab": row.get("laestab"),  # migration 099: LA code + establishment number, "201/3614"
        "sourceRelease": row["source_release_id"],
    }
    ratio = None if workforce_row is None or workforce_row["pupils_per_teacher"] is None else {
        "value": workforce_row["pupils_per_teacher"], "academicYear": workforce_row["academic_year"],
        "sourceRelease": workforce_row["source_release_id"]}
    figures = {key: latest_figure(series, kind) for key, kind in PROFILE_FIGURES.items()}
    gender = gias["gender"] if gias else None
    other = figures["boysPercent" if gender == "Girls" else "girlsPercent"] if gender in ("Girls", "Boys") else None
    return {"gias": gias, **figures, "pupilsPerTeacher": ratio,
            "intake": schools.intake(gender, sixth_form == "Has a sixth form", other["value"] if other else None)}


# --- Inspection counts ---

STRONG_GRADES = {"Exceptional", "Strong standard"}
WEAK_GRADES = {"Needs attention", "Urgent improvement"}
COUNT_DEFINITIONS = {
    "report-card": ("Report-card areas graded Exceptional or Strong standard, and Needs attention or Urgent "
                    "improvement, out of the areas graded; Expected standard counts as neither"),
    "legacy": ("Inspection judgements graded Outstanding or Good, and Requires improvement or Inadequate, out of "
               "the judgements graded (the overall grade and aggregated judgements are not counted)"),
}


def improve_points(text: str | None) -> int | None:
    """Paragraphs or bullets of the report's "what does the school need to do to improve" text; None when
    no text is held (not 0: the report may not have been read)."""
    if not (text or "").strip():
        return None
    return sum(1 for block in re.split(r"[\n•]+", text) if block.strip())


def inspection_counts(urn: str, inspections: list[Mapping[str, Any]]) -> dict | None:
    """Counts from the latest inspection that graded anything (newest first); None when none did."""
    for inspection in inspections:
        judgements = inspection.get("judgements") or {}
        report_card = (inspection.get("framework") or "").startswith("report-card")
        if report_card:
            grades = {k: v for k, v in judgements.items() if v in REPORT_CARD_GRADES}
            strong = [k for k, v in grades.items() if v in STRONG_GRADES]
            weak = [k for k, v in grades.items() if v in WEAK_GRADES]
        else:
            grades = {k: v for k, v in judgements.items() if type(v) is int and 1 <= v <= 4
                      and "(aggregated)" not in k}
            strong = [k for k, v in grades.items() if v <= 2]
            weak = [k for k, v in grades.items() if v >= 3]
        if not grades:
            continue
        kind = "report-card" if report_card else "legacy"
        return {"framework": kind, "graded": len(grades), "strengths": len(strong), "weaknesses": len(weak),
                "strengthAreas": strong, "weaknessAreas": weak, "safeguarding": _safeguarding(judgements),
                "improvePoints": improve_points(inspection.get("improveText")),
                "inspectionDate": inspection.get("startDate"), "publicationDate": inspection.get("publicationDate"),
                "reportUrl": inspection.get("reportUrl"), "inspectedUrn": inspection.get("inspectedUrn"),
                "inspectedAsPredecessor": inspection.get("inspectedUrn") not in (None, urn),
                "definition": COUNT_DEFINITIONS[kind], "sourceRelease": inspection.get("sourceRelease")}
    return None


# --- Migration 056: Parent View, workforce, finance and destinations ---

def extra_rows(connection: Any, urn: str) -> dict:
    """{parentView: row | None, workforce: row | None, finance: [rows], destinations: [rows]}
    from EXTRA_SQL, plus loaded: EXTRA_LOADED_SQL's flags."""
    out: dict[str, Any] = {}
    for key, sql in EXTRA_SQL.items():
        rows = [dict(row) for row in connection.execute(sql, (urn,))]
        out[key] = rows if key in ("finance", "destinations") else (rows[0] if rows else None)
    loaded = next(iter(connection.execute(EXTRA_LOADED_SQL)), None)
    out["loaded"] = dict(loaded) if loaded else {}
    return out


def extra_release_ids(extras: Mapping[str, Any]) -> set[str]:
    rows = [extras.get("parentView"), extras.get("workforce"), *extras.get("finance", []),
            *extras.get("destinations", [])]
    return {row["source_release_id"] for row in rows if row}


PARENT_VIEW_PAGE = "https://www.gov.uk/government/statistical-data-sets/ofsted-parent-view-management-information"
PARENT_VIEW_DEFINITION = ("Share of the parents who answered, from Ofsted's published percentages: agree = strongly "
                          "agree + agree; yes/no and overall-view questions show the share answering Yes or Positive. "
                          "Where a question does not apply to every parent (Not applicable, I have not raised any "
                          "concerns), agree is the share of the parents it applies to: strongly agree + agree divided "
                          "by 100% minus that answer; the card says how many it did not apply to. Don't know stays in. "
                          "Ofsted "
                          "publishes a school only with 10 or more submissions. The questions changed on 10 November "
                          "2025: the card shows the current survey when the school has one, else the earlier "
                          "survey (one academic year of submissions, the latest with 10 or more), never both.")
# survey (school_parent_view.survey) -> era and label; the two surveys ask different questions.
# Answers for parents a question does not apply to: left out of the agree share, and shown on their own.
PARENT_VIEW_NOT_APPLICABLE = ("Not applicable", "I have not raised any concerns")
PARENT_VIEW_SURVEYS = {
    "2025-11": ("current", "Current survey (since 10 Nov 2025)"),
    "pre-2025-11": ("earlier", "Earlier survey (before Nov 2025)"),
}


def _question_key(qid: str) -> tuple[int, str]:
    match = re.fullmatch(r"Q(\d+)([a-z]?)", qid)
    return (int(match.group(1)), match.group(2)) if match else (999, qid)


MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def _date_label(iso: str) -> str:
    year, month, day = (int(part) for part in iso.split("-"))
    return f"{day} {MONTHS[month - 1]} {year}"


def parent_view(row: Mapping[str, Any] | None) -> dict | None:
    """Ofsted Parent View from the newest survey the school has (surveyEra current or earlier); None when it
    has fewer than 10 submissions in either (not published) or nothing is loaded. Percentages are Ofsted's,
    summed only for strongly agree + agree, of the parents a question applies to (PARENT_VIEW_NOT_APPLICABLE)."""
    if row is None:
        return None
    questions = []
    for qid in sorted(row["answers"], key=_question_key):
        answer = row["answers"][qid]
        options = answer["options"]
        if "Yes" in options or "No" in options:
            headline, value = "yes", options.get("Yes")
        elif "Positive" in options:
            headline, value = "positive", options.get("Positive")
        else:
            agree = [options[o] for o in ("Strongly agree", "Agree") if o in options]
            headline, value = "agree", sum(agree) if agree else None
        excluded = next((o for o in PARENT_VIEW_NOT_APPLICABLE if options.get(o)), None)
        if excluded and value is not None:
            applies = 100 - options[excluded]
            value = value / applies * 100 if applies > 0 else None
        questions.append({"id": qid, "question": answer["question"], "answers": options, "headline": headline,
                          "headlinePercent": None if value is None else round(value, 1),
                          "notApplicable": {"option": excluded, "percent": options[excluded]} if excluded else None})
    happy = next((q for q in questions if q["id"] == "Q1"), None)
    # Q10 in the current survey, Q14 in the earlier one
    recommend = next((q for q in questions if "recommend" in q["question"].lower()), None)
    period = f"{_date_label(row['period_start'])} to {_date_label(row['as_at'])}"
    era, label = PARENT_VIEW_SURVEYS[row["survey"]]
    return {
        "surveyEra": era, "surveyLabel": label,
        "responses": row["submissions"], "responseRate": row["response_rate"],
        "question": happy["question"] if happy else None,
        "agreePercent": happy["headlinePercent"] if happy else None,
        "happyPercent": happy["headlinePercent"] if happy else None,
        "recommendPercent": recommend["headlinePercent"] if recommend else None,
        "period": period, "periodStart": row["period_start"], "asAt": row["as_at"], "survey": row["survey"],
        "line": (f"{happy['headlinePercent']}% say their child is happy · {row['submissions']:,} responses, "
                 f"as at {_date_label(row['as_at'])}") if happy and happy["headlinePercent"] is not None else None,
        "definition": PARENT_VIEW_DEFINITION, "questions": questions, "sourceUrl": PARENT_VIEW_PAGE,
        "sourceRelease": row["source_release_id"],
    }


def workforce(row: Mapping[str, Any] | None) -> dict | None:
    """The latest school workforce census, as DfE printed it (FTE = full-time equivalent)."""
    if row is None:
        return None
    return {
        "academicYear": row["academic_year"], "teachersFte": row["teachers_fte"],
        "teachingAssistantsFte": row["teaching_assistants_fte"], "leadershipFte": row["leadership_teachers_fte"],
        "supportStaffFte": row["support_staff_fte"], "workforceFte": row["workforce_fte"],
        "workforceHeadcount": row["workforce_headcount"], "teachersHeadcount": row["teachers_headcount"],
        "pupilsFte": row["pupils_fte"], "pupilsPerTeacher": row["pupils_per_teacher"],
        "pupilsPerAdult": row["pupils_per_adult"],
        "definitions": {
            "pupilsPerTeacher": "DfE: FTE pupils (January census) ÷ FTE teachers (November census)",
            "pupilsPerAdult": ("DfE: FTE pupils ÷ FTE teachers, teaching assistants, other school support staff "
                               "and technicians; administrative, auxiliary and business staff are not counted"),
            "leadershipFte": "Teachers in leadership posts: head, deputy and assistant heads",
        },
        "sourceRelease": row["source_release_id"],
    }


ACADEMY_TYPES = {"Academy Converter", "Academy Sponsor Led", "Free School", "University Technical College",
                 "Studio School", "City Technology College"}
ACCOUNTS = {
    "CFR": ("Maintained school accounts (CFR)", "April {y1} to March {y2}"),
    "AAR": ("Academy accounts (AAR)", "September {y1} to August {y2}"),
}
FINANCE_NOT_COMPARABLE = ("CFR (maintained schools, April–March) and AAR (academies, September–August) are "
                          "different accounts and years: do not compare a maintained school with an academy.")
PER_PUPIL = ("Published total ÷ FTE pupils in the same return, to the nearest pound; income and spend per pupil "
             "are left out when the return covers less than 12 months.")


def _per_pupil(value, pupils) -> int | None:
    return round(value / pupils) if value is not None and pupils else None


def finance(rows: list[Mapping[str, Any]], school_type: str | None) -> dict | None:
    """The school's own kind of accounts (AAR for academies and free schools, CFR otherwise), else the other
    kind if that is all there is; one return only, never both side by side."""
    by_kind = {row["accounts"]: row for row in rows}
    preferred = "AAR" if school_type in ACADEMY_TYPES else "CFR"
    row = by_kind.get(preferred) or next(iter(by_kind.values()), None)
    if row is None:
        return None
    def num(key: str) -> float | None:  # numeric -> JSON number
        return None if row[key] is None else float(row[key])

    pupils = row["pupils_fte"]
    partial = row["period_months"] is not None and row["period_months"] < 12
    flow = None if partial else pupils  # a part-year's income and spend per pupil is not a year's
    label, period = ACCOUNTS[row["accounts"]]
    y1 = int(row["period"][:4])
    reserve = num("revenue_reserve")
    trust = None
    if row["trust_kind"]:
        trust = {"kind": row["trust_kind"], "name": row["trust_name"], "companyNumber": row["trust_company_number"],
                 "academies": row["trust_academies"],
                 "revenueReserve": num("trust_revenue_reserve"),
                 "note": ("Reserves in a multi-academy trust belong to the trust; this academy's figures include "
                          "the share of central costs the trust gives it") if row["trust_kind"] == "MAT" else None}
    federation = None
    if row["federation_lead_urn"]:
        federation = {"leadUrn": row["federation_lead_urn"], "isLead": row["federation_lead_urn"] == row["urn"],
                      "note": "The lead school returns one set of accounts for the whole federation"}
    return {
        "accounts": row["accounts"], "accountsLabel": label, "period": row["period"],
        "periodLabel": period.format(y1=y1, y2=y1 + 1), "periodMonths": row["period_months"], "pupilsFte": pupils,
        "revenueReserve": reserve, "revenueReservePerPupil": _per_pupil(reserve, pupils),
        "inDeficit": None if reserve is None else reserve < 0,
        "inYearBalance": num("in_year_balance"), "totalIncome": num("total_income"),
        "totalExpenditure": num("total_expenditure"),
        "partialYear": partial,
        "incomePerPupil": {"grants": _per_pupil(num("grant_funding"), flow),
                           "selfGenerated": _per_pupil(num("self_generated_income"), flow),
                           "total": _per_pupil(num("total_income"), flow)},
        "spendPerPupil": {"staff": _per_pupil(num("staff_costs"), flow),
                          "premises": _per_pupil(num("premises_costs"), flow),
                          "total": _per_pupil(num("total_expenditure"), flow)},
        "missingReason": row["not_supplied_reason"], "trust": trust, "federation": federation,
        "perPupilDefinition": PER_PUPIL, "notComparable": FINANCE_NOT_COMPARABLE,
        "sourceRelease": row["source_release_id"],
    }


DESTINATION_STAGES = {"ks4": "ks4", "16-18": "post16"}
DESTINATION_DEFINITION = ("Students who finished the stage in the cohort year, followed through the next year: "
                          "sustained = at least six months in education, an apprenticeship or employment")


def destinations(phase: str, rows: list[Mapping[str, Any]]) -> dict | None:
    """KS4 and 16-18 destination measures for secondaries; None for primaries (the GLA 2016 Year 6 flows are
    loaded but not shown: outdated)."""
    if phase != "secondary":
        return None
    out: dict[str, Any] = {"ks4": None, "post16": None, "definition": DESTINATION_DEFINITION}
    for row in rows:
        y1 = int(row["cohort_year"][:4])
        out[DESTINATION_STAGES[row["stage"]]] = {
            "cohortYear": row["cohort_year"], "destinationYear": f"{y1 + 1}/{str(y1 + 2)[-2:]}",
            "cohort": row["cohort"], "version": row["version"], "reportedUrn": row["reported_urn"],
            "sustainedPercent": row["sustained_percent"], "educationPercent": row["education_percent"],
            "higherEducationPercent": row["higher_education_percent"],
            "apprenticeshipPercent": row["apprenticeship_percent"], "employmentPercent": row["employment_percent"],
            "notSustainedPercent": row["not_sustained_percent"], "unknownPercent": row["unknown_percent"],
            "sourceRelease": row["source_release_id"],
        }
    return out


def extra_missing(phase: str, built: Mapping[str, Any], loaded: Mapping[str, bool] | None = None,
                  school_type: str | None = None) -> list[dict]:
    """Why a migration-056 row is empty, so the card says "no data" instead of guessing. loaded:
    EXTRA_LOADED_SQL's flags; a source the active release does not hold is "not loaded", never "not published"."""
    loaded = loaded or {}
    missing = []
    if built["parentView"] is None:
        missing.append({"measure": "parent-view", "reason": (
            "Ofsted Parent View: not published for this school (Ofsted lists only schools with 10 or more "
            "responses; fewer in the current survey and in the earlier-survey years loaded)"
            if loaded.get("parent_view")
            else "Ofsted Parent View is not loaded")})
    if built["workforce"] is None:
        missing.append({"measure": "workforce", "reason": "Not in the latest school workforce census"
                        if loaded.get("workforce") else "School workforce census is not loaded"})
    elif built["workforce"]["pupilsPerTeacher"] is None:
        missing.append({"measure": "pupils-per-teacher", "reason": "Pupils per teacher not published (x or u)"})
    if built["finance"] is None:
        kind = "AAR" if school_type in ACADEMY_TYPES else "CFR"
        missing.append({"measure": "finance", "reason": f"No {kind} return published for this school"
                        if loaded.get(f"finance_{kind.lower()}") else f"{ACCOUNTS[kind][0]} are not loaded"})
    elif built["finance"]["missingReason"]:
        missing.append({"measure": "finance", "reason": built["finance"]["missingReason"]})
    if phase != "primary" and not loaded.get("destinations"):  # primaries: no Destinations section
        missing.append({"measure": "destinations", "reason": "Destination measures are not loaded"})
    elif built["destinations"] is not None:
        for key, label in (("ks4", "after GCSEs"), ("post16", "after 16-18 study")):
            if built["destinations"][key] is None:
                missing.append({"measure": f"destinations-{key}",
                                "reason": f"Destinations {label}: not published for this school"})
        if built["destinations"]["ks4"] is None and built["destinations"]["post16"] is None:
            missing.append({"measure": "destinations", "reason": "Destinations: not published for this school"})
    return missing


# --- Card ---

def _value_text(value: Any, unit: str | None) -> str:
    if value is None:
        return "Not enough data"
    number = float(value)
    if unit == "percent":
        return f"{number:g}%"
    if unit == "progress":
        return f"{number:+.2f}"
    return f"{number:g}"


def kpis(urn: str, phase: str, series: Mapping[str, list[Mapping[str, Any]]], pool: Pool) -> list[dict]:
    """ScoreRating tiles: the latest published figure per phase measure, against the pool's region that year."""
    measures = list(KPI_MEASURES[phase])
    if phase == "secondary" and series.get(SIXTH_FORM_MEASURE):
        measures.append(SIXTH_FORM_MEASURE)
    tiles = []
    for kind in measures:
        points = [p for p in series.get(kind, [])]
        point = points[-1] if points else None
        year = point["academicYear"] if point else pool.latest_year(phase, kind)
        percentile = pool.percentile(phase, kind, year, urn)
        unit = schools.SCHOOL_MEASURE_LABELS.get(kind, (kind, None))[1]
        reason = None if percentile is not None else _missing_reason(point, year, pool.scope)
        trend = percentile_trend(pool, phase, kind, year, urn)
        tiles.append({
            "measure": kind, "label": KPI_LABELS[kind],
            "valueText": _value_text(point.get("value") if point and not point.get("suppressed") else None, unit),
            "value": point.get("value") if point else None, "cohortSize": point.get("cohortSize") if point else None,
            "percentile": percentile, "score10": round(percentile / 10, 1) if percentile is not None else None,
            "trend": trend, "year": year,
            "basis": (f"vs {pool.sizes.get((phase, kind, year), 0):,} {pool.scope} {_phase_noun(phase)}, "
                      f"cohort {MIN_SCHOOL_COHORT}+"),
            "regionMedian": pool.medians.get((phase, kind, year)), "scope": pool.scope, "missingReason": reason,
            "note": UNPUBLISHED.get(kind)})
    return tiles


def card(school_row: Mapping[str, Any], history: Mapping[str, Any], pool: Pool, release_id: str,
         rank_rows: list[Mapping[str, Any]] | None = None, profile_row: Mapping[str, Any] | None = None,
         extra_sources: list[Mapping[str, Any]] | None = None, extras: Mapping[str, Any] | None = None,
         sixth_rows: list[Mapping[str, Any]] | None = None) -> dict:
    """rank_rows: NATIONAL_RANK_SQL; profile_row: PROFILE_SQL; extras: extra_rows() (migration 056);
    extra_sources: source rows (as in history) behind them that the history does not cite.
    sixth_rows: SIXTH_FORM_RANK_SQL (migration 094)."""
    urn, phase = school_row["urn"], school_row["phase"]
    series = {m["id"]: m["series"] for m in history.get("measures", [])}
    badge = top_badge(urn, phase, series, history.get("inspections", []), pool)
    percentiles: dict[str, list[dict]] = {}
    medians: dict[str, list[dict]] = {}
    for kind in POOL_MEASURES:
        for year in pool.years.get((phase, kind), []):
            medians.setdefault(kind, []).append({"academicYear": year, "value": pool.medians[(phase, kind, year)],
                                                 "poolSize": pool.sizes[(phase, kind, year)]})
            if (value := pool.percentile(phase, kind, year, urn)) is not None:
                percentiles.setdefault(kind, []).append({"academicYear": year, "percentile": value})
    attributes = school_row["attributes"] or {}
    missing = [{"measure": kind, "reason": reason} for kind, reason in UNPUBLISHED.items()
               if kind.startswith("ks2" if phase == "primary" else "ks4")]
    rank = national_rank(phase, list(rank_rows or []))
    if rank is None:
        missing.append({"measure": "national-rank", "reason": "No England rank loaded for this phase"})
    elif rank["missingReason"]:
        missing.append({"measure": "national-rank", "reason": rank["missingReason"]})
    if profile_row is None:
        missing.append({"measure": "gias-profile", "reason": "Gender, trust and capacity are not loaded"})
    extras = extras or {}
    finance_built = finance(extras.get("finance", []), attributes.get("type"))
    built = {"parentView": parent_view(extras.get("parentView")), "workforce": workforce(extras.get("workforce")),
             "finance": finance_built,
             "destinations": destinations(phase, extras.get("destinations", []))}
    missing += extra_missing(phase, built, extras.get("loaded"), attributes.get("type"))
    cited = {source["id"] for source in history.get("sources", [])}
    sources = list(history.get("sources", [])) + [s for s in extra_sources or [] if s["id"] not in cited]
    return {
        "schemaVersion": "school-card.v1", "productReleaseId": release_id, "urn": urn,
        "areaId": school_row.get("area_id"),
        "school": schools.school_summary(school_row, top_badge=badge),
        "details": {"localAuthority": attributes.get("localAuthority"), "postcode": attributes.get("postcode"),
                    "sixthForm": attributes.get("sixthForm"), "pupils": attributes.get("pupils"),
                    "predecessorUrn": school_row.get("predecessor_urn"),
                    "successorUrn": school_row.get("successor_urn")},
        "history": history,
        "percentiles": percentiles, "regionMedian": medians,
        "rankScope": coverage.rank_scope(pool.region),
        "pool": {"description": f"{pool.scope} state {_phase_noun(phase)}, same year, cohort {MIN_SCHOOL_COHORT}+, "
                                "suppressed figures left out", "minCohort": MIN_SCHOOL_COHORT},
        "kpis": kpis(urn, phase, series, pool),
        "topBadge": badge,
        "nationalRank": rank,
        "combinedSixthFormRank": sixth_form_rank(list(sixth_rows or []), pool.scope),
        "profile": profile(profile_row, series, extras.get("workforce"), attributes.get("sixthForm")),
        "inspectionCounts": inspection_counts(urn, history.get("inspections", [])),
        "tldr": tldr(urn, history.get("inspections", [])),
        **built,
        "admissions": admissions(history),
        # Visit & links (migration 099): website and phone from GIAS, the rest built from the URN.
        "links": school_links.links({"urn": urn, "name": school_row.get("name"), "phase": phase,
                                     "local_authority": attributes.get("localAuthority"),
                                     "website": (profile_row or {}).get("website")},
                                    (profile_row or {}).get("telephone")),
        "compare": (compare(phase, attributes.get("localAuthority"), extras["compareRows"], extras["comparePool"],
                            finance_built["accounts"] if finance_built else None, pool.region)
                    if extras.get("comparePool") is not None else None),
        "missing": missing,
        "sources": card_sources(sources),
    }
