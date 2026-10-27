"""UK House Price Index for an area's borough (migration 080, area-hpi.v1): an evidence envelope with
the borough's price line by type, change over 1, 5 and 10 years against London, and its London rank."""
import unittest
from datetime import date

from area_api import uk_hpi
from area_api.evidence import AreaNotFound, MalformedQuery

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
except ImportError:  # pragma: no cover - dependency-free environments
    TestClient = None

RELEASE = "src-hmlr-uk-hpi-2026-07"
SOURCE = {"source_release_id": RELEASE, "source_url": "https://publicdata.landregistry.gov.uk/x.csv",
          "licence": "OGL-3.0", "attribution": "Contains HM Land Registry data.",
          "transformation_version": "close-knit-uk-hpi-1", "release_date": date(2026, 7, 1)}


def _rows():
    rows = []
    for code, indexes in (("E09000007", {2016: 86.7, 2021: 99.9, 2025: 105.3, 2026: 94.7}),
                          ("E12000007", {2016: 89.2, 2021: 92.8, 2025: 99.6, 2026: 96.4})):
        for year, index in indexes.items():
            for kind in ("all", "flat"):
                rows.append({"borough": code, "month": date(year, 7, 1), "property_type": kind,
                             "average_price": round(index * 8600), "index": index, **SOURCE})
    # Months between quarters are thinned out of the line; the latest month is always kept.
    rows.append({"borough": "E09000007", "month": date(2016, 8, 1), "property_type": "all",
                 "average_price": 750000, "index": 87.0, **SOURCE})
    return rows


class FakeConnection:
    def __init__(self, loaded=True):
        self.loaded = loaded

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, params=()):
        marker = sql.split("\n", 1)[0]
        if marker == "-- evidence:active-release":
            return [{"release_id": "rel-test"}]
        if marker == "-- evidence:area-borough":
            return [{"id": "uk:lad:E09000007", "name": "Camden"}] if params[0].endswith("1") else []
        if marker == "-- evidence:hpi-table":
            return [{"t": self.loaded}]
        if marker == "-- evidence:hpi-series":
            return _rows() if params[0] == "E09000007" else []
        if marker == "-- evidence:hpi-rank":
            return [{"metric_id": "hpi-change-5y", "region_percentile": 9},
                    {"metric_id": "hpi-change-10y", "region_percentile": 16}]
        raise AssertionError(f"unexpected query {marker}")


class FakeReader:
    def __init__(self, loaded=True):
        self.loaded = loaded

    def _connect(self):
        return FakeConnection(self.loaded)


class PayloadTests(unittest.TestCase):
    def setUp(self):
        self.body = uk_hpi.area_hpi(FakeReader(), "uk:lsoa:E01000001")
        self.value = self.body["value"]

    def test_envelope(self):
        self.assertEqual(self.body["schemaVersion"], "area-hpi.v1")
        self.assertEqual(self.body["productReleaseId"], "rel-test")
        self.assertEqual(self.body["confidence"], "medium")  # borough-wide for a neighbourhood
        self.assertEqual(self.body["sources"][0]["sourceId"], "hmlr-uk-hpi")
        self.assertEqual(self.body["sources"][0]["release"], RELEASE)
        self.assertTrue(any("Borough-wide" in caveat for caveat in self.body["caveats"]))
        kinds = {(row["metricId"], row["value"], row["regionPercentile"]) for row in self.body["evidence"]}
        self.assertEqual(kinds, {("hpi-change-5y", -5.2, 9), ("hpi-change-10y", 9.2, 16)})

    def test_changes_against_london_by_type(self):
        self.assertEqual(self.value["borough"], {"id": "uk:lad:E09000007", "name": "Camden"})
        self.assertEqual(self.value["latest"], "2026-07")
        everything = self.value["types"][0]
        self.assertEqual(everything["type"], "all")
        self.assertEqual(everything["change"], {"1y": -10.1, "5y": -5.2, "10y": 9.2})
        self.assertEqual(everything["regionChange"], {"1y": -3.2, "5y": 3.9, "10y": 8.1})
        self.assertEqual(everything["latestPrice"], round(94.7 * 8600))
        self.assertEqual([entry["type"] for entry in self.value["types"]], ["all", "flat"])
        self.assertEqual(self.value["regionPercentile"], {"5y": 9, "10y": 16})

    def test_line_is_quarterly_and_ends_at_the_latest_month(self):
        months = [point["month"] for point in self.value["types"][0]["series"]]
        self.assertEqual(months, ["2016-07", "2021-07", "2025-07", "2026-07"])

    def test_not_loaded_and_unknown_areas(self):
        empty = uk_hpi.area_hpi(FakeReader(loaded=False), "uk:lsoa:E01000001")
        self.assertFalse(empty["value"]["available"])
        self.assertEqual((empty["confidence"], empty["evidence"]), ("none", []))
        with self.assertRaises(AreaNotFound):
            uk_hpi.area_hpi(FakeReader(), "uk:lsoa:E01000002")
        with self.assertRaises(MalformedQuery):
            uk_hpi.area_hpi(FakeReader(), "not-an-area")


@unittest.skipIf(TestClient is None, "fastapi is not installed")
class RouteTests(unittest.TestCase):
    def test_route_serves_the_envelope(self):
        original = app_module.get_reader
        app_module.get_reader = lambda: FakeReader()
        try:
            response = TestClient(app_module.app).get("/api/v1/areas/uk:lsoa:E01000001/hpi")
        finally:
            app_module.get_reader = original
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["value"]["types"][0]["change"]["5y"], -5.2)


if __name__ == "__main__":
    unittest.main()
