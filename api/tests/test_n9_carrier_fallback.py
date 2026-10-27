"""Issue #206: metrics published for a wider area (income per MSOA; rent change and
mobile coverage per borough) must read the enclosing carrier area's value as a
fallback on a smaller area, not null/'suppressed' with confidence 'none'."""
import unittest

from area_api import tools
from area_api.tools import AreaMetricInput, ToolContext
from tests.test_production_evidence import OLD_CRIME, make_reader, seed_production_fixture

LSOA, MSOA, BOROUGH = "uk:lsoa:E01000005", "uk:msoa:E02000004", "uk:lad:E09000007"


def _with(metric_id, carrier, geography_id, value):
    connection = seed_production_fixture()
    connection.metrics[metric_id] = {
        "id": metric_id, "carrier": carrier, "unit": "test", "direction": "higher-is-more",
        "definition": dict(connection.metrics["crime"]["definition"]),
        "source_release_id": OLD_CRIME,
    }
    connection.values.append({
        "geography_id": geography_id, "metric_id": metric_id, "period": "2026-06", "value": value,
        "region_percentile": 10, "country_percentile": None, "sample_count": None,
        "quality": "observed", "source_release_id": OLD_CRIME})
    return connection


class CarrierFallbackTests(unittest.TestCase):
    def test_msoa_carried_metric_on_an_lsoa_reads_the_msoa_row(self):
        reader = make_reader(_with("income", "msoa", MSOA, 60240.0))
        summary = reader.get_area(LSOA, "income", "2026-06")["summary"]
        self.assertEqual(summary["value"], 60240.0)
        self.assertEqual(summary["quality"], "fallback")
        self.assertEqual(summary["carrierGeographyId"], MSOA)
        self.assertEqual(summary["geographyId"], LSOA)

    def test_borough_carried_metric_on_an_lsoa_and_msoa_reads_the_borough_row(self):
        reader = make_reader(_with("rent-change-1y", "lad", BOROUGH, 6.2))
        for area_id in (LSOA, MSOA):
            with self.subTest(area_id=area_id):
                summary = reader.get_area(area_id, "rent-change-1y", "2026-06")["summary"]
                self.assertEqual((summary["value"], summary["quality"]), (6.2, "fallback"))
                self.assertEqual(summary["carrierGeographyId"], BOROUGH)

    def test_the_tool_does_not_report_confidence_none_for_a_carrier_value(self):
        context = ToolContext(reader=make_reader(_with("mobile-4g-indoor", "lad", BOROUGH, 99.96)))
        result = tools._get_area_metric(context, AreaMetricInput(
            area_id=LSOA, metric_id="mobile-4g-indoor", period="2026-06"))
        self.assertEqual(result["value"]["value"], 99.96)
        self.assertNotEqual(result["confidence"], "none")

    def test_metric_timeline_comes_from_the_carrier_area(self):
        connection = _with("rent-change-1y", "lad", BOROUGH, 6.2)
        connection.values.append({
            "geography_id": BOROUGH, "metric_id": "rent-change-1y", "period": "2026-05", "value": 6.0,
            "region_percentile": 95, "country_percentile": None, "sample_count": None,
            "quality": "observed", "source_release_id": OLD_CRIME})
        payload = make_reader(connection).get_area(LSOA, "rent-change-1y", "2026-06")
        timeline = payload["metricTimeline"]
        self.assertEqual({row["period"] for row in timeline}, {"2026-05", "2026-06"})
        for row in timeline:
            self.assertEqual(row["carrierGeographyId"], BOROUGH)
            self.assertEqual(row["quality"], "fallback")

    def test_a_genuinely_missing_value_stays_suppressed(self):
        # Control: nothing anywhere in the lineage -> still null / 'suppressed'.
        connection = _with("income", "msoa", MSOA, 60240.0)
        connection.values[:] = [r for r in connection.values if r["metric_id"] != "income"]
        connection.values.append({
            "geography_id": "uk:msoa:E02000099", "metric_id": "income", "period": "2026-06", "value": 1.0,
            "region_percentile": 1, "country_percentile": None, "sample_count": None,
            "quality": "observed", "source_release_id": OLD_CRIME})  # another MSOA, so the period exists
        summary = make_reader(connection).get_area(LSOA, "income", "2026-06")["summary"]
        self.assertEqual((summary["value"], summary["quality"]), (None, "suppressed"))

    def test_a_suppressed_carrier_row_stays_suppressed(self):
        connection = _with("income", "msoa", MSOA, 60240.0)
        for row in connection.values:
            if row["metric_id"] == "income":
                row["value"] = None
                row["quality"] = "suppressed"
        summary = make_reader(connection).get_area(LSOA, "income", "2026-06")["summary"]
        self.assertEqual((summary["value"], summary["quality"]), (None, "suppressed"))


class CarrierNameTests(unittest.TestCase):
    """carrierName and carrier for observed, projected (#206) and stored-id (095 ETL) rows."""

    @staticmethod
    def _lookups(connection):
        return [sql for sql, _ in connection.statements if sql.startswith("-- evidence:area-lookup")]

    def test_observed_row_has_no_carrier(self):
        connection = _with("income", "msoa", MSOA, 60240.0)
        summary = make_reader(connection).get_area(MSOA, "income", "2026-06")["summary"]
        self.assertEqual((summary["quality"], summary["carrier"], summary["carrierGeographyId"]),
                         ("observed", "msoa", None))
        self.assertNotIn("carrierName", summary)
        self.assertEqual(self._lookups(connection), [])

    def test_projected_row_names_its_carrier(self):
        connection = _with("income", "msoa", MSOA, 60240.0)
        summary = make_reader(connection).get_area(LSOA, "income", "2026-06")["summary"]
        self.assertEqual((summary["carrier"], summary["carrierGeographyId"], summary["carrierName"]),
                         ("msoa", MSOA, "Camden 001 test area"))
        self.assertEqual(self._lookups(connection), [])

    def _stored(self, carrier_id):
        connection = _with("income", "lsoa", LSOA, 61000.0)
        stored = connection.values[-1]
        stored.update(quality="fallback", carrier_geography_id=carrier_id, carrier_sample_count=40)
        connection.values.append({**stored, "period": "2026-05", "value": 60000.0})
        return connection

    def test_stored_id_row_is_named_with_one_lookup(self):
        connection = self._stored(MSOA)
        payload = make_reader(connection).get_area(LSOA, "income", "2026-06")
        summary = payload["summary"]
        self.assertEqual((summary["geographyId"], summary["value"], summary["quality"]), (LSOA, 61000.0, "fallback"))
        # carrier is the level the value comes from, as for projected rows.
        self.assertEqual((summary["carrier"], summary["carrierGeographyId"], summary["carrierName"],
                          summary["carrierSampleCount"]), ("msoa", MSOA, "Camden 001 test area", 40))
        self.assertEqual({row["carrierName"] for row in payload["metricTimeline"]}, {"Camden 001 test area"})
        self.assertEqual(len(self._lookups(connection)), 1)

    def test_unknown_stored_id_keeps_a_null_name(self):
        connection = self._stored("uk:msoa:E02999999")
        summary = make_reader(connection).get_area(LSOA, "income", "2026-06")["summary"]
        self.assertEqual((summary["carrier"], summary["carrierName"]), ("msoa", None))


if __name__ == "__main__":
    unittest.main()
