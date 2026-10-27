"""Ofsted report text (etl_ofsted_reports.py): provider pages, matching, section extraction."""
import os
import sys
import unittest
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import etl_ofsted_history as history  # noqa: E402
import etl_ofsted_reports as reports  # noqa: E402

MIGRATION = (ROOT / "migrations" / "048-school-history.sql").read_text()
HISTORY = (ROOT / "tools" / "etl_ofsted_history.py").read_text()

TIMELINE = """
<li class="timeline__day "><div class="event"><p class="timeline__date"><time>14 November 2023</time></p>
<span class="event__title heading--sub"><a class="publication-link" target="_blank"
 href="https://files.ofsted.gov.uk/v1/file/50237544">School inspection: <strong>Good</strong>
<span class="nonvisual">School inspection, PDF - 19 January 2024</span></a><div class="event__metadata">
<span class="filetype">PDF</span> &ndash; Published <time pubdate>19 January 2024</time></div></span></div></li>
<li class="timeline__day "><div class="event"><p class="timeline__date"><time>13 March 2012</time></p>
<span class="event__title heading--sub"><a class="publication-link" target="_blank"
 href="https://files.ofsted.gov.uk/v1/file/1951165">Full inspection: <strong>Outstanding</strong>
<span class="nonvisual">Full inspection, PDF - 16 April 2012</span></a><div class="event__metadata">
Published <time pubdate>16 April 2012</time></div></span></div></li>
"""
# A report card page embeds its report escaped; the timeline puts the date inside the link.
REPORT_CARD = ("&lt;a class=&quot;publication-link&quot; target=&quot;_blank&quot; "
               "href=&quot;https://files.ofsted.gov.uk/v1/file/50312788&quot;&gt;"
               "&lt;time&gt;09 June 2026&lt;/time&gt;: "
               "School inspection: (&lt;span class=&quot;filetype&quot;&gt;PDF&lt;/span&gt;) &lt;span "
               "class=&quot;nonvisual&quot;&gt;School inspection, pdf - 18 September 2026&lt;/span&gt;&lt;/a&gt;"
               "&lt;div&gt;Published on &lt;time&gt;18 September 2026&lt;/time&gt;&lt;/div&gt;\n"
               '<a class="publication-link" target="_blank" href="https://files.ofsted.gov.uk/v1/file/50312788">'
               '<time>09 June 2026</time>: School inspection: (<span class="filetype">PDF</span>) '
               '<span class="nonvisual">School inspection, pdf - 18 September 2026</span></a>'
               '<div>Published on <time>18 September 2026</time></div>\n'
               '<a class="publication-link" target="_blank" href="https://files.ofsted.gov.uk/v1/file/50179450">'
               '<time>25 January 2022</time>: School inspection: (<span class="filetype">PDF</span>) '
               '<span class="nonvisual">School inspection, PDF - 17 March 2022</span></a>'
               '<div>Published on <time>17 March 2022</time></div>')


def pdf(file_id):
    path = reports.pdf_path(file_id)
    if not os.path.exists(path):
        raise unittest.SkipTest(f"{path} not fetched (run etl_ofsted_reports.py run)")
    return path


class ProviderPage(unittest.TestCase):
    def test_timeline_dates_come_from_before_the_link(self):
        found = reports.reports(TIMELINE)
        self.assertEqual([(r["file_id"], r["inspected"], r["published"], r["title"]) for r in found], [
            ("50237544", date(2023, 11, 14), date(2024, 1, 19), "School inspection"),
            ("1951165", date(2012, 3, 13), date(2012, 4, 16), "Full inspection"),
        ])

    def test_report_card_dates_come_from_inside_the_link_and_duplicates_collapse(self):
        found = reports.reports(REPORT_CARD)
        self.assertEqual([(r["file_id"], r["inspected"], r["published"]) for r in found], [
            ("50312788", date(2026, 6, 9), date(2026, 9, 18)),
            ("50179450", date(2022, 1, 25), date(2022, 3, 17)),
        ])
        self.assertEqual(found[0]["url"], "https://files.ofsted.gov.uk/v1/file/50312788")

    def test_match_is_by_start_date_and_never_guessed(self):
        found = reports.reports(TIMELINE)
        hit = reports.match({"start_date": date(2023, 11, 14), "publication_date": date(2024, 1, 18)}, found)
        self.assertEqual(hit["file_id"], "50237544")
        self.assertIsNone(reports.match({"start_date": date(2023, 11, 15), "publication_date": None}, found))
        twins = [dict(found[0], file_id="1", published=date(2024, 1, 19)),
                 dict(found[0], file_id="2", published=date(2024, 2, 1))]
        pick = reports.match({"start_date": date(2023, 11, 14), "publication_date": date(2024, 2, 1)}, twins)
        self.assertEqual(pick["file_id"], "2")
        self.assertIsNone(reports.match({"start_date": date(2023, 11, 14), "publication_date": None}, twins))


class Sections(unittest.TestCase):
    def test_section_needs_both_its_heading_and_an_end(self):
        text = "Intro\nWhat does the school need to do to improve?\n Do this\nand that.\nBackground\nx"
        self.assertEqual(reports.section(text, ("What does the school need to do to improve?",), ("Background",)),
                         "• Do this and that.")
        self.assertIsNone(reports.section(text, ("Key findings",), ("Background",)))
        self.assertIsNone(reports.section(text, ("What does the school need to do to improve?",), ("Nothing",)))

    def test_a_short_stop_heading_must_be_the_whole_line(self):
        text = "Main findings\nEvidence shows pupils learn well.\nEvidence\nmeetings were held"
        self.assertEqual(reports.section(text, ("Main findings",), ("evidence",)), "Evidence shows pupils learn well.")

    def test_footers_and_page_numbers_are_removed(self):
        text = ("pupils learn\nInspection report: Montpelier Primary School\n14 and 15 November 2023\n\n2\n\nwell."
                "\neasy.Inspection report: Southfield Primary School, 6−7 March 2014 2 of 9\nNext")
        cleaned = reports.clean(text)
        self.assertNotIn("Inspection report", cleaned)
        self.assertNotIn("November 2023", cleaned)
        self.assertEqual(" ".join(cleaned.split()), "pupils learn well. easy. Next")


class RealReports(unittest.TestCase):
    """The three reference schools' reports (files fetched by `run`)."""

    def test_eif_2019_montpelier_2023(self):
        key, improve = reports.extract(pdf("50237544"))
        self.assertTrue(key.startswith("The school sets high standards and ambitious aspirations"))
        self.assertTrue(key.endswith("to ensure that all pupils achieve strong outcomes."))
        self.assertEqual(improve.count("\n"), 0)
        self.assertTrue(improve.startswith("• Some curriculum thinking in the early years is not as ambitiously"))
        self.assertTrue(improve.endswith("skills and vocabulary cumulatively term by term."))
        self.assertNotIn("Information for the school", improve)

    def test_2014_two_column_summary_southfield(self):
        key, improve = reports.extract(pdf("2353969"))
        lines = key.split("\n")
        self.assertEqual(lines[0], "This is a good school.")
        self.assertTrue(lines[1].startswith("• Pupils’ achievement is good. They make good progress from"))
        self.assertIn("It is not yet an outstanding school because:", lines)
        self.assertTrue(key.endswith("tasks that are too easy."))
        self.assertTrue(improve.startswith("• Raise the quality of teaching to outstanding by making sure that"))

    def test_report_card_north_ealing_2026(self):
        key, improve = reports.extract(pdf("50312788"))
        self.assertTrue(key.startswith("Pupils have many opportunities to thrive and achieve."))
        self.assertIn("\n\nAchievement (Strong standard): Pupils typically attain above their peers", key)
        self.assertIn("\n\nCurriculum and teaching (Expected standard): Leaders have developed", key)
        self.assertIn("\n\nEarly years (Expected standard): Children in the early years", key)
        self.assertNotIn("Lead inspector", key)
        self.assertEqual(improve, "Leaders should continue to refine the curriculum and how it is taught to ensure "
                                  "the development of pupils' skills is consistently applied across all subjects.")

    def test_2012_and_2006_frameworks(self):
        key, improve = reports.extract(pdf("1951165"))
        self.assertTrue(key.startswith("This is an outstanding school and parents and carers"))
        self.assertTrue(improve.startswith("Enrich pupils’ learning experience by:"))
        self.assertNotIn("glossary", improve)
        key, improve = reports.extract(pdf("859177"))
        self.assertTrue(key.startswith("Montpelier is a good school."))
        self.assertEqual(improve.count("• "), 3)


class Schema(unittest.TestCase):
    def test_text_columns_exist(self):
        for column in ("report_url text", "improve_text text", "key_findings text", "text_extracted_at timestamptz"):
            self.assertIn(column, MIGRATION)

    def test_history_reload_keeps_the_matched_report_url(self):
        self.assertIn("report_url = CASE WHEN school_inspection.text_extracted_at IS NULL", HISTORY)
        self.assertIn("report_url", history.COLUMNS)


if __name__ == "__main__":
    unittest.main()
