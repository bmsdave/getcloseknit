"""Local market depth (migration 014): category A only, windows from the latest
sale, medians and the new-build premium withheld under 10 sales, leasehold as a
share of sales, rebuilt by every sales load and applied on first boot."""
import re
import sys
import unittest
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DEPLOY / "tools"))

MIGRATION = (DEPLOY / "migrations" / "014-market-depth.sql").read_text()
REBUILD = MIGRATION.split("FUNCTION public.rebuild_market_depth", 1)[1].split("$$;", 1)[0]


class MarketDepthMigrationTests(unittest.TestCase):
    def test_only_category_a_sales_count(self):
        self.assertIn("WHERE t.ppd_category = 'A'", REBUILD)
        self.assertEqual(REBUILD.count("FROM sale t"), 1)

    def test_windows_end_at_the_latest_sale(self):
        self.assertIn("max(completion_date) AS period_end", REBUILD)
        self.assertIn("b.period_end - interval '12 months'", REBUILD)
        self.assertIn("b.period_end - interval '36 months'", REBUILD)
        self.assertNotIn("current_date", REBUILD)

    def test_medians_and_premium_need_ten_sales(self):
        self.assertIn("WHEN j.new_build_n >= 10 THEN", REBUILD)
        self.assertIn("WHEN j.resale_n >= 10 THEN", REBUILD)
        self.assertIn("WHEN j.new_build_n >= 10 AND j.resale_n >= 10", REBUILD)
        for column in ("new_build_median_ppm", "resale_median_ppm"):
            self.assertRegex(MIGRATION, rf"CHECK \({column} IS NULL OR \w+_sample_36m >= 10\)")

    def test_leasehold_is_a_share_of_sales(self):
        self.assertIn("leasehold_share_of_sales real", MIGRATION)
        self.assertIn("j.leasehold_12m::numeric / j.tenure_known_12m", REBUILD)

    def test_turnover_uses_one_population(self):
        self.assertIn("100.0 * j.dwellings_sold_12m / j.dwellings", REBUILD)
        self.assertIn("LEFT JOIN sold ON sold.address_id = p.address_id", REBUILD)

    def test_no_address_or_ownership_columns(self):
        table = MIGRATION.split("CREATE TABLE IF NOT EXISTS area_market_depth (", 1)[1].split(");", 1)[0]
        columns = {line.split()[0] for line in table.splitlines() if re.match(r"^\s+[a-z_]+ ", line)}
        self.assertFalse(columns & {"address_id", "uprn", "paon", "street", "postcode", "parcel_id", "owner"})

    def test_lsoa_and_msoa_rows(self):
        self.assertIn("VALUES (p.lsoa_id), (p.msoa_id)", REBUILD)
        self.assertIn("VALUES (lsoa.id), (lsoa.parent_id)", REBUILD)

    def test_sales_load_rebuilds_it_after_growth(self):
        source = (DEPLOY / "tools" / "etl_sales.py").read_text()
        self.assertLess(source.index('"rebuild_area_price_growth()"'), source.index('"rebuild_market_depth()"'))


    def test_price_release_rebuilds_growth_and_market_depth_after_activation(self):
        # #186 reruns every index-dependent rebuild after activation; growth must still come
        # before market depth, which copies its columns (#163).
        source = (DEPLOY / "tools" / "etl_price_release.py").read_text()
        self.assertLess(source.index('"rebuild_area_price_growth()"'),
                        source.index('"rebuild_market_depth()"'))
        self.assertLess(source.index("release_guard.activate(cur, release_id)"),
                        source.rindex("rerun_index_rebuilds(cur)"))

class GrowthQualityMigrationTests(unittest.TestCase):
    """Migration 095 (#163): growth is computed only when both ends of the window are comparable."""

    MIGRATION = (DEPLOY / "migrations" / "095-growth-and-carrier-quality.sql").read_text()

    def test_carrier_columns_on_metric_value(self):
        self.assertIn("ADD COLUMN IF NOT EXISTS carrier_geography_id text", self.MIGRATION)
        self.assertIn("ADD COLUMN IF NOT EXISTS carrier_sample_count integer", self.MIGRATION)

    def test_growth_quality_and_sample_columns(self):
        for table in ("area_price_growth", "area_market_depth"):
            for years in ("1y", "3y", "5y", "10y"):
                self.assertIn(f"ADD COLUMN IF NOT EXISTS growth_{years}_quality text", self.MIGRATION)
                self.assertIn(f"ADD COLUMN IF NOT EXISTS growth_{years}_n integer", self.MIGRATION)

    def test_growth_needs_the_same_quality_and_carrier_at_both_ends(self):
        self.assertIn("now_quality = 'observed' AND base_quality = 'observed'", self.MIGRATION)
        self.assertIn("now_carrier = base_carrier", self.MIGRATION)
        self.assertIn("quality := 'mixed'", self.MIGRATION)

    def test_market_depth_copies_the_new_columns(self):
        rebuild = self.MIGRATION.split("FUNCTION public.rebuild_market_depth", 1)[1]
        for fragment in ("g.growth_1y_quality", "g.growth_10y_n"):
            self.assertIn(fragment, rebuild)


if __name__ == "__main__":
    unittest.main()
