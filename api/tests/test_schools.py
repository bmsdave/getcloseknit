"""Real school evidence: payloads follow SchoolSummary and never imply admission or travel time."""
import contextlib
import importlib.util
import os
import sys
import unittest
from pathlib import Path

from area_api import evidence, schools

ROW = {
    "urn": "101234", "name": "Sample Primary", "phase": "primary",
    "attributes": {
        "type": "Academy converter", "ageFrom": 4, "ageTo": 11, "faith": "Church of England",
        "selectivity": "Not applicable", "reportCard": True,
        "observations": [{"kind": "inspection-current", "academicYear": "2025/26", "measure": "Achievement",
                          "value": "Strong standard", "sourceUrl": "https://reports.ofsted.gov.uk/provider/21/101234",
                          "sourceRelease": "src-ofsted-latest-inspections-2026-08"}],
        "missingObservations": ["Key stage 2 progress scores (not published for 2024/25)"],
    },
    "latitude": 51.51, "longitude": -0.30, "source_release_id": "src-ofsted-latest-inspections-2026-08",
    "distance_metres": 420,
}


class FakeConnection:
    def __init__(self, area_exists=True):
        self.area_exists = area_exists
        self.calls = []

    def execute(self, sql, params=()):
        marker = sql.splitlines()[0]
        self.calls.append((marker, params))
        if marker.startswith(("-- evidence:school-card", "-- evidence:school-badge")):
            return []  # topBadge inputs (api/tests/test_school_card.py covers them)
        if "active-release" in marker or "readiness" in marker or "active_product_release" in sql:
            return [{"release_id": "rel-test", "previous_release_id": None, "validation_status": "passed",
                     "assets": ["tiles/property_tile"]}]
        if marker == "-- evidence:area-exists":
            return [{"?column?": 1}] if self.area_exists else []
        return [ROW]


class SchoolReaderTests(unittest.TestCase):
    def reader(self, connection):
        return evidence.EvidenceReader(connect=lambda: contextlib.nullcontext(connection))

    def test_summary_matches_the_contract_and_keeps_admission_unavailable(self):
        summary = schools.school_summary(ROW)
        self.assertEqual(summary["schoolId"], "uk:school:101234")
        self.assertEqual(summary["ageRange"], {"from": 4, "to": 11})
        self.assertEqual(summary["inspectionFramework"], "report-card")
        self.assertIsNone(summary["journeyMinutes"])
        self.assertEqual(summary["distanceMetres"], 420)
        self.assertEqual(summary["admissionEvidence"]["kind"], "unavailable")
        self.assertIs(summary["admissionEvidence"]["isProbability"], False)
        self.assertEqual(summary["observations"][0]["cohortSize"], None)
        self.assertEqual(summary["missingObservations"], ["Key stage 2 progress scores (not published for 2024/25)"])

    def test_area_schools_search_a_radius_around_the_area(self):
        connection = FakeConnection()
        payload = self.reader(connection).area_schools("uk:lsoa:E01001275")
        self.assertEqual(payload["radiusMetres"], schools.NEAR_RADIUS_METRES)
        self.assertEqual(len(payload["schools"]), 1)
        self.assertIn(("-- evidence:area-schools",
                       ("uk:lsoa:E01001275", schools.NEAR_RADIUS_METRES, schools.NEAR_LIMIT)), connection.calls)

    def test_malformed_and_unknown_inputs(self):
        with self.assertRaises(evidence.MalformedQuery):
            self.reader(FakeConnection()).area_schools("E01001275")
        with self.assertRaises(evidence.AreaNotFound):
            self.reader(FakeConnection(area_exists=False)).area_schools("uk:lsoa:E01999999")
        with self.assertRaises(evidence.MalformedQuery):
            self.reader(FakeConnection()).get_school("12")

    def test_short_searches_return_nothing_without_querying(self):
        connection = FakeConnection()
        self.assertEqual(self.reader(connection).search_schools("ab")["schools"], [])
        self.assertEqual(connection.calls, [])


def ks4(measure, value, cohort, year="2024/25", suppressed=False):
    return {"kind": "performance", "academicYear": year, "measure": measure, "value": value,
            "cohortSize": cohort, "suppressed": suppressed, "sourceRelease": "src-ks4"}


def legacy(value, year):
    return {"kind": "inspection-legacy", "academicYear": year, "measure": "Overall effectiveness",
            "value": value, "sourceRelease": "src-ofsted"}


def card(measure, value, year="2025/26"):
    return {"kind": "inspection-current", "academicYear": year, "measure": measure, "value": value,
            "sourceRelease": "src-ofsted"}


def school(urn, observations, borough="Ealing", report_card=False, name=None):
    return {"urn": urn, "name": name or f"School {urn}", "phase": "secondary",
            "attributes": {"localAuthority": borough, "reportCard": report_card, "observations": observations}}


G5 = "Grade 5+ in English and maths (%)"


class SchoolRankingTests(unittest.TestCase):
    def test_performance_ranks_by_value_with_cohort_floor_and_no_suppressed_rows(self):
        rows = [school("100001", [ks4(G5, 61.0, 180)], borough="Brent"),
                school("100002", [ks4(G5, 88.0, 150)]),
                school("100003", [ks4(G5, 100.0, 12)]),           # cohort below 30
                school("100004", [ks4(G5, None, 200, suppressed=True)]),
                school("100005", [ks4("Attainment 8", 70.1, 200)])]
        ranking = schools.school_ranking("grade5-english-maths", rows, limit=100)
        self.assertEqual([r["urn"] for r in ranking["rows"]], ["100002", "100001"])
        self.assertEqual(ranking["rows"][1], {"urn": "100001", "name": "School 100001", "borough": "Brent",
                                              "value": 61.0, "cohort": 180, "year": "2024/25"})
        self.assertEqual(ranking["year"], "2024/25")
        self.assertEqual(ranking["minCohort"], 30)
        self.assertEqual(ranking["eligibleSchools"], 2)

    def test_progress8_uses_only_its_latest_year_and_that_years_cohort(self):
        rows = [school("100001", [ks4("Progress 8", 0.62, 140, year="2023/24"), ks4(G5, 50.0, 10)]),
                school("100002", [ks4("Progress 8", 0.91, 160, year="2022/23")]),
                school("100003", [ks4("Progress 8", -0.2, 25, year="2023/24")])]
        ranking = schools.school_ranking("progress-8", rows, limit=100)
        self.assertEqual([(r["urn"], r["cohort"], r["year"]) for r in ranking["rows"]],
                         [("100001", 140, "2023/24")])

    def test_caveats_name_the_year_and_status_of_the_rows_ranked(self):
        provisional = {**ks4(G5, 61.0, 180, year="2025/26"), "sourceRelease": "src-dfe-ks4-2025-26-provisional"}
        ranking = schools.school_ranking("grade5-english-maths", [school("100001", [provisional])], limit=100)
        self.assertEqual(ranking["caveats"], ["Provisional 2025/26 figures (DfE).", "State-funded schools only."])
        final = [school("100001", [ks4("Attainment 8", 50.0, 180, year="2024/25")])]
        self.assertEqual(schools.school_ranking("attainment-8", final, limit=100)["caveats"][0], "2024/25 figures (DfE).")
        behind = [school("100001", [ks4("Progress 8", 0.5, 140, year="2023/24"), ks4(G5, 60.0, 140)])]
        self.assertEqual(schools.school_ranking("progress-8", behind, limit=100)["caveats"][0],
                         "2023/24 figures (DfE): Progress 8 is not published for 2024/25.")
        self.assertEqual(schools.school_ranking("attainment-8", [], limit=100)["caveats"], ["State-funded schools only."])
        self.assertNotRegex(repr(schools.RANKING_CAVEATS), r"20\d\d/\d\d")  # years come from the rows

    def test_limit_cuts_the_list_but_not_the_eligible_count(self):
        rows = [school(f"10000{i}", [ks4("Attainment 8", 40.0 + i, 100)]) for i in range(5)]
        ranking = schools.school_ranking("attainment-8", rows, limit=2)
        self.assertEqual([r["value"] for r in ranking["rows"]], [44.0, 43.0])
        self.assertEqual(ranking["eligibleSchools"], 5)

    def test_legacy_outstanding_never_mixes_in_report_card_schools(self):
        rows = [school("100001", [legacy("Outstanding", "2018/19")]),
                school("100002", [legacy("Outstanding", "2023/24")]),
                school("100003", [legacy("Good", "2024/25")]),
                school("100004", [legacy("Outstanding", "2022/23"), card("Achievement", "Exceptional")],
                       report_card=True)]
        ranking = schools.school_ranking("legacy-outstanding", rows, limit=100)
        self.assertEqual([(r["urn"], r["year"]) for r in ranking["rows"]],
                         [("100002", "2023/24"), ("100001", "2018/19")])
        self.assertEqual(ranking["rows"][0]["value"], "Outstanding")
        self.assertIsNone(ranking["rows"][0]["cohort"])
        self.assertIsNone(ranking["minCohort"])

    def test_report_card_counts_exceptional_areas_and_ignores_legacy_grades(self):
        rows = [school("100001", [card("Achievement", "Exceptional"), card("Inclusion", "Exceptional"),
                                  card("Attendance and behaviour", "Strong standard")], report_card=True),
                school("100002", [card("Achievement", "Exceptional", year="2026/27")], report_card=True),
                school("100003", [card("Achievement", "Expected standard")], report_card=True),
                school("100004", [legacy("Outstanding", "2023/24")])]
        ranking = schools.school_ranking("report-card-exceptional", rows, limit=100)
        self.assertEqual([(r["urn"], r["value"], r["year"]) for r in ranking["rows"]],
                         [("100001", 2, "2025/26"), ("100002", 1, "2026/27")])
        self.assertEqual(ranking["inspectedSchools"], 3)

    def test_reader_validates_axis_phase_and_limit(self):
        reader = evidence.EvidenceReader(connect=lambda: contextlib.nullcontext(FakeConnection()))
        with self.assertRaises(evidence.MetricNotFound):
            reader.school_ranking("best-overall", "secondary", 100)
        with self.assertRaises(evidence.MalformedQuery):
            reader.school_ranking("attainment-8", "primary", 100)
        with self.assertRaises(evidence.MalformedQuery):
            reader.school_ranking("legacy-outstanding", "nursery", 100)
        with self.assertRaises(evidence.MalformedQuery):
            reader.school_ranking("legacy-outstanding", "primary", 101)

    def test_reader_reads_one_phase(self):
        connection = FakeConnection()
        payload = evidence.EvidenceReader(connect=lambda: contextlib.nullcontext(connection)).school_ranking(
            "legacy-outstanding", "primary", 100)
        self.assertEqual(payload["schemaVersion"], "school-ranking.v1")
        self.assertEqual((payload["axis"], payload["phase"], payload["productReleaseId"]),
                         ("legacy-outstanding", "primary", "rel-test"))
        self.assertIn(("-- evidence:school-ranking", ("primary",)), connection.calls)
        self.assertEqual(payload["rows"], [])
class HistoryConnection:
    """Answers each school-history statement by its marker; records every call."""
    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    def execute(self, sql, params=()):
        marker = sql.splitlines()[0].removeprefix("-- evidence:")
        self.calls.append((marker, sql, params))
        return self.rows.get(marker, [])


HISTORY_ROWS = {
    "school-history-observations": [
        {"observation_kind": "pupils", "academic_year": "2024/25", "value": {"value": 420, "suppressed": False},
         "cohort_size": None, "source_release_id": "src-dfe-cscp-census-2024-25"},
        {"observation_kind": "ks2-rwm-expected", "academic_year": "2015/16", "value": {"value": 71, "suppressed": False},
         "cohort_size": 60, "source_release_id": "src-dfe-cscp-ks2-2015-16"},
        {"observation_kind": "ks2-rwm-expected", "academic_year": "2024/25",
         "value": {"value": None, "suppressed": True, "code": "SUPP"}, "cohort_size": 5,
         "source_release_id": "src-dfe-cscp-ks2-2024-25"},
    ],
    "school-history-inspections": [
        {"inspection_number": "10290000", "inspected_urn": "101234", "start_date": "2023-11-14",
         "publication_date": "2024-01-18", "inspection_type": "S5", "framework": "eif-2019", "overall": 2,
         "judgements": {"Quality of education": 1}, "report_url": "https://files.ofsted.gov.uk/v1/file/1",
         "key_findings": "Pupils enjoy school.", "improve_text": "Sequence the early years curriculum.",
         "report_matched": True, "source_release_id": "src-ofsted-inspections-2023-24"},
        {"inspection_number": "500001", "inspected_urn": "100999", "start_date": "2008-05-01",
         "publication_date": None, "inspection_type": "S5", "framework": "pre-2015", "overall": 3,
         "judgements": {}, "report_url": "https://reports.ofsted.gov.uk/provider/21/100999",
         "key_findings": None, "improve_text": None, "report_matched": False,
         "source_release_id": "src-ofsted-inspections-2005-2015"},
    ],
    "school-history-demand": [
        {"entry_year": 2026, "entry_point": "reception", "first_preferences": 109, "any_preferences": 400,
         "offers": 60, "first_preference_offers": 55, "pan": None,
         "source_release_id": "src-dfe-applications-offers-2026-27"},
    ],
    "school-history-distances": [
        {"academic_year": "2026/27", "entry_point": "reception", "rule_id": "reception", "school_site_id": "main",
         "measurement_method": "straight-line", "last_offer_distance_metres": 1370, "raw_value": "0.851",
         "all_offered": False, "last_offer_criterion": "Distance", "applicants": 396, "offers": 90, "refused": None,
         "source_url": "https://www.harrow.gov.uk/downloads/file/33701",
         "source_release_id": "src-la-admissions-harrow-primary-2026"},
    ],
    "school-history-sources": [
        {"id": "src-dfe-cscp-ks2-2015-16", "licence": "OGL-3.0", "attribution": "Department for Education",
         "caveats": ["Suppressed values are null with a code."]},
    ],
}


class SchoolHistoryTests(unittest.TestCase):
    def test_series_follow_the_measure_order_and_keep_suppression(self):
        history = schools.school_history(HistoryConnection(HISTORY_ROWS), "101234")
        self.assertEqual(history["schemaVersion"], "school-history.v1")
        self.assertEqual([m["id"] for m in history["measures"]], ["ks2-rwm-expected", "pupils"])
        ks2 = history["measures"][0]
        self.assertEqual(ks2["label"], "Expected standard in reading, writing and maths (%)")
        self.assertEqual(ks2["unit"], "percent")
        self.assertEqual([p["academicYear"] for p in ks2["series"]], ["2015/16", "2024/25"])
        self.assertEqual(ks2["series"][0]["value"], 71)
        self.assertEqual(ks2["series"][0]["cohortSize"], 60)
        suppressed = ks2["series"][1]
        self.assertTrue(suppressed["suppressed"])
        self.assertIsNone(suppressed["value"])
        self.assertEqual(suppressed["suppressionCode"], "SUPP")

    def test_inspections_quote_reports_and_link_only_a_matched_pdf(self):
        inspections = schools.school_history(HistoryConnection(HISTORY_ROWS), "101234")["inspections"]
        self.assertEqual(inspections[0]["overall"], 2)
        self.assertEqual(inspections[0]["improveText"], "Sequence the early years curriculum.")
        self.assertEqual(inspections[0]["reportUrl"], "https://files.ofsted.gov.uk/v1/file/1")
        self.assertEqual(inspections[1]["inspectedUrn"], "100999")
        self.assertIsNone(inspections[1]["reportUrl"])

    def test_demand_and_distances_and_their_sources(self):
        connection = HistoryConnection(HISTORY_ROWS)
        history = schools.school_history(connection, "101234")
        self.assertEqual(history["demand"][0]["firstPreferences"], 109)
        self.assertIsNone(history["demand"][0]["pan"])
        self.assertEqual(history["distances"][0]["distanceMetres"], 1370)
        self.assertEqual(history["distances"][0]["rawValue"], "0.851")
        self.assertEqual(history["sources"][0]["licence"], "OGL-3.0")
        sql = {marker: (text, params) for marker, text, params in connection.calls}
        self.assertIn("publishable", sql["school-history-distances"][0])
        for marker in ("school-history-observations", "school-history-inspections", "school-history-demand",
                       "school-history-distances"):
            self.assertIn("active_product_release", sql[marker][0])
            self.assertEqual(sql[marker][1], ("101234",))
        used = sql["school-history-sources"][1][0]
        self.assertIn("src-la-admissions-harrow-primary-2026", used)
        self.assertEqual(used, sorted(used))

    def test_a_school_with_no_history_reads_empty_without_a_sources_query(self):
        connection = HistoryConnection({})
        history = schools.school_history(connection, "101234")
        self.assertEqual((history["measures"], history["inspections"], history["demand"], history["distances"],
                          history["sources"]), ([], [], [], [], []))
        self.assertNotIn("school-history-sources", [marker for marker, _, _ in connection.calls])

    def test_malformed_urn(self):
        with self.assertRaises(ValueError):
            schools.school_history(HistoryConnection({}), "12; drop")

    def test_labels_match_the_loader_measures(self):
        path = Path(__file__).resolve().parents[2] / "deploy" / "tools" / "school_measures.py"
        spec = importlib.util.spec_from_file_location("school_measures", path)
        module = importlib.util.module_from_spec(spec)
        sys.modules.setdefault(spec.name, module)  # dataclasses look their module up
        spec.loader.exec_module(module)
        self.assertEqual(schools.SCHOOL_MEASURE_LABELS,
                         {m.id: (m.label, m.unit) for m in module.MEASURES})


TEST_DATABASE_URL = os.environ.get("CLOSE_KNIT_TEST_DATABASE_URL")


@unittest.skipUnless(TEST_DATABASE_URL, "set CLOSE_KNIT_TEST_DATABASE_URL to a loaded database")
class SchoolHistoryDatabaseTests(unittest.TestCase):
    """Reference values for Montpelier Primary (101912) on a database with the school history staged."""
    @classmethod
    def setUpClass(cls):
        import psycopg
        from psycopg.rows import dict_row

        with psycopg.connect(TEST_DATABASE_URL, row_factory=dict_row) as connection:
            cls.history = schools.school_history(connection, "101912")
        if not cls.history["measures"]:
            raise unittest.SkipTest("school history is not in the active release")

    def test_key_stage_2_expected_standard_by_year(self):
        series = {m["id"]: m["series"] for m in self.history["measures"]}["ks2-rwm-expected"]
        values = {p["academicYear"]: p["value"] for p in series}
        self.assertEqual(values, {"2015/16": 71, "2016/17": 85, "2017/18": 80, "2018/19": 83,
                                  "2022/23": 87, "2023/24": 83, "2024/25": 87})

    def test_ofsted_2023_good_and_first_preferences_2026(self):
        inspection = next(i for i in self.history["inspections"] if i["startDate"] == "2023-11-14")
        self.assertEqual((inspection["framework"], inspection["overall"]), ("eif-2019", 2))
        demand = {(d["entryYear"], d["entryPoint"]): d for d in self.history["demand"]}
        self.assertEqual(demand[(2026, "reception")]["firstPreferences"], 109)

    def test_unpublishable_council_distances_stay_out(self):
        self.assertEqual(self.history["distances"], [])  # Ealing's terms do not confirm re-use
        self.assertTrue(all(s["attribution"] for s in self.history["sources"]))


class NoisePayloadTests(unittest.TestCase):
    def test_shares_and_one_home(self):
        row = {"dwellings": 812, "road_55_share": 0.41234, "rail_55_share": 0.05, "air_55_share": 0.02,
               "any_55_share": 0.43, "any_65_share": 0.12, "road_lden_median": 53.2, "source_release_id": "src-defra-noise-round4-2022",
               "caveats": ["Modelled"], "attribution": "Defra"}
        payload = schools.noise_payload("uk:lsoa:E01001275", "rel", row, {"road_lden": 61.5, "rail_lden": None}, "1234")
        self.assertTrue(payload["available"])
        self.assertEqual(payload["road55Share"], 0.412)
        self.assertEqual(payload["air55Share"], 0.02)
        self.assertEqual(payload["dwelling"], {"uprn": "1234", "roadLden": 61.5, "railLden": None})

    def test_missing_area_noise_is_unavailable_not_zero(self):
        payload = schools.noise_payload("uk:lsoa:E01001275", "rel", None, None, None)
        self.assertFalse(payload["available"])
        self.assertIsNone(payload["any55Share"])


if __name__ == "__main__":
    unittest.main()
