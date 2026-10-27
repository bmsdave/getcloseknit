"""Migration 040: area price bands, and no per-home restated value in the map tiles."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (ROOT / "migrations" / "040-area-price-bands.sql").read_text()
REBUILD = MIGRATION.split("FUNCTION public.rebuild_area_price_bands", 1)[1].split("$$;", 1)[0]
PROPERTY_TILE = MIGRATION.split("FUNCTION public.property_tile", 1)[1].split("$$;", 1)[0]
SALE_TILE = MIGRATION.split("FUNCTION public.sale_tile", 1)[1].split("$$;", 1)[0]


class RebuildTests(unittest.TestCase):
    def test_standard_sales_of_the_four_types_only(self):
        self.assertIn("s.ppd_category = 'A'", REBUILD)
        self.assertIn("s.property_type IN ('D', 'S', 'T', 'F')", REBUILD)

    def test_no_per_home_floor_area_or_stock_value(self):
        for word in ("floor_area", "price_per_square_metre AS", "property_stock_value", "restated"):
            self.assertNotIn(word, REBUILD)

    def test_sales_are_adjusted_by_the_lsoa_index_with_the_stock_value_gates(self):
        self.assertIn("ls.price * now_v.value / at_sale.value", REBUILD)
        self.assertIn("BETWEEN 0.25 AND 6", REBUILD)

    def test_map_layer_falls_back_and_suppresses_below_five(self):
        self.assertIn("bl.sales >= 20", REBUILD)
        self.assertIn("bm.sales >= 20", REBUILD)
        self.assertIn("bb.sales >= 5", REBUILD)
        self.assertIn("'suppressed'", REBUILD)
        for metric in ("typical-price", "typical-price-flat", "typical-price-terraced",
                       "typical-price-semi", "typical-price-detached"):
            self.assertIn(f"'{metric}'", REBUILD)

    def test_layer_definitions_link_their_guide_article(self):
        self.assertIn("'methodologyPath', '/guide/typical-price'", REBUILD)

    def test_layer_is_named_typical_home_price(self):
        self.assertIn("'label', 'Typical home price' || q.suffix", REBUILD)
        self.assertIn("'shortLabel', 'Typical home price'", REBUILD)
        self.assertNotIn("Typical price today", REBUILD)
        # Re-running the migration renames definitions already published, without waiting for a sales load.
        self.assertIn("replace(definition->>'label', 'Typical price today', 'Typical home price')", MIGRATION)

    def test_wired_into_the_sales_load(self):
        source = (ROOT / "tools" / "etl_sales.py").read_text()
        self.assertIn('"rebuild_area_price_bands(%s)"', source)
        self.assertLess(source.index('"rebuild_sale_pins(%s)"'), source.index('"rebuild_area_price_bands(%s)"'))


class TileTests(unittest.TestCase):
    def test_property_tile_carries_no_restated_value(self):
        self.assertIsNone(re.search(r"\bvalue\b", PROPERTY_TILE.replace("sale_price_per_square_metre", "")))
        self.assertNotIn("restated", PROPERTY_TILE)
        self.assertNotIn("confidence", PROPERTY_TILE)
        self.assertIn("v.sale_price_per_square_metre AS sppm", PROPERTY_TILE)

    def test_blocks_keep_a_median_only_over_three_homes(self):
        blocks = PROPERTY_TILE.split("block_features AS", 1)[1].split("), tile_parcels", 1)[0]
        self.assertIn("CASE WHEN b.dwellings >= 3 THEN round(b.median_price_per_square_metre) END AS ppm", blocks)
        self.assertNotIn("median_value", blocks)

    def test_sale_tile_drops_value_now(self):
        self.assertNotIn("value_now", SALE_TILE)
        self.assertNotIn("AS value", SALE_TILE)

    def test_suppressed_homes_stay_out(self):
        self.assertEqual(PROPERTY_TILE.count("suppressed_dwelling"), 1)
        self.assertEqual(SALE_TILE.count("suppressed_dwelling"), 2)


if __name__ == "__main__":
    unittest.main()
