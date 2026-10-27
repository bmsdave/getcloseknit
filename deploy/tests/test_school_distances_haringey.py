"""Haringey (309) adapter on excerpts of the 2026 'How offers were made' PDFs."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipelines/area-analytics-ingest"))

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "school_distances"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text()


from area_analytics.school_admissions.adapters import haringey  # noqa: E402


class HaringeyTests(unittest.TestCase):
    def test_primary_table_bands_and_all_offered_list(self):
        got = {(o.school, o.rule): o for o in haringey.parse_text([fixture("haringey-primary-2026.txt")])}
        belmont = got[("Belmont Inf", None)]
        self.assertEqual((belmont.raw_value, belmont.applicants), ("0.216", 204))
        self.assertEqual(got[("Eden", "Faith")].raw_value, "1.764")
        self.assertEqual(got[("Eden", "Distance")].raw_value, "1.128")
        self.assertTrue(got[("Alexandra", None)].all_offered)
        self.assertTrue(got[("St Paul's and All Hallows CE Inf", None)].all_offered)

    def test_secondary_banded_school_named_in_its_header(self):
        got = {(o.school, o.rule): o.raw_value for o in haringey.parse_text([fixture("haringey-secondary-2026.txt")])}
        self.assertEqual(got[("Alexandra Park", None)], "0.477")
        self.assertEqual(got[("Harris Academy Tottenham", "Band 1")], "0.209")
        self.assertEqual(got[("Harris Academy Tottenham", "Band 6")], "All offered")


if __name__ == "__main__":
    unittest.main()
