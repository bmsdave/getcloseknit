"""Issue #208: an MSOA/borough £/m² aggregated on the fly from LSOA values must not
read 'observed' with high confidence when its children are fallbacks."""
import unittest

from area_api import evidence, tools
from area_api.tools import AreaMetricInput, ToolContext
from tests.test_production_evidence import PRICE_RELEASE, make_reader, seed_production_fixture

L4, L5 = "uk:lsoa:E01000004", "uk:lsoa:E01000005"
MSOA, BOROUGH = "uk:msoa:E02000004", "uk:lad:E09000007"
PRICE = "price-per-square-metre"


def _row(geography_id, value, n, quality):
    return {"geography_id": geography_id, "metric_id": PRICE, "period": "2026-06", "value": value,
            "region_percentile": 73, "country_percentile": None, "sample_count": n,
            "quality": quality, "source_release_id": PRICE_RELEASE}


def _all_fallback():   # live shape: Southwark 015, both LSOAs show the borough's 7971.7
    connection = seed_production_fixture()
    connection.values[:] = [r for r in connection.values if r["metric_id"] != PRICE]
    connection.values += [_row(L4, 7971.7, 5, "fallback"), _row(L5, 7971.7, 0, "fallback")]
    return connection


def _mixed():
    connection = seed_production_fixture()
    connection.values[:] = [r for r in connection.values if r["metric_id"] != PRICE]
    connection.values += [_row(L4, 9800.0, 42, "observed"), _row(L5, 7971.7, 3, "fallback")]
    return connection


class PriceWithinQualityTests(unittest.TestCase):
    def test_an_msoa_median_of_fallback_lsoas_is_not_observed(self):
        summary = make_reader(_all_fallback()).get_area(MSOA, PRICE, "2026-06")["summary"]
        self.assertEqual(summary["value"], 7971.7)
        self.assertNotEqual(summary["quality"], "observed")
        self.assertEqual(summary["quality"], "fallback")
        self.assertEqual(summary["areaCount"], 2)

    def test_get_area_metric_does_not_report_high_confidence_for_it(self):
        context = ToolContext(reader=make_reader(_all_fallback()))
        result = tools._get_area_metric(context, AreaMetricInput(area_id=MSOA, metric_id=PRICE, period="2026-06"))
        self.assertNotEqual(result["confidence"], "high")
        self.assertEqual(result["confidence"], "medium")
        self.assertTrue(all(row["quality"] != "observed" for row in result["evidence"]))
        self.assertIn(evidence.PRICE_WITHIN_CAVEAT, result["caveats"])

    def test_a_borough_median_over_mixed_lsoas_is_not_observed_and_says_how_many_areas(self):
        summary = make_reader(_mixed()).get_area(BOROUGH, PRICE, "2026-06")["summary"]
        self.assertEqual(summary["value"], 8885.9)                     # median(9800, 7971.7), 1 dp
        self.assertEqual(summary["quality"], "fallback")
        self.assertEqual(summary.get("areaCount"), 2)

    def test_an_all_observed_median_stays_observed_and_says_how_many_areas(self):
        connection = seed_production_fixture()
        connection.values[:] = [r for r in connection.values if r["metric_id"] != PRICE]
        connection.values += [_row(L4, 9800.0, 42, "observed"), _row(L5, 9000.0, 30, "observed")]
        summary = make_reader(connection).get_area(MSOA, PRICE, "2026-06")["summary"]
        self.assertEqual(summary["quality"], "observed")
        self.assertEqual(summary.get("areaCount"), 2)

    def test_the_profile_price_for_an_msoa_is_not_observed_either(self):
        profile = make_reader(_all_fallback()).get_profile(MSOA, "2026-06")
        price = next(m for m in profile["metrics"] if m["metricId"] == PRICE)
        self.assertNotEqual(price["quality"], "observed")
        self.assertEqual(price["quality"], "fallback")

    def test_control_a_stored_msoa_row_is_used_as_is(self):
        # The preferred fix stores the MSOA's own rolling series; _area_rows already prefers it.
        connection = _all_fallback()
        connection.values.append({**_row(MSOA, 6535.0, 18, "fallback"), "carrier": "msoa"})
        summary = make_reader(connection).get_area(MSOA, PRICE, "2026-06")["summary"]
        self.assertEqual((summary["value"], summary["sampleCount"], summary["quality"]), (6535.0, 18, "fallback"))
        self.assertNotIn("areaCount", summary)


if __name__ == "__main__":
    unittest.main()
