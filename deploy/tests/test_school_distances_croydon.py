"""Croydon (306) adapter: allocation XLSX rows, the prospectus overview and the secondary overview."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipelines/area-analytics-ingest"))

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "school_distances"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text()


from area_analytics.school_admissions.adapters import croydon  # noqa: E402

XLSX = [["Reception 2026                                 16/04/2026", "", "", ""],
        ["", "How places were allocated at oversubscribed Croydon Primary and Infant Schools", "", ""],
        ["School DfE Number", "School", "Pupil Admission Number", "Number of Offers made", "Sibling",
         "Distance criterion (Direct line measurement)", "", "Max\nDistance offered (miles)"],
        ["306 5202", "Atwood Primary School", "60", "60", "18", "41", "", "2.445"],
        ["306 2114", "Cypress Primary School", "90", "91**", "47", "34", "", "0.358"]]


class CroydonTests(unittest.TestCase):
    def test_xlsx_rows(self):
        got = {o.school: (o.raw_value, o.offers) for o in croydon.parse_xlsx(XLSX, 2026)}
        self.assertEqual(got, {"Atwood Primary School": ("2.445", 60), "Cypress Primary School": ("0.358", 91)})
        with self.assertRaises(ValueError):
            croydon.parse_xlsx(XLSX, 2025)

    def test_overview_columns_from_config_and_wrapped_names(self):
        pages = [fixture("croydon-primary-2025.txt")]
        got = {o.school: (o.raw_value, o.applicants) for o in croydon.parse_overview(pages, 2025, [2023, 2024, 2025])}
        self.assertEqual(got["Aerodrome Primary Academy"], ("0.848", 221))
        self.assertEqual(got["Applegarth Academy"][0], "4.521")  # trust suffix dropped
        self.assertEqual(got["David Livingstone Academy"][0], "0.988")  # name printed around the row
        old = {o.school: o.raw_value for o in croydon.parse_overview(pages, 2023, [2023, 2024, 2025])}
        self.assertEqual(old["Aerodrome Primary Academy"], "2.315")
        with self.assertRaises(ValueError):
            croydon.parse_overview(pages, 2025, [2022, 2023, 2024])

    def test_secondary_overview_last_cell(self):
        got = {o.school: o.raw_value for o in croydon.parse_secondary([fixture("croydon-secondary-2023.txt")], 2023)}
        self.assertEqual(got["Archbishop Tenison's"], "1.021")
        self.assertEqual(got["Coloma Girls' Convent"], "N/A")
        self.assertEqual(got["Harris City Academy Crystal Palace"], "N/A")


if __name__ == "__main__":
    unittest.main()
