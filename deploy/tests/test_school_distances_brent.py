"""Brent (304) adapter on excerpts of the 2026 reception and 2019 secondary PDFs."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipelines/area-analytics-ingest"))

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "school_distances"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text()


from area_analytics.school_admissions.adapters import brent  # noqa: E402


class BrentTests(unittest.TestCase):
    def test_primary_school_rows_and_criteria_with_distances(self):
        offers = brent.parse_text(fixture("brent-primary-2026.txt").split("\f"), "primary")
        got = {(o.school, o.rule): o for o in offers}
        anson = got[("Anson Primary School", None)]
        self.assertEqual((anson.raw_value, anson.applicants, anson.offers), ("Undersubscribed", 168, 55))
        self.assertNotIn(("Anson Primary School", "Sibling"), got)  # undersubscribed: no cut-off
        self.assertEqual(got[("Ark Academy", "Distance")].raw_value, "490.03")
        self.assertEqual(got[("Ark Academy", "Sibling")].raw_value, "5212.34")
        self.assertEqual((got[("Ark Academy", None)].applicants, got[("Ark Academy", None)].offers), (314, 60))
        self.assertFalse([o for o in got.values() if o.raw_value == "999999"])

    def test_secondary_2019_count_with_distance_in_brackets(self):
        offers = brent.parse_text(fixture("brent-secondary-2019.txt").split("\f"), "secondary")
        got = {(o.school, o.rule): o.raw_value for o in offers}
        self.assertEqual(got[("Alperton Community School", "Distance")], "1988.86")
        self.assertEqual(got[("Alperton Community School", "Feeder School")], "6996.46")
        self.assertEqual(got[("Ark Academy", "Zone A")], "593.86")


if __name__ == "__main__":
    unittest.main()
