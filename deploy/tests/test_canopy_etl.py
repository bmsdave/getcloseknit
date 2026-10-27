"""Canopy ETL (migration 066): British National Grid, NDVI classes, PNG tiles and the bundle's guards."""
import struct
import sys
import unittest
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

import etl_canopy  # noqa: E402

MIGRATION = (Path(__file__).resolve().parents[1] / "migrations" / "066-street-trees.sql").read_text()


class NumpyTests(unittest.TestCase):
    def setUp(self):
        try:
            import numpy  # noqa: F401
        except ImportError:
            self.skipTest("numpy not installed")

    def test_bng_matches_postgis(self):
        import numpy as np

        # PostGIS ST_Transform(4326 -> 27700) on the local database, 2026-10-17 (no OSTN15 grid: Helmert).
        lon, lat = np.array([-0.0725, -0.1276, -0.5, 0.3]), np.array([51.5656, 51.5072, 51.3, 51.68])
        east, north = etl_canopy.to_bng(lon, lat)
        expected = [(533695.8, 186951.7), (530043.2, 180358.2), (504671.2, 156720.9), (559111.2, 200419.1)]
        for (e, n), got_e, got_n in zip(expected, east, north):
            self.assertAlmostEqual(got_e, e, delta=0.2)
            self.assertAlmostEqual(got_n, n, delta=0.2)

    def test_classes(self):
        import numpy as np

        values = np.array([np.nan, -0.2, 0.39, 0.4, 0.55, 0.65, 0.95], dtype=np.float32)
        self.assertEqual(etl_canopy.classes(values).tolist(), [0, 0, 0, 1, 2, 3, 4])

    def test_png_is_a_palette_png_with_clear_first(self):
        import numpy as np

        pixels = np.zeros((4, 4), dtype=np.uint8)
        pixels[1, 2] = 4
        body = etl_canopy.png(pixels)
        self.assertEqual(body[:8], b"\x89PNG\r\n\x1a\n")
        chunks, offset = {}, 8
        while offset < len(body):
            length = struct.unpack(">I", body[offset:offset + 4])[0]
            kind = body[offset + 4:offset + 8]
            chunks[kind] = body[offset + 8:offset + 8 + length]
            offset += 12 + length
        self.assertEqual(struct.unpack(">IIBBBBB", chunks[b"IHDR"]), (4, 4, 8, 3, 0, 0, 0))
        self.assertEqual(chunks[b"tRNS"], bytes(etl_canopy.ALPHAS))
        self.assertEqual(chunks[b"tRNS"][0], 0)
        rows = zlib.decompress(chunks[b"IDAT"])
        self.assertEqual(rows[1 * 5:2 * 5], b"\x00\x00\x00\x04\x00")  # filter byte, then row 1

    def test_zoomed_out_shades_are_shares_of_green_averaged_two_by_two(self):
        import numpy as np

        # v4 Task 6: a parent pixel is the mean of a 2 x 2 block of its children's shares (never of colours).
        full = np.ones((etl_canopy.TILE, etl_canopy.TILE), dtype=np.float32)
        half = np.zeros_like(full)
        half[:, ::2] = 1  # every other column green: 0.5 per 2 x 2 block
        parent = etl_canopy.parent_share({(0, 0): full, (1, 0): half})  # (0, 1) and (1, 1) missing: no green
        self.assertEqual(parent.shape, (etl_canopy.TILE, etl_canopy.TILE))
        self.assertAlmostEqual(float(parent[0, 0]), 1.0)
        self.assertAlmostEqual(float(parent[0, etl_canopy.TILE - 1]), 0.5)
        self.assertAlmostEqual(float(parent[etl_canopy.TILE - 1, 0]), 0.0)
        # The same four shades as the 10 m tiles; under a fifth green is clear.
        shares = np.array([0.0, 0.19, 0.2, 0.45, 0.6, 0.79, 1.0], dtype=np.float32)
        self.assertEqual(etl_canopy.share_classes(shares).tolist(), [0, 0, 1, 2, 3, 3, 4])

    def test_tile_share_samples_the_cells_under_each_pixel(self):
        import numpy as np

        columns, rows = etl_canopy.tile_range(11)
        x, y = columns[len(columns) // 2], rows[len(rows) // 2]
        x0, y0, x1, y1 = etl_canopy.etl_nature.EXTENT
        shape = ((y1 - y0) // etl_canopy.etl_nature.CELL, (x1 - x0) // etl_canopy.etl_nature.CELL)
        green = np.ones(shape, dtype=bool)
        self.assertTrue(np.allclose(etl_canopy.tile_share(green, 11, x, y, samples=2), 1.0))
        green[:, ::2] = False  # every other 10 m column: about half of each pixel
        share = etl_canopy.tile_share(green, 11, x, y, samples=4)
        self.assertGreater(float(share.mean()), 0.4)
        self.assertLess(float(share.mean()), 0.6)

    def test_tile_range_covers_london(self):
        columns, rows = etl_canopy.tile_range(14)
        self.assertIn(8186, columns)   # central London, zoom 14
        self.assertIn(5448, rows)
        self.assertLess(len(columns) * len(rows), 2000)


class SchemaTests(unittest.TestCase):
    def test_table_and_bundle_guard(self):
        self.assertIn("CREATE TABLE IF NOT EXISTS canopy_tile", MIGRATION)
        self.assertIn("PRIMARY KEY (z, x, y)", MIGRATION)
        head = etl_canopy.BUNDLE_HEAD.replace("{source}", etl_canopy.SOURCE)
        self.assertIn("IF to_regclass('public.canopy_tile') IS NULL THEN", head)
        self.assertIn("WHERE id = 'src-sentinel2-ndvi-2025'", head)
        self.assertEqual(etl_canopy.ZOOMS, (8, 9, 10, 11, 12, 13, 14))
        self.assertEqual(etl_canopy.PYRAMID_ZOOMS, (10, 9, 8))
        # The full bundle replaces every tile; the pyramid only zoom 8-10, leaving 11-14 as loaded.
        self.assertIn("DELETE FROM canopy_tile;", etl_canopy.bundle_head(etl_canopy.SOURCE))
        self.assertIn("DELETE FROM canopy_tile WHERE z IN (8, 9, 10);",
                      etl_canopy.bundle_head(etl_canopy.SOURCE, etl_canopy.PYRAMID_ZOOMS))


if __name__ == "__main__":
    unittest.main()
