"""Westminster (213) adapter on one 2027 primary brochure page ('How places were offered in 2026')."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipelines/area-analytics-ingest"))

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "school_distances"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text()


from area_analytics.school_admissions.adapters import westminster  # noqa: E402


class WestminsterTests(unittest.TestCase):
    def test_name_above_the_criteria_and_the_box_below(self):
        offers = westminster.parse_page(fixture("westminster-primary-2026.txt"), 21)
        self.assertEqual([(o.school, o.raw_value, o.applicants, o.rule) for o in offers],
                         [("Ark Atwood Primary Academy", "0.709 of a mile", 150, None)])

    def test_all_offered_box(self):
        page = ("HALLFIELD PRIMARY SCHOOL\nSUMMARISED ADMISSION CRITERIA*\n1. Looked After Children.\n"
                "HOW PLACES WERE OFFERED IN 2026\nTotal number of on-time applications submitted: 62\n"
                "All applicants were offered with no appeals lodged.\n*The admission criteria have been summarised.")
        offers = westminster.parse_page(page, 29)
        self.assertEqual([(o.school, o.raw_value, o.applicants) for o in offers],
                         [("Hallfield Primary School", "All applicants offered", 62)])


if __name__ == "__main__":
    unittest.main()
