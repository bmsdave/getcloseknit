"""Layers v5 batch 1 in the API: Student areas (student-share) is descriptive like census-*, flagged in the
metric catalogue, and its universities come from /api/v1/universities/points."""
import json
import unittest
from unittest import mock

from fastapi.testclient import TestClient

from area_api import app as app_module
from area_api import evidence, layers, matching, universities


def _metric_row(metric_id: str) -> dict:
    return {"id": metric_id, "carrier": "lsoa", "unit": "%", "direction": "higher-is-more", "periods": ["2021-03"],
            "source_url": "https://x", "source_release_id": "src-x", "checksum": "0" * 64, "licence": "OGL-3.0",
            "attribution": "x", "transformation_version": "t",
            "definition": json.dumps({"label": "L", "shortLabel": "S", "description": "D", "legend": [],
                                      "sourceId": "s", "sourceName": "S", "methodologyPath": "/guide/x"})}


class DescriptiveTests(unittest.TestCase):
    def test_student_share_is_never_ranked_or_matched(self):
        self.assertTrue(evidence.is_descriptive_only("student-share"))
        self.assertTrue(evidence.is_never_ranked("student-share"))
        self.assertTrue(matching.is_descriptive_layer("student-share"))
        self.assertFalse(matching.is_descriptive_layer("good-schools-nearby"))
        with self.assertRaises(matching.InvalidMatchRequest):
            matching.validate_ranges([{"layer": "student-share", "min": 10}])
        matching.validate_ranges([{"layer": "flood-risk", "max": 5, "importance": 3}])

    def test_tile_has_no_london_position(self):
        row = {"id": "student-share", "value": 31.2, "region_percentile": 97, "direction": "higher-is-more",
               "label": "Full-time students", "unit": "%", "year_ago": None, "period": "2021-03"}
        self.assertIsNone(layers.layer(row)["standing"])

    def test_catalogue_flags_descriptive_metrics_only(self):
        self.assertTrue(evidence._metric_definition(_metric_row("student-share"))["descriptiveOnly"])
        self.assertTrue(evidence._metric_definition(_metric_row("census-age-0-14"))["descriptiveOnly"])
        self.assertNotIn("descriptiveOnly", evidence._metric_definition(_metric_row("flood-risk")))


class UniversityPointsTests(unittest.TestCase):
    def test_points_shape(self):
        rows = [{"id": "osm:w1", "name": "UCL", "kind": "university", "latitude": 51.52467891, "longitude": -0.1340012}]
        body = universities.points(rows, "rel-1")
        self.assertEqual(body["schemaVersion"], "university-points.v1")
        self.assertEqual(body["attribution"], "© OpenStreetMap contributors")
        self.assertEqual(body["points"], [{"id": "osm:w1", "name": "UCL", "kind": "university",
                                           "latitude": 51.524679, "longitude": -0.134001}])
        self.assertIn('"amenity": "university"', universities.POINTS_SQL)
        self.assertIn('"amenity": "college"', universities.POINTS_SQL)

    def test_endpoint_is_cached_for_an_hour(self):
        class _Reader:
            def university_points(self, cancel=None):
                return universities.points([], "rel-1")

        client = TestClient(app_module.app)
        with mock.patch.object(app_module, "get_reader", lambda: _Reader()):
            response = client.get("/api/v1/universities/points?release=rel-1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "public, max-age=3600")
        self.assertEqual(response.json()["points"], [])


if __name__ == "__main__":
    unittest.main()
