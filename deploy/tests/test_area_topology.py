"""The map's areas fit together (migration 119, deploy/tools/area_topology.py): one coverage cut from the LSOAs,
simplified as a whole per zoom and snapped to each zoom's tile grid, so neighbours share their edges exactly in the
tiles. The database checks run with CLOSE_KNIT_TOPOLOGY_DATABASE_URL (gate.sh points it at the local copy)."""
import os
import struct
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "deploy" / "tools"))
import area_topology  # noqa: E402

MIGRATION = (ROOT / "deploy" / "migrations" / "119-area-shape-coverage.sql").read_text()
BUILD = (ROOT / "deploy" / "tools" / "build_area_tiles.sql").read_text()
TILE_FUNCTION = MIGRATION.split("FUNCTION public.area_tile_mvt", 1)[1].split("$$;", 1)[0]


def _varint(value: int) -> bytes:
    out = bytearray()
    while value > 0x7F:
        out.append((value & 0x7F) | 0x80)
        value >>= 7
    out.append(value)
    return bytes(out)


def _field(number: int, payload: bytes) -> bytes:
    return _varint(number << 3 | 2) + _varint(len(payload)) + payload


def _square_tile(squares: list[tuple[int, int, int, int]], extent: int = 4096) -> bytes:
    """A tile of one layer, `lsoa`, with one square feature per (id, x, y, side)."""
    features = b""
    for fid, x, y, side in squares:
        zig = lambda v: (v << 1) ^ (v >> 31)  # noqa: E731
        commands = [9, zig(x), zig(y), 3 << 3 | 2, zig(side), 0, 0, zig(side), zig(-side), 0, 15]
        geometry = b"".join(_varint(c) for c in commands)
        features += _field(2, _varint(1 << 3) + _varint(fid) + _varint(3 << 3) + _varint(3) + _field(4, geometry))
    layer = _varint(15 << 3) + _varint(2) + _field(1, b"lsoa") + features + _varint(5 << 3) + _varint(extent)
    return _field(3, layer)


class AreaTopologyTextTests(unittest.TestCase):
    def test_tiles_read_the_coverage_shapes_not_per_feature_simplification(self):
        self.assertNotIn("Simplify", TILE_FUNCTION)
        self.assertNotIn("ST_AsMVTGeom(", TILE_FUNCTION)  # it simplifies each feature by half a unit
        self.assertIn("least(area_tile_mvt.z, 12)", TILE_FUNCTION)  # the parameter, not the column z
        self.assertIn("FROM tile, area_shape_zoom s", TILE_FUNCTION)
        self.assertIn("area_tile_extent(z)", TILE_FUNCTION)

    def test_one_coverage_per_zoom_snapped_to_the_tile_grid(self):
        self.assertIn("ST_CoverageSimplify(g, cell * 3) OVER ()", MIGRATION)
        self.assertIn("ST_UnaryUnion(ST_Collect(ST_Boundary(g)), cell)", MIGRATION)
        self.assertIn("ST_Polygonize", MIGRATION)
        # boroughs and regions are unions of LSOAs, never ONS's LAD shapes
        self.assertIn("ST_CoverageUnion(geometry)", MIGRATION)
        self.assertNotIn("kind = 'borough' AND", MIGRATION.split("FUNCTION public.build_area_shapes", 1)[1].split("$$;", 1)[0])

    def test_a_new_tile_release_for_the_new_shapes(self):
        self.assertIn("SELECT 'a2-' || left(md5(", MIGRATION)

    def test_the_build_makes_shapes_before_tiles_and_keeps_the_previous_release(self):
        self.assertLess(BUILD.index("build_area_shapes()"), BUILD.index("build_area_shape_zoom"))
        self.assertLess(BUILD.index("build_area_shape_zoom"), BUILD.index("build_area_tiles("))
        self.assertIn("ORDER BY built_at DESC LIMIT 2", BUILD)

    def test_the_sample_reaches_every_tile_zoom_and_london_essex(self):
        tiles = area_topology.sample_tiles()
        self.assertEqual({z for z, _, _ in tiles}, set(range(5, 13)))
        self.assertIn((9, 256, 169), tiles)
        # the e2e tests' tiles: both kinds at zooms 6 and 7, LSOAs at 9 and 12 around the London/Essex border
        self.assertEqual({(kind, z) for kind, z, _, _ in area_topology.e2e_tiles()},
                         {("msoa", 6), ("msoa", 7), ("msoa", 8), ("msoa", 9), ("lsoa", 6), ("lsoa", 7), ("lsoa", 8),
                      ("lsoa", 9), ("lsoa", 12)})

    def test_decoder_reads_polygons_ids_and_extent(self):
        layers = area_topology.decode(_square_tile([(1000001, 0, 0, 10), (1000002, 10, 0, 10)], extent=8192))
        extent, features = layers["lsoa"]
        self.assertEqual(extent, 8192)
        self.assertEqual([fid for fid, _, _ in features], [1000001, 1000002])
        self.assertEqual(features[1][1:], ("MULTIPOLYGON(((10 0,20 0,20 10,10 10,10 0)))", (10, 0, 20, 10)))


DATABASE_URL = os.environ.get("CLOSE_KNIT_TOPOLOGY_DATABASE_URL")


@unittest.skipUnless(DATABASE_URL, "set CLOSE_KNIT_TOPOLOGY_DATABASE_URL to a database with migration 119 built")
class AreaTopologyDatabaseTests(unittest.TestCase):
    """Reads only: the built shapes and the stored tiles of the newest build."""

    @classmethod
    def setUpClass(cls):
        cls.results = area_topology.check(DATABASE_URL, tiles="stored")

    def failing(self, name: str) -> list[str]:
        return [f"{what}: {bad}" for check, what, bad in self.results if check == name and bad]

    def test_every_level_and_zoom_is_a_valid_coverage(self):
        self.assertTrue([r for r in self.results if r[0] == "coverage"])
        self.assertEqual(self.failing("coverage"), [])

    def test_each_parent_is_the_union_of_its_children(self):
        self.assertEqual(self.failing("nesting"), [])

    def test_borough_labels_sit_in_their_borough(self):
        self.assertEqual(self.failing("labels"), [])

    def test_sample_tiles_have_no_overlap_and_no_gap(self):
        self.assertEqual(len([r for r in self.results if r[0] == "tile overlap"]), 3 * len(area_topology.sample_tiles()))
        self.assertEqual(self.failing("tile overlap"), [])
        self.assertEqual(self.failing("tile gap"), [])


if __name__ == "__main__":
    unittest.main()
