"""Home theme (area-home.v1): can I extend, broadband and settledness, ranked against London."""
import unittest

from area_api import home

RESTRICTION = {"geography_id": "uk:lsoa:E01000842", "area_m2": 100_000.0, "conservation_m2": 60_000.0,
               "article4_m2": 30_000.0, "restricted_m2": 70_000.0, "share": 0.7, "listed_grade_i": 1,
               "listed_grade_ii_star": 0, "listed_grade_ii": 1203, "region_percentile": 91, "london_share": 0.2266,
               "article4_release_id": "src-a4", "listed_release_id": "src-he", "conservation_release_id": "src-gla"}
BROADBAND = {"geography_id": "uk:lsoa:E01000842", "premises": 795, "gigabit_premises": 794, "share": 0.9987,
             "region_percentile": 88, "london_share": 0.9121, "source_release_id": "src-ofcom"}
SETTLED = {"geography_id": "uk:lsoa:E01000842", "residents": 1409, "same_address": 1154, "share": 0.819,
           "region_percentile": 19, "london_share": 0.868, "source_release_id": "src-ts019"}
BOROUGH = {"id": "uk:lad:E09000007", "name": "Camden", "article4_areas": 21, "coverage_release_id": "src-a4",
           "full_fibre_share": 0.8596, "fibre_release_id": "src-ofcom"}


class Loaded:
    def __init__(self, **rows):
        self.rows = {"restriction": RESTRICTION, "broadband": BROADBAND, "settled": SETTLED, "borough": BOROUGH, **rows}

    def execute(self, sql, params=()):
        part = sql.split("\n", 1)[0].removeprefix("-- evidence:area-home-")
        row = self.rows[part]
        return [row] if row else []


class HomeValueTests(unittest.TestCase):
    def test_all_three_layers_with_london_context(self):
        value = home.home_value(Loaded(), "uk:lsoa:E01000842")
        self.assertEqual(value["extend"]["restrictedShare"], 0.7)
        self.assertEqual(value["extend"]["listed"], {"gradeI": 1, "gradeIIStar": 0, "gradeII": 1203, "total": 1204})
        self.assertEqual(value["extend"]["article4Data"], "published")
        self.assertEqual(value["broadband"]["boroughFullFibreShare"], 0.8596)
        self.assertEqual(value["settled"]["regionPercentile"], 19)
        self.assertEqual(value["sourceVersions"], ["src-a4", "src-gla", "src-he", "src-ofcom", "src-ts019"])
        self.assertEqual(value["notes"], [
            "70% of the land is in a conservation area or under Article 4: most extensions need planning permission there",
            "1,204 listed buildings (1 grade I or II*)",
            "Gigabit broadband available to 100% of homes (London 91%)",
            "82% of residents lived at the same address a year earlier (London 87%)",
        ])

    def test_unpublished_article4_is_said_never_read_as_none(self):
        borough = {**BOROUGH, "name": "Islington", "article4_areas": 0}
        value = home.home_value(Loaded(borough=borough, restriction={**RESTRICTION, "restricted_m2": 0.0, "share": 0.0,
                                                                     "listed_grade_i": 0, "listed_grade_ii": 0}),
                                "uk:lsoa:E01002718")
        self.assertEqual(value["extend"]["article4Data"], "not-published")
        self.assertIn("No conservation area or householder Article 4 direction mapped here", value["notes"])
        self.assertIn("Islington has not published Article 4 data: check the council's map", value["notes"])

    def test_outside_london_compares_with_the_region_and_unpublished_conservation_is_unknown(self):
        restriction = {**RESTRICTION, "region_code": "E12000002", "conservation_release_id": None,
                       "conservation_m2": 0.0}
        value = home.home_value(Loaded(restriction=restriction, broadband={**BROADBAND, "region_code": "E12000002"}),
                                "uk:lsoa:E01005000")
        self.assertEqual(value["rankScope"], {"code": "E12000002", "name": "North West"})
        self.assertIsNone(value["extend"]["conservationShare"])
        self.assertIn("Gigabit broadband available to 100% of homes (North West 91%)", value["notes"])
        self.assertEqual(value["sourceVersions"], ["src-a4", "src-he", "src-ofcom", "src-ts019"])
        for sql in (home.RESTRICTION_SQL, home.BROADBAND_SQL):
            self.assertIn("JOIN area_region rg ON rg.area_id = g.id", sql)

    def test_layers_load_independently(self):
        value = home.home_value(Loaded(restriction=None, broadband=None), "uk:lsoa:E01000842")
        self.assertIsNone(value["extend"])
        self.assertIsNone(value["broadband"])
        self.assertEqual(value["notes"], ["82% of residents lived at the same address a year earlier (London 87%)"])

    def test_nothing_loaded_is_none(self):
        self.assertIsNone(home.home_value(Loaded(restriction=None, broadband=None, settled=None), "uk:lsoa:E01000842"))

        class Missing:
            def execute(self, sql, params=()):
                raise RuntimeError("relation area_restriction does not exist")

        self.assertIsNone(home.home_value(Missing(), "uk:lsoa:E01000842"))


if __name__ == "__main__":
    unittest.main()
