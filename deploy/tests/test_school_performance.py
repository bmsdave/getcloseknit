"""School performance history loader (etl_school_performance.py) on small real DfE fixtures.

The fixtures are whole rows cut from the England-wide compare-school-performance files
(regions=0) downloaded 2026-10-11: Montpelier (101912) and Southfield (101890) in Ealing, a
London school in Surrey's LA (Cuddington Croft), a merged pair in Hackney (Sir Thomas Abney into
Holmleigh), a suppressed school, independents and a national total row.
"""
import glob
import json
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import etl_school_performance as perf  # noqa: E402
import school_history_common as common  # noqa: E402
import school_measures  # noqa: E402
from unittest import mock  # noqa: E402


_PATCHER = None


def setUpModule():
    # England's LA codes come from a GIAS download; these fixtures need London's only (no network).
    global _PATCHER
    _PATCHER = mock.patch.object(common, "coverage_las", lambda: frozenset(common.LONDON_LAS))
    _PATCHER.start()


def tearDownModule():
    _PATCHER.stop()

FIXTURES = ROOT / "tests" / "fixtures" / "school_performance"
PERSONAL_PLACES = (ROOT.parent / "api" / "area_api" / "personal_places.py").read_text()


def load(source, year, resolve=None, unmatched=None):
    path = FIXTURES / f"{source.lower()}-{school_measures.download_year(year)}.csv"
    rows, stats = perf.observations(perf.read_rows(str(path)), source, year,
                                    resolve or (lambda urn: urn), unmatched)
    return {(urn, kind): (json.loads(value), cohort) for urn, kind, _, value, cohort in rows}, stats


class CellTests(unittest.TestCase):
    def test_numbers_percentages_codes_and_empty(self):
        self.assertEqual(perf.cell("89%", "percent"), {"value": 89.0, "suppressed": False})
        self.assertEqual(perf.cell("59.90%", "percent"), {"value": 59.9, "suppressed": False})
        self.assertEqual(perf.cell("-0.4", "progress"), {"value": -0.4, "suppressed": False})
        self.assertEqual(perf.cell("652", "pupils"), {"value": 652, "suppressed": False})
        self.assertEqual(perf.cell(" SUPP ", "percent"), {"value": None, "suppressed": True, "code": "SUPP"})
        for code in ("NE", "NA", "NP", "LOWCOV", "SP", "RE", "NEW"):
            self.assertTrue(perf.cell(code, "score")["suppressed"])
        self.assertIsNone(perf.cell("", "score"))
        self.assertIsNone(perf.cell(None, "score"))

    def test_grades_are_kept_as_text_and_unknown_values_stop_the_load(self):
        for grade in ("A*-", "A*", "B+", "C", "E-", "U"):
            self.assertEqual(perf.cell(grade, "grade"), {"value": grade, "suppressed": False})
        with self.assertRaises(ValueError):
            perf.cell("B+", "score")
        with self.assertRaises(ValueError):
            perf.cell("X", "percent")


class ReadTests(unittest.TestCase):
    def test_short_rows_are_padded_and_headers_upper_cased(self):
        rows = list(perf.read_rows(str(FIXTURES / "ks2-2024-2025.csv")))
        self.assertTrue(all(len(row) == 311 for row in rows))  # data rows carry 305 fields
        census = list(perf.read_rows(str(FIXTURES / "census-2024-2025.csv")))
        self.assertIn("ESTAB", census[0])  # 'Estab' in the file
        self.assertEqual(perf.la_code(census[0]), 307)
        self.assertEqual(perf.la_code({"LAESTAB": "2024104"}), 202)  # census 2010/11


class ObservationTests(unittest.TestCase):
    def test_montpelier_and_southfield_reference_values(self):
        expected = {"2015/16": 71.0, "2022/23": 87.0, "2024/25": 87.0}
        for year, value in expected.items():
            got, _ = load("KS2", year)
            self.assertEqual(got[("101912", "ks2-rwm-expected")][0]["value"], value, year)
        got, _ = load("KS2", "2022/23")
        self.assertEqual([got[("101912", f"ks2-{s}-progress")][0]["value"] for s in ("reading", "writing", "maths")],
                         [5.1, 3.3, 5.4])
        got, _ = load("KS2", "2024/25")
        self.assertEqual(got[("101890", "ks2-rwm-expected")], ({"value": 100.0, "suppressed": False}, 33))
        self.assertEqual(got[("101890", "ks2-rwm-higher")], ({"value": 39.0, "suppressed": False}, 33))
        self.assertNotIn(("101890", "ks2-reading-progress"), got)  # not published 2024/25
        got, _ = load("CENSUS", "2024/25")
        self.assertEqual(got[("101912", "pupils")], ({"value": 652, "suppressed": False}, None))

    def test_suppressed_kept_totals_and_independents_skipped(self):
        got, stats = load("KS2", "2024/25")
        self.assertEqual(got[("149534", "ks2-rwm-expected")][0], {"value": None, "suppressed": True, "code": "SUPP"})
        self.assertFalse(any(urn == "" for urn, _ in got))  # national total row (RECTYPE 4)
        census, stats = load("CENSUS", "2024/25")
        self.assertEqual(stats["independent (skipped)"], 1)
        self.assertNotIn(("101573", "pupils"), census)
        ks4, stats = load("KS4", "2024/25")
        self.assertGreater(stats["independent (skipped)"], 0)
        self.assertFalse(any(kind == "ks4-progress8" for _, kind in ks4))  # 'NA' for every school in 2024/25
        ks5, _ = load("KS5", "2024/25")
        grades = {value["value"] for (_, kind), (value, _) in ks5.items() if kind == "ks5-alevel-grade"}
        self.assertTrue(grades & {"B", "A-"})

    def test_urns_resolve_to_the_current_school_and_unmatched_are_listed(self):
        current = {"101912", "141447", "100257"}
        links = {"100251": "100257"}  # Sir Thomas Abney merged into Holmleigh

        def resolve(urn):
            return urn if urn in current else links.get(urn)
        unmatched = []
        got, stats = load("KS2", "2024/25", resolve, unmatched)
        self.assertIn(("141447", "ks2-rwm-expected"), got)  # London school in Surrey's LA 936
        self.assertEqual(stats["covered school in a neighbouring LA"], 1)
        # The merged school also reported: the current school's own row wins.
        holmleigh = [row for row in perf.read_rows(str(FIXTURES / "ks2-2024-2025.csv")) if row["URN"] == "100257"][0]
        self.assertEqual(got[("100257", "ks2-rwm-expected")][0]["value"], perf.cell(holmleigh["PTRWM_EXP"], "percent")["value"])
        self.assertGreater(stats["values also reported under a merged school's URN (current kept)"], 0)
        self.assertIn("101890", {row[0] for row in unmatched})
        self.assertEqual(stats["unmatched URN"], len(unmatched))

    def test_two_old_urns_and_no_current_one_is_dropped_not_guessed(self):
        got, stats = load("KS2", "2024/25", lambda urn: "999999" if urn in ("100251", "100257") else None)
        self.assertFalse(any(urn == "999999" for urn, _ in got))
        self.assertGreater(stats["values dropped: several old URNs, no current one"], 0)


class AttributeTests(unittest.TestCase):
    OLD = {"observations": [
        {"kind": "performance", "measure": "Expected standard in reading, writing and maths (%)", "value": 80.0,
         "academicYear": "2024/25", "sourceRelease": "src-dfe-ks2-2024-25-revised"},
        {"kind": "inspection-legacy", "measure": "Overall effectiveness", "value": "Good"}],
        "missingObservations": ["Key stage 2 progress scores (not published for 2024/25)",
                                "Graded inspection (none on record under either framework)"],
        "pupils": 646.0}

    def test_card_labels_are_the_ones_ranking_reads(self):
        self.assertIn(f'"primary": "{school_measures.BY_ID["ks2-rwm-expected"].label}"', PERSONAL_PLACES)
        self.assertEqual(school_measures.BY_ID["ks2-rwm-higher"].label,
                         "Higher standard in reading, writing and maths (%)")

    def test_with_ks2_replaces_results_and_notes_and_keeps_the_rest(self):
        results = {"ks2-rwm-expected": ({"value": 87.0, "suppressed": False}, 82),
                   "ks2-rwm-higher": ({"value": 23.0, "suppressed": False}, 82)}
        new = perf.with_ks2(self.OLD, results, "2024/25")
        perf_obs = [o for o in new["observations"] if o["kind"] == "performance"]
        self.assertEqual([(o["measure"][:8], o["value"], o["cohortSize"], o["suppressed"]) for o in perf_obs],
                         [("Expected", 87.0, 82, False), ("Higher s", 23.0, 82, False)])
        self.assertEqual({o["sourceRelease"] for o in perf_obs}, {"src-dfe-cscp-ks2-2024-25"})
        self.assertIn("regions=0&filters=KS2", perf_obs[0]["sourceUrl"])
        self.assertIn("inspection-legacy", [o["kind"] for o in new["observations"]])
        self.assertEqual(new["missingObservations"], ["Graded inspection (none on record under either framework)",
                                                      "Key stage 2 progress scores (not published for 2024/25)"])
        self.assertEqual(new["pupils"], 646.0)

    def test_with_ks2_without_results_says_so(self):
        new = perf.with_ks2(self.OLD, {}, "2024/25")
        self.assertFalse([o for o in new["observations"] if o["kind"] == "performance"])
        self.assertIn("Key stage 2 results 2024/25 (no published school-level figures, e.g. infant schools "
                      "without year 6)", new["missingObservations"])


class MeasureTests(unittest.TestCase):
    def test_release_ids_and_urls(self):
        self.assertEqual(perf.release_id("KS2", "2024/25"), "src-dfe-cscp-ks2-2024-25")
        self.assertEqual(perf.release_id("CENSUS", "2010/11"), "src-dfe-cscp-census-2010-11")
        self.assertEqual(perf.DATA_URL.format(source="KS4", year="2015-2016"),
                         "https://www.compare-school-performance.service.gov.uk/download-data?download=true"
                         "&regions=0&filters=KS4&fileformat=csv&year=2015-2016&meta=false")

    def test_columns_exist_in_the_fixture_headers(self):
        for path in FIXTURES.glob("*.csv"):
            source, start = path.stem.split("-")[0].upper(), path.stem.split("-")[1]
            year = f"{start}/{str(int(start) + 1)[2:]}"
            header = next(perf.read_rows(str(path))).keys()
            for measure in school_measures.measures(source):
                for column in filter(None, (measure.column(year), measure.cohort_column.get(year))):
                    self.assertIn(column, header, f"{measure.id} {year}")

    def test_columns_exist_in_every_downloaded_file(self):
        folders = sorted(glob.glob(os.path.expanduser("~/data/dfe-performance/20*-*")))
        if not folders:
            self.skipTest("no downloaded performance tables")
        for source, years in perf.YEARS.items():
            if not any(perf.data_path(folders[-1], source, year) for year in years):
                continue  # a source added after this mirror was taken (fetch adds it)
            for year in years:
                path = perf.data_path(folders[-1], source, year)
                self.assertIsNotNone(path, f"{source} {year} not downloaded")
                header = next(perf.read_rows(path)).keys()
                for measure in school_measures.measures(source):
                    for column in filter(None, (measure.column(year), measure.cohort_column.get(year))):
                        self.assertIn(column, header, f"{measure.id} {year}")



def rank_row(urn, value, higher="20", rectype="1", kind="AC"):
    return {"RECTYPE": rectype, "URN": urn, "NFTYPE": kind, "PTRWM_EXP": value, "PTRWM_HIGH": higher}


class NationalRankTests(unittest.TestCase):
    def test_competition_ranking_with_the_higher_standard_as_tie_break(self):
        pool, total = perf.national_ranks([
            rank_row("100001", "90", "40"), rank_row("100002", "90", "30"), rank_row("100003", "90", "30"),
            rank_row("100004", "80"), rank_row("100005", "70%")], "KS2")
        self.assertEqual(total, 5)
        self.assertEqual([(e["urn"], e["rank"], e["top_percent"]) for e in pool],
                         [("100001", 1, 20), ("100002", 2, 40), ("100003", 2, 40), ("100004", 4, 80),
                          ("100005", 5, 100)])
        self.assertEqual((pool[0]["value"], pool[0]["tiebreak"]), (90.0, 40.0))

    def test_suppressed_missing_special_independent_and_colleges_are_not_in_the_pool(self):
        pool, total = perf.national_ranks([
            rank_row("100001", "SUPP"), rank_row("100002", ""), rank_row("100003", "NE"),
            rank_row("100004", "75", rectype="2"), rank_row("100005", "75", kind="IND"),
            rank_row("100006", "75", kind="FESI"), rank_row("LA", "75"), rank_row("100007", "60")], "KS2")
        self.assertEqual((total, [e["urn"] for e in pool]), (1, ["100007"]))

    def test_secondaries_rank_on_attainment_8_alone(self):
        rows = [{"RECTYPE": "1", "URN": urn, "NFTYPE": "CY", "ATT8SCR": value}
                for urn, value in (("200001", "45.1"), ("200002", "60.2"), ("200003", "45.1"))]
        pool, total = perf.national_ranks(rows, "KS4")
        self.assertEqual([(e["urn"], e["rank"], e["tiebreak"]) for e in pool],
                         [("200002", 1, None), ("200001", 2, None), ("200003", 2, None)])
        self.assertEqual(perf.RANK_RULES["KS4"][1], "ks4-attainment8")

    def test_london_schools_keep_their_own_row_or_a_single_predecessors(self):
        pool = [{"urn": u, "value": 1.0, "tiebreak": None, "rank": r, "top_percent": 1}
                for u, r in (("100001", 1), ("140001", 2), ("100002", 3), ("100003", 4), ("100004", 5),
                             ("999999", 6))]
        current = {"100001": "140001", "140001": "140001", "100002": "150000", "100003": "150000",
                   "100004": "160000"}
        london = perf.london_ranks(pool, current.get)
        self.assertEqual([(e["urn"], e["ranked_urn"], e["rank"]) for e in london],
                         [("140001", "140001", 2), ("160000", "100004", 5)])

    def test_rank_table_in_migration_055(self):
        migration = (ROOT / "migrations" / "055-school-card-full.sql").read_text()
        self.assertIn("CREATE TABLE IF NOT EXISTS school_national_rank", migration)
        self.assertIn("top_percent smallint NOT NULL CHECK (top_percent BETWEEN 1 AND 100)", migration)

    def test_absence_and_census_shares_from_the_fixtures(self):
        absence, _ = load("PUPILABSENCE", "2024/25")
        self.assertEqual(absence[("101912", "absence-persistent-percent")], ({"value": 11.61, "suppressed": False}, None))
        census, _ = load("CENSUS", "2024/25")
        self.assertEqual(census[("101890", "census-girls-percent")][0]["value"], 53.05)
        self.assertEqual(census[("101890", "census-sen-support-percent")][0]["value"], 8.75)


def ks5_row(urn, aps, grade="B", pupils="30", kind="IND"):
    return {"RECTYPE": "1", "URN": urn, "NFTYPE/FESITYPE": kind, "TALLPPE_ALEV_1618": aps,
            "TALLPPEGRD_ALEV_1618": grade, "TALLPUP_ALEV_1618": pupils}


class IndependentObservationTests(unittest.TestCase):
    def test_independents_never_reach_school_observation(self):
        # school_observation.urn REFERENCES school(urn), and school is state-only (migration 067):
        # independents' figures live in school_sixth_form_rank alone.
        source = (ROOT / "tools" / "etl_school_performance.py").read_text()
        self.assertEqual(source.count("COPY school_observation"), 1)
        self.assertNotIn("independent_observations", source)

    def test_independent_rows_stay_out_of_state_observations_and_the_state_ranks(self):
        _, stats = load("KS4", "2024/25")  # school_rows still skips them
        self.assertGreater(stats["independent (skipped)"], 0)
        pool, total = perf.national_ranks(
            [{"RECTYPE": "1", "URN": "100001", "NFTYPE": "IND", "ATT8SCR": "62.3"},
             {"RECTYPE": "1", "URN": "100002", "NFTYPE": "CY", "ATT8SCR": "57.2"}], "KS4")
        self.assertEqual((total, [e["urn"] for e in pool]), (1, ["100002"]))


class SixthFormRankTests(unittest.TestCase):
    def test_entries_minimum_tie_break_and_suppressed(self):
        pool, total = perf.combined_sixth_form_ranks([
            ks5_row("100001", "47.89", "A-", "72"),               # independent, in
            ks5_row("100002", "47.20", "A-", "17"),               # 17 pupils: below the minimum
            ks5_row("100003", "39.11", "B", "113", kind="ACC"),   # state, in
            ks5_row("100004", "39.11", "B+", "110", kind="ACC"),  # same APS, better grade: ahead
            ks5_row("100005", "SUPP", "SUPP", "5"),               # suppressed: out
            ks5_row("100006", "", "", ""),                       # missing: out
            ks5_row("100007", "38.73", "B", "110", kind="FESI"),  # a college, not a school: out
        ])
        self.assertEqual(total, 3)
        self.assertEqual([(e["urn"], e["rank"], e["top_percent"]) for e in pool],
                         [("100001", 1, 34), ("100004", 2, 67), ("100003", 3, 100)])
        self.assertEqual(pool[1]["tiebreak"], 45.0)  # B+

    def test_ties_share_the_best_rank(self):
        pool, total = perf.combined_sixth_form_ranks([
            ks5_row("100001", "40.00", "B", "30"), ks5_row("100002", "40.00", "B", "30"),
            ks5_row("100003", "39.00", "B", "30")])
        self.assertEqual(total, 3)
        self.assertEqual([(e["urn"], e["rank"]) for e in pool],
                         [("100001", 1), ("100002", 1), ("100003", 3)])

    def test_grade_points(self):
        self.assertEqual(perf._grade_points("A*"), 60.0)
        self.assertEqual(perf._grade_points("A-"), 45.0)
        self.assertEqual(perf._grade_points("B+"), 45.0)
        self.assertEqual(perf._grade_points("C"), 30.0)
        self.assertEqual(perf._grade_points("U"), 0.0)
        self.assertIsNone(perf._grade_points("SUPP"))
        self.assertIsNone(perf._grade_points(""))
        self.assertIsNone(perf._grade_points(None))

    def test_london_pool_links_state_and_independent(self):
        pool = [{"urn": "100001", "value": 47.89, "tiebreak": 45.0, "rank": 1, "top_percent": 34},
                {"urn": "100002", "value": 39.11, "tiebreak": 40.0, "rank": 2, "top_percent": 67}]
        london = perf.london_sixth_form_ranks(pool, {"100001": "100001"}.get, {"100002"})
        self.assertEqual([(e["urn"], e["kind"], e["ranked_urn"], e["rank"]) for e in london],
                         [("100001", "state", "100001", 1), ("100002", "independent", "100002", 2)])
        self.assertEqual(perf.london_sixth_form_ranks(pool, lambda urn: None, set()), [])

    def test_fixture_sixth_form_rank(self):
        # The real KS5 fixture: Notting Hill & Ealing High School (72 A-level students) ranks;
        # St Augustine's Priory (17) is below the 20-student minimum.
        rows = list(perf.read_rows(str(FIXTURES / "ks5-2024-2025.csv")))
        pool, total = perf.combined_sixth_form_ranks(rows)
        self.assertEqual(total, 4)
        self.assertEqual([(e["urn"], e["rank"]) for e in pool],
                         [("101954", 1), ("137221", 2), ("101934", 3), ("137729", 4)])
        entry = pool[0]
        self.assertEqual((entry["value"], entry["cohort"], entry["tiebreak"]), (47.89, 72, 45.0))

    def test_migration_094(self):
        migration = (ROOT / "migrations" / "094-schools-ks5-combined-rank.sql").read_text()
        self.assertIn("CREATE TABLE IF NOT EXISTS school_sixth_form_rank", migration)
        self.assertIn("kind text NOT NULL CHECK (kind IN ('state', 'independent'))", migration)


if __name__ == "__main__":
    unittest.main()
