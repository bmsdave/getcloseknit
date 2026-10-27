import unittest

from area_analytics.analytics import (
    Sale,
    CrimeRecord,
    build_crime_observation,
    build_price_observation,
    calculate_percentiles,
    choose_reliable_geography,
)


class AnalyticsTests(unittest.TestCase):
    def test_crime_uses_a_rolling_twelve_month_population_rate_and_categories(self):
        records = [
            CrimeRecord("2025-01", "burglary"), CrimeRecord("2025-12", "burglary"),
            CrimeRecord("2025-12", "violence"), CrimeRecord("2024-12", "ignored"),
        ]

        observation = build_crime_observation("2025-12", records, population=1_000)

        self.assertEqual(observation.rate_per_thousand, 3)
        self.assertEqual(observation.categories, {"burglary": 2, "violence": 1})

    def test_rolling_price_uses_only_previous_twelve_months(self):
        sales = [
            Sale("2024-01", 200_000, 50),
            Sale("2024-12", 300_000, 50),
            Sale("2023-12", 9_000_000, 50),
        ]

        observation = build_price_observation("2024-12", sales)

        self.assertEqual(observation.median_price_per_square_metre, 5_000)
        self.assertEqual(observation.sample_count, 2)

    def test_missing_floor_area_is_excluded_from_price_per_square_metre(self):
        sales = [Sale("2024-12", 300_000, None), Sale("2024-12", 250_000, 50)]

        observation = build_price_observation("2024-12", sales)

        self.assertEqual(observation.median_price_per_square_metre, 5_000)
        self.assertEqual(observation.sample_count, 1)

    def test_sparse_lsoa_falls_back_to_first_geography_with_twenty_sales(self):
        selected = choose_reliable_geography(
            [("lsoa", 12), ("msoa", 20), ("borough", 80)]
        )

        self.assertEqual(selected, "msoa")

    def test_percentiles_keep_london_and_england_comparisons_separate(self):
        result = calculate_percentiles(30, region_values=[10, 20, 30], england_values=[10, 20, 30, 40, 50])

        self.assertEqual(result.london, 100)
        self.assertEqual(result.england, 60)


if __name__ == "__main__":
    unittest.main()
