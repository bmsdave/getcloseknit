"""Ealing (307) high-school adapter on an excerpt of the 2025 'High school allocations' PDF."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipelines/area-analytics-ingest"))

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "school_distances"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text()


from area_analytics.school_admissions.adapters import ealing  # noqa: E402


class EalingSecondaryTests(unittest.TestCase):
    def test_criteria_rows_with_counts_and_all_offered_headings(self):
        offers = ealing.parse_secondary([fixture("ealing-secondary-2025.txt")])
        got = {(o.school, o.rule): o for o in offers}
        ada = got[("Ada Lovelace CE High School", "Distance")]
        self.assertEqual((ada.raw_value, ada.applicants, ada.offers, ada.refused), ("0.637 of a mile", 409, 100, 309))
        self.assertEqual(got[("Ada Lovelace CE High School", "Looked after/previously looked after")].raw_value,
                         "N/A - all offered")  # wrapped 'after' joined back
        self.assertEqual(got[("Alec Reed Academy", None)].raw_value, "All applicants offered")
        self.assertEqual(got[("Dormers Wells High School", "Distance")].raw_value, "1.604 miles")
        # the table printed without a heading after 'Ark Soane Academy: All applicants offered' is not read
        self.assertEqual([o.rule for o in offers if o.school == "Ark Soane Academy"], [None])
        self.assertFalse([o for o in offers if "town hall" in o.raw_value])


if __name__ == "__main__":
    unittest.main()
