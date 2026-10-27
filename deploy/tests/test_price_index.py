"""£/m² medians use standard market sales only and fall back to a larger area."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

import price_index as pi  # noqa: E402


class QualifyTests(unittest.TestCase):
    def test_standard_market_sales_qualify(self):
        self.assertTrue(pi.qualifies("A", "F", 450_000, 60.0))
        self.assertTrue(pi.qualifies("A", "D", 1_200_000, 180.0))

    def test_non_market_or_implausible_sales_do_not(self):
        self.assertFalse(pi.qualifies("B", "F", 450_000, 60.0))   # repossession, BTL, company
        self.assertFalse(pi.qualifies("A", "O", 450_000, 60.0))   # other property type
        self.assertFalse(pi.qualifies("A", "F", 450_000, None))   # no floor area
        self.assertFalse(pi.qualifies("A", "F", 450_000, 10.0))   # EPC area error
        self.assertFalse(pi.qualifies("A", "F", 15_000, 50.0))    # non-market transfer
        self.assertFalse(pi.qualifies("A", "F", 4_500_000, 60.0))  # £75k/m²


class SeriesTests(unittest.TestCase):
    def test_month_index_round_trips(self):
        self.assertEqual(pi.index_month(pi.month_index("2026-06")), "2026-06")
        self.assertEqual(pi.month_index("2026-01") - pi.month_index("2025-12"), 1)

    def test_window_holds_exactly_twelve_months(self):
        end = pi.month_index("2026-06")
        series = pi.Series([(end - 12, 1.0), (end - 11, 2.0), (end, 3.0), (end + 1, 4.0)])
        self.assertEqual(series.window(end), [2.0, 3.0])

    def test_carrier_fallback_order_and_suppression(self):
        own = [100.0] * 5
        msoa = [200.0] * 25
        borough = [300.0] * 400
        parents = [("uk:msoa:E02000001", msoa), ("uk:lad:E09000001", borough)]
        self.assertEqual(pi.carrier_value([50.0] * 20, parents), (50.0, 20, "observed", None, None))
        self.assertEqual(pi.carrier_value(own, parents),
                         (200.0, 5, "fallback", "uk:msoa:E02000001", 25))
        self.assertEqual(pi.carrier_value(own, [("uk:msoa:E02000001", [1.0]), parents[1]]),
                         (300.0, 5, "fallback", "uk:lad:E09000001", 400))
        self.assertEqual(pi.carrier_value(own, [("uk:msoa:E02000001", [1.0]), ("uk:lad:E09000001", [2.0])]),
                         (None, 5, "suppressed", None, None))

    def test_percentiles_ascend(self):
        self.assertEqual(pi.ascending_percentiles({"a": 1.0, "b": 3.0, "c": None}), {"a": 0, "b": 100})
        # #221: three equal £/m² share a percentile (they were 0, 33, 67 by code).
        self.assertEqual(pi.ascending_percentiles({"a": 5.0, "b": 5.0, "c": 5.0, "d": 7.0}), {"a": 0, "b": 0, "c": 0, "d": 100})


if __name__ == "__main__":
    unittest.main()
