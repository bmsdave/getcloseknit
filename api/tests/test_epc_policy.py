import os
import unittest
from unittest import mock

from area_api import epc_policy
from area_api import property_profile as pp
from area_api.evidence import EvidenceReader

from test_production_evidence import seed_production_fixture
from test_property_profile import UPRN, FakeConnection


class PerHomeEpcHiddenByDefaultTests(unittest.TestCase):
    """Until the EPC licence allows it, no home's certificate fields leave the API."""

    def setUp(self):
        patcher = mock.patch.dict(os.environ)
        patcher.start()
        self.addCleanup(patcher.stop)
        os.environ.pop("CLOSE_KNIT_EPC_PER_HOME", None)

    def assert_hidden(self, item):
        present = [key for key in epc_policy.PER_HOME_KEYS if item.get(key) is not None]
        self.assertEqual(present, [], item)

    def test_property_profile_facts_sales_and_neighbours(self):
        profile = pp.property_profile(lambda: FakeConnection(), UPRN)["profile"]

        self.assert_hidden(profile["facts"])
        self.assertTrue(profile["sales"])
        for sale in profile["sales"]:
            self.assert_hidden(sale)
            self.assertIn("floorAreaSquareMetres", sale)  # the key stays, as null
        for home in profile.get("otherHomes", []):
            self.assert_hidden(home)

    def test_postcode_homes_and_their_sales(self):
        payload = pp.postcode_homes(lambda: FakeConnection(), "sw1a1aa", include_sales=True)

        self.assertTrue(payload["homes"])
        for home in payload["homes"]:
            self.assert_hidden(home)
            for sale in home.get("sales", []):
                self.assert_hidden(sale)

    def test_address_history_transactions(self):
        connection = seed_production_fixture()
        history = EvidenceReader(connect=lambda: connection).get_address_history("uk:addr:a1b2c3d4e5f6")

        self.assertTrue(history["history"]["transactions"])
        for txn in history["history"]["transactions"]:
            self.assert_hidden(txn)

    def test_the_flag_serves_them(self):
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_EPC_PER_HOME": "1"}):
            facts = pp.property_profile(lambda: FakeConnection(), UPRN)["profile"]["facts"]

        self.assertIsNotNone(facts["floorAreaSquareMetres"])

    def test_non_epc_fields_are_untouched(self):
        item = {"date": "2020-01", "nominalPrice": 500000, "floorAreaSquareMetres": 60, "energyRating": "C"}

        self.assertEqual(epc_policy.per_home(item),
                         {"date": "2020-01", "nominalPrice": 500000, "floorAreaSquareMetres": None, "energyRating": None})


if __name__ == "__main__":
    unittest.main()
