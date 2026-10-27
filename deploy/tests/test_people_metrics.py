"""Deprivation, income and social renting for England: the London load's rules, ranked within regions."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import etl_people_metrics as pm  # noqa: E402

MIGRATION = (ROOT / "migrations" / "107-england-people.sql").read_text()


class RuleTests(unittest.TestCase):
    def test_percentile_is_the_share_at_or_below(self):
        # 4 areas: 1 -> 1/4, the two 2s -> 3/4, 9 -> 4/4.
        self.assertEqual(pm.cume_percentiles({"a": 1, "b": 2, "c": 2, "d": 9}),
                         {"a": 25, "b": 75, "c": 75, "d": 100})

    def test_percentiles_rank_within_the_region(self):
        regions = {"uk:lsoa:L1": "E12000007", "uk:lsoa:L2": "E12000007", "uk:lsoa:N1": "E12000001",
                   "uk:lsoa:N2": "E12000001"}
        rows = pm.metric_rows({"uk:lsoa:L1": 1, "uk:lsoa:L2": 9, "uk:lsoa:N1": 5, "uk:lsoa:N2": 3,
                               "uk:lsoa:W1": 2}, regions)
        self.assertEqual(rows, [("uk:lsoa:L1", 1, 50), ("uk:lsoa:L2", 9, 100), ("uk:lsoa:N1", 5, 100),
                                ("uk:lsoa:N2", 3, 50)])  # W1 (no region: outside the coverage) is left out

    def test_imd_sheet_gives_the_decile(self):
        rows = [("LSOA code (2021)", "LSOA name (2021)", "Local Authority District code (2024)",
                 "Local Authority District name (2024)", "Index of Multiple Deprivation (IMD) Rank (where 1 is most deprived)",
                 "Index of Multiple Deprivation (IMD) Decile (where 1 is most deprived 10% of LSOAs)"),
                ("E01000001", "City of London 001A", "E09000001", "City of London", 26525, 8)]
        self.assertEqual(pm.imd_deciles(rows), {"E01000001": 8.0})

    def test_income_is_the_total_annual_household_income(self):
        rows = [("Total annual household income by MSOA",), ("MSOA code", "MSOA name", "Local authority code",
                 "Local authority name", "Region code", "Region name", "Total annual income (£)"),
                ("E02002483", "Hartlepool 001", "E06000001", "Hartlepool", "E12000001", "North East", 50689)]
        self.assertEqual(pm.msoa_incomes(rows), {"E02002483": 50689.0})

    def test_social_renting_is_council_plus_other_social_one_decimal(self):
        counts = {"uk:lsoa:A": {"council": 10, "other-social": 3, "private-rent": 20, "owned-outright": 67},
                  "uk:lsoa:B": {"council": 0, "other-social": 0}}
        self.assertEqual(pm.social_shares(counts), {"uk:lsoa:A": 13.0})

    def test_national_releases_replace_the_london_ones(self):
        self.assertEqual({metric: old for metric, (old, _p, _c) in pm.METRICS.items()},
                         {"deprivation": "src-mhclg-imd-2025", "income": "src-ons-income-fye2023",
                          "social-renting": "src-ons-census-tenure-2021"})
        self.assertEqual(pm.SUFFIX, "-england")


class MigrationTests(unittest.TestCase):
    def test_107_keeps_london_count_londons_and_adds_region_counts(self):
        self.assertIn("CREATE TABLE IF NOT EXISTS census_region_count", MIGRATION)
        self.assertIn("WHERE region_code = 'E12000007'", MIGRATION)
        self.assertIn("JOIN area_region r ON r.area_id = g.id", MIGRATION)


if __name__ == "__main__":
    unittest.main()
