import os
import unittest
from unittest import mock

from area_analytics import coverage, geography


class CoverageTests(unittest.TestCase):
    def test_england_has_every_lad_in_one_of_nine_regions(self):
        self.assertEqual(len(coverage.LADS), 296)
        self.assertEqual(len(coverage.REGIONS), 9)
        self.assertTrue(all(code[:3] in coverage.LAD_PREFIXES for code in coverage.LADS))
        self.assertTrue(all(region in coverage.REGIONS for _, region in coverage.LADS.values()))
        self.assertEqual(coverage.region_name(coverage.LONDON_REGION), "London")

    def test_london_is_the_33_e09_boroughs(self):
        self.assertEqual(len(coverage.LONDON_BOROUGH_CODES), 33)
        self.assertTrue(all(code.startswith("E09") for code in coverage.LONDON_BOROUGH_CODES))
        self.assertEqual(coverage.LONDON.lad_codes, coverage.LONDON_BOROUGH_CODES)
        self.assertEqual(geography.LONDON_BOROUGH_CODES, coverage.LONDON_BOROUGH_CODES)

    def test_lookup_nests_lsoas_in_msoas_in_lads(self):
        lookup = coverage.lsoa_lookup()
        self.assertEqual(len(lookup), 33755)
        self.assertEqual(len(coverage.msoa_lookup()), 6856)
        self.assertEqual(sum(1 for _, lad in lookup.values() if lad.startswith("E09")), 4994)
        self.assertEqual(lookup["E01000001"], ("E02000001", "E09000001"))
        self.assertEqual(coverage.region_of_code("uk:lsoa:E01000001"), "E12000007")
        self.assertEqual(coverage.region_of_code("E08000003"), "E12000002")  # Manchester
        self.assertIsNone(coverage.region_of_code("W01000001"))

    def test_boxes(self):
        self.assertTrue(coverage.ENGLAND.contains_point(-2.24, 53.48))  # Manchester
        self.assertFalse(coverage.LONDON.contains_point(-2.24, 53.48))
        self.assertTrue(coverage.LONDON.contains_bng(530_000, 180_000))
        self.assertTrue(coverage.ENGLAND.contains_bng(383_000, 398_000))

    def test_from_env_defaults_to_england(self):
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_ETL_COVERAGE": "london"}):
            self.assertIs(coverage.from_env(), coverage.LONDON)
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("CLOSE_KNIT_ETL_COVERAGE", None)
            self.assertIs(coverage.from_env(), coverage.ENGLAND)
        with self.assertRaises(ValueError):
            coverage.get("wales")

    def test_regional_percentiles_rank_within_each_region(self):
        values = {"a": 1.0, "b": 2.0, "c": 3.0, "x": 10.0, "y": 20.0, "z": None}
        regions = {"a": "E12000007", "b": "E12000007", "c": "E12000007", "x": "E12000002", "y": "E12000002"}
        self.assertEqual(coverage.regional_percentiles(values, regions),
                         {"a": 0, "b": 50, "c": 100, "x": 0, "y": 100})
        # One region (or none known) gives the plain percentiles: London-only runs do not change.
        london = {"a": 1.0, "b": 2.0, "c": 2.0, "d": 5.0}
        self.assertEqual(coverage.regional_percentiles(london, lambda _key: None),
                         coverage.competition_percentiles(london))



class CurrentLadTests(unittest.TestCase):
    def test_outdated_council_codes_resolve_by_name_within_the_region(self):
        self.assertEqual(coverage.current_lad("E09000007"), "E09000007")
        self.assertEqual(coverage.current_lad("E08000016", "Barnsley Metropolitan Borough Council", "E12000003"),
                         "E08000038")
        self.assertEqual(coverage.current_lad("E08000019", "Sheffield City Council"), "E08000039")
        self.assertIsNone(coverage.current_lad("E08000016", "Barnsley Metropolitan Borough Council", "E12000007"))
        self.assertIsNone(coverage.current_lad("W06000015", "Cardiff Council"))
        self.assertIsNone(coverage.current_lad(None))


if __name__ == "__main__":
    unittest.main()
