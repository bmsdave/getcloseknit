"""Parent View, workforce, finance and destinations loaders (migration 056)."""
import os
import sys
import tempfile
import unittest
import zipfile
from datetime import date
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import etl_school_destinations as destinations  # noqa: E402
import etl_school_finance as finance  # noqa: E402
import etl_school_parent_view as parent_view  # noqa: E402
import etl_school_workforce as workforce  # noqa: E402

TITLE = ("School Level Data: submissions made to Ofsted Parent View, between {start} and 6 April 2026 for "
         "independent schools and maintained schools and academies in England with at least 10 submissions")
HEADER = ["URN", "School Name", "Local Authority", "Ofsted region", "Ofsted Phase or Type of Education",
          "Submissions", "Response Rate",
          "Q1. My child is happy at this school: Strongly agree %", "Q1. My child is happy at this school: Agree %",
          "Q1. My child is happy at this school: Disagree %",
          "Q5b. The school gives them the support they need to succeed: Strongly agree %",
          "Q10. Would you recommend this school to another parent?: Yes %",
          "Q10. Would you recommend this school to another parent?: No %"]


def ods(path: str, rows: list[list[str]]) -> None:
    """A minimal ODS with the rows in sheet Table_3 (numbers as office:value, like Ofsted's file)."""
    def cell(value):
        try:
            float(value)
            return f'<table:table-cell office:value-type="float" office:value="{value}"><text:p>{value}</text:p></table:table-cell>'
        except ValueError:
            return f'<table:table-cell office:value-type="string"><text:p>{escape(value)}</text:p></table:table-cell>'
    body = "".join("<table:table-row>" + "".join(cell(v) for v in row) + "</table:table-row>" for row in rows)
    content = ('<?xml version="1.0" encoding="UTF-8"?><office:document-content '
               'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
               'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" '
               'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:spreadsheet>'
               '<table:table table:name="Notes"><table:table-row><table:table-cell><text:p>x</text:p>'
               '</table:table-cell></table:table-row></table:table>'
               f'<table:table table:name="Table_3">{body}</table:table></office:spreadsheet></office:body>'
               '</office:document-content>')
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("content.xml", content)


class ParentViewTests(unittest.TestCase):
    def rows(self, start="10 November 2025"):
        return [[TITLE.format(start=start)], HEADER,
                ["100025", "Gospel Oak", "Camden", "London", "Primary", "122", "28.77", "75.409836065573799",
                 "20.4918", "0.8197", "[w]", "95.08", "4.92"],
                ["100033", "Small", "Camden", "London", "Primary", "9", "5", "50", "50", "0", "[z]", "100", "0"],
                ["100044", "Odd cell", "Camden", "London", "Primary", "10", "5", "1[w][w]", "40", "0", "[w]", "90",
                 "10"]]

    def test_reads_table_3_from_the_ods_and_keeps_printed_percentages(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "pv.ods")
            ods(path, self.rows())
            start, as_at, records = parent_view.parse(parent_view.ods_rows(path, "Table_3"))
        self.assertEqual((start, as_at), (date(2025, 11, 10), date(2026, 4, 6)))
        first = records[0]
        self.assertEqual((first["urn"], first["submissions"], first["response_rate"]), ("100025", 122, 28.77))
        self.assertEqual(first["answers"]["Q1"], {"question": "My child is happy at this school",
                                                  "options": {"Strongly agree": 75.41, "Agree": 20.49,
                                                              "Disagree": 0.82}})
        self.assertNotIn("Q5b", first["answers"])  # [w]: nobody answered
        self.assertEqual(first["answers"]["Q10"]["options"], {"Yes": 95.08, "No": 4.92})

    def test_under_ten_submissions_and_malformed_cells_are_not_figures(self):
        _, _, records = parent_view.parse(iter(self.rows()))
        self.assertEqual([r["urn"] for r in records], ["100025", "100044"])
        self.assertEqual(records[1]["answers"]["Q1"]["options"], {"Agree": 40.0, "Disagree": 0.0})

    def test_a_release_with_answers_to_the_old_questions_is_refused(self):
        with self.assertRaises(SystemExit):
            parent_view.parse(iter(self.rows(start="8 September 2025")))


EARLIER_TITLE = ("School Level Data: submissions made to Ofsted Parent View, between {start} and {end}, for "
                 "independent schools and maintained schools and academies in England")
QUESTIONS = [["Q1. My child is happy at this school."], ["Q14. I would recommend this school to another parent"],
             ["Q1. My child is happy at this school."]]  # Table 1b repeats the questions: 1a wins


class EarlierParentViewTests(unittest.TestCase):
    def test_2025_columns_take_question_texts_from_table_1(self):
        rows = [[EARLIER_TITLE.format(start="3 September 2024", end="1 September 2025")],
                ["URN", "School Name", "Local Authority", "Ofsted Region", "Phase", "Submissions", "Response Rate",
                 "Q1 Strongly Agree%", "Q1 Agree%", "Q1 Don't Know%", "Q14 Yes%", "Q14 No%"],
                ["101912", "Hathaway", "Ealing", "London", "Primary", "226", "NULL", "80.0884955752212", "18.58",
                 "0", "98.67", "1.33"]]
        questions = parent_view.question_texts(iter(QUESTIONS))
        self.assertEqual(questions["Q1"], "My child is happy at this school")
        start, as_at, records = parent_view.parse(iter(rows), questions)
        self.assertEqual((start, as_at), (date(2024, 9, 3), date(2025, 9, 1)))
        self.assertIsNone(records[0]["response_rate"])
        self.assertEqual(records[0]["answers"]["Q1"], {"question": "My child is happy at this school", "options": {
            "Strongly agree": 80.09, "Agree": 18.58, "Don't know": 0.0}})
        self.assertEqual(records[0]["answers"]["Q14"]["options"], {"Yes": 98.67, "No": 1.33})

    def test_2024_columns_carry_the_question_and_capitalised_options(self):
        rows = [[EARLIER_TITLE.format(start="4 September 2023", end="2 September 2024")],
                ["URN", "School Name", "Local Authority", "Ofsted Region", "Phase", "Submissions", "Response Rate %",
                 "Q1. My child is happy at this school: Strongly Agree %",
                 "Q1. My child is happy at this school: Don't Know %"],
                ["101916", "Mount Carmel", "Ealing", "London", "Primary", "41", "9.0308369999999999E-2", "48.78", "0"]]
        _, _, records = parent_view.parse(iter(rows), {}, rate_fraction=True)
        self.assertEqual(records[0]["answers"]["Q1"]["options"], {"Strongly agree": 48.78, "Don't know": 0.0})
        # This release prints the response rate as a fraction: stored as a percentage like the others.
        self.assertEqual(records[0]["response_rate"], 9.03)
        self.assertEqual([r.get("rate_fraction", False) for r in parent_view.EARLIER_RELEASES], [False, True])
        rows[2][6] = "9.5"
        with self.assertRaises(SystemExit):
            parent_view.parse(iter(rows), {}, rate_fraction=True)

    def test_a_release_running_past_the_survey_change_is_not_the_earlier_survey(self):
        rows = [[EARLIER_TITLE.format(start="3 September 2025", end="5 January 2026")], ["URN"]]
        with self.assertRaises(SystemExit):
            parent_view.parse(iter(rows), {"Q1": "My child is happy at this school"})

    def test_an_unknown_earlier_column_is_refused(self):
        rows = [[EARLIER_TITLE.format(start="3 September 2024", end="1 September 2025")],
                ["URN", "Submissions", "Response Rate", "Q99 Strongly Agree%"]]
        with self.assertRaises(SystemExit):
            parent_view.parse(iter(rows), {"Q1": "My child is happy at this school"})

    def test_migration_060_keeps_one_row_per_school_and_survey(self):
        migration = (ROOT / "migrations" / "060-school-parent-view-earlier.sql").read_text()
        self.assertIn("PRIMARY KEY (urn, survey)", migration)
        self.assertIn("survey = 'pre-2025-11' AND as_at < DATE '2025-11-10'", migration)
        self.assertEqual([r["as_at"] for r in parent_view.EARLIER_RELEASES],
                         sorted((r["as_at"] for r in parent_view.EARLIER_RELEASES), reverse=True))


class WorkforceTests(unittest.TestCase):
    def test_latest_year_from_both_files_with_x_and_u_null(self):
        with tempfile.TemporaryDirectory() as folder:
            size, ratios = os.path.join(folder, "size.csv"), os.path.join(folder, "ratios.csv")
            Path(size).write_text(
                "﻿time_period,geographic_level,school_urn,fte_all_teachers,fte_teaching_assistants,"
                "fte_leadership_teachers,fte_all_support_staff,fte_workforce,hc_workforce,hc_all_teachers\n"
                "202425,School,101916,21.6,9.53,3,15.68,37.28,41,23\n"
                "202526,School,101916,21.6,8.8,4,13.61,35.21,41,23\n"
                "202526,School,999999,1,1,1,1,1,1,1\n")
            Path(ratios).write_text(
                "﻿time_period,geographic_level,school_urn,pupils_fte,pupil_to_qual_unqual_teacher_ratio,"
                "pupil_to_adult_ratio\n202526,School,101916,424.5,19.7,u\n")
            period = workforce.latest_period(ratios)
            schools = {"101916"}
            rows = workforce.records(workforce.read(size, period, workforce.SIZE_COLUMNS, schools),
                                     workforce.read(ratios, period, workforce.RATIO_COLUMNS, schools),
                                     workforce.academic_year(period))
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual((row["academic_year"], row["teachers_fte"], row["teaching_assistants_fte"],
                          row["workforce_headcount"], row["pupils_per_teacher"], row["pupils_per_adult"]),
                         ("2025/26", 21.6, 8.8, 41, 19.7, None))


def cfr(urn, laestab, **changes):
    row = {"URN": urn, "LAEstab": laestab, "Did Not Supply flag": "N", "Lead school in federation": 0,
           "Federated submission": "No", "Period covered by return": 12, **{k: 100 for k in finance.CFR_COLUMNS}}
    return {**row, **changes}


class FinanceTests(unittest.TestCase):
    def test_cfr_federation_lead_and_non_returning_school(self):
        rows = [cfr(101916, 3072186),
                cfr(100234, 2042450, **{"Federated submission": "Lead school", "Lead school in federation": 2042450}),
                cfr(100242, 2042564, **{"Federated submission": "Non returning school", "Did Not Supply flag": "Y",
                                        "Lead school in federation": 2042450,
                                        "Revenue Reserve: B01 + B02 + B06": "DNS"})]
        out = {r["urn"]: r for r in finance.cfr_records(rows, {"101916", "100234", "100242"})}
        self.assertEqual((out["101916"]["revenue_reserve"], out["101916"]["federation_lead_urn"]), (100, None))
        self.assertEqual(out["100234"]["federation_lead_urn"], "100234")
        self.assertEqual((out["100242"]["federation_lead_urn"], out["100242"]["revenue_reserve"],
                          out["100242"]["staff_costs"]), ("100234", None, None))
        self.assertTrue(out["100242"]["not_supplied_reason"])

    def test_aar_trust_reserve_and_academy_that_changed_trust(self):
        money = {k: 1000 for k in finance.AAR_COLUMNS}
        academies = [
            {"URN": 105135, "MAT SAT or Central Services": "Single Academy Trust (SAT)", "Company Number": 5210075,
             "Trust or Company Name": "OLD", "Date left or closed if in period": "2025-02-28", **money},
            {"URN": 105135, "MAT SAT or Central Services": "Multi Academy Trust (MAT)", "Company Number": 15116248,
             "Trust or Company Name": "NEW TRUST", "Date left or closed if in period": None,
             "Period covered by return": 6, **money},
            {"URN": 105136, "MAT SAT or Central Services": "Multi Academy Trust (MAT)", "Company Number": 15116248,
             "Trust or Company Name": "NEW TRUST", "Date left or closed if in period": None, **money,
             "Revenue Reserve": "NULL"},
        ]
        central = [{"Company Number": 15116248, "Sum of Trust + Academy Revenue Reserve": 2627000}]
        out = {r["urn"]: r for r in finance.aar_records(academies, central, {"105135", "105136"})}
        self.assertEqual((out["105135"]["trust_name"], out["105135"]["trust_kind"], out["105135"]["period_months"],
                          out["105135"]["trust_revenue_reserve"], out["105135"]["trust_academies"]),
                         ("NEW TRUST", "MAT", 6, 2627000, 2))
        self.assertIsNone(out["105136"]["revenue_reserve"])

    def test_finance_table_in_migration_056(self):
        migration = (ROOT / "migrations" / "056-school-card-extra.sql").read_text()
        for table in ("school_parent_view", "school_workforce", "school_finance", "school_destination"):
            self.assertIn(f"CREATE TABLE IF NOT EXISTS {table} (", migration)


def destination(period, urn, **changes):
    row = {"time_period": period, "school_urn": urn, "breakdown": "Total", "data_type": "Percentage",
           "version": "Provisional", "cohort_count": "104", "overall": "99", "education": "99", "appren": "0",
           "all_work": "0", "all_notsust": "1", "all_unknown": "0"}
    return {**row, **changes}


class DestinationTests(unittest.TestCase):
    def test_latest_cohort_all_students_and_suppressed_null(self):
        rows = [destination("202223", "138051", overall="90"), destination("202324", "138051"),
                destination("202324", "138051", breakdown="Female", overall="50"),
                destination("202324", "138051", data_type="Number of students", overall="103"),
                destination("202324", "137181", overall="c", cohort_count="c"),
                destination("202324", "999999")]
        resolve = {"138051": "138051", "137181": "137181"}.get
        out, unmatched = destinations.records(rows, "ks4", resolve)
        self.assertEqual(unmatched, 1)
        by_urn = {r["urn"]: r for r in out}
        self.assertEqual((by_urn["138051"]["cohort_year"], by_urn["138051"]["sustained_percent"],
                          by_urn["138051"]["cohort"]), ("2023/24", 99.0, 104))
        self.assertIsNone(by_urn["137181"]["sustained_percent"])
        self.assertIsNone(by_urn["137181"]["cohort"])

    def test_predecessor_figures_go_to_the_current_school_and_its_own_win(self):
        rows = [destination("202324", "100001", overall="80"), destination("202324", "138051")]
        out, _ = destinations.records(rows, "16-18", {"100001": "138051", "138051": "138051"}.get)
        self.assertEqual([(r["urn"], r["reported_urn"], r["sustained_percent"]) for r in out],
                         [("138051", "138051", 99.0)])
        rows = [destination("202324", "138051"), destination("202324", "100001", overall="80")]
        out, _ = destinations.records(rows, "16-18", {"100001": "138051", "138051": "138051"}.get)
        self.assertEqual(out[0]["reported_urn"], "138051")


if __name__ == "__main__":
    unittest.main()
