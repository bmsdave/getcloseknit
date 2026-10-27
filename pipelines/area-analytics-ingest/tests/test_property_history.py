import unittest

from area_analytics.property_history import compare_historical_price


class PropertyHistoryTests(unittest.TestCase):
    def test_history_reports_nominal_inflation_and_local_market_values(self):
        comparison = compare_historical_price(
            nominal_price=100_000,
            cpih_at_sale=80,
            cpih_latest=120,
            local_price_per_square_metre_at_sale=2_000,
            local_price_per_square_metre_latest=5_000,
        )

        self.assertEqual(comparison.nominal_price, 100_000)
        self.assertEqual(comparison.inflation_adjusted_price, 150_000)
        self.assertEqual(comparison.local_market_adjusted_price, 250_000)

    def test_missing_market_index_suppresses_market_comparison(self):
        comparison = compare_historical_price(
            nominal_price=100_000,
            cpih_at_sale=80,
            cpih_latest=120,
            local_price_per_square_metre_at_sale=None,
            local_price_per_square_metre_latest=5_000,
        )

        self.assertIsNone(comparison.local_market_adjusted_price)


if __name__ == "__main__":
    unittest.main()
