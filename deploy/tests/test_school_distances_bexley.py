"""Bexley (303) adapter on the 2023-24 primary booklet's three-year distance table."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipelines/area-analytics-ingest"))

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "school_distances"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text()


from area_analytics.school_admissions.adapters import bexley  # noqa: E402


class BexleyTests(unittest.TestCase):
    def test_only_the_configured_year_column_is_read(self):
        pages = [fixture("bexley-primary-2023-booklet.txt")]
        y2022 = {o.school: (o.raw_value, o.all_offered) for o in bexley.parse_text(pages, 2022)}
        y2020 = {o.school: (o.raw_value, o.all_offered) for o in bexley.parse_text(pages, 2020)}
        self.assertEqual(y2022["Barnehurst Infant"], ("0.426 (TB)", None))
        self.assertEqual(y2020["Barnehurst Infant"], ("0.496", None))
        self.assertEqual(y2022["Barrington Primary"], ("", True))
        self.assertNotIn("Bishop Ridley CE Primary", y2020)  # 'See note'

    def test_a_year_outside_the_table_is_refused(self):
        with self.assertRaises(ValueError):
            bexley.parse_text([fixture("bexley-primary-2023-booklet.txt")], 2019)

    def test_secondary_is_not_read(self):
        with self.assertRaises(ValueError):
            bexley.parse({"phase": "secondary", "year": 2022}, [], {})


if __name__ == "__main__":
    unittest.main()
