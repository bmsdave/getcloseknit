"""Street trees and Green streets tiles (migration 066): zoom gates, tile range and before the migration."""
import unittest

from area_api import street_trees
from area_api.evidence import EvidenceReader, MalformedQuery
from tests.test_production_evidence import seed_production_fixture

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
except ImportError:  # pragma: no cover - dependency-free environments
    TestClient = None


class TreeConnection:
    """The production fixture connection plus the two tile functions."""

    def __init__(self, base):
        self.base = base
        self.ready = True
        self.calls = []

    def __getattr__(self, name):
        return getattr(self.base, name)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def execute(self, sql, params=()):
        marker = sql.split("\n", 1)[0]
        if marker == "-- evidence:street-tree-tiles-ready":
            return [{"t": self.ready}]
        if marker == "-- evidence:street-tree-tile":
            self.calls.append(("trees", params))
            return [{"tile": b"\x1a\x04"}]
        if marker == "-- evidence:street-tree-heat-tile":
            self.calls.append(("heat", params))
            return [{"tile": b"\x1a\x06"}]
        if marker == "-- evidence:green-street-tile":
            self.calls.append(("streets", params))
            return [{"tile": b"\x1a\x05"}]
        if marker == "-- evidence:canopy-tiles-ready":
            return [{"t": self.ready}]
        if marker == "-- evidence:canopy-tile":
            self.calls.append(("canopy", params))
            return [{"png": PNG}] if params in ((14, 8186, 5448), (9, 255, 170)) else []
        return self.base.execute(sql, params)


PNG = b"\x89PNG\r\n\x1a\nfake"


def seeded():
    return TreeConnection(seed_production_fixture())


class StreetTreeTileTests(unittest.TestCase):
    def test_tree_heat_from_zoom_12_then_single_trees_from_15(self):
        connection = seeded()
        reader = EvidenceReader(connect=lambda: connection)
        self.assertEqual(street_trees.street_tree_tile(reader, 11, 1023, 681), b"")
        self.assertEqual(connection.calls, [])  # below the gate the database is not asked
        # v4 Task 3: zoom 12-14 are counts per 64th of the tile for the heat (no migration: an inline query).
        self.assertEqual(street_trees.street_tree_tile(reader, 12, 2046, 1362), b"\x1a\x06")
        self.assertEqual(street_trees.street_tree_tile(reader, 14, 8186, 5448), b"\x1a\x06")
        self.assertEqual(street_trees.street_tree_tile(reader, 15, 16374, 10895), b"\x1a\x04")
        self.assertEqual(street_trees.street_tree_tile(reader, 16, 32748, 21791), b"\x1a\x04")
        self.assertEqual(connection.calls, [("heat", (12, 2046, 1362)), ("heat", (14, 8186, 5448)),
                                            ("trees", (15, 16374, 10895)), ("trees", (16, 32748, 21791))])

    def test_heat_query_counts_inside_the_tile_on_a_fine_grid(self):
        sql = street_trees.STREET_TREE_HEAT_SQL
        self.assertIn("/ 64)", sql)
        self.assertIn("count(*)::integer AS n", sql)
        self.assertIn("'street_trees'", sql)
        self.assertIn("t.at && tile.bounds", sql)  # no margin: the heat draws across tile edges
        self.assertEqual(sql.count("%s"), 3)

    def test_green_streets_from_zoom_13(self):
        connection = seeded()
        reader = EvidenceReader(connect=lambda: connection)
        self.assertEqual(street_trees.green_street_tile(reader, 12, 2046, 1362), b"")
        self.assertEqual(street_trees.green_street_tile(reader, 13, 4093, 2724), b"\x1a\x05")
        self.assertEqual(connection.calls, [("streets", (13, 4093, 2724))])

    def test_before_the_migration_no_tile_and_no_error(self):
        connection = seeded()
        connection.ready = False
        reader = EvidenceReader(connect=lambda: connection)
        self.assertEqual(street_trees.street_tree_tile(reader, 15, 16374, 10895), b"")
        self.assertEqual(street_trees.green_street_tile(reader, 15, 16374, 10895), b"")
        self.assertEqual(connection.calls, [])

    def test_canopy_from_zoom_8_to_14_and_only_where_stored(self):
        connection = seeded()
        reader = EvidenceReader(connect=lambda: connection)
        self.assertEqual(street_trees.canopy_tile(reader, 7, 127, 85), b"")
        self.assertEqual(street_trees.canopy_tile(reader, 15, 16373, 10896), b"")  # the map stretches 14
        self.assertEqual(connection.calls, [])
        self.assertEqual(street_trees.canopy_tile(reader, 14, 8186, 5448), PNG)
        self.assertEqual(street_trees.canopy_tile(reader, 14, 8186, 5449), b"")  # no green there
        # v4 Task 6: the averaged pyramid, zoom 8-10, is served the same way.
        self.assertEqual(street_trees.canopy_tile(reader, 9, 255, 170), PNG)
        connection.ready = False
        self.assertEqual(street_trees.canopy_tile(reader, 14, 8186, 5448), b"")

    def test_tile_out_of_range(self):
        reader = EvidenceReader(connect=lambda: seeded())
        for z, x, y in ((15, 2 ** 15, 0), (15, 0, -1), (23, 0, 0)):
            with self.assertRaises(MalformedQuery):
                street_trees.street_tree_tile(reader, z, x, y)
            with self.assertRaises(MalformedQuery):
                street_trees.green_street_tile(reader, z, x, y)


@unittest.skipIf(TestClient is None, "fastapi is not installed")
class StreetTreeHttpTests(unittest.TestCase):
    def setUp(self):
        connection = seeded()
        self._previous = app_module._reader
        app_module._reader = EvidenceReader(connect=lambda: connection)
        self.client = TestClient(app_module.app)

    def tearDown(self):
        app_module._reader = self._previous

    def test_round_trip(self):
        trees = self.client.get("/api/v1/tiles/street-trees/15/16374/10895.pbf")
        streets = self.client.get("/api/v1/tiles/green-streets/15/16374/10895.pbf")
        heat = self.client.get("/api/v1/tiles/street-trees/12/2046/1362.pbf")
        low = self.client.get("/api/v1/tiles/street-trees/11/1023/681.pbf")
        bad = self.client.get("/api/v1/tiles/green-streets/14/99999/0.pbf")

        self.assertEqual(trees.status_code, 200)
        self.assertEqual(trees.headers["content-type"], "application/vnd.mapbox-vector-tile")
        self.assertEqual(trees.content, b"\x1a\x04")
        self.assertEqual(streets.content, b"\x1a\x05")
        self.assertEqual(heat.content, b"\x1a\x06")
        self.assertEqual(low.status_code, 204)
        self.assertEqual(bad.status_code, 400)

    def test_canopy_png(self):
        tile = self.client.get("/api/v1/tiles/canopy/14/8186/5448.png")
        empty = self.client.get("/api/v1/tiles/canopy/14/8186/5449.png")
        self.assertEqual(tile.status_code, 200)
        self.assertEqual(tile.headers["content-type"], "image/png")
        self.assertEqual(tile.content, PNG)
        self.assertEqual(empty.status_code, 204)


if __name__ == "__main__":
    unittest.main()
