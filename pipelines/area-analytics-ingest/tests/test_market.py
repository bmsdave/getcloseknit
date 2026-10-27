"""Local market aggregates: windows, thresholds, parents and percentiles."""

import unittest
from datetime import date

from area_analytics.market import (
    ALL_TYPES,
    MIN_PRICE,
    Sale,
    aggregate,
    percentile,
    window_end,
    window_index,
)
from area_analytics.market_load import read_sales, row_values

LATEST = date(2026, 7, 1)
PARENTS = {"uk:lsoa:E01000001": ("uk:msoa:E02000001", "uk:lad:E09000001")}


def sale(price, kind="F", month=date(2026, 3, 1), ppm=None, category="A", lsoa="uk:lsoa:E01000001"):
    return Sale(lsoa, month, price, kind, ppm, category)


def rows_by(rows, geography, kind, end=LATEST):
    return next((row for row in rows if (row.geography_id, row.property_type, row.window_end)
                 == (geography, kind, end)), None)


class PercentileTests(unittest.TestCase):
    def test_matches_percentile_cont(self):
        self.assertEqual(percentile([1, 2, 3, 4], 0.5), 2.5)
        self.assertEqual(percentile([10], 0.95), 10)
        self.assertAlmostEqual(percentile([0, 100], 0.05), 5)
        with self.assertRaises(ValueError):
            percentile([], 0.5)


class WindowTests(unittest.TestCase):
    def test_twelve_month_windows_step_back_a_year(self):
        self.assertEqual(window_index(date(2026, 7, 1), LATEST), 0)
        self.assertEqual(window_index(date(2025, 8, 1), LATEST), 0)
        self.assertEqual(window_index(date(2025, 7, 1), LATEST), 1)
        self.assertEqual(window_index(date(2015, 8, 1), LATEST), 10)
        self.assertIsNone(window_index(date(2015, 7, 1), LATEST))
        self.assertIsNone(window_index(date(2026, 8, 1), LATEST))
        self.assertEqual(window_end(LATEST, 10), date(2016, 7, 1))


class AggregateTests(unittest.TestCase):
    def test_types_all_and_parents(self):
        sales = [sale(p, "F", ppm=p / 50) for p in (300_000, 400_000, 500_000, 600_000, 700_000)]
        sales.append(sale(900_000, "T"))
        rows = aggregate(sales, PARENTS, LATEST)
        flats = rows_by(rows, "uk:lsoa:E01000001", "F")
        self.assertEqual((flats.sales, flats.median_price, flats.p25, flats.p75), (5, 500_000, 400_000, 600_000))
        self.assertEqual((flats.p5, flats.p95), (320_000, 680_000))
        self.assertEqual((flats.min_price, flats.max_price), (300_000, 700_000))
        self.assertEqual((flats.ppm_sales, flats.median_ppm), (5, 10_000))
        every = rows_by(rows, "uk:lad:E09000001", ALL_TYPES)
        self.assertEqual((every.sales, every.median_price, every.ppm_sales), (6, 550_000, 5))

    def test_thin_groups_are_unknown_not_zero(self):
        rows = aggregate([sale(400_000, "D"), sale(500_000, "D", ppm=8000)], PARENTS, LATEST)
        detached = rows_by(rows, "uk:lsoa:E01000001", "D")
        self.assertEqual(detached.sales, 2)
        self.assertIsNone(detached.median_price)
        self.assertIsNone(detached.min_price)
        self.assertIsNone(detached.median_ppm)
        self.assertIsNone(rows_by(rows, "uk:lsoa:E01000001", "S"))  # no sales: no row
        three = aggregate([sale(p, "S") for p in (1, 2, 3)], {}, LATEST)
        self.assertEqual(three, [])  # all under MIN_PRICE
        four = rows_by(aggregate([sale(p, "S") for p in (200_000, 300_000, 400_000, 500_000)], {}, LATEST),
                       "uk:lsoa:E01000001", "S")
        self.assertEqual(four.median_price, 350_000)
        self.assertIsNone(four.p25)

    def test_excludes_category_b_cheap_and_old_sales(self):
        rows = aggregate([
            sale(400_000, category="B"), sale(MIN_PRICE - 1),
            sale(400_000, month=date(2010, 1, 1)), sale(450_000, month=date(2020, 1, 1)),
        ], {}, LATEST)
        self.assertEqual([(row.window_end, row.property_type, row.sales) for row in rows],
                         [(date(2020, 7, 1), "F", 1), (date(2020, 7, 1), "all", 1)])


class LoadFormatTests(unittest.TestCase):
    def test_copy_rows_round_trip(self):
        sales = list(read_sales("uk:lsoa:E01000001,2026-03-01,400000,F,8000.5\n"
                                "uk:lsoa:E01000001,2026-04-01,500000,T,\n"))
        self.assertEqual(sales[0].price_per_square_metre, 8000.5)
        self.assertIsNone(sales[1].price_per_square_metre)
        row = aggregate(sales, {}, LATEST)[0]
        self.assertEqual(row_values(row, "src")[0:4], ("uk:lsoa:E01000001", "F", LATEST, 1))
        self.assertEqual(row_values(row, "src")[-1], "src")


if __name__ == "__main__":
    unittest.main()
