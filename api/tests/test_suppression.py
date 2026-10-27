"""A confirmed objection hides the dwelling from every per-dwelling read — search,
address history, property by UPRN, property by address text — while area
aggregates stay. The SQL carries the filter; the fake mirrors it."""
import unittest

from area_api import evidence
from area_api.evidence import EvidenceReader
from tests.test_production_evidence import seed_production_fixture

UPRN = "100023336956"
ADDRESS_ID = "uk:addr:a1b2c3d4e5f6"
PER_DWELLING_SQL = (evidence.ADDRESS_SEARCH_SQL, evidence.ADDRESS_SQL, evidence.ADDRESS_TXNS_SQL,
                    evidence.PROPERTY_SQL, evidence.PROPERTY_SEARCH_SQL)


class SuppressionTests(unittest.TestCase):
    def setUp(self):
        self.connection = seed_production_fixture()
        self.reader = EvidenceReader(connect=lambda: self.connection)
        self.connection.addresses.setdefault(ADDRESS_ID, {
            "id": ADDRESS_ID, "display_address": "Flat 1, 10 Sample Street, Westminster, London, SW1A 1AA",
            "postcode": "SW1A 1AA", "geography_id": "uk:lsoa:E01000004", "source_release_id": "price-2026-08"})

    def test_every_per_dwelling_query_filters_on_the_suppression_view(self):
        for sql in PER_DWELLING_SQL:
            self.assertIn("suppressed_dwelling", sql, sql.splitlines()[0])
        self.assertNotIn("suppressed_dwelling", evidence.PROPERTY_TILE_SQL,
                         "tiles are filtered inside property_tile() (migration 007)")

    def test_visible_before_suppression(self):
        self.assertEqual(self.reader.get_property(UPRN)["property"]["uprn"], UPRN)
        self.assertEqual(self.reader.find_property("sample street")["property"]["uprn"], UPRN)
        self.assertTrue([r for r in self.reader.search_areas("Sample Street")["results"] if "addressId" in r])

    def test_hidden_by_uprn_or_by_address_id(self):
        for key in (UPRN, ADDRESS_ID):
            self.connection.suppressed = {key}
            with self.subTest(key=key):
                with self.assertRaises(evidence.PropertyNotFound):
                    self.reader.get_property(UPRN)
                with self.assertRaises(evidence.PropertyNotFound):
                    self.reader.find_property("sample street")
                self.assertEqual([r for r in self.reader.search_areas("Sample Street")["results"]
                                  if "addressId" in r], [])

    def test_address_history_is_hidden_and_areas_still_answer(self):
        self.connection.suppressed = {ADDRESS_ID}
        with self.assertRaises(evidence.AddressNotFound):
            self.reader.get_address_history(ADDRESS_ID)
        self.assertTrue(self.reader.search_areas("camden 001a")["results"], "area search is an aggregate")


if __name__ == "__main__":
    unittest.main()
