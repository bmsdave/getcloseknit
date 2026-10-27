"""Issue #185: price bands and stock values restate by a £/m² ratio whose two ends must be
the same geography. Migration 096 (same bodies as the in-place 008/040 updates)."""
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (ROOT / "migrations" / "096-same-carrier-restatement.sql").read_text()
BANDS = MIGRATION.split("FUNCTION public.rebuild_area_price_bands", 1)[1].split("$$;", 1)[0]
STOCK = MIGRATION.split("FUNCTION public.rebuild_stock_values", 1)[1].split("$$;", 1)[0]

# The old mixed ratio labelled index_carrier 'msoa' whenever either end was not observed.
MIXED_CASE = "THEN 'lsoa' ELSE 'msoa'"


class SameCarrierTests(unittest.TestCase):
    def test_carrier_columns_are_added_defensively(self):
        self.assertIn("ADD COLUMN IF NOT EXISTS carrier_geography_id", MIGRATION)
        self.assertIn("ADD COLUMN IF NOT EXISTS carrier_sample_count", MIGRATION)

    def test_bands_restate_only_with_the_same_carrier_at_both_ends(self):
        for body in (BANDS, STOCK):
            self.assertIn("at_sale.quality = 'observed' AND now_v.quality = 'observed'", body)
            self.assertIn("at_sale.quality = 'fallback' AND now_v.quality = 'fallback'", body)
            self.assertIn("at_sale.carrier_geography_id = now_v.carrier_geography_id", body)
            self.assertNotIn(MIXED_CASE, body)

    def test_bands_still_use_the_stock_value_gates(self):
        self.assertIn("ls.price * now_v.value / at_sale.value", BANDS)
        self.assertIn("BETWEEN 0.25 AND 6", BANDS)

    def test_carrier_is_emitted(self):
        # Bands have no carrier column: the mix goes to the ETL log.
        self.assertIn("RAISE NOTICE", BANDS)
        self.assertIn("same-carrier", BANDS)
        # Stock values carry the carrier per dwelling.
        self.assertIn("RAISE NOTICE", STOCK)
        self.assertIn("index_carrier", STOCK)
        self.assertIn("index_geography_id", STOCK)

    def test_stock_values_name_the_carrier_actually_used(self):
        self.assertIn("ELSE split_part(at_sale.carrier_geography_id, ':', 2) END AS index_carrier", STOCK)
        self.assertIn("COALESCE(at_sale.carrier_geography_id, i.geography_id) AS index_geography_id", STOCK)

    def test_confidence_follows_the_real_carrier(self):
        self.assertIn("stock_value_confidence(i.sale_month, i.latest,", STOCK)
        self.assertNotIn(MIXED_CASE, STOCK)

    def test_bodies_match_the_in_place_updates(self):
        # rebuild_stock_values moved on in 098 (#249): test_pre_index_stock_value.py checks
        # that one against the in-place 008 body.
        original = (ROOT / "migrations" / "040-area-price-bands.sql").read_text()
        rebuilt = original.split("FUNCTION public.rebuild_area_price_bands", 1)[1].split("$$;", 1)[0]
        self.assertEqual(rebuilt, BANDS, "096 drifted from the in-place 040 update")


if __name__ == "__main__":
    unittest.main()
