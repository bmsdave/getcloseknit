"""Ofsted inspection history (etl_ofsted_history.py) and the judgements etl_schools.py keeps."""
import os
import sys
import unittest
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import etl_ofsted_history as history  # noqa: E402
import etl_schools  # noqa: E402
import school_history_common as common  # noqa: E402
from unittest import mock  # noqa: E402


_PATCHER = None


def setUpModule():
    # England's LA codes come from a GIAS download; the fixtures are London's (no network in tests).
    global _PATCHER
    _PATCHER = mock.patch.object(common, "coverage_las", lambda: frozenset(common.LONDON_LAS))
    _PATCHER.start()


def tearDownModule():
    _PATCHER.stop()

MIGRATION = (ROOT / "migrations" / "048-school-history.sql").read_text()
HEADER_2005 = ["Web link", "URN", "LAESTAB", "Inspection number", "Inspection type", "Inspection start date",
               "Inspection end date", "First published date", "Latest published date", "Overall effectiveness",
               "Category", "Quality of teaching", "Inspection number of the previous inspection",
               "Previous inspection - Overall effectiveness"]
HEADER_2019 = ["Web Link", "URN", "LAESTAB", "Region", "Inspection number", "Inspection type", "Inspection start date",
               "Inspection end date", "Publication date",
               "Did the latest ungraded inspection convert to a graded inspection?",
               "Outcomes for ungraded and monitoring inspections", "Overall effectiveness", "Category of concern",
               "Quality of education", "Safeguarding is effective", "Previous inspection number",
               "Previous overall effectiveness"]
HEADER_2026 = ["Web Link (opens in new window)", "URN", "LAESTAB", "Inspection number", "Inspection type",
               "Inspection start date", "Publication date", "Outcomes for legacy monitoring inspections",
               "Category of concern", "Safeguarding standards", "Inclusion", "Achievement"]


class FakeResolver:
    def __init__(self, mapping):
        self.mapping = mapping

    def resolve(self, urn):
        return self.mapping.get(urn)


def row(urn="101912", number="10289825", start=date(2023, 11, 14), overall=None, judgements=None,
        release="src-a"):
    return history.inspection(urn, number, start, start, "S5 Inspection", overall, judgements or {}, release)


class ParsingTests(unittest.TestCase):
    def test_judgements_lie_between_the_dates_and_the_previous_inspection(self):
        self.assertEqual(history.judgement_columns(HEADER_2005), ["Category", "Quality of teaching"])
        self.assertEqual(history.judgement_columns(HEADER_2019), [
            "Did the latest ungraded inspection convert to a graded inspection?",
            "Outcomes for ungraded and monitoring inspections", "Category of concern", "Quality of education",
            "Safeguarding is effective"])
        self.assertEqual(history.judgement_columns(HEADER_2026), [
            "Outcomes for legacy monitoring inspections", "Category of concern", "Safeguarding standards",
            "Inclusion", "Achievement"])

    def test_values_keep_grades_and_words_and_drop_not_applicable(self):
        self.assertEqual(history.judgement_value("2"), 2)
        self.assertEqual(history.judgement_value(1.0), 1)
        self.assertEqual(history.judgement_value("Strong standard"), "Strong standard")
        self.assertEqual(history.judgement_value("School  remains Good"), "School remains Good")
        for empty in ("", "NULL", "8", "9", None, 9):
            self.assertIsNone(history.judgement_value(empty))

    def test_dates_from_csv_text_excel_cells_and_serials(self):
        self.assertEqual(history.parse_date("14/11/2023"), date(2023, 11, 14))
        self.assertEqual(history.parse_date("2012-03-13 00:00:00"), date(2012, 3, 13))
        self.assertEqual(history.parse_date(38607), date(2005, 9, 12))
        self.assertIsNone(history.parse_date("NULL"))

    def test_frameworks_are_kept_apart(self):
        self.assertEqual(history.framework(date(2012, 3, 13), {}), "pre-2015")
        self.assertEqual(history.framework(date(2017, 1, 31), {}), "cif-2015")
        self.assertEqual(history.framework(date(2023, 11, 14), {}), "eif-2019")
        self.assertEqual(history.framework(date(2025, 6, 3), {}), "eif-2024-no-overall")
        self.assertEqual(history.framework(date(2025, 11, 11), {}), "report-card-2025")
        self.assertEqual(history.framework(None, {"Inclusion": "Strong standard"}), "report-card-2025")

    def test_report_cards_have_no_overall_grade(self):
        card = row(start=date(2026, 6, 9), overall="Strong standard", judgements={"Inclusion": "Strong standard"})
        self.assertIsNone(card["overall"])
        self.assertEqual(card["judgements"], {"Inclusion": "Strong standard"})
        self.assertEqual(row(overall="2")["overall"], 2)

    def test_rows_without_a_urn_or_any_identity_are_skipped(self):
        self.assertIsNone(row(urn="NULL"))
        self.assertIsNone(history.inspection("101912", "NULL", None, None, None, None, {}, "src-a"))


class MergeTests(unittest.TestCase):
    def test_one_row_per_inspection_number_and_the_later_file_wins(self):
        merged = history.merge([[row(release="src-old"), None], [row(overall="2", release="src-new")]])
        self.assertEqual(list(merged), ["10289825"])
        self.assertEqual(merged["10289825"]["source_release_id"], "src-new")

    def test_without_a_number_the_urn_and_start_date_are_the_key(self):
        merged = history.merge([[row(number=""), row(number="", start=date(2012, 3, 13))]])
        self.assertEqual(sorted(merged), ["101912:2012-03-13", "101912:2023-11-14"])

    def test_predecessor_rows_map_to_the_current_school_and_others_are_reported(self):
        merged = history.merge([[row(urn="100001", number="1"), row(urn="999999", number="2")]])
        loaded, unmapped = history.resolve(merged, FakeResolver({"100001": "140000"}))
        self.assertEqual([(r["urn"], r["inspected_urn"]) for r in loaded], [("140000", "100001")])
        self.assertEqual(loaded[0]["report_url"], "https://reports.ofsted.gov.uk/provider/21/100001")
        self.assertEqual([r["inspected_urn"] for r in unmapped], ["999999"])


class LoaderShapeTests(unittest.TestCase):
    def test_loaded_columns_exist_in_the_table_and_text_is_left_alone(self):
        body = MIGRATION.split("CREATE TABLE IF NOT EXISTS school_inspection (", 1)[1].split(");", 1)[0]
        for column in history.COLUMNS:
            self.assertRegex(body, rf"\n\s+{column} ")
        for kept in ("improve_text", "key_findings", "text_extracted_at"):
            self.assertNotIn(kept, history.COLUMNS)

    def test_every_source_is_an_ofsted_gov_uk_attachment_with_its_own_release(self):
        ids = [release for release, *_ in history.SOURCES]
        self.assertEqual(len(ids), len(set(ids)))
        for release, url, released, caveat in history.SOURCES:
            self.assertTrue(url.startswith("https://assets.publishing.service.gov.uk/media/"), url)
            self.assertTrue(release.startswith("src-ofsted-"))
            date.fromisoformat(released)
            self.assertTrue(caveat)


RAW = Path(os.path.expanduser("~/data/ofsted-history"))


@unittest.skipUnless(list(RAW.glob("*/*2005_to_31_August_2015.xlsx")), "raw Ofsted files not downloaded")
class ReferenceSchoolTests(unittest.TestCase):
    """Inspections checked by hand on reports.ofsted.gov.uk."""

    @classmethod
    def setUpClass(cls):
        batches = [history.history_rows(history.local_path(url), release) for release, url, _, _ in history.SOURCES
                   if any(year in release for year in ("2005-2015", "2015-2019", "2021-22", "2022-23", "2023-24"))]
        merged = history.merge(batches).values()
        cls.by_urn = {}
        for inspection in merged:
            cls.by_urn.setdefault(inspection["inspected_urn"], {})[str(inspection["start_date"])] = inspection

    def test_montpelier(self):
        montpelier = self.by_urn["101912"]
        self.assertEqual((montpelier["2012-03-13"]["overall"], montpelier["2012-03-13"]["framework"]), (1, "pre-2015"))
        latest = montpelier["2023-11-14"]
        self.assertEqual((latest["overall"], latest["framework"]), (2, "eif-2019"))
        self.assertEqual(latest["judgements"]["Quality of education"], 1)
        self.assertEqual(latest["judgements"]["Behaviour and attitudes"], 1)

    def test_north_ealing(self):
        north = self.by_urn["101870"]
        self.assertEqual(north["2011-09-20"]["overall"], 2)
        self.assertEqual(north["2017-01-31"]["inspection_type"], "Maintained Academy and School Short inspection")
        self.assertIsNone(north["2017-01-31"]["overall"])
        ungraded = north["2022-01-25"]
        self.assertIsNone(ungraded["overall"])
        self.assertEqual(ungraded["judgements"]["Outcomes for ungraded and monitoring inspections"],
                         "School remains Good")

    def test_southfield(self):
        self.assertEqual(self.by_urn["101890"]["2023-05-24"]["overall"], 1)


def latest_row(**values):
    base = {"URN": "101912", "Web Link (opens in new window)": "NULL",
            "Latest OEIF overall effectiveness": "2", "Publication date of latest OEIF graded inspection": "18/01/2024",
            "Latest OEIF quality of education": "1", "Latest OEIF behaviour and attitudes": "1",
            "Latest OEIF personal development": "2", "Latest OEIF effectiveness of leadership and management": "2",
            "Latest OEIF early years provision (where applicable)": "2",
            "Latest OEIF sixth form provision (where applicable)": "9",
            "Latest OEIF  safeguarding is effective?": "Yes", "Latest OEIF category of concern": ""}
    return {**base, **values}


class SchoolAttributeJudgementTests(unittest.TestCase):
    def measures(self, row):
        return [(o["measure"], o["value"]) for o in etl_schools.observations(row, "src-x")]

    def test_sub_judgements_are_kept_after_the_overall_grade(self):
        self.assertEqual(self.measures(latest_row()), [
            ("Overall effectiveness", "Good"), ("Quality of education", "Outstanding"),
            ("Behaviour and attitudes", "Outstanding"), ("Personal development", "Good"),
            ("Leadership and management", "Good"), ("Early years provision", "Good"),
            ("Safeguarding is effective", "Yes")])

    def test_without_an_overall_grade_quality_of_education_still_comes_first(self):
        measures = self.measures(latest_row(**{"Latest OEIF overall effectiveness": "Not judged",
                                               "Latest OEIF category of concern": "SM"}))
        self.assertEqual(measures[0], ("Quality of education", "Outstanding"))
        self.assertIn(("Category of concern", "Special measures"), measures)

    def test_rewriting_inspections_keeps_performance(self):
        attributes = {"pupils": 400, "observations": [{"kind": "inspection-legacy", "measure": "Old"},
                                                      {"kind": "performance", "measure": "Attainment 8"}]}
        updated = etl_schools.with_inspections(attributes, [{"kind": "inspection-legacy", "measure": "New"}])
        self.assertEqual([o["measure"] for o in updated["observations"]], ["New", "Attainment 8"])
        self.assertEqual(updated["pupils"], 400)


if __name__ == "__main__":
    unittest.main()
