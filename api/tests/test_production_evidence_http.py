"""AE-06 HTTP mapping: evidence errors become the documented status codes.

Skipped where the FastAPI test client is not installed so the dependency-free
gate (`python3 -m unittest discover -s tests`) stays green everywhere.
"""
import unittest
from unittest import mock

from tests.test_production_evidence import OLD_RELEASE, seed_production_fixture

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
    from area_api.evidence import EvidenceReader
    from tests.test_ratelimit import without_rate_limits
except ImportError:  # pragma: no cover - dependency-free environments
    TestClient = None


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class EvidenceHttpTests(unittest.TestCase):
    def setUp(self):
        connection = seed_production_fixture()
        self._previous = app_module._reader
        app_module._reader = EvidenceReader(connect=lambda: connection)
        without_rate_limits(self)
        self.client = TestClient(app_module.app)

    def tearDown(self):
        app_module._reader = self._previous

    def test_metrics_and_pack_expose_selected_release(self):
        metrics = self.client.get("/api/v1/metrics")
        pack = self.client.get("/api/v1/value-packs/crime/2026-06")

        self.assertEqual(metrics.status_code, 200)
        self.assertEqual(metrics.json()["productReleaseId"], OLD_RELEASE)
        self.assertEqual(pack.status_code, 200)
        self.assertEqual(pack.json()["productReleaseId"], OLD_RELEASE)

    def test_search_and_detail_round_trip(self):
        search = self.client.get("/api/v1/search", params={"q": "E01000004"})
        geography = search.json()["results"][0]["geographyId"]
        detail = self.client.get(
            f"/api/v1/areas/{geography}", params={"metric": "crime", "period": "2026-06"})

        self.assertEqual(search.status_code, 200)
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["summary"]["geographyId"], geography)

    def test_profile_round_trip_and_errors(self):
        profile = self.client.get("/api/v1/areas/uk:lsoa:E01000004/profile", params={"period": "2026-06"})
        unknown = self.client.get("/api/v1/areas/uk:lsoa:E01009999/profile", params={"period": "2026-06"})
        malformed = self.client.get("/api/v1/areas/uk:lsoa:E01000004/profile", params={"period": "june"})

        self.assertEqual(profile.status_code, 200)
        self.assertEqual(profile.json()["schemaVersion"], "area-profile.v1")
        self.assertEqual([m["metricId"] for m in profile.json()["metrics"]],
                         ["price-per-square-metre", "crime"])
        self.assertEqual(unknown.status_code, 404)
        self.assertEqual(unknown.json()["detail"]["error"], "area-not-found")
        self.assertEqual(malformed.status_code, 400)
        self.assertEqual(malformed.json()["detail"]["error"], "invalid-query")
    def test_nearby_sales_round_trip_and_errors(self):
        ok = self.client.get("/api/v1/addresses/uk:addr:a1b2c3d4e5f6/nearby-sales")
        unknown = self.client.get("/api/v1/addresses/uk:addr:000000000000/nearby-sales")
        malformed = self.client.get("/api/v1/addresses/nope/nearby-sales")

        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.json()["schemaVersion"], "nearby-sales.v1")
        self.assertEqual(ok.json()["productReleaseId"], OLD_RELEASE)
        self.assertEqual(unknown.status_code, 404)
        self.assertEqual(unknown.json()["detail"]["error"], "address-not-found")
        self.assertEqual(malformed.status_code, 400)

    def test_error_mapping_distinguishes_area_release_and_query(self):
        malformed = self.client.get("/api/v1/search", params={"q": "x"})
        unknown = self.client.get(
            "/api/v1/areas/uk:lsoa:E01009999", params={"metric": "crime", "period": "2026-06"})
        missing_period = self.client.get(
            "/api/v1/value-packs/crime/2019-01", params={})

        self.assertEqual(malformed.status_code, 400)
        self.assertEqual(malformed.json()["detail"]["error"], "invalid-query")
        self.assertEqual(unknown.status_code, 404)
        self.assertEqual(unknown.json()["detail"]["error"], "area-not-found")
        self.assertEqual(missing_period.status_code, 404)
        self.assertEqual(missing_period.json()["detail"]["error"], "period-not-found")

    def test_the_box_index_route_and_no_geometry_route(self):
        boxes = self.client.get("/api/v1/areas/boxes", params={"carrier": "lsoa"})
        invalid = self.client.get("/api/v1/areas/boxes", params={"carrier": "street"})
        # The shapes reach the browser as area tiles only: no GeoJSON or polyline route is left.
        geometry = self.client.get("/api/v1/areas/geometry", params={"carrier": "lsoa"})

        self.assertEqual(boxes.status_code, 200)
        self.assertEqual(boxes.json()["schemaVersion"], "area-boxes.v1")
        self.assertEqual(len(boxes.json()["areas"]), 2)
        self.assertEqual(boxes.headers["cache-control"], "public, max-age=86400")
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(invalid.json()["detail"]["error"], "invalid-query")
        self.assertNotIn("FeatureCollection", geometry.text)
        self.assertFalse([path for path in app_module.app.openapi()["paths"] if "geometry" in path])

    def test_the_release_build_reads_what_a_cold_map_asks_for_first(self):
        from area_api import release_build, release_store

        self.addCleanup(release_store.use_memory())
        connection = seed_production_fixture()
        app_module._reader = reader = EvidenceReader(connect=lambda: connection)

        for _, label, build in release_build.plan(reader, lambda: {}, {0, 1}):
            if label == "periods" or label.startswith("pack "):
                build()

        markers = {sql.split("\n", 1)[0] for sql, _ in connection.statements}
        self.assertIn("-- evidence:metrics", markers)
        self.assertIn("-- evidence:pack", markers)
        self.assertFalse([marker for marker in markers if "geometry" in marker or "area-boxes" in marker],
                         "the shapes are area tiles, built once per boundary set: nothing to build")
        # An area summary (school and area pages) checks its period: those periods are built here, not by it.
        crime_periods = lambda: [params for sql, params in connection.statements  # noqa: E731
                                 if sql.startswith("-- evidence:periods") and params == ("crime",)]
        self.assertEqual(len(crime_periods()), 1)
        summary = self.client.get("/api/v1/areas/uk:lsoa:E01000004", params={"metric": "crime", "period": "2026-06"})
        self.assertEqual(summary.status_code, 200, summary.text[:200])
        self.assertEqual(len(crime_periods()), 1, "the summary's period check reads what the release build stored")

    def test_metric_values_route_serves_numbers_per_month(self):
        values = self.client.get("/api/v1/metric-values/crime", params={"periods": "2026-06"})
        missing = self.client.get("/api/v1/metric-values/crime", params={"periods": "1999-06"})
        empty = self.client.get("/api/v1/metric-values/crime")

        self.assertEqual(values.status_code, 200)
        self.assertEqual(list(values.json()["values"]), ["2026-06"])
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(empty.status_code, 400)

    def test_missing_release_is_unavailable_not_not_found(self):
        app_module._reader = EvidenceReader(connect=_empty_release)

        response = self.client.get("/api/v1/metrics")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["detail"]["error"], "release-unavailable")


def _empty_release():
    connection = seed_production_fixture()
    connection.active_id = None
    return connection


if __name__ == "__main__":
    unittest.main()
