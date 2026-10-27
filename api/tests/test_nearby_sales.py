"""Sales in the same building and on the same street (wave 1 / feature 3):
other homes only, no per-sale floor area or £/m², median £/m² from 5 standard
sales, 10-year / 50-row caps, suppressed homes left out."""
import unittest

from area_api import evidence
from area_api.evidence import AddressNotFound, MalformedQuery, ReleaseUnavailable
from tests.test_production_evidence import _sale, make_reader, seed_production_fixture

SUBJECT = "uk:addr:a1b2c3d4e5f6"


class NearbySalesTests(unittest.TestCase):
    def setUp(self):
        self.connection = seed_production_fixture()
        self.reader = make_reader(self.connection)

    def test_building_lists_other_flats_without_floor_area(self):
        payload = self.reader.get_nearby_sales(SUBJECT)
        building = payload["building"]

        self.assertEqual(payload["schemaVersion"], "nearby-sales.v1")
        self.assertEqual(payload["windowYears"], 10)
        self.assertEqual([sale["nominalPrice"] for sale in building["sales"]], [610000, 495000, 450000])
        self.assertEqual(building["sales"][0], {"date": "2024-03-01", "nominalPrice": 610000,
                                                "propertyType": "flat", "tenure": "leasehold", "newBuild": True,
                                                "partShareLikely": False})
        self.assertEqual(building["saleCount"], 3)

    def test_median_needs_five_standard_sales_with_floor_area(self):
        payload = self.reader.get_nearby_sales(SUBJECT)

        self.assertIsNone(payload["building"]["medianPricePerSquareMetre"])
        self.assertEqual(payload["building"]["medianSampleSize"], 2)
        self.assertEqual(payload["street"]["medianPricePerSquareMetre"], 10500)  # category B excluded
        self.assertEqual(payload["street"]["medianSampleSize"], 6)

    def test_street_excludes_the_subject_building(self):
        street = self.reader.get_nearby_sales(SUBJECT)["street"]

        self.assertEqual(street["saleCount"], 7)
        self.assertNotIn(610000, [sale["nominalPrice"] for sale in street["sales"]])
        self.assertEqual(street["sales"][0]["date"], "2025-09-01")

    def test_suppressed_homes_are_left_out(self):
        self.connection.suppressed.add("uk:addr:00000000b001")

        building = self.reader.get_nearby_sales(SUBJECT)["building"]

        self.assertNotIn(610000, [sale["nominalPrice"] for sale in building["sales"]])
        self.assertEqual(building["saleCount"], 2)

    def test_suppressed_subject_is_not_found(self):
        self.connection.suppressed.add(SUBJECT)

        with self.assertRaises(AddressNotFound):
            self.reader.get_nearby_sales(SUBJECT)

    def test_rows_are_capped_at_fifty(self):
        for index in range(60):
            self.connection.sales.append(_sale(f"uk:addr:{index:012x}", f"2024-01-{index % 28 + 1:02d}", 300000 + index))

        building = self.reader.get_nearby_sales(SUBJECT)["building"]

        self.assertEqual(len(building["sales"]), 50)
        self.assertEqual(building["saleCount"], 63)

    def test_address_without_keys_has_no_groups(self):
        self.connection.sales = [sale for sale in self.connection.sales if sale["address_id"] != SUBJECT]

        payload = self.reader.get_nearby_sales(SUBJECT)

        self.assertIsNone(payload["building"])
        self.assertIsNone(payload["street"])

    def test_rejects_malformed_unknown_and_unreleased(self):
        with self.assertRaises(MalformedQuery):
            self.reader.get_nearby_sales("not-an-address")
        with self.assertRaises(AddressNotFound):
            self.reader.get_nearby_sales("uk:addr:000000000000")
        self.connection.active_id = None
        with self.assertRaises(ReleaseUnavailable):
            self.reader.get_nearby_sales(SUBJECT)

    def test_tower_flats_across_unit_postcodes_share_one_building(self):
        """B5 (#154): sales under two unit postcodes of one tower share one building_key
        (built with the sector formula); the building group counts both, the street
        excludes both."""
        tower = "t" * 32
        self.connection.sales.append(_sale(SUBJECT, "2025-06-01", 820000, 10500.0, building_key=tower))
        self.connection.sales.append(_sale("uk:addr:00000000d001", "2023-05-01", 800000, 10000.0,
                                          building_key=tower))
        payload = self.reader.get_nearby_sales(SUBJECT)
        building = payload["building"]
        self.assertEqual(building["saleCount"], 1)  # the other tower flat; the subject's own sales are out
        self.assertEqual([sale["nominalPrice"] for sale in building["sales"]], [800000])
        street = payload["street"]
        self.assertNotIn(800000, [sale["nominalPrice"] for sale in street["sales"]])

    def test_disclaimer_names_the_sector_rule(self):
        payload = self.reader.get_nearby_sales(SUBJECT)
        self.assertIn("same postcode sector", payload["disclaimer"])
        self.assertNotIn("same postcode,", payload["disclaimer"])

    def test_sales_outside_the_release_are_ignored(self):
        for sale in self.connection.sales:
            sale["source_release_id"] = "not-a-member"

        payload = self.reader.get_nearby_sales(SUBJECT)

        self.assertIsNone(payload["building"])
        self.assertIsNone(payload["street"])


    def test_likely_part_share_sales_are_excluded_from_the_building_median(self):
        # Issue #211: a first-tranche shared-ownership sale two weeks after the full
        # sale at ~31% of it must not drag the building median down.
        self.connection.sales += [
            _sale("uk:addr:00000000d001", "2021-04-26", 348635, 6836.0),
            _sale("uk:addr:00000000d001", "2021-05-10", 107500, 2108.0),
            _sale("uk:addr:00000000d002", "2023-06-01", 500000, 10000.0),
            _sale("uk:addr:00000000d003", "2022-08-01", 520000, 9500.0),
        ]

        building = self.reader.get_nearby_sales(SUBJECT)["building"]

        self.assertEqual(building["saleCount"], 7)
        self.assertEqual(building["excludedPartShare"], 1)
        self.assertEqual(building["medianSampleSize"], 5)
        # Pre-fix this was 9650: the median of (11000, 10000, 9800, 9500, 6836, 2108).
        self.assertEqual(building["medianPricePerSquareMetre"], 9800)
        flagged = [sale["nominalPrice"] for sale in building["sales"] if sale["partShareLikely"]]
        self.assertEqual(flagged, [107500])
        self.assertIn("part share", building and self.reader.get_nearby_sales(SUBJECT)["disclaimer"])


class NearbySalesSqlTests(unittest.TestCase):
    """The guards the fake mirrors must be in the SQL Postgres runs."""

    def test_both_scopes_carry_the_guards(self):
        for sql in (evidence.NEARBY_BUILDING_SQL, evidence.NEARBY_STREET_SQL):
            self.assertIn(evidence.NOT_SUPPRESSED_ADDRESS, sql)
            self.assertIn("t.address_id <> %(address_id)s", sql)
            self.assertIn("make_interval(years => %(years)s)", sql)
            self.assertIn("LIMIT %(limit)s", sql)
            self.assertIn("summary.median_sample >= %(median_min)s", sql)
            self.assertIn("FILTER (WHERE ppd_category = 'A' AND NOT part_share_likely)", sql)

    def test_both_scopes_exclude_likely_part_share_sales(self):
        # Issue #211: the fake's exclusion must be in the SQL Postgres runs.
        for sql in (evidence.NEARBY_BUILDING_SQL, evidence.NEARBY_STREET_SQL):
            self.assertIn("part_share_likely", sql)
            self.assertIn("excluded_part_share", sql)
            self.assertIn("s2.price >= 2 * t.price", sql)
            self.assertIn("<= 90", sql)

    def test_rows_never_select_floor_area_or_price_per_square_metre(self):
        for sql in (evidence.NEARBY_BUILDING_SQL, evidence.NEARBY_STREET_SQL):
            outer = sql.rsplit("SELECT summary.sale_count", 1)[1].split("FROM summary", 1)[0]
            self.assertNotIn("floor", outer)
            self.assertNotIn("r.price_per_square_metre", outer)

    def test_caps(self):
        self.assertEqual((evidence.NEARBY_WINDOW_YEARS, evidence.NEARBY_ROW_LIMIT, evidence.NEARBY_MEDIAN_MIN),
                         (10, 50, 5))

    def test_street_skips_the_subject_building(self):
        self.assertIn("t.building_key IS DISTINCT FROM %(building_key)s", evidence.NEARBY_STREET_SQL)


if __name__ == "__main__":
    unittest.main()


class SameNamedStreetSalesTests(unittest.TestCase):
    """#202: the nearby-sales street group is one physical street (name + postcode district)."""

    def test_same_named_street_in_another_outcode_is_not_pooled(self):
        connection = seed_production_fixture()
        w5, w5b, ub2 = "uk:addr:00000000d501", "uk:addr:00000000d502", "uk:addr:00000000e501"
        for addr, display, postcode, lsoa in (
                (w5, "68 Warwick Road, London, W5 5PT", "W5 5PT", "uk:lsoa:E01000004"),
                (w5b, "70 Warwick Road, London, W5 5PT", "W5 5PT", "uk:lsoa:E01000004"),
                (ub2, "16 Warwick Road, Southall, UB2 4NX", "UB2 4NX", "uk:lsoa:E01000005")):
            connection.addresses[addr] = {"id": addr, "display_address": display, "postcode": postcode,
                                          "geography_id": lsoa, "source_release_id": "src-test"}
        warwick_key = "warwick-road-ealing"
        connection.sales += [
            _sale(w5, "2024-06-01", 500000, 8000.0, building_key="w5" * 32, street_key=warwick_key),
            _sale(w5b, "2023-06-01", 480000, 7800.0, building_key="wb" * 32, street_key=warwick_key),
            _sale(ub2, "2024-03-01", 400000, 7000.0, building_key="u5" * 32, street_key=warwick_key),
        ]
        reader = make_reader(connection)
        self.assertEqual(reader.get_nearby_sales_summary(w5)["street"]["saleCount"], 1)
        self.assertEqual(reader.get_nearby_sales_summary(ub2)["street"]["saleCount"], 0)

    def test_disclaimer_names_the_postcode_district_grouping(self):
        connection = seed_production_fixture()
        summary = make_reader(connection).get_nearby_sales_summary("uk:addr:a1b2c3d4e5f6")
        self.assertIn("same street name in the same postcode district", summary["disclaimer"])
