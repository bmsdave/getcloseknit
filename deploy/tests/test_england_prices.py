"""England area prices (deploy/tools/etl_england_prices.py, england_price_tables.py): the London SQL builds
ported to postcode-placed sales keep their rules (carrier fallback, same-carrier restatement, regional ranks)."""

import sys
import unittest
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import england_price_tables as t  # noqa: E402
import etl_england_prices as e  # noqa: E402

# Two LSOAs in one MSOA of Hartlepool (North East), one in Camden (London).
LOOKUP = {"E01011949": ("E02002491", "E06000001"), "E01011950": ("E02002491", "E06000001"),
          "E01000842": ("E02000166", "E09000007")}
REGIONS = {"E06000001": "E12000001", "E09000007": "E12000007"}
AREAS = t.Areas(LOOKUP, REGIONS.get)


def sale(lsoa="E01011949", day=date(2026, 3, 1), price=200_000, ptype="T", floor=100.0, category="A",
         new_build=False, tenure="F", postcode="TS24 7AB", dwelling="x", street="HIGH STREET"):
    return t.Sale(lsoa, day, t.month_index(day), price, ptype, new_build, tenure, category, floor, postcode,
                  dwelling, street)


class HelperTests(unittest.TestCase):
    def test_postcode_area_is_the_leading_letters(self):
        self.assertEqual(e.postcode_area("SW1A1AA"), "SW")
        self.assertEqual(e.postcode_area("B11AA"), "B")
        self.assertEqual(e.postcode_area(""), "")

    def test_ppm_rule_is_load_sales(self):
        self.assertEqual(t.ppm_of(300_000, 100), 3000.0)
        self.assertIsNone(t.ppm_of(300_000, 10))          # floor under 15 m²
        self.assertIsNone(t.ppm_of(5_000_000, 100))       # over £40,000/m²
        self.assertIsNone(t.ppm_of(300_000, None))

    def test_rounding_follows_postgres(self):
        self.assertEqual(t.round_numeric(2.25, 1), 2.3)     # numeric: half away from zero
        self.assertEqual(t.round_numeric(-2.25, 1), -2.3)
        self.assertEqual(round(2.5), 2)                     # double precision: half to even

    def test_periods_keep_growth_lags_and_the_monthly_tail(self):
        end, first = t.month_index(date(2026, 6, 1)), t.month_index(date(2006, 6, 1))
        periods = e.ppm_periods(end, first, t.month_index(date(2023, 1, 1)))
        for years in (0, 1, 3, 5, 10, 20):
            self.assertIn(end - 12 * years, periods)
        self.assertIn(t.month_index(date(2023, 2, 1)), periods)
        self.assertNotIn(t.month_index(date(2019, 2, 1)), periods)
        self.assertEqual(len(periods), 17 + 42)

    def test_passes_split_postcode_areas_evenly(self):
        postcodes = {f"TS{i}": None for i in range(10)} | {f"B{i}": None for i in range(9)} | {"N1": None}
        groups = e.plan_passes(postcodes, 2)
        self.assertEqual(len(groups), 2)
        self.assertEqual(set().union(*groups), {"TS", "B", "N"})


class IndexTests(unittest.TestCase):
    def test_an_lsoa_under_20_sales_falls_back_to_its_msoa_then_borough(self):
        sales = [sale("E01011949") for _ in range(5)] + [sale("E01011950", price=300_000) for _ in range(16)]
        series = t.index_series(sales, AREAS, t.month_index(date(2026, 1, 1)))
        rows = {row[0]: row for row in t.price_index_rows(series, AREAS, [t.month_index(date(2026, 6, 1))])}
        lsoa = rows["uk:lsoa:E01011949"]
        self.assertEqual(lsoa[5], "fallback")
        self.assertEqual(lsoa[6], "uk:msoa:E02002491")    # the carrier
        self.assertEqual((lsoa[4], lsoa[7]), (5, 21))      # own n, carrier n
        self.assertEqual(rows["uk:lad:E06000001"][5], "observed")
        self.assertEqual(rows["uk:lsoa:E01000842"][5], "suppressed")

    def test_lsoa_percentiles_rank_within_the_region(self):
        sales = ([sale("E01011949", price=100_000) for _ in range(20)]
                 + [sale("E01011950", price=150_000) for _ in range(20)]
                 + [sale("E01000842", price=900_000, postcode="NW1 0AA") for _ in range(20)])
        series = t.index_series(sales, AREAS, t.month_index(date(2026, 1, 1)))
        rows = {row[0]: row for row in t.price_index_rows(series, AREAS, [t.month_index(date(2026, 6, 1))])}
        self.assertEqual(rows["uk:lsoa:E01011949"][3], 0)
        self.assertEqual(rows["uk:lsoa:E01011950"][3], 100)
        self.assertEqual(rows["uk:lsoa:E01000842"][3], 0)   # alone in London: not above Hartlepool
        self.assertIsNone(rows["uk:msoa:E02002491"][3])      # only LSOAs are ranked

    def test_growth_needs_comparable_ends(self):
        now = (2000.0, "observed", None, None)
        self.assertEqual(t.growth_window(now, (1600.0, "observed", None, None))[:2], (25.0, "observed"))
        self.assertEqual(t.growth_window(now, (1600.0, "fallback", "uk:msoa:X", 30)), (None, "mixed", 30))
        fallback = (2000.0, "fallback", "uk:msoa:X", 25)
        self.assertEqual(t.growth_window(fallback, (1000.0, "fallback", "uk:msoa:X", 40)), (100.0, "fallback", 25))
        self.assertEqual(t.growth_window(now, None), (None, None, None))


class BandTests(unittest.TestCase):
    def test_sales_are_restated_by_the_same_carrier_only(self):
        latest, first = t.month_index(date(2026, 6, 1)), t.month_index(date(2006, 6, 1))
        march = t.month_index(date(2026, 3, 1))
        cells = {("uk:lsoa:E01011949", latest): (2200.0, "observed", None, None),
                 ("uk:lsoa:E01011949", march): (2000.0, "observed", None, None),
                 ("uk:lsoa:E01011950", latest): (2200.0, "fallback", "uk:msoa:E02002491", 30),
                 ("uk:lsoa:E01011950", march): (2000.0, "observed", None, None)}
        rows, adjusted, in_window = t.price_band_rows(
            [sale("E01011949", price=200_000), sale("E01011950", price=200_000)], AREAS, cells, latest, first)
        self.assertEqual((adjusted, in_window), (1, 2))   # the mixed observed/fallback pair is dropped
        band = {(r[0], r[1]): r for r in rows}
        self.assertEqual(band[("uk:lsoa:E01011949", "T")][7], 220_000)
        self.assertEqual(band[("uk:lad:E06000001", "*")][4], 1)
        self.assertEqual(band[("uk:lsoa:E01011949", "*")][2], date(2023, 1, 1))

    def test_typical_price_falls_back_to_the_msoa_with_20_sales(self):
        period = date(2026, 6, 1)
        bands = [("uk:lsoa:E01011949", "*", None, period, 3, 0, 0, 150_000, 0, 0),
                 ("uk:msoa:E02002491", "*", None, period, 25, 0, 0, 180_000, 0, 0)]
        rows = {(r[0], r[1]): r for r in t.typical_price_rows(bands, AREAS, period)}
        self.assertEqual(rows[("uk:lsoa:E01011949", "typical-price")][3:], (180_000, 0, 25, "fallback"))
        self.assertEqual(rows[("uk:lsoa:E01011949", "typical-price-flat")][6], "suppressed")


class DepthAndZoneTests(unittest.TestCase):
    def test_turnover_counts_distinct_homes_against_council_tax_homes(self):
        sales = [sale(day=date(2026, 5, 1), dwelling="a"), sale(day=date(2026, 6, 1), dwelling="a"),
                 sale(day=date(2026, 6, 2), dwelling="b", tenure="L")]
        rows = {r[0]: r for r in t.market_depth_rows(sales, AREAS, date(2026, 7, 31),
                                                     {"uk:lsoa:E01011949": 200, "uk:lsoa:E01011950": 100}, {})}
        lsoa = rows["uk:lsoa:E01011949"]
        self.assertEqual(lsoa[2:6], (3, 200, 2, 1.0))
        self.assertEqual(lsoa[7], 0.333)
        self.assertEqual(rows["uk:lsoa:E01011950"][2:5], (0, 100, 0))   # homes, no sales: still a row

    def test_zones_need_20_sales_for_a_distribution_and_2004_for_the_index(self):
        cpih = {date(2004, 3, 1): 80.0, date(2026, 6, 1): 130.0}
        sales = [sale(day=date(2026, 1, 1), price=200_000 + i * 1000) for i in range(20)]
        sales += [sale(day=date(2004, 3, 1), price=100_000) for _ in range(10)]
        names = {"TS24": {"HIGH STREET": "High Street"}}
        distribution, index_rows, streets = t.zone_rows(sales, AREAS, t.month_index(date(2026, 7, 1)), cpih, names)
        self.assertEqual({(r[0], r[1]) for r in distribution}, {("sector", "TS24 7"), ("district", "TS24")})
        self.assertEqual(sum(distribution[0][-1]), 20)
        self.assertEqual(len(distribution[0][-2]), 21)
        sector_2026 = next(r for r in index_rows if r[:4] == ("sector", "TS24 7", "all", 2026))
        self.assertEqual(sector_2026[6], round(100 * 2095 / 1000, 1))
        self.assertEqual(streets, [("TS24 7", "High Street", 20, 100, 2095)])


if __name__ == "__main__":
    unittest.main()
