import unittest

from area_analytics.property_value import (
    StockValue,
    confidence_band,
    index_period_for,
    restate_stock_value,
)


class RestateTests(unittest.TestCase):
    def test_restates_the_last_sale_by_the_carrier_price_index(self):
        value = restate_stock_value(
            nominal_price=570_000, floor_area_sqm=54.0, sale_period="2024-11",
            index_at_sale=10_000.0, index_latest=12_000.0, index_carrier="lsoa",
            latest_period="2026-06")
        self.assertEqual(value, StockValue(
            price_per_square_metre=12_666.67, value=684_000, ratio=1.2,
            confidence="high", index_carrier="lsoa", sale_period="2024-11", latest_period="2026-06"))

    def test_no_floor_area_means_no_restated_value(self):
        self.assertIsNone(restate_stock_value(
            nominal_price=570_000, floor_area_sqm=None, sale_period="2022-11",
            index_at_sale=10_000.0, index_latest=12_000.0, index_carrier="lsoa",
            latest_period="2026-06"))

    def test_missing_or_non_positive_index_means_no_value(self):
        for at_sale, latest in ((None, 1.0), (1.0, None), (0.0, 1.0), (1.0, -2.0)):
            self.assertIsNone(restate_stock_value(
                nominal_price=100, floor_area_sqm=10.0, sale_period="2020-01",
                index_at_sale=at_sale, index_latest=latest, index_carrier="lsoa",
                latest_period="2026-06"))


class ConfidenceTests(unittest.TestCase):
    def test_recent_sale_on_its_own_lsoa_index_is_high(self):
        self.assertEqual(confidence_band("2024-01", "2026-06", "lsoa"), "high")

    def test_older_sales_or_coarser_indices_step_down(self):
        self.assertEqual(confidence_band("2019-06", "2026-06", "lsoa"), "medium")
        self.assertEqual(confidence_band("2025-06", "2026-06", "msoa"), "medium")
        self.assertEqual(confidence_band("2010-06", "2026-06", "lsoa"), "low")
        self.assertEqual(confidence_band("2025-06", "2026-06", "borough"), "low")

    def test_sales_before_the_index_starts_use_its_first_period_and_are_low(self):
        self.assertEqual(index_period_for("1998-03", "2006-06"), "2006-06")
        self.assertEqual(index_period_for("2010-03", "2006-06"), "2010-03")
        self.assertEqual(confidence_band("1998-03", "2026-06", "lsoa"), "low")


if __name__ == "__main__":
    unittest.main()
