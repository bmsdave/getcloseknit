"""Sold-price map: suppressed homes never reach a sale tile, cells never expose one sale."""
import unittest
from pathlib import Path

MIGRATION = (Path(__file__).resolve().parents[1] / "migrations" / "008-sales.sql").read_text()
TILE = MIGRATION.split("CREATE OR REPLACE FUNCTION public.sale_tile", 1)[1]


class SaleTileTests(unittest.TestCase):
    def test_pins_and_cells_both_drop_suppressed_homes(self):
        pins, cells = TILE.split("ELSIF z >= 11 THEN", 1)
        for branch in (pins, cells):
            self.assertIn("NOT EXISTS (SELECT 1 FROM suppressed_dwelling", branch)
            self.assertIn("d.address_id = pin.address_id", branch)
            self.assertIn("d.uprn = pin.uprn", branch)

    def test_cells_need_three_homes(self):
        cells = TILE.split("ELSIF z >= 11 THEN", 1)[1]
        self.assertIn("HAVING count(*) >= 3", cells)

    def test_pins_start_at_zoom_15(self):
        self.assertIn("IF z >= 15 THEN", TILE)

    def test_stock_values_use_standard_market_sales_only(self):
        stock = MIGRATION.split("FUNCTION public.rebuild_stock_values", 1)[1].split("$$;", 1)[0]
        self.assertIn("s.ppd_category = 'A'", stock)
        self.assertIn("s.property_type <> 'O'", stock)


if __name__ == "__main__":
    unittest.main()
