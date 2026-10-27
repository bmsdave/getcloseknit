"""ODbL share-alike: GET /api/v2/downloads/places.csv serves the unified places database with its notice."""
import contextlib
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from area_api import downloads
from area_api.evidence import EvidenceReader, ReleaseUnavailable

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
    from tests.test_ratelimit import without_rate_limits
except ImportError:  # pragma: no cover
    TestClient = None

RELEASE = {"id": "src-places-unified-2026-10-07-abcd1234", "licence": "ODbL-1.0",
           "attribution": "© OpenStreetMap contributors (ODbL 1.0); Foursquare Open Source Places (Apache License 2.0).",
           "release_date": "2026-10-07"}
CSV = b"id,name,category\nosm:n1,Kebab House,kebab\n"


class FakeConnection:
    def __init__(self, release=RELEASE):
        self.release, self.statements, self.copies = release, [], 0

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, params=()):
        self.statements.append(sql)
        if sql.startswith("-- downloads:places-release"):
            return [self.release] if self.release else []
        if sql.startswith("SET LOCAL statement_timeout"):
            return []
        raise AssertionError(sql)

    def cursor(self):
        return self

    @contextlib.contextmanager
    def copy(self, sql):
        self.copies += 1
        self.statements.append(sql)
        yield iter([CSV[:10], CSV[10:]])


class PlacesCsvTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        patcher = mock.patch.dict(os.environ, {"CLOSE_KNIT_DOWNLOAD_DIR": self.dir.name})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.dir.cleanup)
        self.connection = FakeConnection()

    def test_builds_once_per_release_with_the_odbl_notice_first(self):
        first = downloads.places_csv(lambda: self.connection)
        again = downloads.places_csv(lambda: self.connection)
        self.assertEqual(self.connection.copies, 1, "the second call is served from the cached file")
        self.assertEqual(first, again)
        text = Path(first["path"]).read_text()
        notice, body = text.split("id,name,category\n", 1)
        self.assertTrue(all(line.startswith("# ") for line in notice.splitlines()))
        self.assertIn("Open Database License (ODbL) 1.0", notice)
        self.assertIn(RELEASE["attribution"], notice)
        self.assertEqual(body, "osm:n1,Kebab House,kebab\n")
        self.assertEqual(first["filename"], "close-knit-places-src-places-unified-2026-10-07-abcd1234.csv")

    def test_a_new_release_replaces_the_old_file(self):
        old = downloads.places_csv(lambda: self.connection)["path"]
        newer = dict(RELEASE, id="src-places-unified-2026-11-01-ffff0000")
        new = downloads.places_csv(lambda: FakeConnection(newer))["path"]
        self.assertFalse(Path(old).exists())
        self.assertTrue(Path(new).exists())

    def test_copy_keeps_served_columns_and_source_ids_and_refuses_religion(self):
        sql = downloads.PLACES_COPY_SQL
        for column in ('"group"', "brand", "score", "specialty_score", "lsoa_id", "lon", "lat", "osm_id",
                       "fhrs_id", "overture_id", "fsq_id", "tags", "source_release_id", "HEADER true"):
            self.assertIn(column, sql)
        self.assertIn("NOT (p.tags ? 'religion')", sql)

    def test_no_places_release_is_unavailable(self):
        with self.assertRaises(ReleaseUnavailable):
            downloads.places_csv(lambda: FakeConnection(release=None))


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class PlacesCsvHttpTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        patcher = mock.patch.dict(os.environ, {"CLOSE_KNIT_DOWNLOAD_DIR": self.dir.name})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self.dir.cleanup)
        self._previous = app_module._reader
        connection = FakeConnection()
        app_module._reader = EvidenceReader(connect=lambda: connection)
        self.addCleanup(setattr, app_module, "_reader", self._previous)
        without_rate_limits(self)
        self.client = TestClient(app_module.app)

    def test_attachment_cacheable_and_licensed(self):
        response = self.client.get("/api/v2/downloads/places.csv")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.headers["content-type"].startswith("text/csv"))
        self.assertIn("attachment", response.headers["content-disposition"])
        self.assertIn("close-knit-places-", response.headers["content-disposition"])
        self.assertEqual(response.headers["cache-control"], "public, max-age=86400")
        self.assertIn("odbl", response.headers["link"])
        self.assertTrue(response.text.startswith("# Close Knit unified places database"))


if __name__ == "__main__":
    unittest.main()
