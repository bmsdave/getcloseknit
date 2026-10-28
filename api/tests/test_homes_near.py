"""v4 Task 34: postcodes with recorded homes near a point (fixture connection; the SQL's shape is checked)."""
import unittest

from area_api import homes_near as hn
from area_api.evidence import EvidenceReader, MalformedQuery

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
    from tests.test_ratelimit import without_rate_limits
except ImportError:  # pragma: no cover
    TestClient = None

ROWS = [
    {"postcode": "BR6 9SB", "geography_id": "uk:lsoa:E01000757", "homes": 14, "metres": 120},
    {"postcode": "BR6 9SD", "geography_id": "uk:lsoa:E01000757", "homes": 3, "metres": 310},
]


class FakeConnection:
    def __init__(self, rows=ROWS):
        self.rows = rows
        self.statements = []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, params=()):
        self.statements.append((sql, params))
        marker = sql.split("\n", 1)[0]
        if marker == "-- evidence:active-release":
            return [{"release_id": "release-1"}]
        assert marker == "-- homes-near:postcodes", marker
        return self.rows[: params["limit"]]


class HomesNearTests(unittest.TestCase):
    def test_postcodes_nearest_first_with_counts(self):
        connection = FakeConnection()
        body = hn.homes_near(lambda: connection, 51.3712, 0.0981, 4)
        self.assertEqual(body["schemaVersion"], "homes-near.v1")
        self.assertEqual(body["productReleaseId"], "release-1")
        self.assertEqual([row["postcode"] for row in body["postcodes"]], ["BR6 9SB", "BR6 9SD"])
        self.assertEqual(body["postcodes"][0], {"postcode": "BR6 9SB", "geographyId": "uk:lsoa:E01000757", "homes": 14, "metres": 120})
        self.assertEqual(body["radiusMetres"], hn.RADIUS_METRES)
        sql, params = connection.statements[-1]
        self.assertEqual(params["radius"], 800)
        self.assertEqual((params["lat"], params["lon"]), (51.3712, 0.0981))

    def test_answer_is_postcodes_never_addresses(self):
        body = hn.homes_near(lambda: FakeConnection(), 51.5, -0.1)
        for row in body["postcodes"]:
            self.assertEqual(set(row), {"postcode", "geographyId", "homes", "metres"})

    def test_hidden_homes_are_not_counted_and_the_count_is_the_postcode_lists(self):
        sql = hn.NEAR_POSTCODES_SQL
        self.assertIn("suppressed_dwelling d WHERE d.address_id = a.id", sql)
        self.assertIn("JOIN suppressed_dwelling d ON d.uprn = p.uprn", sql)
        # Every recorded address counts, as /postcode/{code}/homes lists them: a home needs no page (UPRN)
        # of its own, so the school's "N homes" matches the list it opens (r3 #34).
        self.assertNotIn("AND EXISTS (SELECT 1 FROM property p", sql)
        self.assertIn("a.postcode IN (SELECT postcode FROM near)", sql)
        # candidates come through the LSOA geometry index, never a scan of every address
        self.assertIn("g.geometry && ST_Expand", sql)
        self.assertIn("a.geography_id IN (SELECT id FROM near_lsoa)", sql)

    def test_count_is_capped_as_the_list_is(self):
        connection = FakeConnection()
        hn.homes_near(lambda: connection, 51.5, -0.1)
        self.assertEqual(connection.statements[-1][1]["cap"], hn.POSTCODE_HOME_LIMIT)

    def test_limit_is_passed_and_bounded(self):
        connection = FakeConnection()
        self.assertEqual(len(hn.homes_near(lambda: connection, 51.5, -0.1, 1)["postcodes"]), 1)
        for bad in (0, 11, "x"):
            with self.assertRaises(MalformedQuery):
                hn.homes_near(lambda: FakeConnection(), 51.5, -0.1, bad)

    def test_point_outside_london_has_no_homes(self):
        # England map (CLOSE_KNIT_ENGLAND): a school in Manchester or Cornwall asks too; per-home data is
        # London's, so the answer is an empty list, never a 400.
        for lat, lon in ((53.48, -2.24), (50.34, -4.79), (51.5, 1.2)):
            connection = FakeConnection()
            body = hn.homes_near(lambda: connection, lat, lon)
            self.assertEqual(body["postcodes"], [])
            self.assertEqual(body["coverage"], "london-only")  # the page says "London only", not "no homes"
            self.assertFalse(any("homes-near:postcodes" in sql for sql, _ in connection.statements))
        self.assertIsNone(hn.homes_near(lambda: FakeConnection(), 51.5, -0.1)["coverage"])

    def test_point_that_is_not_a_number_is_rejected(self):
        for lat, lon in (("north", 0), (float("nan"), 0), (51.5, float("inf"))):
            with self.assertRaises(MalformedQuery):
                hn.homes_near(lambda: FakeConnection(), lat, lon)

    def test_no_homes_near_is_an_empty_list(self):
        self.assertEqual(hn.homes_near(lambda: FakeConnection(rows=[]), 51.5, -0.1)["postcodes"], [])


@unittest.skipIf(TestClient is None, "fastapi not installed")
class HttpTests(unittest.TestCase):
    def setUp(self):
        self._previous = app_module._reader
        app_module._reader = EvidenceReader(connect=lambda: FakeConnection())
        without_rate_limits(self)
        self.client = TestClient(app_module.app)

    def tearDown(self):
        app_module._reader = self._previous

    def test_route(self):
        ok = self.client.get("/api/v1/homes/near?latitude=51.3712&longitude=0.0981")
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.json()["postcodes"][0]["postcode"], "BR6 9SB")
        outside = self.client.get("/api/v1/homes/near?latitude=53.48&longitude=-2.24")
        self.assertEqual((outside.status_code, outside.json()["postcodes"]), (200, []))
        self.assertEqual(self.client.get("/api/v1/homes/near?latitude=51.5&longitude=-0.1&limit=50").status_code, 400)
        self.assertEqual(self.client.get("/api/v1/homes/near?latitude=51.5").status_code, 422)


if __name__ == "__main__":
    unittest.main()
