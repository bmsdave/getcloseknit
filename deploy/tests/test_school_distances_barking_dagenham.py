"""Barking and Dagenham (301) adapter on the e-booklets' 'Statistical information' tables."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipelines/area-analytics-ingest"))

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "school_distances"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text()


def rows(offers):
    return [(o.school, o.rule, o.raw_value, o.all_offered) for o in offers]


from area_analytics.school_admissions.adapters import barking_dagenham as bd  # noqa: E402


class BarkingDagenhamTests(unittest.TestCase):
    def test_secondary_last_place_is_the_eighth_figure_and_only_decimals_count(self):
        table = bd.parse_table(fixture("barking_dagenham-secondary-2025.txt"), "secondary")
        got = {o.school: (o.raw_value, o.applicants) for o in table}
        self.assertEqual(got["Barking Abbey"], ("1.950", 1050))
        self.assertEqual(got["Dagenham Park"], ("N/A", 364))  # 'DagenhamPark' split
        self.assertEqual(got["Eastbury"][0], "")  # a bare 0 is not a distance
        self.assertEqual(got["All Saints"][0], "6.035")

    def test_primary_sites_wrapped_appeals_and_no_criteria(self):
        got = {(o.school, o.site): o for o in bd.parse_table(fixture("barking_dagenham-primary-2025.txt"), "primary")}
        self.assertEqual(got[("Becontree", "main")].raw_value, "0.900")
        self.assertEqual(got[("Manor", "Longbridge")].raw_value, "3.492")
        self.assertEqual(got[("Manor", "Sandringham")].raw_value, "-")
        self.assertEqual(got[("Thames View", "main")].raw_value, "-")  # page number glued to the last cell
        self.assertEqual(got[("St Joseph's (Bkg)", "main")].raw_value, "")
        self.assertEqual(got[("St Joseph's (Bkg)", "main")].applicants, 140)


if __name__ == "__main__":
    unittest.main()
