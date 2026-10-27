import json
import os
import unittest
from datetime import date
from unittest import mock

from area_api import home_match
from area_api.home_match import best_match, home_block, street_of, value_range

AREA = "uk:lsoa:E01000004"
FACTS = {"floorAreaSqm": 70, "propertyType": "flat", "epcRating": "C", "bedrooms": 2}


def home(address_id, floor, **changes):
    row = {"address_id": address_id, "display_address": f"{address_id[-1]} Middleton Road, London E8 4BL",
           "geography_id": AREA, "uprn": None, "sale_type": "F", "epc_type": "Flat", "built_form": None,
           "current_rating": "C", "habitable_rooms": 3, "epc_date": "2019-05-01", "floor": floor, "hidden": False}
    return {**row, **changes}


class FakeConnection:
    """Dispatches on each statement's first-line marker, as test_production_evidence does."""

    def __init__(self, candidates=(), sales=(), areas=None, bands=(), years=()):
        self.candidates, self.sales, self.areas = list(candidates), list(sales), areas
        self.bands, self.years = list(bands), list(years)
        self.statements = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, params=()):
        self.statements.append((sql, params))
        marker = sql.split("\n", 1)[0]
        return {
            "-- home-match:postcode": lambda: self.candidates,
            "-- home-match:street": lambda: self.candidates,
            "-- home-match:sales": lambda: self.sales,
            "-- property-profile:areas": lambda: [self.areas] if self.areas else [],
            "-- property-profile:price-bands": lambda: self.bands,
            "-- property-profile:price-year": lambda: self.years,
        }[marker]()


class StreetTests(unittest.TestCase):
    def test_the_street_is_read_from_the_display_address(self):
        self.assertEqual(street_of("Flat 3, 12 Middleton Road, London, E8"), "MIDDLETON ROAD")
        self.assertEqual(street_of("Middleton Road, London E8"), "MIDDLETON ROAD")
        self.assertIsNone(street_of("London, E8"))
        self.assertIsNone(street_of(None))


class BestMatchTests(unittest.TestCase):
    def test_one_fitting_home_is_a_high_confidence_match(self):
        row, confidence = best_match(FACTS, [home("a1", 71.5), home("a2", 95)])

        self.assertEqual((row["address_id"], confidence), ("a1", "high"))

    def test_two_homes_that_fit_equally_give_nothing(self):
        self.assertIsNone(best_match(FACTS, [home("a1", 70), home("a2", 69.5)]))

    def test_one_clearly_best_home_is_medium(self):
        rows = [home("a1", 70), home("a2", 70, current_rating="E")]

        row, confidence = best_match(FACTS, rows)
        self.assertEqual((row["address_id"], confidence), ("a1", "medium"))

    def test_a_home_without_a_floor_area_lowers_a_unique_match_to_medium(self):
        self.assertEqual(best_match(FACTS, [home("a1", 70), home("a2", None)])[1], "medium")

    def test_floor_area_is_required(self):
        self.assertIsNone(best_match({**FACTS, "floorAreaSqm": None}, [home("a1", 70)]))

    def test_a_contradicting_type_rules_a_home_out(self):
        self.assertIsNone(best_match({**FACTS, "propertyType": "terraced"}, [home("a1", 70)]))

    def test_a_hidden_home_is_never_matched(self):
        self.assertIsNone(best_match(FACTS, [home("a1", 70, hidden=True)]))

    def test_a_hidden_home_that_could_be_the_listing_is_not_replaced_by_its_neighbour(self):
        self.assertIsNone(best_match(FACTS, [home("a1", 70, hidden=True), home("a2", 70, current_rating="E")]))
        self.assertIsNone(best_match(FACTS, [home("a1", None, hidden=True), home("a2", 70)]))

    def test_a_hidden_home_of_another_size_does_not_stop_the_match(self):
        row, _ = best_match(FACTS, [home("a1", 120, hidden=True), home("a2", 70)])

        self.assertEqual(row["address_id"], "a2")


AREAS = {"lsoa_id": AREA, "lsoa_name": "Hackney 031C", "msoa_id": "uk:msoa:E1", "msoa_name": "Hackney 031",
         "borough_id": "uk:lad:E09000012", "borough_name": "Hackney"}
BANDS = [{"geography_id": AREA, "sales": 24, "p25": 400_000, "p50": 500_000, "p75": 600_000}]
YEARS = [{"geography_id": AREA, "sales": 22, "p50": 400_000}]
SALES = [{"date": "2012-03-01", "price": 300_000, "property_type": "F", "ppd_category": "A"},
         {"date": "2018-06-15", "price": 420_000, "property_type": "F", "ppd_category": "A"}]


class HomeBlockTests(unittest.TestCase):
    def block(self, with_value=True, sales=SALES, bands=BANDS, today=date(2026, 10, 18), **facts):
        connection = FakeConnection([home("a1", 70), home("a2", 95)], sales, AREAS, bands, YEARS)
        found = home_block(lambda: connection, {**FACTS, **facts}, postcode="e8 4bl", area_id=AREA,
                           address=None, with_value=with_value, today=today)
        return found, connection

    def test_the_matched_home_has_its_address_and_recorded_sales(self):
        found, connection = self.block(with_value=False)

        self.assertEqual(found, {"type": "home", "address": "1 Middleton Road, London E8 4BL", "confidence": "high",
                                 "sales": [{"date": "2012-03-01", "price": 300000},
                                           {"date": "2018-06-15", "price": 420000}]})
        self.assertEqual(connection.statements[0][1], ("E8 4BL", home_match.CANDIDATE_LIMIT))
        self.assertFalse(any("price-bands" in sql for sql, _ in connection.statements))

    def test_epc_facts_follow_the_per_home_epc_policy(self):
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_EPC_PER_HOME": "1"}):
            found, _ = self.block(with_value=False)

        self.assertEqual(found["epc"], {"rating": "C", "floorAreaSqm": 70, "date": "2019-05-01"})

    def test_the_value_is_the_last_sale_moved_by_the_area_and_spread_like_its_middle_half(self):
        found, _ = self.block()

        # 420,000 x 500,000 / 400,000 = 525,000; x 0.8 and x 1.2.
        self.assertEqual((found["value"]["low"], found["value"]["high"]), (420_000, 630_000))
        self.assertIn("not a valuation", found["value"]["method"])
        self.assertNotIn("worth", json.dumps(found).lower())

    def test_no_value_from_a_sale_older_than_fifteen_years(self):
        found, _ = self.block(today=date(2033, 7, 1))

        self.assertNotIn("value", found)
        self.assertIn("sales", found)

    def test_no_value_from_fewer_than_five_sales(self):
        found, _ = self.block(bands=[{**BANDS[0], "sales": 4}])

        self.assertNotIn("value", found)

    def test_no_value_from_a_non_standard_sale(self):
        found, _ = self.block(sales=[{**SALES[1], "ppd_category": "B"}])

        self.assertNotIn("value", found)

    def test_an_ambiguous_listing_gives_no_block(self):
        connection = FakeConnection([home("a1", 70), home("a2", 70)])

        self.assertIsNone(home_block(lambda: connection, FACTS, postcode="E8 4BL", area_id=AREA, address=None,
                                     with_value=True, today=date(2026, 10, 18)))
        self.assertEqual(len(connection.statements), 1)

    def test_without_a_postcode_the_street_is_searched_in_the_area(self):
        connection = FakeConnection([home("a1", 70)])
        home_block(lambda: connection, FACTS, postcode=None, area_id=AREA, address="Middle_ton Road, London, E8",
                   with_value=False, today=date(2026, 10, 18))

        sql, params = connection.statements[0]
        self.assertTrue(sql.startswith("-- home-match:street"))
        self.assertEqual(params[:2], (AREA, "%MIDDLE\\_TON ROAD%"))

    def test_without_postcode_or_street_nothing_is_read(self):
        connection = FakeConnection()

        self.assertIsNone(home_block(lambda: connection, FACTS, postcode=None, area_id=AREA, address="London",
                                     with_value=False, today=date(2026, 10, 18)))
        self.assertEqual(connection.statements, [])


class ValueRangeTests(unittest.TestCase):
    def test_the_first_level_with_enough_sales_both_years_is_used(self):
        named = {"lsoa": ("l", "L"), "msoa": ("m", "M"), "borough": ("b", "B")}
        bands = {"l": {"sales": 30, "p25": 1, "p50": 2, "p75": 3},
                 "m": {"sales": 200, "p25": 400_000, "p50": 500_000, "p75": 600_000}}
        years = {"l": {"sales": 3, "p50": 1}, "m": {"sales": 150, "p50": 500_000}}

        value = value_range(500_000, 2020, "F", named, bands, years)
        self.assertEqual((value["low"], value["high"]), (400_000, 600_000))
        self.assertIn("in M since then", value["method"])


if __name__ == "__main__":
    unittest.main()
