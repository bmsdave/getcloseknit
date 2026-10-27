"""The map's school points stay cached for an hour, with or without the release the web puts in the URL.

The web asks for /api/v1/schools/points?release=<id> (web/src/lib/release-url.ts): a new release is a new
URL, so browsers never keep the old release's points after a deploy. The API ignores the parameter.
"""
import unittest
from unittest import mock

from fastapi.testclient import TestClient

from area_api import app as app_module


class _Reader:
    def school_points(self, cancel=None):
        return {"schemaVersion": "school-points.v1", "schools": []}


class SchoolPointsCacheTest(unittest.TestCase):
    def test_the_release_in_the_url_keeps_the_hour_long_cache(self):
        client = TestClient(app_module.app)
        with mock.patch.object(app_module, "get_reader", lambda: _Reader()):
            for path in ("/api/v1/schools/points", "/api/v1/schools/points?release=official-2026-06"):
                response = client.get(path)
                self.assertEqual(response.status_code, 200, path)
                self.assertEqual(response.headers["cache-control"], "public, max-age=3600", path)
                self.assertEqual(response.json()["schemaVersion"], "school-points.v1", path)


if __name__ == "__main__":
    unittest.main()
