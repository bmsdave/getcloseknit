"""Barnet (302) adapter: pdfplumber rows of the VA and community tables, and the 2019 booklet text."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipelines/area-analytics-ingest"))

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "school_distances"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text()


from area_analytics.school_admissions.adapters import barnet  # noqa: E402

VA = [["Akiva Jewish", "60", "161", "", "", "Meets top faith priority (0.648)"],
      ["All Saints' CE School (NW2)", "30", "57", "", "", "Demand met"],
      ["Rimon Jewish", "30", "96", "", "", "GG Synagogue attendance level 1 (1.372)"],
      ["", "", "", "", "", "Straight-line distance (0.386)"],
      ["Beis Yaakov Jewish", "58", "65", "", "", "Other Orthodox Jewish girls (lottery)"]]
COMMUNITY = [["Barnfield Primary", "60", "162", "18", "All", "", "0.951", ""],
             ["Colindale Primary", "90", "264", "43", "0.404", "", "None", ""]]
SECONDARY = [["Archer Academy (The)", "162", "Siblings", "50", ""],
             ["", "", "N2 Priority Postcode", "44", "0.408"],
             ["", "", "N3 Priority Postcode", "33", "1.018"],
             ["Friern Barnet School", "150", "Siblings", "20", ""],
             ["", "", "Geographical Distance", "56", "(All offered)"]]
HEADER = ["Name of School", "Places available", "Criteria", "Places offered", "Furthest distance offered (Miles)"]


class BarnetTests(unittest.TestCase):
    def test_va_criterion_distance_demand_met_and_second_allocation(self):
        got = {(o.school, o.rule): o for o in barnet.va(VA, [], 1, [VA])}
        self.assertEqual(got[("Akiva Jewish", None)].raw_value, "0.648")
        self.assertEqual(got[("Akiva Jewish", None)].applicants, 161)
        self.assertTrue(got[("All Saints' CE School (NW2)", None)].all_offered)
        self.assertEqual(got[("Rimon Jewish", "Straight-line distance")].raw_value, "0.386")
        self.assertEqual(got[("Rimon Jewish", "GG Synagogue attendance level 1")].raw_value, "1.372")
        self.assertEqual(got[("Beis Yaakov Jewish", None)].raw_value, "")  # lottery: no distance

    def test_community_defined_area_columns(self):
        offers = barnet.community(COMMUNITY, [], 3, [COMMUNITY])
        got = {(o.school, o.rule): (o.raw_value, o.all_offered) for o in offers}
        self.assertEqual(got[("Barnfield Primary", "defined area")], ("", True))
        self.assertEqual(got[("Barnfield Primary", "outside defined area")], ("0.951", None))
        self.assertEqual(got[("Colindale Primary", "outside defined area")], ("", False))

    def test_secondary_distance_criteria_are_rules(self):
        got = {(o.school, o.rule): o.raw_value for o in barnet.secondary(SECONDARY, HEADER, 2, [SECONDARY])}
        self.assertEqual(got[("Archer Academy (The)", "N2 Priority Postcode")], "0.408")
        self.assertEqual(got[("Friern Barnet School", None)], "(All offered)")

    def test_2019_booklet_text_tables(self):
        offers = barnet.parse_text([fixture("barnet-primary-2019.txt")], 2019)
        got = {(o.school, o.rule): (o.raw_value, o.all_offered) for o in offers}
        self.assertEqual(got[("Barnfield Primary", "outside defined area")], ("0.639", None))
        self.assertEqual(got[("Bell Lane Primary", "outside defined area")], ("", True))


if __name__ == "__main__":
    unittest.main()
