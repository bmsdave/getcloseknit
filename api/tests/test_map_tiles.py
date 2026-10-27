"""Area boundaries as vector tiles (map_tiles, migrations 116, 119, 125, 127): the only way area shapes reach the map."""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from area_api import evidence, map_tiles
from tests.test_production_evidence import make_reader, seed_production_fixture

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "deploy" / "tools"))
import area_pmtiles  # noqa: E402  (the archives' build, deploy/tools/area_pmtiles.py)

try:
    from fastapi.testclient import TestClient

    import area_api.app as app_module
    from area_api.evidence import EvidenceReader
    from tests.test_ratelimit import without_rate_limits
except ImportError:  # pragma: no cover - dependency-free environments
    TestClient = None

TEST_DATABASE_URL = os.environ.get("CLOSE_KNIT_TEST_DATABASE_URL")
MIGRATION = Path(__file__).resolve().parents[2] / "deploy" / "migrations" / "116-area-vector-tiles.sql"
# 116's functions say the kind 'borough'; on a database past step R1 (kind 'lad') 121 rewrites them again.
R1_MIGRATION = Path(__file__).resolve().parents[2] / "deploy" / "migrations" / "121-geography-names.sql"
TILES_ONLY_MIGRATION = Path(__file__).resolve().parents[2] / "deploy" / "migrations" / "125-area-tiles-only.sql"
RELEASE = "a1-0123456789ab"
LONDON_RELEASE = map_tiles.london_release(RELEASE)
LONDON = "E12000007"


def tiled_fixture(built=True):
    connection = seed_production_fixture()
    connection.area_tiles = {(RELEASE, "lsoa", 11, 1023, 681): b"\x1a\x04lsoa"}
    connection.area_tiles_built = built
    connection.live_tile = b"\x1a\x04live"
    return connection


class EnglandFlag(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, {"CLOSE_KNIT_ENGLAND": "1"})
        patcher.start()
        self.addCleanup(patcher.stop)


class TileAddressTests(unittest.TestCase):
    def test_only_a_release_a_kind_and_a_tile_inside_the_pyramid_pass(self):
        self.assertIsNone(map_tiles.tile_problem(RELEASE, "lsoa", 11, 1023, 681))
        self.assertIn("release", map_tiles.tile_problem("../x", "lsoa", 11, 1023, 681))
        self.assertIn("kind", map_tiles.tile_problem(RELEASE, "region", 11, 1023, 681))
        self.assertIn("range", map_tiles.tile_problem(RELEASE, "lsoa", 11, 2048, 681))
        self.assertIn("range", map_tiles.tile_problem(RELEASE, "lsoa", 23, 0, 0))

    def test_the_coverage_names_the_tiles_and_the_london_map_its_own(self):
        info = {"release": RELEASE, "london": LONDON_RELEASE, "built": True, "minzoom": 5, "maxzoom": 12}
        body = map_tiles.with_tiles({"coverage": "england"}, info)
        self.assertEqual(body["areaTiles"]["url"], f"/api/v1/tiles/areas/{RELEASE}/{{kind}}/{{z}}/{{x}}/{{y}}.mvt")
        self.assertEqual((body["areaTiles"]["minzoom"], body["areaTiles"]["maxzoom"]), (5, 12))
        london = map_tiles.with_tiles({"coverage": "london"}, info, london=True)["areaTiles"]
        self.assertEqual(london["release"], LONDON_RELEASE)
        self.assertIn(LONDON_RELEASE, london["url"])
        self.assertNotIn("areaTiles", map_tiles.with_tiles({"coverage": "england"}, None))

    def test_the_static_archives_once_built_and_the_apis_tiles_for_a_scope_without_them(self):
        info = {"release": RELEASE, "london": LONDON_RELEASE, "built": True, "minzoom": 5, "maxzoom": 12,
                "files": {"england": "0123456789ab", "london": None}}
        england = map_tiles.with_tiles({"coverage": "england"}, info)["areaTiles"]
        self.assertEqual(england, {"release": "0123456789ab", "minzoom": 5, "maxzoom": 12,
                                   "url": "/tiles/areas-0123456789ab-{kind}.pmtiles"})
        london = map_tiles.with_tiles({"coverage": "london"}, info, london=True)["areaTiles"]
        self.assertEqual(london["url"], f"/api/v1/tiles/areas/{LONDON_RELEASE}/{{kind}}/{{z}}/{{x}}/{{y}}.mvt")

    def test_the_london_release_is_a_release_of_its_own(self):
        self.assertRegex(LONDON_RELEASE, map_tiles.RELEASE_PATTERN)
        self.assertNotEqual(LONDON_RELEASE, RELEASE)
        self.assertEqual(map_tiles.london_release(RELEASE), LONDON_RELEASE)
        self.assertNotEqual(map_tiles.london_release("a1-ffffffffffff"), LONDON_RELEASE)

    def test_a_tile_url_is_immutable_only_while_it_holds_what_it_holds_now(self):
        info = {"release": RELEASE, "london": LONDON_RELEASE}
        self.assertTrue(map_tiles.immutable(info, RELEASE, england=True))
        self.assertTrue(map_tiles.immutable(info, LONDON_RELEASE, england=True))
        self.assertTrue(map_tiles.immutable(info, LONDON_RELEASE, england=False))
        # The flag off answers London's areas on England's URL: for now, never for good.
        self.assertFalse(map_tiles.immutable(info, RELEASE, england=False))
        self.assertFalse(map_tiles.immutable(info, "a1-ffffffffffff", england=True))
        self.assertFalse(map_tiles.immutable(None, RELEASE, england=True))


class AreaTileReaderTests(EnglandFlag):
    def test_a_stored_tile_or_an_empty_one_once_the_store_is_built(self):
        reader = make_reader(tiled_fixture())

        self.assertEqual(reader.area_tile(RELEASE, "lsoa", 11, 1023, 681), b"\x1a\x04lsoa")
        self.assertEqual(reader.area_tile(RELEASE, "lsoa", 11, 0, 0), b"")
        self.assertEqual(reader.area_tile(RELEASE, "lsoa", 3, 0, 0), b"")  # below the tiles' zooms

    def test_before_the_store_is_built_tiles_are_made_on_the_fly(self):
        reader = make_reader(tiled_fixture(built=False))

        self.assertEqual(reader.area_tile(RELEASE, "msoa", 9, 255, 170), b"\x1a\x04live")

    def test_no_tiles_before_the_migration(self):
        with self.assertRaises(evidence.MalformedQuery):
            make_reader(seed_production_fixture()).area_tile(RELEASE, "lsoa", 11, 1023, 681)

    def test_the_london_map_gets_londons_areas_alone(self):
        """With the flag off every tile holds London's areas alone (area_region_tile_mvt), whatever the release; with
        it on, the London release does (a page that read the coverage before the flag changed)."""
        connection = tiled_fixture()
        connection.region_tile = b"region:"
        reader = make_reader(connection)

        self.assertEqual(reader.area_tile(LONDON_RELEASE, "lsoa", 11, 1023, 681), b"region:" + LONDON.encode())
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_ENGLAND": "0"}):
            self.assertEqual(reader.area_tile(RELEASE, "lsoa", 11, 1023, 681), b"region:" + LONDON.encode())
            self.assertEqual(reader.area_tile(LONDON_RELEASE, "msoa", 9, 255, 170), b"region:" + LONDON.encode())
        self.assertEqual(reader.area_tile(RELEASE, "lsoa", 11, 1023, 681), b"\x1a\x04lsoa")

    def test_malformed_addresses_are_refused(self):
        reader = make_reader(tiled_fixture())
        for address in (("bad", "lsoa", 11, 0, 0), (RELEASE, "street", 11, 0, 0), (RELEASE, "lsoa", 11, 4096, 0)):
            with self.assertRaises(evidence.MalformedQuery):
                reader.area_tile(*address)

    def test_the_coverage_carries_the_tiles_the_london_map_its_own(self):
        coverage = make_reader(tiled_fixture()).map_coverage()
        self.assertEqual(coverage["areaTiles"]["release"], RELEASE)
        self.assertNotIn("areaTiles", make_reader(seed_production_fixture()).map_coverage())
        with mock.patch.dict(os.environ, {"CLOSE_KNIT_ENGLAND": "0"}):
            london = make_reader(tiled_fixture()).map_coverage()
        self.assertEqual((london["coverage"], london["areaTiles"]["release"]), ("london", LONDON_RELEASE))

    def test_boxes_per_chunk(self):
        reader = make_reader(seed_production_fixture())

        boxes = reader.area_boxes("lsoa", chunk=LONDON)
        self.assertEqual(boxes["schemaVersion"], "area-boxes.v1")
        self.assertEqual(boxes["chunk"], LONDON)
        first = boxes["areas"][0]
        self.assertEqual(first[0], "uk:lsoa:E01000004")
        self.assertEqual(first[1:], [-0.15, 51.53, -0.13, 51.55])


@unittest.skipIf(TestClient is None, "fastapi test client unavailable")
class AreaTileRouteTests(EnglandFlag):
    def client(self, connection):
        patcher = mock.patch.object(app_module, "get_reader", return_value=EvidenceReader(connect=lambda: connection))
        patcher.start()
        self.addCleanup(patcher.stop)
        without_rate_limits(self)
        return TestClient(app_module.app)

    def test_tiles_are_immutable_for_the_current_release_and_empty_is_204(self):
        client = self.client(tiled_fixture())

        tile = client.get(f"/api/v1/tiles/areas/{RELEASE}/lsoa/11/1023/681.mvt")
        self.assertEqual(tile.status_code, 200)
        self.assertEqual(tile.headers["content-type"], "application/vnd.mapbox-vector-tile")
        self.assertIn("immutable", tile.headers["cache-control"])
        empty = client.get(f"/api/v1/tiles/areas/{RELEASE}/lsoa/11/0/0.mvt")
        self.assertEqual(empty.status_code, 204)
        stale = client.get("/api/v1/tiles/areas/a1-ffffffffffff/lsoa/11/0/0.mvt")
        self.assertEqual(stale.headers["cache-control"], "public, max-age=300")
        self.assertEqual(client.get(f"/api/v1/tiles/areas/{RELEASE}/ward/11/0/0.mvt").status_code, 400)

    def test_with_the_flag_off_only_the_london_release_is_immutable(self):
        connection = tiled_fixture()
        connection.region_tile = b"region:"
        client = self.client(connection)

        with mock.patch.dict(os.environ, {"CLOSE_KNIT_ENGLAND": "0"}):
            london = client.get(f"/api/v1/tiles/areas/{LONDON_RELEASE}/lsoa/11/1023/681.mvt")
            england = client.get(f"/api/v1/tiles/areas/{RELEASE}/lsoa/11/1023/681.mvt")
        self.assertEqual(london.content, b"region:" + LONDON.encode())
        self.assertIn("immutable", london.headers["cache-control"])
        self.assertEqual(england.content, b"region:" + LONDON.encode())
        self.assertEqual(england.headers["cache-control"], "public, max-age=300")

    def test_the_box_index_route(self):
        client = self.client(seed_production_fixture())

        boxes = client.get(f"/api/v1/areas/boxes?carrier=lsoa&chunk={LONDON}")
        self.assertEqual(boxes.status_code, 200)
        self.assertEqual(boxes.json()["schemaVersion"], "area-boxes.v1")


# ---- PostGIS: the tile function itself -----------------------------------------------------------------------

def _varint(data, index):
    shift = value = 0
    while True:
        byte = data[index]
        index += 1
        value |= (byte & 0x7F) << shift
        shift += 7
        if byte < 0x80:
            return value, index


def _fields(data):
    """(field number, wire type, value) of one protobuf message: varints and length-delimited bytes."""
    index = 0
    while index < len(data):
        key, index = _varint(data, index)
        number, wire = key >> 3, key & 7
        if wire == 0:
            value, index = _varint(data, index)
        elif wire == 2:
            length, index = _varint(data, index)
            value, index = data[index:index + length], index + length
        else:
            raise AssertionError(f"unexpected wire type {wire}")
        yield number, wire, value


def decode_mvt(tile):
    """{layer: {"extent", "features": [(id, vertices, tag count)]}} from Mapbox Vector Tile bytes."""
    layers = {}
    for number, _, layer in _fields(tile):
        assert number == 3, "a tile holds only layers"
        name, extent, features = None, 4096, []
        for field, _, value in _fields(layer):
            if field == 1:
                name = value.decode()
            elif field == 5:
                extent = value
            elif field == 2:
                feature_id, vertices, tags = None, 0, 0
                for part, _, content in _fields(value):
                    if part == 1:
                        feature_id = content
                    elif part == 2:
                        tags = len(content)
                    elif part == 4:
                        index, commands = 0, []
                        while index < len(content):
                            command, index = _varint(content, index)
                            commands.append(command)
                        position = 0
                        while position < len(commands):
                            command, count = commands[position] & 7, commands[position] >> 3
                            position += 1
                            if command in (1, 2):
                                vertices += count
                                position += 2 * count
                features.append((feature_id, vertices, tags))
        layers[name] = {"extent": extent, "features": features}
    return layers


@unittest.skipUnless(TEST_DATABASE_URL, "set CLOSE_KNIT_TEST_DATABASE_URL to a PostGIS database with England's areas")
class AreaTileFunctionTests(unittest.TestCase):
    """Runs migration 116 in a transaction that is rolled back, on a database holding area_geography."""

    def setUp(self):
        import psycopg
        from psycopg.rows import dict_row

        self.connection = psycopg.connect(TEST_DATABASE_URL, row_factory=dict_row, autocommit=False)
        self.addCleanup(self.connection.close)
        self.addCleanup(self.connection.rollback)
        self.connection.execute(MIGRATION.read_text())
        self.connection.execute(R1_MIGRATION.read_text())

    def tile(self, kind, z, x, y):
        return bytes(self.connection.execute(map_tiles.LIVE_TILE_SQL, (kind, z, x, y)).fetchone()["tile"])

    def test_the_london_maps_tiles_hold_londons_areas_alone(self):
        """Migration 125 on the seeded fixture (Camden in London, Epping Forest in the East of England): one region's
        tile holds that region's areas, every other area left out; the full tile, both."""
        self.connection.execute(TILES_ONLY_MIGRATION.read_text())
        lsoas = self.connection.execute(
            "SELECT count(*) FILTER (WHERE r.region_code = 'E12000007') AS london, count(*) AS every "
            "FROM area_geography g JOIN area_region r ON r.area_id = g.id WHERE g.kind = 'lsoa'").fetchone()
        if not 0 < lsoas["london"] < lsoas["every"] < 2_000:
            self.skipTest("needs the seeded two-LAD fixture (London and elsewhere)")
        self.connection.execute("SELECT build_area_shapes()")
        self.connection.execute("SELECT build_area_shape_zoom(9)")

        def ids(sql, *parameters):
            tile = bytes(self.connection.execute(sql, parameters).fetchone()["tile"])
            return {feature[0] for feature in decode_mvt(tile)["lsoa"]["features"]} if tile else set()

        camden, epping = (9, 255, 170), (9, 256, 169)
        london = ids(map_tiles.REGION_TILE_SQL, "lsoa", *camden, LONDON)
        self.assertEqual(len(london), lsoas["london"])
        self.assertEqual(ids(map_tiles.LIVE_TILE_SQL, "lsoa", *camden), london)
        self.assertTrue(ids(map_tiles.LIVE_TILE_SQL, "lsoa", *epping))
        self.assertEqual(ids(map_tiles.REGION_TILE_SQL, "lsoa", *epping, LONDON), set())
        self.assertEqual(ids(map_tiles.REGION_TILE_SQL, "lsoa", *epping, None), ids(map_tiles.LIVE_TILE_SQL, "lsoa", *epping))
        self.assertIsNone(self.connection.execute(
            "SELECT to_regprocedure('public.area_geometry(integer, integer, integer)') AS f").fetchone()["f"])

    def test_a_london_tile_is_valid_mvt_with_one_layer_of_ons_code_ids_and_no_properties(self):
        layers = decode_mvt(self.tile("lsoa", 12, 2046, 1361))

        self.assertEqual(list(layers), ["lsoa"])
        features = layers["lsoa"]["features"]
        self.assertGreater(len(features), 20)
        self.assertEqual(layers["lsoa"]["extent"], 4096)
        ids = [feature[0] for feature in features]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue(all(1_000_000 < feature_id < 1_100_000 for feature_id in ids))  # E01xxxxxx
        self.assertTrue(all(tags == 0 for _, _, tags in features))
        known = self.connection.execute(
            "SELECT count(*) AS n FROM area_geography WHERE kind = 'lsoa' AND substr(official_code, 2)::integer = ANY(%s)",
            (ids,)).fetchone()["n"]
        self.assertEqual(known, len(ids))

    def test_each_kind_has_its_own_id_range(self):
        msoa = decode_mvt(self.tile("msoa", 9, 255, 170))["msoa"]["features"]
        borough = decode_mvt(self.tile("borough", 9, 255, 170))["borough"]["features"]
        self.assertTrue(all(2_000_000 < feature[0] < 3_000_000 for feature in msoa))
        self.assertTrue(all(6_000_000 < feature[0] < 10_000_000 for feature in borough))

    def test_zoomed_out_tiles_are_simplified(self):
        """A zoom 7 tile of England's south east holds ~14k LSOAs: about 11 vertices each, not the source's 58."""
        lsoas = self.connection.execute("SELECT count(*) AS n FROM area_geography WHERE kind = 'lsoa'").fetchone()["n"]
        if lsoas < 10_000:
            self.skipTest(f"needs England's LSOAs; this database holds {lsoas} (the seeded fixture: two LADs)")
        features = decode_mvt(self.tile("lsoa", 7, 63, 42))["lsoa"]["features"]
        vertices = sum(feature[1] for feature in features)
        self.assertGreater(len(features), 5_000)
        self.assertLess(vertices / len(features), 20)
        self.assertLess(len(self.tile("lsoa", 7, 63, 42)), 600_000)

    def test_a_tile_without_areas_is_empty(self):
        self.assertEqual(self.tile("lsoa", 10, 0, 0), b"")  # mid-Pacific
        self.assertEqual(self.tile("borough", 12, 1900, 1300), b"")  # the Atlantic west of Ireland

    def test_the_release_is_stable_and_names_the_boundary_set(self):
        first = self.connection.execute("SELECT area_tile_release() AS r").fetchone()["r"]
        self.assertRegex(first, map_tiles.RELEASE_PATTERN)
        self.assertEqual(self.connection.execute("SELECT area_tile_release() AS r").fetchone()["r"], first)


@unittest.skipUnless(TEST_DATABASE_URL, "set CLOSE_KNIT_TEST_DATABASE_URL to a PostGIS database with England's areas")
class AreaArchiveBuildTests(unittest.TestCase):
    """deploy/tools/area_pmtiles.py on the seeded fixture (Camden in London, Epping Forest in the East of England), in
    a transaction that is rolled back: one archive per kind for every area and for London's alone, the coverage
    naming the newest of each."""

    def setUp(self):
        import psycopg

        self.connection = psycopg.connect(TEST_DATABASE_URL, autocommit=False)
        self.addCleanup(self.connection.close)
        self.addCleanup(self.connection.rollback)
        lsoas = self.connection.execute("SELECT count(*) FROM area_geography WHERE kind = 'lsoa'").fetchone()[0]
        if not 0 < lsoas < 2_000:
            self.skipTest("needs the seeded two-LAD fixture")
        self.connection.execute("SELECT build_area_shapes()")
        self.connection.execute("SELECT build_area_shape_zoom(9)")  # an archive holds the zooms built
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.out = Path(directory.name)

    def live(self, kind, z, x, y):
        return bytes(self.connection.execute("SELECT area_region_tile_mvt(%s, %s, %s, %s, NULL)", (kind, z, x, y)).fetchone()[0])

    def test_each_scope_gets_an_archive_per_kind_of_its_areas_and_the_coverage_names_the_newest(self):
        from psycopg.rows import dict_row

        camden, epping = (9, 255, 170), (9, 256, 169)
        every = area_pmtiles.build(self.connection, self.out, None)
        london = area_pmtiles.build(self.connection, self.out, LONDON)
        self.assertEqual(sorted(path.name for path in self.out.iterdir()), sorted(
            area_pmtiles.file_name(build["release"], kind) for build in (every, london) for kind in area_pmtiles.KINDS))

        def tile(build, kind, address):
            return area_pmtiles.read_tile((self.out / area_pmtiles.file_name(build["release"], kind)).read_bytes(), *address)

        def ids(data):
            return {feature[0] for layer in decode_mvt(data).values() for feature in layer["features"]} if data else set()

        for kind in area_pmtiles.KINDS:
            for address in (camden, epping):
                self.assertEqual(tile(every, kind, address), self.live(kind, *address), (kind, address))
        self.assertEqual(list(decode_mvt(tile(every, "borough", camden))), ["borough"])
        self.assertTrue(ids(tile(every, "lsoa", epping)))
        self.assertEqual(ids(tile(london, "lsoa", epping)), set())  # Epping Forest is outside London
        self.assertTrue(ids(tile(london, "lsoa", camden)))
        self.assertNotEqual(every["release"], london["release"])
        # The same shapes, the same bytes: the same release, recorded once.
        self.assertEqual(area_pmtiles.build(self.connection, self.out, None)["release"], every["release"])

        self.connection.row_factory = dict_row
        info = map_tiles.tile_info(self.connection)
        self.assertEqual(info["files"], {"england": every["release"], "london": london["release"]})
        self.assertEqual(map_tiles.with_tiles({}, info)["areaTiles"]["url"], f"/tiles/areas-{every['release']}-{{kind}}.pmtiles")
        self.assertEqual(map_tiles.with_tiles({}, info, london=True)["areaTiles"]["release"], london["release"])
