"""AE-12: reliable area prices from eligible sale/EPC joins.

Deterministic government-shaped fixtures only. Each test names one
acceptance clause: thin samples, missing EPC subgroup, changing mix,
missing inflation periods, coarser carrier fallback, borough pooling,
unit conversion, and distinct counts.
"""

import unittest

from area_analytics.analytics import (
    SQM_PER_SQFT,
    LinkedSale,
    adjust_series,
    build_area_price_observation,
    build_price_release,
    compose_price_mix,
    partition_eligible_sales,
    price_per_square_foot,
    subgroup_medians,
)
from area_analytics.property_history import adjust_by_index, separated_history_point


def _sale(index, period="2026-06", price=300_000, area=60.0,
          lsoa="E01000001", msoa="E02000001", borough="E09000001",
          property_type="F", new_build=False):
    return LinkedSale(f"tx-{index:04d}", period, price, area,
                      lsoa, msoa, borough, property_type, new_build)


def _many(count, start=0, **kwargs):
    return [_sale(start + index, **kwargs) for index in range(count)]


class AreaPriceReleaseTests(unittest.TestCase):
    def test_thin_samples_suppress_every_carrier(self):
        records = _many(3, area=60.0) + _many(4, start=100, area=55.0)

        evidence = build_area_price_observation("2026-06", records)

        self.assertIsNone(evidence.median_sqm)
        self.assertEqual(evidence.quality, "suppressed")
        self.assertEqual(evidence.reason, "thin-sample")

    def test_missing_epc_subgroup_reports_null_median(self):
        records = _many(20, property_type="F", area=50.0)
        records += [LinkedSale(f"tx-det-{i}", "2026-06", 500_000, None,
                               "E01000001", "E02000001", "E09000001", "D", False)
                    for i in range(5)]

        medians = subgroup_medians(records)

        self.assertIsNotNone(medians["F"])
        self.assertIsNone(medians["D"])

    def test_changing_mix_reports_type_and_new_build_shares(self):
        early = _many(16, period="2025-06", property_type="F", area=50.0)
        early += _many(4, start=100, period="2025-06", property_type="D",
                       area=120.0, new_build=True)
        late = _many(4, period="2026-06", property_type="F", area=50.0)
        late += _many(16, start=200, period="2026-06", property_type="D",
                      area=120.0)

        early_mix = compose_price_mix(early)
        late_mix = compose_price_mix(late)

        self.assertEqual(early_mix["byPropertyType"]["F"], 16)
        self.assertEqual(late_mix["byPropertyType"]["D"], 16)
        self.assertAlmostEqual(early_mix["newBuildShare"], 0.2)
        self.assertAlmostEqual(late_mix["newBuildShare"], 0.0)

    def test_missing_inflation_period_suppresses_only_that_point(self):
        nominal = {"2025-06": 5_000.0, "2026-06": 6_000.0}
        cpih = {"2026-06": 120.0}

        adjusted = adjust_series(nominal, cpih, 120.0)

        self.assertIsNone(adjusted["2025-06"])
        self.assertEqual(adjusted["2026-06"], 6_000)

    def test_coarser_carrier_fallback_pools_msoa_observations(self):
        records = _many(5, lsoa="E01000001", msoa="E02000001", area=50.0,
                        price=250_000)
        records += _many(20, start=50, lsoa="E01000002", msoa="E02000001",
                         area=50.0, price=250_000)

        release = build_price_release(records, "2026-06")

        evidence = release["E01000001"]
        self.assertEqual(evidence.carrier, "msoa")
        self.assertEqual(evidence.quality, "fallback")
        self.assertEqual(evidence.median_sqm, 5_000)
        self.assertEqual(evidence.carrier_sales, 25)

    def test_borough_pools_observations_not_averages_of_medians(self):
        records = _many(5, lsoa="E01000001", msoa="E02000001",
                        price=100_000, area=100.0)
        records += _many(60, start=100, lsoa="E01000002", msoa="E02000002",
                         price=200_000, area=100.0)

        release = build_price_release(records, "2026-06")

        evidence = release["E01000001"]
        self.assertEqual(evidence.carrier, "borough")
        self.assertEqual(evidence.median_sqm, 2_000)
        self.assertNotEqual(evidence.median_sqm, 1_500)

    def test_square_foot_conversion_uses_tested_factor(self):
        self.assertAlmostEqual(SQM_PER_SQFT, 10.7639, places=4)
        self.assertAlmostEqual(price_per_square_foot(10_000), 929.03, places=1)
        self.assertAlmostEqual(
            adjust_by_index(100_000, 80.0, 120.0), 150_000)

    def test_counts_keep_all_matched_excluded_and_carrier_distinct(self):
        records = _many(20, area=50.0)
        records += [LinkedSale(f"tx-miss-{i}", "2026-06", 300_000, None,
                               "E01000001", "E02000001", "E09000001", "T", False)
                    for i in range(7)]

        matched, excluded = partition_eligible_sales(records)
        evidence = build_area_price_observation("2026-06", records)

        self.assertEqual(len(matched), 20)
        self.assertEqual(len(excluded), 7)
        self.assertEqual(evidence.all_sales, 27)
        self.assertEqual(evidence.matched_sales, 20)
        self.assertEqual(evidence.excluded_sales, 7)
        self.assertEqual(evidence.carrier_sales, 20)

    def test_missing_index_suppresses_separated_history_point(self):
        point = separated_history_point(100_000, None, 120.0, 2_000, 5_000)

        self.assertEqual(point.nominal, 100_000)
        self.assertIsNone(point.inflation_adjusted)
        self.assertEqual(point.market_adjusted, 250_000)


if __name__ == "__main__":
    unittest.main()
