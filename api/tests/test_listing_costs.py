"""Mirrors web/tests/stamp-duty.test.ts: the Python port must give the web tool's figures."""
import unittest

from area_api.listing_costs import (council_tax_by_band, council_tax_yearly, costs_block, monthly_repayment, stamp_duty)


def sdlt(price, first=False, additional=False, non_resident=False):
    return stamp_duty(price, first_time_buyer=first, additional_property=additional, non_uk_resident=non_resident)


class StampDutyTests(unittest.TestCase):
    def test_gov_uk_worked_example_home_mover(self):
        self.assertEqual(sdlt(295_000), {"total": 4_750, "regime": "standard", "surchargePct": 0})

    def test_gov_uk_worked_example_first_time_buyer(self):
        self.assertEqual(sdlt(500_000, first=True), {"total": 10_000, "regime": "first-time-buyer", "surchargePct": 0})

    def test_first_time_buyer_relief_is_lost_entirely_above_500k(self):
        result = sdlt(500_001, first=True)
        self.assertEqual((result["regime"], result["total"]), ("standard", 15_000))

    def test_all_five_bands(self):
        self.assertEqual(sdlt(1_600_000)["total"], 105_750)

    def test_additional_property_adds_five_points(self):
        self.assertEqual(sdlt(300_000, additional=True), {"total": 20_000, "regime": "standard", "surchargePct": 5})

    def test_non_resident_adds_two_points(self):
        self.assertEqual(sdlt(295_000, non_resident=True)["total"], 10_650)

    def test_both_surcharges_stack(self):
        self.assertEqual(sdlt(500_000, additional=True, non_resident=True),
                         {"total": 50_000, "regime": "standard", "surchargePct": 7})

    def test_non_resident_first_time_buyer_keeps_relief(self):
        result = sdlt(400_000, first=True, non_resident=True)
        self.assertEqual((result["regime"], result["total"]), ("first-time-buyer", 13_000))

    def test_first_time_buyer_with_another_home_pays_standard_plus_surcharge(self):
        result = sdlt(200_000, first=True, additional=True)
        self.assertEqual((result["regime"], result["total"]), ("standard", 11_500))

    def test_surcharge_does_not_apply_under_40k(self):
        self.assertEqual(sdlt(30_000, additional=True), {"total": 0, "regime": "standard", "surchargePct": 0})
        self.assertEqual(sdlt(40_000, additional=True)["total"], 2_000)

    def test_rounded_down_to_the_pound(self):
        self.assertEqual(sdlt(125_099)["total"], 1)

    def test_zero_and_invalid_prices(self):
        self.assertEqual(sdlt(0)["total"], 0)
        for bad in (-1, float("nan")):
            with self.assertRaisesRegex(ValueError, "price"):
                sdlt(bad)


class MortgageAndCouncilTaxTests(unittest.TestCase):
    def test_repayment_mortgage(self):
        self.assertAlmostEqual(monthly_repayment(540_000, 4.5, 30), 2736.1, places=1)
        self.assertEqual(monthly_repayment(300_000, 0, 25), 1000)
        self.assertEqual(monthly_repayment(0, 5, 25), 0)

    def test_council_tax_comes_from_the_borough_table(self):
        civic = {"councilTax": {"bands": [{"band": "A", "amount": 1200.0}, {"band": "H", "amount": None}]}}
        self.assertEqual(council_tax_yearly(civic, "A"), 1200.0)
        self.assertIsNone(council_tax_yearly(civic, "H"))
        self.assertIsNone(council_tax_yearly(civic, "I"))
        self.assertIsNone(council_tax_yearly(None, "A"))

    def test_council_tax_by_band_is_a_month_for_a_to_h(self):
        civic = {"councilTax": {"bands": [{"band": "A", "amount": 1200.0}, {"band": "H", "amount": None},
                                          {"band": "I", "amount": 9000.0}]}}
        self.assertEqual(council_tax_by_band(civic), {"A": 100})
        self.assertEqual(council_tax_by_band(None), {})

    def test_a_cash_buyer_has_no_mortgage(self):
        block = costs_block(500_000, {"depositPct": 100, "ratePct": 4.5, "years": 30, "firstTime": False,
                                      "additionalHome": False}, None, None, None, [])
        self.assertEqual((block["monthly"], block["upfront"][0]["amount"]), (0, 500_000))


if __name__ == "__main__":
    unittest.main()
