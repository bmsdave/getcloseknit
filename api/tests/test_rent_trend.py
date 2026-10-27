"""Rent trend (migration 081): the borough's PIPR series, 1- and 5-year change and London rank as an envelope."""
import contextlib
import unittest
from decimal import Decimal

from area_api import evidence, matching, rent_trend, repository

BOROUGH = {"id": "uk:lad:E09000007", "name": "Camden"}
SOURCE = {"id": "src-ons-pipr-series-2026-08", "source_url": "https://www.ons.gov.uk/pipr.xlsx",
          "release_date": "2026-09-16", "licence": "OGL-3.0", "attribution": "Source: Office for National Statistics",
          "transformation_version": "close-knit-rent-trend-1"}


def point(borough, month, category, rent, index):
    return {"borough": borough, "month": month, "category": category, "rent": rent,
            "index": Decimal(index), "source_release_id": SOURCE["id"]}


SERIES = [
    point("E09000007", "2021-08", "all", 2000, "80"),
    point("E09000007", "2025-08", "all", 2380, "95"),
    point("E09000007", "2026-07", "all", 2500, "99"),
    point("E09000007", "2026-08", "all", 2500, "100"),
    point("E09000007", "2025-08", "2 bedrooms", 2900, "96"),
    point("E09000007", "2026-08", "2 bedrooms", 3000, "100"),
    point("E12000007", "2025-08", "all", 2200, "97"),
    point("E12000007", "2026-08", "all", 2300, "100"),
]
VALUES = [
    {"geography_id": "uk:lad:E09000007", "name": "Camden", "carrier": "lad", "metric_id": "rent-change-1y",
     "period": "2026-08", "value": 5.3, "region_percentile": 81, "country_percentile": None, "sample_count": None,
     "quality": "observed", "source_release_id": SOURCE["id"]},
    {"geography_id": "uk:lad:E09000007", "name": "Camden", "carrier": "lad", "metric_id": "rent-change-5y",
     "period": "2026-08", "value": 25.0, "region_percentile": 40, "country_percentile": None, "sample_count": None,
     "quality": "observed", "source_release_id": SOURCE["id"]},
]


class PayloadTests(unittest.TestCase):
    def payload(self, area_id="uk:lsoa:E01000907", series=SERIES):
        return rent_trend.rent_trend_payload(area_id, "rel-1", BOROUGH, series, VALUES, SOURCE)

    def test_envelope_carries_value_confidence_evidence_sources_and_caveats(self):
        body = self.payload()
        self.assertEqual(body["schemaVersion"], "area-rent-trend.v1")
        self.assertEqual(set(body), {"schemaVersion", "productReleaseId", "dataMode", "value", "confidence",
                                     "evidence", "sources", "caveats"})
        self.assertEqual(body["confidence"], "medium")  # an LSOA reads its borough's figure
        self.assertEqual(self.payload("uk:lad:E09000007")["confidence"], "high")
        self.assertEqual([row["metricId"] for row in body["evidence"]], ["rent-change-1y", "rent-change-5y"])
        self.assertEqual(body["sources"][0]["sourceId"], "ons-pipr")
        self.assertEqual(body["sources"][0]["release"], SOURCE["id"])
        self.assertTrue(any("City of London" in caveat for caveat in body["caveats"]))

    def test_categories_carry_the_series_change_and_london(self):
        value = self.payload()["value"]
        self.assertTrue(value["available"])
        self.assertEqual(value["borough"], BOROUGH)
        self.assertEqual(value["latest"], "2026-08")
        self.assertEqual(value["regionPercentile"], {"rent-change-1y": 81, "rent-change-5y": 40})
        cells = {cell["category"]: cell for cell in value["categories"]}
        self.assertEqual(list(cells), ["all", "twoBedrooms"])  # display order, only published cells
        everything = cells["all"]
        self.assertEqual(everything["rent"], 2500)
        self.assertEqual(everything["change1yPct"], 5.3)   # 100 / 95
        self.assertEqual(everything["change5yPct"], 25.0)  # 100 / 80
        self.assertEqual(everything["regionRent"], 2300)
        self.assertEqual(everything["regionChange1yPct"], 3.1)
        self.assertIsNone(everything["regionChange5yPct"])
        self.assertEqual(everything["series"][0], {"month": "2021-08", "rent": 2000})
        self.assertEqual(len(everything["series"]), 4)
        self.assertIsNone(cells["twoBedrooms"]["change5yPct"])

    def test_city_of_london_is_unavailable_not_zero(self):
        body = rent_trend.rent_trend_payload("uk:lad:E09000001", "rel-1",
                                             {"id": "uk:lad:E09000001", "name": "City of London"}, [], [], None)
        self.assertFalse(body["value"]["available"])
        self.assertEqual(body["value"]["categories"], [])
        self.assertEqual(body["confidence"], "none")
        self.assertEqual(body["sources"], [])


class FakeConnection:
    def __init__(self, loaded=True):
        self.loaded = loaded

    def execute(self, sql, params=()):
        first = sql.split("\n", 1)[0]
        if first == "-- evidence:active-release":
            return [{"release_id": "rel-1"}]
        if first == "-- evidence:area-borough":
            return [BOROUGH] if params[0].endswith("E01000907") else []
        if first == "-- evidence:rent-series-table":
            return [{"t": self.loaded}]
        if first == "-- evidence:rent-series":
            return SERIES
        if first == "-- evidence:rent-change-values":
            return VALUES
        if first == "-- evidence:rent-series-source":
            return [SOURCE]
        raise AssertionError(first)


class FakeReader:
    def __init__(self, connection):
        self.connection = connection

    def _connect(self):
        return contextlib.nullcontext(self.connection)


class ReadTests(unittest.TestCase):
    def test_reads_the_borough_series(self):
        body = rent_trend.area_rent_trend(FakeReader(FakeConnection()), "uk:lsoa:E01000907")
        self.assertTrue(body["value"]["available"])
        self.assertEqual(body["productReleaseId"], "rel-1")

    def test_before_the_migration_it_is_unavailable(self):
        body = rent_trend.area_rent_trend(FakeReader(FakeConnection(loaded=False)), "uk:lsoa:E01000907")
        self.assertFalse(body["value"]["available"])

    def test_bad_and_unknown_ids(self):
        with self.assertRaises(evidence.MalformedQuery):
            rent_trend.area_rent_trend(FakeReader(FakeConnection()), "nope")
        with self.assertRaises(evidence.AreaNotFound):
            rent_trend.area_rent_trend(FakeReader(FakeConnection()), "uk:lsoa:E01999999")



class RangeCriterionTests(unittest.TestCase):
    def test_rent_change_is_a_range_criterion_painted_from_the_borough(self):
        for layer in rent_trend.METRIC_IDS:
            matching.validate_ranges([{"layer": layer, "max": 5, "importance": 3}])
        # Carrier borough: every LSOA in the borough reads its borough's value (repository.range_rows).
        self.assertIn("lad", repository.RANGE_CARRIER_JOINS)

if __name__ == "__main__":
    unittest.main()
