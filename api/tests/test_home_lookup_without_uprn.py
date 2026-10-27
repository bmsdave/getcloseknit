"""B2 (#150): a home in `address` (recorded sales) but with no EPC->UPRN link must be
reachable, and a fragment that matches several homes is never resolved to one silently."""
import os
import unittest
from unittest import mock

from area_api import evidence
from area_api.evidence import EvidenceReader
from tests.test_production_evidence import OLD_CRIME, seed_production_fixture

# Added by the fix; the fallback keeps an unfixed tree a test failure rather than an import error.
PropertyAmbiguous = getattr(evidence, "PropertyAmbiguous", type("PropertyAmbiguous", (Exception,), {}))

BATTERSEA = ["uk:addr:7c8b2b59fbf1", "uk:addr:6da61b86a5d0"]  # Apartment 10 and 11, Duval House, SW11 2FR
HILLINGDON_UPRN = "10095321811"


class HomeLookupWithoutUprnTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, {"CLOSE_KNIT_EPC_PER_HOME": "1"})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.connection = seed_production_fixture()
        for number, address_id in zip((10, 11), BATTERSEA):  # in `address` with sales, no `property` row
            self.connection.addresses[address_id] = {
                "id": address_id,
                "display_address": f"Apartment {number}, Duval House, 10 Grant Road, London, SW11 2FR",
                "postcode": "SW11 2FR", "geography_id": "uk:lsoa:E01000004", "source_release_id": OLD_CRIME}
            self.connection.address_txns.append({"address_id": address_id, "date": "2020-11-13", "price": 552900,
                                                 "floor": None, "ppm": None, "source_release_id": OLD_CRIME})
        template = self.connection.properties["100023336956"]  # another home whose name contains "Duval House"
        self.connection.properties[HILLINGDON_UPRN] = {
            **template, "uprn": HILLINGDON_UPRN, "address_id": "uk:addr:4cb573c6e8e8",
            "display_address": "Flat 10, Duval House Meadowlea Close, Harmondsworth, West Drayton, UB7 0BX"}
        self.reader = EvidenceReader(connect=lambda: self.connection)

    def test_address_id_without_uprn_is_a_home(self):
        payload = self.reader.find_property("uk:addr:7c8b2b59fbf1")
        self.assertEqual(payload["property"]["addressId"], "uk:addr:7c8b2b59fbf1")
        self.assertIsNone(payload["property"]["uprn"])

    def test_postcode_of_unlinked_block_lists_candidates(self):
        with self.assertRaises(PropertyAmbiguous) as caught:
            self.reader.find_property("SW11 2FR")
        self.assertEqual(sorted(c["addressId"] for c in caught.exception.candidates), sorted(BATTERSEA))

    def test_exact_substring_of_unlinked_address_is_found(self):
        with self.assertRaises(PropertyAmbiguous) as caught:
            self.reader.find_property("Duval House, 10 Grant Road")
        self.assertEqual(len(caught.exception.candidates), 2)

    def test_name_shared_by_two_places_is_never_a_forced_single_match(self):
        with self.assertRaises(PropertyAmbiguous) as caught:
            self.reader.find_property("Duval House")
        postcodes = {c["displayAddress"].rsplit(", ", 1)[1] for c in caught.exception.candidates}
        self.assertEqual(postcodes, {"SW11 2FR", "UB7 0BX"})

    def test_single_match_still_resolves(self):
        self.assertEqual(self.reader.find_property("sample street")["property"]["uprn"], "100023336956")


class HomeLookupSqlTests(unittest.TestCase):
    def test_search_never_takes_a_blind_first_row(self):
        self.assertNotRegex(evidence.PROPERTY_SEARCH_SQL, r"ORDER BY p\.address\s+LIMIT %s$")
