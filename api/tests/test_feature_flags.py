import os
import unittest
from unittest import mock

from area_api import epc_policy, feature_flags

ENV = ("CLOSE_KNIT_ADDRESS_MATCH", "CLOSE_KNIT_HOME_VALUE",
       "CLOSE_KNIT_EPC_PER_HOME", "CLOSE_KNIT_PER_HOME_PRICE_PER_SQM", "CLOSE_KNIT_PER_HOME_VALUATION",
       "CLOSE_KNIT_EPC_ADDRESSES", "CLOSE_KNIT_COUNCIL_TAX_BAND", "CLOSE_KNIT_AIR_QUALITY", "CLOSE_KNIT_CENSUS_RANKED",
       "CLOSE_KNIT_OWNERSHIP", "CLOSE_KNIT_ENGLAND", "CLOSE_KNIT_ACCESS")
ALL = ("address_match", "home_value", "epc_per_home", "per_home_price_per_sqm",
       "per_home_valuation", "epc_addresses", "council_tax_band", "air_quality", "england")
NAMES = ["epc", "pricePerSqm", "valuation", "epcAddresses", "councilTaxBand", "laeiAir"]


class FeatureFlagsTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, clear=False)
        patcher.start()
        self.addCleanup(patcher.stop)
        for name in ENV:
            os.environ.pop(name, None)

    def test_all_off_by_default(self):
        for fn in ALL:
            self.assertFalse(getattr(feature_flags, fn)(), fn)
        self.assertEqual(feature_flags.withheld(), NAMES)

    def test_private_preview_turns_every_flag_on(self):
        os.environ["CLOSE_KNIT_ACCESS"] = "private"
        for fn in ALL + ("ownership", "census_ranked"):
            self.assertTrue(getattr(feature_flags, fn)(), fn)
        self.assertEqual(feature_flags.withheld(), [])

    def test_zero_turns_a_flag_off_in_the_preview(self):
        os.environ["CLOSE_KNIT_ACCESS"] = "private"
        os.environ["CLOSE_KNIT_EPC_PER_HOME"] = "0"
        self.assertFalse(feature_flags.epc_per_home())
        self.assertFalse(feature_flags.per_home_price_per_sqm())
        self.assertTrue(feature_flags.per_home_valuation())

    def test_public_call_reads_unset_flags_as_public_in_the_preview(self):
        os.environ["CLOSE_KNIT_ACCESS"] = "private"
        os.environ["CLOSE_KNIT_AIR_QUALITY"] = "1"
        with feature_flags.public_call():
            self.assertFalse(feature_flags.preview())
            self.assertFalse(feature_flags.per_home_valuation())
            self.assertFalse(feature_flags.air_quality())  # a preview "1" never reaches strangers
            self.assertEqual(feature_flags.withheld(), ["epc", "pricePerSqm", "valuation", "epcAddresses",
                                                        "councilTaxBand", "laeiAir"])
        self.assertTrue(feature_flags.per_home_valuation())

    def test_public_call_keeps_an_explicit_1_once_the_site_is_public(self):
        os.environ["CLOSE_KNIT_ACCESS"] = "public"
        os.environ["CLOSE_KNIT_AIR_QUALITY"] = "1"
        with feature_flags.public_call():
            self.assertTrue(feature_flags.air_quality())  # the owner's decision for the public site

    def test_mcp_access_site_lets_public_calls_follow_the_preview(self):
        os.environ["CLOSE_KNIT_ACCESS"] = "private"
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_MCP_ACCESS": "site"}), feature_flags.public_call():
            self.assertTrue(feature_flags.per_home_valuation())

    def test_public_site_keeps_unset_flags_off(self):
        os.environ["CLOSE_KNIT_ACCESS"] = "public"
        for fn in ALL + ("ownership", "census_ranked"):
            self.assertFalse(getattr(feature_flags, fn)(), fn)

    def test_one_means_on(self):
        os.environ["CLOSE_KNIT_AIR_QUALITY"] = "1"
        self.assertTrue(feature_flags.air_quality())
        for value in ("true", "0", " "):
            os.environ["CLOSE_KNIT_AIR_QUALITY"] = value
            self.assertFalse(feature_flags.air_quality(), value)

    def test_withheld_lists_only_off_flags_in_order(self):
        os.environ["CLOSE_KNIT_EPC_PER_HOME"] = "1"
        os.environ["CLOSE_KNIT_COUNCIL_TAX_BAND"] = "1"
        self.assertEqual(feature_flags.withheld(), ["pricePerSqm", "valuation", "epcAddresses", "laeiAir"])

    def test_withheld_for_named_features(self):
        self.assertEqual(feature_flags.withheld(("censusRanked", "laeiAir")), ["laeiAir", "censusRanked"])
        os.environ["CLOSE_KNIT_CENSUS_RANKED"] = "1"
        self.assertEqual(feature_flags.withheld(("censusRanked", "laeiAir")), ["laeiAir"])
        self.assertNotIn("censusRanked", feature_flags.withheld())
        with self.assertRaises(ValueError):
            feature_flags.withheld(("nope",))

    def test_price_per_sqm_needs_epc(self):
        os.environ["CLOSE_KNIT_PER_HOME_PRICE_PER_SQM"] = "1"
        self.assertFalse(feature_flags.per_home_price_per_sqm())
        os.environ["CLOSE_KNIT_EPC_PER_HOME"] = "1"
        self.assertTrue(feature_flags.per_home_price_per_sqm())

    def test_home_value_needs_address_match(self):
        os.environ["CLOSE_KNIT_HOME_VALUE"] = "1"
        self.assertFalse(feature_flags.home_value())
        os.environ["CLOSE_KNIT_ADDRESS_MATCH"] = "1"
        self.assertTrue(feature_flags.home_value())

    def test_epc_policy_delegates(self):
        self.assertFalse(epc_policy.per_home_epc())
        with mock.patch.object(feature_flags, "epc_per_home", return_value=True):
            self.assertTrue(epc_policy.per_home_epc())


if __name__ == "__main__":
    unittest.main()
