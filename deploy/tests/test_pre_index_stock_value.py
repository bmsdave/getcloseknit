"""Issue #249: a dwelling whose last sale predates the £/m² index (June 2006) must not be
restated as if it had sold in the index's first month. Migration 098 (same bodies as the
in-place 008 update) keeps such a sale's recorded facts but leaves it unrestated, out of every
median and count."""
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (ROOT / "migrations" / "098-pre-index-sales-unrestated.sql").read_text()
SALES = (ROOT / "migrations" / "008-sales.sql").read_text()
CITY_BLOCKS = (ROOT / "migrations" / "006-city-blocks.sql").read_text()
LEGACY_LOAD = (ROOT / "tools" / "property-load.sql").read_text()


def function_body(text, name):
    return text.split(f"FUNCTION public.{name}", 1)[1].split("$$;", 1)[0]


STOCK = function_body(MIGRATION, "rebuild_stock_values")
BLOCKS = function_body(MIGRATION, "revalue_city_blocks")
MEDIAN = STOCK.split("Area stock value", 1)[1]

CAVEAT = ("A home whose last sale predates the price per m² index (June 2006) is not restated and "
          "is left out of the median and the count; it is never moved forward as if it had sold in "
          "June 2006.")


class PreIndexSaleTests(unittest.TestCase):
    def test_sale_is_indexed_at_its_own_month_never_the_first_index_month(self):
        # The root cause: GREATEST(sale_month, first) clamped every older sale to June 2006.
        self.assertNotIn("GREATEST", STOCK)
        self.assertIn("at_sale.period = i.sale_month", STOCK)
        self.assertIn("WHERE i.sale_month >= i.first", STOCK)

    def test_pre_index_sale_is_kept_with_a_reason_and_no_restated_value(self):
        self.assertIn("WHERE i.sale_month < i.first", STOCK)
        self.assertIn("'pre-index-sale'", STOCK)
        self.assertIn("NULL::text AS unrestated_reason", STOCK)
        # The unrestated branch writes no carrier, index or restated figure, confidence low.
        self.assertIn("i.price_per_square_metre, NULL, i.geography_id, NULL, NULL, NULL, NULL, 'low',", STOCK)
        self.assertIn("unrestated_reason, source_release_id)", STOCK)

    def test_area_median_and_count_read_restated_rows_only(self):
        self.assertIn("WHERE v.restated_price_per_square_metre IS NOT NULL", MEDIAN)
        self.assertIn("count(*) AS n", MEDIAN)

    def test_street_blocks_read_restated_rows_only(self):
        self.assertIn("WHERE v.restated_value IS NOT NULL", BLOCKS)
        self.assertIn("AND v.restated_value IS NOT NULL", function_body(CITY_BLOCKS, "rebuild_city_blocks"))

    def test_log_counts_the_unrestated_dwellings(self):
        self.assertIn("count(*) FILTER (WHERE unrestated_reason = 'pre-index-sale')", STOCK)
        self.assertIn("pre-index sales kept unrestated", STOCK)

    def test_columns_are_nullable_and_a_row_is_restated_or_explained(self):
        for column in ("index_carrier", "index_at_sale", "index_latest",
                       "restated_price_per_square_metre", "restated_value"):
            self.assertIn(f"ALTER COLUMN {column} DROP NOT NULL", MIGRATION)
        self.assertIn("ADD COLUMN IF NOT EXISTS unrestated_reason text", MIGRATION)
        self.assertIn("CHECK (unrestated_reason IN ('pre-index-sale'))", MIGRATION)
        self.assertIn("ADD CONSTRAINT property_stock_value_restated_or_reason", MIGRATION)
        self.assertIn("DROP CONSTRAINT IF EXISTS property_stock_value_restated_or_reason", MIGRATION)

    def test_metric_caveat_says_so(self):
        self.assertIn(CAVEAT, MIGRATION)
        self.assertIn("WHERE id = 'stock-value-per-square-metre'", MIGRATION)
        self.assertIn(CAVEAT, LEGACY_LOAD)

    def test_legacy_loader_does_not_clamp_either(self):
        self.assertNotIn("GREATEST", LEGACY_LOAD)
        self.assertIn("WHERE s.sale_month >= fp.period", LEGACY_LOAD)

    def test_bodies_match_the_in_place_updates(self):
        for name, body in (("rebuild_stock_values", STOCK), ("revalue_city_blocks", BLOCKS)):
            self.assertEqual(function_body(SALES, name), body, f"098 drifted from the in-place 008 {name}")


if __name__ == "__main__":
    unittest.main()
