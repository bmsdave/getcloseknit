"""Kids: nurseries, road safety and cycle lanes around an area (migration 062, area-kids.v1)."""
import unittest

from area_api import kids
from area_api.evidence import AreaNotFound, EvidenceReader, MalformedQuery
from tests.test_production_evidence import OLD_RELEASE, seed_production_fixture

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
except ImportError:  # pragma: no cover - dependency-free environments
    TestClient = None

AREA = "uk:lsoa:E01000004"
SOURCES = ["src-dft-stats19-2025-12", "src-ofsted-early-years-2026-06"]


class KidsConnection:
    """The production fixture connection plus area_kids, nursery and source rows."""

    def __init__(self, base):
        self.base = base
        self.area_kids = {}
        self.nurseries = []
        self.tile = b"\x1a\x02"

    def __getattr__(self, name):
        return getattr(self.base, name)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, params=()):
        marker = sql.split("\n", 1)[0]
        if marker == "-- evidence:area-exists":
            return [{"?column?": 1}] if params[0] in self.base.geographies else []
        if marker == "-- evidence:area-kids":
            row = self.area_kids.get(params[0])
            return [dict(row)] if row else []
        if marker == "-- evidence:kids-nurseries":
            return [dict(row) for row in self.nurseries[:params[2]]]
        if marker == "-- evidence:kids-sources":
            return [{"id": source, "source_url": "https://example.gov.uk", "release_date": "2026-06-30",
                     "licence": "OGL-UK-3.0", "attribution": f"{source} attribution", "caveats": ["c"]}
                    for source in params[0]]
        if marker == "-- evidence:cycle-lane-tile":
            return [{"tile": self.tile}]
        if marker == "-- evidence:collision-tile-ready":
            return [{"t": getattr(self, "collisions_ready", True)}]
        if marker == "-- evidence:collision-tile":
            self.collision_params = params
            return [{"tile": b"\x1a\x03"}]
        if marker == "-- evidence:collision-heat-tile":
            self.collision_heat_params = params
            return [{"tile": b"\x1a\x04"}]
        return self.base.execute(sql, params)


def seeded():
    connection = KidsConnection(seed_production_fixture())
    connection.area_kids[AREA] = {
        "geography_id": AREA, "nursery_rated": 9, "nursery_good": 8, "nursery_share": 88.9,
        "nursery_percentile": 71, "casualty_first_year": 2021, "casualties_by_year": [10, 12, 9, 8, 7],
        "casualties": 46, "child_casualties": 4, "serious_casualties": 9, "cyclist_casualties": 20,
        "casualty_percentile": 55, "protected_km": 1.4, "cycleway_km": 2.1, "cycle_percentile": 80,
        "source_release_ids": SOURCES,
    }
    connection.nurseries = [
        {"urn": "EY1", "name": "Little Acorns", "grade": "Outstanding", "framework": "overall-effectiveness",
         "inspected": "2023-05-01", "well_rated": True, "places": 40, "distance": 120},
        {"urn": "EY2", "name": "Busy Bees", "grade": "Needs attention", "framework": "report-card",
         "inspected": "2026-02-01", "well_rated": False, "places": None, "distance": 640},
    ]
    return connection


class AreaKidsReaderTests(unittest.TestCase):
    def read(self, connection, area=AREA):
        return kids.area_kids(EvidenceReader(connect=lambda: connection), area)

    def test_three_figures_with_region_percentiles(self):
        payload = self.read(seeded())

        self.assertEqual(payload["schemaVersion"], "area-kids.v1")
        self.assertEqual(payload["productReleaseId"], OLD_RELEASE)
        self.assertTrue(payload["available"])
        self.assertEqual(payload["nurseries"]["wellRated"], 8)
        self.assertEqual(payload["nurseries"]["regionPercentile"], 71)
        self.assertEqual(payload["nurseries"]["nearest"][0]["url"], "https://reports.ofsted.gov.uk/provider/16/EY1")
        self.assertFalse(payload["nurseries"]["nearest"][1]["wellRated"])
        road = payload["roadSafety"]
        self.assertEqual((road["casualties"], road["children"], road["pedestrians"]), (46, 4, 26))
        self.assertEqual(road["byYear"][0], {"year": 2021, "count": 10})
        self.assertEqual(road["byYear"][-1], {"year": 2025, "count": 7})
        self.assertEqual(payload["cycling"], {"radiusMetres": 1000, "protectedKm": 1.4, "cyclewayKm": 2.1,
                                              "regionPercentile": 80})
        self.assertEqual([source["id"] for source in payload["sources"]], SOURCES)

    def test_an_area_without_a_row_is_unavailable_not_zero(self):
        connection = seeded()
        connection.area_kids.clear()

        payload = self.read(connection)

        self.assertFalse(payload["available"])
        self.assertIsNone(payload["nurseries"])
        self.assertIsNone(payload["roadSafety"])
        self.assertIsNone(payload["cycling"])

    def test_errors(self):
        with self.assertRaises(MalformedQuery):
            self.read(seeded(), "not-an-area")
        with self.assertRaises(AreaNotFound):
            self.read(seeded(), "uk:lsoa:E01009999")

    def test_tile_range_and_low_zoom(self):
        reader = EvidenceReader(connect=lambda: seeded())
        self.assertEqual(kids.cycle_lane_tile(reader, 10, 511, 340), b"")
        self.assertEqual(kids.cycle_lane_tile(reader, 14, 8186, 5448), b"\x1a\x02")
        with self.assertRaises(MalformedQuery):
            kids.cycle_lane_tile(reader, 14, 2 ** 14, 0)

    def test_collision_heat_grid_is_fine_and_counts_by_severity(self):
        sql = kids.COLLISION_HEAT_TILE_SQL
        self.assertIn("/ 128", sql)
        for column in ("AS n1", "AS n2", "AS n3", "AS n\n"):
            self.assertIn(column, sql)
        self.assertIn("GROUP BY 1, 2, 3", sql)  # cell, road user, child: the map's filters
        self.assertNotIn("year", sql)  # never a date below street zoom

    def test_collision_tiles_start_at_zoom_10_and_wait_for_the_migration(self):
        connection = seeded()
        reader = EvidenceReader(connect=lambda: connection)
        self.assertEqual(kids.collision_tile(reader, 9, 255, 170), b"")
        self.assertEqual(kids.collision_tile(reader, 10, 511, 340), b"\x1a\x04")  # the heat grid below 13
        self.assertEqual(connection.collision_heat_params, {"z": 10, "x": 511, "y": 340})
        self.assertEqual(kids.collision_tile(reader, 13, 4093, 2724), b"\x1a\x03")  # one point per casualty
        self.assertEqual(connection.collision_params, (13, 4093, 2724))
        connection.collisions_ready = False  # before migration 065: no tile, no error
        self.assertEqual(kids.collision_tile(reader, 14, 8186, 5448), b"")
        with self.assertRaises(MalformedQuery):
            kids.collision_tile(reader, 12, 0, 2 ** 12)


@unittest.skipIf(TestClient is None, "fastapi is not installed")
class AreaKidsHttpTests(unittest.TestCase):
    def setUp(self):
        connection = seeded()
        self._previous = app_module._reader
        app_module._reader = EvidenceReader(connect=lambda: connection)
        self.client = TestClient(app_module.app)

    def tearDown(self):
        app_module._reader = self._previous

    def test_round_trip_and_errors(self):
        ok = self.client.get(f"/api/v1/areas/{AREA}/kids")
        unknown = self.client.get("/api/v1/areas/uk:lsoa:E01009999/kids")
        tile = self.client.get("/api/v1/tiles/cycle-lanes/14/8186/5448.pbf")
        empty = self.client.get("/api/v1/tiles/cycle-lanes/9/255/170.pbf")

        self.assertEqual(ok.status_code, 200)
        self.assertEqual(ok.json()["roadSafety"]["children"], 4)
        self.assertEqual(unknown.status_code, 404)
        self.assertEqual(tile.status_code, 200)
        self.assertEqual(tile.headers["content-type"], "application/vnd.mapbox-vector-tile")
        self.assertEqual(empty.status_code, 204)


if __name__ == "__main__":
    unittest.main()
