"""v4.2: a My match Where zone's outline on the map (POST /api/v1/zone-shapes, repository.zone_shapes)."""
import json
import unittest

from area_api import repository

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
    from area_api.repository import evidence_connection
    from tests.test_ratelimit import without_rate_limits
except ImportError:  # pragma: no cover
    TestClient = None

SQUARE = {"type": "Polygon", "coordinates": [[[-0.1, 51.5], [-0.09, 51.5], [-0.09, 51.51], [-0.1, 51.51], [-0.1, 51.5]]]}


class FakeShapeConnection:
    """Answers the zone-shape queries and records what each was asked."""

    def __init__(self, walk_ids=("uk:lsoa:E01000002", "uk:lsoa:E01000001")):
        self.walk_ids = walk_ids
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=()):
        marker = sql.strip().split("\n", 1)[0]
        self.calls.append((marker, params))
        if marker == "-- evidence:zone-station":
            return [{"geography_id": area_id} for area_id in self.walk_ids]
        if marker in ("-- evidence:zone-shape-borough", "-- evidence:zone-shape-lsoas"):
            return [{"geometry": json.dumps(SQUARE)}]
        raise AssertionError(f"unexpected query {marker}")


STATION = {"kind": "station", "stationId": "osm:n123", "maxWalkMinutes": 10, "label": "Brixton"}
BOROUGH = {"kind": "borough", "id": "uk:lad:E09000022", "label": "Lambeth"}
AREAS = {"kind": "lsoas", "ids": ["uk:lsoa:E01000003"]}
DRAWN = {"kind": "polygon", "points": [[51.464, -0.156], [51.464, -0.14], [51.456, -0.14], [51.456, -0.156]]}


class ZoneShapeTests(unittest.TestCase):
    def test_each_zone_gets_its_outline_and_a_drawn_one_is_left_to_the_client(self):
        connection = FakeShapeConnection()
        shapes = repository.zone_shapes(connection, [STATION, BOROUGH, AREAS, DRAWN])
        self.assertEqual(shapes, [SQUARE, SQUARE, SQUARE, None])
        asked = dict((marker, params) for marker, params in connection.calls if marker != "-- evidence:zone-station")
        self.assertEqual(asked["-- evidence:zone-shape-borough"], ("uk:lad:E09000022",))
        # The station's outline is the union of the areas in walking range (sorted), the list's its own areas.
        lsoa_calls = [params for marker, params in connection.calls if marker == "-- evidence:zone-shape-lsoas"]
        self.assertEqual(lsoa_calls, [(["uk:lsoa:E01000001", "uk:lsoa:E01000002"],), (["uk:lsoa:E01000003"],)])

    def test_a_station_with_nothing_in_walking_range_has_no_outline(self):
        connection = FakeShapeConnection(walk_ids=())
        self.assertEqual(repository.zone_shapes(connection, [STATION]), [None])
        self.assertNotIn("-- evidence:zone-shape-lsoas", [marker for marker, _ in connection.calls])


@unittest.skipIf(TestClient is None, "fastapi test client is not installed")
class ZoneShapesHttpTests(unittest.TestCase):
    def setUp(self):
        self.connection = FakeShapeConnection()
        app_module._connect = lambda: self.connection
        self.addCleanup(setattr, app_module, "_connect", evidence_connection)
        without_rate_limits(self)
        self.client = TestClient(app_module.app)

    def test_the_route_answers_per_zone_privately(self):
        response = self.client.post("/api/v1/zone-shapes", json={"zones": [BOROUGH, DRAWN]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.json(), {"schemaVersion": "zone-shapes.v1", "zones": [
            {"kind": "borough", "geometry": SQUARE}, {"kind": "polygon", "geometry": None}]})

    def test_bad_requests_are_400(self):
        for body in ({}, {"zones": []}, {"zones": [{"kind": "moon"}]}, {"zones": [BOROUGH] * 4}):
            self.assertEqual(self.client.post("/api/v1/zone-shapes", json=body).status_code, 400, body)


if __name__ == "__main__":
    unittest.main()
