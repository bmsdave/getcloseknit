"""Task 11: the flagged per-home estimate and the unflagged annualised change since the last sale."""
import os
import unittest
from unittest import mock

from area_api import valuation

# The borough's flat trend (market.area_market, R5): 12-month windows ending each June.
BOROUGH_FLATS = {"propertyType": "F", "points": [
    {"windowEnd": "2006-06", "sales": 300, "medianPrice": 200_000},
    {"windowEnd": "2016-06", "sales": 300, "medianPrice": 400_000},
    {"windowEnd": "2021-06", "sales": 300, "medianPrice": None},
    {"windowEnd": "2026-06", "sales": 300, "medianPrice": 500_000},
]}
LOCAL_FLATS = {"medianPrice": 600_000, "p25": 560_000, "p75": 640_000,
               "medianPricePerSquareMetre": 10_000, "p25PricePerSquareMetre": 8_500,
               "p75PricePerSquareMetre": 11_800}
LAST_SALE = {"date": "2016-06-10", "price": 500_000}


def flags(**env):
    return mock.patch.dict(os.environ, {"CLOSE_KNIT_EPC_PER_HOME": "", **env})


class AnnualisedChangeTests(unittest.TestCase):
    def test_two_sales_compare_the_home_with_the_borough_over_the_same_years(self):
        sale = {**LAST_SALE, "previous": {"date": "2006-03-01", "price": 250_000}}
        self.assertEqual(valuation.annualised_change(sale, BOROUGH_FLATS),
                         {"home": 7.0, "borough": 7.2, "since": 2006, "until": 2016})

    def test_a_single_sale_shows_only_the_borough_change_since_it(self):
        # Never a figure for the home today: the home's own change needs two recorded prices.
        self.assertEqual(valuation.annualised_change(LAST_SALE, BOROUGH_FLATS),
                         {"home": None, "borough": 2.3, "since": 2016, "until": 2026})

    def test_none_without_a_sale_or_an_index(self):
        self.assertIsNone(valuation.annualised_change(None, BOROUGH_FLATS))
        self.assertIsNone(valuation.annualised_change({"date": "2006-03-01", "price": 1}, None))
        # The sale year has no point (before the trend) and the home has no earlier sale.
        self.assertIsNone(valuation.annualised_change({"date": "2001-01-01", "price": 1}, BOROUGH_FLATS))

    def test_a_point_with_no_median_is_no_index(self):
        self.assertIsNone(valuation.annualised_change({"date": "2021-02-01", "price": 1}, BOROUGH_FLATS))

    def test_only_standard_sales_count(self):
        self.assertIsNone(valuation.annualised_change({**LAST_SALE, "standard": False}, BOROUGH_FLATS))
        # A non-standard earlier sale is ignored: the borough change since the last sale alone.
        sale = {**LAST_SALE, "standard": True, "previous": {"date": "2006-03-01", "price": 1, "standard": False}}
        self.assertEqual(valuation.annualised_change(sale, BOROUGH_FLATS),
                         {"home": None, "borough": 2.3, "since": 2016, "until": 2026})

    def test_sales_under_a_year_apart_have_no_home_change(self):
        sale = {"date": "2016-06-10", "price": 500_000, "previous": {"date": "2016-01-10", "price": 450_000}}
        self.assertIsNone(valuation.annualised_change(sale, BOROUGH_FLATS))


class EstimateTests(unittest.TestCase):
    def test_floor_area_method_with_per_home_epc(self):
        home = {"floorAreaSquareMetres": 50.4, "lastSale": LAST_SALE}
        with flags(CLOSE_KNIT_EPC_PER_HOME="1"):
            self.assertEqual(valuation.estimate(home, LOCAL_FLATS, BOROUGH_FLATS), {
                "value": 505_000, "low": 430_000, "high": 595_000, "method": "floor-area",
                "vsLocalMedianPerSqm": 24.0, "vsLocalTypeMedian": -15.8})

    def test_indexed_sale_method_without_per_home_epc(self):
        home = {"floorAreaSquareMetres": 50.4, "lastSale": LAST_SALE}  # a floor area is ignored with EPC off
        with flags():
            self.assertEqual(valuation.estimate(home, LOCAL_FLATS, BOROUGH_FLATS), {
                "value": 625_000, "low": 585_000, "high": 665_000, "method": "indexed-sale",
                "vsLocalMedianPerSqm": None, "vsLocalTypeMedian": 4.2})

    def test_a_non_standard_last_sale_is_not_indexed(self):
        home = {"floorAreaSquareMetres": None, "lastSale": {**LAST_SALE, "standard": False}}
        with flags():
            self.assertIsNone(valuation.estimate(home, LOCAL_FLATS, BOROUGH_FLATS))

    def test_indexed_sale_when_the_area_has_no_price_per_square_metre(self):
        home = {"floorAreaSquareMetres": 50.4, "lastSale": LAST_SALE}
        local = {**LOCAL_FLATS, "medianPricePerSquareMetre": None}
        with flags(CLOSE_KNIT_EPC_PER_HOME="1"):
            out = valuation.estimate(home, local, BOROUGH_FLATS)
        self.assertEqual((out["method"], out["value"], out["vsLocalMedianPerSqm"]), ("indexed-sale", 625_000, None))

    def test_rounds_to_five_thousand_pounds(self):
        self.assertEqual(valuation.round_value(502_499), 500_000)
        self.assertEqual(valuation.round_value(502_500), 505_000)
        home = {"floorAreaSquareMetres": 50.0, "lastSale": None}
        local = {**LOCAL_FLATS, "medianPricePerSquareMetre": 10_049.9}  # £502,495
        with flags(CLOSE_KNIT_EPC_PER_HOME="1"):
            self.assertEqual(valuation.estimate(home, local, None)["value"], 500_000)

    def test_none_without_inputs(self):
        with flags(CLOSE_KNIT_EPC_PER_HOME="1"):
            self.assertIsNone(valuation.estimate({"floorAreaSquareMetres": None, "lastSale": None},
                                                 LOCAL_FLATS, BOROUGH_FLATS))
            self.assertIsNone(valuation.estimate({"floorAreaSquareMetres": None, "lastSale": LAST_SALE},
                                                 LOCAL_FLATS, None))
            self.assertIsNone(valuation.estimate({"floorAreaSquareMetres": 50.4, "lastSale": LAST_SALE}, None, None))
            # No local median to set the estimate against.
            self.assertIsNone(valuation.estimate({"floorAreaSquareMetres": 50.4, "lastSale": LAST_SALE},
                                                 {**LOCAL_FLATS, "medianPrice": None}, BOROUGH_FLATS))

    def test_type_index_picks_the_borough_series_for_the_type(self):
        market = {"trend": [{"propertyType": "all", "points": []}, BOROUGH_FLATS]}
        self.assertIs(valuation.type_index(market, "F"), BOROUGH_FLATS)
        self.assertIsNone(valuation.type_index(market, "T"))
        self.assertIsNone(valuation.type_index(None, "F"))


class PerSqmComparisonTests(unittest.TestCase):
    """B14 (#162): with the floor-area method, vsLocalMedianPerSqm compares the home's
    own £/m² (its last standard sale, indexed to today) with the local same-type
    median — never the estimate's own rounding error."""

    def test_floor_area_method_compares_the_homes_own_price_per_sqm(self):
        # Last sale £500k (2016) indexed by the borough flat trend 400k -> 500k = £625k; 625,000 / 50.4 m2
        # = £12,401/m2 against a local median of £10,000/m2: +24.0%, not the £5k rounding error (+0.2%).
        home = {"floorAreaSquareMetres": 50.4, "lastSale": LAST_SALE}
        with flags(CLOSE_KNIT_EPC_PER_HOME="1"):
            out = valuation.estimate(home, LOCAL_FLATS, BOROUGH_FLATS)
        self.assertEqual(out["method"], "floor-area")
        self.assertEqual(out["vsLocalMedianPerSqm"], 24.0)

    def test_floor_area_method_without_a_standard_sale_has_no_per_sqm_comparison(self):
        home = {"floorAreaSquareMetres": 50.4, "lastSale": None}
        with flags(CLOSE_KNIT_EPC_PER_HOME="1"):
            out = valuation.estimate(home, LOCAL_FLATS, BOROUGH_FLATS)
        self.assertEqual(out["method"], "floor-area")
        self.assertIsNone(out["vsLocalMedianPerSqm"])


if __name__ == "__main__":
    unittest.main()
