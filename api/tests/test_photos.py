"""Geograph photos nearest a London point (migration 043, nearby-photos.v1)."""
import datetime
import unittest

from area_api import photos
from area_api.evidence import Cancelled, EvidenceReader, MalformedQuery

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
except ImportError:  # pragma: no cover - dependency-free environments
    TestClient = None

SOURCE = "src-geograph-2026-10"


class PhotosConnection:
    """Answers the photos SQL by marker; ``table`` False is a database before migration 043."""

    def __init__(self, rows=(), table=True):
        self.rows = [dict(row) for row in rows]
        self.table = table
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, params=()):
        marker = sql.split("\n", 1)[0]
        self.calls.append((marker, params))
        if marker == "-- photos:table":
            return [{"t": self.table}]
        if marker == "-- photos:nearby":
            _lon, _lat, limit, max_metres = params
            return [row for row in self.rows if row["metres"] <= max_metres][:limit]
        if marker == "-- photos:source":
            return [{"id": SOURCE, "attribution": "Photos © their Geograph contributors, CC BY-SA 2.0.",
                     "caveats": ["Placed where the photographer put them."]}] if params[0] == SOURCE else []
        raise AssertionError(f"unexpected SQL: {marker}")


def row(id_, metres, taken=datetime.date(2014, 5, 28)):
    return {"id": id_, "title": f"Photo {id_}", "photographer": "Marathon", "user_id": 43806,
            "taken": taken, "source_release_id": SOURCE, "metres": metres}


def reader(connection):
    return EvidenceReader(connect=lambda: connection)


class NearbyPhotosTests(unittest.TestCase):
    def test_credited_links_nearest_first_with_the_source(self):
        connection = PhotosConnection([row(4015171, 12.4), row(6265981, 80.6, taken=None)])
        payload = photos.nearby_photos(reader(connection), 51.5416, -0.0553)

        self.assertEqual(payload["schemaVersion"], "nearby-photos.v1")
        self.assertEqual(payload["photos"][0], {
            "id": "4015171", "title": "Photo 4015171", "photographer": "Marathon",
            "pageUrl": "https://www.geograph.org.uk/photo/4015171",
            "profileUrl": "https://www.geograph.org.uk/profile/43806",
            "taken": "2014-05-28", "metres": 12})
        self.assertIsNone(payload["photos"][1]["taken"])
        self.assertEqual(payload["licenceUrl"], "https://creativecommons.org/licenses/by-sa/2.0/")
        self.assertEqual(payload["sourceVersion"], SOURCE)
        self.assertEqual(payload["caveats"], ["Placed where the photographer put them."])
        self.assertIn(("-- photos:nearby", (-0.0553, 51.5416, 4, photos.MAX_METRES)), connection.calls)

    def test_far_photos_and_a_missing_table_give_an_empty_list(self):
        far = photos.nearby_photos(reader(PhotosConnection([row(1, 5000.0)])), 51.5, -0.1)
        missing = photos.nearby_photos(reader(PhotosConnection(table=False)), 51.5, -0.1)
        for payload in (far, missing):
            self.assertEqual(payload["photos"], [])
            self.assertIsNone(payload["sourceVersion"])

    def test_rejects_points_outside_london_and_bad_limits(self):
        for lat, lon, limit in ((52.2, 0.12, 4), (51.5, -2.0, 4), (51.5, -0.1, 0), (51.5, -0.1, 13)):
            with self.subTest(lat=lat, lon=lon, limit=limit), self.assertRaises(MalformedQuery):
                photos.nearby_photos(reader(PhotosConnection()), lat, lon, limit)

    def test_cancelled_before_reading(self):
        connection = PhotosConnection([row(1, 10.0)])
        with self.assertRaises(Cancelled):
            photos.nearby_photos(reader(connection), 51.5, -0.1, cancel=lambda: True)
        self.assertEqual(connection.calls, [])


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class NearbyPhotosHttpTests(unittest.TestCase):
    def setUp(self):
        connection = PhotosConnection([row(4015171, 12.4)])
        self._previous = app_module._reader
        app_module._reader = EvidenceReader(connect=lambda: connection)
        self.client = TestClient(app_module.app)

    def tearDown(self):
        app_module._reader = self._previous

    def test_round_trip_and_errors(self):
        ok = self.client.get("/api/v1/photos/nearby", params={"lat": 51.5416, "lon": -0.0553, "limit": 2})
        outside = self.client.get("/api/v1/photos/nearby", params={"lat": 53.4, "lon": -2.2})
        missing = self.client.get("/api/v1/photos/nearby", params={"lat": 51.5})

        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.json()["photos"][0]["pageUrl"], "https://www.geograph.org.uk/photo/4015171")
        self.assertEqual(outside.status_code, 400)
        self.assertEqual(missing.status_code, 422)


if __name__ == "__main__":
    unittest.main()
