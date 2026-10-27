"""Bromley (305) adapter on an excerpt of the 2027-28 primary booklet's 'Distances and appeals' table."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipelines/area-analytics-ingest"))

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "school_distances"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text()


from area_analytics.school_admissions.adapters import bromley  # noqa: E402


class BromleyTests(unittest.TestCase):
    def test_year_columns_legend_and_juniors(self):
        pages = [fixture("bromley-primary-2027-booklet.txt")]
        y2026 = {o.school: o for o in bromley.parse_text(pages, 2026)}
        y2024 = {o.school: o for o in bromley.parse_text(pages, 2024)}
        self.assertEqual(y2026["Alexandra Infant School"].raw_value, "0.329")
        self.assertEqual(y2024["Alexandra Infant School"].raw_value, "0.409")
        self.assertTrue(y2026["Bickley Primary School"].all_offered)  # N/A: undersubscribed (legend)
        self.assertEqual(y2026["Alexandra Junior School"].entry_point, "year3")
        self.assertEqual(y2026["Alexandra Junior School"].raw_value, "0.717")
        chelsfield = y2026["Chelsfield Primary School"]
        self.assertEqual((chelsfield.raw_value, chelsfield.all_offered), ("N/A", True))

    def test_a_year_outside_the_table_is_refused(self):
        with self.assertRaises(ValueError):
            bromley.parse_text([fixture("bromley-primary-2027-booklet.txt")], 2023)


if __name__ == "__main__":
    unittest.main()
