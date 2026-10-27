"""The area tiles' static archives (deploy/tools/area_pmtiles.py): PMTiles v3 as the browser's pmtiles library reads it.
The database build runs in api/tests/test_map_tiles.py against the gate's PostGIS fixture."""
import gzip
import random
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "deploy" / "tools"))
import area_pmtiles  # noqa: E402

BOUNDS = (-0.5, 51.3, 0.3, 51.7)


class ArchiveTests(unittest.TestCase):
    def test_tile_ids_follow_the_hilbert_curve_as_the_pmtiles_library_numbers_them(self):
        # zxyToTileId of the pmtiles npm package (4.5.0) for the same tiles
        expected = {(0, 0, 0): 0, (1, 0, 0): 1, (1, 0, 1): 2, (1, 1, 1): 3, (1, 1, 0): 4, (5, 15, 10): 494,
                    (7, 63, 42): 7918, (9, 256, 169): 310206, (12, 2048, 1360): 19853055, (12, 4095, 0): 22369620,
                    (12, 0, 4095): 11184810, (14, 8188, 5442): 129743539}
        self.assertEqual({zxy: area_pmtiles.tile_id(*zxy) for zxy in expected}, expected)

    def test_every_tile_reads_back_and_a_missing_one_is_empty(self):
        tiles = {(z, x, y): f"tile {z}/{x}/{y}".encode() for z in (5, 9, 12) for x, y in ((0, 0), (1, 2), (3, 1))}
        archive = area_pmtiles.write(tiles, "lsoa", BOUNDS)

        for (z, x, y), tile in tiles.items():
            self.assertEqual(area_pmtiles.read_tile(archive, z, x, y), tile)
        self.assertEqual(area_pmtiles.read_tile(archive, 9, 2, 2), b"")
        self.assertEqual(area_pmtiles.read_tile(archive, 13, 0, 0), b"")
        header = area_pmtiles.read_header(archive)
        self.assertEqual((header["min_zoom"], header["max_zoom"], header["addressed_tiles"]), (5, 12, 9))
        self.assertEqual((header["tile_type"], header["tile_compression"], header["clustered"]), (1, 2, 1))
        self.assertEqual((header["min_lon_e7"], header["max_lat_e7"]), (-5_000_000, 517_000_000))
        metadata = archive[header["metadata_offset"]:header["metadata_offset"] + header["metadata_length"]]
        self.assertIn(b'"id":"lsoa"', gzip.decompress(metadata))

    def test_the_header_and_root_directory_fit_the_first_16_kib_with_leaves_for_the_rest(self):
        rng = random.Random(1)  # scattered tiles of scattered sizes: a directory gzip cannot squeeze into 16 KiB
        tiles = {(12, rng.randrange(4096), rng.randrange(4096)): rng.randbytes(rng.randrange(1, 300)) for _ in range(20_000)}
        archive = area_pmtiles.write(tiles, "lsoa", BOUNDS)

        header = area_pmtiles.read_header(archive)
        self.assertLessEqual(header["root_offset"] + header["root_length"], 16384)
        self.assertGreater(header["leaf_length"], 0)
        for zxy in list(tiles)[::997]:
            self.assertEqual(area_pmtiles.read_tile(archive, *zxy), tiles[zxy])

    def test_the_same_tiles_make_the_same_bytes_and_a_release_hashes_them(self):
        one = {(9, 1, 1): b"a"}
        archive = area_pmtiles.write(one, "msoa", BOUNDS)
        self.assertEqual(area_pmtiles.write(dict(one), "msoa", BOUNDS), archive)
        built = {kind: (archive, 1) for kind in area_pmtiles.KINDS}
        release = area_pmtiles.release_of(built)
        self.assertRegex(release, r"^[0-9a-f]{12}$")
        # Same ids, other shapes: another release (the hash is of the bytes, not of the area ids).
        built["lsoa"] = (area_pmtiles.write({(9, 1, 1): b"b"}, "lsoa", BOUNDS), 1)
        self.assertNotEqual(area_pmtiles.release_of(built), release)
        self.assertEqual(area_pmtiles.file_name(release, "borough"), f"areas-{release}-borough.pmtiles")

    def test_prune_keeps_the_files_of_the_releases_it_keeps(self):
        class Rows:
            def __init__(self):
                self.deleted = None

            def execute(self, sql, parameters=()):
                if sql.startswith("DELETE"):
                    self.deleted = parameters[0]
                return [("aaaaaaaaaaaa",), ("bbbbbbbbbbbb",)]

        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            for release in ("aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc"):
                for kind in area_pmtiles.KINDS:
                    (out / area_pmtiles.file_name(release, kind)).write_bytes(b"")
            (out / "notes.txt").write_text("kept")
            rows = Rows()
            deleted = area_pmtiles.prune(rows, out)
            self.assertEqual(deleted, [area_pmtiles.file_name("cccccccccccc", kind) for kind in sorted(area_pmtiles.KINDS)])
            self.assertEqual(rows.deleted, ["aaaaaaaaaaaa", "bbbbbbbbbbbb"])
            self.assertEqual(len(list(out.glob("*.pmtiles"))), 6)
            self.assertTrue((out / "notes.txt").exists())


class DeployWiringTests(unittest.TestCase):
    def test_ship_builds_missing_archives_after_the_migrations_and_before_the_new_api(self):
        ship = (ROOT / "deploy" / "ship.sh").read_text()
        build = ship.index("python /tools/area_pmtiles.py /out")
        self.assertLess(ship.index("./migrate.sh apply"), build)
        self.assertLess(build, ship.index("up -d --build --no-deps api mcp web"))
        self.assertIn("SELECT count(*) FROM area_pmtiles", ship)
        self.assertIn("-v /srv/close-knit-tiles:/out", ship)
        # a Caddy without the mount is recreated: a reload cannot add a volume
        self.assertIn("test -d /srv/tiles", ship)

    def test_caddy_serves_the_folder_the_build_writes_for_good(self):
        compose = (ROOT / "deploy" / "docker-compose.prod.yml").read_text()
        self.assertIn("- /srv/close-knit-tiles:/srv/tiles:ro", compose)
        caddy = (ROOT / "deploy" / "Caddyfile").read_text()
        block = caddy[caddy.index("handle /tiles/* {"):]
        block = block[:block.index("\n\t}")]
        self.assertIn("root * /srv", block)
        self.assertIn('Cache-Control "public, max-age=31536000, immutable"', block)
        self.assertIn("file_server", block)
        self.assertLess(caddy.index("handle /tiles/*"), caddy.index("import proxy web:4180"))


if __name__ == "__main__":
    unittest.main()
